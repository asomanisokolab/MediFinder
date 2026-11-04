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

Administrator login is at `/admin`; the access request form is at
`/admin/register`. Neither URL is linked from the public navigation. Requests
remain pending until an operator verifies the applicant's affiliation and
approves the request from the server CLI.

The seed command creates the demo administrator accounts below. These are
development accounts only; change their passwords or remove them before
deployment:

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

Checks cover pending admin registration and approval, distance ordering, the
dental filter, ambulance coverage-before-distance, emergency mode with and
without GPS, the 24-hour staleness rule, and admin authorisation boundaries.

---

## Database

SQLite remains the default for local development. Production uses PostgreSQL
with PostGIS; set `MEDIFINDER_DATABASE_URL` to a
`postgresql+psycopg://user:password@host:5432/medifinder` URL. PostGIS provides
the distance functions used by the API. The Docker Compose deployment below
supplies PostgreSQL with PostGIS and configures the API to connect to it.

## Deploy to a DigitalOcean Droplet

The Docker Compose setup runs the API and PostgreSQL with PostGIS. The API is
published only on `127.0.0.1:8000`, for a host-level Caddy reverse proxy. This
allows Caddy to serve MediFinder alongside other projects without competing
for ports 80 or 443. Use an Ubuntu Droplet and point your domain's DNS `A`
record to its public IP. Allow inbound SSH (preferably restricted to your IP),
HTTP, and HTTPS in the DigitalOcean firewall; do not expose PostgreSQL or
port 8000 publicly.

1. Install Docker Engine and the Docker Compose plugin on the Droplet using
   [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
2. Clone the repository and configure production settings:

   ```bash
   git clone https://github.com/asomanisokolab/MediFinder.git
   cd MediFinder
   cp .env.example .env
   nano .env
   ```

3. Set `DOMAIN` to your DNS name. Replace `POSTGRES_PASSWORD` with a strong
   password and `MEDIFINDER_JWT_SECRET` with a different random secret (for
   example, generate them with `openssl rand -hex 32`). Keep `.env` private;
   it is excluded from Git.
4. Build the containers, start PostgreSQL, seed the demo data, and start all
   services:

   ```bash
   docker compose build
   docker compose up -d db
   docker compose run --rm app python -m app.seed --reset
   docker compose up -d
   ```

5. Add a site block for your domain to the existing host Caddyfile (for
   example, `/etc/caddy/Caddyfile`). Do not replace the file or remove other
   projects' site blocks:

   ```caddy
   findcareghana.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:8000
   }
   ```

   Replace `findcareghana.com` if using a different domain. Validate and reload
   the host Caddy service:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

6. Visit `https://findcareghana.com` and check
   `https://findcareghana.com/api/v1/health`. Ensure DNS resolves to the
   Droplet and ports 80/443 reach the host Caddy service; Caddy obtains and
   renews the TLS certificate automatically. The health endpoint should report
   `"database": "postgresql"` and `"data_verified": false`.

The seed data is unverified demo data: the phone numbers are placeholders and
do not connect. Change both demo administrator passwords before sharing this
deployment. Do not mark the directory verified or rely on it for emergencies.

### Reviewing administrator requests

Public registration only submits a pending request; it does not create an
active account. Before approving, independently verify that the applicant is
authorized to represent the selected facility or ambulance provider. Run these
commands from the Droplet's project directory:

```bash
docker compose exec app python -m app.admin_requests list
docker compose exec app python -m app.admin_requests approve REQUEST_ID
# Or reject a request:
docker compose exec app python -m app.admin_requests reject REQUEST_ID
```

Approval activates the password chosen in the request. Rejected requests and
approved requests have their stored password hash cleared. Seeded demo admins
are created by `python -m app.seed --reset`; never use `--reset` on production
data because it drops and rebuilds the application tables.

Useful commands, run from the cloned repository:

```bash
docker compose logs -f app       # application logs
docker compose up -d --build     # deploy updated application code
docker compose down              # stop services; database volume is retained
```

The `postgres_data` volume persists records across container restarts and
deployments. Back it up before destructive operations. **When you are ready to
replace the seed data with real records**, first back up anything you need,
then run `docker compose run --rm app python -m app.seed --empty`. This drops
and recreates all application tables without inserting seed records, ready for
real data to be loaded. This erases all current records, so do not run it after
entering real data unless you intend to erase them. Use `--reset` only when you
want to replace the contents with the demo seed again.
Schema changes to an existing production database should use migrations;
SQLAlchemy `create_all` only creates missing tables.

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
    admin_requests.py review pending administrator access requests
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
| POST | `/admin/register` | Submits a pending request; operator approval required |
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
