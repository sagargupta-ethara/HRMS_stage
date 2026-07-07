"""position email approval tokens and leadership status cleanup

Revision ID: 7b4e2d1c9a6f
Revises: 0d9f3c6a1b7e
Create Date: 2026-05-27 17:35:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7b4e2d1c9a6f"
down_revision: str | Sequence[str] | None = "0d9f3c6a1b7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("positions", sa.Column("approvalRecipientEmail", sa.String(length=255), nullable=True))
    op.add_column("positions", sa.Column("reviewedByEmail", sa.String(length=255), nullable=True))
    op.add_column("positions", sa.Column("approvalTokenHash", sa.String(length=64), nullable=True))
    op.add_column("positions", sa.Column("approvalTokenExpiresAt", sa.DateTime(timezone=True), nullable=True))

    positions = sa.sql.table(
        "positions",
        sa.Column("approvalStatus", sa.String(length=50)),
        sa.Column("postedAt", sa.DateTime(timezone=True)),
        sa.Column("isActive", sa.Boolean()),
    )

    op.execute(
        positions.update()
        .where(positions.c.approvalStatus == sa.literal("pending_approval"))
        .values({"approvalStatus": sa.literal("pending_leadership_approval")})
    )
    op.execute(
        positions.update()
        .where(positions.c.approvalStatus == sa.literal("approved"))
        .values({"approvalStatus": sa.literal("posted")})
    )
    op.execute(
        positions.update()
        .where(
            sa.and_(
                sa.or_(positions.c.approvalStatus.is_(None), positions.c.approvalStatus == sa.literal("draft")),
                positions.c.isActive.is_(True),
                positions.c.postedAt.is_not(None),
            )
        )
        .values({"approvalStatus": sa.literal("posted")})
    )
    op.execute(
        positions.update()
        .where(positions.c.approvalStatus.is_(None))
        .values({"approvalStatus": sa.literal("draft")})
    )


def downgrade() -> None:
    positions = sa.sql.table(
        "positions",
        sa.Column("approvalStatus", sa.String(length=50)),
    )

    op.execute(
        positions.update()
        .where(positions.c.approvalStatus == sa.literal("pending_leadership_approval"))
        .values({"approvalStatus": sa.literal("pending_approval")})
    )
    op.execute(
        positions.update()
        .where(positions.c.approvalStatus == sa.literal("posted"))
        .values({"approvalStatus": sa.literal("approved")})
    )

    op.drop_column("positions", "approvalTokenExpiresAt")
    op.drop_column("positions", "approvalTokenHash")
    op.drop_column("positions", "reviewedByEmail")
    op.drop_column("positions", "approvalRecipientEmail")
