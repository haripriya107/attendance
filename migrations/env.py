import os

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from backend.postgres import (
    normalize_postgres_url,
    validate_test_database_url,
    validate_test_schema_name,
)


config = context.config


def run_migrations_online():
    test_database_url = os.environ.get("ATTENDANCE_TEST_DATABASE_URL", "").strip()
    test_schema = os.environ.get("ATTENDANCE_TEST_SCHEMA", "").strip()
    connect_args = None

    if test_database_url:
        url = validate_test_database_url(test_database_url)
        if test_schema:
            test_schema = validate_test_schema_name(test_schema)
            connect_args = {"options": f"-csearch_path={test_schema}"}
    else:
        if test_schema:
            raise RuntimeError(
                "ATTENDANCE_TEST_SCHEMA requires ATTENDANCE_TEST_DATABASE_URL."
            )
        raw_url = os.environ.get("DATABASE_URL", "").strip()
        if not raw_url:
            raise RuntimeError("Set DATABASE_URL before running Alembic.")
        url = normalize_postgres_url(raw_url)

    engine_options = {
        "poolclass": NullPool,
        "pool_pre_ping": True,
        "echo": False,
    }
    if connect_args is not None:
        engine_options["connect_args"] = connect_args
    engine = create_engine(url, **engine_options)
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=None,
                transaction_per_migration=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


run_migrations_online()
