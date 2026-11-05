"""Superadmin login and system-wide administration."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import (
    Admin,
    AdminChangeLog,
    AmbulanceCoverage,
    AmbulanceProvider,
    AmbulanceStatus,
    BedAvailability,
    ContactRequest,
    Insurance,
    SuperAdmin,
    Service,
    Facility,
    utcnow,
)
from ..presenters import ambulance_detail, facility_detail
from ..reference import (
    HEALTH_FACILITY_CATEGORIES,
    ORGANIZATION_TYPES,
    REGION_CENTROIDS,
    UNCLASSIFIED,
    default_care_type,
    in_ghana,
)
from ..schemas import (
    LoginIn,
    OrganizationCreateIn,
    SuperadminFacilityUpdateIn,
    SuperadminProviderUpdateIn,
)
from .facilities import _word_like, _words
from ..security import (
    create_superadmin_access_token,
    generate_password,
    get_current_superadmin,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


def _email_in_use(db: Session, email: str) -> bool:
    return bool(
        db.scalar(select(Admin.id).where(func.lower(Admin.email) == email))
        or db.scalar(select(SuperAdmin.id).where(func.lower(SuperAdmin.email) == email))
    )


def _login_url(request: Request) -> str:
    base = settings.PUBLIC_URL or str(request.base_url).rstrip("/")
    return f"{base}/admin"


def _credentials_message(
    admin: Admin, organization_name: str, password: str, login_url: str, reset: bool
) -> tuple[str, str]:
    """Subject and body of the login email the superadmin sends."""
    if reset:
        subject = "Your FindCare Ghana password was reset"
        intro = (
            f"As requested, the password for {organization_name} on FindCare Ghana "
            "was reset to a new default password. Your old password no longer works.\n\n"
            f"Sign in at: {login_url}\n"
            f"Email: {admin.email}\n"
            f"New default password: {password}\n\n"
            "You will be asked to choose your own new password when you sign in.\n"
            "You can change it again at any time under Advanced settings.\n\n"
        )
    else:
        subject = "Your FindCare Ghana listing is ready"
        intro = (
            f"{organization_name} is now set up on FindCare Ghana. You can sign in "
            "to keep your listing up to date.\n\n"
            f"Sign in at: {login_url}\n"
            f"Email: {admin.email}\n"
            f"Default password: {password}\n\n"
            "You will be asked to choose your own password when you first sign in.\n"
            "You can change it again at any time under Advanced settings.\n"
            "Then open Advanced settings to set your exact map location. Until you do,\n"
            "your listing does not appear in public search.\n\n"
        )
    body = (
        f"Hello {admin.full_name},\n\n"
        f"{intro}"
        f"Questions? Email {settings.SUPPORT_EMAIL} or message @findcareGh on\n"
        "Instagram, X or Facebook.\n\n"
        "FindCare Ghana\n"
    )
    return subject, body


def _issue_credentials(
    admin: Admin, organization_name: str, password: str, login_url: str, reset: bool = False
) -> dict:
    """Hand the login details back to the superadmin, who emails them to the
    organization. Returned once; the password is never stored in plain text."""
    subject, body = _credentials_message(admin, organization_name, password, login_url, reset)
    return {
        "admin_id": admin.id,
        "email": admin.email,
        "temporary_password": password,
        "message": {"subject": subject, "body": body},
    }


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


def _carried_care_type(previous: str | None, old_category: str, new_category: str) -> str:
    """A service's care type after an edit that may change the category."""
    if not previous:
        return ""
    return new_category if previous == old_category else previous


