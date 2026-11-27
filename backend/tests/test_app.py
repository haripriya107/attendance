import os
import unittest
from datetime import date, datetime, timedelta, timezone
from math import degrees
from contextlib import closing
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from werkzeug.security import check_password_hash, generate_password_hash

TEST_DATABASE_URL = os.environ.get("ATTENDANCE_TEST_DATABASE_URL", "").strip()

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from backend.postgres import (
    validate_test_database_url,
    validate_test_schema_name,
)

_test_url = None
if TEST_DATABASE_URL:
    _test_url = validate_test_database_url(TEST_DATABASE_URL)
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from backend.location import EARTH_RADIUS_METERS
from backend.timeutils import office_today


def create_app(*args, **kwargs):
    from backend.app import create_app as app_factory

    return app_factory(*args, **kwargs)


class TestConnection:
    def __init__(self, connection):
        self.connection = connection

    @staticmethod
    def _parameterized_statement(statement, parameters):
        if isinstance(parameters, dict) or parameters is None:
            return text(statement), parameters or {}
        names = [f"p{index}" for index in range(len(parameters))]
        for name in names:
            statement = statement.replace("?", f":{name}", 1)
        return text(statement), dict(zip(names, parameters))

    def execute(self, statement, parameters=None):
        statement, parameters = self._parameterized_statement(statement, parameters)
        return self.connection.execute(statement, parameters)

    def executemany(self, statement, parameter_rows):
        rows = list(parameter_rows)
        if not rows:
            return None
        parameterized, _ = self._parameterized_statement(statement, rows[0])
        names = [f"p{index}" for index in range(len(rows[0]))]
        mappings = [dict(zip(names, row)) for row in rows]
        return self.connection.execute(parameterized, mappings)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


