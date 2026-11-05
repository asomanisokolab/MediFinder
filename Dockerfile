FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./backend/app
COPY frontend ./frontend
COPY data ./data

WORKDIR /app/backend

EXPOSE 8000

# Caddy on the host is the only thing that can reach this port (it is
# published on 127.0.0.1 only), so trust the visitor address it forwards.
# Without this every visitor looks like the Docker gateway and they all
# share one rate limit.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
