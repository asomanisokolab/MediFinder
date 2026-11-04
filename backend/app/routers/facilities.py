"""Facility directory, search and profile (PRD 5.1.1 - 5.1.3)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..geo import bounding_box, distance_km_expr, valid_coordinates
from ..models import Facility, Insurance, Service
from ..presenters import facility_detail, facility_summary, page
from ..schemas import FacilityDetail, FacilitySummary, Page

router = APIRouter(prefix="/facilities", tags=["facilities"])


def _filters(
    region: str | None,
    city: str | None,
    town: str | None,
    facility_type: str | None,
    category: str | None,
    classification: str | None,
    services: list[str] | None,
    insurance: str | None,
    is_24_hour: bool | None,
    has_ambulance: bool | None,
    q: str | None,
):
    """Shared WHERE clauses for every facility listing (PRD 5.1.2)."""
    # A record still on its placeholder location is never listed publicly.
    conds = [Facility.location_confirmed.is_(True)]
    if region:
        conds.append(func.lower(Facility.region) == region.strip().lower())
    if city:
        conds.append(func.lower(Facility.city) == city.strip().lower())
    if town:
        conds.append(func.lower(Facility.town) == town.strip().lower())
    if facility_type:
        conds.append(Facility.type == facility_type.strip().lower())
    if category:
        conds.append(Facility.category == category.strip().lower())
    if classification:
        conds.append(func.lower(Facility.classification) == classification.strip().lower())
    if is_24_hour is not None:
        conds.append(Facility.is_24_hour.is_(is_24_hour))
    if has_ambulance is not None:
        conds.append(Facility.has_ambulance.is_(has_ambulance))
    if insurance:
        conds.append(
            Facility.insurance.any(
                func.lower(Insurance.insurance_name) == insurance.strip().lower()
            )
        )
    # Every requested service must be present AND active -- an inactive
    # service is not a service the user can turn up and receive (PRD 5.2.1).
    for name in services or []:
        if not name.strip():
            continue
        conds.append(
            Facility.services.any(
                and_(
                    func.lower(Service.service_name) == name.strip().lower(),
                    Service.is_active.is_(True),
                )
            )
        )
    if q:
        like = f"%{q.strip().lower()}%"
        conds.append(
            or_(
                func.lower(Facility.name).like(like),
                func.lower(Facility.city).like(like),
                func.lower(Facility.town).like(like),
                func.lower(Facility.region).like(like),
                func.lower(Facility.address).like(like),
            )
        )
    return conds


def _paginate(db: Session, conds, page_no: int, page_size: int, order_by):
    total = db.scalar(select(func.count(Facility.id)).where(*conds)) or 0
    rows = db.scalars(
        select(Facility)
        .where(*conds)
        .order_by(*order_by)
        .offset((page_no - 1) * page_size)
        .limit(page_size)
    ).all()
    return rows, total


@router.get("/nearby", response_model=Page[FacilitySummary])
def facilities_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(settings.NEARBY_RADIUS_KM, gt=0, le=500),
    region: str | None = None,
    city: str | None = None,
    town: str | None = None,
    facility_type: str | None = Query(None, alias="type"),
    category: str | None = None,
    classification: str | None = None,
    services: list[str] | None = Query(None, alias="service"),
    insurance: str | None = None,
    is_24_hour: bool | None = None,
    has_ambulance: bool | None = None,
    q: str | None = None,
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """Nearest facilities to a coordinate, sorted by distance (PRD 5.1.2)."""
    if not valid_coordinates(lat, lng):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    min_lat, max_lat, min_lng, max_lng = bounding_box(lat, lng, radius_km)
    dist = distance_km_expr(Facility.lat, Facility.lng, lat, lng)

    conds = _filters(
        region, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance, q,
    )
    conds += [
        Facility.lat.between(min_lat, max_lat),
        Facility.lng.between(min_lng, max_lng),
        dist <= radius_km,
    ]

    total = db.scalar(select(func.count(Facility.id)).where(*conds)) or 0
    rows = db.execute(
        select(Facility, dist.label("d"))
        .where(*conds)
        .order_by(dist.asc(), Facility.verified.desc())
        .offset((page_no - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [facility_summary(f, d) for f, d in rows]
    return page(items, total, page_no, page_size)


@router.get("/search", response_model=Page[FacilitySummary])
def facilities_search(
    q: str | None = Query(None, description="Free text over name, city, town, region"),
    region: str | None = None,
    city: str | None = None,
    town: str | None = None,
    facility_type: str | None = Query(None, alias="type"),
    category: str | None = None,
    classification: str | None = None,
    services: list[str] | None = Query(None, alias="service"),
    insurance: str | None = None,
    is_24_hour: bool | None = None,
    has_ambulance: bool | None = None,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """Search by region, city or town (PRD 5.1.2).

    If lat/lng are supplied the results still carry a distance and sort by it,
    so the GPS and manual paths return the same shape.
    """
    conds = _filters(
        region, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance, q,
    )

    if lat is not None and lng is not None:
        dist = distance_km_expr(Facility.lat, Facility.lng, lat, lng)
        total = db.scalar(select(func.count(Facility.id)).where(*conds)) or 0
        rows = db.execute(
            select(Facility, dist.label("d"))
            .where(*conds)
            .order_by(dist.asc(), Facility.verified.desc())
            .offset((page_no - 1) * page_size)
            .limit(page_size)
        ).all()
        items = [facility_summary(f, d) for f, d in rows]
        return page(items, total, page_no, page_size)

    rows, total = _paginate(
        db, conds, page_no, page_size,
        order_by=(Facility.verified.desc(), Facility.name.asc()),
    )
    return page([facility_summary(f) for f in rows], total, page_no, page_size)


@router.get("", response_model=Page[FacilitySummary])
def list_facilities(
    region: str | None = None,
    city: str | None = None,
    town: str | None = None,
    facility_type: str | None = Query(None, alias="type"),
    category: str | None = None,
    classification: str | None = None,
    services: list[str] | None = Query(None, alias="service"),
    insurance: str | None = None,
    is_24_hour: bool | None = None,
    has_ambulance: bool | None = None,
    q: str | None = None,
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """List all facilities with optional filters (PRD 6.4)."""
    conds = _filters(
        region, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance, q,
    )
    rows, total = _paginate(
        db, conds, page_no, page_size,
        order_by=(Facility.verified.desc(), Facility.name.asc()),
    )
    return page([facility_summary(f) for f in rows], total, page_no, page_size)


@router.get("/{facility_id}", response_model=FacilityDetail)
def get_facility(
    facility_id: int,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    db: Session = Depends(get_db),
):
    """Full profile for one facility (PRD 5.1.3)."""
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")

    distance = None
    if lat is not None and lng is not None:
        from ..database import haversine_km

        distance = haversine_km(lat, lng, facility.lat, facility.lng)
    return facility_detail(facility, distance)
