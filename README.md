# FindCare Ghana

Phase 1 (MVP) implementation of the FindCare Ghana directory (built to the
MediFinder Ghana PRD v1.1). It lists hospitals, clinics, laboratories,
pharmacies and medical stores, ambulance services, hearse services and
caregivers across all 16 regions of Ghana. It is served at
<https://findcareghana.com>.

- Email: <info@findcareghana.com>
- Instagram, X and Facebook: **@findcareGh**

These are shown in every public page footer and on the Contact us page.
The site uses the FindCare Ghana wordmark (`frontend/images/findcareghana-logo.svg`)
and matching medical-cross icons (`findcareghana-icon*`). Internal names are
unchanged: the repository, the Python package and the `MEDIFINDER_*`
environment variables, so existing `.env` files keep working.

---

## ⚠️ Data provenance — read before showing this to anyone

The shipped dataset is **seed data, not a verified directory**. It has two parts:

1. **59 hand-picked facilities and 27 ambulance providers** in `seed.py`.
   Names, regions and approximate coordinates are real public reference
   points. **Every phone number is a placeholder** (`+233 30 000 XXXX`). None
   has been dialled, and none will connect.
2. **About 2,400 hospitals, clinics, CHPS compounds, laboratories,
   pharmacies, chemical sellers, funeral homes and care homes from
   OpenStreetMap**, in
   `data/ghana_facilities.csv` (see [data/SOURCES.md](data/SOURCES.md)). They
   have real coordinates, and each has a region, district (MMDA), city or
   town, and community. Phone numbers and opening hours appear only where
   OpenStreetMap mappers recorded them, about 1 in 8 records. None has been
   called. Services list only what the source says the place is, such as a
   pharmacy, dentist or CHPS compound. Nothing is guessed. A place that only
   does lab work (32 of them) is a **laboratory**; a clinic, hospital or
   pharmacy whose name says it has a lab (18) keeps its category and lists a
   Laboratory service. Each profile
   credits OpenStreetMap, as the ODbL licence requires. When an
   OpenStreetMap place is the same as a hand-picked one (same name, within
   1 km), the two become one record. It takes the open-data location,
   district, community and any real phone number, and keeps the curated
   classification, services, insurance and beds. Such records are marked
   `osm+seed`.

- Every record ships with `verified = false` and `phone_verified_at = null`, the
  API reports `data_verified: false`, and the UI shows an unverified banner on
  every screen.

PRD §7.3 requires every ambulance dispatch number to be call-verified before
publication, and §8 requires re-verification every 90 days. Do that before
setting `MEDIFINDER_DATA_VERIFIED=true`. Until then this is a working system
with placeholder contents, not something anyone should rely on in an emergency.

---

## Search, busy status and what facilities offer

