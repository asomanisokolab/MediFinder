"""Emergency mode (PRD 5.1.4, extended in v1.1 for ambulances).

One request, because a person in trouble on a 3G connection should not wait
for three round trips. No authentication, no filters, and never rate limited.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..geo import bounding_box, distance_km_expr, valid_coordinates
from ..models import AmbulanceCoverage, AmbulanceProvider, Facility
from ..presenters import ambulance_summary, facility_summary
from ..reference import HEALTH_FACILITY_CATEGORIES
from ..schemas import EmergencyOut
from .ambulance import covering_providers

router = APIRouter(prefix="/emergency", tags=["emergency"])

# PRD 10: the product places a call, it does not dispatch. Said plainly,
# in the payload, so no client can quietly drop it.
NOTICE = (
    "FindCare shows you providers and places the call. It does not dispatch "
    "an ambulance. If no one answers, call {number}."
)

# Only places that treat patients, at a confirmed location. A pharmacy or
# hearse service is not an emergency answer.
_EMERGENCY_FACILITIES = (
    Facility.category.in_(HEALTH_FACILITY_CATEGORIES),
    Facility.location_confirmed.is_(True),
)


def _nearest_facilities(db: Session, lat: float, lng: float, limit: int) -> list[dict]:
    dist = distance_km_expr(Facility.lat, Facility.lng, lat, lng)
    min_lat, max_lat, min_lng, max_lng = bounding_box(
        lat, lng, settings.EMERGENCY_RADIUS_KM
    )
    box = [
        Facility.lat.between(min_lat, max_lat),
        Facility.lng.between(min_lng, max_lng),
        *_EMERGENCY_FACILITIES,
    ]

    # Open first, then nearest. A closed facility is not an emergency answer.
    rows = db.execute(
        select(Facility, dist.label("d"))
        .where(*box, Facility.is_24_hour.is_(True))
        .order_by(dist.asc())
        .limit(limit)
    ).all()

    picked = {f.id for f, _ in rows}
    if len(rows) < limit:
        backfill = db.execute(
            select(Facility, dist.label("d"))
            .where(*box)
            .order_by(dist.asc())
            .limit(limit * 3)
        ).all()
        for f, d in backfill:
            if f.id in picked:
                continue
            rows.append((f, d))
            picked.add(f.id)
            if len(rows) >= limit:
                break

    return [facility_summary(f, d) for f, d in rows[:limit]]


@router.get("", response_model=EmergencyOut)
def emergency(
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    region: str | None = Query(None, description="GPS-denied fallback (PRD 5.1.4)"),
    db: Session = Depends(get_db),
):
    """Nearest open facilities and covering ambulance providers, in one call."""
    limit = settings.EMERGENCY_RESULT_COUNT
    notice = NOTICE.format(number=settings.NATIONAL_EMERGENCY_NUMBER)

    if lat is not None and lng is not None:
        if not valid_coordinates(lat, lng):
            raise HTTPException(status_code=400, detail="Invalid coordinates")
        providers, located_region, _district = covering_providers(db, lat, lng, limit)
        return {
            "emergency_number": settings.NATIONAL_EMERGENCY_NUMBER,
            "notice": notice,
            "data_verified": settings.DATA_VERIFIED,
            "facilities": _nearest_facilities(db, lat, lng, limit),
            "ambulance_providers": providers,
            "located_region": located_region,
        }

    if not region:
        raise HTTPException(
            status_code=400,
            detail="Provide lat and lng, or a region if location is unavailable.",
        )

    # GPS denied: fall back to region selection.
    facilities = db.scalars(
        select(Facility)
        .where(func.lower(Facility.region) == region.strip().lower(), *_EMERGENCY_FACILITIES)
        .order_by(Facility.is_24_hour.desc(), Facility.verified.desc(), Facility.name.asc())
        .limit(limit)
    ).all()
    providers = db.scalars(
        select(AmbulanceProvider)
        .where(
            AmbulanceProvider.location_confirmed.is_(True),
            AmbulanceProvider.coverage.any(
                func.lower(AmbulanceCoverage.region) == region.strip().lower()
            ),
        )
        .order_by(AmbulanceProvider.verified.desc(), AmbulanceProvider.name.asc())
        .limit(limit)
    ).all()

    return {
        "emergency_number": settings.NATIONAL_EMERGENCY_NUMBER,
        "notice": notice,
        "data_verified": settings.DATA_VERIFIED,
        "facilities": [facility_summary(f) for f in facilities],
        "ambulance_providers": [
            ambulance_summary(p, covers_user_area=True) for p in providers
        ],
        "located_region": region,
    }
