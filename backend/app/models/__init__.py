"""Import every model here so metadata includes all tables."""

from app.models.account import Account, AccountRole, AuthSession
from app.models.content_block import ContentBlock
from app.models.messaging import (
    Channel,
    ClosedBy,
    Conversation,
    ConversationStatus,
    DeliveryStatus,
    Message,
    MessageSender,
    Texter,
)
from app.models.resource import Resource, ResourceTag, ResourceTagLink
from app.models.shift import Shift, ShiftEndReason

__all__ = [
    "Account",
    "AccountRole",
    "AuthSession",
    "Channel",
    "ClosedBy",
    "ContentBlock",
    "Conversation",
    "ConversationStatus",
    "DeliveryStatus",
    "Message",
    "MessageSender",
    "Resource",
    "ResourceTag",
    "ResourceTagLink",
    "Shift",
    "ShiftEndReason",
    "Texter",
]
