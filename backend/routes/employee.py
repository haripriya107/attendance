from datetime import date

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import (
    database_connection,
    database_transaction,
    execute,
    fetch_all,
    fetch_one,
)
from backend.routes.auth import employee_payload
from backend.timeutils import office_now


employee_bp = Blueprint("employee", __name__)


@employee_bp.route("/profile", methods=["GET", "PUT"])
def profile():
    employee_id = session["user_id"]
    if request.method == "PUT":
        data = request.get_json(silent=True) or {}
        unsupported = set(data) - {"name", "phone"}
        if unsupported:
            return jsonify({
                "message": "Only your name and phone number can be changed here."
            }), 400
        name = str(data.get("name", "")).strip()
        phone = str(data.get("phone", "")).strip()
        if not name or len(name) > 120:
            return jsonify({"message": "Enter a name of at most 120 characters."}), 400
        if len(phone) > 40:
            return jsonify({"message": "Phone number must be at most 40 characters."}), 400
        with database_transaction() as conn:
            result = execute(
                conn,
                "UPDATE employees SET name = :name, phone = :phone WHERE id = :id",
                {"name": name, "phone": phone, "id": employee_id},
            )
            if not result.rowcount:
                return jsonify({"message": "Employee profile not found."}), 404
            employee = fetch_one(conn, "SELECT * FROM employees WHERE id = :id", {"id": employee_id})
    else:
        with database_connection() as conn:
            employee = fetch_one(conn, "SELECT * FROM employees WHERE id = :id", {"id": employee_id})
    return jsonify({"employee": employee_payload(employee)})


@employee_bp.post("/password")
def change_password():
    data = request.get_json(silent=True) or {}
    current_password = str(data.get("current_password", ""))
    new_password = str(data.get("new_password", ""))
    confirm_password = str(data.get("confirm_password", ""))
    if not current_password or not new_password or not confirm_password:
        return jsonify({"message": "Complete all password fields."}), 400
    if len(new_password) < 8:
        return jsonify({"message": "New password must contain at least 8 characters."}), 400
    if new_password != confirm_password:
        return jsonify({"message": "New password and confirmation do not match."}), 400
    if new_password == current_password:
        return jsonify({"message": "Choose a password different from your current password."}), 400

    with database_connection() as conn:
        employee = fetch_one(
            conn,
            "SELECT password FROM employees WHERE id = :id",
            {"id": session["user_id"]},
        )
    if employee is None or not check_password_hash(employee["password"], current_password):
        return jsonify({"message": "Current password is incorrect."}), 400
    with database_transaction() as conn:
        execute(
            conn,
            "UPDATE employees SET password = :password, must_change_password = FALSE WHERE id = :id",
            {"password": generate_password_hash(new_password), "id": session["user_id"]},
        )
    return jsonify({"message": "Password changed successfully."})


@employee_bp.route("/leaves", methods=["GET", "POST"])
def leaves():
    employee_id = session["user_id"]
    if request.method == "GET":
        with database_connection() as conn:
            rows = fetch_all(conn, """
                SELECT id, from_date, to_date, reason, status, created_at
                FROM leaves WHERE employee_id = :employee_id ORDER BY created_at DESC
            """, {"employee_id": employee_id})
        return jsonify({"leaves": [dict(row) for row in rows]})

    data = request.get_json(silent=True) or {}
    start = str(data.get("from_date", "")).strip()
    end = str(data.get("to_date", "")).strip()
    reason = str(data.get("reason", "")).strip()
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except ValueError:
        return jsonify({"message": "Enter valid leave dates."}), 400
    if start_date.isoformat() != start or end_date.isoformat() != end:
        return jsonify({"message": "Enter valid leave dates."}), 400
    if end_date < start_date:
        return jsonify({"message": "End date cannot be before start date."}), 400
    if not reason:
        return jsonify({"message": "A reason is required."}), 400

    created_at = office_now().isoformat(timespec="seconds")
    with database_transaction() as conn:
        overlap = fetch_one(conn, """
            SELECT 1 FROM leaves WHERE employee_id = :employee_id
              AND status IN ('Pending', 'Approved')
              AND from_date <= :end_date AND to_date >= :start_date LIMIT 1
        """, {"employee_id": employee_id, "end_date": end, "start_date": start})
        if overlap:
            return jsonify({"message": "These dates overlap an existing leave request."}), 409
        execute(conn, """
            INSERT INTO leaves (employee_id, from_date, to_date, reason, status, created_at)
            VALUES (:employee_id, :from_date, :to_date, :reason, 'Pending', :created_at)
        """, {
            "employee_id": employee_id,
            "from_date": start,
            "to_date": end,
            "reason": reason,
            "created_at": created_at,
        })
    return jsonify({"message": "Leave request submitted."}), 201
