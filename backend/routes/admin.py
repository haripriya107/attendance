import csv
import io
import re
import calendar
from datetime import date, timedelta

from flask import Blueprint, Response, jsonify, request, session
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from backend.location import is_coordinate, is_finite_number
from backend.database import (
    database_connection,
    database_transaction,
    execute,
    fetch_all,
    fetch_one,
    for_update_clause,
)
from backend.timeutils import elapsed_hours, office_today, office_timezone_name


admin_bp = Blueprint("admin", __name__)
EMPLOYEE_FIELDS = (
    "employee_code", "name", "email", "phone", "position",
    "department", "joining_date", "employment_type", "role",
)


def fail(message, status=400):
    return jsonify({"message": message}), status


def employee_values(data, creating=False):
    values = {key: str(data.get(key, "")).strip() for key in EMPLOYEE_FIELDS}
    values["email"] = values["email"].lower()
    if not values["name"] or not values["email"]:
        return None, "Full name and email are required."
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", values["email"]):
        return None, "Enter a valid email address."
    if values["role"] not in ("employee", "admin"):
        return None, "Role must be employee or admin."
    if values["employment_type"] not in ("Full-time", "Part-time", "Contract", "Intern"):
        return None, "Choose a valid employment type."
    if values["joining_date"]:
        try:
            if date.fromisoformat(values["joining_date"]).isoformat() != values["joining_date"]:
                raise ValueError
        except ValueError:
            return None, "Joining date must be a valid date."
    if creating and len(str(data.get("password", ""))) < 8:
        return None, "Password must contain at least 8 characters."
    return values, None


def validate_department(conn, department_name):
    if department_name and not fetch_one(
        conn,
        "SELECT 1 FROM departments WHERE department_name = :department_name",
        {"department_name": department_name},
    ):
        return "Choose a department from the department list."
    return None


def attendance_filters():
    clauses = ["lower(trim(e.role)) = 'employee'"]
    params = {}
    start = request.args.get("from", "").strip()
    end = request.args.get("to", "").strip()
    employee_id = request.args.get("employee_id", "").strip()
    if start:
        try:
            if date.fromisoformat(start).isoformat() != start:
                raise ValueError
        except ValueError:
            return None, None, "From date must be a valid ISO date."
        clauses.append("a.date >= :start_date")
        params["start_date"] = start
    if end:
        try:
            if date.fromisoformat(end).isoformat() != end:
                raise ValueError
        except ValueError:
            return None, None, "To date must be a valid ISO date."
        clauses.append("a.date <= :end_date")
        params["end_date"] = end
    if start and end and start > end:
        return None, None, "From date cannot be after To date."
    if employee_id:
        if not employee_id.isdigit() or int(employee_id) < 1:
            return None, None, "Employee ID must be a positive integer."
        clauses.append("a.employee_id = :employee_id")
        params["employee_id"] = int(employee_id)
    return clauses, params, None


def attendance_query(clauses):
    return """
        SELECT a.id, a.date, a.check_in, a.check_out, a.status,
               e.id AS employee_id, e.employee_code, e.name, e.department
        FROM attendance a JOIN employees e ON e.id = a.employee_id
        WHERE """ + " AND ".join(clauses) + """
        ORDER BY a.date DESC, lower(e.name)
    """


def attendance_rows_with_hours(rows):
    results = [dict(row) for row in rows]
    for row in results:
        row["hours"] = elapsed_hours(row["check_in"], row["check_out"])
    return results


def office_location_response(row):
    latitude = row["latitude"]
    longitude = row["longitude"]
    return {
        "configured": latitude is not None and longitude is not None,
        "latitude": latitude,
        "longitude": longitude,
        "radius_meters": row["radius_meters"],
        "address": row["address"],
    }


@admin_bp.get("/office-location")
def get_office_location():
    with database_connection() as conn:
        row = fetch_one(
            conn,
            "SELECT latitude, longitude, radius_meters, address "
            "FROM office_location_settings WHERE id = 1",
        )
    if row is None:
        return fail("Office location settings are unavailable.", 500)
    return jsonify({"office_location": office_location_response(row)})


