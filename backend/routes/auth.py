from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash

from backend.database import database_connection, fetch_one


auth_bp = Blueprint("auth", __name__)


def normalized_role(value):
    return str(value or "").strip().lower()


def employee_payload(employee):
    return {
        "id": employee["id"],
        "employee_code": employee["employee_code"],
        "name": employee["name"],
        "email": employee["email"],
        "phone": employee["phone"],
        "position": employee["position"],
        "department": employee["department"],
        "joining_date": employee["joining_date"],
        "employment_type": employee["employment_type"],
        "role": normalized_role(employee["role"]),
        "is_active": bool(employee["is_active"]),
        "must_change_password": bool(employee["must_change_password"]),
    }


@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or request.form
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not email or not password:
        return jsonify({"message": "Email and password are required."}), 400

    with database_connection() as conn:
        employee = fetch_one(
            conn,
            "SELECT * FROM employees WHERE lower(email) = :email AND is_active = TRUE",
            {"email": email},
        )

    if employee is None or not check_password_hash(employee["password"], password):
        return jsonify({"message": "Invalid email or password."}), 401

    role = normalized_role(employee["role"])
    if role not in ("admin", "employee"):
        return jsonify({"message": "This account has no valid application role."}), 403
    session.clear()
    session["user_id"] = employee["id"]
    session["role"] = role
    return jsonify({
        "message": "Signed in successfully.",
        "redirect": "/admin" if role == "admin" else "/employee",
        "user": employee_payload(employee),
    })


@auth_bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"message": "Signed out."})


@auth_bp.get("/me")
def me():
    employee_id = session.get("user_id")
    if not employee_id:
        return jsonify({"message": "Authentication required."}), 401
    with database_connection() as conn:
        employee = fetch_one(
            conn,
            "SELECT * FROM employees WHERE id = :id AND is_active = TRUE",
            {"id": employee_id},
        )
    if employee is None:
        session.clear()
        return jsonify({"message": "Authentication required."}), 401
    return jsonify({"user": employee_payload(employee)})
