"""Seed the database (PRD 7.1, Phase 1: seeding).

IMPORTANT -- data provenance
----------------------------
Facility and provider NAMES, REGIONS and approximate COORDINATES are real
public reference points, good enough to exercise search and distance.

Every PHONE NUMBER here is a PLACEHOLDER. None has been dialled. They exist
so the call flow can be built and tested, and they are deliberately obvious:
+233 30 000 XXXX. Records ship with verified=False and phone_verified_at=None,
so the API reports data_verified=false and the UI shows an unverified banner.

PRD 7.3 requires every ambulance dispatch number to be call-verified before
publication, and PRD 8 requires re-verification every 90 days. Do that before
setting MEDIFINDER_DATA_VERIFIED=true. Until then this is a working dataset,
not a directory anyone should rely on in an emergency.

Run:  python -m app.seed --reset
"""
import argparse
import sys

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import (
    Admin,
    AmbulanceCoverage,
    AmbulanceProvider,
    AmbulanceStatus,
    BedAvailability,
    Facility,
    Insurance,
    Service,
    utcnow,
)
from .security import hash_password

PLACEHOLDER = "+233 30 000 {:04d}"

# Services implied by each GHS classification level (PRD 5.1.5).
BY_LEVEL = {
    "Level A": ["Accident and Emergency", "Outpatient", "Maternity", "Surgery",
                "Paediatrics", "ICU", "Dialysis", "Dental", "Laboratory",
                "Pharmacy", "Radiology / X-Ray", "Ultrasound", "Orthopaedics",
                "Eye Care", "ENT", "Mental Health", "Physiotherapy"],
    "Level B": ["Accident and Emergency", "Outpatient", "Maternity", "Surgery",
                "Paediatrics", "Dental", "Laboratory", "Pharmacy",
                "Radiology / X-Ray", "Ultrasound", "Eye Care"],
    "Level C": ["Accident and Emergency", "Outpatient", "Maternity", "Surgery",
                "Paediatrics", "Laboratory", "Pharmacy", "Ultrasound"],
    "Level D": ["Outpatient", "Maternity", "Laboratory", "Pharmacy",
                "Antenatal Care", "Immunisation"],
    "Level E": ["Outpatient", "Antenatal Care", "Immunisation", "Pharmacy"],
    "Level F": ["Outpatient", "Antenatal Care", "Immunisation"],
    "Private": ["Outpatient", "Laboratory", "Pharmacy"],
}

