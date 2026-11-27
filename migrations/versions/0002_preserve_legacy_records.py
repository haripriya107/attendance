"""Add SQLite tables missing from the original PostgreSQL baseline.

Revision ID: 0002_preserve_legacy_records
Revises: 0001_postgresql_baseline
Create Date: 2026-11-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_preserve_legacy_records"
down_revision = "0001_postgresql_baseline"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "announcements",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_by",
            sa.BigInteger(),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.Text(), nullable=False),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "employee_id",
            sa.BigInteger(),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("notification_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column(
            "is_read",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "notification_type IN ("
            "'check_in_reminder', 'check_in_success', 'check_out_success', "
            "'leave_request_submitted', 'leave_approved', 'leave_rejected', "
            "'attendance_milestone', 'admin_announcement', 'account_update'"
            ")",
            name="ck_notifications_notification_type",
        ),
        sa.UniqueConstraint("event_key", name="uq_notifications_event_key"),
    )
    op.create_index(
        "idx_notifications_employee_unread",
        "notifications",
        ["employee_id", "is_read"],
    )
    op.create_index(
        "idx_notifications_employee_created",
        "notifications",
        ["employee_id", "created_at", "id"],
    )


def downgrade():
    raise RuntimeError(
        "Destructive downgrades are disabled; use a separately reviewed recovery plan."
    )
