"""Smoke tests for the MediFinder API.

Run standalone:  python tests/test_api.py
Or with pytest:  pytest tests/test_api.py

Exercises the paths that matter for Phase 1: distance ordering, the dental
filter, ambulance coverage-before-distance, emergency mode with and without
GPS, the 24-hour staleness rule, and admin authorisation boundaries.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.admin_requests import approve_request  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import Admin, AdminRegistrationRequest  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
API = "/api/v1"

# Ridge Hospital, Accra -- a coordinate with dense coverage in the seed data.
ACCRA = {"lat": 5.5636, "lng": -0.1969}

_failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        _failures.append(label)


def test_health():
    r = client.get(f"{API}/health")
    check("health returns ok", r.status_code == 200 and r.json()["status"] == "ok")
    check("emergency number is 112", r.json()["emergency_number"] == "112")
    check(
        "seed data reports itself unverified",
        r.json()["data_verified"] is False,
        "-- placeholder numbers must never claim to be verified",
    )


def test_admin_registration_requires_approval():
    email = "registration-check@medifinder.gh"
    payload = {
        "full_name": "Registration Check",
        "email": email,
        "password": "Registration-Check-123",
        "scope": "facility",
        "facility_id": 1,
    }
    response = client.post(f"{API}/admin/register", json=payload)
    check("registration creates a pending request", response.status_code == 202)
    check("request says approval is required", response.json()["status"] == "pending")
    check(
        "pending registration cannot sign in",
        client.post(f"{API}/admin/login", json={
            "email": email, "password": payload["password"]
        }).status_code == 401,
    )
    check(
        "duplicate pending registration is rejected",
        client.post(f"{API}/admin/register", json=payload).status_code == 409,
    )

    with SessionLocal() as db:
        request = db.query(AdminRegistrationRequest).filter_by(email=email).one()
        check("request stores only a password hash", request.password_hash != payload["password"])
        admin = approve_request(db, request.id)
        check("approval creates an active scoped admin", admin.facility_id == 1)
        check("approved request no longer retains password hash", request.password_hash is None)

    check(
        "approved registration can sign in",
        client.post(f"{API}/admin/login", json={
            "email": email, "password": payload["password"]
        }).status_code == 200,
    )


def test_admin_pages_are_separate_from_public_navigation():
    login_page = client.get("/admin")
    registration_page = client.get("/admin/register")
    public_page = client.get("/")
    check("separate admin login URL is served", login_page.status_code == 200)
    check("separate registration URL is served", registration_page.status_code == 200)
    check(
        "public navigation does not link to admin",
        b">Admin</a>" not in public_page.content,
    )


def test_reference():
    r = client.get(f"{API}/regions")
    check("all 16 regions listed", r.status_code == 200 and len(r.json()) == 16,
          f"got {len(r.json())}")
    services = client.get(f"{API}/services").json()
    check("Dental is in the service catalogue", "Dental" in services)
    classes = client.get(f"{API}/classifications").json()
    check("7 classification levels", len(classes) == 7, f"got {len(classes)}")


def test_facility_listing_and_pagination():
    r = client.get(f"{API}/facilities", params={"page_size": 5})
    body = r.json()
    check("facility list paginates", r.status_code == 200 and len(body["items"]) == 5)
    check("pagination reports a total", body["total"] >= 50, f"total={body['total']}")
    check("page count derived", body["pages"] == -(-body["total"] // 5))


def test_dental_filter():
    """PRD v1.1: dental is a service tag, filterable like any other."""
    r = client.get(f"{API}/facilities", params={"service": "Dental", "page_size": 100})
    items = r.json()["items"]
    check("dental filter returns results", len(items) > 0, f"got {len(items)}")
    check(
        "every dental result actually offers Dental",
        all("Dental" in f["services"] for f in items),
    )
    standalone = [f for f in items if f["services"] == ["Dental"]]
    check("standalone dental clinics are present", len(standalone) > 0)
    check(
        "standalone dental clinics take the Private classification",
        all(f["classification"] == "Private" for f in standalone),
    )


def test_nearby_distance_ordering():
    r = client.get(f"{API}/facilities/nearby", params={**ACCRA, "radius_km": 30})
    items = r.json()["items"]
    check("nearby returns results", len(items) > 0)
    distances = [f["distance_km"] for f in items]
    check("results sorted by distance", distances == sorted(distances), str(distances[:5]))
    check("distances are plausible", all(d <= 30 for d in distances))
    check("nearest is within a kilometre of Ridge", distances[0] < 1.0, str(distances[0]))


def test_combined_filters():
    r = client.get(
        f"{API}/facilities/nearby",
        params={**ACCRA, "radius_km": 50, "service": "Dental", "type": "private"},
    )
    items = r.json()["items"]
    check("dental + private + nearby combine", len(items) > 0)
    check("type filter respected", all(f["type"] == "private" for f in items))


def test_beds_are_stale_on_seed():
    """PRD 7.3 -- unrefreshed bed counts must read 'Not updated', not zero.

    Reads Komfo Anokye, not Korle Bu: the demo admin account administers
    Korle Bu, so test_admin_flow legitimately refreshes its beds first.
    """
    r = client.get(f"{API}/facilities", params={"q": "Komfo Anokye"})
    facility = r.json()["items"][0]
    check("seeded beds are stale", facility["beds"]["is_stale"] is True)
    check("stale beds display 'Not updated'", facility["beds"]["display"] == "Not updated")
    check("stale beds hide the number", facility["beds"]["available_beds"] is None)


def test_ambulance_coverage_before_distance():
    """PRD 5.1.6 -- a covering provider outranks a merely closer one."""
    r = client.get(f"{API}/ambulance/covering", params={**ACCRA, "limit": 5})
    items = r.json()["items"]
    check("covering providers returned", len(items) > 0)
    check("top result covers the caller", items[0]["covers_user_area"] is True)
    covering = [p for p in items if p["covers_user_area"]]
    non = [p for p in items if not p["covers_user_area"]]
    check(
        "covering providers rank above non-covering",
        not non or all(items.index(c) < items.index(non[0]) for c in covering),
    )
    check("fleet status unset reads 'Not updated'",
          items[0]["status"]["display"] == "Not updated")
    check("seeded dispatch numbers are unverified",
          all(p["phone_verified_at"] is None for p in items))


def test_ambulance_far_region():
    """A caller in Wa should get Upper West providers, not Accra ones."""
    r = client.get(f"{API}/ambulance/covering", params={"lat": 10.06, "lng": -2.501, "limit": 3})
    items = r.json()["items"]
    check("Wa caller gets a covering provider", items[0]["covers_user_area"] is True)
    check("Wa caller gets Upper West", items[0]["region"] == "Upper West", items[0]["region"])


def test_emergency_gps():
    r = client.get(f"{API}/emergency", params=ACCRA)
    body = r.json()
    check("emergency returns 200", r.status_code == 200)
    check("emergency returns 3 facilities", len(body["facilities"]) == 3)
    check("emergency returns 3 ambulance providers", len(body["ambulance_providers"]) == 3)
    check("112 always present", body["emergency_number"] == "112")
    check("notice disclaims dispatch", "does not dispatch" in body["notice"])
    check("emergency prefers 24-hour facilities",
          all(f["is_24_hour"] for f in body["facilities"]))
    check("emergency resolves the region", body["located_region"] == "Greater Accra")


def test_emergency_region_fallback():
    """PRD 5.1.4 -- falls back to region selection when GPS is denied."""
    r = client.get(f"{API}/emergency", params={"region": "Volta"})
    body = r.json()
    check("region fallback works", r.status_code == 200 and len(body["facilities"]) > 0)
    check("fallback stays in region",
          all(f["region"] == "Volta" for f in body["facilities"]))
    check("fallback still returns ambulances", len(body["ambulance_providers"]) > 0)

    bad = client.get(f"{API}/emergency")
    check("emergency without location or region is rejected", bad.status_code == 400)


def test_facility_profile():
    listing = client.get(f"{API}/facilities", params={"q": "Korle Bu"}).json()["items"][0]
    r = client.get(f"{API}/facilities/{listing['id']}", params=ACCRA)
    body = r.json()
    check("profile returns 200", r.status_code == 200)
    check("profile carries insurance", "NHIS" in body["insurance"])
    check("profile carries distance when located", body["distance_km"] is not None)
    check("profile lists service detail", len(body["service_detail"]) > 0)
    check("unknown facility 404s", client.get(f"{API}/facilities/999999").status_code == 404)


def test_admin_flow():
    login = client.post(
        f"{API}/admin/login",
        json={"email": "facility@medifinder.gh", "password": "changeme123"},
    )
    check("facility admin can log in", login.status_code == 200)
    token = login.json()["access_token"]
    facility_id = login.json()["facility_id"]
    check("token is scoped to a facility", login.json()["scope"] == "facility")
    check("token expires in 8 hours", login.json()["expires_in"] == 8 * 3600)

    headers = {"Authorization": f"Bearer {token}"}

    bad = client.post(
        f"{API}/admin/login",
        json={"email": "facility@medifinder.gh", "password": "wrongpassword"},
    )
    check("wrong password rejected", bad.status_code == 401)

    check("beds update needs auth",
          client.put(f"{API}/facilities/{facility_id}/beds",
                     json={"total_beds": 10, "available_beds": 5}).status_code == 401)

    r = client.put(
        f"{API}/facilities/{facility_id}/beds",
        json={"total_beds": 800, "available_beds": 42},
        headers=headers,
    )
    check("beds update succeeds", r.status_code == 200)
    check("updated beds are fresh", r.json()["beds"]["is_stale"] is False)
    check("updated beds show the count", "42 of 800" in r.json()["beds"]["display"])

    over = client.put(
        f"{API}/facilities/{facility_id}/beds",
        json={"total_beds": 10, "available_beds": 50},
        headers=headers,
    )
    check("available beds cannot exceed total", over.status_code == 400)

    other = client.put(
        f"{API}/facilities/{facility_id + 1}/beds",
        json={"total_beds": 10, "available_beds": 5},
        headers=headers,
    )
    check("admin cannot write to another facility", other.status_code == 403)

    svc = client.put(
        f"{API}/facilities/{facility_id}/services",
        json={"services": [{"service_name": "Dialysis", "is_active": False}]},
        headers=headers,
    )
    check("service can be marked unavailable", svc.status_code == 200)
    listed = client.get(
        f"{API}/facilities", params={"service": "Dialysis", "page_size": 100}
    ).json()["items"]
    check(
        "an inactive service drops out of search",
        all(f["id"] != facility_id for f in listed),
    )


def test_provider_admin_flow():
    login = client.post(
        f"{API}/admin/login",
        json={"email": "ambulance@medifinder.gh", "password": "changeme123"},
    )
    check("provider admin can log in", login.status_code == 200)
    check("token is scoped to a provider", login.json()["scope"] == "provider")
    token = login.json()["access_token"]
    provider_id = login.json()["provider_id"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put(
        f"{API}/ambulance/providers/{provider_id}/status",
        json={"total_units": 6, "units_available": 2},
        headers=headers,
    )
    check("fleet status update succeeds", r.status_code == 200)
    check("fleet status now fresh", r.json()["status"]["is_stale"] is False)
    check("fleet display reads correctly", "2 of 6" in r.json()["status"]["display"])

    cross = client.put(
        f"{API}/facilities/1/beds",
        json={"total_beds": 10, "available_beds": 5},
        headers=headers,
    )
    check("provider admin cannot update a facility", cross.status_code == 403)

    dash = client.get(f"{API}/admin/dashboard", headers=headers)
    check("provider dashboard loads", dash.status_code == 200
          and dash.json()["scope"] == "provider")


def test_bad_input():
    check("invalid latitude rejected",
          client.get(f"{API}/facilities/nearby",
                     params={"lat": 200, "lng": 0}).status_code == 422)
    check("invalid token rejected",
          client.get(f"{API}/admin/me",
                     headers={"Authorization": "Bearer nonsense"}).status_code == 401)


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        print(f"\n{fn.__name__}")
        fn()
    print("\n" + "=" * 60)
    if _failures:
        print(f"{len(_failures)} FAILED: {', '.join(_failures)}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
