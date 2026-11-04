import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from anyio import CancelScope
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.database import get_db
from app.events import SESSION_REVOKED, event_bus, portal_topic
from app.services.sessions import SESSION_COOKIE_NAME, resolve_session
from app.services.shifts import get_open_shift, record_heartbeat

router = APIRouter(tags=["portal"])


def _check_session(db: Session, token: str, *, heartbeat: bool = False) -> uuid.UUID | None:
    # A socket outlives ordinary requests; discard cached rows to see their revocations/edits.
    db.expire_all()
    now = datetime.now(UTC)
    session = resolve_session(db, token, now, update_last_seen=False)
    account_id = session.account_id if session is not None else None
    if account_id is not None and heartbeat:
        shift = get_open_shift(db, account_id)
        if shift is not None:
            record_heartbeat(db, shift, now)
    # Persist heartbeat/expiry writes and release the connection while the socket is idle.
    db.commit()
    return account_id


@router.websocket("/ws/portal")
async def portal_socket(websocket: WebSocket, db: Annotated[Session, Depends(get_db)]) -> None:
    if websocket.headers.getlist("origin") != [get_settings().app_origin]:
        await websocket.close(code=1008)
        return

    token = websocket.cookies.get(SESSION_COOKIE_NAME)
    account_id = await run_in_threadpool(_check_session, db, token) if token else None
    if account_id is None:
        # Accept only to deliver the application's close code; a pre-accept close becomes HTTP 403.
        await websocket.accept()
        await websocket.close(code=4001)
        return
    assert token is not None

    topic = portal_topic(account_id)
    queue = event_bus.subscribe(topic)
    receive_task = None
    event_task = None
    try:
        await websocket.accept()
        receive_task = asyncio.create_task(websocket.receive())
        event_task = asyncio.create_task(queue.get())
        while True:
            done, _ = await asyncio.wait(
                [receive_task, event_task], return_when=asyncio.FIRST_COMPLETED
            )
            # One task owns all socket sends, including closes, so they cannot race each other.
            if event_task in done:
                event = event_task.result()
                await websocket.send_json(event)
                if event["type"] == SESSION_REVOKED:
                    await websocket.close(code=4001)
                    return
                event_task = asyncio.create_task(queue.get())
            if receive_task in done:
                message = receive_task.result()
                if message["type"] == "websocket.disconnect":
                    return
                text = message.get("text")
                if text is None:
                    await websocket.close(code=1003)
                    return
                data = json.loads(text)
                if isinstance(data, dict) and data.get("type") == "heartbeat":
                    valid = await run_in_threadpool(_check_session, db, token, heartbeat=True)
                    if valid is None:
                        await websocket.close(code=4001)
                        return
                receive_task = asyncio.create_task(websocket.receive())
    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        await websocket.close(code=1003)
    finally:
        event_bus.unsubscribe(topic, queue)
        tasks = [task for task in (receive_task, event_task) if task is not None]
        for task in tasks:
            task.cancel()
        # The server may cancel the handler on disconnect; still reap both child tasks.
        with CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)
