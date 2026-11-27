from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app, has_app_context


def office_timezone():
    name = current_app.config.get("OFFICE_TIMEZONE") if has_app_context() else None
    if name:
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError as error:
            raise RuntimeError(f"Unknown office timezone: {name}") from error
    return datetime.now().astimezone().tzinfo or timezone.utc


def office_timezone_name():
    name = current_app.config.get("OFFICE_TIMEZONE") if has_app_context() else None
    if name:
        return name
    return datetime.now(office_timezone()).tzname() or "local"


def office_now():
    return datetime.now(office_timezone())


def office_today():
    return office_now().date()


def elapsed_hours(check_in, check_out):
    if not check_in or not check_out:
        return None
    start = datetime.strptime(check_in, "%H:%M:%S")
    end = datetime.strptime(check_out, "%H:%M:%S")
    return round(max(0, (end - start).total_seconds()) / 3600, 2)
