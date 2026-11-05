"""Facility directory, search and profile (PRD 5.1.1 - 5.1.3)."""
import hashlib
import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from .. import busyness
from ..config import settings
from ..database import get_db
from ..geo import bounding_box, distance_km_expr, valid_coordinates
from ..models import BusyReport, Facility, Insurance, Service, utcnow
from ..presenters import facility_detail, facility_summary, page
from ..schemas import BusyOut, BusyReportIn, FacilityDetail, FacilitySummary, Page, SuggestOut

router = APIRouter(prefix="/facilities", tags=["facilities"])

# Words that join a search ("clinics in Ho") but name nothing.
_FILLER_WORDS = {"in", "at", "near", "around", "the", "of", "and", "&"}
# One person, one report per facility in this window.
REPORT_COOLDOWN = timedelta(minutes=20)


def _words(q: str) -> list[str]:
    words = [w for w in re.split(r"[\s,]+", q.lower()) if w]
    words = [w for w in words if w not in _FILLER_WORDS] or words
    # "clinics" finds "Clinic", "pharmacies" finds "Pharmacy".
    return [re.sub(r"(ies|s)$", "", w) if len(w) > 4 else w for w in words]


def _word_like(column, word: str):
    """Long words match anywhere ("kofor" in "Koforidua"); short ones only as
    a whole word, so "Ho" finds Ho and not every "Hospital"."""
    column = func.lower(column)
    if len(word) > 3:
        return column.like(f"%{word}%")
    return or_(
        column == word,
        column.like(f"{word} %"),
        column.like(f"% {word}"),
        column.like(f"% {word} %"),
    )


def _place_columns():
    return (Facility.city, Facility.town, Facility.district)


def _known_place(db: Session, q: str | None) -> str | None:
    """The place's own spelling when the search text is exactly the name of
    a city, town, community or district that has listings."""
    if not q or not q.strip():
        return None
    phrase = q.strip().lower()
    for column in _place_columns():
        name = db.scalar(
            select(column)
            .where(func.lower(column) == phrase, Facility.location_confirmed.is_(True))
            .limit(1)
        )
        if name:
            return name
    return None


def _text_match(q: str, place: str | None):
    """A place name finds everything in that place. Anything else matches
    word by word: every word must appear in the name, the address or the
    place fields, or in an active service ("malaria test")."""
    phrase = q.strip().lower()
    if place:
        # Everything in the place, plus anything named after it elsewhere
        # ("Ridge Hospital" for "ridge"); the place's own results rank first.
        return or_(_in_place(phrase), _word_like(Facility.name, phrase))
    conds = []
    for word in _words(phrase):
        conds.append(
            or_(
                *(
                    _word_like(column, word)
                    for column in (Facility.name, Facility.city, Facility.town,
                                   Facility.district, Facility.region, Facility.address)
                ),
                Facility.services.any(
                    and_(_word_like(Service.service_name, word), Service.is_active.is_(True))
                ),
            )
        )
    return and_(*conds)


def _in_place(phrase: str):
    return or_(*(func.lower(column) == phrase for column in _place_columns()))


def _best_match_first(q: str):
    """Exact name, then names starting with the text, then the place itself,
    then names containing it, then everything else."""
    phrase = q.strip().lower()
    name = func.lower(Facility.name)
    return case(
        (name == phrase, 0),
        (name.like(f"{phrase}%"), 1),
        (_in_place(phrase), 2),
        (name.like(f"%{phrase}%"), 3),
        else_=4,
    )


def _filters(
    region: str | None,
    district: str | None,
    city: str | None,
    town: str | None,
    facility_type: str | None,
    category: str | None,
    classification: str | None,
    services: list[str] | None,
    insurance: str | None,
    is_24_hour: bool | None,
    has_ambulance: bool | None,
):
    """Shared WHERE clauses for every facility listing (PRD 5.1.2)."""
    # A record still on its placeholder location is never listed publicly.
    conds = [Facility.location_confirmed.is_(True)]
    if region:
        conds.append(func.lower(Facility.region) == region.strip().lower())
    if district:
        conds.append(func.lower(Facility.district) == district.strip().lower())
    if city:
        conds.append(func.lower(Facility.city) == city.strip().lower())
    if town:
        conds.append(func.lower(Facility.town) == town.strip().lower())
    if facility_type:
        conds.append(Facility.type == facility_type.strip().lower())
    if category:
        # "Laboratories" means labs and every hospital or clinic that runs one.
        wanted = category.strip().lower()
        conds.append(
            or_(
                Facility.category == wanted,
                Facility.services.any(
                    and_(Service.care_type == wanted, Service.is_active.is_(True))
                ),
            )
        )
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
    return conds


def _search(db: Session, conds: list, q: str | None) -> tuple[list, str | None, int | None]:
    """Adds the search text to the filters. Returns the conditions, the
    place the text names (if it is one) and how many results are in it."""
    if not q or not q.strip():
        return conds, None, None
    place = _known_place(db, q)
    place_total = None
    if place:
        place_total = db.scalar(
            select(func.count(Facility.id)).where(*conds, _in_place(q.strip().lower()))
        ) or 0
    return conds + [_text_match(q, place)], place, place_total


def _with_busy(db: Session, rows) -> list[dict]:
    """Summaries for (facility, distance) pairs, each with its busy status."""
    busy = busyness.statuses(db, [f for f, _ in rows])
    return [facility_summary(f, d, busy.get(f.id)) for f, d in rows]


