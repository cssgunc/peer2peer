"""Import every model here so metadata includes all tables."""

from app.models.account import Account, AccountRole, AuthSession
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
from app.models.site_setting import SiteSetting

__all__ = [
    "Account",
    "AccountRole",
    "AuthSession",
    "Channel",
    "ClosedBy",
    "Conversation",
    "ConversationStatus",
    "DeliveryStatus",
    "Message",
    "MessageSender",
    "SiteSetting",
    "Texter",
]