# name, type, classification, region, city, lat, lng, 24h, has_ambulance, extra services
FACILITIES = [
    # --- Greater Accra ---
    ("Korle Bu Teaching Hospital", "government", "Level A", "Greater Accra", "Accra", 5.5365, -0.2262, True, True, []),
    ("37 Military Hospital", "government", "Level B", "Greater Accra", "Accra", 5.5876, -0.1874, True, True, ["ICU"]),
    ("Greater Accra Regional Hospital (Ridge)", "government", "Level B", "Greater Accra", "Accra", 5.5636, -0.1969, True, True, ["ICU"]),
    ("Police Hospital", "government", "Level C", "Greater Accra", "Accra", 5.5758, -0.1739, True, True, ["Dental"]),
    ("Tema General Hospital", "government", "Level C", "Greater Accra", "Tema", 5.6698, -0.0166, True, True, ["Dental"]),
    ("LEKMA Hospital", "government", "Level C", "Greater Accra", "Teshie", 5.5852, -0.1043, True, False, []),
    ("Achimota Hospital", "government", "Level C", "Greater Accra", "Achimota", 5.6197, -0.2292, True, False, ["Dental"]),
    ("Ga East Municipal Hospital", "government", "Level C", "Greater Accra", "Abokobi", 5.7286, -0.1846, True, False, []),
    ("Mamprobi Polyclinic", "government", "Level D", "Greater Accra", "Accra", 5.5395, -0.2409, False, False, ["Dental"]),
    ("Nyaho Medical Centre", "private", "Private", "Greater Accra", "Accra", 5.6031, -0.1809, True, True, ["Accident and Emergency", "Surgery", "Maternity", "Paediatrics", "ICU", "Dental", "Radiology / X-Ray"]),
    ("The Trust Hospital", "private", "Private", "Greater Accra", "Accra", 5.5561, -0.1795, True, False, ["Accident and Emergency", "Maternity", "Surgery", "Paediatrics", "Dental"]),
    ("Lister Hospital", "private", "Private", "Greater Accra", "Tema", 5.6503, -0.0294, True, True, ["Accident and Emergency", "Maternity", "Surgery", "ICU"]),
    ("Dansoman Dental Clinic", "private", "Private", "Greater Accra", "Accra", 5.5402, -0.2618, False, False, ["Dental"]),
    ("Airport City Dental Studio", "private", "Private", "Greater Accra", "Accra", 5.6045, -0.1731, False, False, ["Dental"]),
    ("Adenta CHPS Compound", "government", "Level F", "Greater Accra", "Adenta", 5.7075, -0.1636, False, False, []),

    # --- Ashanti ---
    ("Komfo Anokye Teaching Hospital", "government", "Level A", "Ashanti", "Kumasi", 6.6975, -1.6295, True, True, []),
    ("Kumasi South Hospital", "government", "Level C", "Ashanti", "Kumasi", 6.6580, -1.6180, True, True, ["Dental"]),
    ("Manhyia District Hospital", "government", "Level C", "Ashanti", "Kumasi", 6.7060, -1.6180, True, False, []),
    ("KNUST Hospital", "government", "Level D", "Ashanti", "Kumasi", 6.6745, -1.5716, False, False, ["Dental"]),
    ("Obuasi Government Hospital", "government", "Level C", "Ashanti", "Obuasi", 6.2027, -1.6636, True, True, []),
    ("Peace and Love Hospital", "private", "Private", "Ashanti", "Kumasi", 6.6900, -1.6300, True, False, ["Surgery", "Radiology / X-Ray"]),
    ("Adum Dental Clinic", "private", "Private", "Ashanti", "Kumasi", 6.6920, -1.6220, False, False, ["Dental"]),
    ("Ejisu Health Centre", "government", "Level E", "Ashanti", "Ejisu", 6.7390, -1.4720, False, False, []),

    # --- Northern ---
    ("Tamale Teaching Hospital", "government", "Level A", "Northern", "Tamale", 9.4008, -0.8393, True, True, []),
    ("Tamale West Hospital", "government", "Level C", "Northern", "Tamale", 9.4050, -0.8560, True, False, ["Dental"]),
    ("Yendi Municipal Hospital", "government", "Level C", "Northern", "Yendi", 9.4427, -0.0093, True, True, []),
    ("Savelugu Health Centre", "government", "Level E", "Northern", "Savelugu", 9.6240, -0.8250, False, False, []),

    # --- Central ---
    ("Cape Coast Teaching Hospital", "government", "Level A", "Central", "Cape Coast", 5.1315, -1.2795, True, True, []),
    ("Winneba Municipal Hospital", "government", "Level C", "Central", "Winneba", 5.3510, -0.6230, True, True, []),
    ("Kasoa Polyclinic", "government", "Level D", "Central", "Kasoa", 5.5340, -0.4200, False, False, ["Dental"]),
    ("Cape Coast Dental Centre", "private", "Private", "Central", "Cape Coast", 5.1080, -1.2460, False, False, ["Dental"]),

    # --- Volta ---
    ("Ho Teaching Hospital", "government", "Level A", "Volta", "Ho", 6.6110, 0.4710, True, True, []),
    ("Keta Municipal Hospital", "government", "Level C", "Volta", "Keta", 5.9170, 0.9880, True, False, []),
    ("Hohoe Municipal Hospital", "government", "Level C", "Volta", "Hohoe", 7.1520, 0.4740, True, True, ["Dental"]),

    # --- Eastern ---
    ("Eastern Regional Hospital", "government", "Level B", "Eastern", "Koforidua", 6.0900, -0.2590, True, True, []),
    ("Atua Government Hospital", "government", "Level C", "Eastern", "Odumase Krobo", 6.1330, 0.0500, True, False, []),
    ("St. Joseph's Hospital", "private", "Private", "Eastern", "Koforidua", 6.0940, -0.2610, True, False, ["Maternity", "Surgery"]),
    ("Nkawkaw Holy Family Hospital", "private", "Level C", "Eastern", "Nkawkaw", 6.5510, -0.7690, True, True, []),

    # --- Western ---
    ("Effia Nkwanta Regional Hospital", "government", "Level B", "Western", "Sekondi-Takoradi", 4.9280, -1.7580, True, True, []),
    ("Takoradi Hospital", "government", "Level C", "Western", "Takoradi", 4.8960, -1.7590, True, False, ["Dental"]),
    ("Tarkwa Municipal Hospital", "government", "Level C", "Western", "Tarkwa", 5.3010, -1.9930, True, False, []),

    # --- Western North ---
    ("Sefwi Wiawso Government Hospital", "government", "Level C", "Western North", "Sefwi Wiawso", 6.2130, -2.4870, True, True, []),
    ("Bibiani Government Hospital", "government", "Level C", "Western North", "Bibiani", 6.4630, -2.3170, True, False, []),

    # --- Upper East ---
    ("Upper East Regional Hospital", "government", "Level B", "Upper East", "Bolgatanga", 10.7850, -0.8510, True, True, []),
    ("War Memorial Hospital", "government", "Level C", "Upper East", "Navrongo", 10.8950, -1.0920, True, False, []),

    # --- Upper West ---
    ("Upper West Regional Hospital", "government", "Level B", "Upper West", "Wa", 10.0600, -2.5010, True, True, []),
    ("Nandom Hospital", "private", "Level C", "Upper West", "Nandom", 10.8520, -2.7560, True, False, []),

    # --- Bono ---
    ("Bono Regional Hospital", "government", "Level B", "Bono", "Sunyani", 7.3390, -2.3260, True, True, []),
    ("Berekum Holy Family Hospital", "private", "Level C", "Bono", "Berekum", 7.4530, -2.5860, True, False, ["Dental"]),

    # --- Bono East ---
    ("Techiman Holy Family Hospital", "private", "Level C", "Bono East", "Techiman", 7.5860, -1.9380, True, True, []),
    ("Kintampo Municipal Hospital", "government", "Level C", "Bono East", "Kintampo", 8.0560, -1.7300, True, False, []),

    # --- Ahafo ---
    ("Goaso Government Hospital", "government", "Level C", "Ahafo", "Goaso", 6.8000, -2.5160, True, True, []),
    ("Hwidiem Government Hospital", "government", "Level D", "Ahafo", "Hwidiem", 6.8930, -2.3700, False, False, []),

    # --- Savannah ---
    ("West Gonja Hospital", "government", "Level C", "Savannah", "Damongo", 9.0830, -1.8180, True, True, []),
    ("Salaga Government Hospital", "government", "Level C", "Savannah", "Salaga", 8.5510, -0.5190, True, False, []),

    # --- North East ---
    ("Nalerigu Baptist Medical Centre", "private", "Level C", "North East", "Nalerigu", 10.5270, -0.3670, True, True, ["Surgery"]),
    ("Walewale Municipal Hospital", "government", "Level C", "North East", "Walewale", 10.3540, -0.8020, True, False, []),

    # --- Oti ---
    ("Worawora Government Hospital", "government", "Level C", "Oti", "Worawora", 7.5210, 0.3860, True, True, []),
    ("Jasikan District Hospital", "government", "Level C", "Oti", "Jasikan", 7.4060, 0.4680, True, False, []),
]

