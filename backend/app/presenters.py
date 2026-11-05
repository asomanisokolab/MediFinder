"""ORM -> response dict conversion, including the staleness rules.

PRD 7.3: bed availability and ambulance fleet status expire after 24 hours
and show as "Not updated" until refreshed. That rule lives here so every
route reports it identically.
"""
from datetime import timedelta

from .config import settings
from .models import AmbulanceProvider, Facility, utcnow
from .reference import CARE_TYPES

NOT_UPDATED = "Not updated"


def is_stale(updated_at) -> bool:
    if updated_at is None:
        return True
    return utcnow() - updated_at > timedelta(hours=settings.STALE_AFTER_HOURS)


def beds_out(facility: Facility) -> dict:
    beds = facility.beds
    if beds is None:
        return {"is_stale": True, "display": NOT_UPDATED}
    stale = is_stale(beds.updated_at)
    if stale:
        return {
            "total_beds": beds.total_beds,
            "available_beds": None,
            "updated_at": beds.updated_at,
            "is_stale": True,
            "display": NOT_UPDATED,
        }
    return {
        "total_beds": beds.total_beds,
        "available_beds": beds.available_beds,
        "updated_at": beds.updated_at,
        "is_stale": False,
        "display": f"{beds.available_beds} of {beds.total_beds} beds free",
    }


def fleet_out(provider: AmbulanceProvider) -> dict:
    st = provider.status
    if st is None:
        return {"is_stale": True, "display": NOT_UPDATED}
    stale = is_stale(st.updated_at)
    if stale:
        return {
            "total_units": st.total_units,
            "units_available": None,
            "updated_at": st.updated_at,
            "is_stale": True,
            "display": NOT_UPDATED,
        }
    return {
        "total_units": st.total_units,
        "units_available": st.units_available,
        "updated_at": st.updated_at,
        "is_stale": False,
        "display": f"{st.units_available} of {st.total_units} units available",
    }


def care_types(facility: Facility) -> list[str]:
    """The facility's category, then the other kinds of care its active
    services fall under, in reference.CARE_TYPES order."""
    offered = {s.care_type for s in facility.services if s.is_active and s.care_type}
    return [facility.category] + [
        key for key in CARE_TYPES if key in offered and key != facility.category
    ]


def facility_summary(
    facility: Facility, distance_km: float | None = None, busy: dict | None = None
) -> dict:
    return {
        "id": facility.id,
        "name": facility.name,
        "type": facility.type,
        "category": facility.category,
        "classification": facility.classification,
        "region": facility.region,
        "district": facility.district,
        "city": facility.city,
        "town": facility.town,
        "lat": facility.lat,
        "lng": facility.lng,
        "phone": facility.phone,
        "is_24_hour": facility.is_24_hour,
        "has_ambulance": facility.has_ambulance,
        "verified": facility.verified,
        "last_verified": facility.last_verified,
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
        "services": sorted(s.service_name for s in facility.services if s.is_active),
        "care_types": care_types(facility),
        "beds": beds_out(facility),
        "busy": busy,
    }


def facility_detail(
    facility: Facility, distance_km: float | None = None, busy: dict | None = None
) -> dict:
    data = facility_summary(facility, distance_km, busy)
    data.update(
        {
            "address": facility.address,
            "hours": facility.hours,
            "website": facility.website,
            "source": facility.source,
            "ambulance_phone": facility.ambulance_phone,
            "ambulance_provider_id": facility.ambulance_provider_id,
            "insurance": sorted(i.insurance_name for i in facility.insurance),
            "service_detail": sorted(
                (
                    {
                        "service_name": s.service_name,
                        "is_active": s.is_active,
                        "care_type": s.care_type or facility.category,
                    }
                    for s in facility.services
                ),
                key=lambda s: s["service_name"],
            ),
            "last_updated": facility.last_updated,
        }
    )
    return data


def ambulance_summary(
    provider: AmbulanceProvider,
    distance_km: float | None = None,
    covers_user_area: bool | None = None,
) -> dict:
    return {
        "id": provider.id,
        "name": provider.name,
        "operator_type": provider.operator_type,
        "service_level": provider.service_level,
        "region": provider.region,
        "district": provider.district,
        "lat": provider.lat,
        "lng": provider.lng,
        "phone": provider.phone,
        "alt_phone": provider.alt_phone,
        "is_24_hour": provider.is_24_hour,
        "cost_band": provider.cost_band,
        "verified": provider.verified,
        "phone_verified_at": provider.phone_verified_at,
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
        "covers_user_area": covers_user_area,
        "status": fleet_out(provider),
    }


def ambulance_detail(
    provider: AmbulanceProvider,
    distance_km: float | None = None,
    covers_user_area: bool | None = None,
) -> dict:
    data = ambulance_summary(provider, distance_km, covers_user_area)
    data.update(
        {
            "base_address": provider.base_address,
            "hours": provider.hours,
            "coverage": [
                {"region": c.region, "district": c.district} for c in provider.coverage
            ],
            "last_updated": provider.last_updated,
        }
    )
    return data


def page(
    items: list,
    total: int,
    page_no: int,
    page_size: int,
    matched_place: str | None = None,
    place_total: int | None = None,
) -> dict:
    pages = (total + page_size - 1) // page_size if page_size else 0
    return {
        "matched_place": matched_place,
        "place_total": place_total,
        "items": items,
        "total": total,
        "page": page_no,
        "page_size": page_size,
        "pages": pages,
        "data_verified": settings.DATA_VERIFIED,
    }
