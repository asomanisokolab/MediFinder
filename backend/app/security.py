"""Password hashing and JWT auth (PRD 8: bcrypt, JWT expiring in 8 hours)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Admin, SuperAdmin

bearer_scheme = HTTPBearer(auto_error=False)

# bcrypt silently truncates beyond 72 bytes; reject rather than truncate.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        raise ValueError("password exceeds 72 bytes")
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    raw = password.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(raw, password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(admin: Admin) -> tuple[str, int]:
    expires_in = settings.JWT_EXPIRE_HOURS * 3600
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin.id),
        "role": "admin",
        "email": admin.email,
        "scope": "facility" if admin.facility_id else "provider",
        "facility_id": admin.facility_id,
        "provider_id": admin.provider_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_in


def create_superadmin_access_token(admin: SuperAdmin) -> tuple[str, int]:
    expires_in = settings.JWT_EXPIRE_HOURS * 3600
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin.id),
        "role": "superadmin",
        "email": admin.email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_in


def _unauthorised(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Admin:
    if credentials is None:
        raise _unauthorised()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorised("Session expired. Sign in again.")
    except jwt.InvalidTokenError:
        raise _unauthorised("Invalid token")

    if payload.get("role", "admin") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization administrator access required.",
        )
    admin = db.get(Admin, int(payload.get("sub", 0)))
    if admin is None:
        raise _unauthorised("Unknown account")
    return admin


def get_current_superadmin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> SuperAdmin:
    if credentials is None:
        raise _unauthorised()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorised("Session expired. Sign in again.")
    except jwt.InvalidTokenError:
        raise _unauthorised("Invalid token")

    if payload.get("role") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required.",
        )
    superadmin = db.get(SuperAdmin, int(payload.get("sub", 0)))
    if superadmin is None:
        raise _unauthorised("Unknown account")
    return superadmin


def require_facility(admin: Admin, facility_id: int) -> None:
    """An admin may only write to the facility they administer."""
    if admin.facility_id != facility_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not administer this facility.",
        )


def require_provider(admin: Admin, provider_id: int) -> None:
    if admin.provider_id != provider_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not administer this ambulance provider.",
        )
