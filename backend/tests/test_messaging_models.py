import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Channel, Conversation, Message, MessageSender, Texter
from app.services.messages import add_message, message_body


def make_conversation(db: Session) -> tuple[Texter, Conversation]:
    now = datetime.now(UTC)
    texter = Texter(
        channel=Channel.WEB,
        identity_hash=hashlib.sha256(b"session-token").digest(),
        last_seen_at=now,
    )
    db.add(texter)
    db.flush()
    conversation = Conversation(texter_id=texter.id, channel=Channel.WEB, opened_at=now)
    db.add(conversation)
    db.flush()
    return texter, conversation


def test_body_round_trips_and_is_not_stored_as_plaintext(db: Session) -> None:
    _, conversation = make_conversation(db)
    message = add_message(db, conversation, MessageSender.TEXTER, "I'm okay 🙂", datetime.now(UTC))

    assert message_body(message) == "I'm okay 🙂"
    assert "I'm okay 🙂".encode() not in message.body_ciphertext


def test_add_message_updates_count_and_last_message_at(db: Session) -> None:
    _, conversation = make_conversation(db)
    first = datetime.now(UTC)
    second = first + timedelta(minutes=1)
    add_message(db, conversation, MessageSender.TEXTER, "hi", first)
    add_message(db, conversation, MessageSender.SYSTEM, "hello", second)
    db.refresh(conversation)

    assert conversation.message_count == 2
    assert conversation.last_message_at == second


def test_deleting_texter_keeps_conversation(db: Session) -> None:
    texter, conversation = make_conversation(db)
    db.delete(texter)
    db.flush()
    db.refresh(conversation)

    assert conversation.texter_id is None


def test_deleting_conversation_deletes_messages(db: Session) -> None:
    _, conversation = make_conversation(db)
    add_message(db, conversation, MessageSender.TEXTER, "hi", datetime.now(UTC))
    db.delete(conversation)
    db.flush()
    db.expunge_all()

    assert db.scalar(select(func.count()).select_from(Message)) == 0
