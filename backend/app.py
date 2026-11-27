import os
import secrets
from urllib.parse import urlsplit

import click
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.security import generate_password_hash

from backend.database import (
    database_connection,
    database_transaction,
    execute,
    fetch_one,
    init_database_engine,
)
from backend.routes.admin import admin_bp
from backend.routes.attendance import attendance_bp
from backend.routes.auth import auth_bp
from backend.routes.employee import employee_bp
from backend.timeutils import office_timezone


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED_DATABASE_TABLES = frozenset({
    "employees",
    "attendance",
    "leaves",
    "departments",
    "office_location_settings",
    "announcements",
    "notifications",
})


def create_app(test_config=None):
    is_production = (
        os.environ.get("RENDER", "").lower() == "true"
        or os.environ.get("FLASK_ENV", "").lower() == "production"
    )
    secret_key = os.environ.get("FLASK_SECRET_KEY", "").strip()
    if is_production and not secret_key:
        raise RuntimeError("FLASK_SECRET_KEY must be configured for production.")

    cors_allowed_origins = [
        origin.strip().rstrip("/")
        for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if "*" in cors_allowed_origins:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS must list exact origins; wildcard origins are not allowed."
        )
    for origin in cors_allowed_origins:
        try:
            parsed_origin = urlsplit(origin)
        except ValueError as error:
            raise RuntimeError("CORS_ALLOWED_ORIGINS contains an invalid origin.") from error
        if (
            parsed_origin.scheme not in ("http", "https")
            or not parsed_origin.netloc
            or parsed_origin.path
            or parsed_origin.query
            or parsed_origin.fragment
            or parsed_origin.username
            or parsed_origin.password
        ):
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS must contain only exact web origins."
            )
        if is_production and parsed_origin.scheme != "https":
            raise RuntimeError("Production CORS origins must use HTTPS.")

    app = Flask(
        __name__,
        template_folder=os.path.join(BASE_DIR, "templates"),
        static_folder=os.path.join(BASE_DIR, "static"),
    )
    app.config.update(
        SECRET_KEY=secret_key or secrets.token_hex(32),
        IS_PRODUCTION=is_production,
        PORT=int(os.environ.get("PORT", "5000")),
        CORS_ALLOWED_ORIGINS=cors_allowed_origins,
        DEBUG=False,
        OFFICE_TIMEZONE=os.environ.get("OFFICE_TIMEZONE") or None,
        OFFICIAL_CHECK_IN_TIME=os.environ.get("OFFICIAL_CHECK_IN_TIME") or "09:30",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=is_production,
    )
    if test_config:
        app.config.update(test_config)

    database_url = (test_config or {}).get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    init_database_engine(app, database_url)
    with app.app_context():
        office_timezone()
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(employee_bp, url_prefix="/api/employee")
    app.register_blueprint(attendance_bp, url_prefix="/api/attendance")

    @app.after_request
    def add_allowed_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") in app.config["CORS_ALLOWED_ORIGINS"]:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers.add("Vary", "Origin")
        return response

    @app.errorhandler(500)
    def internal_server_error(error):
        original = getattr(error, "original_exception", None)
        if original is None:
            app.logger.error("The application returned an internal server error.")
        if request.path.startswith("/api/"):
            return jsonify({"message": "An internal server error occurred."}), 500
        return "Internal server error.", 500

    @app.before_request
    def authorize_request():
        path = request.path
        origin = request.headers.get("Origin")
        if (
            request.method == "OPTIONS"
            and path.startswith("/api/")
            and origin
            and origin.rstrip("/") in app.config["CORS_ALLOWED_ORIGINS"]
        ):
            return "", 204
        if path.startswith("/static/") or path in ("/", "/login", "/api/health"):
            return None

        required_role = None
        is_page = path in ("/admin", "/employee")
        if path == "/admin" or path.startswith("/api/admin/"):
            required_role = "admin"
        elif path == "/employee" or path.startswith("/api/employee/") or path.startswith("/api/attendance/"):
            required_role = "employee"
        elif path == "/api/auth/me":
            required_role = "any"
        elif path.startswith("/api/auth/"):
            return None
        else:
            return None

        employee_id = session.get("user_id")
        if employee_id is None:
            if is_page:
                return redirect(url_for("login_page"))
            return jsonify({"message": "Authentication required."}), 401

        with database_connection() as conn:
            employee = fetch_one(
                conn,
                "SELECT role, is_active, must_change_password FROM employees WHERE id = :id",
                {"id": employee_id},
            )
        if employee is None or not employee["is_active"]:
            session.clear()
            if is_page:
                return redirect(url_for("login_page"))
            return jsonify({"message": "Authentication required."}), 401
        employee_role = str(employee["role"]).strip().lower()
        if employee_role not in ("admin", "employee"):
            session.clear()
            if is_page:
                return redirect(url_for("login_page"))
            return jsonify({"message": "This account has no valid application role."}), 403
        if required_role not in ("any", employee_role):
            if is_page:
                dashboard_url = "/admin" if employee_role == "admin" else "/employee"
                dashboard_name = "Admin dashboard" if employee_role == "admin" else "Employee dashboard"
                return render_template(
                    "forbidden.html",
                    dashboard_url=dashboard_url,
                    dashboard_name=dashboard_name,
                ), 403
            return jsonify({"message": "You do not have permission to access this resource."}), 403
        if employee_role == "employee" and employee["must_change_password"]:
            allowed_during_password_change = (
                path == "/employee"
                or path == "/api/auth/me"
                or path == "/api/employee/profile" and request.method in ("GET", "PUT")
                or path == "/api/employee/password" and request.method == "POST"
            )
            if not allowed_during_password_change:
                return jsonify({
                    "message": "Change your temporary password before continuing.",
                    "code": "password_change_required",
                }), 403
        return None

    @app.get("/")
    @app.get("/login")
    def login_page():
        if session.get("user_id"):
            with database_connection() as conn:
                employee = fetch_one(
                    conn,
                    "SELECT role, is_active, must_change_password FROM employees WHERE id = :id",
                    {"id": session["user_id"]},
                )
            if employee and employee["is_active"]:
                role = str(employee["role"]).strip().lower()
                if role in ("admin", "employee"):
                    return redirect("/admin" if role == "admin" else "/employee")
            session.clear()
        return render_template("login.html")

    @app.get("/admin")
    def admin_page():
        return render_template("admin.html")

    @app.get("/employee")
    def employee_page():
        return render_template("employee.html")

    @app.get("/api/health")
    def health():
        try:
            with database_connection() as conn:
                execute(conn, "SELECT 1")
                missing_tables = REQUIRED_DATABASE_TABLES - set(
                    inspect(conn).get_table_names()
                )
        except SQLAlchemyError:
            app.logger.exception("Health check could not access the database.")
            return jsonify({"status": "error", "message": "Database unavailable."}), 503
        if missing_tables:
            app.logger.error("Health check found an incomplete database schema.")
            return jsonify({
                "status": "error",
                "message": "Database schema unavailable.",
            }), 503
        return jsonify({"status": "success", "message": "Attendance API is ready."})

    @app.cli.command("create-admin")
    def create_admin():
        """Create an administrator account without exposing a public signup route."""
        email = click.prompt("Admin email").strip().lower()
        name = click.prompt("Admin full name").strip()
        password = click.prompt("Admin password", hide_input=True, confirmation_prompt=True)
        if len(password) < 8:
            raise click.ClickException("Password must contain at least 8 characters.")
        try:
            with database_transaction() as conn:
                employee_id = execute(conn, """
                    INSERT INTO employees (name, email, password, role, employee_code)
                    VALUES (:name, :email, :password, 'admin', :employee_code)
                    RETURNING id
                """, {
                    "name": name,
                    "email": email,
                    "password": generate_password_hash(password),
                    "employee_code": "ADM",
                }).scalar_one()
                execute(
                    conn,
                    "UPDATE employees SET employee_code = :employee_code WHERE id = :id",
                    {"employee_code": f"ADM-{employee_id:04d}", "id": employee_id},
                )
        except IntegrityError as error:
            raise click.ClickException(
                "That email or employee ID is already in use."
            ) from error
        click.echo("Admin account created.")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(port=app.config["PORT"])
