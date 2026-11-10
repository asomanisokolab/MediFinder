"""Admin dashboard v1 (PRD 5.2.1, brought into Phase 1 by the roadmap).

Facility admins update beds and service status. Ambulance provider admins
update fleet availability. One login model, scoped by the token.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import busyness
from ..config import settings
from ..database import get_db
from ..models import (
    AmbulanceProvider,
    AmbulanceStatus,
    AdminChangeLog,
    BedAvailability,
    BusyReport,
    Facility,
    Service,
    utcnow,
)
from ..presenters import beds_out, fleet_out
from ..reference import in_ghana
from ..schemas import (
    AdminMeOut,
    BedUpdateIn,
    BusyOut,
    BusyReportIn,
    OfferingsUpdateIn,
    WardsUpdateIn,
    FleetUpdateIn,
    LocationIn,
    LoginIn,
    PasswordChangeIn,
    ServicesUpdateIn,
    TokenOut,
)
from ..security import (
    create_access_token,
    get_admin_with_temporary_password,
    get_current_admin,
    require_facility,
    require_provider,
    verify_password,
    hash_password,
)

router = APIRouter(tags=["admin"])


def _record_change(
    db, admin, organization_type, organization_id, organization_name, action, changes
):
    db.add(
        AdminChangeLog(
            admin_id=admin.id,
            admin_email=admin.email,
            organization_type=organization_type,
            organization_id=organization_id,
            organization_name=organization_name,
            action=action,
            changes_json=json.dumps(changes, sort_keys=True),
        )
    )


@router.post("/admin/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    """Admin authentication (PRD 6.4)."""
    from ..models import Admin

    admin = db.scalar(
        select(Admin).where(func.lower(Admin.email) == payload.email.strip().lower())
    )
    # Same message and same work either way -- do not leak which emails exist.
    if admin is None or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token, expires_in = create_access_token(admin)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "scope": "facility" if admin.facility_id else "provider",
        "facility_id": admin.facility_id,
        "provider_id": admin.provider_id,
        "must_change_password": admin.must_change_password,
    }


@router.post("/admin/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChangeIn,
    admin=Depends(get_admin_with_temporary_password),
    db: Session = Depends(get_db),
):
    """Replace the current (possibly temporary) password."""
    if not verify_password(payload.current_password, admin.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=422, detail="Choose a password different from the current one."
        )
    try:
        admin.password_hash = hash_password(payload.new_password)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="Password must be at most 72 UTF-8 bytes."
        ) from exc
    admin.must_change_password = False
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/admin/location")
def update_location(
    payload: LocationIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Advanced settings: the organization sets its own map position.

    Confirming the location is what makes a newly created listing appear in
    public search.
    """
    if not in_ghana(payload.lat, payload.lng):
        raise HTTPException(
            status_code=422,
            detail="That point is outside Ghana. Check latitude and longitude are not swapped.",
        )
    if admin.facility_id:
        organization_type = "facility"
        organization = db.get(Facility, admin.facility_id)
    else:
        organization_type = "provider"
        organization = db.get(AmbulanceProvider, admin.provider_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    changes = {
        "lat": {"before": organization.lat, "after": payload.lat},
        "lng": {"before": organization.lng, "after": payload.lng},
        "location_confirmed": {"before": organization.location_confirmed, "after": True},
    }
    organization.lat = payload.lat
    organization.lng = payload.lng
    organization.location_confirmed = True
    organization.last_updated = utcnow()
    _record_change(
        db, admin, organization_type, organization.id, organization.name,
        "location.updated", changes,
    )
    db.commit()
    return {"lat": payload.lat, "lng": payload.lng, "location_confirmed": True}


@router.get("/admin/me", response_model=AdminMeOut)
def me(admin=Depends(get_admin_with_temporary_password), db: Session = Depends(get_db)):
    facility = db.get(Facility, admin.facility_id) if admin.facility_id else None
    provider = db.get(AmbulanceProvider, admin.provider_id) if admin.provider_id else None
    return {
        "id": admin.id,
        "email": admin.email,
        "full_name": admin.full_name,
        "scope": "facility" if admin.facility_id else "provider",
        "facility_id": admin.facility_id,
        "provider_id": admin.provider_id,
        "facility_name": facility.name if facility else None,
        "provider_name": provider.name if provider else None,
        "must_change_password": admin.must_change_password,
    }


@router.put("/facilities/{facility_id}/beds")
def update_beds(
    facility_id: int,
    payload: BedUpdateIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Update bed availability (PRD 6.4, admin only)."""
    require_facility(admin, facility_id)
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")
    if payload.available_beds > payload.total_beds:
        raise HTTPException(
            status_code=400, detail="Available beds cannot exceed total beds."
        )

    beds = facility.beds
    before_beds = (
        {
            "total_beds": beds.total_beds,
            "available_beds": beds.available_beds,
        }
        if beds is not None
        else {"total_beds": None, "available_beds": None}
    )
    if beds is None:
        beds = BedAvailability(facility_id=facility_id)
        db.add(beds)
    beds.total_beds = payload.total_beds
    beds.available_beds = payload.available_beds
    beds.updated_at = utcnow()

    # Keeping the profile current is what earns the verified badge (PRD 7.2).
    facility.last_updated = utcnow()
    facility.last_verified = utcnow()
    facility.verified = True
    _record_change(
        db,
        admin,
        "facility",
        facility.id,
        facility.name,
        "beds.updated",
        {
            "total_beds": {"before": before_beds["total_beds"], "after": payload.total_beds},
            "available_beds": {
                "before": before_beds["available_beds"],
                "after": payload.available_beds,
            },
        },
    )
    db.commit()
    db.refresh(facility)
    return {"facility_id": facility_id, "beds": beds_out(facility)}


@router.put("/facilities/{facility_id}/services")
def update_services(
    facility_id: int,
    payload: ServicesUpdateIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Mark services active or temporarily unavailable (PRD 5.2.1, 6.4)."""
    require_facility(admin, facility_id)
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")

    existing = {s.service_name.lower(): s for s in facility.services}
    before_services = {
        item.service_name.strip(): item.is_active
        for item in payload.services
        if item.service_name.strip()
    }
    previous_services = {
        name: existing[name.lower()].is_active if name.lower() in existing else None
        for name in before_services
    }
    for item in payload.services:
        name = item.service_name.strip()
        if not name:
            continue
        row = existing.get(name.lower())
        if row is None:
            row = Service(facility_id=facility_id, service_name=name)
            db.add(row)
            existing[name.lower()] = row
        row.is_active = item.is_active

    facility.last_updated = utcnow()
    _record_change(
        db,
        admin,
        "facility",
        facility.id,
        facility.name,
        "services.updated",
        {
            name: {"before": previous_services[name], "after": active}
            for name, active in before_services.items()
        },
    )
    db.commit()
    db.refresh(facility)
    return {
        "facility_id": facility_id,
        "services": sorted(
            ({"service_name": s.service_name, "is_active": s.is_active} for s in facility.services),
            key=lambda s: s["service_name"],
        ),
    }


@router.put("/facilities/{facility_id}/offerings")
def update_offerings(
    facility_id: int,
    payload: OfferingsUpdateIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Replace the facility's full list of services, each under the kind of
    care that offers it (its hospital, its laboratory, its pharmacy...).
    Services left out are removed; is_active false keeps one listed as
    temporarily unavailable."""
    require_facility(admin, facility_id)
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")

    wanted: dict[str, tuple[str, str, bool]] = {}
    for item in payload.services:
        name = " ".join(item.service_name.split())
        if not name:
            continue
        if name.casefold() in wanted:
            raise HTTPException(
                status_code=422,
                detail=f'"{name}" is listed twice. Keep it under one kind of care.',
            )
        wanted[name.casefold()] = (name, item.care_type, item.is_active)

    before = {
        s.service_name: {"care_type": s.care_type, "is_active": s.is_active}
        for s in facility.services
    }
    # Edit in place: the (facility, service) unique key would trip if new
    # rows were inserted before the old ones were deleted.
    for service in list(facility.services):
        if service.service_name.casefold() not in wanted:
            facility.services.remove(service)
    have = {s.service_name.casefold(): s for s in facility.services}
    for key, (name, care_type, active) in wanted.items():
        row = have.get(key)
        if row is None:
            row = Service(service_name=name)
            facility.services.append(row)
        row.service_name = name
        row.care_type = care_type
        row.is_active = active

    facility.last_updated = utcnow()
    after = {
        name: {"care_type": care_type, "is_active": active}
        for name, care_type, active in wanted.values()
    }
    _record_change(
        db, admin, "facility", facility.id, facility.name, "offerings.updated",
        {
            name: {"before": before.get(name), "after": after.get(name)}
            for name in sorted(set(before) | set(after))
            if before.get(name) != after.get(name)
        },
    )
    db.commit()
    db.refresh(facility)
    from ..presenters import facility_detail

    detail = facility_detail(facility)
    return {
        "facility_id": facility_id,
        "care_types": detail["care_types"],
        "services": detail["service_detail"],
    }


@router.put("/facilities/{facility_id}/wards")
def update_wards(
    facility_id: int,
    payload: WardsUpdateIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Which wards a hospital or clinic has: children's, female, male."""
    require_facility(admin, facility_id)
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")
    from ..reference import HEALTH_FACILITY_CATEGORIES, WARDS

    if facility.category not in HEALTH_FACILITY_CATEGORIES:
        raise HTTPException(status_code=422, detail="Only hospitals and clinics list wards.")
    wards = ",".join(w for w in WARDS if w in payload.wards)
    _record_change(
        db, admin, "facility", facility.id, facility.name, "wards.updated",
        {"wards": {"before": facility.wards, "after": wards}},
    )
    facility.wards = wards
    facility.last_updated = utcnow()
    db.commit()
    return {"facility_id": facility_id, "wards": [w for w in WARDS if w in wards.split(",")]}


@router.put("/facilities/{facility_id}/busy", response_model=BusyOut)
def update_busy(
    facility_id: int,
    payload: BusyReportIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Staff say how busy the facility is right now. Shown to the public
    for the next 3 hours, ahead of visitor reports and the prediction."""
    require_facility(admin, facility_id)
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")
    if facility.category not in busyness.TRACKED_CATEGORIES:
        raise HTTPException(status_code=422, detail="This listing does not take busy reports.")

    previous = busyness.status(db, facility)
    db.add(BusyReport(
        facility_id=facility_id, level=busyness.LEVELS.index(payload.level), source="facility",
    ))
    facility.last_updated = utcnow()
    _record_change(
        db, admin, "facility", facility.id, facility.name, "busy.updated",
        {"level": {"before": previous["level"] if previous else None, "after": payload.level}},
    )
    db.commit()
    return busyness.status(db, facility)


@router.put("/ambulance/providers/{provider_id}/status")
def update_fleet(
    provider_id: int,
    payload: FleetUpdateIn,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Update fleet availability (PRD v1.1 6.4, provider admin only)."""
    require_provider(admin, provider_id)
    provider = db.get(AmbulanceProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Ambulance provider not found")
    if payload.units_available > payload.total_units:
        raise HTTPException(
            status_code=400, detail="Available units cannot exceed total units."
        )

    status = provider.status
    before_status = (
        {
            "total_units": status.total_units,
            "units_available": status.units_available,
        }
        if status is not None
        else {"total_units": None, "units_available": None}
    )
    if status is None:
        status = AmbulanceStatus(provider_id=provider_id)
        db.add(status)
    status.total_units = payload.total_units
    status.units_available = payload.units_available
    status.updated_at = utcnow()

    provider.last_updated = utcnow()
    provider.verified = True
    _record_change(
        db,
        admin,
        "provider",
        provider.id,
        provider.name,
        "fleet.updated",
        {
            "total_units": {
                "before": before_status["total_units"],
                "after": payload.total_units,
            },
            "units_available": {
                "before": before_status["units_available"],
                "after": payload.units_available,
            },
        },
    )
    db.commit()
    db.refresh(provider)
    return {"provider_id": provider_id, "status": fleet_out(provider)}


@router.get("/admin/dashboard")
def dashboard(admin=Depends(get_current_admin), db: Session = Depends(get_db)):
    """Everything the dashboard needs to render, in one call."""
    if admin.facility_id:
        facility = db.get(Facility, admin.facility_id)
        if facility is None:
            raise HTTPException(status_code=404, detail="Facility not found")
        from ..presenters import facility_detail

        return {
            "scope": "facility",
            "stale_after_hours": settings.STALE_AFTER_HOURS,
            "location_confirmed": facility.location_confirmed,
            "facility": facility_detail(facility, None, busyness.status(db, facility)),
        }

    provider = db.get(AmbulanceProvider, admin.provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Ambulance provider not found")
    from ..presenters import ambulance_detail

    return {
        "scope": "provider",
        "stale_after_hours": settings.STALE_AFTER_HOURS,
        "location_confirmed": provider.location_confirmed,
        "provider": ambulance_detail(provider),
    }
