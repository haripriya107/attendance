import hashlib
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.engine import URL

from backend.database import DATABASE_ENGINE_EXTENSION


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SQLITE_DATABASE = PROJECT_ROOT / "backend" / "attendance.db"


class SQLiteDatabaseTests(unittest.TestCase):
    def create_app(self, config):
        with patch.dict(os.environ, {
            "DATABASE_URL": "",
            "RENDER": "",
            "FLASK_ENV": "",
            "FLASK_SECRET_KEY": "",
        }):
            from backend.app import create_app

            return create_app(config)

    def test_local_default_uses_existing_sqlite_file_without_modifying_it(self):
        self.assertTrue(SQLITE_DATABASE.is_file())
        before = hashlib.sha256(SQLITE_DATABASE.read_bytes()).hexdigest()

        app = self.create_app({
            "TESTING": True,
            "SECRET_KEY": "sqlite-test-secret",
        })
        try:
            engine = app.extensions[DATABASE_ENGINE_EXTENSION]
            self.assertEqual(Path(engine.url.database), SQLITE_DATABASE)
            response = app.test_client().get("/api/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["status"], "success")
        finally:
            app.extensions[DATABASE_ENGINE_EXTENSION].dispose()

        after = hashlib.sha256(SQLITE_DATABASE.read_bytes()).hexdigest()
        self.assertEqual(after, before)

    def test_sqlite_engine_applies_foreign_key_and_busy_timeout_settings(self):
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            database_url = URL.create(
                "sqlite+pysqlite",
                database=str(Path(directory) / "attendance.db"),
            )
            app = self.create_app({
                "TESTING": True,
                "SECRET_KEY": "sqlite-test-secret",
                "DATABASE_URL": database_url,
            })
            try:
                with app.extensions[DATABASE_ENGINE_EXTENSION].connect() as connection:
                    self.assertEqual(
                        connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one(),
                        1,
                    )
                    self.assertEqual(
                        connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one(),
                        30000,
                    )
            finally:
                app.extensions[DATABASE_ENGINE_EXTENSION].dispose()


if __name__ == "__main__":
    unittest.main()