# name, operator_type, service_level, region, district, lat, lng, cost_band, coverage[(region, district)]
PROVIDERS = [
    ("National Ambulance Service - Ridge Station", "government", "ALS", "Greater Accra", "Accra", 5.5636, -0.1969, "free",
     [("Greater Accra", "Accra"), ("Greater Accra", "Achimota"), ("Greater Accra", "Teshie"), ("Greater Accra", "")]),
    ("National Ambulance Service - Tema Station", "government", "BLS", "Greater Accra", "Tema", 5.6698, -0.0166, "free",
     [("Greater Accra", "Tema"), ("Greater Accra", "Adenta"), ("Greater Accra", "")]),
    ("National Ambulance Service - Kumasi Station", "government", "ALS", "Ashanti", "Kumasi", 6.6975, -1.6295, "free",
     [("Ashanti", "Kumasi"), ("Ashanti", "Ejisu"), ("Ashanti", "")]),
    ("National Ambulance Service - Obuasi Station", "government", "BLS", "Ashanti", "Obuasi", 6.2027, -1.6636, "free",
     [("Ashanti", "Obuasi"), ("Ashanti", "")]),
    ("National Ambulance Service - Tamale Station", "government", "ALS", "Northern", "Tamale", 9.4008, -0.8393, "free",
     [("Northern", "Tamale"), ("Northern", "Savelugu"), ("Northern", "")]),
    ("National Ambulance Service - Yendi Station", "government", "BLS", "Northern", "Yendi", 9.4427, -0.0093, "free",
     [("Northern", "Yendi"), ("Northern", "")]),
    ("National Ambulance Service - Cape Coast Station", "government", "ALS", "Central", "Cape Coast", 5.1315, -1.2795, "free",
     [("Central", "Cape Coast"), ("Central", "Winneba"), ("Central", "")]),
    ("National Ambulance Service - Kasoa Station", "government", "BLS", "Central", "Kasoa", 5.5340, -0.4200, "free",
     [("Central", "Kasoa"), ("Central", ""), ("Greater Accra", "")]),
    ("National Ambulance Service - Ho Station", "government", "ALS", "Volta", "Ho", 6.6110, 0.4710, "free",
     [("Volta", "Ho"), ("Volta", "Hohoe"), ("Volta", "")]),
    ("National Ambulance Service - Keta Station", "government", "BLS", "Volta", "Keta", 5.9170, 0.9880, "free",
     [("Volta", "Keta"), ("Volta", "")]),
    ("National Ambulance Service - Koforidua Station", "government", "ALS", "Eastern", "Koforidua", 6.0900, -0.2590, "free",
     [("Eastern", "Koforidua"), ("Eastern", "Nkawkaw"), ("Eastern", "")]),
    ("National Ambulance Service - Takoradi Station", "government", "ALS", "Western", "Sekondi-Takoradi", 4.9280, -1.7580, "free",
     [("Western", "Sekondi-Takoradi"), ("Western", "Takoradi"), ("Western", "Tarkwa"), ("Western", "")]),
    ("National Ambulance Service - Sefwi Wiawso Station", "government", "BLS", "Western North", "Sefwi Wiawso", 6.2130, -2.4870, "free",
     [("Western North", "Sefwi Wiawso"), ("Western North", "Bibiani"), ("Western North", "")]),
    ("National Ambulance Service - Bolgatanga Station", "government", "ALS", "Upper East", "Bolgatanga", 10.7850, -0.8510, "free",
     [("Upper East", "Bolgatanga"), ("Upper East", "Navrongo"), ("Upper East", "")]),
    ("National Ambulance Service - Wa Station", "government", "ALS", "Upper West", "Wa", 10.0600, -2.5010, "free",
     [("Upper West", "Wa"), ("Upper West", "Nandom"), ("Upper West", "")]),
    ("National Ambulance Service - Sunyani Station", "government", "ALS", "Bono", "Sunyani", 7.3390, -2.3260, "free",
     [("Bono", "Sunyani"), ("Bono", "Berekum"), ("Bono", "")]),
    ("National Ambulance Service - Techiman Station", "government", "BLS", "Bono East", "Techiman", 7.5860, -1.9380, "free",
     [("Bono East", "Techiman"), ("Bono East", "Kintampo"), ("Bono East", "")]),
    ("National Ambulance Service - Goaso Station", "government", "BLS", "Ahafo", "Goaso", 6.8000, -2.5160, "free",
     [("Ahafo", "Goaso"), ("Ahafo", "Hwidiem"), ("Ahafo", "")]),
    ("National Ambulance Service - Damongo Station", "government", "BLS", "Savannah", "Damongo", 9.0830, -1.8180, "free",
     [("Savannah", "Damongo"), ("Savannah", "Salaga"), ("Savannah", "")]),
    ("National Ambulance Service - Nalerigu Station", "government", "BLS", "North East", "Nalerigu", 10.5270, -0.3670, "free",
     [("North East", "Nalerigu"), ("North East", "Walewale"), ("North East", "")]),
    ("National Ambulance Service - Jasikan Station", "government", "BLS", "Oti", "Jasikan", 7.4060, 0.4680, "free",
     [("Oti", "Jasikan"), ("Oti", "Worawora"), ("Oti", "")]),
    # Private operators
    ("Rapid Response Ambulance Services", "private", "ALS", "Greater Accra", "Accra", 5.6100, -0.1900, "premium",
     [("Greater Accra", ""), ("Eastern", "")]),
    ("Medix Ambulance Ghana", "private", "BLS", "Greater Accra", "Tema", 5.6600, -0.0200, "moderate",
     [("Greater Accra", ""), ("Volta", "")]),
    ("Ashanti Medical Transport", "private", "ALS", "Ashanti", "Kumasi", 6.6800, -1.6100, "moderate",
     [("Ashanti", ""), ("Bono East", ""), ("Ahafo", "")]),
    # Facility-attached
    ("Korle Bu Hospital Ambulance Unit", "facility_attached", "ALS", "Greater Accra", "Accra", 5.5365, -0.2262, "free",
     [("Greater Accra", "Accra")]),
    ("Komfo Anokye Hospital Ambulance Unit", "facility_attached", "ALS", "Ashanti", "Kumasi", 6.6975, -1.6295, "free",
     [("Ashanti", "Kumasi")]),
    ("Nyaho Medical Centre Ambulance", "facility_attached", "ALS", "Greater Accra", "Accra", 5.6031, -0.1809, "premium",
     [("Greater Accra", "Accra")]),
]

