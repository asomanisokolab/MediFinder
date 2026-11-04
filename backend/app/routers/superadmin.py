"""Superadmin login and system-wide administration."""
import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..admin_requests import approve_request, reject_request
from ..database import get_db
from ..models import (
    Admin,
    AdminChangeLog,
    AdminRegistrationRequest,
    AmbulanceCoverage,
    AmbulanceProvider,
    AmbulanceStatus,
    BedAvailability,
    Insurance,
    SuperAdmin,
    Service,
    Facility,
    utcnow,
)
from ..presenters import ambulance_detail, facility_detail
from ..schemas import LoginIn, SuperadminFacilityUpdateIn, SuperadminProviderUpdateIn
from ..security import (
    create_superadmin_access_token,
    get_current_superadmin,
    verify_password,
)

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


def _record_directory_change(
    db: Session,
    admin: SuperAdmin,
    organization_type: str,
    organization_id: int,
    organization_name: str,
    action: str,
    before: dict,
    after: dict | None,
) -> None:
    db.add(
        AdminChangeLog(
            admin_id=None,
            admin_email=admin.email,
            organization_type=organization_type,
            organization_id=organization_id,
            organization_name=organization_name,
            action=action,
            changes_json=json.dumps(
                {"before": before, "after": after}, sort_keys=True, default=str
            ),
        )
    )


def _facility_snapshot(facility: Facility) -> dict:
    return {
        "name": facility.name,
        "type": facility.type,
        "classification": facility.classification,
        "address": facility.address,
        "region": facility.region,
        "city": facility.city,
        "town": facility.town,
        "lat": facility.lat,
        "lng": facility.lng,
        "phone": facility.phone,
        "hours": facility.hours,
        "is_24_hour": facility.is_24_hour,
        "has_ambulance": facility.has_ambulance,
        "ambulance_phone": facility.ambulance_phone,
        "ambulance_provider_id": facility.ambulance_provider_id,
        "verified": facility.verified,
        "services": [
            {"service_name": item.service_name, "is_active": item.is_active}
            for item in facility.services
        ],
        "insurance": [item.insurance_name for item in facility.insurance],
        "beds": (
            {
                "total_beds": facility.beds.total_beds,
                "available_beds": facility.beds.available_beds,
            }
            if facility.beds
            else None
        ),
    }


def _provider_snapshot(provider: AmbulanceProvider) -> dict:
    return {
        "name": provider.name,
        "operator_type": provider.operator_type,
        "service_level": provider.service_level,
        "base_address": provider.base_address,
        "region": provider.region,
        "district": provider.district,
        "lat": provider.lat,
        "lng": provider.lng,
        "phone": provider.phone,
        "alt_phone": provider.alt_phone,
        "hours": provider.hours,
        "is_24_hour": provider.is_24_hour,
        "cost_band": provider.cost_band,
        "verified": provider.verified,
        "phone_verified_at": provider.phone_verified_at,
        "coverage": [
            {"region": item.region, "district": item.district}
            for item in provider.coverage
        ],
        "status": (
            {
                "total_units": provider.status.total_units,
                "units_available": provider.status.units_available,
            }
            if provider.status
            else None
        ),
    }


def _facility_admin_detail(facility: Facility) -> dict:
    data = facility_detail(facility)
    data["admin_beds"] = (
        {
            "total_beds": facility.beds.total_beds,
            "available_beds": facility.beds.available_beds,
            "updated_at": facility.beds.updated_at,
        }
        if facility.beds
        else None
    )
    return data


def _provider_admin_detail(provider: AmbulanceProvider) -> dict:
    data = ambulance_detail(provider)
    data["admin_status"] = (
        {
            "total_units": provider.status.total_units,
            "units_available": provider.status.units_available,
            "updated_at": provider.status.updated_at,
        }
        if provider.status
        else None
    )
    return data


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    admin = db.scalar(
        select(SuperAdmin).where(
            SuperAdmin.email == payload.email.strip().lower()
        )
    )
    if admin is None or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token, expires_in = create_superadmin_access_token(admin)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "role": "superadmin",
        "full_name": admin.full_name,
        "email": admin.email,
    }


