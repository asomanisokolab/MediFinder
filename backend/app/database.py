"""Engine, session, and the SQLite maths shim.

SQLite has no geospatial functions, so we register `haversine_km` as a
connection-level Python function. PostgreSQL/PostGIS provides the equivalent
natively, so nothing here is needed after the swap -- see geo.py.
"""
import math

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

_is_sqlite_url = settings.DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite_url else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
)

DIALECT = engine.dialect.name
IS_SQLITE = DIALECT == "sqlite"
IS_POSTGRES = DIALECT == "postgresql"

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in kilometres. PRD 6.3 permits Haversine."""
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _register_sqlite_functions(dbapi_connection, _record):
        dbapi_connection.create_function("haversine_km", 4, haversine_km)
        dbapi_connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


# Columns added after tables already existed in production. create_all()
# only creates missing tables, so these are added in place on startup.
# (table, column, type and default) -- defaults keep existing rows valid.
_ADDED_COLUMNS = [
    ("facilities", "category", "VARCHAR(30) NOT NULL DEFAULT 'hospital'"),
    ("facilities", "location_confirmed", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("ambulance_providers", "location_confirmed", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("admins", "must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"),
]

# Tables no longer in the models. Only dropped by the destructive seed
# commands, because their foreign keys would otherwise block drop_all().
LEGACY_TABLES = ("admin_registration_requests",)


def ensure_schema() -> None:
    """Create missing tables and add missing columns. Safe to run repeatedly."""
    from . import models  # noqa: F401  -- registers every table on Base

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def drop_legacy_tables() -> None:
    with engine.begin() as conn:
        for table in LEGACY_TABLES:
            conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