@admin_bp.put("/office-location")
def update_office_location():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return fail("A JSON office location is required.")

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    for value, minimum, maximum, label in (
        (latitude, -90, 90, "Latitude"),
        (longitude, -180, 180, "Longitude"),
    ):
        if not is_coordinate(value, minimum, maximum):
            return fail(f"{label} must be a valid coordinate.")

    with database_transaction() as conn:
        current = fetch_one(
            conn,
            "SELECT radius_meters FROM office_location_settings WHERE id = 1",
        )
        if current is None:
            return fail("Office location settings are unavailable.", 500)
        radius_meters = data.get("radius_meters", current["radius_meters"])
        if not is_finite_number(radius_meters) or radius_meters <= 0:
            return fail("Radius must be a positive number of metres.")
        execute(conn, """
            UPDATE office_location_settings
            SET latitude = :latitude, longitude = :longitude, radius_meters = :radius_meters
            WHERE id = 1
        """, {
            "latitude": latitude,
            "longitude": longitude,
            "radius_meters": radius_meters,
        })
        row = fetch_one(
            conn,
            "SELECT latitude, longitude, radius_meters, address "
            "FROM office_location_settings WHERE id = 1",
        )
    return jsonify({
        "message": "Office location saved.",
        "office_location": office_location_response(row),
    })


@admin_bp.get("/overview")
def overview():
    today = office_today().isoformat()
    with database_connection() as conn:
        total = execute(conn, """
            SELECT count(*) FROM employees
            WHERE is_active = TRUE AND lower(trim(role)) = 'employee'
        """).scalar_one()
        present = execute(conn, """
            SELECT count(DISTINCT a.employee_id)
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE a.date = :today AND a.check_in IS NOT NULL
              AND a.status = 'Present'
              AND e.is_active = TRUE AND lower(trim(e.role)) = 'employee'
        """, {"today": today}).scalar_one()
        late = execute(conn, """
            SELECT count(DISTINCT a.employee_id)
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE a.date = :today AND a.check_in IS NOT NULL
              AND a.status = 'Late'
              AND e.is_active = TRUE AND lower(trim(e.role)) = 'employee'
        """, {"today": today}).scalar_one()
        on_leave = execute(conn, """
            SELECT count(DISTINCT l.employee_id) FROM leaves l
            JOIN employees e ON e.id = l.employee_id
            WHERE e.is_active = TRUE AND lower(trim(e.role)) = 'employee'
              AND l.status = 'Approved'
              AND l.from_date <= :today AND l.to_date >= :today
              AND NOT EXISTS (
                  SELECT 1 FROM attendance a
                  WHERE a.employee_id = l.employee_id
                    AND a.date = :today AND a.check_in IS NOT NULL
              )
        """, {"today": today}).scalar_one()
        recent = fetch_all(conn, """
            SELECT a.date, a.check_in, a.check_out, a.status,
                   e.employee_code, e.name, e.department
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE e.is_active = TRUE AND lower(trim(e.role)) = 'employee'
            ORDER BY a.date DESC, a.check_in DESC LIMIT 8
        """)
        leaves = fetch_all(conn, """
            SELECT l.id, l.from_date, l.to_date, l.reason, l.status, l.created_at,
                   e.employee_code, e.name, e.department
            FROM leaves l JOIN employees e ON e.id = l.employee_id
            WHERE l.status = 'Pending' ORDER BY l.created_at DESC LIMIT 5
        """)
        departments = execute(conn, "SELECT count(*) FROM departments").scalar_one()
    return jsonify({
        "today": today,
        "metrics": {
            "employees": total,
            "present": present,
            "late": late,
            "on_leave": on_leave,
            "absent": max(total - present - late - on_leave, 0),
        },
        "department_count": departments,
        "recent_attendance": [dict(row) for row in recent],
        "pending_leaves": [dict(row) for row in leaves],
    })


