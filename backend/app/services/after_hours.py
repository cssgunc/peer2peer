"""The auto-reply a texter gets when nobody is on shift (TDD 4.6.5).

"Online" means a responder is on shift, not that it's within posted hours. The reply goes out once,
on the message that opens a conversation; the `after_hours_behavior` setting decides whether the
conversation then closes or stays queued for the next shift.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.channels import ADAPTERS
from app.config import get_settings
from app.events import CONVERSATION_CLOSED, publish_after_commit, run_after_commit, texter_topic
from app.models import ClosedBy, Conversation, ConversationStatus, Message, MessageSender
from app.services.content_blocks import get_block
from app.services.hours import next_open_at
from app.services.messages import add_message
from app.services.resources import list_resources
from app.services.schedule import load_schedule
from app.services.shifts import is_line_online
from app.services.site_settings import get_setting

NO_NEXT_OPEN = "when we reopen"

# The same fallback as the public footer, so the reply always has crisis numbers.
FALLBACK_CRISIS_LINES = ["Emergency Services: 911", "988 Suicide & Crisis Lifeline: 988"]


def handle_after_hours(
    db: Session, conversation: Conversation, is_new_conversation: bool, now: datetime
) -> Message | None:
    """Reply once to a new conversation while the line is offline; return the reply, if any."""
    if not is_new_conversation or is_line_online(db, now):
        return None

    conversation.opened_after_hours = True
    message = add_message(db, conversation, MessageSender.SYSTEM, after_hours_body(db, now), now)
    adapter = ADAPTERS[conversation.channel]
    run_after_commit(db, lambda: adapter.send(conversation, message))

    if get_setting(db, "after_hours_behavior") == "close":
        conversation.status = ConversationStatus.CLOSED
        conversation.closed_at = now
        conversation.closed_by = ClosedBy.SYSTEM
        # Queued after the send, so the texter sees the reply before the chat ends.
        if conversation.texter_id is not None:
            publish_after_commit(
                db,
                texter_topic(conversation.texter_id),
                {
                    "type": CONVERSATION_CLOSED,
                    "data": {
                        "conversation_id": str(conversation.id),
                        "closed_by": ClosedBy.SYSTEM.value,
                    },
                },
            )
    db.flush()
    return message


def after_hours_body(db: Session, now: datetime) -> str:
    """The `chat.after-hours` block with `{next_open}` filled in, then the crisis resources."""
    # replace, not format: coordinators edit this text and may type other braces.
    body = get_block(db, "chat.after-hours").body_md.replace(
        "{next_open}", format_next_open(next_open_at(load_schedule(db), now))
    )
    crisis_lines = [
        f"{resource.name}: {resource.phone}"
        for resource in list_resources(db)
        if resource.is_crisis and resource.phone
    ]
    return body + "\n\n" + "\n".join(crisis_lines or FALLBACK_CRISIS_LINES)


def format_next_open(at: datetime | None) -> str:
    """Like "Tuesday, Oct 20 at 7:00 PM" in the line's time zone."""
    if at is None:
        return NO_NEXT_OPEN
    local = at.astimezone(ZoneInfo(get_settings().line_timezone))
    # Built by hand because strftime's %-d and %-I aren't portable.
    hour = local.hour % 12 or 12
    return f"{local:%A, %b} {local.day} at {hour}:{local:%M %p}"
