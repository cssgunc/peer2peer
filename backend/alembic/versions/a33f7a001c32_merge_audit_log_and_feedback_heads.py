"""merge audit_log and feedback heads

Revision ID: a33f7a001c32
Revises: 49f96d34e9bb, 64cadcc79c33
Create Date: 2026-10-21 16:45:25.597509

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "a33f7a001c32"
down_revision: str | Sequence[str] | None = ("49f96d34e9bb", "64cadcc79c33")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