@admin_bp.get("/attendance/overview")
def attendance_overview():
    period = request.args.get("period", "week").strip().lower()
    if period not in ("week", "month", "year"):
        return fail("Period must be week, month, or year.")

    today = office_today()
    if period == "week":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        chart_days = [start + timedelta(days=offset) for offset in range(7)]
        labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    elif period == "month":
        start = today.replace(day=1)
        end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
        chart_days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
        labels = [str(day.day) for day in chart_days]
    else:
        start = date(today.year, 1, 1)
        end = date(today.year, 12, 31)
        chart_days = [date(today.year, month, 1) for month in range(1, 13)]
        labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    calendar_days = [
        start + timedelta(days=offset)
        for offset in range((end - start).days + 1)
    ]

    with database_connection() as conn:
        employees = fetch_all(conn, """
            SELECT id, joining_date FROM employees
            WHERE lower(trim(role)) = 'employee' AND is_active = TRUE
        """)
        employee_joined = {}
        for employee in employees:
            joined = employee["joining_date"]
            try:
                employee_joined[employee["id"]] = date.fromisoformat(joined) if joined else date.min
            except ValueError:
                employee_joined[employee["id"]] = date.min

        attendance_rows = fetch_all(conn, """
            SELECT a.employee_id, a.date, a.check_in, a.check_out
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE a.date >= :start_date AND a.date <= :end_date
              AND a.check_in IS NOT NULL
              AND lower(trim(e.role)) = 'employee' AND e.is_active = TRUE
        """, {"start_date": start.isoformat(), "end_date": end.isoformat()})
        leave_rows = fetch_all(conn, """
            SELECT l.employee_id, l.from_date, l.to_date
            FROM leaves l JOIN employees e ON e.id = l.employee_id
            WHERE l.status = 'Approved'
              AND l.from_date <= :end_date AND l.to_date >= :start_date
              AND lower(trim(e.role)) = 'employee' AND e.is_active = TRUE
        """, {"start_date": start.isoformat(), "end_date": end.isoformat()})

    present_by_day = {day: set() for day in calendar_days}
    total_hours = 0.0
    completed = 0
    in_progress = 0
    for row in attendance_rows:
        work_day = date.fromisoformat(row["date"])
        employee_id = row["employee_id"]
        if employee_id in employee_joined and employee_joined[employee_id] <= work_day:
            if work_day in present_by_day:
                present_by_day[work_day].add(employee_id)
        if row["check_out"]:
            completed += 1
            total_hours += elapsed_hours(row["check_in"], row["check_out"]) or 0
        else:
            in_progress += 1

    leave_ranges = {}
    for row in leave_rows:
        try:
            leave_ranges.setdefault(row["employee_id"], []).append((
                date.fromisoformat(row["from_date"]),
                date.fromisoformat(row["to_date"]),
            ))
        except ValueError:
            continue

    present_by_bucket = {day: 0 for day in chart_days}
    present_total = 0
    absent_total = 0
    leave_total = 0
    for day in calendar_days:
        present_ids = present_by_day.get(day, set())
        present_count = len(present_ids)
        present_total += present_count
        leave_ids = {
            employee_id for employee_id, ranges in leave_ranges.items()
            if employee_joined.get(employee_id, date.max) <= day
            and any(start_date <= day <= end_date for start_date, end_date in ranges)
            and employee_id not in present_ids
        } if day.weekday() < 5 and day <= today else set()
        if day <= today:
            leave_total += len(leave_ids)
        if day.weekday() < 5 and day <= today:
            eligible = {
                employee_id for employee_id, joined in employee_joined.items()
                if joined <= day
            }
            absent_total += len(eligible - present_ids - leave_ids)
        bucket = date(day.year, day.month, 1) if period == "year" else day
        present_by_bucket[bucket] += present_count
    series = [
        {
            "date": day.strftime("%Y-%m") if period == "year" else day.isoformat(),
            "label": label,
            "present": present_by_bucket[day],
        }
        for day, label in zip(chart_days, labels)
    ]

    return jsonify({
        "period": period,
        "timezone": office_timezone_name(),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "empty": not attendance_rows,
        "series": series,
        "stats": {
            "present": present_total,
            "absent": absent_total,
            "on_leave": leave_total,
            "completed": completed,
            "in_progress": in_progress,
            "hours": round(total_hours, 2),
        },
    })


@admin_bp.route("/employees", methods=["GET", "POST"])
def employees():
    if request.method == "GET":
        search = request.args.get("search", "").strip()
        with database_connection() as conn:
            rows = fetch_all(conn, """
                SELECT id, employee_code, name, email, phone, position, department,
                       joining_date, employment_type, lower(trim(role)) AS role, is_active
                FROM employees
                WHERE (:search = '' OR lower(name) LIKE lower(:pattern)
                       OR lower(email) LIKE lower(:pattern)
                       OR lower(employee_code) LIKE lower(:pattern)
                       OR lower(department) LIKE lower(:pattern)
                       OR lower(position) LIKE lower(:pattern))
                ORDER BY is_active DESC, lower(name)
            """, {"search": search, "pattern": f"%{search}%"})
        return jsonify({"employees": [dict(row) for row in rows]})

    data = request.get_json(silent=True) or {}
    values, error = employee_values(data, creating=True)
    if error:
        return fail(error)
    password = str(data["password"])
    try:
        with database_transaction() as conn:
            department_error = validate_department(conn, values["department"])
            if department_error:
                return fail(department_error)
            result = execute(conn, """
                INSERT INTO employees
                    (employee_code, name, email, password, phone, position,
                     department, joining_date, employment_type, role, must_change_password)
                VALUES
                    (:employee_code, :name, :email, :password, :phone, :position,
                     :department, :joining_date, :employment_type, :role, :must_change_password)
                RETURNING id
            """, {
                "employee_code": values["employee_code"] or None,
                "name": values["name"],
                "email": values["email"],
                "password": generate_password_hash(password),
                "phone": values["phone"],
                "position": values["position"],
                "department": values["department"] or None,
                "joining_date": values["joining_date"],
                "employment_type": values["employment_type"],
                "role": values["role"],
                "must_change_password": values["role"] == "employee",
            })
            employee_id = result.scalar_one()
            if not values["employee_code"]:
                execute(
                    conn,
                    "UPDATE employees SET employee_code = :employee_code WHERE id = :id",
                    {"employee_code": f"EMP-{employee_id:04d}", "id": employee_id},
                )
    except IntegrityError:
        return fail("Email or employee ID is already in use.", 409)
    return jsonify({"message": "Employee account created.", "id": employee_id}), 201


