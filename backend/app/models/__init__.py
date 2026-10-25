"""Import every model here so metadata includes all tables."""

from app.models.account import Account, AccountRole, AuthSession
from app.models.audit import AuditLog
from app.models.content_block import ContentBlock
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
from app.models.resource import Resource, ResourceTag, ResourceTagLink
from app.models.shift import Shift, ShiftEndReason
from app.models.site_setting import SiteSetting

__all__ = [
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
    "Resource",
    "ResourceTag",
    "ResourceTagLink",
    "SiteSetting",
    "Shift",
    "ShiftEndReason",
    "Texter",
]
