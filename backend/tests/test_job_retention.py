import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.jobs import purge_expired_content
from app.models import (
    Account,
    AuthSession,
    Channel,
    ClosedBy,
    Conversation,
    ConversationReport,
    ConversationStatus,
    Escalation,
    EscalationStatus,
    FeedbackSubmission,
    Message,
    MessageSender,
    ReportOption,
    ReportOptionKind,
    Texter,
)
from app.services.site_settings import set_setting
from tests.test_sessions import make_account

NOW = datetime(2026, 11, 7, 18, tzinfo=UTC)
MESSAGE_CUTOFF = NOW - timedelta(days=30)
STEP = timedelta(microseconds=1)


def make_texter(db: Session) -> Texter:
    texter = Texter(channel=Channel.WEB, identity_hash=secrets.token_bytes(32), last_seen_at=NOW)
    db.add(texter)
    db.flush()
    return texter


def make_closed_conversation(
    db: Session,
    closed_at: datetime | None,
    texter: Texter | None = None,
    *,
    messages: int = 2,
) -> Conversation:
    conversation = Conversation(
        channel=Channel.WEB,
        texter_id=texter.id if texter else None,
        opened_at=(closed_at or NOW) - timedelta(hours=1),
        status=ConversationStatus.CLOSED if closed_at else ConversationStatus.ACTIVE,
        closed_at=closed_at,
        closed_by=ClosedBy.TEXTER if closed_at else None,
        message_count=messages,
    )
    db.add(conversation)
    db.flush()
    for _ in range(messages):
        db.add(
            Message(
                conversation_id=conversation.id,
                sender=MessageSender.TEXTER,
                body_ciphertext=b"ciphertext",
                key_version=1,
            )
        )
    db.flush()
    return conversation


def message_count(db: Session, conversation: Conversation) -> int:
    return db.scalars(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id)
    ).one()


def make_escalation(
    db: Session, conversation: Conversation, account: Account, status: EscalationStatus
) -> Escalation:
    escalation = Escalation(
        conversation_id=conversation.id, created_by_account_id=account.id, status=status
    )
    db.add(escalation)
    db.flush()
    return escalation


def make_auth_session(db: Session, account: Account, expires_at: datetime) -> AuthSession:
    session = AuthSession(
        account_id=account.id,
        token_hash=secrets.token_bytes(32),
        last_seen_at=expires_at - timedelta(hours=1),
        expires_at=expires_at,
    )
    db.add(session)
    db.flush()
    return session


def test_purges_conversation_just_past_cutoff_but_not_just_inside(db: Session) -> None:
    texter_past, texter_inside = make_texter(db), make_texter(db)
    past = make_closed_conversation(db, MESSAGE_CUTOFF - STEP, texter_past)
    inside = make_closed_conversation(db, MESSAGE_CUTOFF, texter_inside)

    assert purge_expired_content(db, NOW) == 1

    db.refresh(past)
    db.refresh(inside)
    assert message_count(db, past) == 0
    assert past.texter_id is None
    assert past.messages_purged_at == NOW
    assert db.get(Texter, texter_past.id) is None

    assert message_count(db, inside) == 2
    assert inside.texter_id == texter_inside.id
    assert inside.messages_purged_at is None
    assert db.get(Texter, texter_inside.id) is not None


def test_retention_period_comes_from_the_setting(db: Session) -> None:
    conversation = make_closed_conversation(db, NOW - timedelta(days=10))
    assert purge_expired_content(db, NOW) == 0

    set_setting(db, "message_retention_days", 7, None)
    assert purge_expired_content(db, NOW) == 1
    assert message_count(db, conversation) == 0


def test_open_escalation_keeps_messages_until_it_closes(db: Session) -> None:
    account = make_account(db)
    texter = make_texter(db)
    conversation = make_closed_conversation(db, MESSAGE_CUTOFF - timedelta(days=1), texter)
    escalation = make_escalation(db, conversation, account, EscalationStatus.HANDED_OFF)

    assert purge_expired_content(db, NOW) == 0
    db.refresh(conversation)
    assert message_count(db, conversation) == 2
    assert conversation.texter_id == texter.id
    assert conversation.messages_purged_at is None

    escalation.status = EscalationStatus.CLOSED
    db.flush()
    assert purge_expired_content(db, NOW) == 1
    assert message_count(db, conversation) == 0


def test_conversation_and_report_rows_survive(db: Session) -> None:
    account = make_account(db)
    conversation = make_closed_conversation(db, MESSAGE_CUTOFF - timedelta(days=1))
    outcome = ReportOption(
        kind=ReportOptionKind.OUTCOME, label="Resolved", display_order=1, is_active=True
    )
    db.add(outcome)
    db.flush()
    report = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=4,
        submitted_at=MESSAGE_CUTOFF,
    )
    db.add(report)
    db.flush()

    assert purge_expired_content(db, NOW) == 1

    db.refresh(conversation)
    assert conversation.message_count == 2
    assert conversation.closed_at == MESSAGE_CUTOFF - timedelta(days=1)
    assert db.get(ConversationReport, report.id) is not None


def test_texter_with_another_live_conversation_is_kept(db: Session) -> None:
    texter = make_texter(db)
    old = make_closed_conversation(db, MESSAGE_CUTOFF - timedelta(days=1), texter)
    make_closed_conversation(db, None, texter)

    assert purge_expired_content(db, NOW) == 1

    db.refresh(old)
    assert old.texter_id is None
    assert db.get(Texter, texter.id) is not None


def test_new_texter_without_a_conversation_is_kept(db: Session) -> None:
    texter = make_texter(db)
    make_closed_conversation(db, MESSAGE_CUTOFF - timedelta(days=1), make_texter(db))

    purge_expired_content(db, NOW)

    assert db.get(Texter, texter.id) is not None


def test_running_twice_matches_running_once(db: Session) -> None:
    texter = make_texter(db)
    conversation = make_closed_conversation(db, MESSAGE_CUTOFF - timedelta(days=1), texter)

    assert purge_expired_content(db, NOW) == 1
    assert purge_expired_content(db, NOW + timedelta(minutes=1)) == 0

    db.refresh(conversation)
    assert conversation.messages_purged_at == NOW
    assert message_count(db, conversation) == 0


def test_deletes_expired_sessions_and_old_feedback(db: Session) -> None:
    account = make_account(db)
    expired = make_auth_session(db, account, NOW - STEP)
    current = make_auth_session(db, account, NOW)
    feedback_cutoff = NOW - timedelta(days=365)
    old_feedback = FeedbackSubmission(body="old", created_at=feedback_cutoff - STEP)
    recent_feedback = FeedbackSubmission(body="recent", created_at=feedback_cutoff)
    db.add_all([old_feedback, recent_feedback])
    db.flush()

    purge_expired_content(db, NOW)

    db.expire_all()
    assert db.get(AuthSession, expired.id) is None
    assert db.get(AuthSession, current.id) is not None
    assert db.get(FeedbackSubmission, old_feedback.id) is None
    assert db.get(FeedbackSubmission, recent_feedback.id) is not None
