"""Web chat channel: texters connect over a WebSocket with a random session token (TDD 4.6.2)."""

import hashlib
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.channels.base import InboundMessage
from app.events import MESSAGE_CREATED, Event, event_bus, texter_topic
from app.models import Channel, Conversation, Message
from app.schemas.chat import ChatMessageDTO


def hash_token(token: str) -> bytes:
    """The texter's identity hash: SHA-256 of their chat token. The raw token is never stored."""
    return hashlib.sha256(token.encode()).digest()


class WebChatAdapter:
    channel = Channel.WEB

    def parse_inbound(self, payload: Mapping[str, Any]) -> InboundMessage:
        return InboundMessage(identity_hash=hash_token(payload["token"]), body=payload["body"])

    def send(self, conversation: Conversation, message: Message) -> None:
        if conversation.texter_id is None:
            return  # Purged texter: no one to deliver to.
        event: Event = {
            "type": MESSAGE_CREATED,
            "data": {
                "conversation_id": str(conversation.id),
                "message": ChatMessageDTO.from_message(message).model_dump(mode="json"),
            },
        }
        event_bus.publish(texter_topic(conversation.texter_id), event)

    def handle_status_callback(self, db: Session, payload: Mapping[str, Any]) -> None:
        # The web channel has no delivery receipts; the WebSocket is the delivery.
        return None
