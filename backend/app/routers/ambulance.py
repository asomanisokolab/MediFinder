"""Ambulance provider directory (PRD v1.1 section 5.1.6).

The defining rule: coverage is resolved before distance. The nearest base
station does not always serve the caller's district, so a provider that
covers the caller outranks a closer one that does not.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, haversine_km
from ..geo import bounding_box, distance_km_expr, valid_coordinates
from ..models import AmbulanceCoverage, AmbulanceProvider, Facility
from ..presenters import ambulance_detail, ambulance_summary, page
from ..reference import REGION_CENTROIDS
from ..schemas import AmbulanceDetail, AmbulanceSummary, Page

router = APIRouter(prefix="/ambulance", tags=["ambulance"])

# A provider still on its placeholder location is never listed publicly.
_LISTED = AmbulanceProvider.location_confirmed.is_(True)


def resolve_area(db: Session, lat: float, lng: float) -> tuple[str | None, str | None]:
    """Best-effort (region, district) for a coordinate.

    Uses the nearest known facility, which is real surveyed data, and falls
    back to region centroids only when nothing is close. Replace wholesale
    with a PostGIS point-in-polygon lookup against district boundaries once
    the boundary dataset is loaded.
    """
    dist = distance_km_expr(Facility.lat, Facility.lng, lat, lng)
    row = db.execute(
        select(Facility, dist.label("d"))
        .where(Facility.location_confirmed.is_(True))
        .order_by(dist.asc())
        .limit(1)
    ).first()
    if row is not None and row[1] is not None and row[1] <= 120:
        facility = row[0]
        return facility.region, (facility.city or facility.town or None)

    best, best_d = None, None
    for region, (rlat, rlng) in REGION_CENTROIDS.items():
        d = haversine_km(lat, lng, rlat, rlng)
        if best_d is None or d < best_d:
            best, best_d = region, d
    return best, None


def _filters(
    region: str | None,
    district: str | None,
    operator_type: str | None,
    service_level: str | None,
    is_24_hour: bool | None,
    q: str | None,
):
    conds = [_LISTED]
    if region:
        conds.append(func.lower(AmbulanceProvider.region) == region.strip().lower())
    if district:
        conds.append(func.lower(AmbulanceProvider.district) == district.strip().lower())
    if operator_type:
        conds.append(AmbulanceProvider.operator_type == operator_type.strip().lower())
    if service_level:
        conds.append(AmbulanceProvider.service_level == service_level.strip().upper())
    if is_24_hour is not None:
        conds.append(AmbulanceProvider.is_24_hour.is_(is_24_hour))
    if q:
        like = f"%{q.strip().lower()}%"
        conds.append(
            or_(
                func.lower(AmbulanceProvider.name).like(like),
                func.lower(AmbulanceProvider.region).like(like),
                func.lower(AmbulanceProvider.district).like(like),
                func.lower(AmbulanceProvider.base_address).like(like),
            )
        )
    return conds


def covering_providers(
    db: Session, lat: float, lng: float, limit: int, service_level: str | None = None
) -> tuple[list[dict], str | None, str | None]:
    """Providers that cover the caller's area, then nearest as a backstop."""
    region, district = resolve_area(db, lat, lng)
    dist = distance_km_expr(AmbulanceProvider.lat, AmbulanceProvider.lng, lat, lng)

    results: list[dict] = []
    seen: set[int] = set()

    if region:
        conds = [
            _LISTED,
            AmbulanceProvider.coverage.any(
                func.lower(AmbulanceCoverage.region) == region.lower()
            ),
        ]
        if service_level:
            conds.append(AmbulanceProvider.service_level == service_level.strip().upper())
        rows = db.execute(
            select(AmbulanceProvider, dist.label("d"))
            .where(*conds)
            .order_by(dist.asc())
            .limit(limit * 3)
        ).all()

        def district_rank(provider) -> int:
            if not district:
                return 1
            for c in provider.coverage:
                if c.district and c.district.lower() == district.lower():
                    return 0
            return 1

        for provider, d in sorted(rows, key=lambda r: (district_rank(r[0]), r[1])):
            if provider.id in seen:
                continue
            seen.add(provider.id)
            results.append(ambulance_summary(provider, d, covers_user_area=True))
            if len(results) >= limit:
                break

    # Backstop: if coverage data is thin, still return the nearest providers
    # rather than nothing, clearly flagged as not covering the caller.
    if len(results) < limit:
        min_lat, max_lat, min_lng, max_lng = bounding_box(
            lat, lng, settings.EMERGENCY_RADIUS_KM
        )
        conds = [
            _LISTED,
            AmbulanceProvider.lat.between(min_lat, max_lat),
            AmbulanceProvider.lng.between(min_lng, max_lng),
        ]
        if service_level:
            conds.append(AmbulanceProvider.service_level == service_level.strip().upper())
        rows = db.execute(
            select(AmbulanceProvider, dist.label("d"))
            .where(*conds)
            .order_by(dist.asc())
            .limit(limit * 3)
        ).all()
        for provider, d in rows:
            if provider.id in seen:
                continue
            seen.add(provider.id)
            results.append(ambulance_summary(provider, d, covers_user_area=False))
            if len(results) >= limit:
                break

    return results, region, district


@router.get("/covering", response_model=Page[AmbulanceSummary])
def providers_covering(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    service_level: str | None = None,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Providers whose coverage includes a lat/lng coordinate (PRD 6.4)."""
    if not valid_coordinates(lat, lng):
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    items, _region, _district = covering_providers(db, lat, lng, limit, service_level)
    return page(items, len(items), 1, limit)


@router.get("/providers", response_model=Page[AmbulanceSummary])
def list_providers(
    region: str | None = None,
    district: str | None = None,
    operator_type: str | None = None,
    service_level: str | None = None,
    is_24_hour: bool | None = None,
    q: str | None = None,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """List ambulance providers with optional filters (PRD 6.4)."""
    conds = _filters(region, district, operator_type, service_level, is_24_hour, q)
    total = db.scalar(select(func.count(AmbulanceProvider.id)).where(*conds)) or 0

    if lat is not None and lng is not None:
        dist = distance_km_expr(AmbulanceProvider.lat, AmbulanceProvider.lng, lat, lng)
        rows = db.execute(
            select(AmbulanceProvider, dist.label("d"))
            .where(*conds)
            .order_by(dist.asc())
            .offset((page_no - 1) * page_size)
            .limit(page_size)
        ).all()
        items = [ambulance_summary(p, d) for p, d in rows]
    else:
        rows = db.scalars(
            select(AmbulanceProvider)
            .where(*conds)
            .order_by(AmbulanceProvider.verified.desc(), AmbulanceProvider.name.asc())
            .offset((page_no - 1) * page_size)
            .limit(page_size)
        ).all()
        items = [ambulance_summary(p) for p in rows]

    return page(items, total, page_no, page_size)


@router.get("/providers/{provider_id}", response_model=AmbulanceDetail)
def get_provider(
    provider_id: int,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    db: Session = Depends(get_db),
):
    """Full profile for one ambulance provider (PRD 6.4)."""
    provider = db.get(AmbulanceProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Ambulance provider not found")

    distance = None
    covers = None
    if lat is not None and lng is not None:
        distance = haversine_km(lat, lng, provider.lat, provider.lng)
        region, _district = resolve_area(db, lat, lng)
        if region:
            covers = any(c.region.lower() == region.lower() for c in provider.coverage)
    return ambulance_detail(provider, distance, covers)
