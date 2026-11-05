"""Load the open-data facility directory (data/ghana_facilities.csv).

Safe on a live database: it never deletes anything. A record is matched to
an earlier import by (source, source_ref) and refreshed, unless an
organization has taken it over (it has an admin account) or it has been
verified -- those belong to the organization now and are left alone.
A record that matches a hand-entered seed listing (same name, within 1 km)
is merged into it rather than added twice; other duplicates are skipped.

Every imported record is unverified. Phone numbers come from the source,
have not been dialled, and the UI says so.

Run:  python -m app.directory_import [path/to/ghana_facilities.csv]
"""
import csv
import math
import re
import sys
from pathlib import Path

from sqlalchemy import select

from .config import DATA_DIR
from .database import SessionLocal, ensure_schema
from .models import Admin, Facility, Service, utcnow
from .reference import default_care_type

DEFAULT_CSV = DATA_DIR / "ghana_facilities.csv"


def _key(name: str) -> str:
    name = re.sub(r"\b(the|of|and|hospital|clinic|health|centre|center|chps|compound|"
                  r"government|govt|municipal|district|st|saint)\b", " ", name.lower())
    return re.sub(r"[^a-z0-9]", "", name)


def _km(lat1, lng1, lat2, lng2) -> float:
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def _apply(facility: Facility, row: dict) -> None:
    facility.name = row["name"]
    facility.category = row["category"]
    facility.type = row["type"]
    facility.classification = row["classification"]
    facility.region = row["region"]
    facility.district = row["district"]
    facility.city = row["city"]
    facility.town = row["town"]
    facility.address = row["address"]
    facility.lat = float(row["lat"])
    facility.lng = float(row["lng"])
    facility.location_confirmed = True
    facility.phone = row["phone"]
    facility.hours = row["hours"]
    facility.is_24_hour = row["is_24_hour"] == "yes"
    facility.website = row.get("website", "")
    facility.source = row["source"]
    facility.source_ref = row["source_ref"]
    facility.last_updated = utcnow()


# Marks a hand-entered seed record that was merged with its open-data twin.
MERGED = "+seed"
PLACEHOLDER_PHONE = "+233 30 000 "


def _merge(facility: Facility, row: dict) -> None:
    """Take the source's location and contact details, keep the curated
    name, classification, services, insurance and beds."""
    facility.lat = float(row["lat"])
    facility.lng = float(row["lng"])
    facility.location_confirmed = True
    facility.region = row["region"]
    facility.district = row["district"]
    facility.city = row["city"]
    facility.town = row["town"]
    facility.address = row["address"]
    if row["phone"] and (not facility.phone or facility.phone.startswith(PLACEHOLDER_PHONE)):
        facility.phone = row["phone"]
    if row["hours"]:
        facility.hours = row["hours"]
        facility.is_24_hour = facility.is_24_hour or row["is_24_hour"] == "yes"
    if row.get("website"):
        facility.website = row["website"]
    facility.source = row["source"] + MERGED
    facility.source_ref = row["source_ref"]
    facility.last_updated = utcnow()


def _sync_services(facility: Facility, names: list[str]) -> None:
    # Edit in place: replacing the collection would insert the new rows
    # before deleting the old ones and trip the (facility, service) unique key.
    for service in list(facility.services):
        if service.service_name not in names:
            facility.services.remove(service)
    have = {s.service_name for s in facility.services}
    for name in names:
        if name not in have:
            facility.services.append(Service(service_name=name, is_active=True))
    # Only unmanaged records get here, so nothing an organization chose is lost
    # when a re-import moves a record to another category (clinic -> laboratory).
    for service in facility.services:
        service.care_type = default_care_type(service.service_name, facility.category)


def import_directory(path: Path = DEFAULT_CSV, *, quiet: bool = False) -> dict:
    ensure_schema()
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    counts = {"added": 0, "merged": 0, "updated": 0, "kept": 0, "duplicate": 0}
    db = SessionLocal()
    try:
        existing = db.scalars(select(Facility)).all()
        by_ref = {(f.source.removesuffix(MERGED), f.source_ref): f for f in existing if f.source}
        managed = set(db.scalars(select(Admin.facility_id).where(Admin.facility_id.isnot(None))))
        by_name: dict[str, list[Facility]] = {}
        for f in existing:
            by_name.setdefault(_key(f.name), []).append(f)

        for row in rows:
            services = [s for s in row["services"].split(";") if s]
            facility = by_ref.get((row["source"], row["source_ref"]))
            if facility is not None:
                if facility.id in managed or facility.verified:
                    counts["kept"] += 1
                elif facility.source.endswith(MERGED):
                    _merge(facility, row)
                    counts["updated"] += 1
                else:
                    _apply(facility, row)
                    _sync_services(facility, services)
                    counts["updated"] += 1
                continue

            lat, lng = float(row["lat"]), float(row["lng"])
            twin = next(
                (f for f in by_name.get(_key(row["name"]), ()) if _km(lat, lng, f.lat, f.lng) < 1.0),
                None,
            )
            if twin is not None:
                if not twin.source and twin.id not in managed and not twin.verified:
                    # A hand-entered seed record for the same place: one record,
                    # with the source's location and contact details.
                    _merge(twin, row)
                    by_ref[(row["source"], row["source_ref"])] = twin
                    counts["merged"] += 1
                else:
                    counts["duplicate"] += 1
                continue

            facility = Facility(verified=False, last_verified=None, has_ambulance=False)
            _apply(facility, row)
            facility.services = [Service(service_name=s, is_active=True) for s in services]
            db.add(facility)
            by_name.setdefault(_key(facility.name), []).append(facility)
            counts["added"] += 1

        db.commit()
    finally:
        db.close()

    if not quiet:
        print(
            f"Directory import from {path.name}: {counts['added']} added, "
            f"{counts['merged']} merged into matching seed records, "
            f"{counts['updated']} refreshed, {counts['kept']} left alone (managed by "
            f"their organization or verified), {counts['duplicate']} skipped as duplicates."
        )
    return counts


if __name__ == "__main__":
    import_directory(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV)
