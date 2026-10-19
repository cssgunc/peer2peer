"""The only place message bodies are encrypted or decrypted (TDD 4.6.7).

Keeping decryption here makes every use of plaintext easy to find. Never log the body.
"""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Conversation, Message, MessageSender
from app.security.encryption import KeyPurpose, decrypt, encrypt


def add_message(
    db: Session,
    conversation: Conversation,
    sender: MessageSender,
    body: str,
    now: datetime,
    sender_account_id: uuid.UUID | None = None,
) -> Message:
    ciphertext, key_version = encrypt(body, KeyPurpose.MESSAGE)
    message = Message(
        conversation_id=conversation.id,
        sender=sender,
        sender_account_id=sender_account_id,
        body_ciphertext=ciphertext,
        key_version=key_version,
        created_at=now,
    )
    conversation.message_count += 1
    conversation.last_message_at = now
    db.add(message)
    db.flush()
    return message


def message_body(message: Message) -> str:
    return decrypt(message.body_ciphertext, message.key_version, KeyPurpose.MESSAGE)
