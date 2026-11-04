"""Pydantic request/response models. All API output is JSON (PRD 6.3)."""
from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

T = TypeVar("T")
InsuranceName = Annotated[str, Field(min_length=1, max_length=80)]
# Deliberately not EmailStr: login must accept whatever address the account
# was created with, so every email field shares this looser check.
Email = Annotated[
    str, Field(min_length=3, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
]
FacilityCategory = Literal["hospital", "clinic", "pharmacy", "hearse", "caregiver"]
# Keys of reference.ORGANIZATION_TYPES.
OrganizationType = Literal[
    "hospital_government",
    "hospital_private",
    "clinic",
    "pharmacy",
    "ambulance",
    "hearse",
    "caregiver",
]


# --------------------------------------------------------------------------
# shared
# --------------------------------------------------------------------------
class Page(BaseModel, Generic[T]):
    """PRD 6.3: all search endpoints support pagination."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int
    data_verified: bool = Field(
        description="False while the dataset is unverified seed data (PRD 7.1)."
    )


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    service_name: str
    is_active: bool


class BedsOut(BaseModel):
    total_beds: int | None = None
    available_beds: int | None = None
    updated_at: datetime | None = None
    is_stale: bool = True
    # PRD 7.3: shows "Not updated" once the 24h window lapses.
    display: str


class AmbulanceStatusOut(BaseModel):
    total_units: int | None = None
    units_available: int | None = None
    updated_at: datetime | None = None
    is_stale: bool = True
    display: str


class CoverageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    region: str
    district: str


# --------------------------------------------------------------------------
# facilities
# --------------------------------------------------------------------------
class FacilitySummary(BaseModel):
    id: int
    name: str
    type: str
    category: str
    classification: str
    region: str
    city: str
    town: str
    lat: float
    lng: float
    phone: str
    is_24_hour: bool
    has_ambulance: bool
    verified: bool
    last_verified: datetime | None = None
    distance_km: float | None = None
    services: list[str] = []
    beds: BedsOut | None = None


class FacilityDetail(FacilitySummary):
    address: str
    hours: str
    ambulance_phone: str
    ambulance_provider_id: int | None = None
    insurance: list[str] = []
    service_detail: list[ServiceOut] = []
    last_updated: datetime


# --------------------------------------------------------------------------
# ambulance
# --------------------------------------------------------------------------
class AmbulanceSummary(BaseModel):
    id: int
    name: str
    operator_type: str
    service_level: str
    region: str
    district: str
    lat: float
    lng: float
    phone: str
    alt_phone: str
    is_24_hour: bool
    cost_band: str
    verified: bool
    phone_verified_at: datetime | None = None
    distance_km: float | None = None
    covers_user_area: bool | None = None
    status: AmbulanceStatusOut | None = None


class AmbulanceDetail(AmbulanceSummary):
    base_address: str
    hours: str
    coverage: list[CoverageOut] = []
    last_updated: datetime


# --------------------------------------------------------------------------
# emergency (PRD 5.1.4)
# --------------------------------------------------------------------------
class EmergencyOut(BaseModel):
    emergency_number: str
    notice: str
    data_verified: bool
    facilities: list[FacilitySummary]
    ambulance_providers: list[AmbulanceSummary]
    located_region: str | None = None


# --------------------------------------------------------------------------
# reference
# --------------------------------------------------------------------------
class ClassificationOut(BaseModel):
    level: str
    name: str
    description: str


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: Email
    password: str = Field(min_length=8, max_length=72)


class ContactRequestIn(BaseModel):
    """Public contact form: an organization asking to be listed."""

    facility_name: str = Field(min_length=2, max_length=200)
    organization_type: OrganizationType
    email: Email
    phone: str = Field(min_length=7, max_length=40, pattern=r"^\+?[0-9 ()-]{7,40}$")
    contact_name: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=1000)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=8, max_length=72)
    new_password: str = Field(min_length=12, max_length=72)


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    scope: Literal["facility", "provider"]
    facility_id: int | None = None
    provider_id: int | None = None
    must_change_password: bool = False


class AdminMeOut(BaseModel):
    id: int
    email: str
    full_name: str
    scope: Literal["facility", "provider"]
    facility_id: int | None = None
    provider_id: int | None = None
    facility_name: str | None = None
    provider_name: str | None = None
    must_change_password: bool = False


class BedUpdateIn(BaseModel):
    total_beds: int = Field(ge=0, le=10000)
    available_beds: int = Field(ge=0, le=10000)


class ServiceStatusIn(BaseModel):
    service_name: str = Field(min_length=1, max_length=80)
    is_active: bool


class ServicesUpdateIn(BaseModel):
    services: list[ServiceStatusIn]


class FleetUpdateIn(BaseModel):
    total_units: int = Field(ge=0, le=1000)
    units_available: int = Field(ge=0, le=1000)


class CoverageIn(BaseModel):
    region: str = Field(min_length=1, max_length=60)
    district: str = Field(default="", max_length=80)


class OrganizationCreateIn(BaseModel):
    """Superadmin creates a listing plus its admin login, usually from a
    contact request. Leaving lat/lng blank lets the organization set its own
    position after signing in."""

    contact_request_id: int | None = Field(default=None, gt=0)
    organization_type: OrganizationType
    name: str = Field(min_length=1, max_length=200)
    email: Email
    full_name: str = Field(default="", max_length=120)
    phone: str = Field(min_length=1, max_length=40)
    # Ignored for hospital types, whose ownership is part of the type.
    ownership: Literal["government", "private"] | None = None
    # Required for hospitals and clinics; ignored for other categories.
    classification: str = Field(default="", max_length=40)
    region: str = Field(min_length=1, max_length=60)
    city: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class SuperadminFacilityUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: Literal["government", "private"]
    category: FacilityCategory
    classification: str = Field(min_length=1, max_length=40)
    address: str = Field(default="", max_length=300)
    region: str = Field(min_length=1, max_length=60)
    city: str = Field(default="", max_length=80)
    town: str = Field(default="", max_length=80)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    phone: str = Field(default="", max_length=40)
    hours: str = Field(default="", max_length=120)
    is_24_hour: bool
    has_ambulance: bool
    ambulance_phone: str = Field(default="", max_length=40)
    ambulance_provider_id: int | None = Field(default=None, gt=0)
    verified: bool
    services: list[ServiceStatusIn] = Field(default_factory=list, max_length=200)
    insurance: list[InsuranceName] = Field(default_factory=list, max_length=100)
    total_beds: int | None = Field(default=None, ge=0, le=10000)
    available_beds: int | None = Field(default=None, ge=0, le=10000)


class SuperadminProviderUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    operator_type: Literal["government", "private", "facility_attached"]
    service_level: Literal["BLS", "ALS"]
    base_address: str = Field(default="", max_length=300)
    region: str = Field(min_length=1, max_length=60)
    district: str = Field(default="", max_length=80)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    phone: str = Field(min_length=1, max_length=40)
    alt_phone: str = Field(default="", max_length=40)
    hours: str = Field(default="24 hours", max_length=120)
    is_24_hour: bool
    cost_band: str = Field(default="", max_length=20)
    verified: bool
    phone_verified: bool
    coverage: list[CoverageIn] = Field(default_factory=list, max_length=500)
    total_units: int | None = Field(default=None, ge=0, le=1000)
    units_available: int | None = Field(default=None, ge=0, le=1000)
