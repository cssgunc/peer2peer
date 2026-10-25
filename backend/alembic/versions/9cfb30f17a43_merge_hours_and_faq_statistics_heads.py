"""merge hours and FAQ statistics heads

Revision ID: 9cfb30f17a43
Revises: 4480022af87b, 880d8ffe73a3
Create Date: 2026-10-25 14:20:26.939228

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "9cfb30f17a43"
down_revision: str | Sequence[str] | None = ("4480022af87b", "880d8ffe73a3")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
