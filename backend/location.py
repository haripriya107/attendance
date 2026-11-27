import math


EARTH_RADIUS_METERS = 6_371_000
BOUNDARY_TOLERANCE_METERS = 1e-6


def is_finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def is_coordinate(value, minimum, maximum):
    return (
        is_finite_number(value)
        and minimum <= value <= maximum
    )


def haversine_distance_meters(latitude, longitude, office_latitude, office_longitude):
    latitude_delta = math.radians(office_latitude - latitude)
    longitude_delta = math.radians(office_longitude - longitude)
    latitude_radians = math.radians(latitude)
    office_latitude_radians = math.radians(office_latitude)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(latitude_radians)
        * math.cos(office_latitude_radians)
        * math.sin(longitude_delta / 2) ** 2
    )
    haversine = min(1.0, max(0.0, haversine))
    central_angle = 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))
    return EARTH_RADIUS_METERS * central_angle
