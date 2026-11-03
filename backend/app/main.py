"""MediFinder Ghana API.

FastAPI application wiring. Serves the API under /api/v1 and the static
PWA frontend at /, so the MVP runs from a single process.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR, settings
from .database import Base, engine
from .ratelimit import RateLimitMiddleware
from .routers import admin, ambulance, emergency, facilities, reference


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    lifespan=lifespan,
    title="MediFinder Ghana API",
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


for router in (facilities.router, ambulance.router, emergency.router,
               reference.router, admin.router):
    app.include_router(router, prefix=settings.API_PREFIX)


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


@app.exception_handler(404)
async def not_found(request, exc):
    """API 404s stay JSON; anything else falls through to the SPA shell."""
    if request.url.path.startswith("/api"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse(status_code=404, content={"detail": "Not found"})


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
