import importlib.util
import unittest


POSTGRES_DEPENDENCIES_AVAILABLE = all(
    importlib.util.find_spec(module_name) is not None
    for module_name in ("sqlalchemy", "psycopg")
)

if POSTGRES_DEPENDENCIES_AVAILABLE:
    from backend.postgres import (
        create_postgres_engine,
        normalize_postgres_url,
        validate_test_database_url,
        validate_test_schema_name,
    )


@unittest.skipUnless(
    POSTGRES_DEPENDENCIES_AVAILABLE,
    "Install the declared PostgreSQL dependencies to run these unit checks.",
)
class PostgresLayerConfigurationTests(unittest.TestCase):
    def test_postgres_urls_use_psycopg_and_hide_passwords_when_rendered(self):
        url = normalize_postgres_url(
            "postgres://attendance_user:private-value@db.example/attendance"
        )
        self.assertEqual(url.drivername, "postgresql+psycopg")
        self.assertNotIn("private-value", url.render_as_string(hide_password=True))

    def test_non_postgres_database_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "must use PostgreSQL"):
            normalize_postgres_url("sqlite:///attendance.db")

    def test_engine_is_created_without_connecting_to_the_database(self):
        engine = create_postgres_engine(
            "postgresql://attendance_user:private-value@db.example/attendance"
        )
        try:
            self.assertEqual(engine.url.drivername, "postgresql+psycopg")
            self.assertEqual(engine.pool.size(), 4)
        finally:
            engine.dispose()

    def test_test_database_url_requires_the_exact_local_target(self):
        url = validate_test_database_url(
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/attendance_test"
        )
        self.assertEqual(url.drivername, "postgresql+psycopg")
        self.assertEqual(url.host, "127.0.0.1")
        self.assertEqual(url.port, 5432)
        self.assertEqual(url.database, "attendance_test")
        self.assertEqual(url.username, "attendance_test_user")

        invalid_urls = (
            "postgresql://attendance_test_user@127.0.0.1:5432/attendance_test",
            "postgresql+psycopg://attendance_test_user@localhost:5432/attendance_test",
            "postgresql+psycopg://attendance_test_user@[::1]:5432/attendance_test",
            "postgresql+psycopg://attendance_test_user@192.168.1.10:5432/attendance_test",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5433/attendance_test",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/other_db",
            "postgresql+psycopg://other_user@127.0.0.1:5432/attendance_test",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/attendance_test?sslmode=disable",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/attendance_test?",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/attendance_test#fragment",
            "postgresql+psycopg://attendance_test_user@127.0.0.1:5432/attendance_test#",
        )
        for case_number, invalid_url in enumerate(invalid_urls):
            with self.subTest(case=case_number):
                with self.assertRaises(ValueError):
                    validate_test_database_url(invalid_url)

    def test_test_schema_names_must_match_generated_uuid_format(self):
        self.assertEqual(
            validate_test_schema_name("test_0123456789abcdef0123456789abcdef"),
            "test_0123456789abcdef0123456789abcdef",
        )
        for invalid_schema in ("public", "test_short", "test_0123456789ABCDEF"):
            with self.subTest(schema=invalid_schema):
                with self.assertRaises(ValueError):
                    validate_test_schema_name(invalid_schema)


if __name__ == "__main__":
    unittest.main()