@admin_bp.route("/employees/<int:employee_id>", methods=["GET", "PUT", "DELETE"])
def employee_detail(employee_id):
    if request.method == "GET":
        with database_connection() as conn:
            employee = fetch_one(conn, """
                SELECT id, employee_code, name, email, phone, position, department,
                       joining_date, employment_type, lower(trim(role)) AS role, is_active
                FROM employees WHERE id = :id
            """, {"id": employee_id})
        if employee is None:
            return fail("Employee not found.", 404)
        return jsonify({"employee": dict(employee)})

    data = request.get_json(silent=True) or {} if request.method == "PUT" else None
    if request.method == "PUT":
        values, error = employee_values(data)
        if error:
            return fail(error)
        is_active = data.get("is_active", True)
        if not isinstance(is_active, bool):
            return fail("Account active must be true or false.")
        password = str(data.get("password", ""))
        if password and len(password) < 8:
            return fail("Password must contain at least 8 characters.")
    else:
        values = None
        password = ""
        is_active = False

    try:
        with database_transaction() as conn:
            existing = fetch_one(conn, f"""
                SELECT id, role FROM employees WHERE id = :id{for_update_clause()}
            """, {"id": employee_id})
            if existing is None:
                return fail("Employee not found.", 404)

            if request.method == "DELETE":
                if str(existing["role"]).strip().lower() == "admin":
                    return fail("Admin accounts cannot be deactivated here.", 409)
                if employee_id == session.get("user_id"):
                    return fail("You cannot deactivate your own account.", 409)
                execute(
                    conn,
                    "UPDATE employees SET is_active = FALSE WHERE id = :id",
                    {"id": employee_id},
                )
                return jsonify({"message": "Employee deactivated."})

            department_error = validate_department(conn, values["department"])
            if department_error:
                return fail(department_error)
            if employee_id == session.get("user_id") and (values["role"] != "admin" or not is_active):
                return fail("You cannot remove your own admin access.", 409)
            if str(existing["role"]).strip().lower() == "admin" and (
                values["role"] != "admin" or not is_active
            ):
                active_admins = execute(conn, """
                    SELECT count(*) FROM employees
                    WHERE lower(trim(role)) = 'admin' AND is_active = TRUE
                """).scalar_one()
                if active_admins <= 1:
                    return fail("At least one active admin account must remain.", 409)

            params = {
                field: None if field in {"employee_code", "department"} and not values[field]
                else values[field]
                for field in EMPLOYEE_FIELDS
            }
            params.update({"is_active": is_active, "id": employee_id})
            assignments = ", ".join(f"{field} = :{field}" for field in EMPLOYEE_FIELDS)
            execute(conn, f"""
                UPDATE employees SET {assignments}, is_active = :is_active
                WHERE id = :id
            """, params)
            if password:
                execute(conn, """
                    UPDATE employees
                    SET password = :password, must_change_password = :must_change_password
                    WHERE id = :id
                """, {
                    "password": generate_password_hash(password),
                    "must_change_password": values["role"] == "employee",
                    "id": employee_id,
                })
    except IntegrityError:
        return fail("Email or employee ID is already in use.", 409)
    return jsonify({"message": "Employee updated."})


@admin_bp.post("/employees/<int:employee_id>/reset-password")
def reset_employee_password(employee_id):
    data = request.get_json(silent=True) or {}
    temporary_password = str(data.get("temporary_password", ""))
    confirmation = str(data.get("confirm_password", ""))
    if len(temporary_password) < 8:
        return fail("Temporary password must contain at least 8 characters.")
    if temporary_password != confirmation:
        return fail("Temporary password and confirmation do not match.")

    with database_transaction() as conn:
        employee = fetch_one(
            conn,
            "SELECT role FROM employees WHERE id = :id",
            {"id": employee_id},
        )
        if employee is None:
            return fail("Employee not found.", 404)
        if str(employee["role"]).strip().lower() != "employee":
            return fail("Only employee account passwords can be reset here.", 409)
        execute(conn, """
            UPDATE employees
            SET password = :password, must_change_password = TRUE
            WHERE id = :id
        """, {
            "password": generate_password_hash(temporary_password),
            "id": employee_id,
        })
    return jsonify({
        "message": "Temporary password reset. The employee must change it at next sign-in."
    })