def _facility_snapshot(facility: Facility) -> dict:
    return {
        "name": facility.name,
        "type": facility.type,
        "category": facility.category,
        "classification": facility.classification,
        "address": facility.address,
        "region": facility.region,
        "district": facility.district,
        "city": facility.city,
        "town": facility.town,
        "lat": facility.lat,
        "lng": facility.lng,
        "location_confirmed": facility.location_confirmed,
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
        "location_confirmed": provider.location_confirmed,
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
    data["location_confirmed"] = facility.location_confirmed
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
    data["location_confirmed"] = provider.location_confirmed
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


def _paged(db: Session, model, conds, order, page_no: int, page_size: int, present) -> dict:
    total = db.scalar(select(func.count(model.id)).where(*conds)) or 0
    rows = db.scalars(
        select(model).where(*conds).order_by(*order)
        .offset((page_no - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [present(row) for row in rows],
        "total": total,
        "page": page_no,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


def _matches_text(q: str | None, id_column, text_columns):
    """Every word must appear in one of the columns; a number also finds the ID."""
    if not q or not q.strip():
        return []
    phrase = q.strip()
    word_conds = [
        or_(*(_word_like(column, word) for column in text_columns))
        for word in _words(phrase)
    ]
    if phrase.isdigit():
        return [or_(id_column == int(phrase), and_(*word_conds))]
    return word_conds


def _yes_no(column, value: str | None):
    if value == "yes":
        return [column.is_(True)]
    if value == "no":
        return [column.is_(False)]
    return []


@router.get("/facilities")
def search_facilities(
    q: str | None = Query(None, max_length=120,
                          description="Name, ID, community, town, district or region"),
    region: str | None = None,
    district: str | None = None,
    city: str | None = None,
    category: str | None = None,
    facility_type: str | None = Query(None, alias="type"),
    verified: str | None = Query(None, pattern="^(yes|no)$"),
    location: str | None = Query(None, pattern="^(set|missing)$"),
    managed: str | None = Query(None, pattern="^(yes|no)$"),
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(20, ge=1, le=100),
    _admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    """Every facility, including ones hidden until their location is set."""
    conds = _matches_text(q, Facility.id, (
        Facility.name, Facility.town, Facility.city, Facility.district, Facility.region,
        Facility.address, Facility.phone,
    ))
    for column, value in ((Facility.region, region), (Facility.district, district),
                          (Facility.city, city)):
        if value:
            conds.append(func.lower(column) == value.strip().lower())
    if category:
        conds.append(Facility.category == category)
    if facility_type:
        conds.append(Facility.type == facility_type)
    conds += _yes_no(Facility.verified, verified)
    if location:
        conds.append(Facility.location_confirmed.is_(location == "set"))
    managed_ids = select(Admin.facility_id).where(Admin.facility_id.isnot(None))
    if managed == "yes":
        conds.append(Facility.id.in_(managed_ids))
    elif managed == "no":
        conds.append(Facility.id.not_in(managed_ids))

    order = [Facility.name.asc(), Facility.id.asc()]
    if q and q.strip():
        name = func.lower(Facility.name)
        phrase = q.strip().lower()
        order.insert(0, case_rank(name, phrase))
    result = _paged(db, Facility, conds, order, page_no, page_size, _facility_admin_detail)
    with_admin = set(db.scalars(managed_ids.where(
        Admin.facility_id.in_([f["id"] for f in result["items"]])
    )))
    for item in result["items"]:
        item["managed"] = item["id"] in with_admin
    return result


@router.get("/providers")
def search_providers(
    q: str | None = Query(None, max_length=120),
    region: str | None = None,
    district: str | None = None,
    operator_type: str | None = None,
    service_level: str | None = None,
    verified: str | None = Query(None, pattern="^(yes|no)$"),
    location: str | None = Query(None, pattern="^(set|missing)$"),
    page_no: int = Query(1, ge=1, alias="page"),
    page_size: int = Query(20, ge=1, le=100),
    _admin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    conds = _matches_text(q, AmbulanceProvider.id, (
        AmbulanceProvider.name, AmbulanceProvider.district, AmbulanceProvider.region,
        AmbulanceProvider.base_address, AmbulanceProvider.phone,
    ))
    for column, value in ((AmbulanceProvider.region, region),
                          (AmbulanceProvider.district, district)):
        if value:
            conds.append(func.lower(column) == value.strip().lower())
    if operator_type:
        conds.append(AmbulanceProvider.operator_type == operator_type)
    if service_level:
        conds.append(AmbulanceProvider.service_level == service_level)
    conds += _yes_no(AmbulanceProvider.verified, verified)
    if location:
        conds.append(AmbulanceProvider.location_confirmed.is_(location == "set"))
    order = [AmbulanceProvider.name.asc(), AmbulanceProvider.id.asc()]
    if q and q.strip():
        order.insert(0, case_rank(func.lower(AmbulanceProvider.name), q.strip().lower()))
    return _paged(db, AmbulanceProvider, conds, order, page_no, page_size,
                  _provider_admin_detail)


def case_rank(name, phrase: str):
    """Exact name first, then names starting with the text."""
    return case((name == phrase, 0), (name.like(f"{phrase}%"), 1), else_=2)


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
    # The editor sends names only. Keep each service's care type, moving the
    # ones filed under the old category to the new one.
    old_category = facility.category
    old_care_types = {s.service_name.casefold(): s.care_type for s in facility.services}
    moved = (payload.lat, payload.lng) != (facility.lat, facility.lng)
    fields = payload.model_dump(
        exclude={"services", "insurance", "total_beds", "available_beds"}
    )
    if fields.get("district") is None:
        fields.pop("district", None)  # older clients do not send it
    for field, value in fields.items():
        setattr(facility, field, value)
    if moved:
        facility.location_confirmed = True
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
            care_type=(
                item.care_type
                or _carried_care_type(old_care_types.get(name.casefold()), old_category, facility.category)
                or default_care_type(name, facility.category)
            ),
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
    moved = (payload.lat, payload.lng) != (provider.lat, provider.lng)
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
    if moved:
        provider.location_confirmed = True
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
    contact_requests = db.scalars(
        select(ContactRequest)
        .where(ContactRequest.status == "pending")
        .order_by(ContactRequest.created_at, ContactRequest.id)
    ).all()

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
            "must_change_password": admin.must_change_password,
            "created_at": admin.created_at,
        })

    changes = db.scalars(
        select(AdminChangeLog).order_by(AdminChangeLog.created_at.desc()).limit(200)
    ).all()
    return {
        "contact_requests": [
            {
                "id": item.id,
                "facility_name": item.facility_name,
                "organization_type": item.organization_type,
                "email": item.email,
                "phone": item.phone,
                "contact_name": item.contact_name,
                "message": item.message,
                "created_at": item.created_at,
            }
            for item in contact_requests
        ],
        "admins": admin_items,
        # The directory itself is searched page by page through
        # /superadmin/facilities and /superadmin/providers.
        "stats": {
            "facilities": db.scalar(select(func.count(Facility.id))) or 0,
            "providers": db.scalar(select(func.count(AmbulanceProvider.id))) or 0,
            "unverified_facilities": db.scalar(
                select(func.count(Facility.id)).where(Facility.verified.is_(False))
            ) or 0,
            "hidden_facilities": db.scalar(
                select(func.count(Facility.id)).where(Facility.location_confirmed.is_(False))
            ) or 0,
            "pending_requests": len(contact_requests),
            "admins": len(admin_items),
        },
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


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreateIn,
    request: Request,
    superadmin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    """Create a listing and its admin login with a default password,
    returned with a ready-to-send message for the superadmin to email.

    This is the only way organization accounts come into existence. With a
    contact_request_id it also approves that request.
    """
    email = payload.email.strip().lower()
    org_type = ORGANIZATION_TYPES[payload.organization_type]
    category = org_type["category"]

    contact = None
    if payload.contact_request_id is not None:
        contact = db.get(ContactRequest, payload.contact_request_id)
        if contact is None or contact.status != "pending":
            raise HTTPException(
                status_code=404, detail="Contact request not found or already reviewed."
            )
    if _email_in_use(db, email):
        raise HTTPException(status_code=409, detail="An account already uses this email.")
    if payload.region not in REGION_CENTROIDS:
        raise HTTPException(status_code=422, detail="Choose one of the 16 regions.")
    if (payload.lat is None) != (payload.lng is None):
        raise HTTPException(
            status_code=422,
            detail="Enter both latitude and longitude, or leave both blank.",
        )
    if payload.lat is not None and not in_ghana(payload.lat, payload.lng):
        raise HTTPException(
            status_code=422,
            detail="That point is outside Ghana. Check latitude and longitude are not swapped.",
        )
    classification = payload.classification.strip()
    if category in HEALTH_FACILITY_CATEGORIES and not classification:
        raise HTTPException(
            status_code=422, detail="Choose a classification for hospitals and clinics."
        )

    # Without coordinates the record sits at the region centroid, unlisted,
    # until the organization sets its real position.
    location_confirmed = payload.lat is not None
    lat, lng = (
        (payload.lat, payload.lng) if location_confirmed else REGION_CENTROIDS[payload.region]
    )
    ownership = (
        org_type["ownership"]
        if category == "hospital"
        else payload.ownership or org_type["ownership"]
    )
    name = payload.name.strip()
    city = payload.city.strip()
    address = payload.address.strip()
    phone = payload.phone.strip()

    if category is None:
        organization_type = "provider"
        organization = AmbulanceProvider(
            name=name,
            operator_type=ownership,
            service_level="BLS",
            base_address=address,
            region=payload.region,
            district=city,
            lat=lat,
            lng=lng,
            location_confirmed=location_confirmed,
            phone=phone,
            verified=False,
            last_updated=utcnow(),
        )
        organization.coverage = [AmbulanceCoverage(region=payload.region, district="")]
    else:
        organization_type = "facility"
        organization = Facility(
            name=name,
            type=ownership,
            category=category,
            classification=(
                classification if category in HEALTH_FACILITY_CATEGORIES else UNCLASSIFIED
            ),
            address=address,
            region=payload.region,
            city=city,
            town=city,
            lat=lat,
            lng=lng,
            location_confirmed=location_confirmed,
            phone=phone,
            verified=False,
            last_updated=utcnow(),
        )
    db.add(organization)
    db.flush()

    password = generate_password()
    admin = Admin(
        facility_id=organization.id if organization_type == "facility" else None,
        provider_id=organization.id if organization_type == "provider" else None,
        email=email,
        full_name=payload.full_name.strip() or name,
        password_hash=hash_password(password),
        must_change_password=True,
    )
    db.add(admin)
    if contact is not None:
        contact.status = "approved"
        contact.reviewed_at = utcnow()
        contact.reviewed_by = superadmin.email
        contact.facility_id = admin.facility_id
        contact.provider_id = admin.provider_id
    snapshot = (
        _facility_snapshot(organization)
        if organization_type == "facility"
        else _provider_snapshot(organization)
    )
    _record_directory_change(
        db, superadmin, organization_type, organization.id, organization.name,
        f"{organization_type}.created_by_superadmin", {}, snapshot,
    )
    db.commit()
    db.refresh(admin)

    credentials = _issue_credentials(
        admin, organization.name, password, _login_url(request)
    )
    return {
        "organization_type": organization_type,
        "organization_id": organization.id,
        "organization_name": organization.name,
        **credentials,
    }


@router.post(
    "/contact-requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT
)
def reject_contact_request(
    request_id: int,
    superadmin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    contact = db.get(ContactRequest, request_id)
    if contact is None or contact.status != "pending":
        raise HTTPException(
            status_code=404, detail="Contact request not found or already reviewed."
        )
    contact.status = "rejected"
    contact.reviewed_at = utcnow()
    contact.reviewed_by = superadmin.email
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admins/{admin_id}/reset-password")
def reset_admin_password(
    admin_id: int,
    request: Request,
    _superadmin: SuperAdmin = Depends(get_current_superadmin),
    db: Session = Depends(get_db),
):
    """For an organization that lost its password and contacted us: issue a
    new default password. The old one stops working at once, and the admin
    must choose their own again on next sign-in -- which also locks out any
    session still open on the old password."""
    admin = db.get(Admin, admin_id)
    if admin is None:
        raise HTTPException(status_code=404, detail="Administrator not found.")
    organization = (
        db.get(Facility, admin.facility_id)
        if admin.facility_id
        else db.get(AmbulanceProvider, admin.provider_id)
    )
    organization_name = organization.name if organization else "your organization"
    password = generate_password()
    admin.password_hash = hash_password(password)
    admin.must_change_password = True
    db.commit()
    return _issue_credentials(
        admin, organization_name, password, _login_url(request), reset=True
    )


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
