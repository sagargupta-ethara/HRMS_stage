"""auth_hardening_token_version_lockout_otp

Security hardening for authentication:
  * users.tokenVersion     — access-token revocation counter (claim "tv")
  * users.failedLoginCount — consecutive failed password attempts
  * users.lockedUntil      — temporary account-lockout expiry
  * authCodes.attemptCount — wrong-guess counter for OTP brute-force protection

All integer columns carry a server_default so existing rows backfill to 0.

Revision ID: b3d4f6a8c2e1
Revises: a7b8c9d0e1f2
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b3d4f6a8c2e1"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("tokenVersion", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("failedLoginCount", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("lockedUntil", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "auth_codes",
        sa.Column("attemptCount", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("auth_codes", "attemptCount")
    op.drop_column("users", "lockedUntil")
    op.drop_column("users", "failedLoginCount")
    op.drop_column("users", "tokenVersion")
