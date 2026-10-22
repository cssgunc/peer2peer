"""Import every model here so metadata includes all tables."""

from app.models.account import Account, AccountRole, AuthSession
from app.models.audit import AuditLog
from app.models.content_block import ContentBlock
from app.models.faq import Faq
from app.models.feedback import FeedbackSubmission
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
from app.models.shift import Shift, ShiftEndReason
from app.models.statistic import Statistic

__all__ = [
    "Faq",
    "Statistic",
    "Account",
    "AccountRole",
    "AuthSession",
    "AuditLog",
    "Channel",
    "ClosedBy",
    "ContentBlock",
    "Conversation",
    "ConversationStatus",
    "DeliveryStatus",
    "FeedbackSubmission",
    "Message",
    "MessageSender",
    "Shift",
    "ShiftEndReason",
    "Texter",
]
