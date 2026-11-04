"""Static reference data: regions, classifications, services, insurers.

Kept as constants rather than tables because they change on a legislative
timescale, not an operational one. The endpoints in routers/reference.py
serve these directly.
"""

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

# PRD 5.1.5 -- Ghana Health Service classification.
CLASSIFICATIONS = [
    {"level": "Level A", "name": "Teaching Hospital",
     "description": "Tertiary referral. Full specialist services."},
    {"level": "Level B", "name": "Regional Hospital",
     "description": "Regional referral. Most specialties."},
    {"level": "Level C", "name": "District Hospital",
     "description": "District-level inpatient and outpatient care."},
    {"level": "Level D", "name": "Polyclinic",
     "description": "Outpatient and minor procedures."},
    {"level": "Level E", "name": "Health Centre / Clinic",
     "description": "Primary care. Limited inpatient."},
    {"level": "Level F", "name": "CHPS Compound",
     "description": "Community-level. Basic care and referrals."},
    {"level": "Private", "name": "Private Hospital / Clinic",
     "description": "Varies by facility size and registration. "
                    "Standalone dental clinics are classified here (PRD 5.1.1)."},
]

# PRD 5.1.3, amended in v1.1 to include Dental.
SERVICE_CATALOG = [
    "Accident and Emergency",
    "Antenatal Care",
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
    "Surgery",
    "Ultrasound",
]

# PRD 5.1.3.
INSURANCE_PROVIDERS = [
    "NHIS",
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
# they are AmbulanceProvider rows (PRD v1.1 5.1.6).
FACILITY_CATEGORIES = ["hospital", "clinic", "pharmacy", "hearse", "caregiver"]
# Only these take a GHS classification and appear in emergency mode -- a
# hearse or a pharmacy is not where to send someone in trouble.
HEALTH_FACILITY_CATEGORIES = ("hospital", "clinic")
UNCLASSIFIED = "Not classified"

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
