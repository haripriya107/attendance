from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, session
from sqlalchemy.exc import IntegrityError

from backend.location import (
    BOUNDARY_TOLERANCE_METERS,
    haversine_distance_meters,
    is_coordinate,
)
from backend.database import (
    database_connection,
    database_transaction,
    execute,
    fetch_all,
    fetch_one,
    for_update_clause,
)
from backend.timeutils import elapsed_hours, office_now


attendance_bp = Blueprint("attendance", __name__)


def fail(message, status=400):
    return jsonify({"message": message}), status


def official_check_in_time():
    configured_time = current_app.config.get("OFFICIAL_CHECK_IN_TIME", "09:30")
    try:
        cutoff = datetime.strptime(configured_time, "%H:%M").time()
    except (TypeError, ValueError) as error:
        raise RuntimeError(
            "OFFICIAL_CHECK_IN_TIME must use 24-hour HH:MM format, such as 09:30."
        ) from error
    if cutoff.strftime("%H:%M") != configured_time:
        raise RuntimeError(
            "OFFICIAL_CHECK_IN_TIME must use 24-hour HH:MM format, such as 09:30."
        )
    return cutoff


@attendance_bp.get("/today")
def today():
    employee_id = session["user_id"]
    now = office_now()
    today_date = now.date().isoformat()
    with database_connection() as conn:
        row = fetch_one(
            conn,
            "SELECT date, check_in, check_out, status FROM attendance "
            "WHERE employee_id = :employee_id AND date = :today",
            {"employee_id": employee_id, "today": today_date},
        )
        leave = fetch_one(conn, """
            SELECT 1 FROM leaves WHERE employee_id = :employee_id AND status = 'Approved'
              AND from_date <= :today AND to_date >= :today LIMIT 1
        """, {"employee_id": employee_id, "today": today_date})
    record = dict(row) if row else None
    elapsed_seconds = None
    if record and record["check_in"]:
        start = datetime.combine(
            now.date(),
            datetime.strptime(record["check_in"], "%H:%M:%S").time(),
        )
        end = (
            datetime.combine(
                now.date(),
                datetime.strptime(record["check_out"], "%H:%M:%S").time(),
            )
            if record["check_out"]
            else now.replace(tzinfo=None)
        )
        elapsed_seconds = max(0, int((end - start).total_seconds()))
    return jsonify({
        "date": today_date,
        "record": record,
        "on_leave": bool(leave),
        "hours": round(elapsed_seconds / 3600, 2) if elapsed_seconds is not None and record["check_out"] else None,
        "elapsed_seconds": elapsed_seconds,
    })


@attendance_bp.post("/check-in")
def check_in():
    employee_id = session["user_id"]
    now = office_now()
    work_date = now.date().isoformat()
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return fail("Current latitude and longitude are required.")
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    for value, minimum, maximum, label in (
        (latitude, -90, 90, "Latitude"),
        (longitude, -180, 180, "Longitude"),
    ):
        if not is_coordinate(value, minimum, maximum):
            return fail(f"{label} must be a valid coordinate.")

    try:
        with database_transaction() as conn:
            office_location = fetch_one(conn, """
                SELECT latitude, longitude, radius_meters
                FROM office_location_settings WHERE id = 1
            """)
            if (
                office_location is None
                or office_location["latitude"] is None
                or office_location["longitude"] is None
            ):
                return jsonify({
                    "message": "The office location has not been configured. Contact an Admin.",
                    "code": "office_location_unconfigured",
                }), 503
            distance_meters = haversine_distance_meters(
                latitude,
                longitude,
                office_location["latitude"],
                office_location["longitude"],
            )
            radius_meters = office_location["radius_meters"]
            if distance_meters > radius_meters + BOUNDARY_TOLERANCE_METERS:
                return jsonify({
                    "message": (
                        f"You are outside the allowed office radius "
                        f"({distance_meters:.1f} m away; maximum {radius_meters:g} m)."
                    ),
                    "code": "outside_office_radius",
                    "distance_meters": round(distance_meters, 1),
                    "radius_meters": radius_meters,
                }), 403

            on_leave = fetch_one(conn, """
                SELECT 1 FROM leaves WHERE employee_id = :employee_id
                  AND status = 'Approved'
                  AND from_date <= :work_date AND to_date >= :work_date LIMIT 1
            """, {"employee_id": employee_id, "work_date": work_date})
            if on_leave:
                return fail("You have approved leave for today.", 409)
            status = (
                "Late"
                if now.time().replace(tzinfo=None) > official_check_in_time()
                else "Present"
            )
            execute(conn, """
                INSERT INTO attendance (employee_id, date, check_in, status)
                VALUES (:employee_id, :work_date, :check_in, :status)
            """, {
                "employee_id": employee_id,
                "work_date": work_date,
                "check_in": now.strftime("%H:%M:%S"),
                "status": status,
            })
    except IntegrityError:
        return fail("You have already checked in today.", 409)
    return jsonify({
        "message": "Location verified and check-in recorded.",
        "date": work_date,
        "check_in": now.strftime("%H:%M:%S"),
        "status": status,
        "distance_meters": round(distance_meters, 1),
        "radius_meters": radius_meters,
    }), 201


@attendance_bp.post("/check-out")
def check_out():
    employee_id = session["user_id"]
    now = office_now()
    work_date = now.date().isoformat()
    with database_transaction() as conn:
        record = fetch_one(conn, f"""
            SELECT check_in, check_out FROM attendance
            WHERE employee_id = :employee_id AND date = :work_date{for_update_clause()}
        """, {"employee_id": employee_id, "work_date": work_date})
        if record is None or not record["check_in"]:
            return fail("Check in before checking out.", 409)
        if record["check_out"]:
            return fail("You have already checked out today.", 409)
        check_in_time = datetime.strptime(record["check_in"], "%H:%M:%S").time()
        if now.time().replace(tzinfo=None) <= check_in_time:
            return fail("Check-out time must be after check-in time.", 409)

        check_out_time = now.strftime("%H:%M:%S")
        execute(conn, """
            UPDATE attendance SET check_out = :check_out
            WHERE employee_id = :employee_id AND date = :work_date
        """, {
            "check_out": check_out_time,
            "employee_id": employee_id,
            "work_date": work_date,
        })
    hours = round((
        datetime.combine(now.date(), now.time().replace(tzinfo=None))
        - datetime.combine(now.date(), check_in_time)
    ).total_seconds() / 3600, 2)
    return jsonify({
        "message": "Check-out recorded.",
        "date": work_date,
        "check_out": check_out_time,
        "hours": hours,
    })


@attendance_bp.get("/history")
def history():
    with database_connection() as conn:
        rows = fetch_all(conn, """
            SELECT date, check_in, check_out, status
            FROM attendance WHERE employee_id = :employee_id
            ORDER BY date DESC
        """, {"employee_id": session["user_id"]})
    attendance = [dict(row) for row in rows]
    for row in attendance:
        row["hours"] = elapsed_hours(row["check_in"], row["check_out"])
    return jsonify({"attendance": attendance})
