import asyncio
import json
import uuid
from typing import Annotated

from anyio import CancelScope
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.database import get_db
from app.errors import DEFAULT_CODES, AppError
from app.events import CONVERSATION_CLOSED, MESSAGE_CREATED, STATUS_CHANGED, event_bus, texter_topic
from app.routers.chat import resolve_texter, send_texter_message

router = APIRouter(tags=["chat"])
AUTH_TIMEOUT_SECONDS = 5
TEXTER_EVENTS = {MESSAGE_CREATED, CONVERSATION_CLOSED, STATUS_CHANGED}


def _authenticate(db: Session, token: str) -> uuid.UUID:
    # Keep the texter lock until subscribed so a concurrent REST ending cannot be missed.
    return resolve_texter(db, token).id


def _send_message(db: Session, token: str, payload: object) -> None:
    try:
        # Refresh and lock on every send: a socket must never reuse a revoked identity.
        texter = resolve_texter(db, token)
        send_texter_message(db, texter, payload)
        db.commit()
    except Exception:
        db.rollback()
        raise


@router.websocket("/ws/chat")
async def chat_socket(websocket: WebSocket, db: Annotated[Session, Depends(get_db)]) -> None:
    if websocket.headers.getlist("origin") != [get_settings().app_origin]:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    try:
        async with asyncio.timeout(AUTH_TIMEOUT_SECONDS):
            frame = await websocket.receive()
        if frame["type"] == "websocket.disconnect":
            return
        auth = json.loads(frame.get("text") or "")
        if (
            not isinstance(auth, dict)
            or auth.get("type") != "auth"
            or not isinstance(auth.get("token"), str)
        ):
            await websocket.close(code=4401)
            return
        token = auth["token"]
        texter_id = await run_in_threadpool(_authenticate, db, token)
    except TimeoutError, json.JSONDecodeError, AppError:
        await websocket.close(code=4401)
        return
    except WebSocketDisconnect:
        return

    topic = texter_topic(texter_id)
    queue = event_bus.subscribe(topic)
    receive_task = None
    event_task = None
    try:
        # Release the row lock/connection while idle; sends take a fresh transaction.
        await run_in_threadpool(db.commit)
        receive_task = asyncio.create_task(websocket.receive())
        event_task = asyncio.create_task(queue.get())
        while True:
            done, _ = await asyncio.wait(
                [receive_task, event_task], return_when=asyncio.FIRST_COMPLETED
            )
            # One task owns all writes, including errors and closes, to avoid racing sends.
            if event_task in done:
                event = event_task.result()
                if event["type"] in TEXTER_EVENTS:
                    await websocket.send_json(event)
                    if (
                        event["type"] == CONVERSATION_CLOSED
                        and event["data"].get("closed_by") == "texter"
                    ):
                        await websocket.close(code=4401)
                        return
                event_task = asyncio.create_task(queue.get())
            if receive_task in done:
                frame = receive_task.result()
                if frame["type"] == "websocket.disconnect":
                    return
                try:
                    try:
                        payload = json.loads(frame.get("text") or "")
                    except json.JSONDecodeError:
                        raise AppError(
                            422, "validation_error", "Expected a JSON message."
                        ) from None
                    if not isinstance(payload, dict) or payload.get("type") != "message":
                        raise AppError(422, "validation_error", "Expected a message frame.")
                    await run_in_threadpool(_send_message, db, token, payload)
                except AppError as exc:
                    if exc.code == "invalid_token":
                        await websocket.close(code=4401)
                        return
                    await websocket.send_json(
                        {"type": "error", "code": exc.code, "detail": exc.detail}
                    )
                except HTTPException as exc:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": DEFAULT_CODES.get(exc.status_code, "http_error"),
                            "detail": exc.detail,
                        }
                    )
                receive_task = asyncio.create_task(websocket.receive())
    except WebSocketDisconnect:
        pass
    finally:
        event_bus.unsubscribe(topic, queue)
        tasks = [task for task in (receive_task, event_task) if task is not None]
        for task in tasks:
            task.cancel()
        with CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)
