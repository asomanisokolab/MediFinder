# MediFinder Ghana

Phase 1 (MVP) implementation of **MediFinder Ghana PRD v1.1** — a directory of
medical facilities, dental care and ambulance providers across all 16 regions
of Ghana.

---

## ⚠️ Data provenance — read before showing this to anyone

The shipped dataset is **seed data, not a verified directory**.

- Facility and ambulance provider **names, regions and approximate coordinates**
  are real public reference points.
- **Every phone number is a placeholder** (`+233 30 000 XXXX`). None has been
  dialled. None will connect.
- Every record ships with `verified = false` and `phone_verified_at = null`, the
  API reports `data_verified: false`, and the UI shows an unverified banner on
  every screen.

PRD §7.3 requires every ambulance dispatch number to be call-verified before
publication, and §8 requires re-verification every 90 days. Do that before
setting `MEDIFINDER_DATA_VERIFIED=true`. Until then this is a working system
with placeholder contents, not something anyone should rely on in an emergency.

---

## Run it

```bash
cd MediFinder/backend
python -m pip install -r requirements.txt
python -m app.seed --reset
python -m uvicorn app.main:app --reload --port 8000
```

Then open <http://localhost:8000>. API docs are at `/api/docs`.

Demo administrator logins (change before any deployment):

| Account | Password | Scope |
| --- | --- | --- |
| `facility@medifinder.gh` | `changeme123` | Korle Bu Teaching Hospital |
| `ambulance@medifinder.gh` | `changeme123` | NAS Ridge Station |

### Tests

```bash
cd MediFinder/backend
python -m app.seed --reset
python tests/test_api.py
```

71 checks covering distance ordering, the dental filter, ambulance
coverage-before-distance, emergency mode with and without GPS, the 24-hour
staleness rule, and admin authorisation boundaries.

---

## Swapping SQLite for PostgreSQL + PostGIS

The MVP runs on SQLite. The swap is a config change plus one dialect branch —
no model, route or frontend changes.

1. `pip install "psycopg[binary]"`
2. Create the database and enable PostGIS: `CREATE EXTENSION postgis;`
3. Set the URL and reseed:

```bash
export MEDIFINDER_DATABASE_URL="postgresql+psycopg://user:pw@host/medifinder"
python -m app.seed --reset
```

`app/geo.py` detects the dialect and switches from the SQLite `haversine_km`
function (registered in `app/database.py`) to PostGIS `ST_DistanceSphere`.
Everything else is dialect-agnostic. When the dataset outgrows a sequential
scan, add a `geography(Point,4326)` column with a GiST index and change only
`distance_km_expr()`.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEDIFINDER_DATABASE_URL` | local SQLite file | Database connection |
| `MEDIFINDER_JWT_SECRET` | dev placeholder | **Must be changed before deploy** |
| `MEDIFINDER_CORS_ORIGINS` | `*` | Comma-separated origins |
| `MEDIFINDER_RATE_LIMIT` | `120` | Requests per minute per IP |
| `MEDIFINDER_DATA_VERIFIED` | `false` | Set true only after §7.3 verification |

---

## Layout

```
backend/
  app/
    config.py       settings, all env-driven
    database.py     engine, session, SQLite haversine shim
    geo.py          distance expression — the SQLite/PostGIS swap point
    models.py       PRD §6.2 schema
    schemas.py      request/response contracts
    presenters.py   ORM → JSON, including the 24-hour staleness rule
    security.py     bcrypt + JWT (8-hour expiry)
    ratelimit.py    sliding-window limiter; emergency route exempt
    reference.py    16 regions, classifications, service catalogue
    seed.py         seed data (placeholder phone numbers)
    routers/        facilities, ambulance, emergency, reference, admin
  tests/test_api.py
frontend/
  index.html        search + emergency mode
  facility.html     facility profile
  ambulance.html    ambulance directory + provider detail
  admin.html        admin dashboard v1
  css/styles.css    mobile-first, no web fonts
  js/               api, ui, home, facility, ambulance, admin
  manifest.json     PWA manifest (offline caching is Phase 3)
```

---

## API

All endpoints under `/api/v1`, JSON only, paginated, rate limited.

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/facilities` | Filters: region, city, town, type, classification, service (repeatable), insurance, is_24_hour, has_ambulance, q |
| GET | `/facilities/nearby` | `lat`, `lng`, `radius_km`; sorted by distance |
| GET | `/facilities/search` | Free text; accepts optional `lat`/`lng` to sort by distance |
| GET | `/facilities/{id}` | Full profile |
| GET | `/ambulance/providers` | Filters: region, district, operator_type, service_level, q |
| GET | `/ambulance/providers/{id}` | Full provider profile |
| GET | `/ambulance/covering` | Providers whose **coverage** includes a coordinate |
| GET | `/emergency` | Facilities + ambulances + 112 in one call; never rate limited |
| GET | `/regions`, `/services`, `/insurance`, `/classifications`, `/enums` | Reference data |
| POST | `/admin/login` | Returns an 8-hour JWT |
| GET | `/admin/me`, `/admin/dashboard` | Authenticated |
| PUT | `/facilities/{id}/beds` | Facility admin only |
| PUT | `/facilities/{id}/services` | Facility admin only |
| PUT | `/ambulance/providers/{id}/status` | Provider admin only |

---

## Design decisions worth knowing

**Ambulances are not facilities.** A facility is a place; an ambulance provider
is a mobile resource with a coverage area. They are separate tables with
separate endpoints, per PRD v1.1 §5.1.6.

**Coverage is resolved before distance.** The nearest base station does not
always serve the caller's district, so `/ambulance/covering` matches coverage
first and orders by distance within that set. Providers that do not cover the
caller are still returned as a backstop, explicitly flagged
`covers_user_area: false`, rather than returning nothing.

**Dental needed no schema change.** It is a value in `services.service_name`.
Standalone private dental clinics take the existing `Private` classification;
hospital dental units are a service on the parent facility record.

**Stale data is hidden, not shown as zero.** Bed counts and fleet status expire
after 24 hours and then report `"Not updated"` with the number withheld. Seeded
records start stale on purpose — showing invented availability is exactly the
failure mode PRD §10 risk 1 warns about.

**The product does not dispatch.** Emergency mode, provider cards and the
API payload all say so in words, and the button is labelled *Call provider*,
never *Request ambulance*. 112 is shown regardless of what the search returns.

**Location resolution is approximate.** `resolve_area()` maps a coordinate to a
region via the nearest known facility, falling back to region centroids. Replace
it with a PostGIS point-in-polygon lookup once district boundaries are loaded.

---

## Not built (out of Phase 1 scope per PRD §11)

In-app ambulance dispatch, booking or live tracking; ambulance fare quotation or
payment; appointment booking; online payment; electronic health records; doctor
profiles; telemedicine; NHIA live claims integration.

Deferred to later phases per the roadmap: multilingual support, WhatsApp share,
wait times, symptom-based search (Phase 2); service-worker offline caching
(Phase 3); native app (Phase 4). The PWA manifest ships now so Phase 3 is a
service worker rather than a rebuild.
