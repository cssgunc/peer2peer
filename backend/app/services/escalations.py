"""The only place escalation payloads are encrypted or decrypted (TDD 4.6.7).

Payloads use their own key (KeyPurpose.ESCALATION), so a leaked message key can't read them.
Decrypt only in the coordinator detail route. Never log or audit the payload.
"""

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import Account, Conversation, Escalation, EscalationStatus
from app.security.encryption import KeyPurpose, decrypt, encrypt


def create_escalation(db: Session, conversation: Conversation, account: Account) -> Escalation:
    # TODO(escalation-protocol): what the payload holds waits on the CAPS protocol and privacy
    # policy. Until then it only records where the escalation came from.
    payload: dict[str, Any] = {"source": "portal"}
    ciphertext, key_version = encrypt(json.dumps(payload), KeyPurpose.ESCALATION)
    escalation = Escalation(
        conversation_id=conversation.id,
        created_by_account_id=account.id,
        status=EscalationStatus.OPEN,
        protected_payload=ciphertext,
        key_version=key_version,
    )
    db.add(escalation)
    db.flush()
    return escalation


def escalation_payload(escalation: Escalation) -> dict[str, Any] | None:
    if escalation.protected_payload is None or escalation.key_version is None:
        return None
    plaintext = decrypt(escalation.protected_payload, escalation.key_version, KeyPurpose.ESCALATION)
    return json.loads(plaintext)
