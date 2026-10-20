"""Import every model here so metadata includes all tables."""

from app.models.account import Account, AccountRole, AuthSession
from app.models.audit import AuditLog
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

__all__ = [
    "Account",
    "AccountRole",
    "AuthSession",
    "AuditLog",
    "Channel",
    "ClosedBy",
    "Conversation",
    "ConversationStatus",
    "DeliveryStatus",
    "Message",
    "MessageSender",
    "Texter",
]