@admin_bp.get("/departments")
def get_departments():
    with database_connection() as conn:
        rows = fetch_all(conn, """
            SELECT id, department_name FROM departments ORDER BY lower(department_name)
        """)
    return jsonify({"departments": [dict(row) for row in rows]})


@admin_bp.post("/departments")
def create_department():
    data = request.get_json(silent=True) or {}
    name = str(data.get("department_name", "")).strip()
    if not name:
        return fail("Department name is required.")
    try:
        with database_transaction() as conn:
            department_id = execute(
                conn,
                "INSERT INTO departments (department_name) VALUES (:name) RETURNING id",
                {"name": name},
            ).scalar_one()
    except IntegrityError:
        return fail("That department already exists.", 409)
    return jsonify({"id": department_id, "department_name": name}), 201


@admin_bp.delete("/departments/<int:department_id>")
def delete_department(department_id):
    with database_transaction() as conn:
        department = fetch_one(
            conn,
            "SELECT department_name FROM departments WHERE id = :id",
            {"id": department_id},
        )
        if department is None:
            return fail("Department not found.", 404)
        assigned = execute(
            conn,
            "SELECT count(*) FROM employees WHERE department = :department_name",
            {"department_name": department["department_name"]},
        ).scalar_one()
        if assigned:
            return fail("Reassign employees before removing this department.", 409)
        execute(conn, "DELETE FROM departments WHERE id = :id", {"id": department_id})
    return jsonify({"message": "Department removed."})


@admin_bp.get("/attendance")
def attendance_report():
    clauses, params, error = attendance_filters()
    if error:
        return fail(error)
    with database_connection() as conn:
        rows = fetch_all(conn, attendance_query(clauses), params)
    return jsonify({"attendance": attendance_rows_with_hours(rows)})


@admin_bp.get("/attendance/export")
def export_attendance():
    clauses, params, error = attendance_filters()
    if error:
        return fail(error)
    with database_connection() as conn:
        rows = fetch_all(conn, attendance_query(clauses), params)
    rows = attendance_rows_with_hours(rows)
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    columns = (
        "date", "employee_code", "name", "department",
        "check_in", "check_out", "hours", "status",
    )
    writer.writerow(columns)
    for row in rows:
        values = []
        for column in columns:
            value = "" if row[column] is None else str(row[column])
            if re.match(r"^\s*[=+\-@]", value):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendance-report.csv"},
    )


@admin_bp.get("/leaves")
def get_leaves():
    status = request.args.get("status", "").strip()
    if status and status not in ("Pending", "Approved", "Rejected"):
        return fail("Status must be Pending, Approved, or Rejected.")
    with database_connection() as conn:
        if status in ("Pending", "Approved", "Rejected"):
            rows = fetch_all(conn, """
                SELECT l.id, l.from_date, l.to_date, l.reason, l.status, l.created_at,
                       e.id AS employee_id, e.employee_code, e.name, e.department
                FROM leaves l JOIN employees e ON e.id = l.employee_id
                WHERE l.status = :status ORDER BY l.created_at DESC
            """, {"status": status})
        else:
            rows = fetch_all(conn, """
                SELECT l.id, l.from_date, l.to_date, l.reason, l.status, l.created_at,
                       e.id AS employee_id, e.employee_code, e.name, e.department
                FROM leaves l JOIN employees e ON e.id = l.employee_id
                ORDER BY CASE l.status WHEN 'Pending' THEN 0 ELSE 1 END, l.created_at DESC
            """)
    return jsonify({"leaves": [dict(row) for row in rows]})


@admin_bp.patch("/leaves/<int:leave_id>")
def update_leave(leave_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("Approved", "Rejected"):
        return fail("Status must be Approved or Rejected.")
    with database_transaction() as conn:
        result = execute(conn, """
            UPDATE leaves SET status = :status
            WHERE id = :id AND status = 'Pending'
        """, {"status": status, "id": leave_id})
        if not result.rowcount:
            return fail("Pending leave request not found.", 404)
    return jsonify({"message": f"Leave request {status.lower()}."})
