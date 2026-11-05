"""FindCare Ghana API.

FastAPI application wiring. Serves the API under /api/v1 and the static
PWA frontend at /, so the MVP runs from a single process.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR, settings
from .database import ensure_schema
from .ratelimit import RateLimitMiddleware
from .routers import admin, ambulance, contact, emergency, facilities, reference, site, superadmin


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_schema()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="FindCare Ghana API",
    version="1.1.0",
    description=(
        "Find medical facilities and ambulance providers across the 16 regions "
        "of Ghana. Implements PRD v1.1 Phase 1."
    ),
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# PRD 6.3: CORS configured to allow future mobile app access.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
)
app.add_middleware(RateLimitMiddleware)


@app.middleware("http")
async def revalidate_site_files(request, call_next):
    """Pages, scripts and styles change together on every deploy. Without
    this a browser can keep an old script for days and run it against the
    new API. no-cache still lets it reuse its copy when the ETag matches,
    so an unchanged file costs one tiny request."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response


for router in (facilities.router, ambulance.router, emergency.router,
               reference.router, contact.router, admin.router, superadmin.router):
    app.include_router(router, prefix=settings.API_PREFIX)
app.include_router(site.router)


@app.get("/admin", include_in_schema=False)
def admin_login_page():
    return FileResponse(FRONTEND_DIR / "admin.html")


@app.get("/admin/register", include_in_schema=False)
def legacy_admin_registration_page():
    # Self-registration was replaced by the contact form.
    return RedirectResponse("/contact.html", status_code=308)


@app.get("/superadmin", include_in_schema=False)
def superadmin_page():
    return FileResponse(FRONTEND_DIR / "superadmin.html")


@app.get("/admin.html", include_in_schema=False)
def legacy_admin_login_page():
    return RedirectResponse("/admin", status_code=308)


@app.get("/api/v1/health", tags=["meta"])
def health():
    from .database import DIALECT

    return {
        "status": "ok",
        "version": "1.1.0",
        "database": DIALECT,
        "data_verified": settings.DATA_VERIFIED,
        "emergency_number": settings.NATIONAL_EMERGENCY_NUMBER,
    }


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"],
               include_in_schema=False)
def unknown_api_path(path: str):
    # Without this, the static mount below would answer with the HTML 404 page.
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.exception_handler(404)
async def not_found(request, exc):
    """API 404s stay JSON; pages get the branded 404 page."""
    if request.url.path.startswith("/api"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    page = FRONTEND_DIR / "404.html"
    if page.exists():
        return FileResponse(page, status_code=404)
    return JSONResponse(status_code=404, content={"detail": "Not found"})


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
