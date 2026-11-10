"""Static reference data: regions, classifications, services, insurers.

Kept as constants rather than tables because they change on a legislative
timescale, not an operational one. The endpoints in routers/reference.py
serve these directly.
"""
import re

# The 16 regions of Ghana (PRD 3.1: "All 16").
GHANA_REGIONS = [
    "Ahafo",
    "Ashanti",
    "Bono",
    "Bono East",
    "Central",
    "Eastern",
    "Greater Accra",
    "North East",
    "Northern",
    "Oti",
    "Savannah",
    "Upper East",
    "Upper West",
    "Volta",
    "Western",
    "Western North",
]

# Medical facility category, smallest to largest. Stored as the text itself
# in Facility.classification. "level" and "name" are the same; both are kept
# so older clients that read either keep working.
_CATEGORY_LIST = [
    ("CHPS compound / Maternity home", "Community care, births and referrals."),
    ("Health centre", "Primary care. Limited inpatient."),
    ("Polyclinic", "Outpatient care and minor procedures."),
    ("District / Municipal hospital", "District-level inpatient and outpatient care."),
    ("Regional hospital", "Regional referral. Most specialties."),
    ("Specialised hospital / clinic", "One field of care: eye, dental, maternity, heart and others."),
    ("Tertiary hospital", "Advanced referral care across many specialties."),
    ("Teaching hospital", "Tertiary referral and training. Full specialist services."),
]
CLASSIFICATIONS = [
    {"level": name, "name": name, "description": description}
    for name, description in _CATEGORY_LIST
]
FACILITY_CLASS_NAMES = [name for name, _ in _CATEGORY_LIST]
CHPS, HEALTH_CENTRE, POLYCLINIC, DISTRICT, REGIONAL, SPECIALISED, TERTIARY, TEACHING = FACILITY_CLASS_NAMES

# The Ghana Health Service levels used before these categories.
LEGACY_CLASSIFICATIONS = {
    "Level A": TEACHING,
    "Level B": REGIONAL,
    "Level C": DISTRICT,
    "Level D": POLYCLINIC,
    "Level E": HEALTH_CENTRE,
    "Level F": CHPS,
}

_SPECIALISED_WORDS = re.compile(
    r"\b(speciali[sz]ed|specialist|eye|optical|vision|dental|dentist|orthop(a)?edic|fertility|"
    r"cardiac|cardio|heart|psychiatric|mental|cancer|oncology|kidney|renal|skin|dermatology|"
    r"children'?s|women'?s|maternity hospital|ent)\b", re.I)


def facility_class(name: str, category: str, ownership: str = "", legacy: str = "",
                   services=()) -> str:
    """The medical facility category for a hospital or clinic, from its old
    level where there is one, otherwise from its name. Unknown stays
    "Not classified" rather than being guessed."""
    if category not in HEALTH_FACILITY_CATEGORIES:
        return UNCLASSIFIED
    if legacy in LEGACY_CLASSIFICATIONS:
        return LEGACY_CLASSIFICATIONS[legacy]
    if legacy in FACILITY_CLASS_NAMES:
        return legacy
    rules = [
        (r"\bTeaching Hospital\b", TEACHING),
        (r"\bTertiary\b", TERTIARY),
        (r"\bRegional Hospital\b", REGIONAL),
        (r"\bPol[iy] ?c?linic\b", POLYCLINIC),
        (r"\bCHPS\b|\bCompound\b|\bHealth Post\b|\bMaternity Home\b|\bBirth(ing)? (Home|Cent(re|er))\b"
         r"|\bCommunity[- ]based Health Planning\b", CHPS),
    ]
    for pattern, value in rules:
        if re.search(pattern, name, re.I):
            return value
    if _SPECIALISED_WORDS.search(name) or list(services) in (["Dental"], ["Eye Care"]):
        return SPECIALISED
    if re.search(r"\b(District|Municipal|Metropolitan|Government|Govt) Hospital\b", name, re.I):
        return DISTRICT
    if re.search(r"\bHealth Cent(re|er)\b", name, re.I):
        return HEALTH_CENTRE
    if ownership == "government":
        return DISTRICT if category == "hospital" else HEALTH_CENTRE
    return UNCLASSIFIED


