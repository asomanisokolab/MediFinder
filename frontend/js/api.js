/* Shared API client, location handling and DOM helpers.
   Loaded by every page. Kept dependency-free on purpose (PRD 6.1). */

const API = '/api/v1';
// The website calls its own server. The mobile app runs from local files
// and sets window.API_ORIGIN to the live site before this script loads.
const API_ORIGIN = window.API_ORIGIN || window.location.origin;

/* ---------- element helper -------------------------------------------
   Builds nodes with textContent rather than innerHTML, so facility names
   and other stored strings can never be interpreted as markup. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------- api ------------------------------------------------------ */
async function api(path, params = {}, options = {}) {
  const url = new URL(API + path, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else url.searchParams.set(key, value);
  }

  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const token = options.token === undefined ? Auth.token() : options.token;
  if (token && options.auth !== false) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new Error('Cannot reach FindCare. Check your connection and try again.');
  }

  if (response.status === 429) {
    throw new Error('Too many requests. Wait a moment and try again.');
  }
  if (response.status === 401 && options.auth !== false) {
    Auth.clear();
    throw new Error('Your session has expired. Sign in again.');
  }

  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }

  if (!response.ok) {
    const detail = body && body.detail;
    throw new Error(
      typeof detail === 'string' ? detail : 'Something went wrong. Please try again.'
    );
  }
  return body;
}

/* ---------- location -------------------------------------------------
   PRD 5.1.4: falls back to region selection when GPS is denied. Callers
   handle the rejection; this only reports what happened. */
const Location = {
  KEY: 'mf.location',

  cached() {
    try {
      const raw = sessionStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  },

  save(coords) {
    try {
      sessionStorage.setItem(this.KEY, JSON.stringify(coords));
    } catch (err) {
      /* private mode: carry on without caching */
    }
  },

  request({ useCache = true, timeout = 10000 } = {}) {
    if (useCache) {
      const hit = this.cached();
      if (hit) return Promise.resolve(hit);
    }
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('This device cannot share its location. Choose a region instead.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: Number(position.coords.latitude.toFixed(5)),
            lng: Number(position.coords.longitude.toFixed(5)),
          };
          this.save(coords);
          resolve(coords);
        },
        (err) => {
          const messages = {
            1: 'Location permission denied. Choose a region instead.',
            2: 'Your location is unavailable. Choose a region instead.',
            3: 'Finding your location took too long. Choose a region instead.',
          };
          reject(new Error(messages[err.code] || 'Could not get your location.'));
        },
        { enableHighAccuracy: true, timeout, maximumAge: 300000 }
      );
    });
  },
};

/* ---------- auth ----------------------------------------------------- */
const Auth = {
  KEY: 'mf.token',
  token() {
    try {
      return localStorage.getItem(this.KEY);
    } catch (err) {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(this.KEY, token);
    } catch (err) {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(this.KEY);
    } catch (err) {
      /* ignore */
    }
  },
};

/* ---------- formatting ----------------------------------------------- */
function fmtDistance(km) {
  if (km === null || km === undefined) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function fmtWhen(iso) {
  if (!iso) return 'never';
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (Number.isNaN(mins)) return 'unknown';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function telHref(phone) {
  return `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
}

function directionsHref(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