def _list(db: Session, conds, page_no: int, page_size: int, q: str | None,
          lat: float | None = None, lng: float | None = None):
    total = db.scalar(select(func.count(Facility.id)).where(*conds)) or 0
    offset = (page_no - 1) * page_size
    if lat is not None and lng is not None:
        dist = distance_km_expr(Facility.lat, Facility.lng, lat, lng)
        rows = db.execute(
            select(Facility, dist.label("d"))
            .where(*conds)
            .order_by(dist.asc(), Facility.verified.desc())
            .offset(offset)
            .limit(page_size)
        ).all()
    else:
        order = [Facility.verified.desc(), Facility.name.asc()]
        if q and q.strip():
            order.insert(0, _best_match_first(q))
        found = db.scalars(
            select(Facility).where(*conds).order_by(*order).offset(offset).limit(page_size)
        ).all()
        rows = [(f, None) for f in found]
    return _with_busy(db, rows), total


@router.get("/nearby", response_model=Page[FacilitySummary])
def facilities_nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(settings.NEARBY_RADIUS_KM, gt=0, le=500),
    region: str | None = None,
    district: str | None = None,
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
        region, district, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance,
    )
    conds += [
        Facility.lat.between(min_lat, max_lat),
        Facility.lng.between(min_lng, max_lng),
        dist <= radius_km,
    ]
    conds, place, place_total = _search(db, conds, q)
    items, total = _list(db, conds, page_no, page_size, q, lat, lng)
    return page(items, total, page_no, page_size, place, place_total)


@router.get("/search", response_model=Page[FacilitySummary])
def facilities_search(
    q: str | None = Query(
        None, description="A place name, or words from a facility name, place or service"
    ),
    region: str | None = None,
    district: str | None = None,
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
    """Search by name, place, region, city or town (PRD 5.1.2).

    Typing a place ("Koforidua") lists every facility in it; typing a name
    ("Atibie Government Hospital") puts that facility first. If lat/lng are
    supplied the results carry a distance and sort by it, so the GPS and
    manual paths return the same shape.
    """
    conds, place, place_total = _search(db, _filters(
        region, district, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance,
    ), q)
    items, total = _list(db, conds, page_no, page_size, q, lat, lng)
    return page(items, total, page_no, page_size, place, place_total)


@router.get("/suggest", response_model=SuggestOut)
def suggest(q: str = Query(..., min_length=2, max_length=80), db: Session = Depends(get_db)):
    """Places and facilities matching what has been typed so far, for the
    search box. Places first: choosing one lists everything there."""
    phrase = q.strip().lower()
    starts = [f"{phrase}%", f"% {phrase}%"]
    places: dict[str, dict] = {}
    for column in _place_columns():
        rows = db.execute(
            select(column, Facility.region, func.count(Facility.id))
            .where(
                Facility.location_confirmed.is_(True),
                or_(*(func.lower(column).like(s) for s in starts)),
            )
            .group_by(column, Facility.region)
            .order_by(func.count(Facility.id).desc())
            .limit(5)
        ).all()
        for name, region, count in rows:
            key = name.lower()
            if name and (key not in places or places[key]["count"] < count):
                places[key] = {"name": name, "region": region, "count": count}
    best_places = sorted(places.values(), key=lambda p: (-p["count"], p["name"]))[:5]

    names = func.lower(Facility.name)
    facilities = db.scalars(
        select(Facility)
        .where(
            Facility.location_confirmed.is_(True),
            *(_word_like(Facility.name, word) for word in _words(phrase)),
        )
        .order_by(case((names.like(f"{phrase}%"), 0), else_=1), Facility.verified.desc(),
                  Facility.name.asc())
        .limit(6)
    ).all()
    return {
        "places": best_places,
        "facilities": [
            {"id": f.id, "name": f.name, "category": f.category, "city": f.city or f.town,
             "region": f.region}
            for f in facilities
        ],
    }


@router.get("", response_model=Page[FacilitySummary])
def list_facilities(
    region: str | None = None,
    district: str | None = None,
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
    conds, place, place_total = _search(db, _filters(
        region, district, city, town, facility_type, category, classification, services,
        insurance, is_24_hour, has_ambulance,
    ), q)
    items, total = _list(db, conds, page_no, page_size, q)
    return page(items, total, page_no, page_size, place, place_total)


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
    return facility_detail(facility, distance, busyness.status(db, facility))


def _client_key(request: Request, facility_id: int) -> str:
    """Identifies a repeat report without storing anyone's address."""
    client = request.client.host if request.client else "unknown"
    raw = f"{client}|{facility_id}|{settings.JWT_SECRET}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


@router.post("/{facility_id}/busy-reports", response_model=BusyOut, status_code=201)
def report_busy(
    facility_id: int,
    payload: BusyReportIn,
    request: Request,
    db: Session = Depends(get_db),
):
    """Someone at the facility says how busy it is. No sign-in: reports are
    short-lived, averaged with others, and one person can only report once
    every 20 minutes per facility."""
    facility = db.get(Facility, facility_id)
    if facility is None or not facility.location_confirmed:
        raise HTTPException(status_code=404, detail="Facility not found")
    if facility.category not in busyness.TRACKED_CATEGORIES:
        raise HTTPException(status_code=422, detail="This listing does not take busy reports.")

    key = _client_key(request, facility_id)
    recent = db.scalar(
        select(BusyReport.id).where(
            BusyReport.client_key == key,
            BusyReport.created_at >= utcnow() - REPORT_COOLDOWN,
        )
    )
    if recent is not None:
        raise HTTPException(
            status_code=429,
            detail="Thanks, you already reported for this facility. You can report again in 20 minutes.",
        )
    db.add(BusyReport(
        facility_id=facility_id,
        level=busyness.LEVELS.index(payload.level),
        source="visitor",
        client_key=key,
    ))
    db.commit()
    return busyness.status(db, facility)