@unittest.skipUnless(
    TEST_DATABASE_URL,
    "Set ATTENDANCE_TEST_DATABASE_URL to the isolated local attendance_test database.",
)
class AttendanceAppTests(unittest.TestCase):
    def setUp(self):
        self.schema = validate_test_schema_name(f"test_{uuid4().hex}")
        self.admin_engine = create_engine(_test_url)
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.app = None
        self.addCleanup(self._cleanup_test_schema)
        self.database_url = TEST_DATABASE_URL
        migration_config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        with patch.dict(os.environ, {
            "ATTENDANCE_TEST_DATABASE_URL": self.database_url,
            "ATTENDANCE_TEST_SCHEMA": self.schema,
        }):
            command.upgrade(migration_config, "head")
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "DATABASE_URL": self.database_url,
            "POSTGRES_TEST_SCHEMA": self.schema,
            "OFFICE_TIMEZONE": "UTC",
            "OFFICIAL_CHECK_IN_TIME": "09:30",
        })
        self.client = self.app.test_client()
        with closing(self.db_connection()) as conn:
            conn.execute("""
                INSERT INTO employees (name, email, password, role, employee_code)
                VALUES ('Admin User', 'admin@example.com', ?, 'admin', 'ADM-0001')
            """, (generate_password_hash("admin-pass-123"),))
            conn.execute("""
                INSERT INTO employees (name, email, password, role, employee_code)
                VALUES ('Taylor Employee', 'taylor@example.com', ?, 'employee', 'EMP-0001')
            """, (generate_password_hash("employee-pass-123"),))
            conn.execute("""
                UPDATE office_location_settings
                SET latitude = 0, longitude = 0
                WHERE id = 1
            """)
            conn.commit()

    def _cleanup_test_schema(self):
        schema_name = validate_test_schema_name(self.schema)
        if self.app is not None:
            self.app.extensions["database_engine"].dispose()
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
        self.admin_engine.dispose()

    def db_connection(self):
        return TestConnection(self.app.extensions["database_engine"].connect())

    def login(self, email, password):
        return self.client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
        )

    def office_date(self):
        with self.app.app_context():
            return office_today()

    def test_app_rejects_unsupported_database_url(self):
        with self.assertRaisesRegex(ValueError, "must use SQLite or PostgreSQL"):
            create_app({"DATABASE_URL": "mysql://localhost/attendance"})

    def test_production_requires_a_configured_secret_key(self):
        with patch.dict(os.environ, {"RENDER": "true", "FLASK_SECRET_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "FLASK_SECRET_KEY"):
                create_app()

    def test_port_uses_environment_value_and_health_checks_database(self):
        with patch.dict(os.environ, {"PORT": "5100"}):
            app = create_app({
                "TESTING": True,
                "SECRET_KEY": "test-secret",
                "DATABASE_URL": self.database_url,
                "POSTGRES_TEST_SCHEMA": self.schema,
                "OFFICE_TIMEZONE": "UTC",
            })
        self.assertEqual(app.config["PORT"], 5100)
        response = app.test_client().get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "success")

    def test_cors_preflight_allows_only_configured_origins(self):
        self.app.config["CORS_ALLOWED_ORIGINS"] = ["https://portal.example"]
        allowed = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://portal.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(allowed.status_code, 204)
        self.assertEqual(
            allowed.headers["Access-Control-Allow-Origin"],
            "https://portal.example",
        )
        self.assertEqual(allowed.headers["Access-Control-Allow-Credentials"], "true")

        denied = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://unlisted.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertNotIn("Access-Control-Allow-Origin", denied.headers)

    def test_api_internal_errors_do_not_expose_exception_details(self):
        self.app.config["PROPAGATE_EXCEPTIONS"] = False

        @self.app.get("/api/test-internal-error")
        def trigger_internal_error():
            raise RuntimeError("sensitive diagnostic detail")

        response = self.client.get("/api/test-internal-error")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json,
            {"message": "An internal server error occurred."},
        )
        self.assertNotIn(b"sensitive diagnostic detail", response.data)

    def test_postgresql_schema_includes_legacy_tables_and_office_defaults(self):
        migration_config = Config(
            str(Path(__file__).resolve().parents[2] / "alembic.ini")
        )
        with patch.dict(os.environ, {
            "ATTENDANCE_TEST_DATABASE_URL": self.database_url,
            "ATTENDANCE_TEST_SCHEMA": self.schema,
        }):
            command.upgrade(migration_config, "head")
            command.upgrade(migration_config, "head")

        engine = self.app.extensions["database_engine"]
        with engine.connect() as conn:
            tables = set(inspect(conn).get_table_names())
            office_location = conn.execute(text(
                "SELECT id, radius_meters FROM office_location_settings WHERE id = 1"
            )).one()
            employee_count = conn.execute(
                text("SELECT count(*) FROM employees")
            ).scalar_one()
        self.assertTrue({
            "employees", "attendance", "leaves", "departments",
            "office_location_settings", "announcements", "notifications",
            "alembic_version",
        }.issubset(tables))
        self.assertEqual(office_location, (1, 200.0))
        self.assertEqual(employee_count, 2)
        login = self.login("admin@example.com", "admin-pass-123")
        self.assertEqual(login.status_code, 200)

    def test_shared_login_redirects_by_role_and_protects_admin_routes(self):
        response = self.login("taylor@example.com", "employee-pass-123")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["redirect"], "/employee")
        self.assertEqual(self.client.get("/api/admin/employees").status_code, 403)
        self.assertIn(b"My workspace", self.client.get("/employee").data)
        wrong_dashboard = self.client.get("/admin")
        self.assertEqual(wrong_dashboard.status_code, 403)
        self.assertIn(b"Go to Employee dashboard", wrong_dashboard.data)

        self.client.post("/api/auth/logout")
        response = self.login("admin@example.com", "admin-pass-123")
        self.assertEqual(response.json["redirect"], "/admin")
        self.assertEqual(self.client.get("/api/admin/employees").status_code, 200)
        self.assertIn(b"Employee directory", self.client.get("/admin").data)
        self.assertEqual(self.client.get("/employee").status_code, 403)
        demotion = self.client.put("/api/admin/employees/1", json={
            "employee_code": "ADM-0001", "name": "Admin User",
            "email": "admin@example.com", "role": "employee",
            "employment_type": "Full-time", "is_active": True,
        })
        self.assertEqual(demotion.status_code, 409)

    def test_dashboard_urls_require_login_and_logout_clears_session(self):
        for path in ("/admin", "/employee"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, "/login")

        self.login("admin@example.com", "admin-pass-123")
        self.assertEqual(self.client.get("/admin").status_code, 200)
        self.assertEqual(self.client.get("/api/employee/profile").status_code, 403)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        response = self.client.get("/admin")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/login")

    def test_signing_in_as_another_role_replaces_the_shared_session(self):
        self.login("admin@example.com", "admin-pass-123")
        self.assertEqual(self.client.get("/admin").status_code, 200)

        response = self.login("taylor@example.com", "employee-pass-123")
        self.assertEqual(response.json["redirect"], "/employee")
        self.assertEqual(self.client.get("/employee").status_code, 200)
        self.assertEqual(self.client.get("/api/admin/employees").status_code, 403)

    def test_employee_check_in_once_and_checkout_requires_check_in(self):
        self.login("taylor@example.com", "employee-pass-123")
        coordinates = {"latitude": 0, "longitude": 0}
        self.assertEqual(self.client.post("/api/attendance/check-out").status_code, 409)
        self.assertEqual(self.client.post("/api/attendance/check-in", json=coordinates).status_code, 201)
        self.assertEqual(self.client.post("/api/attendance/check-in", json=coordinates).status_code, 409)

        with closing(self.db_connection()) as conn:
            conn.execute(
                "UPDATE attendance SET check_in = '00:00:00' WHERE employee_id = 2 AND date = ?",
                (self.office_date().isoformat(),),
            )
            conn.commit()
        self.assertEqual(self.client.post("/api/attendance/check-out").status_code, 200)
        self.assertEqual(self.client.post("/api/attendance/check-out").status_code, 409)

    def test_check_in_status_uses_server_time_and_allows_late_check_in(self):
        self.login("taylor@example.com", "employee-pass-123")
        coordinates = {"latitude": 0, "longitude": 0}
        cases = (
            (datetime(2026, 6, 1, 9, 29, tzinfo=timezone.utc), "Present"),
            (datetime(2026, 6, 2, 9, 30, tzinfo=timezone.utc), "Present"),
            (datetime(2026, 6, 3, 9, 31, tzinfo=timezone.utc), "Late"),
        )

        for now, expected_status in cases:
            with self.subTest(time=now.strftime("%H:%M")):
                with patch("backend.routes.attendance.office_now", return_value=now):
                    response = self.client.post("/api/attendance/check-in", json=coordinates)
                    today = self.client.get("/api/attendance/today")
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json["status"], expected_status)
                self.assertEqual(today.json["record"]["status"], expected_status)

        with closing(self.db_connection()) as conn:
            records = conn.execute(
                "SELECT date, status FROM attendance WHERE employee_id = 2 ORDER BY date"
            ).fetchall()
        self.assertEqual(
            records,
            [
                ("2026-06-01", "Present"),
                ("2026-06-02", "Present"),
                ("2026-06-03", "Late"),
            ],
        )
        history = self.client.get("/api/attendance/history")
        self.assertEqual(
            {row["date"]: row["status"] for row in history.json["attendance"]},
            {
                "2026-06-01": "Present",
                "2026-06-02": "Present",
                "2026-06-03": "Late",
            },
        )

        self.client.post("/api/auth/logout")
        self.login("admin@example.com", "admin-pass-123")
        with patch("backend.routes.admin.office_today", return_value=date(2026, 6, 3)):
            overview = self.client.get("/api/admin/overview")
        self.assertEqual(overview.json["metrics"]["present"], 0)
        self.assertEqual(overview.json["metrics"]["late"], 1)
        self.assertEqual(overview.json["metrics"]["absent"], 0)
        report = self.client.get(
            "/api/admin/attendance?from=2026-06-03&to=2026-06-03"
        )
        self.assertEqual(report.json["attendance"][0]["status"], "Late")
        exported = self.client.get(
            "/api/admin/attendance/export?from=2026-06-03&to=2026-06-03"
        )
        self.assertIn("Late", exported.get_data(as_text=True))

    def test_check_in_cutoff_is_configurable(self):
        self.login("taylor@example.com", "employee-pass-123")
        self.app.config["OFFICIAL_CHECK_IN_TIME"] = "10:00"
        now = datetime(2026, 6, 4, 9, 45, tzinfo=timezone.utc)
        with patch("backend.routes.attendance.office_now", return_value=now):
            response = self.client.post(
                "/api/attendance/check-in",
                json={"latitude": 0, "longitude": 0},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["status"], "Present")

    def test_check_in_requires_location_within_configured_radius(self):
        self.login("taylor@example.com", "employee-pass-123")
        test_cases = (
            (
                datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc),
                {"latitude": degrees(199 / EARTH_RADIUS_METERS), "longitude": 0},
                201,
            ),
            (
                datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
                {"latitude": degrees(200 / EARTH_RADIUS_METERS), "longitude": 0},
                201,
            ),
            (
                datetime(2026, 6, 3, 9, 0, tzinfo=timezone.utc),
                {"latitude": degrees(201 / EARTH_RADIUS_METERS), "longitude": 0},
                403,
            ),
            (datetime(2026, 6, 4, 9, 0, tzinfo=timezone.utc), {}, 400),
            (
                datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc),
                {"latitude": 91, "longitude": 0},
                400,
            ),
        )

        for now, coordinates, expected_status in test_cases:
            with self.subTest(date=now.date().isoformat(), expected=expected_status):
                with patch("backend.routes.attendance.office_now", return_value=now):
                    response = self.client.post(
                        "/api/attendance/check-in",
                        json=coordinates,
                    )
                self.assertEqual(response.status_code, expected_status)
                if expected_status == 403:
                    self.assertEqual(response.json["code"], "outside_office_radius")
                if expected_status == 201:
                    self.assertEqual(response.json["status"], "Present")

        with closing(self.db_connection()) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM attendance WHERE employee_id = 2"
                ).fetchone()[0],
                2,
            )

    def test_admin_can_save_office_location_but_employee_cannot_change_it(self):
        self.login("admin@example.com", "admin-pass-123")
        saved = self.client.put("/api/admin/office-location", json={
            "latitude": 0,
            "longitude": 0,
            "radius_meters": 250,
        })
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json["office_location"]["configured"])
        self.assertEqual(saved.json["office_location"]["radius_meters"], 250)

        self.client.post("/api/auth/logout")
        self.assertEqual(
            self.client.put("/api/admin/office-location", json={
                "latitude": 0,
                "longitude": 0,
            }).status_code,
            401,
        )
        self.login("taylor@example.com", "employee-pass-123")
        self.assertEqual(self.client.get("/api/admin/office-location").status_code, 403)
        self.assertEqual(
            self.client.put("/api/admin/office-location", json={
                "latitude": 0,
                "longitude": 0,
            }).status_code,
            403,
        )

    def test_admin_office_location_round_trip_confirms_persisted_coordinates_and_radius(self):
        with closing(self.db_connection()) as conn:
            conn.execute(
                "UPDATE office_location_settings SET latitude = NULL, longitude = NULL WHERE id = 1"
            )
            conn.commit()
        self.login("admin@example.com", "admin-pass-123")
        initial = self.client.get("/api/admin/office-location")
        self.assertEqual(initial.status_code, 200)
        self.assertFalse(initial.json["office_location"]["configured"])
        self.assertEqual(initial.json["office_location"]["radius_meters"], 200)
        original_address = initial.json["office_location"]["address"]

        saved = self.client.put("/api/admin/office-location", json={
            "latitude": 0,
            "longitude": 0,
            "radius_meters": 200,
        })
        self.assertEqual(saved.status_code, 200)

        fetched = self.client.get("/api/admin/office-location")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json["office_location"], {
            "configured": True,
            "latitude": 0,
            "longitude": 0,
            "radius_meters": 200,
            "address": original_address,
        })

        with closing(self.db_connection()) as conn:
            row = conn.execute(
                "SELECT latitude, longitude, radius_meters, address "
                "FROM office_location_settings WHERE id = 1"
            ).fetchone()
        self.assertEqual(row, (0.0, 0.0, 200.0, original_address))

    def test_office_location_update_rejects_missing_or_invalid_coordinates_without_saving(self):
        self.login("admin@example.com", "admin-pass-123")
        original = self.client.get("/api/admin/office-location").json["office_location"]
        invalid_payloads = (
            {},
            {"latitude": 0},
            {"latitude": 91, "longitude": 0},
            {"latitude": 0, "longitude": 181},
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.put("/api/admin/office-location", json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    self.client.get("/api/admin/office-location").json["office_location"],
                    original,
                )

    def test_check_in_fails_closed_when_office_location_is_unconfigured(self):
        with closing(self.db_connection()) as conn:
            conn.execute(
                "UPDATE office_location_settings SET latitude = NULL, longitude = NULL WHERE id = 1"
            )
            conn.commit()
        self.login("taylor@example.com", "employee-pass-123")
        response = self.client.post("/api/attendance/check-in", json={
            "latitude": 0,
            "longitude": 0,
        })
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["code"], "office_location_unconfigured")

    def test_attendance_overview_periods_use_server_ranges_and_database_records(self):
        with closing(self.db_connection()) as conn:
            conn.executemany("""
                INSERT INTO attendance (employee_id, date, check_in, check_out, status)
                VALUES (2, ?, ?, ?, 'Present')
            """, [
                ("2026-03-16", "09:00:00", "17:00:00"),
                ("2026-04-01", "09:00:00", "12:00:00"),
                ("2025-12-31", "09:00:00", "17:00:00"),
            ])
            conn.execute("""
                INSERT INTO leaves (employee_id, from_date, to_date, reason, status)
                VALUES (2, '2026-03-17', '2026-03-18', 'Approved leave', 'Approved')
            """)
            conn.commit()
        self.login("admin@example.com", "admin-pass-123")

        with patch("backend.routes.admin.office_today", return_value=date(2026, 3, 18)):
            week = self.client.get("/api/admin/attendance/overview?period=week")
            month = self.client.get("/api/admin/attendance/overview?period=month")
            year = self.client.get("/api/admin/attendance/overview?period=year")

        self.assertEqual(week.status_code, 200)
        self.assertEqual(week.json["timezone"], "UTC")
        self.assertEqual((week.json["start_date"], week.json["end_date"]), ("2026-03-16", "2026-03-22"))
        self.assertEqual([entry["label"] for entry in week.json["series"]], [
            "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
        ])
        self.assertEqual([entry["present"] for entry in week.json["series"]], [1, 0, 0, 0, 0, 0, 0])
        self.assertEqual(week.json["stats"]["present"], 1)
        self.assertEqual(week.json["stats"]["on_leave"], 2)
        self.assertEqual(week.json["stats"]["absent"], 0)
        self.assertEqual(week.json["stats"]["hours"], 8.0)

        self.assertEqual((month.json["start_date"], month.json["end_date"]), ("2026-03-01", "2026-03-31"))
        self.assertEqual(len(month.json["series"]), 31)
        self.assertEqual(month.json["series"][15]["label"], "16")
        self.assertEqual(month.json["series"][15]["present"], 1)
        self.assertEqual(month.json["stats"]["present"], 1)
        self.assertEqual(month.json["stats"]["absent"], 10)

        self.assertEqual((year.json["start_date"], year.json["end_date"]), ("2026-01-01", "2026-12-31"))
        self.assertEqual([entry["label"] for entry in year.json["series"]], [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ])
        self.assertEqual(year.json["series"][2]["present"], 1)
        self.assertEqual(year.json["series"][3]["present"], 1)
        self.assertEqual(year.json["stats"]["present"], 2)

        filtered = self.client.get(
            "/api/admin/attendance?from=2026-03-16&to=2026-03-16&employee_id=2"
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json["attendance"]), 1)
        self.assertEqual(
            self.client.get("/api/admin/attendance?from=2026-03-20&to=2026-03-10").status_code,
            400,
        )

    def test_attendance_period_empty_state_and_invalid_period(self):
        self.login("admin@example.com", "admin-pass-123")
        with patch("backend.routes.admin.office_today", return_value=date(2026, 2, 1)):
            empty = self.client.get("/api/admin/attendance/overview?period=month")
        self.assertEqual(empty.status_code, 200)
        self.assertTrue(empty.json["empty"])
        self.assertTrue(all(entry["present"] == 0 for entry in empty.json["series"]))
        self.assertEqual(
            self.client.get("/api/admin/attendance/overview?period=quarter").status_code,
            400,
        )

    def test_admin_can_create_hashed_employee_accounts(self):
        self.login("admin@example.com", "admin-pass-123")
        response = self.client.post("/api/admin/employees", json={
            "name": "Morgan New",
            "email": "morgan@example.com",
            "password": "secure-pass-123",
            "role": "employee",
            "employment_type": "Full-time",
        })
        self.assertEqual(response.status_code, 201)
        with closing(self.db_connection()) as conn:
            password, code, must_change = conn.execute(
                """SELECT password, employee_code, must_change_password
                   FROM employees WHERE email = 'morgan@example.com'"""
            ).fetchone()
        self.assertNotEqual(password, "secure-pass-123")
        self.assertTrue(password.startswith("scrypt:"))
        self.assertEqual(code, "EMP-0003")
        self.assertEqual(must_change, 1)
        self.assertNotIn("password", response.json)

    def test_employee_profile_sync_and_required_temporary_password_change(self):
        self.login("admin@example.com", "admin-pass-123")
        created = self.client.post("/api/admin/employees", json={
            "name": "Hari Kumar",
            "email": "hari@example.com",
            "password": "temporary-123",
            "role": "employee",
            "employment_type": "Full-time",
        })
        self.assertEqual(created.status_code, 201)
        employee_id = created.json["id"]
        self.client.post("/api/auth/logout")

        login = self.login("hari@example.com", "temporary-123")
        self.assertTrue(login.json["user"]["must_change_password"])
        profile = self.client.get("/api/employee/profile")
        self.assertEqual(profile.json["employee"]["must_change_password"], True)
        self.assertEqual(self.client.post("/api/attendance/check-in").status_code, 403)
        self.assertEqual(self.client.get("/api/employee/leaves").status_code, 403)
        self.assertEqual(self.client.put("/api/employee/profile", json={
            "name": "Hari Kumar", "phone": "555-0123", "department": "Other team",
        }).status_code, 400)
        updated = self.client.put("/api/employee/profile", json={
            "name": "Hari Updated", "phone": "555-0123",
        })
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json["employee"]["name"], "Hari Updated")

        self.assertEqual(self.client.post("/api/employee/password", json={
            "current_password": "wrong-password",
            "new_password": "new-password-123",
            "confirm_password": "new-password-123",
        }).status_code, 400)
        self.assertEqual(self.client.post("/api/employee/password", json={
            "current_password": "temporary-123",
            "new_password": "new-password-123",
            "confirm_password": "different-password",
        }).status_code, 400)
        changed = self.client.post("/api/employee/password", json={
            "current_password": "temporary-123",
            "new_password": "new-password-123",
            "confirm_password": "new-password-123",
        })
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(self.client.get("/api/employee/profile").json["employee"]["must_change_password"])
        self.assertEqual(
            self.client.post("/api/attendance/check-in", json={
                "latitude": 0,
                "longitude": 0,
            }).status_code,
            201,
        )

        self.client.post("/api/auth/logout")
        self.login("admin@example.com", "admin-pass-123")
        directory = self.client.get("/api/admin/employees?search=Hari")
        self.assertEqual(directory.json["employees"][0]["phone"], "555-0123")
        detail = self.client.get(f"/api/admin/employees/{employee_id}")
        self.assertEqual(detail.json["employee"]["name"], "Hari Updated")
        self.assertEqual(detail.json["employee"]["phone"], "555-0123")
        self.assertNotIn("password", detail.json["employee"])
        with closing(self.db_connection()) as conn:
            password_hash, must_change = conn.execute(
                "SELECT password, must_change_password FROM employees WHERE id = ?",
                (employee_id,),
            ).fetchone()
        self.assertTrue(password_hash.startswith("scrypt:"))
        self.assertTrue(self.client.post("/api/auth/logout").status_code == 200)
        self.assertEqual(self.login("hari@example.com", "new-password-123").status_code, 200)
        self.assertEqual(must_change, 0)

    def test_admin_password_reset_workflow_never_returns_password(self):
        reset_url = "/api/admin/employees/2/reset-password"
        self.assertEqual(
            self.client.post(reset_url, json={
                "temporary_password": "temporary-reset-123",
                "confirm_password": "temporary-reset-123",
            }).status_code,
            401,
        )
        self.login("taylor@example.com", "employee-pass-123")
        self.assertEqual(
            self.client.post(reset_url, json={
                "temporary_password": "temporary-reset-123",
                "confirm_password": "temporary-reset-123",
            }).status_code,
            403,
        )
        self.client.post("/api/auth/logout")
        self.login("admin@example.com", "admin-pass-123")

        before = self.client.get("/api/admin/employees/2")
        self.assertNotIn("password", before.json["employee"])
        with closing(self.db_connection()) as conn:
            original_hash = conn.execute(
                "SELECT password FROM employees WHERE id = 2"
            ).fetchone()[0]

        self.assertEqual(self.client.post(reset_url, json={
            "temporary_password": "short",
            "confirm_password": "short",
        }).status_code, 400)
        self.assertEqual(self.client.post(reset_url, json={
            "temporary_password": "temporary-reset-123",
            "confirm_password": "different-reset-123",
        }).status_code, 400)
        reset = self.client.post(reset_url, json={
            "temporary_password": "temporary-reset-123",
            "confirm_password": "temporary-reset-123",
        })
        self.assertEqual(reset.status_code, 200)
        self.assertNotIn("temporary-reset-123", str(reset.json))
        self.assertNotIn(original_hash, str(before.json))
        self.assertEqual(
            self.client.post("/api/admin/employees/1/reset-password", json={
                "temporary_password": "temporary-reset-123",
                "confirm_password": "temporary-reset-123",
            }).status_code,
            409,
        )
        with closing(self.db_connection()) as conn:
            new_hash, must_change = conn.execute(
                "SELECT password, must_change_password FROM employees WHERE id = 2"
            ).fetchone()
        self.assertNotEqual(new_hash, original_hash)
        self.assertTrue(check_password_hash(new_hash, "temporary-reset-123"))
        self.assertEqual(must_change, 1)

        self.client.post("/api/auth/logout")
        self.assertEqual(self.login("taylor@example.com", "employee-pass-123").status_code, 401)
        self.client.post("/api/auth/logout")
        employee_login = self.login("taylor@example.com", "temporary-reset-123")
        self.assertEqual(employee_login.status_code, 200)
        self.assertTrue(employee_login.json["user"]["must_change_password"])
        self.assertEqual(self.client.get("/api/employee/leaves").status_code, 403)
        self.assertEqual(self.client.get("/employee").status_code, 200)
        self.assertIn(b"Contact your administrator to reset it", self.client.get("/employee").data)
        self.assertEqual(self.client.post("/api/employee/password", json={
            "current_password": "temporary-reset-123",
            "new_password": "employee-final-123",
            "confirm_password": "employee-final-123",
        }).status_code, 200)
        with closing(self.db_connection()) as conn:
            cleared = conn.execute(
                "SELECT must_change_password FROM employees WHERE id = 2"
            ).fetchone()[0]
        self.assertEqual(cleared, 0)
        self.assertEqual(self.client.get("/api/employee/leaves").status_code, 200)
        self.client.post("/api/auth/logout")
        self.assertIn(b"cannot retrieve your current password", self.client.get("/login").data)

    def test_employee_password_reset_requires_change_and_departments_are_safe(self):
        self.login("admin@example.com", "admin-pass-123")
        created_department = self.client.post(
            "/api/admin/departments", json={"department_name": "Engineering"}
        )
        self.assertEqual(created_department.status_code, 201)
        update = self.client.put("/api/admin/employees/2", json={
            "name": "Taylor Employee",
            "email": "taylor@example.com",
            "employee_code": "EMP-0001",
            "phone": "",
            "position": "",
            "department": "Engineering",
            "joining_date": "",
            "employment_type": "Full-time",
            "role": "employee",
            "is_active": True,
        })
        self.assertEqual(update.status_code, 200)
        department_id = created_department.json["id"]
        self.assertEqual(
            self.client.delete(f"/api/admin/departments/{department_id}").status_code, 409
        )
        self.assertEqual(self.client.put("/api/admin/employees/2", json={
            "name": "Taylor Employee",
            "email": "taylor@example.com",
            "employee_code": "EMP-0001",
            "phone": "",
            "position": "",
            "department": "Missing department",
            "joining_date": "",
            "employment_type": "Full-time",
            "role": "employee",
            "is_active": True,
        }).status_code, 400)

        reset = self.client.put("/api/admin/employees/2", json={
            "name": "Taylor Employee",
            "email": "taylor@example.com",
            "employee_code": "EMP-0001",
            "phone": "",
            "position": "",
            "department": "Engineering",
            "joining_date": "",
            "employment_type": "Full-time",
            "role": "employee",
            "is_active": True,
            "password": "reset-password-123",
        })
        self.assertEqual(reset.status_code, 200)
        self.client.post("/api/auth/logout")
        self.login("taylor@example.com", "reset-password-123")
        self.assertEqual(self.client.get("/api/employee/leaves").status_code, 403)
        self.client.post("/api/auth/logout")

        self.login("admin@example.com", "admin-pass-123")
        cleared = self.client.put("/api/admin/employees/2", json={
            "name": "Taylor Employee",
            "email": "taylor@example.com",
            "employee_code": "EMP-0001",
            "phone": "",
            "position": "",
            "department": "",
            "joining_date": "",
            "employment_type": "Full-time",
            "role": "employee",
            "is_active": True,
        })
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(
            self.client.delete(f"/api/admin/departments/{department_id}").status_code, 200
        )

    def test_attendance_csv_export_uses_filters_without_report_page_limit(self):
        with closing(self.db_connection()) as conn:
            conn.executemany("""
                INSERT INTO attendance (employee_id, date, check_in, check_out, status)
                VALUES (2, ?, '09:00:00', '17:00:00', 'Present')
            """, [
                ((date(2020, 1, 1) + timedelta(days=offset)).isoformat(),)
                for offset in range(501)
            ])
            conn.commit()
        self.login("admin@example.com", "admin-pass-123")
        report = self.client.get("/api/admin/attendance")
        self.assertEqual(len(report.json["attendance"]), 501)
        exported = self.client.get("/api/admin/attendance/export?employee_id=2")
        self.assertEqual(exported.status_code, 200)
        self.assertIn("text/csv", exported.content_type)
        self.assertEqual(len(exported.get_data(as_text=True).splitlines()), 502)
        filtered = self.client.get(
            "/api/admin/attendance/export?from=2020-01-01&to=2020-01-01&employee_id=2"
        )
        self.assertEqual(len(filtered.get_data(as_text=True).splitlines()), 2)
        self.client.post("/api/auth/logout")
        self.login("taylor@example.com", "employee-pass-123")
        history = self.client.get("/api/attendance/history")
        self.assertEqual(len(history.json["attendance"]), 501)
        self.assertEqual(history.json["attendance"][0]["date"], "2021-05-15")

    def test_create_admin_cli_bootstraps_a_hashed_admin(self):
        runner = self.app.test_cli_runner()
        result = runner.invoke(
            args=["create-admin"],
            input="bootstrap@example.com\nBootstrap Admin\nbootstrap-pass-123\nbootstrap-pass-123\n",
        )
        self.assertEqual(result.exit_code, 0, result.output)
        with closing(self.db_connection()) as conn:
            role, password, code = conn.execute(
                "SELECT role, password, employee_code FROM employees WHERE email = ?",
                ("bootstrap@example.com",),
            ).fetchone()
        self.assertEqual(role, "admin")
        self.assertTrue(password.startswith("scrypt:"))
        self.assertEqual(code, "ADM-0003")

    def test_approved_leave_blocks_attendance_and_public_registration_is_disabled(self):
        with closing(self.db_connection()) as conn:
            conn.execute("""
                INSERT INTO employees (name, email, password, role, employee_code)
                VALUES ('Other Employee', 'other@example.com', ?, 'Employee', 'EMP-0003')
            """, (generate_password_hash("other-pass-123"),))
            conn.commit()

        self.login("taylor@example.com", "employee-pass-123")
        leave = self.client.post("/api/employee/leaves", json={
            "from_date": self.office_date().isoformat(),
            "to_date": self.office_date().isoformat(),
            "reason": "Personal day",
            "employee_id": 3,
        })
        self.assertEqual(leave.status_code, 201)
        leave_id = self.client.get("/api/employee/leaves").json["leaves"][0]["id"]
        self.assertEqual(len(self.client.get("/api/employee/leaves").json["leaves"]), 1)
        with closing(self.db_connection()) as conn:
            owner_id = conn.execute(
                "SELECT employee_id FROM leaves WHERE id = ?", (leave_id,)
            ).fetchone()[0]
        self.assertEqual(owner_id, 2)

        self.client.post("/api/auth/logout")
        other_login = self.login("other@example.com", "other-pass-123")
        self.assertEqual(other_login.json["redirect"], "/employee")
        self.assertEqual(self.client.get("/api/employee/leaves").json["leaves"], [])
        self.assertEqual(
            self.client.patch(f"/api/admin/leaves/{leave_id}", json={"status": "Approved"}).status_code,
            403,
        )
        self.client.post("/api/auth/logout")

        self.login("admin@example.com", "admin-pass-123")
        requests = self.client.get("/api/admin/leaves").json["leaves"]
        self.assertEqual(len(requests), 1)
        response = self.client.patch(
            f"/api/admin/leaves/{leave_id}",
            json={"status": "Approved"},
        )
        self.assertEqual(response.status_code, 200)
        self.client.post("/api/auth/logout")

        self.login("taylor@example.com", "employee-pass-123")
        self.assertEqual(
            self.client.get("/api/employee/leaves").json["leaves"][0]["status"],
            "Approved",
        )
        self.assertEqual(
            self.client.post("/api/attendance/check-in", json={
                "latitude": 0,
                "longitude": 0,
            }).status_code,
            409,
        )
        self.assertEqual(self.client.post("/api/auth/register", json={}).status_code, 404)

if __name__ == "__main__":
    unittest.main()
