import os
import re
from contextlib import contextmanager

from flask import current_app, has_app_context
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


POSTGRES_ENGINE_EXTENSION = "postgres_engine"
TEST_DATABASE_NAME = "attendance_test"
TEST_DATABASE_USERNAME = "attendance_test_user"
TEST_DATABASE_HOST = "127.0.0.1"
TEST_DATABASE_PORT = 5432


def validate_test_database_url(database_url):
    has_url_delimiter = (
        isinstance(database_url, str)
        and ("?" in database_url or "#" in database_url)
    )
    try:
        url = database_url if isinstance(database_url, URL) else make_url(database_url)
        port = url.port
    except (ArgumentError, TypeError, ValueError):
        raise ValueError("ATTENDANCE_TEST_DATABASE_URL must be a valid PostgreSQL test URL.") from None

    if has_url_delimiter or url.query:
        raise ValueError("ATTENDANCE_TEST_DATABASE_URL must not include query parameters or fragments.")
    if url.drivername != "postgresql+psycopg":
        raise ValueError("ATTENDANCE_TEST_DATABASE_URL must use postgresql+psycopg.")
    if (
        url.host != TEST_DATABASE_HOST
        or port != TEST_DATABASE_PORT
        or url.database != TEST_DATABASE_NAME
        or url.username != TEST_DATABASE_USERNAME
    ):
        raise ValueError(
            "ATTENDANCE_TEST_DATABASE_URL must target the approved local attendance_test role and endpoint."
        )
    return url


def validate_test_schema_name(schema_name):
    if not isinstance(schema_name, str) or re.fullmatch(
        r"test_[0-9a-f]{32}", schema_name
    ) is None:
        raise ValueError("PostgreSQL test schema must be a generated test UUID name.")
    return schema_name


def normalize_postgres_url(database_url):
    try:
        url = database_url if isinstance(database_url, URL) else make_url(database_url)
    except (ArgumentError, TypeError):
        raise ValueError("DATABASE_URL must be a valid PostgreSQL URL.") from None

    if url.drivername not in ("postgres", "postgresql", "postgresql+psycopg"):
        raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver.")
    if not url.host or not url.database:
        raise ValueError("DATABASE_URL must include a PostgreSQL host and database name.")
    return url.set(drivername="postgresql+psycopg")


def database_url_from_environment():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("Set DATABASE_URL before initializing PostgreSQL.")
    return normalize_postgres_url(database_url)


def _pool_setting(name, default, minimum):
    value = os.environ.get(name, str(default))
    try:
        parsed = int(value)
    except ValueError:
        raise RuntimeError(f"{name} must be an integer.") from None
    if parsed < minimum:
        raise RuntimeError(f"{name} must be at least {minimum}.")
    return parsed


def create_postgres_engine(database_url=None, connect_args=None):
    url = normalize_postgres_url(database_url) if database_url else database_url_from_environment()
    engine_options = {
        "pool_size": _pool_setting("DATABASE_POOL_SIZE", 4, 1),
        "max_overflow": _pool_setting("DATABASE_MAX_OVERFLOW", 0, 0),
        "pool_timeout": _pool_setting("DATABASE_POOL_TIMEOUT", 30, 1),
        "pool_recycle": _pool_setting("DATABASE_POOL_RECYCLE", 1800, 0),
        "pool_pre_ping": True,
        "echo": False,
    }
    if connect_args is not None:
        engine_options["connect_args"] = connect_args
    return create_engine(url, **engine_options)


def init_postgres_engine(app, database_url=None):
    if app.testing:
        url = validate_test_database_url(database_url)
        schema_name = validate_test_schema_name(
            app.config.get("POSTGRES_TEST_SCHEMA")
        )
        existing = app.extensions.get(POSTGRES_ENGINE_EXTENSION)
        if existing is not None:
            return existing
        engine = create_postgres_engine(
            url,
            connect_args={"options": f"-csearch_path={schema_name}"},
        )
        app.extensions[POSTGRES_ENGINE_EXTENSION] = engine
        return engine
    existing = app.extensions.get(POSTGRES_ENGINE_EXTENSION)
    if existing is not None:
        return existing
    engine = create_postgres_engine(database_url)
    app.extensions[POSTGRES_ENGINE_EXTENSION] = engine
    return engine


def get_postgres_engine():
    if not has_app_context():
        raise RuntimeError("A Flask application context is required for PostgreSQL access.")
    engine = current_app.extensions.get(POSTGRES_ENGINE_EXTENSION)
    if engine is None:
        raise RuntimeError("The PostgreSQL engine has not been initialized for this app.")
    return engine


@contextmanager
def postgres_connection():
    with get_postgres_engine().connect() as connection:
        yield connection


@contextmanager
def postgres_transaction():
    with get_postgres_engine().begin() as connection:
        yield connection


def execute(connection, statement, parameters=None):
    return connection.execute(text(statement), parameters or {})


def fetch_one(connection, statement, parameters=None):
    return execute(connection, statement, parameters).mappings().first()


def fetch_all(connection, statement, parameters=None):
    return execute(connection, statement, parameters).mappings().all()


def dispose_postgres_engine(app):
    engine = app.extensions.pop(POSTGRES_ENGINE_EXTENSION, None)
    if engine is not None:
        engine.dispose()
