"""Smoke tests for the MediFinder API.

Run standalone:  python tests/test_api.py
Or with pytest:  pytest tests/test_api.py

Exercises the paths that matter for Phase 1: distance ordering, the dental
filter, ambulance coverage-before-distance, emergency mode with and without
GPS, the 24-hour staleness rule, admin authorisation boundaries, and the
contact request -> superadmin-created account -> first sign-in flow.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Admin,
    AdminChangeLog,
    AmbulanceProvider,
    ContactRequest,
    Facility,
)
from app.main import app  # noqa: E402
from app.seed import FACILITIES as SEED_FACILITIES  # noqa: E402
from app.superadmins import create_superadmin  # noqa: E402

client = TestClient(app)
API = "/api/v1"

# Ridge Hospital, Accra -- a coordinate with dense coverage in the seed data.
ACCRA = {"lat": 5.5636, "lng": -0.1969}

_failures: list[str] = []

SUPERADMIN_EMAIL = "system-owner@medifinder.gh"
SUPERADMIN_PASSWORD = "System-Owner-Testing-123"
_superadmin_headers: dict = {}


def superadmin_headers() -> dict:
    """Create the test superadmin on first use; tests run in name order."""
    if not _superadmin_headers:
        create_superadmin(SUPERADMIN_EMAIL, "System Owner", SUPERADMIN_PASSWORD)
        login = client.post(
            f"{API}/superadmin/login",
            json={"email": SUPERADMIN_EMAIL, "password": SUPERADMIN_PASSWORD},
        )
        _superadmin_headers["Authorization"] = f"Bearer {login.json()['access_token']}"
    return _superadmin_headers


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


def test_contact_request_to_first_sign_in():
    payload = {
        "facility_name": "Hohoe Riverside Clinic",
        "organization_type": "clinic",
        "email": "Riverside-Clinic@medifinder.gh",
        "phone": "+233 24 000 0000",
        "contact_name": "Ama Mensah",
        "message": "Near the main lorry station.",
    }
    submitted = client.post(f"{API}/contact", json=payload)
    check("contact request is accepted for review", submitted.status_code == 202)
    check(
        "duplicate pending contact request is rejected",
        client.post(f"{API}/contact", json=payload).status_code == 409,
    )
    check(
        "unknown organization type is rejected",
        client.post(
            f"{API}/contact", json={**payload, "organization_type": "spa"}
        ).status_code == 422,
    )
    check(
        "contact request grants no sign-in",
        client.post(f"{API}/admin/login", json={
            "email": payload["email"], "password": "anything-at-all"
        }).status_code == 401,
    )

    headers = superadmin_headers()
    overview = client.get(f"{API}/superadmin/overview", headers=headers).json()
    request = next(
        item for item in overview["contact_requests"]
        if item["facility_name"] == payload["facility_name"]
    )
    check("superadmin sees the contact request", request["email"] == payload["email"].lower())

    create = {
        "contact_request_id": request["id"],
        "organization_type": "clinic",
        "name": payload["facility_name"],
        "email": request["email"],
        "full_name": payload["contact_name"],
        "phone": payload["phone"],
        "classification": "Level E",
        "region": "Volta",
        "city": "Hohoe",
    }
    check(
        "hospitals and clinics need a classification",
        client.post(
            f"{API}/superadmin/organizations",
            json={**create, "classification": ""},
            headers=headers,
        ).status_code == 422,
    )
    created = client.post(f"{API}/superadmin/organizations", json=create, headers=headers)
    check("superadmin creates the listing and login", created.status_code == 201, created.text)
    result = created.json()
    temporary = result.get("temporary_password", "")
    check("unsent email returns the temporary password once", len(temporary) >= 20)
    check(
        "superadmin gets a ready-to-send login message",
        temporary in result["message"]["body"]
        and request["email"] in result["message"]["body"]
        and "info@findcareghana.com" in result["message"]["body"],
    )
    check(
        "an approved request cannot be approved twice",
        client.post(
            f"{API}/superadmin/organizations",
            json={**create, "email": "second@medifinder.gh"},
            headers=headers,
        ).status_code == 404,
    )
    refreshed = client.get(f"{API}/superadmin/overview", headers=headers).json()
    check(
        "approved request leaves the pending list",
        all(item["id"] != request["id"] for item in refreshed["contact_requests"]),
    )

    login = client.post(
        f"{API}/admin/login", json={"email": create["email"], "password": temporary}
    )
    check("temporary password signs in", login.status_code == 200)
    check("sign-in reports a required password change", login.json()["must_change_password"])
    admin_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    check(
        "dashboard is blocked until the password is changed",
        client.get(f"{API}/admin/dashboard", headers=admin_headers).status_code == 403,
    )
    check(
        "who-am-I still works on a temporary password",
        client.get(f"{API}/admin/me", headers=admin_headers).json()["must_change_password"],
    )
    check(
        "password change checks the current password",
        client.post(f"{API}/admin/password", headers=admin_headers, json={
            "current_password": "wrong-password", "new_password": "Riverside-Clinic-Own-1",
        }).status_code == 400,
    )
    changed = client.post(f"{API}/admin/password", headers=admin_headers, json={
        "current_password": temporary, "new_password": "Riverside-Clinic-Own-1",
    })
    check("password change succeeds", changed.status_code == 204)
    check(
        "temporary password stops working",
        client.post(f"{API}/admin/login", json={
            "email": create["email"], "password": temporary
        }).status_code == 401,
    )
    dash = client.get(f"{API}/admin/dashboard", headers=admin_headers)
    check("dashboard opens after the change", dash.status_code == 200)
    check("new listing starts without a confirmed location",
          dash.json()["location_confirmed"] is False)

    def public_hits():
        return client.get(
            f"{API}/facilities", params={"q": payload["facility_name"]}
        ).json()["items"]

    check("unlocated listing is hidden from public search", public_hits() == [])
    check(
        "swapped coordinates are rejected",
        client.put(f"{API}/admin/location", headers=admin_headers,
                   json={"lat": 0.47, "lng": 7.1}).status_code == 422,
    )
    located = client.put(f"{API}/admin/location", headers=admin_headers,
                         json={"lat": 7.1520, "lng": 0.4730})
    check("organization sets its own location", located.status_code == 200)
    hits = public_hits()
    check("located listing appears in public search", len(hits) == 1)
    check("listing carries its category", bool(hits) and hits[0]["category"] == "clinic")
    check(
        "category filter narrows search",
        all(item["category"] == "clinic" for item in client.get(
            f"{API}/facilities", params={"category": "clinic", "page_size": 100}
        ).json()["items"]),
    )

    check(
        "admin can change their own password again later",
        client.post(f"{API}/admin/password", headers=admin_headers, json={
            "current_password": "Riverside-Clinic-Own-1",
            "new_password": "Riverside-Clinic-Own-2",
        }).status_code == 204
        and client.get(f"{API}/admin/dashboard", headers=admin_headers).status_code == 200,
    )
    reset = client.post(
        f"{API}/superadmin/admins/{result['admin_id']}/reset-password", headers=headers
    )
    new_default = reset.json().get("temporary_password", "")
    check("superadmin can reset a lost password to a new default",
          reset.status_code == 200 and len(new_default) >= 20
          and new_default in reset.json()["message"]["body"])
    check(
        "the old password stops working after a reset",
        client.post(f"{API}/admin/login", json={
            "email": create["email"], "password": "Riverside-Clinic-Own-2"
        }).status_code == 401,
    )
    check(
        "a reset locks the open session until a new password is chosen",
        client.get(f"{API}/admin/dashboard", headers=admin_headers).status_code == 403,
    )
    relogin = client.post(
        f"{API}/admin/login", json={"email": create["email"], "password": new_default}
    )
    check("the new default password signs in and asks for a change",
          relogin.status_code == 200 and relogin.json()["must_change_password"])
    relogin_headers = {"Authorization": f"Bearer {relogin.json()['access_token']}"}
    check(
        "admin sets their own password after a reset",
        client.post(f"{API}/admin/password", headers=relogin_headers, json={
            "current_password": new_default, "new_password": "Riverside-Clinic-Own-3",
        }).status_code == 204
        and client.get(f"{API}/admin/dashboard", headers=relogin_headers).status_code == 200,
    )

    ambulance = client.post(f"{API}/superadmin/organizations", headers=headers, json={
        "organization_type": "ambulance",
        "name": "Volta Rapid Ambulance",
        "email": "volta-rapid@medifinder.gh",
        "phone": "+233 24 000 0001",
        "region": "Volta",
        "lat": 6.6,
        "lng": 0.47,
    })
    check("ambulance services become ambulance providers",
          ambulance.status_code == 201
          and ambulance.json()["organization_type"] == "provider")

    hearse = client.post(f"{API}/superadmin/organizations", headers=headers, json={
        "organization_type": "hearse",
        "name": "Ridge Hearse Services",
        "email": "ridge-hearse@medifinder.gh",
        "phone": "+233 24 000 0002",
        "region": "Greater Accra",
        "lat": ACCRA["lat"],
        "lng": ACCRA["lng"],
    })
    check("non-health services can be listed", hearse.status_code == 201)
    emergency = client.get(f"{API}/emergency", params=ACCRA).json()
    check(
        "emergency mode never offers a hearse service",
        all(f["category"] in ("hospital", "clinic") for f in emergency["facilities"]),
    )

    client.post(f"{API}/contact", json={**payload, "email": "reject-me@medifinder.gh"})
    with SessionLocal() as db:
        rejected_id = db.query(ContactRequest).filter_by(
            email="reject-me@medifinder.gh"
        ).one().id
    check(
        "superadmin can reject a contact request",
        client.post(
            f"{API}/superadmin/contact-requests/{rejected_id}/reject", headers=headers
        ).status_code == 204,
    )


def test_admin_pages_are_separate_from_public_navigation():
    login_page = client.get("/admin")
    registration_page = client.get("/admin/register", follow_redirects=False)
    public_page = client.get("/")
    check("separate admin login URL is served", login_page.status_code == 200)
    check(
        "old registration URL redirects to the contact page",
        registration_page.status_code == 308
        and registration_page.headers["location"] == "/contact.html",
    )
    check("contact page is served", b'id="contact-form"' in client.get("/contact.html").content)
    check(
        "public navigation links to contact us",
        b'href="contact.html"' in public_page.content,
    )
    check(
        "public navigation does not link to admin",
        b">Admin</a>" not in public_page.content,
    )


def test_superadmin_can_manage_directory_and_review_changes():
    super_headers = superadmin_headers()
    check("superadmin can sign in", bool(super_headers))

    facility_login = client.post(
        f"{API}/admin/login",
        json={"email": "facility@medifinder.gh", "password": "changeme123"},
    )
    facility_headers = {
        "Authorization": f"Bearer {facility_login.json()['access_token']}"
    }
    check(
        "organization admin cannot access superadmin data",
        client.get(f"{API}/superadmin/overview", headers=facility_headers).status_code
        == 403,
    )
    check(
        "superadmin token cannot use organization admin APIs",
        client.get(f"{API}/admin/dashboard", headers=super_headers).status_code == 403,
    )

    check(
        "organization login cannot reuse a superadmin email",
        client.post(f"{API}/superadmin/organizations", headers=super_headers, json={
            "organization_type": "pharmacy",
            "name": "Duplicate Email Pharmacy",
            "email": SUPERADMIN_EMAIL,
            "phone": "+233 24 000 0003",
            "region": "Ashanti",
        }).status_code == 409,
    )

    overview = client.get(f"{API}/superadmin/overview", headers=super_headers)
    check("superadmin overview loads", overview.status_code == 200)
    content = overview.json()
    check("superadmin sees facilities and providers", len(content["facilities"]) >= 50
          and len(content["providers"]) >= 20)
    check("superadmin sees organization admins", len(content["admins"]) >= 2)

    facility = content["facilities"][0]
    facility_payload = {
        "name": f"{facility['name']} (managed test)",
        "type": facility["type"],
        "category": facility["category"],
        "classification": facility["classification"],
        "address": facility["address"],
        "region": facility["region"],
        "city": facility["city"],
        "town": facility["town"],
        "lat": facility["lat"],
        "lng": facility["lng"],
        "phone": facility["phone"],
        "hours": facility["hours"],
        "is_24_hour": facility["is_24_hour"],
        "has_ambulance": facility["has_ambulance"],
        "ambulance_phone": facility["ambulance_phone"],
        "ambulance_provider_id": facility["ambulance_provider_id"],
        "verified": facility["verified"],
        "services": facility["service_detail"],
        "insurance": facility["insurance"],
        "total_beds": facility["admin_beds"]["total_beds"] if facility["admin_beds"] else None,
        "available_beds": (
            facility["admin_beds"]["available_beds"] if facility["admin_beds"] else None
        ),
    }
    facility_update = client.put(
        f"{API}/superadmin/facilities/{facility['id']}",
        json=facility_payload,
        headers=super_headers,
    )
    check(
        "superadmin can edit a facility",
        facility_update.status_code == 200
        and facility_update.json()["name"] == facility_payload["name"]
        and facility_update.json()["beds"]["is_stale"] == facility["beds"]["is_stale"],
        facility_update.text,
    )
    check(
        "facility edits are visible in public directory",
        client.get(f"{API}/facilities/{facility['id']}").json()["name"]
        == facility_payload["name"],
    )
    invalid_facility = {**facility_payload, "available_beds": 100001}
    check(
        "facility edit validates bed availability",
        client.put(
            f"{API}/superadmin/facilities/{facility['id']}",
            json=invalid_facility,
            headers=super_headers,
        ).status_code == 422,
    )

    provider = content["providers"][0]
    provider_payload = {
        "name": f"{provider['name']} (managed test)",
        "operator_type": provider["operator_type"],
        "service_level": provider["service_level"],
        "base_address": provider["base_address"],
        "region": provider["region"],
        "district": provider["district"],
        "lat": provider["lat"],
        "lng": provider["lng"],
        "phone": provider["phone"],
        "alt_phone": provider["alt_phone"],
        "hours": provider["hours"],
        "is_24_hour": provider["is_24_hour"],
        "cost_band": provider["cost_band"],
        "verified": provider["verified"],
        "phone_verified": provider["phone_verified_at"] is not None,
        "coverage": provider["coverage"],
        "total_units": (
            provider["admin_status"]["total_units"] if provider["admin_status"] else None
        ),
        "units_available": (
            provider["admin_status"]["units_available"] if provider["admin_status"] else None
        ),
    }
    provider_update = client.put(
        f"{API}/superadmin/providers/{provider['id']}",
        json=provider_payload,
        headers=super_headers,
    )
    check(
        "superadmin can edit an ambulance provider",
        provider_update.status_code == 200
        and provider_update.json()["name"] == provider_payload["name"]
        and provider_update.json()["status"]["is_stale"] == provider["status"]["is_stale"],
        provider_update.text,
    )
    check(
        "provider edits are visible in public directory",
        client.get(f"{API}/ambulance/providers/{provider['id']}").json()["name"]
        == provider_payload["name"],
    )

    with SessionLocal() as db:
        changes = db.query(AdminChangeLog).filter_by(admin_email="facility@medifinder.gh").all()
        check("admin changes are recorded for superadmin review", len(changes) >= 2)

    refreshed = client.get(f"{API}/superadmin/overview", headers=super_headers).json()
    check("superadmin sees recorded changes", len(refreshed["changes"]) >= 2)
    check(
        "superadmin directory edits are audited",
        any(change["action"] == "facility.updated_by_superadmin"
            for change in refreshed["changes"])
        and any(change["action"] == "provider.updated_by_superadmin"
                for change in refreshed["changes"]),
    )
    created_admin = next(
        item for item in refreshed["admins"]
        if item["email"] == "riverside-clinic@medifinder.gh"
    )
    revoked = client.delete(
        f"{API}/superadmin/admins/{created_admin['id']}",
        headers=super_headers,
    )
    check("superadmin can revoke organization admin", revoked.status_code == 204)

    with SessionLocal() as db:
        provider_record = AmbulanceProvider(
            name="Superadmin Deletion Test Provider",
            operator_type="private",
            service_level="BLS",
            region="Greater Accra",
            district="Accra",
            lat=5.56,
            lng=-0.20,
            phone="+233000000000",
        )
        db.add(provider_record)
        db.flush()
        facility_record = Facility(
            name="Superadmin Deletion Test Facility",
            type="private",
            classification="Private",
            region="Greater Accra",
            lat=5.57,
            lng=-0.21,
            has_ambulance=True,
            ambulance_provider_id=provider_record.id,
        )
        db.add(facility_record)
        db.flush()
        provider_id = provider_record.id
        facility_id = facility_record.id
        db.add_all([
            Admin(
                provider_id=provider_id,
                email="delete-provider-test@medifinder.gh",
                password_hash="not-used",
                full_name="Provider Delete Test",
            ),
            Admin(
                facility_id=facility_id,
                email="delete-facility-test@medifinder.gh",
                password_hash="not-used",
                full_name="Facility Delete Test",
            ),
        ])
        db.commit()

    deleted_provider = client.delete(
        f"{API}/superadmin/providers/{provider_id}",
        headers=super_headers,
    )
    check("superadmin can permanently delete a provider", deleted_provider.status_code == 204)
    with SessionLocal() as db:
        check(
            "provider deletion clears facility link and removes scoped admin",
            db.get(Facility, facility_id).ambulance_provider_id is None
            and db.query(Admin)
            .filter_by(email="delete-provider-test@medifinder.gh")
            .count() == 0,
        )
    deleted_facility = client.delete(
        f"{API}/superadmin/facilities/{facility_id}",
        headers=super_headers,
    )
    check("superadmin can permanently delete a facility", deleted_facility.status_code == 204)
    with SessionLocal() as db:
        check(
            "facility deletion removes scoped admins",
            db.query(Admin).filter_by(email="delete-facility-test@medifinder.gh").count() == 0,
        )
        check(
            "directory deletion is retained in audit history",
            db.query(AdminChangeLog)
            .filter_by(action="facility.deleted_by_superadmin")
            .count() == 1
            and db.query(AdminChangeLog)
            .filter_by(action="provider.deleted_by_superadmin")
            .count() == 1,
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


def test_open_data_directory():
    districts = client.get(f"{API}/regions/Greater Accra/districts").json()
    check("districts listed for a region", len(districts) > 5, f"got {len(districts)}")
    district = districts[0]
    items = client.get(
        f"{API}/facilities", params={"district": district, "page_size": 100}
    ).json()["items"]
    check("district filter returns results", len(items) > 0)
    check("district filter respected", all(f["district"] == district for f in items))
    towns = client.get(
        f"{API}/regions/Greater Accra/localities", params={"district": district}
    ).json()
    check("localities narrow to a district", len(towns) > 0)

    with SessionLocal() as db:
        imported = db.query(Facility).filter(Facility.source == "osm").first()
        # Facilities created by earlier tests through the superadmin form
        # have no district; only the seeded ones are checked.
        curated_without_district = db.query(Facility).filter(
            Facility.district == "", Facility.name.in_([row[0] for row in SEED_FACILITIES])
        ).count()
    check("open-data records are imported", imported is not None)
    check("imported records carry region and district",
          bool(imported.region and imported.district))
    check("imported records start unverified", imported.verified is False)
    check("every record has a district", curated_without_district == 0,
          f"{curated_without_district} without")
    profile = client.get(f"{API}/facilities/{imported.id}").json()
    check("profile names its data source", profile["source"] == "osm")

    # Komfo Anokye is both hand-entered and in OpenStreetMap: one record,
    # with the source's location and the curated classification and beds.
    komfo = client.get(f"{API}/facilities", params={"q": "Komfo Anokye", "page_size": 50}).json()
    teaching = [f for f in komfo["items"] if "Teaching" in f["name"]]
    check("seed and open-data twins are merged", len(teaching) == 1,
          str([f["name"] for f in teaching]))
    with SessionLocal() as db:
        merged = db.get(Facility, teaching[0]["id"])
        check("merged record is marked as merged", merged.source == "osm+seed", merged.source)
        check("merged record keeps the curated classification", merged.classification == "Level A")
        check("merged record gains a district", bool(merged.district))

    pharmacies = client.get(
        f"{API}/facilities", params={"category": "pharmacy", "page_size": 5}
    ).json()
    check("pharmacies are searchable", pharmacies["total"] > 100, f"total={pharmacies['total']}")


def test_launch_checklist_pages():
    missing = client.get("/no-such-page")
    check("unknown page returns 404", missing.status_code == 404)
    check("unknown page shows the branded 404 page", b"We can't find that page" in missing.content)
    check("unknown nested page shows the 404 page",
          b"We can't find that page" in client.get("/a/b/c.html").content)
    check("unknown API path stays JSON",
          client.get(f"{API}/no-such-thing").json() == {"detail": "Not found"})

    for page in ("/thank-you.html", "/privacy.html", "/terms.html", "/favicon.ico",
                 "/images/og-image.jpg", "/images/findcareghana-icon-32.png"):
        check(f"{page} is served", client.get(page).status_code == 200)

    robots = client.get("/robots.txt")
    check("robots.txt is served", robots.status_code == 200)
    check("robots.txt blocks management pages",
          "Disallow: /superadmin" in robots.text and "Disallow: /admin" in robots.text)
    check("robots.txt points to the sitemap", "/sitemap.xml" in robots.text)

    sitemap = client.get("/sitemap.xml")
    check("sitemap.xml is XML", sitemap.headers["content-type"].startswith("application/xml"))
    check("sitemap lists public pages",
          "/privacy.html</loc>" in sitemap.text and "/ambulance.html</loc>" in sitemap.text)
    check("sitemap lists facility profiles", "/facility.html?id=" in sitemap.text)
    check("sitemap leaves out sign-in pages",
          "/admin" not in sitemap.text and "/superadmin" not in sitemap.text)

    config = client.get("/site-config.js")
    check("site config script is served",
          config.status_code == 200 and "window.SITE_CONFIG" in config.text)

    home = client.get("/").text
    check("home page has an Open Graph image", 'property="og:image"' in home)
    check("home page has a canonical link", 'rel="canonical"' in home)
    check("home page links to privacy and terms",
          'href="/privacy.html"' in home and 'href="/terms.html"' in home)
    check("home page has the sticky phone shortcuts", 'class="mobile-cta"' in home)


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