# PRD 5.1.3, amended in v1.1 to include Dental.
SERVICE_CATALOG = [
    "Accident and Emergency",
    "Antenatal Care",
    "Cardio therapy",
    "Dental",
    "Dermatology",
    "Dialysis",
    "ENT",
    "Eye Care",
    "ICU",
    "Immunisation",
    "Laboratory",
    "Maternity",
    "Mental Health",
    "Orthopaedics",
    "Outpatient",
    "Paediatrics",
    "Pharmacy",
    "Physiotherapy",
    "Radiology / X-Ray",
    "Spirometry",
    "Surgery",
    "Ultrasound",
]

# PRD 5.1.3.
INSURANCE_PROVIDERS = [
    "NHIS",
    "Premium insurance",
    "Assurance insurance",
    "Acacia",
    "Apex",
    "Enterprise",
    "GLICO",
    "Metropolitan",
    "Nationwide",
    "Phoenix",
    "Premier",
]

# Approximate region centroids, used only as a last-resort fallback when a
# coordinate cannot be resolved from the facility dataset. Replace with real
# district boundary polygons when PostGIS lands -- see PRD 6.3.
REGION_CENTROIDS = {
    "Ahafo": (6.95, -2.50),
    "Ashanti": (6.75, -1.50),
    "Bono": (7.60, -2.50),
    "Bono East": (7.90, -1.20),
    "Central": (5.55, -1.00),
    "Eastern": (6.35, -0.45),
    "Greater Accra": (5.75, -0.10),
    "North East": (10.35, -0.45),
    "Northern": (9.50, -0.85),
    "Oti": (8.00, 0.30),
    "Savannah": (9.05, -1.80),
    "Upper East": (10.75, -0.90),
    "Upper West": (10.35, -2.30),
    "Volta": (6.60, 0.47),
    "Western": (5.30, -2.30),
    "Western North": (6.20, -2.80),
}

# Rough bounding box for Ghana, with a margin. Catches the common mistake of
# swapping latitude and longitude when an organization sets its location.
GHANA_BOUNDS = {"min_lat": 4.0, "max_lat": 11.5, "min_lng": -3.6, "max_lng": 1.6}


def in_ghana(lat: float, lng: float) -> bool:
    return (
        GHANA_BOUNDS["min_lat"] <= lat <= GHANA_BOUNDS["max_lat"]
        and GHANA_BOUNDS["min_lng"] <= lng <= GHANA_BOUNDS["max_lng"]
    )


# What kind of place a Facility row is. Ambulance services are not here:
# they are AmbulanceProvider rows (PRD v1.1 5.1.6). A "laboratory" does lab
# work only; a hospital with a lab is a hospital that also offers the
# laboratory care type below.
FACILITY_CATEGORIES = ["hospital", "clinic", "laboratory", "pharmacy", "hearse", "caregiver"]
# Only these take a GHS classification and appear in emergency mode -- a
# hearse or a pharmacy is not where to send someone in trouble.
HEALTH_FACILITY_CATEGORIES = ("hospital", "clinic")
UNCLASSIFIED = "Not classified"

