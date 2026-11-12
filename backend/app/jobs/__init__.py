"""Timer-driven cleanup. Jobs flush only; their caller owns the transaction.

Each return value counts primary targets (shifts, sessions, or conversations), not
additional rows changed by ending a shift or reassigning a conversation.
"""

from app.jobs.conversations import close_inactive_conversations
from app.jobs.retention import purge_expired_content
from app.jobs.sessions import close_idle_sessions
from app.jobs.shifts import close_lost_shifts

__all__ = [
    "close_idle_sessions",
    "close_inactive_conversations",
    "close_lost_shifts",
    "purge_expired_content",
]
