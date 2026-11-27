"""Create the PostgreSQL baseline schema.

Revision ID: 0001_postgresql_baseline
Revises:
Create Date: 2026-11-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_postgresql_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "employees",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default=sa.text("'employee'"), nullable=False),
        sa.Column("department", sa.Text()),
        sa.Column("employee_code", sa.Text()),
        sa.Column("phone", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("position", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("joining_date", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column(
            "employment_type",
            sa.Text(),
            server_default=sa.text("'Full-time'"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.UniqueConstraint("email", name="uq_employees_email"),
    )
    op.create_index(
        "idx_employees_employee_code",
        "employees",
        ["employee_code"],
        unique=True,
    )

    op.create_table(
        "attendance",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "employee_id",
            sa.BigInteger(),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("date", sa.Text(), nullable=False),
        sa.Column("check_in", sa.Text()),
        sa.Column("check_out", sa.Text()),
        sa.Column("status", sa.Text(), server_default=sa.text("'Present'"), nullable=False),
        sa.UniqueConstraint("employee_id", "date", name="uq_attendance_employee_date"),
    )

    op.create_table(
        "leaves",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "employee_id",
            sa.BigInteger(),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("from_date", sa.Text(), nullable=False),
        sa.Column("to_date", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'Pending'"), nullable=False),
        sa.Column("created_at", sa.Text(), server_default=sa.text("''"), nullable=False),
    )

    op.create_table(
        "departments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("department_name", sa.Text(), nullable=False),
        sa.UniqueConstraint("department_name", name="uq_departments_department_name"),
    )

    op.create_table(
        "office_location_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("latitude", sa.Float(precision=53)),
        sa.Column("longitude", sa.Float(precision=53)),
        sa.Column(
            "radius_meters",
            sa.Float(precision=53),
            server_default=sa.text("200"),
            nullable=False,
        ),
        sa.Column("address", sa.Text(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_office_location_settings_singleton"),
        sa.CheckConstraint("radius_meters > 0", name="ck_office_location_radius_positive"),
        sa.CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
            name="ck_office_location_coordinates",
        ),
    )

    office_location_settings = sa.table(
        "office_location_settings",
        sa.column("id", sa.SmallInteger()),
        sa.column("latitude", sa.Float()),
        sa.column("longitude", sa.Float()),
        sa.column("radius_meters", sa.Float()),
        sa.column("address", sa.Text()),
    )
    op.bulk_insert(
        office_location_settings,
        [{
            "id": 1,
            "latitude": None,
            "longitude": None,
            "radius_meters": 200,
            "address": (
                "Fyno Digital Marketing, 3rd Floor, TRB Complex, 76/18, 1st Street, "
                "Sarvamangala Colony, opposite Ashok Pillar, Ashok Nagar, Chennai - "
                "600083, Tamil Nadu, India"
            ),
        }],
    )


def downgrade():
    raise RuntimeError(
        "Destructive downgrades are disabled; use a separately reviewed recovery plan."
    )