**Search box.** Typing a town, community or district ("Koforidua") lists every
facility there, followed by any named after it elsewhere. Typing a name
("Atibie Government Hospital") puts that facility first. Every word is
matched on its own, in the name, the place, the address or a service ("malaria
test"), so "clinics in Ho" works. While typing, suggestions show places
(choosing one lists everything there) and facilities (choosing one opens its
profile). The Search button turns grey with a spinner while a search runs,
and a message above the results says what was found ("Found 32 facilities in
Koforidua"), that nothing was found, or that the search failed, with a Try
again button. Choosing "Looking for", region, district or town does not search
by itself: there is a second Search button beside **Use my location** for
that. When a search finds something, the form folds into a one-line summary
("Laboratories · New Juaben South Municipal, Eastern") with a **Change search**
button and the page moves to the results; when nothing is found the form stays
open so the user can change it.

**Busy status: red busy, yellow less busy, green not busy.** Every hospital,
clinic, laboratory and pharmacy shows one, on the result card and the
profile. It comes from the first of these that applies (see
`backend/app/busyness.py`):

1. **The facility's staff.** The admin dashboard has three buttons. Their
   answer is shown for 3 hours.
2. **People there.** The profile asks "Are you there now?". Reports from the
   last 90 minutes are averaged, the newest counting most. One person can
   report once every 20 minutes per facility. Only a hash of their address is
   kept, never the address.
3. **A prediction.** It starts from the usual pattern for that kind of place:
   outpatient queues peak on weekday mornings, labs before noon, pharmacies
   after work, Mondays are busiest, and private facilities see fewer people
   than government ones. It then learns from the reports this facility has
   had at the same hour on the same kind of day over the last eight weeks.
   The more reports a facility gets, the more its prediction follows its own
   pattern. Fresh bed counts also move it.

Outside usual opening hours, a facility that isn't open 24 hours shows grey
"May be closed". Each status says where it came from ("Predicted", "Visitor
reports", "Facility update"), so a guess is never shown as a check. The
prediction runs on the server and needs no outside AI service, API key or
running cost.

**What a facility offers.** A facility can offer several kinds of care: a
hospital can also run a medical laboratory (tests, scans and X-rays) and a
pharmacy. On the admin dashboard, **What you offer** has a **Kinds of care**
dropdown (Hospital, Clinic, Medical laboratory, Pharmacy, Hearse service,
Caregiving; several can be ticked). Under each kind the admin lists its
services, either tapping suggestions (Malaria test, Full blood count, X-ray,
Spirometry, Cardio therapy…) or typing their own. Eye, dental and maternity
care are services of the hospital or clinic. Any service can be marked as not
available now or removed. The profile shows services grouped by kind, and the
**Looking for** filter matches the kind as well as the category: "Medical
laboratories" finds standalone labs and every hospital or clinic that runs
one.

**Medical facility category.** Hospitals and clinics have one of: CHPS
compound / Maternity home, Health centre, Polyclinic, District / Municipal
hospital, Regional hospital, Specialised hospital / clinic, Tertiary
hospital, Teaching hospital. It is a main dropdown on the home page search,
shown on the profile, and set by the superadmin. The old Ghana Health Service
levels were moved across on startup (Level A → Teaching, B → Regional, C →
District / Municipal, D → Polyclinic, E → Health centre, F → CHPS / Maternity
home); private facilities, which had no level, get one from their name
(Specialist, Eye, Dental, Maternity Home…) or stay "Not classified" until
someone sets it.

**Wards.** Hospitals and clinics tick their wards (Children's, Female, Male)
on the admin dashboard; the profile lists them and **More filters → Ward**
finds facilities that have one.

**Insurance.** NHIS, Premium insurance and Assurance insurance come first,
followed by named insurers.

---

## Mobile app

`mobile/` holds the React Native app (Expo SDK 58, Expo Router, TypeScript).
It contains only the public sections: Find care with Emergency mode,
Ambulance and Contact us. There are no admin or superadmin screens. GitHub
Actions builds an installable APK on every push, or you can use
`eas build -p android --profile preview`. See [mobile/README.md](mobile/README.md).

## Run it

```bash
cd MediFinder/backend
python -m pip install -r requirements.txt
python -m app.seed --reset
python -m uvicorn app.main:app --reload --port 8000
```

Then open <http://localhost:8000>. API docs are at `/api/docs`.

### How organizations get listed

There is no self-registration. Hospitals (government or private), clinics,
pharmacies and medical stores, ambulance services, hearse services and
caregivers ask to be listed through the public **Contact us** page
(`/contact.html`, linked in the main navigation). They give their facility
name, type, phone number and email, and can add a contact name and a message.
The page also shows <info@findcareghana.com> and @findcareGh for anyone who
prefers to write directly. A contact request grants nothing on its own.

A superadmin reviews each request in the dashboard at `/superadmin`.
**Approve and create login** opens a form prefilled from the request. The
superadmin confirms the region, classification (for hospitals and clinics) and
other details. Saving does four things:

1. Creates the listing. Ambulance services become ambulance providers;
   everything else becomes a facility with a `category` of `hospital`,
   `clinic`, `pharmacy`, `hearse` or `caregiver`.
2. Creates the organization's admin login: their email plus a random default
   password.
3. Shows the superadmin a ready-to-send login message.
4. Marks the request approved.

**The superadmin emails the login details directly.** The app does not send
email. After saving, the dashboard shows the finished message once: the
sign-in link, the organization's email and its default password. Send it to
the organization's email address from your own mailbox:

- **Open in email app** opens a new email to the organization with the subject
  and message already filled in. Check it and press send.
- **Copy message** copies the subject and message, ready to paste into webmail
  (Gmail, Outlook and so on).

The default password is not shown again, so send the message before leaving
the page. The organization signs in with their email and the default
password, and must then choose their own password before anything else.

After the first sign-in, only the organization knows its password. Whenever
it wants a new one, it changes it itself under **Advanced settings → Change
password** (current password, then the new one twice).

**Lost password.** An organization that cannot sign in contacts FindCare
(<info@findcareghana.com> or @findcareGh). After confirming it is really
them (for example, call the listing's phone number), the superadmin clicks
**Reset password** next to their admin login. This does three things:

1. Replaces the lost password with a new random default password. The old
   one stops working at once, and any open session is locked.
2. Shows a ready-to-send "password was reset" message, sent the same way as a
   new login (**Open in email app** or **Copy message**).
3. Makes the organization choose its own new password when it signs in with
   the default one.

The superadmin never sees or chooses the organization's own password.

A listing can also be created without a contact request, under **Add an
organization**.

The organization signs in at `/admin` (deliberately not in the public
navigation) and must choose its own password before the dashboard opens.
Under **Advanced settings** it sets its map location. It can type the latitude
and longitude, or press **Use this device's location** while standing at the
entrance. Until a location is set, the listing sits at a region-centre
placeholder and is **hidden from public search and emergency mode**, so no one
is ever sent to a guessed position. If the superadmin enters coordinates when
creating the listing, it is visible immediately.

Emergency mode only returns hospitals and clinics; pharmacies, hearse services
and caregivers appear in the regular search, filtered by **Looking for**.

From the dashboard, superadmins can also:

- reset a lost organization password to a new default password (see above)
- revoke organization-admin access
- edit every facility and ambulance-provider directory field, including the
  category
- review the latest 200 change records

Permanent deletion requires confirmation and also removes the deleted
organization's admins and related directory data. Deleting a provider also
clears facility links to it. Creations, deletions and superadmin edits are
audited. Rejected requests are not notified automatically.

Superadmin accounts are never created through the web or by the seed command.
An authorized operator provisions one from the Droplet shell (see deployment
step 5). The command generates a random strong password and prints it once.
`reset-password` replaces a lost superadmin password the same way. (This is
only for the superadmin's own account. Organization passwords are reset
from the dashboard.)

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

Checks cover the contact request → superadmin-created login → forced password
change → location setup flow, the open-data directory (districts, district
filter, merged duplicates), the 404 page, robots.txt, sitemap.xml and the
legal pages, hidden unlocated listings, distance ordering,
the dental and category filters, ambulance coverage-before-distance, emergency
mode with and without GPS (never offering non-health services), the 24-hour
staleness rule, and admin authorisation boundaries, including the
ready-to-send login message returned to the superadmin.

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
allows Caddy to serve FindCare alongside other projects without competing
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
4. Build the containers, start PostgreSQL, seed the demo data and the
   open-data facility directory, and start all services:

   ```bash
   docker compose build
   docker compose up -d db
   docker compose run --rm app python -m app.seed --reset
   docker compose up -d
   ```

5. Create the initial superadmin from the Droplet. The command generates a
   random strong password and prints it **once**; copy it into a password
   manager straight away. It is not stored anywhere in plain text and is not
   emailed:

   ```bash
   docker compose exec app python -m app.superadmins create owner@example.com "System Owner"
   ```

   Use your real admin email and name, then sign in at `/superadmin`. If the
   password is ever lost, generate a replacement the same way:

   ```bash
   docker compose exec app python -m app.superadmins reset-password owner@example.com
   ```
6. Add a site block for your domain to the existing host Caddyfile (for
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

7. Visit `https://findcareghana.com` and check
   `https://findcareghana.com/api/v1/health`. Ensure DNS resolves to the
   Droplet and ports 80/443 reach the host Caddy service; Caddy obtains and
   renews the TLS certificate automatically. The health endpoint should report
   `"database": "postgresql"` and `"data_verified": false`.

The seed data is unverified demo data: the phone numbers are placeholders and
do not connect. Change both demo administrator passwords before sharing this
deployment. Do not mark the directory verified or rely on it for emergencies.

### Loading or refreshing the facility directory

A new deployment loads `data/ghana_facilities.csv` as part of step 4. An
existing deployment loads it, or picks up a rebuilt version, with:

```bash
cd /opt/MediFinder
git pull --ff-only origin main
sudo docker compose up -d --build app
sudo docker compose exec app python -m app.directory_import
```

The import prints how many places it added, merged into matching seed
records, refreshed, left alone or skipped. It never deletes anything, so it is
safe to run again. Listings that an organization manages, or that have been
verified, are never changed. To rebuild the CSV from fresh OpenStreetMap data,
follow [data/SOURCES.md](data/SOURCES.md).

### Reviewing contact requests

A contact request is unverified public input. Before approving, independently
confirm the organization exists and that the email and phone belong to it
(for example, call the number). Approving creates a live login for that email.

Sign in at `/superadmin` and review requests there (see
[How organizations get listed](#how-organizations-get-listed)). Directory
deletion is permanent: it deletes the record, scoped admins and related
records; deleting an ambulance provider also removes its links from
facilities. Verify the selection before confirming. Superadmin accounts
remain CLI-provisioned; do not share Droplet access for routine approvals.
Superadmin accounts use a separate login token and cannot use
facility/provider admin endpoints.

### Sending login details

The app sends no email. The login message for each new account or
lost-password reset is shown once in the superadmin dashboard and sent by the superadmin to the
organization's email address. Use **Open in email app**, or **Copy message**
and paste it into webmail. Send it from a mailbox the organization will
recognise, such as <info@findcareghana.com>.

The sign-in link in the message uses `MEDIFINDER_PUBLIC_URL`, which defaults
to `https://$DOMAIN`.

The seed command creates only the two demo organization-admin accounts; never
use `python -m app.seed --reset` on production data because it drops and
rebuilds the application tables. The superadmin account is not affected by the
seed command.

Useful commands, run from the cloned repository:

```bash
docker compose logs -f app       # application logs
git pull --ff-only origin main   # fetch the latest main branch
docker compose up -d --build app # rebuild and reload only the app
docker compose down              # stop services; database volume is retained
docker compose exec app python -m app.directory_import  # load or refresh the open-data directory
```

After an update, confirm the app is running with `docker compose ps`, inspect
startup errors with `docker compose logs --tail=50 app`, and check
`https://your-domain/api/v1/health`. Do not run the seed reset command to
deploy code. On startup the app creates new tables and adds new columns to
existing ones (see `ensure_schema()` in `database.py`). Existing facilities
default to the `hospital` category, so recategorize clinics and pharmacies in
the superadmin dashboard. Existing listings stay visible. The old
`admin_registration_requests` table is left in place and is no longer used;
any requests still pending in it must be resubmitted through Contact us.

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
| `MEDIFINDER_PUBLIC_URL` | `https://$DOMAIN` | Base of the sign-in link in login messages, and of the URLs in `robots.txt` and `sitemap.xml` |
| `MEDIFINDER_GA_MEASUREMENT_ID` | empty | Google Analytics 4 ID (`G-…`). Empty turns analytics and the cookie banner off; see [Analytics and Google](#analytics-and-google) |
| `MEDIFINDER_GOOGLE_VERIFICATION_FILE` | empty | Search Console HTML-file verification name, e.g. `google1234abcd.html` |

### Website pages

Every public site should ship with the items in this checklist. For FindCare
Ghana they are:

| Item | Where |
| --- | --- |
| Custom 404 page | `frontend/404.html`, served for any unknown address. Unknown `/api/…` addresses still return JSON |
| Call to action above the fold | Red **Emergency — find help now** button in the home page banner |
| Title and description per page | `<title>` and `<meta name="description">` in each page. Facility pages set theirs from the facility's name, type and town |
| Open Graph image | `frontend/images/og-image.jpg` (1200×630), plus Open Graph and Twitter tags on public pages |
| Favicon set | `favicon.ico`, SVG icon, 32px PNG, 180px Apple touch icon, 192px and 512px app icons |
| robots.txt and sitemap.xml | Generated by the app; see below |
| Alt text | On every image |
| Mobile layouts | Built phone-first, with breakpoints at 640, 760 and 1000px |
| Sticky mobile CTA | **Emergency help** and **Call 112** bar at the bottom of phone screens |
| Loading states | Spinners while searching and loading. The contact form shows "Sending…" |
| Form errors | The contact form explains each wrong field under it and summarises at the top |
| Thank-you page | `thank-you.html`, shown after a contact request is sent |
| Privacy policy, terms | `privacy.html`, `terms.html`, linked in every footer. Have them reviewed by a lawyer |
| Cookie banner | Appears only when analytics is configured; see below |
| Analytics | Google Analytics 4, loaded only after a visitor accepts cookies |
| Google indexing | Sitemap, robots.txt, canonical links and structured data; see Search Console below |

### Analytics and Google

#### Google Analytics (visitor statistics)

1. Go to <https://analytics.google.com> and sign in with the Google account
   that should own the statistics.
2. Choose **Admin** (gear icon) → **Create** → **Property**. Name it
   *FindCare Ghana*, set the time zone to *Ghana* and the currency to *Ghanaian
   Cedi*, then continue through the business questions.
3. When asked for a data stream, choose **Web**. Enter `findcareghana.com` and
   the stream name *FindCare Ghana website*, then press **Create stream**.
4. Copy the **Measurement ID** shown at the top right. It looks like
   `G-ABC123XYZ`.
5. On the droplet, add it to `.env` and restart the app:

   ```bash
   cd /opt/MediFinder
   nano .env        # add: MEDIFINDER_GA_MEASUREMENT_ID=G-ABC123XYZ
   sudo docker compose up -d app
   curl -s https://findcareghana.com/site-config.js   # should show your ID
   ```

6. Open the site in a private window. The cookie banner appears; press
   **Accept**. Within a minute or two your visit shows in Google Analytics
   under **Reports → Realtime**.

How it behaves:

- Analytics loads **only after a visitor presses Accept**. If they press
  **Decline**, nothing is sent to Google.
- Visitors can change their choice at any time with **Cookie settings** in
  the footer.
- With no ID set, the site uses no optional cookies and shows no banner.
- To turn analytics off, empty the value in `.env` and run
  `sudo docker compose up -d app` again.

#### Google Search Console (getting found on Google)

1. Go to <https://search.google.com/search-console> and press **Add
   property**.
2. Choose **Domain** (left box), enter `findcareghana.com` and press
   **Continue**.
3. Google shows a **TXT record** like `google-site-verification=abc123…`.
   Copy it.
4. Sign in to the company that manages the domain's DNS (where the `A`
   record pointing at the droplet was set). Add a new **TXT** record with
   host/name `@` and the copied value. Save it.
5. Back in Search Console press **Verify**. DNS changes can take from a few
   minutes to a few hours; if verification fails, wait and press **Verify**
   again.
6. In the left menu open **Sitemaps**, enter `sitemap.xml` and press
   **Submit**. The status should become *Success*, with the number of pages
   found. This includes every facility and ambulance provider page.
7. Open **URL inspection**, paste `https://findcareghana.com/` and press
   **Request indexing**.
8. Over the next days, check **Pages** (what Google indexed) and
   **Performance** (searches that showed FindCare).

If you can't change the DNS, use the **URL prefix** property instead and
choose **HTML file** verification. Google gives you a file name such as
`google1234abcd.html`. Put that name in `.env` as
`MEDIFINDER_GOOGLE_VERIFICATION_FILE=google1234abcd.html` and run
`sudo docker compose up -d app`. The app serves the file, and you press
**Verify**.

Check these addresses at any time:

- `https://findcareghana.com/robots.txt` allows search engines, blocks the
  sign-in pages and the API, and points to the sitemap.
- `https://findcareghana.com/sitemap.xml` lists the public pages and every
  listed facility and ambulance provider. New listings appear automatically.

`robots.txt` and `sitemap.xml` are generated by the app. The sitemap lists
the public pages and every facility and ambulance provider visible in search,
so new listings are included automatically. Sign-in pages, the thank-you page
and the 404 page are kept out of search.

The social-share image is `frontend/images/og-image.jpg` (1200×630). The
canonical and Open Graph URLs in the page `<head>` use
`https://findcareghana.com`, so update them if the domain changes.

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
    superadmins.py  CLI provisioning of superadmin accounts (generated passwords)
    ratelimit.py    sliding-window limiter; emergency route exempt
    reference.py    regions, classifications, categories, organization types
    seed.py         seed data (placeholder phone numbers)
    directory_import.py  loads data/ghana_facilities.csv (safe on live data)
    routers/        facilities, ambulance, emergency, reference, contact,
                    admin, superadmin, site (robots.txt, sitemap.xml, site config)
  tests/test_api.py
frontend/
  index.html        search + emergency mode
  facility.html     facility profile
  ambulance.html    ambulance directory + provider detail
  contact.html      Contact us -- how organizations ask to be listed
  admin.html        organization dashboard, incl. advanced settings
  superadmin.html   system management
  thank-you.html    shown after a contact request is sent
  privacy.html      privacy policy
  terms.html        terms of use
  404.html          page-not-found page
  favicon.ico
  images/           FindCare Ghana logo, icons and og-image.jpg
  css/styles.css    mobile-first, no web fonts
  js/               api, ui, site (cookie banner + analytics), home, facility,
                    ambulance, contact, admin, superadmin
  manifest.json     PWA manifest (offline caching is Phase 3)
data/
  ghana_facilities.csv  open-data facility directory (OpenStreetMap)
  SOURCES.md            sources, licences, how to rebuild
scripts/
  build_directory.py    builds the CSV from downloaded open data
  overpass/             the OpenStreetMap queries
mobile/                 React Native (Expo) app of the public sections
docs/
  FindCare-Ghana-How-Access-Works.pdf  plain-language guide for staff
  build_access_guide.py                regenerates the PDF (needs reportlab)
```

---

## API

All endpoints under `/api/v1`, JSON only, paginated, rate limited.

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/facilities` | Filters: region, district, city, town, type, category, classification, service (repeatable), insurance, is_24_hour, has_ambulance, q. Listings without a confirmed location are omitted |
| GET | `/facilities/nearby` | `lat`, `lng`, `radius_km`; sorted by distance |
| GET | `/facilities/search` | `q` is a place name (returns `matched_place` and `place_total`) or words from a name, place or service; accepts optional `lat`/`lng` to sort by distance. Every result carries `busy` and `care_types` |
| GET | `/facilities/suggest` | `q` (2+ letters): matching places and facilities for the search box |
| GET | `/facilities/{id}` | Full profile, with `busy`, `care_types` and each service's `care_type` |
| POST | `/facilities/{id}/busy-reports` | Public: `{"level": "busy" \| "less_busy" \| "not_busy"}`; once per person per facility every 20 minutes |
| GET | `/ambulance/providers` | Filters: region, district, operator_type, service_level, q |
| GET | `/ambulance/providers/{id}` | Full provider profile |
| GET | `/ambulance/covering` | Providers whose **coverage** includes a coordinate |
| GET | `/emergency` | Facilities + ambulances + 112 in one call; never rate limited |
| GET | `/regions`, `/services`, `/insurance`, `/classifications`, `/enums` | Reference data |
| GET | `/care-types` | Kinds of care a facility can offer, each with suggested services |
| GET | `/regions/{region}/districts` | Districts (MMDAs) with listed facilities |
| GET | `/regions/{region}/localities` | Cities and towns; optional `district` narrows the list |
| POST | `/contact` | Public contact form; creates a pending request, grants nothing |
| POST | `/admin/login` | Returns an 8-hour JWT and `must_change_password` |
| POST | `/admin/password` | Admin changes their own password (current + new); the only write allowed before the default password is replaced |
| PUT | `/admin/location` | Set the organization's own lat/lng (must be in Ghana); makes it publicly listed |
| POST | `/superadmin/login` | Returns a superadmin-only 8-hour JWT |
| GET | `/superadmin/overview` | Superadmin-only counts, contact requests, admins, and audit history |
| GET | `/superadmin/facilities` | Superadmin-only paged search of every facility, hidden ones included: `q` (name, ID, community, town, district, region, phone), `region`, `district`, `city`, `category`, `type`, `verified`, `location` (set/missing), `managed` (has a login) |
| GET | `/superadmin/providers` | Superadmin-only paged search of ambulance providers: `q`, `region`, `district`, `operator_type`, `service_level`, `verified`, `location` |
| POST | `/superadmin/organizations` | Create a listing + admin login (optionally approving a contact request); returns the default password (`temporary_password`) and a ready-to-send `message` for the superadmin to email |
| POST | `/superadmin/admins/{id}/reset-password` | Lost password: replaces it with a new default password (old one stops working) and returns the message the same way |
| POST | `/superadmin/contact-requests/{id}/reject` | Reject a contact request |
| DELETE | `/superadmin/admins/{id}` | Superadmin-only organization-admin revocation |
| PUT | `/superadmin/facilities/{id}` | Superadmin-only facility edit; includes services, insurance, beds, and verification |
| DELETE | `/superadmin/facilities/{id}` | Permanently deletes a facility and its related records |
| PUT | `/superadmin/providers/{id}` | Superadmin-only ambulance-provider edit; includes coverage, fleet, and verification |
| DELETE | `/superadmin/providers/{id}` | Permanently deletes a provider, its related records, and facility links |
| GET | `/admin/me`, `/admin/dashboard` | Authenticated |
| PUT | `/facilities/{id}/beds` | Facility admin only |
| PUT | `/facilities/{id}/services` | Facility admin only: turn listed services on or off |
| PUT | `/facilities/{id}/offerings` | Facility admin only: the full list of services, each with its `care_type`; replaces the old list |
| PUT | `/facilities/{id}/busy` | Facility admin only: how busy it is now, shown for 3 hours |
| PUT | `/facilities/{id}/wards` | Facility admin only: `{"wards": ["children", "female", "male"]}` |
| PUT | `/ambulance/providers/{id}/status` | Provider admin only |

Every organization-admin endpoint except `/admin/me` and `/admin/password`
returns 403 until the default password has been changed.

Outside `/api/v1` the app also serves `/robots.txt`, `/sitemap.xml`,
`/site-config.js` (the analytics ID for the cookie banner), and the Search
Console verification file when one is configured.

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

**One facility, several kinds of care.** `services.care_type` says which
part of a facility offers a service (a hospital's laboratory, its pharmacy).
Older rows are filled in on startup: Laboratory, Pharmacy, Dental, Eye Care,
X-ray and Ultrasound get their own kind, and everything else falls under the
facility's category.

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
region via the nearest known facility, falling back to region centroids.
Imported facilities get their region and district from official boundary
polygons when the directory is built, so the nearest-facility lookup is now
well grounded across all 16 regions.

---

## Not built (out of Phase 1 scope per PRD §11)

In-app ambulance dispatch, booking or live tracking; ambulance fare quotation or
payment; appointment booking; online payment; electronic health records; doctor
profiles; telemedicine; NHIA live claims integration.

Deferred to later phases per the roadmap: multilingual support, WhatsApp share,
wait times, symptom-based search (Phase 2); service-worker offline caching
(Phase 3); native app (Phase 4). The PWA manifest ships now so Phase 3 is a
service worker rather than a rebuild.
