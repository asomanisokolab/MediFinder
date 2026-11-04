"""Application settings.

Everything that differs between the SQLite MVP and the PostgreSQL/PostGIS
deployment is read from the environment, so the swap is a config change
plus the dialect branch in geo.py -- no route or model changes.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
DATA_DIR = PROJECT_DIR / "data"


class Settings:
    # --- database -------------------------------------------------------
    # SQLite for the MVP. To swap:
    #   set MEDIFINDER_DATABASE_URL=postgresql+psycopg://user:pw@host/medifinder
    # and run `python -m app.seed --reset`. PostGIS is picked up automatically
    # by geo.py once the dialect reports postgresql.
    DATABASE_URL: str = os.getenv(
        "MEDIFINDER_DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'medifinder.db'}"
    )

    # --- auth (PRD section 8) -------------------------------------------
    JWT_SECRET: str = os.getenv("MEDIFINDER_JWT_SECRET", "dev-secret-change-before-deploy")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 8

    # --- organization login messages -------------------------------------
    # The app sends no email. The superadmin sends each login message from
    # their own mailbox, using the text the dashboard prepares.
    # Contact address given in that message and in the site footer.
    SUPPORT_EMAIL: str = "info@findcareghana.com"
    # Base URL used in the sign-in link, e.g. https://findcareghana.com.
    # Falls back to the URL of the incoming request.
    PUBLIC_URL: str = os.getenv("MEDIFINDER_PUBLIC_URL", "").rstrip("/")

    # --- api ------------------------------------------------------------
    API_PREFIX: str = "/api/v1"
    CORS_ORIGINS: list = os.getenv("MEDIFINDER_CORS_ORIGINS", "*").split(",")
    RATE_LIMIT_PER_MINUTE: int = int(os.getenv("MEDIFINDER_RATE_LIMIT", "120"))
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100

    # --- domain rules ---------------------------------------------------
    # PRD 7.3: bed availability and ambulance fleet status expire after 24h.
    STALE_AFTER_HOURS: int = 24
    # PRD 5.1.4: emergency mode returns three of each.
    EMERGENCY_RESULT_COUNT: int = 3
    # PRD 5.1.6 / 10: the national emergency short code is always shown.
    NATIONAL_EMERGENCY_NUMBER: str = "112"
    # Radius used to pre-filter before exact distance is computed.
    NEARBY_RADIUS_KM: float = 50.0
    EMERGENCY_RADIUS_KM: float = 150.0

    # --- data provenance -------------------------------------------------
    # The shipped dataset is unverified seed data (PRD 7.1). Every API
    # response carries this flag and the UI shows a banner while it is true.
    # Set to "false" only once records have been verified per PRD 7.3.
    DATA_VERIFIED: bool = os.getenv("MEDIFINDER_DATA_VERIFIED", "false").lower() == "true"


settings = Settings()
