"""Build data/ghana_facilities.csv from open data.

Sources (download them first, see data/SOURCES.md):
  osm_health.json   Overpass export of health places in Ghana (preferred), or
  hot/health_facilities.geojson   HOT's OSM export from HDX (fallback)
  osm_places.json   Overpass export of cities, towns, villages and suburbs
  adm1.geojson / adm2.geojson     geoBoundaries regions and districts
  ssa.xlsx          WHO public health facilities in sub-Saharan Africa (optional)

Every facility gets its region and district from the boundary polygons it
falls in, its city from the nearest city or town, and its community from the
nearest village, suburb or neighbourhood. Nothing is invented: services come
only from what the source says the place is, and phone numbers only from
the source. Records stay unverified until someone calls them.

Run:  python scripts/build_directory.py <download-folder> data/ghana_facilities.csv
"""
import csv
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# The classification rules live with the app, so both agree.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.reference import facility_class  # noqa: E402

REGIONS = {
    "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra",
    "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta",
    "Western", "Western North",
}

FIELDS = [
    "source", "source_ref", "name", "category", "type", "classification",
    "region", "district", "city", "town", "address", "lat", "lng",
    "phone", "hours", "is_24_hour", "services", "website",
]


# ---------- geometry ----------------------------------------------------
def rings_of(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    return geometry["coordinates"]  # MultiPolygon


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


class Areas:
    """Point-in-polygon lookup with bounding-box prefilter."""

    def __init__(self, path, clean):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.items = []
        for feature in data["features"]:
            polys = rings_of(feature["geometry"])
            xs = [p[0] for poly in polys for p in poly[0]]
            ys = [p[1] for poly in polys for p in poly[0]]
            box = (min(xs), min(ys), max(xs), max(ys))
            centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
            self.items.append((clean(feature["properties"]["shapeName"]), polys, box, centre))

    def find(self, lng, lat):
        for name, polys, (x0, y0, x1, y1), _ in self.items:
            if x0 <= lng <= x1 and y0 <= lat <= y1:
                for poly in polys:
                    if point_in_ring(lng, lat, poly[0]) and not any(
                        point_in_ring(lng, lat, hole) for hole in poly[1:]
                    ):
                        return name
        # On the coast or a border, just outside every polygon: nearest centre.
        return min(self.items, key=lambda it: (it[3][0] - lng) ** 2 + (it[3][1] - lat) ** 2)[0]


def clean_region(name):
    name = re.sub(r"\s+Region$", "", name.strip())
    assert name in REGIONS, name
    return name


def clean_district(name):
    name = re.sub(r"\s+", " ", name.strip())
    return "-".join(part[:1].upper() + part[1:] for part in name.split("-"))


def km(lat1, lng1, lat2, lng2):
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


class Places:
    """Nearest named settlement, bucketed on a 0.1 degree grid."""

    def __init__(self, places):
        self.grid = {}
        for p in places:
            self.grid.setdefault((round(p[1], 1), round(p[2], 1)), []).append(p)

    def nearest(self, lat, lng, max_km):
        best, best_d = None, max_km
        reach = math.ceil(max_km / 11) + 1
        cy, cx = round(lat, 1), round(lng, 1)
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                for p in self.grid.get((round(cy + dy / 10, 1), round(cx + dx / 10, 1)), ()):
                    d = km(lat, lng, p[1], p[2])
                    if d < best_d:
                        best, best_d = p[0], d
        return best


# ---------- classification ---------------------------------------------
GOVERNMENT_WORDS = re.compile(
    r"\b(CHPS|Government|Govt|Municipal|District|Regional|Teaching|Polyclinic|"
    r"Polic?linic|Health Cent(re|er)|Health Post|Military|Police|Prisons?)\b", re.I)
CLINIC_WORDS = re.compile(
    r"\b(CHPS|Compound|Clinic|Polic?linic|Health Cent(re|er)|Health Post|Maternity Home|"
    r"Medical Cent(re|er)|Dental|Eye Cent(re|er)|Laboratory|Diagnostic)\b", re.I)
# Places mapped with a health tag by mistake.
NOT_CARE = re.compile(
    r"\b(telecom|mobile money|momo|electronics?|phones?|salon|barbe(r|ring)|boutique|"
    r"restaurant|chop bar|hotel|guest ?house|school|church|mosque|filling station|"
    r"fuel|mart|supermarket|cosmetics?|beauty|vet(erinary)?|animal)\b", re.I)
SPECIALITY_SERVICES = {
    "dentistry": "Dental", "orthodontics": "Dental", "ophthalmology": "Eye Care",
    "optometry": "Eye Care", "paediatrics": "Paediatrics", "pediatrics": "Paediatrics",
    "gynaecology": "Maternity", "obstetrics": "Maternity", "maternity": "Maternity",
    "radiology": "Radiology / X-Ray", "dermatology": "Dermatology",
    "orthopaedics": "Orthopaedics", "psychiatry": "Mental Health",
    "physiotherapy": "Physiotherapy", "otolaryngology": "ENT", "surgery": "Surgery",
    "general_surgery": "Surgery", "emergency": "Accident and Emergency",
    "dialysis": "Dialysis", "nephrology": "Dialysis", "vaccination": "Immunisation",
    "biology": "Laboratory", "laboratory": "Laboratory",
}


# A name that says the place does lab work, and one that says it also sees
# patients ("Patbrenda Clinic & Laboratory").
LAB_WORDS = re.compile(r"\b(labs?|laborator(y|ies)|diagnostics?|diagnosis)\b", re.I)
CARE_WORDS = re.compile(
    r"\b(hospital|clinic|polic?linic|medical cent(re|er)|health cent(re|er)|maternity|CHPS|"
    r"pharmacy|chemists?|drug store)\b", re.I)


def classify(tags, name):
    """Returns (category, extra services) or None to skip the place.

    A place that only does lab work is a "laboratory". A hospital, clinic or
    pharmacy with a lab keeps its category and gains the Laboratory service.
    """
    kind = _classify(tags, name)
    if kind is None:
        return None
    category, services = kind
    lab = tags.get("healthcare") == "laboratory" or LAB_WORDS.search(name)
    if lab and category in ("hospital", "clinic") and not CARE_WORDS.search(name):
        return "laboratory", ["Laboratory"]
    if lab and category in ("hospital", "clinic", "pharmacy") and "Laboratory" not in services:
        services = services + ["Laboratory"]
    return category, services


def _classify(tags, name):
    amenity = tags.get("amenity", "")
    healthcare = tags.get("healthcare", "")
    if amenity == "pharmacy" or healthcare == "pharmacy" or tags.get("shop") in ("chemist", "medical_supply"):
        return "pharmacy", ["Pharmacy"]
    if amenity == "funeral_hall" or tags.get("shop") == "funeral_directors":
        if re.search(r"\b(grounds?|decor|durbar|durber)\b", name, re.I):
            return None
        return "hearse", []
    if (amenity == "nursing_home" or tags.get("social_facility") in ("nursing_home", "assisted_living")
            or healthcare in ("nurse", "home_care")):
        if CLINIC_WORDS.search(name):
            return "clinic", ["Outpatient"]
        if re.search(r"\b(children|orphan(age)?)\b", name, re.I):
            return None
        return "caregiver", []
    if amenity == "hospital" or healthcare == "hospital":
        # Mappers often tag every health building as a hospital; trust the name.
        if CLINIC_WORDS.search(name) and not re.search(r"\bhospital\b", name, re.I):
            return "clinic", ["Outpatient"]
        return "hospital", ["Outpatient"]
    if amenity == "dentist" or healthcare == "dentist":
        return "clinic", ["Dental"]
    if healthcare in ("optometrist",):
        return "clinic", ["Eye Care"]
    if healthcare == "laboratory":
        return "clinic", ["Outpatient"] if CARE_WORDS.search(name) else []
    if healthcare == "physiotherapist":
        return "clinic", ["Physiotherapy"]
    if amenity in ("clinic", "doctors", "health_post") or healthcare in (
        "clinic", "doctor", "centre", "health_post", "community_health_worker", "yes",
        "birthing_center", "midwife",
    ):
        if re.search(r"\bhospital\b", name, re.I):
            return "hospital", ["Outpatient"]
        services = ["Outpatient"]
        if healthcare in ("birthing_center", "midwife") or re.search(r"\bmaternity\b", name, re.I):
            services.append("Maternity")
        return "clinic", services
    return None  # alternative medicine, blood banks, etc.


def ownership(tags, name, category):
    op = (tags.get("operator:type") or "").lower()
    if op in ("government", "public", "military"):
        return "government"
    if op in ("private", "religious", "ngo", "charitable", "community", "business"):
        return "private"
    if category in ("pharmacy", "hearse", "caregiver"):
        return "private"
    return "government" if GOVERNMENT_WORDS.search(name) else "private"


def level(name, category, ftype, services):
    """Medical facility category, by the same rules the app uses."""
    return facility_class(name, category, ftype, "", services)


def phone_of(tags):
    raw = tags.get("phone") or tags.get("contact:phone") or tags.get("contact:mobile") or ""
    first = re.split(r"[;,/]", raw)[0].strip()
    digits = re.sub(r"[^\d+]", "", first)
    if len(digits.lstrip("+")) < 9:
        return ""
    if digits.startswith("0") and len(digits) == 10:
        digits = "+233" + digits[1:]
    elif digits.startswith("233"):
        digits = "+" + digits
    return digits[:40]


def tidy_place(value):
    """'BIBIANI' -> 'Bibiani'; free-text addresses ("near X junction") are dropped."""
    value = re.sub(r"\s+", " ", (value or "").strip())
    if not value or len(value) > 40 or re.search(r"\d|\b(near|opposite|behind|junction)\b", value, re.I):
        return ""
    return value.title() if value.isupper() or value.islower() else value


def website_of(tags):
    url = (tags.get("website") or tags.get("contact:website") or "").strip().split(";")[0]
    if url.startswith("www."):
        url = "https://" + url
    return url[:200] if re.match(r"https?://[^\s\"'<>]+$", url) else ""


def hours_of(tags):
    hours = (tags.get("opening_hours") or "").strip()
    is24 = hours in ("24/7", "Mo-Su 00:00-24:00", "00:00-24:00")
    return ("24 hours" if is24 else hours[:120]), is24


# ---------- sources -----------------------------------------------------
def osm_elements(folder):
    overpass = folder / "osm_health.json"
    if overpass.exists():
        try:
            data = json.loads(overpass.read_text(encoding="utf-8"))
        except ValueError:
            data = {}
        if data.get("elements"):
            for el in data["elements"]:
                centre = el.get("center") or el
                if "lat" in centre:
                    yield f"{el['type']}/{el['id']}", centre["lat"], centre["lon"], el.get("tags", {})
            return
    hot = folder / "hot" / "health_facilities.geojson"
    print("Overpass export missing; using the HOT export (no phones or hours).")
    for feature in json.loads(hot.read_text(encoding="utf-8"))["features"]:
        geom = feature["geometry"]
        if geom["type"] == "Point":
            lng, lat = geom["coordinates"]
        else:
            ring = rings_of(geom)[0][0]
            lng = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
        p = feature["properties"]
        tags = {k.replace("_", ":") if k in ("operator_type", "healthcare_speciality") else k: v
                for k, v in p.items() if v}
        yield p["id"], lat, lng, tags


def xlsx_rows(path):
    """Minimal .xlsx reader (first sheet), so no extra package is needed."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        for row in sheet.iter(f"{{{ns['m']}}}row"):
            values = {}
            for cell in row.findall("m:c", ns):
                col = re.match(r"[A-Z]+", cell.get("r")).group()
                v = cell.find("m:v", ns)
                text = None if v is None else v.text
                if cell.get("t") == "s" and text is not None:
                    text = shared[int(text)]
                elif cell.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in cell.iter(f"{{{ns['m']}}}t"))
                values[col] = text
            yield values


def who_records(folder):
    path = folder / "ssa.xlsx"
    if not path.exists() or path.stat().st_size == 0:
        return
    rows = xlsx_rows(path)
    header = None
    for values in rows:
        cells = {k: (v or "").strip() for k, v in values.items()}
        if header is None:
            if "Country" in cells.values():
                header = {v: k for k, v in cells.items()}
            continue
        if cells.get(header["Country"]) != "Ghana":
            continue
        yield {key: cells.get(col, "") for key, col in header.items()}


def normalise(name):
    name = name.lower()
    name = re.sub(r"\b(the|of|and|hospital|clinic|health|centre|center|chps|compound|"
                  r"government|govt|municipal|district|st|saint)\b", " ", name)
    return re.sub(r"[^a-z0-9]", "", name)


def main():
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    regions = Areas(folder / "adm1.geojson", clean_region)
    districts = Areas(folder / "adm2.geojson", clean_district)

    towns, communities = [], []
    places_file = folder / "osm_places.json"
    if places_file.exists():
        for el in json.loads(places_file.read_text(encoding="utf-8")).get("elements", []):
            name = (el.get("tags") or {}).get("name")
            if not name:
                continue
            kind = el["tags"].get("place")
            entry = (name, el["lat"], el["lon"])
            (towns if kind in ("city", "town") else communities).append(entry)
    towns, communities = Places(towns), Places(communities)

    records, seen = [], {}

    def add(record):
        key = normalise(record["name"])
        for other in seen.get(key, ()):
            if km(record["lat"], record["lng"], other["lat"], other["lng"]) < 1.0:
                return False
        seen.setdefault(key, []).append(record)
        records.append(record)
        return True

    def place(record):
        lat, lng = record["lat"], record["lng"]
        record["region"] = regions.find(lng, lat)
        record["district"] = districts.find(lng, lat)
        record["city"] = record.get("city") or towns.nearest(lat, lng, 25) or record["district"]
        record["town"] = record.get("town") or communities.nearest(lat, lng, 4) or record["city"]
        parts = [record.get("address"), record["town"], record["city"], record["district"],
                 record["region"]]
        record["address"] = ", ".join(dict.fromkeys(p for p in parts if p))[:300]

    skipped = 0
    for ref, lat, lng, tags in osm_elements(folder):
        name = (tags.get("name") or tags.get("name:en") or "").strip()
        if not name or not (4.5 <= lat <= 11.3 and -3.4 <= lng <= 1.3):
            skipped += 1
            continue
        kind = classify(tags, name)
        if kind is None or NOT_CARE.search(name):
            skipped += 1
            continue
        category, services = kind
        for spec in re.split(r"[;,]", tags.get("healthcare:speciality", "")):
            if SPECIALITY_SERVICES.get(spec.strip()):
                services.append(SPECIALITY_SERVICES[spec.strip()])
        ftype = ownership(tags, name, category)
        hours, is24 = hours_of(tags)
        if category == "clinic" and re.search(r"\bCHPS\b", name, re.I):
            services += ["Antenatal Care", "Immunisation"]
        street = " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")]))
        record = {
            "source": "osm", "source_ref": ref, "name": name[:200], "category": category,
            "type": ftype, "classification": level(name, category, ftype, services),
            "city": tidy_place(tags.get("addr:city")),
            "town": tidy_place(tags.get("addr:suburb") or tags.get("addr:place")),
            "address": (tags.get("addr:full") or street).strip(),
            "lat": round(lat, 6), "lng": round(lng, 6), "phone": phone_of(tags),
            "hours": hours, "is_24_hour": is24 or tags.get("emergency") == "yes",
            "services": list(dict.fromkeys(services)),
            "website": website_of(tags),
        }
        if record["is_24_hour"] and not record["hours"]:
            record["hours"] = "24 hours"
        place(record)
        add(record)
    osm_count = len(records)

    who_added = 0
    for row in who_records(folder):
        try:
            lat, lng = float(row["Lat"]), float(row["Long"])
        except (KeyError, ValueError):
            continue
        name = row.get("Facility name", "").strip()
        if not name or not (4.5 <= lat <= 11.3 and -3.4 <= lng <= 1.3):
            continue
        kind_text = row.get("Facility type", "")
        category = "hospital" if "hospital" in kind_text.lower() else "clinic"
        owner = row.get("Ownership", "").lower()
        ftype = "private" if any(w in owner for w in ("faith", "ngo", "private", "chag")) else "government"
        label = f"{name} {kind_text}" if kind_text.lower() not in name.lower() else name
        services = ["Outpatient"]
        if "chps" in label.lower():
            services += ["Antenatal Care", "Immunisation"]
        record = {
            "source": "who-ssa", "source_ref": "", "name": label[:200], "category": category,
            "type": ftype, "classification": level(label, category, ftype, services),
            "city": "", "town": "", "address": "", "lat": round(lat, 6), "lng": round(lng, 6),
            "phone": "", "hours": "", "is_24_hour": False, "services": services, "website": "",
        }
        place(record)
        record["source_ref"] = f"{record['district']}/{normalise(label)}"
        if add(record):
            who_added += 1

    records.sort(key=lambda r: (r["region"], r["district"], r["city"], r["name"]))
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        for r in records:
            writer.writerow({**{k: r.get(k, "") for k in FIELDS},
                             "services": ";".join(r["services"]),
                             "is_24_hour": "yes" if r["is_24_hour"] else "no"})
    print(f"OpenStreetMap: {osm_count} kept, {skipped} skipped (no name or not care)")
    print(f"WHO list: {who_added} added after removing duplicates")
    print(f"Wrote {len(records)} records to {out}")


if __name__ == "__main__":
    main()
