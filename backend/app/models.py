"""ORM models. Table and field names follow PRD v1.1 section 6.2."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    """Naive UTC. Stored uniformly so SQLite and PostgreSQL agree without a
    timezone-aware column type on either side."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Facility(Base):
    __tablename__ = "facilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # "government" | "private"  (PRD 5.1.1)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # reference.FACILITY_CATEGORIES: hospital, clinic, pharmacy, hearse, caregiver
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="hospital")
    # Level A..F | Private       (PRD 5.1.5)
    classification: Mapped[str] = mapped_column(String(40), nullable=False)
    address: Mapped[str] = mapped_column(String(300), default="")
    region: Mapped[str] = mapped_column(String(60), nullable=False)
    city: Mapped[str] = mapped_column(String(80), default="")
    town: Mapped[str] = mapped_column(String(80), default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    # False while lat/lng is only the region centroid placeholder. Such
    # records stay out of public listings until the organization sets its
    # real position, so distance results are never invented.
    location_confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    hours: Mapped[str] = mapped_column(String(120), default="")
    is_24_hour: Mapped[bool] = mapped_column(Boolean, default=False)

    # PRD 5.1.3: ambulance fields on the facility profile.
    has_ambulance: Mapped[bool] = mapped_column(Boolean, default=False)
    ambulance_phone: Mapped[str] = mapped_column(String(40), default="")
    ambulance_provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("ambulance_providers.id", ondelete="SET NULL"), nullable=True
    )

    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    last_verified: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    services = relationship(
        "Service", back_populates="facility", cascade="all, delete-orphan", lazy="selectin"
    )
    insurance = relationship(
        "Insurance", back_populates="facility", cascade="all, delete-orphan", lazy="selectin"
    )
    beds = relationship(
        "BedAvailability",
        back_populates="facility",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
    wait_time = relationship(
        "WaitTime",
        back_populates="facility",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
    ambulance_provider = relationship("AmbulanceProvider", lazy="selectin")


Index("ix_facilities_region", Facility.region)
Index("ix_facilities_point", Facility.lat, Facility.lng)
Index("ix_facilities_classification", Facility.classification)


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False
    )
    # PRD v1.1 5.1.3: "Dental" is simply a value here -- no schema change.
    service_name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    facility = relationship("Facility", back_populates="services")

    __table_args__ = (UniqueConstraint("facility_id", "service_name", name="uq_facility_service"),)


Index("ix_services_name", Service.service_name)


class Insurance(Base):
    __tablename__ = "insurance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False
    )
    insurance_name: Mapped[str] = mapped_column(String(80), nullable=False)

    facility = relationship("Facility", back_populates="insurance")

    __table_args__ = (UniqueConstraint("facility_id", "insurance_name", name="uq_facility_ins"),)


Index("ix_insurance_name", Insurance.insurance_name)


class BedAvailability(Base):
    __tablename__ = "bed_availability"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    total_beds: Mapped[int] = mapped_column(Integer, default=0)
    available_beds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    facility = relationship("Facility", back_populates="beds")


class WaitTime(Base):
    """PRD 5.2.4 -- Phase 2. Table defined now so the schema does not churn."""

    __tablename__ = "wait_times"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    facility = relationship("Facility", back_populates="wait_time")


class AmbulanceProvider(Base):
    """PRD v1.1 5.1.6 -- a mobile resource, deliberately not a Facility."""

    __tablename__ = "ambulance_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # "government" | "private" | "facility_attached"
    operator_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # "BLS" | "ALS"
    service_level: Mapped[str] = mapped_column(String(10), nullable=False, default="BLS")
    base_address: Mapped[str] = mapped_column(String(300), default="")
    region: Mapped[str] = mapped_column(String(60), nullable=False)
    district: Mapped[str] = mapped_column(String(80), default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    # See Facility.location_confirmed.
    location_confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    alt_phone: Mapped[str] = mapped_column(String(40), default="")
    hours: Mapped[str] = mapped_column(String(120), default="24 hours")
    is_24_hour: Mapped[bool] = mapped_column(Boolean, default=True)
    # "free" | "low" | "moderate" | "premium"  (PRD 5.1.6, private operators)
    cost_band: Mapped[str] = mapped_column(String(20), default="")

    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # PRD 7.3: dispatch numbers are call-verified before publication and
    # re-verified every 90 days (PRD 8, Emergency data accuracy).
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    coverage = relationship(
        "AmbulanceCoverage",
        back_populates="provider",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    status = relationship(
        "AmbulanceStatus",
        back_populates="provider",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )


Index("ix_amb_region", AmbulanceProvider.region)
Index("ix_amb_point", AmbulanceProvider.lat, AmbulanceProvider.lng)


class AmbulanceCoverage(Base):
    """Which districts a provider actually serves (PRD 5.1.6).

    Coverage is matched before distance, because the nearest base station
    does not always serve the caller's district.
    """

    __tablename__ = "ambulance_coverage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("ambulance_providers.id", ondelete="CASCADE"), nullable=False
    )
    region: Mapped[str] = mapped_column(String(60), nullable=False)
    district: Mapped[str] = mapped_column(String(80), default="")

    provider = relationship("AmbulanceProvider", back_populates="coverage")

    __table_args__ = (
        UniqueConstraint("provider_id", "region", "district", name="uq_provider_area"),
    )


Index("ix_coverage_region", AmbulanceCoverage.region)


class AmbulanceStatus(Base):
    __tablename__ = "ambulance_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("ambulance_providers.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    units_available: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    provider = relationship("AmbulanceProvider", back_populates="status")


class Admin(Base):
    """PRD v1.1 6.2: one login model, nullable provider_id, serves both
    facility administrators and ambulance provider administrators."""

    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int | None] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=True
    )
    provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("ambulance_providers.id", ondelete="CASCADE"), nullable=True
    )
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    # Set when a superadmin creates the login with a default password; every admin API
    # except "change password" refuses the account until it is cleared.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContactRequest(Base):
    """An organization asking to be listed, from the public contact form.

    Unauthenticated input: it grants nothing. A superadmin verifies it and
    then creates the listing and admin account from it.
    """

    __tablename__ = "contact_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # A key of reference.ORGANIZATION_TYPES
    organization_type: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    # "pending" | "approved" | "rejected"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[str] = mapped_column(String(160), default="")
    facility_id: Mapped[int | None] = mapped_column(
        ForeignKey("facilities.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("ambulance_providers.id", ondelete="SET NULL"), nullable=True
    )


class SuperAdmin(Base):
    __tablename__ = "superadmins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AdminChangeLog(Base):
    __tablename__ = "admin_change_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )
    admin_email: Mapped[str] = mapped_column(String(160), nullable=False)
    organization_type: Mapped[str] = mapped_column(String(20), nullable=False)
    organization_id: Mapped[int] = mapped_column(Integer, nullable=False)
    organization_name: Mapped[str] = mapped_column(String(200), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    changes_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
