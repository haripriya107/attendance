from contextlib import contextmanager
from pathlib import Path

from flask import current_app, has_app_context
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.pool import StaticPool

from backend.postgres import (
    create_postgres_engine,
    normalize_postgres_url,
    validate_test_database_url,
    validate_test_schema_name,
)


DATABASE_ENGINE_EXTENSION = "database_engine"
SQLITE_BUSY_TIMEOUT_MS = 30000


def _database_url(database_url, is_production):
    if database_url is None or not str(database_url).strip():
        if is_production:
            raise RuntimeError("DATABASE_URL must be configured for production.")
        database_path = Path(__file__).with_name("attendance.db").resolve()
        if not database_path.is_file():
            raise RuntimeError(f"Local SQLite database not found: {database_path}")
        return URL.create(
            "sqlite+pysqlite",
            database=str(database_path),
        )

    try:
        url = database_url if isinstance(database_url, URL) else make_url(database_url)
    except (ArgumentError, TypeError, ValueError):
        raise ValueError("DATABASE_URL must be a valid SQLAlchemy database URL.") from None

    if url.get_backend_name() == "postgresql":
        return normalize_postgres_url(url)
    if url.get_backend_name() == "sqlite" and url.drivername in (
        "sqlite",
        "sqlite+pysqlite",
    ):
        return url
    raise ValueError("DATABASE_URL must use SQLite or PostgreSQL.")


def _create_sqlite_engine(url):
    engine_options = {
        "connect_args": {
            "check_same_thread": False,
            "timeout": SQLITE_BUSY_TIMEOUT_MS / 1000,
        },
        "echo": False,
    }
    if url.database in (None, "", ":memory:"):
        engine_options["poolclass"] = StaticPool

    engine = create_engine(url, **engine_options)

    @event.listens_for(engine, "connect")
    def configure_sqlite_connection(connection, record):
        del record
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
        finally:
            cursor.close()

    return engine


def init_database_engine(app, database_url=None):
    existing = app.extensions.get(DATABASE_ENGINE_EXTENSION)
    if existing is not None:
        return existing

    url = _database_url(database_url, app.config.get("IS_PRODUCTION", False))
    if url.get_backend_name() == "postgresql":
        connect_args = None
        if app.testing:
            test_url = validate_test_database_url(url)
            schema_name = validate_test_schema_name(
                app.config.get("POSTGRES_TEST_SCHEMA")
            )
            url = test_url
            connect_args = {"options": f"-csearch_path={schema_name}"}
        engine = create_postgres_engine(url, connect_args=connect_args)
    else:
        engine = _create_sqlite_engine(url)

    app.extensions[DATABASE_ENGINE_EXTENSION] = engine
    return engine


def get_database_engine():
    if not has_app_context():
        raise RuntimeError("A Flask application context is required for database access.")
    engine = current_app.extensions.get(DATABASE_ENGINE_EXTENSION)
    if engine is None:
        raise RuntimeError("The database engine has not been initialized for this app.")
    return engine


@contextmanager
def database_connection():
    with get_database_engine().connect() as connection:
        yield connection


@contextmanager
def database_transaction():
    with get_database_engine().begin() as connection:
        yield connection


def execute(connection, statement, parameters=None):
    return connection.execute(text(statement), parameters or {})


def fetch_one(connection, statement, parameters=None):
    return execute(connection, statement, parameters).mappings().first()


def fetch_all(connection, statement, parameters=None):
    return execute(connection, statement, parameters).mappings().all()


def for_update_clause():
    return " FOR UPDATE" if get_database_engine().dialect.name == "postgresql" else ""


def dispose_database_engine(app):
    engine = app.extensions.pop(DATABASE_ENGINE_EXTENSION, None)
    if engine is not None:
        engine.dispose()
