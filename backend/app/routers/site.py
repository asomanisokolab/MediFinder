"""Files for search engines and the browser: robots.txt, sitemap.xml,
the Search Console verification file and the analytics config script.

They are generated rather than static so the domain and the listed
facilities always match the deployment.
"""
import json
import re
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import AmbulanceProvider, Facility

router = APIRouter(include_in_schema=False)

# Public pages worth indexing. Sign-in pages, the thank-you page and the
# 404 page are left out on purpose.
PUBLIC_PAGES = (
    ("/", "daily", "1.0"),
    ("/ambulance.html", "daily", "0.9"),
    ("/contact.html", "monthly", "0.6"),
    ("/privacy.html", "yearly", "0.2"),
    ("/terms.html", "yearly", "0.2"),
)

_VERIFICATION_FILE = re.compile(r"^google[0-9a-f]+\.html$")


def _base_url(request: Request) -> str:
    return settings.PUBLIC_URL or str(request.base_url).rstrip("/")


@router.get("/robots.txt", response_class=PlainTextResponse)
def robots(request: Request):
    return (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin\n"
        "Disallow: /superadmin\n"
        "Disallow: /api/\n"
        "Disallow: /thank-you.html\n"
        "\n"
        f"Sitemap: {_base_url(request)}/sitemap.xml\n"
    )


@router.get("/sitemap.xml")
def sitemap(request: Request, db: Session = Depends(get_db)):
    base = _base_url(request)
    entries = [
        (f"{base}{path}", None, changefreq, priority)
        for path, changefreq, priority in PUBLIC_PAGES
    ]
    # Only listings the public can see: unlocated ones are hidden from search.
    for facility_id, updated in db.execute(
        select(Facility.id, Facility.last_updated)
        .where(Facility.location_confirmed.is_(True))
        .order_by(Facility.id)
    ):
        entries.append((f"{base}/facility.html?id={facility_id}", updated, "weekly", "0.7"))
    for provider_id, updated in db.execute(
        select(AmbulanceProvider.id, AmbulanceProvider.last_updated)
        .where(AmbulanceProvider.location_confirmed.is_(True))
        .order_by(AmbulanceProvider.id)
    ):
        entries.append((f"{base}/ambulance.html?id={provider_id}", updated, "weekly", "0.6"))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, updated, changefreq, priority in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{escape(loc)}</loc>")
        if updated:
            lines.append(f"    <lastmod>{updated.date().isoformat()}</lastmod>")
        lines.append(f"    <changefreq>{changefreq}</changefreq>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return Response("\n".join(lines) + "\n", media_type="application/xml")


@router.get("/site-config.js")
def site_config():
    config = {"gaMeasurementId": settings.GA_MEASUREMENT_ID or None}
    return Response(
        f"window.SITE_CONFIG = {json.dumps(config)};\n",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


# Registered only when configured, so it cannot shadow the real pages.
if _VERIFICATION_FILE.match(settings.GOOGLE_VERIFICATION_FILE):
    @router.get(f"/{settings.GOOGLE_VERIFICATION_FILE}")
    def google_verification():
        return PlainTextResponse(
            f"google-site-verification: {settings.GOOGLE_VERIFICATION_FILE}",
            media_type="text/html",
        )
