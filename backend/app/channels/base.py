"""The interface every messaging channel implements (TDD 4.6.3).

Adapters turn a channel's inbound payload into a texter identity hash and a body, and deliver
responder messages back over the channel. The pipeline never needs to know which channel it is.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.models import Channel, Conversation, Message


@dataclass(frozen=True)
class InboundMessage:
    identity_hash: bytes
    body: str
    provider_message_id: str | None = None


class ChannelAdapter(Protocol):
    channel: Channel

    def parse_inbound(self, payload: Mapping[str, Any]) -> InboundMessage:
        """Turn a raw inbound payload into the texter's identity hash and the message body."""
        ...

    def send(self, conversation: Conversation, message: Message) -> None:
        """Deliver a stored responder message to the texter. Called after the commit."""
        ...

    def handle_status_callback(self, db: Session, payload: Mapping[str, Any]) -> None:
        """Record a delivery status update from the provider, if the channel has them."""
        ...
