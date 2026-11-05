"""Reference lists: regions, services, insurance, classifications (PRD 6.4)."""
from fastapi import APIRouter, Depends
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Facility, Insurance, Service
from ..reference import (
    CARE_TYPES,
    CLASSIFICATIONS,
    COST_BANDS,
    FACILITY_CATEGORIES,
    FACILITY_TYPES,
    ORGANIZATION_TYPES,
    GHANA_REGIONS,
    INSURANCE_PROVIDERS,
    OPERATOR_TYPES,
    SERVICE_CATALOG,
    SERVICE_LEVELS,
)
from ..schemas import CareTypeOut, ClassificationOut

router = APIRouter(tags=["reference"])


@router.get("/regions", response_model=list[str])
def list_regions():
    """All 16 regions (PRD 6.4)."""
    return GHANA_REGIONS


@router.get("/regions/{region}/districts", response_model=list[str])
def list_districts(region: str, db: Session = Depends(get_db)):
    """Metropolitan, municipal and district assemblies with listed facilities."""
    rows = db.scalars(
        select(distinct(Facility.district))
        .where(
            func.lower(Facility.region) == region.strip().lower(),
            Facility.location_confirmed.is_(True),
        )
        .order_by(Facility.district.asc())
    ).all()
    return [r for r in rows if r]


@router.get("/regions/{region}/localities", response_model=list[str])
def list_localities(region: str, district: str | None = None, db: Session = Depends(get_db)):
    """Cities and towns known in a region (or one district of it), for the
    manual search dropdown."""
    conds = [
        func.lower(Facility.region) == region.strip().lower(),
        Facility.location_confirmed.is_(True),
    ]
    if district:
        conds.append(func.lower(Facility.district) == district.strip().lower())
    rows = db.scalars(
        select(distinct(Facility.city)).where(*conds).order_by(Facility.city.asc())
    ).all()
    return [r for r in rows if r]


@router.get("/services", response_model=list[str])
def list_services(db: Session = Depends(get_db)):
    """Service catalogue, union of the standard list and what is in the data."""
    in_use = set(db.scalars(select(distinct(Service.service_name))).all())
    return sorted(set(SERVICE_CATALOG) | {s for s in in_use if s})


@router.get("/care-types", response_model=list[CareTypeOut])
def list_care_types():
    """Kinds of care one facility can offer (hospital, laboratory, pharmacy...),
    each with the services usually found there."""
    return [
        {"value": key, "label": item["label"], "services": item["services"]}
        for key, item in CARE_TYPES.items()
    ]


@router.get("/insurance", response_model=list[str])
def list_insurance(db: Session = Depends(get_db)):
    in_use = set(db.scalars(select(distinct(Insurance.insurance_name))).all())
    return sorted(set(INSURANCE_PROVIDERS) | {i for i in in_use if i})


@router.get("/classifications", response_model=list[ClassificationOut])
def list_classifications():
    """PRD 5.1.5. Ambulance providers are deliberately not on this scale."""
    return CLASSIFICATIONS


@router.get("/enums")
def list_enums():
    """Everything a client needs to build its filter controls."""
    return {
        "facility_types": FACILITY_TYPES,
        "facility_categories": FACILITY_CATEGORIES,
        "organization_types": [
            {"value": key, "label": item["label"], "category": item["category"]}
            for key, item in ORGANIZATION_TYPES.items()
        ],
        "operator_types": OPERATOR_TYPES,
        "service_levels": SERVICE_LEVELS,
        "cost_bands": COST_BANDS,
    }