@router.put("/facilities/{facility_id}")
def update_facility(
    facility_id: int,
    payload: SuperadminFacilityUpdateIn,
    admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found.")
    if (
        payload.ambulance_provider_id is not None
        and db.get(AmbulanceProvider, payload.ambulance_provider_id) is None
    ):
        raise HTTPException(status_code=404, detail="Ambulance provider not found.")
    if (payload.total_beds is None) != (payload.available_beds is None):
        raise HTTPException(
            status_code=422,
            detail="Enter both bed counts or leave both blank.",
        )
    if (
        payload.total_beds is not None
        and payload.available_beds is not None
        and payload.available_beds > payload.total_beds
    ):
        raise HTTPException(
            status_code=422,
            detail="Available beds cannot exceed total beds.",
        )

    service_names = [item.service_name.strip() for item in payload.services]
    normalized_services = [name.casefold() for name in service_names]
    if any(not name for name in service_names) or len(set(normalized_services)) != len(service_names):
        raise HTTPException(
            status_code=422,
            detail="Service names must be non-empty and unique.",
        )
    insurance_names = [name.strip() for name in payload.insurance if name.strip()]
    normalized_insurance = [name.casefold() for name in insurance_names]
    if len(set(normalized_insurance)) != len(insurance_names):
        raise HTTPException(
            status_code=422,
            detail="Insurance names must be unique.",
        )

    before = _facility_snapshot(facility)
    fields = payload.model_dump(
        exclude={"services", "insurance", "total_beds", "available_beds"}
    )
    for field, value in fields.items():
        setattr(facility, field, value)
    facility.verified = payload.verified
    facility.last_verified = utcnow() if payload.verified else None
    facility.last_updated = utcnow()
    facility.services.clear()
    facility.insurance.clear()
    db.flush()
    facility.services = [
        Service(
            service_name=name,
            is_active=item.is_active,
        )
        for name, item in zip(service_names, payload.services)
    ]
    facility.insurance = [
        Insurance(insurance_name=name) for name in insurance_names
    ]
    if payload.total_beds is None:
        facility.beds = None
    elif facility.beds is None:
        facility.beds = BedAvailability(
            total_beds=payload.total_beds,
            available_beds=payload.available_beds,
            updated_at=utcnow(),
        )
    else:
        if (
            facility.beds.total_beds != payload.total_beds
            or facility.beds.available_beds != payload.available_beds
        ):
            facility.beds.total_beds = payload.total_beds
            facility.beds.available_beds = payload.available_beds
            facility.beds.updated_at = utcnow()

    after = _facility_snapshot(facility)
    _record_directory_change(
        db, admin, "facility", facility.id, facility.name,
        "facility.updated_by_superadmin", before, after,
    )
    db.commit()
    db.refresh(facility)
    return facility_detail(facility)


@router.delete("/facilities/{facility_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_facility(
    facility_id: int,
    admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found.")
    _record_directory_change(
        db, admin, "facility", facility.id, facility.name,
        "facility.deleted_by_superadmin", _facility_snapshot(facility), None,
    )
    db.execute(delete(Admin).where(Admin.facility_id == facility_id))
    db.execute(
        delete(AdminRegistrationRequest).where(
            AdminRegistrationRequest.facility_id == facility_id
        )
    )
    db.delete(facility)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/providers/{provider_id}")
def update_provider(
    provider_id: int,
    payload: SuperadminProviderUpdateIn,
    admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    provider = db.get(AmbulanceProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Ambulance provider not found.")
    if (payload.total_units is None) != (payload.units_available is None):
        raise HTTPException(
            status_code=422,
            detail="Enter both fleet counts or leave both blank.",
        )
    if (
        payload.total_units is not None
        and payload.units_available is not None
        and payload.units_available > payload.total_units
    ):
        raise HTTPException(
            status_code=422,
            detail="Available units cannot exceed total units.",
        )
    coverage = [
        (item.region.strip(), item.district.strip()) for item in payload.coverage
    ]
    if any(not region for region, _district in coverage) or len(set(coverage)) != len(coverage):
        raise HTTPException(
            status_code=422,
            detail="Coverage regions must be non-empty and unique.",
        )

    before = _provider_snapshot(provider)
    fields = payload.model_dump(
        exclude={
            "coverage",
            "phone_verified",
            "total_units",
            "units_available",
        }
    )
    for field, value in fields.items():
        setattr(provider, field, value)
    provider.phone_verified_at = utcnow() if payload.phone_verified else None
    provider.last_updated = utcnow()
    provider.coverage.clear()
    db.flush()
    provider.coverage = [
        AmbulanceCoverage(region=region, district=district)
        for region, district in coverage
    ]
    if payload.total_units is None:
        provider.status = None
    elif provider.status is None:
        provider.status = AmbulanceStatus(
            total_units=payload.total_units,
            units_available=payload.units_available,
            updated_at=utcnow(),
        )
    else:
        if (
            provider.status.total_units != payload.total_units
            or provider.status.units_available != payload.units_available
        ):
            provider.status.total_units = payload.total_units
            provider.status.units_available = payload.units_available
            provider.status.updated_at = utcnow()

    after = _provider_snapshot(provider)
    _record_directory_change(
        db, admin, "provider", provider.id, provider.name,
        "provider.updated_by_superadmin", before, after,
    )
    db.commit()
    db.refresh(provider)
    return ambulance_detail(provider)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(
    provider_id: int,
    admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    provider = db.get(AmbulanceProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Ambulance provider not found.")
    _record_directory_change(
        db, admin, "provider", provider.id, provider.name,
        "provider.deleted_by_superadmin", _provider_snapshot(provider), None,
    )
    db.execute(delete(Admin).where(Admin.provider_id == provider_id))
    db.execute(
        delete(AdminRegistrationRequest).where(
            AdminRegistrationRequest.provider_id == provider_id
        )
    )
    db.execute(
        update(Facility)
        .where(Facility.ambulance_provider_id == provider_id)
        .values(ambulance_provider_id=None)
    )
    db.delete(provider)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/overview")
def overview(
    _admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    requests = db.scalars(
        select(AdminRegistrationRequest)
        .where(AdminRegistrationRequest.status == "pending")
        .order_by(AdminRegistrationRequest.created_at, AdminRegistrationRequest.id)
    ).all()
    request_items = []
    for request in requests:
        facility = db.get(Facility, request.facility_id) if request.facility_id else None
        provider = (
            db.get(AmbulanceProvider, request.provider_id)
            if request.provider_id
            else None
        )
        request_items.append({
            "id": request.id,
            "full_name": request.full_name,
            "email": request.email,
            "scope": "facility" if request.facility_id else "provider",
            "organization_id": request.facility_id or request.provider_id,
            "organization_name": (
                facility.name if facility else provider.name if provider else "Organization removed"
            ),
            "created_at": request.created_at,
        })

    admin_items = []
    for admin in db.scalars(select(Admin).order_by(Admin.created_at.desc())).all():
        facility = db.get(Facility, admin.facility_id) if admin.facility_id else None
        provider = (
            db.get(AmbulanceProvider, admin.provider_id)
            if admin.provider_id
            else None
        )
        admin_items.append({
            "id": admin.id,
            "full_name": admin.full_name,
            "email": admin.email,
            "scope": "facility" if admin.facility_id else "provider",
            "organization_id": admin.facility_id or admin.provider_id,
            "organization_name": (
                facility.name if facility else provider.name if provider else "Organization removed"
            ),
            "created_at": admin.created_at,
        })

    changes = db.scalars(
        select(AdminChangeLog).order_by(AdminChangeLog.created_at.desc()).limit(200)
    ).all()
    return {
        "requests": request_items,
        "admins": admin_items,
        "facilities": [
            _facility_admin_detail(facility)
            for facility in db.scalars(select(Facility).order_by(Facility.name)).all()
        ],
        "providers": [
            _provider_admin_detail(provider)
            for provider in db.scalars(
                select(AmbulanceProvider).order_by(AmbulanceProvider.name)
            ).all()
        ],
        "changes": [
            {
                "id": change.id,
                "admin_email": change.admin_email,
                "organization_type": change.organization_type,
                "organization_id": change.organization_id,
                "organization_name": change.organization_name,
                "action": change.action,
                "changes": json.loads(change.changes_json),
                "created_at": change.created_at,
            }
            for change in changes
        ],
    }


@router.post("/requests/{request_id}/approve")
def approve_admin_request(
    request_id: int,
    _admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    try:
        admin = approve_request(db, request_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "approved", "admin_id": admin.id, "email": admin.email}


@router.post("/requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_admin_request(
    request_id: int,
    _admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    try:
        reject_request(db, request_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/admins/{admin_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_admin(
    admin_id: int,
    _superadmin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    admin = db.get(Admin, admin_id)
    if admin is None:
        raise HTTPException(status_code=404, detail="Administrator not found.")
    db.delete(admin)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
