"""In-process sliding-window rate limiter (PRD 6.3).

Adequate for a single-node MVP. Swap the `_HITS` dict for Redis when the
API runs on more than one worker -- the middleware contract stays the same.
"""
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings

_WINDOW_SECONDS = 60
_HITS: dict[str, deque] = defaultdict(deque)

# Emergency mode must never be throttled away from a user in trouble.
_EXEMPT_PATHS = (f"{settings.API_PREFIX}/emergency",)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith(settings.API_PREFIX) or path.startswith(_EXEMPT_PATHS):
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        hits = _HITS[client]
        cutoff = now - _WINDOW_SECONDS
        while hits and hits[0] < cutoff:
            hits.popleft()

        if len(hits) >= settings.RATE_LIMIT_PER_MINUTE:
            retry_after = int(_WINDOW_SECONDS - (now - hits[0])) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Slow down."},
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)
        response = await call_next(request)
        remaining = max(0, settings.RATE_LIMIT_PER_MINUTE - len(hits))
        response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_PER_MINUTE)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
