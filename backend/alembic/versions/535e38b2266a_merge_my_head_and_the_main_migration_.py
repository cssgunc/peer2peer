"""Merge my head and the main migration head

Revision ID: 535e38b2266a
Revises: 4480022af87b, cefeb0403238
Create Date: 2026-10-25 01:05:28.332533

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "535e38b2266a"
down_revision: str | Sequence[str] | None = ("4480022af87b", "cefeb0403238")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