# The kinds of care one facility can offer under one roof: a hospital can
# also run a medical laboratory (lab tests, scans and X-rays) and a
# pharmacy. Each service belongs to one of these (Service.care_type). The
# facility's own category is always one of its care types. "services" are
# the suggestions offered to the facility admin; they can add any other
# service by name. Eye, dental and maternity care are services of a
# hospital or clinic (a specialised one when that is all it does).
CARE_TYPES = {
    "hospital": {
        "label": "Hospital",
        "services": [
            "Accident and Emergency", "Outpatient", "Inpatient admission", "Surgery",
            "Maternity", "ICU", "Paediatrics", "Antenatal Care", "Cardio therapy",
            "Orthopaedics", "ENT", "Eye Care", "Dental", "Dermatology", "Mental Health",
            "Dialysis", "Physiotherapy", "Spirometry", "Immunisation",
        ],
    },
    "clinic": {
        "label": "Clinic",
        "services": [
            "Outpatient", "Antenatal Care", "Maternity", "Delivery", "Postnatal care",
            "Immunisation", "Family planning", "Paediatrics", "Eye Care", "Eye test",
            "Glasses and lenses", "Dental", "Tooth extraction", "Fillings", "Cardio therapy",
            "Spirometry", "Minor procedures", "Wound dressing", "Health screening",
            "Physiotherapy",
        ],
    },
    "laboratory": {
        "label": "Medical laboratory",
        "services": [
            "Laboratory", "Malaria test", "Full blood count", "Blood sugar test",
            "Urine test", "Stool test", "Typhoid test", "HIV test", "Hepatitis B test",
            "Pregnancy test", "Blood group and crossmatch", "Lipid profile",
            "Liver function test", "Kidney function test", "Thyroid function test",
            "Sickle cell test", "TB (sputum) test", "Prostate (PSA) test", "Semen analysis",
            "COVID-19 test", "Spirometry", "Radiology / X-Ray", "Ultrasound", "CT scan",
            "MRI", "Mammogram", "ECG", "Echocardiogram", "Home sample collection",
        ],
    },
    "pharmacy": {
        "label": "Pharmacy",
        "services": [
            "Pharmacy", "Prescription medicines", "Over-the-counter medicines",
            "NHIS medicines", "Blood pressure check", "Blood sugar check",
            "Family planning products", "Medical supplies",
        ],
    },
    "hearse": {
        "label": "Hearse service",
        "services": ["Hearse hire", "Body transport", "Funeral services"],
    },
    "caregiver": {
        "label": "Caregiving",
        "services": ["Home nursing", "Elderly care", "Post-surgery care", "Disability care"],
    },
}
# Care types used before scans joined the laboratory and eye, dental and
# maternity became services of the hospital or clinic itself.
FOLDED_CARE_TYPES = {"imaging": "laboratory", "dental": None, "eye": None, "maternity": None}

# Catalogue services that belong to their own care type wherever they are
# offered: a hospital's "Laboratory" is its laboratory. Anything else falls
# under the facility's category.
OWN_CARE_TYPES = {
    "laboratory": "laboratory",
    "pharmacy": "pharmacy",
    "radiology / x-ray": "laboratory",
    "ultrasound": "laboratory",
}


def default_care_type(service_name: str, category: str) -> str:
    return OWN_CARE_TYPES.get(service_name.strip().lower(), category)


# Wards a hospital or clinic can have (Facility.wards, comma-separated keys).
WARDS = {"children": "Children's ward", "female": "Female ward", "male": "Male ward"}

# Choices on the public contact form. Each maps to a Facility category and
# default ownership, or to an AmbulanceProvider when category is None.
ORGANIZATION_TYPES = {
    "hospital_government": {
        "label": "Hospital (government)", "category": "hospital", "ownership": "government",
    },
    "hospital_private": {
        "label": "Hospital (private)", "category": "hospital", "ownership": "private",
    },
    "clinic": {"label": "Clinic", "category": "clinic", "ownership": "private"},
    "laboratory": {
        "label": "Laboratory / diagnostic centre", "category": "laboratory", "ownership": "private",
    },
    "pharmacy": {
        "label": "Pharmacy / medical store", "category": "pharmacy", "ownership": "private",
    },
    "ambulance": {"label": "Ambulance service", "category": None, "ownership": "private"},
    "hearse": {"label": "Hearse service", "category": "hearse", "ownership": "private"},
    "caregiver": {"label": "Caregiver", "category": "caregiver", "ownership": "private"},
}

FACILITY_TYPES = ["government", "private"]
OPERATOR_TYPES = ["government", "private", "facility_attached"]
SERVICE_LEVELS = ["BLS", "ALS"]
COST_BANDS = ["free", "low", "moderate", "premium"]