NHIS_ONLY = ["NHIS"]
PRIVATE_MIX = ["NHIS", "Acacia", "Enterprise", "Metropolitan", "Phoenix", "GLICO"]


def reset_schema() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed(reset: bool = False) -> None:
    if reset:
        reset_schema()
    else:
        Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if db.scalar(select(Facility.id).limit(1)) is not None:
            print("Database already seeded. Use --reset to rebuild.")
            return

        provider_by_name: dict[str, AmbulanceProvider] = {}
        for i, (name, op_type, level, region, district, lat, lng, cost, coverage) in enumerate(
            PROVIDERS, start=1
        ):
            provider = AmbulanceProvider(
                name=name,
                operator_type=op_type,
                service_level=level,
                base_address=f"{district}, {region}",
                region=region,
                district=district,
                lat=lat,
                lng=lng,
                phone=PLACEHOLDER.format(i),
                alt_phone="",
                hours="24 hours",
                is_24_hour=True,
                cost_band=cost,
                verified=False,          # PRD 7.3: not until the number is dialled
                phone_verified_at=None,
                last_updated=utcnow(),
            )
            db.add(provider)
            db.flush()
            for c_region, c_district in coverage:
                db.add(
                    AmbulanceCoverage(
                        provider_id=provider.id, region=c_region, district=c_district
                    )
                )
            # No fleet status on seed: it must show "Not updated" until a real
            # provider admin sets it (PRD 7.3).
            provider_by_name[name] = provider

        for i, (name, ftype, level, region, city, lat, lng, is24, has_amb, extra) in enumerate(
            FACILITIES, start=1
        ):
            facility = Facility(
                name=name,
                type=ftype,
                classification=level,
                address=f"{city}, {region}",
                region=region,
                city=city,
                town=city,
                lat=lat,
                lng=lng,
                phone=PLACEHOLDER.format(1000 + i),
                hours="24 hours" if is24 else "08:00 - 17:00, Mon to Fri",
                is_24_hour=is24,
                has_ambulance=has_amb,
                ambulance_phone=PLACEHOLDER.format(2000 + i) if has_amb else "",
                verified=False,
                last_verified=None,
                last_updated=utcnow(),
            )
            db.add(facility)
            db.flush()

            names = list(dict.fromkeys(BY_LEVEL.get(level, []) + list(extra)))
            # A standalone dental clinic offers dental care and nothing else.
            if "Dental Clinic" in name or "Dental Centre" in name or "Dental Studio" in name:
                names = ["Dental"]
            if has_amb:
                names = names + ["Accident and Emergency"]
            for service_name in dict.fromkeys(names):
                db.add(
                    Service(
                        facility_id=facility.id, service_name=service_name, is_active=True
                    )
                )

            insurers = NHIS_ONLY if ftype == "government" else PRIVATE_MIX
            for insurer in insurers:
                db.add(Insurance(facility_id=facility.id, insurance_name=insurer))

            if level in ("Level A", "Level B", "Level C") or ftype == "private":
                total = {"Level A": 800, "Level B": 300, "Level C": 120}.get(level, 40)
                # Stale on purpose: PRD 7.3 says beds show "Not updated" until a
                # facility admin refreshes them. Seeding real-looking numbers
                # would be the exact failure mode risk 1 in section 10 warns about.
                db.add(
                    BedAvailability(
                        facility_id=facility.id,
                        total_beds=total,
                        available_beds=0,
                        updated_at=utcnow().replace(year=utcnow().year - 1),
                    )
                )

        db.flush()

        # Demo administrators, for the dashboard. Change before any deployment.
        korle_bu = db.scalar(select(Facility).where(Facility.name.like("Korle Bu%")))
        nas_ridge = provider_by_name["National Ambulance Service - Ridge Station"]
        db.add(
            Admin(
                facility_id=korle_bu.id,
                email="facility@medifinder.gh",
                password_hash=hash_password("changeme123"),
                full_name="Demo Facility Administrator",
            )
        )
        db.add(
            Admin(
                provider_id=nas_ridge.id,
                email="ambulance@medifinder.gh",
                password_hash=hash_password("changeme123"),
                full_name="Demo Ambulance Administrator",
            )
        )

        db.commit()

        print(f"Seeded {len(FACILITIES)} facilities and {len(PROVIDERS)} ambulance providers.")
        print("Demo logins (change before deploying):")
        print("  facility@medifinder.gh  / changeme123")
        print("  ambulance@medifinder.gh / changeme123")
        print("")
        print("All phone numbers are placeholders. data_verified=false until")
        print("records are verified per PRD 7.3.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the MediFinder database.")
    parser.add_argument("--reset", action="store_true", help="Drop and rebuild all tables")
    args = parser.parse_args()
    seed(reset=args.reset)
    sys.exit(0)
