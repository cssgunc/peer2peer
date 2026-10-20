"""Audit staff actions in the caller's transaction.

Only include safe metadata such as changed field names, never whole rows, message content,
or texter-identifying data. Key validation is a guardrail, not a substitute for this rule.
"""

import re
import uuid
from copy import deepcopy
from enum import StrEnum
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


class AuditAction(StrEnum):
    ACCOUNT_CREATE = "account.create"
    ACCOUNT_UPDATE = "account.update"
    ACCOUNT_DEACTIVATE = "account.deactivate"
    ACCOUNT_RESET_PASSWORD = "account.reset_password"
    SETTINGS_UPDATE = "settings.update"
    CONTENT_UPDATE = "content.update"
    HOURS_UPDATE = "hours.update"
    HOURS_EXCEPTION_CREATE = "hours_exception.create"
    HOURS_EXCEPTION_UPDATE = "hours_exception.update"
    HOURS_EXCEPTION_DELETE = "hours_exception.delete"
    REPORT_OPTION_CREATE = "report_option.create"
    REPORT_OPTION_UPDATE = "report_option.update"
    FEEDBACK_DELETE = "feedback.delete"
    ESCALATION_CREATE = "escalation.create"
    ESCALATION_VIEW = "escalation.view"
    FAQ_CREATE = "faq.create"
    FAQ_UPDATE = "faq.update"
    FAQ_DELETE = "faq.delete"
    STATISTIC_CREATE = "statistic.create"
    STATISTIC_UPDATE = "statistic.update"
    STATISTIC_DELETE = "statistic.delete"
    FIT_GUIDE_CREATE = "fit_guide.create"
    FIT_GUIDE_UPDATE = "fit_guide.update"
    FIT_GUIDE_DELETE = "fit_guide.delete"
    RESOURCE_CREATE = "resource.create"
    RESOURCE_UPDATE = "resource.update"
    RESOURCE_DELETE = "resource.delete"
    RESOURCE_TAG_CREATE = "resource_tag.create"
    RESOURCE_TAG_UPDATE = "resource_tag.update"
    RESOURCE_TAG_DELETE = "resource_tag.delete"


_BLOCKED_PARTS = {"body", "message", "phone", "ip", "password", "token"}


def _validate_details(value: Any) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            # Split snake_case, punctuation, and camelCase without matching "ip" in "description".
            words = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(key))
            parts = re.findall(r"[a-z0-9]+", words.lower())
            if _BLOCKED_PARTS.intersection(parts) or "identityhash" in "".join(parts):
                raise ValueError("Audit details contain a potentially sensitive key")
            _validate_details(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            _validate_details(nested)


def record_audit(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    action: AuditAction,
    target_type: str,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Add an audit entry without committing; the caller owns the transaction."""
    _validate_details(details)
    entry = AuditLog(
        actor_account_id=actor_id,
        action=action.value,
        target_type=target_type,
        target_id=target_id,
        details=deepcopy(details) if details is not None else {},
    )
    db.add(entry)
    return entry
