"""Distance calculation -- the single swap point between SQLite and PostGIS.

PRD 6.3: "Distance calculated server-side using PostGIS ST_Distance or
Haversine formula." Routes call `distance_km_expr()` and never care which
backend answers.
"""
import math

from sqlalchemy import func

from .database import IS_POSTGRES


def distance_km_expr(lat_col, lng_col, lat: float, lng: float):
    """SQL expression giving distance in km from (lat, lng) to a row's point.

    SQLite  -> haversine_km(), registered in database.py.
    Postgres -> ST_DistanceSphere(), which ships with PostGIS and needs no
                Python-side dependency. Swap to a geography column plus a
                GiST index here when the dataset outgrows a sequential scan.
    """
    if IS_POSTGRES:
        return (
            func.ST_DistanceSphere(
                func.ST_MakePoint(lng_col, lat_col),
                func.ST_MakePoint(lng, lat),
            )
            / 1000.0
        )
    return func.haversine_km(lat_col, lng_col, lat, lng)


def bounding_box(lat: float, lng: float, radius_km: float):
    """Cheap pre-filter so we only run trigonometry on plausible candidates.

    Returns (min_lat, max_lat, min_lng, max_lng). Slightly over-wide on
    purpose -- the exact distance filter runs afterwards.
    """
    dlat = radius_km / 110.574
    cos_lat = max(0.01, math.cos(math.radians(lat)))
    dlng = radius_km / (111.320 * cos_lat)
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


def valid_coordinates(lat: float, lng: float) -> bool:
    return lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180
