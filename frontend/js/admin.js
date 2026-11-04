/* Admin dashboard v1 (PRD 5.2.1, pulled into Phase 1).

   Facility admins update beds and service availability.
   Ambulance provider admins update fleet status.
   Accounts are created by a superadmin with a default password, which
   must be replaced before the dashboard opens. Advanced settings hold the
   map location; a new listing stays out of public search until it is set. */

const HEALTH_CATEGORIES = ['hospital', 'clinic'];

const loginView = document.getElementById('login-view');
const dashView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');

function flash(mount, message, kind = 'ok') {
  clear(mount).appendChild(
    el('div', { class: kind, role: kind === 'error' ? 'alert' : 'status', text: message })
  );
}

/* ---------- login ----------------------------------------------------- */
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('login-btn');
  button.disabled = true;
  clear(loginMessage);
  try {
    const body = await api(
      '/admin/login',
      {},
      {
        method: 'POST',
        auth: false,
        body: {
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
        },
      }
    );
    Auth.set(body.access_token);
    document.getElementById('password').value = '';
    await loadDashboard();
  } catch (err) {
    flash(loginMessage, err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function signOut() {
  Auth.clear();
  dashView.hidden = true;
  clear(dashView);
  loginView.hidden = false;
}

/* ---------- dashboard ------------------------------------------------- */
async function loadDashboard() {
  loginView.hidden = true;
  dashView.hidden = false;
  showLoading(dashView, 'Loading your dashboard…');
  try {
    const me = await api('/admin/me');
    if (me.must_change_password) {
      renderPasswordSetup(me);
      return;
    }
    const body = await api('/admin/dashboard');
    if (body.scope === 'facility') {
      renderFacilityDash(body.facility, body.stale_after_hours, body.location_confirmed);
    } else {
      renderProviderDash(body.provider, body.stale_after_hours, body.location_confirmed);
    }
  } catch (err) {
    signOut();
    flash(loginMessage, err.message, 'error');
  }
}

function dashHeader(title, subtitle) {
  return [
    el('div', { class: 'results-head' }, [
      el('h1', { style: 'margin:0', text: title }),
      el('button', { class: 'secondary', onclick: signOut }, 'Sign out'),
    ]),
    el('p', { class: 'lede', text: subtitle }),
  ];
}

function numberField(id, label, value, min, max) {
  return el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    el('input', {
      type: 'number', id, min, max, step: 'any', required: true,
      value: value !== null && value !== undefined ? value : '',
    }),
  ]);
}

/* ---------- password -------------------------------------------------- */
function passwordForm({ title, submitLabel, onDone }) {
  const message = el('div');
  const passwordField = (id, label, autocomplete, minlength) =>
    el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      el('input', { type: 'password', id, autocomplete, required: true, minlength, maxlength: '72' }),
    ]);

  const form = el('form', { class: 'card', style: 'max-width:420px' }, [
    el('h2', { style: 'margin-top:0', text: title }),
    passwordField('current_password', 'Current password', 'current-password', '8'),
    passwordField('new_password', 'New password (at least 12 characters)', 'new-password', '12'),
    passwordField('confirm_password', 'Confirm new password', 'new-password', '12'),
    message,
    el('button', { type: 'submit' }, submitLabel),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = document.getElementById('new_password').value;
    if (next !== document.getElementById('confirm_password').value) {
      flash(message, 'The new passwords do not match.', 'error');
      return;
    }
    try {
      await api('/admin/password', {}, {
        method: 'POST',
        body: { current_password: document.getElementById('current_password').value, new_password: next },
      });
      form.reset();
      onDone(message);
    } catch (err) {
      flash(message, err.message, 'error');
    }
  });
  return form;
}

function renderPasswordSetup(me) {
  const mount = clear(dashView);
  mount.append(...dashHeader('Choose your password', `Signed in as ${me.email}`));
  mount.appendChild(el('p', {
    class: 'notice',
    text: 'You signed in with the default password from your welcome email. Choose your own password to open your dashboard.',
  }));
  mount.appendChild(passwordForm({
    title: 'Set a new password',
    submitLabel: 'Save password and continue',
    onDone: () => loadDashboard(),
  }));
}

/* ---------- advanced settings ----------------------------------------- */
function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device cannot share its location. Enter the coordinates by hand.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: Number(position.coords.latitude.toFixed(6)),
        lng: Number(position.coords.longitude.toFixed(6)),
        accuracy: Math.round(position.coords.accuracy),
      }),
      () => reject(new Error('Could not get this device\'s location. Allow location access, or enter the coordinates by hand.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

function locationBanner(locationConfirmed) {
  if (locationConfirmed) return null;
  return el('div', { class: 'banner warn', role: 'note' }, [
    el('strong', { text: 'Set your map location' }),
    el('span', {
      text: 'Your listing is hidden from public search until you set its location in Advanced settings below.',
    }),
  ]);
}

function advancedSettings(record, locationConfirmed) {
  const message = el('div');
  const latField = numberField('location_lat', 'Latitude', locationConfirmed ? record.lat : '', '-90', '90');
  const lngField = numberField('location_lng', 'Longitude', locationConfirmed ? record.lng : '', '-180', '180');
  const lat = latField.querySelector('input');
  const lng = lngField.querySelector('input');
  const mapLink = el('a', { target: '_blank', rel: 'noopener' }, 'Check this point on a map');
  const syncMapLink = () => {
    mapLink.hidden = !lat.value || !lng.value;
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${lat.value},${lng.value}`;
  };
  lat.addEventListener('input', syncMapLink);
  lng.addEventListener('input', syncMapLink);
  syncMapLink();

  const locate = el('button', { type: 'button', class: 'secondary' }, 'Use this device\'s location');
  locate.addEventListener('click', async () => {
    locate.disabled = true;
    flash(message, 'Finding your location…');
    try {
      const coords = await deviceLocation();
      lat.value = coords.lat;
      lng.value = coords.lng;
      syncMapLink();
      flash(message, `Location found (accurate to about ${coords.accuracy} m). Check it on the map, then save.`);
    } catch (err) {
      flash(message, err.message, 'error');
    } finally {
      locate.disabled = false;
    }
  });

  const form = el('form', {}, [
    el('h3', { text: 'Map location' }),
    el('p', {
      class: 'notice',
      text: 'Stand at your entrance and use this device\'s location, or type the coordinates from Google Maps (right-click the spot and copy the numbers). This is the point people get directions to.',
    }),
    el('div', { class: 'row' }, [latField, lngField]),
    el('p', {}, [mapLink]),
    message,
    el('div', { class: 'actions' }, [locate, el('button', { type: 'submit' }, 'Save location')]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/admin/location', {}, {
        method: 'PUT',
        body: { lat: Number(lat.value), lng: Number(lng.value) },
      });
      await loadDashboard();
    } catch (err) {
      flash(message, err.message, 'error');
    }
  });

  return el('details', { class: 'filters', open: !locationConfirmed }, [
    el('summary', { text: 'Advanced settings' }),
    el('div', { class: 'body' }, [
      form,
      passwordForm({
        title: 'Change password',
        submitLabel: 'Change password',
        onDone: (mount) => flash(mount, 'Password changed.'),
      }),
    ]),
  ]);
}

/* ---------- facility scope -------------------------------------------- */
function renderFacilityDash(facility, staleHours, locationConfirmed) {
  const mount = clear(dashView);
  const subtitle = HEALTH_CATEGORIES.includes(facility.category)
    ? `${facility.classification} · ${facility.region}`
    : `${CATEGORY_LABEL[facility.category] || facility.category} · ${facility.region}`;
  mount.append(...dashHeader(facility.name, subtitle));
  const banner = locationBanner(locationConfirmed);
  if (banner) mount.appendChild(banner);

  if (HEALTH_CATEGORIES.includes(facility.category)) mount.appendChild(bedCard(facility, staleHours));
  mount.appendChild(servicesCard(facility));
  mount.appendChild(advancedSettings(facility, locationConfirmed));

  if (locationConfirmed) {
    mount.appendChild(
      el('p', {}, [el('a', { href: `facility.html?id=${facility.id}` }, 'View your public profile')])
    );
  }
}

function bedCard(facility, staleHours) {
  const bedMessage = el('div');
  const beds = facility.beds || {};

  const bedForm = el('form', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', text: 'Bed availability' }),
    statusLine(beds),
    el('p', {
      class: 'notice',
      text: `Bed counts expire after ${staleHours} hours and then show as "Not updated" to the public.`,
    }),
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'total_beds', text: 'Total beds' }),
        el('input', {
          type: 'number', id: 'total_beds', min: '0', max: '10000', required: true,
          value: beds.total_beds !== null && beds.total_beds !== undefined ? beds.total_beds : '',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'available_beds', text: 'Beds free now' }),
        el('input', {
          type: 'number', id: 'available_beds', min: '0', max: '10000', required: true,
          value: beds.available_beds !== null && beds.available_beds !== undefined ? beds.available_beds : '',
        }),
      ]),
    ]),
    bedMessage,
    el('button', { type: 'submit' }, 'Update beds'),
  ]);

  bedForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const total = Number(document.getElementById('total_beds').value);
    const available = Number(document.getElementById('available_beds').value);
    if (available > total) {
      flash(bedMessage, 'Beds free cannot be more than total beds.', 'error');
      return;
    }
    try {
      const result = await api(
        `/facilities/${facility.id}/beds`,
        {},
        { method: 'PUT', body: { total_beds: total, available_beds: available } }
      );
      flash(bedMessage, `Saved. Public profile now shows: ${result.beds.display}`);
    } catch (err) {
      flash(bedMessage, err.message, 'error');
    }
  });
  return bedForm;
}

function servicesCard(facility) {
  const svcMessage = el('div');
  const rows = facility.service_detail.map((service) =>
    el('label', {}, [
      el('input', {
        type: 'checkbox',
        'data-service': service.service_name,
        checked: service.is_active,
      }),
      service.service_name,
    ])
  );

  const svcForm = el('form', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', text: 'Services' }),
    el('p', {
      class: 'notice',
      text: 'Untick a service that is temporarily unavailable. Unticked services stop appearing in public search results.',
    }),
    rows.length
      ? el('div', { class: 'checks' }, rows)
      : el('p', { class: 'notice', text: 'No services recorded for this facility.' }),
    svcMessage,
    el('button', { type: 'submit' }, 'Save services'),
  ]);

  svcForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const services = Array.from(svcForm.querySelectorAll('input[data-service]')).map((input) => ({
      service_name: input.getAttribute('data-service'),
      is_active: input.checked,
    }));
    try {
      await api(`/facilities/${facility.id}/services`, {}, { method: 'PUT', body: { services } });
      flash(svcMessage, 'Services saved.');
    } catch (err) {
      flash(svcMessage, err.message, 'error');
    }
  });
  return svcForm;
}

/* ---------- provider scope -------------------------------------------- */
function renderProviderDash(provider, staleHours, locationConfirmed) {
  const mount = clear(dashView);
  mount.append(
    ...dashHeader(provider.name, `${provider.service_level} · ${provider.region}`)
  );
  const banner = locationBanner(locationConfirmed);
  if (banner) mount.appendChild(banner);

  const message = el('div');
  const status = provider.status || {};

  const form = el('form', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', text: 'Fleet status' }),
    statusLine(status),
    el('p', {
      class: 'notice',
      text: `Fleet status expires after ${staleHours} hours and then shows as "Not updated" to the public. Keeping it current is what puts you in front of people in an emergency.`,
    }),
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'total_units', text: 'Total ambulances' }),
        el('input', {
          type: 'number', id: 'total_units', min: '0', max: '1000', required: true,
          value: status.total_units !== null && status.total_units !== undefined ? status.total_units : '',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'units_available', text: 'Available now' }),
        el('input', {
          type: 'number', id: 'units_available', min: '0', max: '1000', required: true,
          value: status.units_available !== null && status.units_available !== undefined ? status.units_available : '',
        }),
      ]),
    ]),
    message,
    el('button', { type: 'submit' }, 'Update fleet status'),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const total = Number(document.getElementById('total_units').value);
    const available = Number(document.getElementById('units_available').value);
    if (available > total) {
      flash(message, 'Available units cannot be more than total units.', 'error');
      return;
    }
    try {
      const result = await api(
        `/ambulance/providers/${provider.id}/status`,
        {},
        { method: 'PUT', body: { total_units: total, units_available: available } }
      );
      flash(message, `Saved. Public listing now shows: ${result.status.display}`);
    } catch (err) {
      flash(message, err.message, 'error');
    }
  });
  mount.appendChild(form);

  mount.appendChild(
    el('section', { class: 'card' }, [
      el('h2', { style: 'margin-top:0', text: 'Dispatch number' }),
      el('p', { text: provider.phone }),
      el('p', {
        class: 'notice',
        text: provider.phone_verified_at
          ? `Last verified by call ${fmtWhen(provider.phone_verified_at)}. Numbers are re-verified every 90 days.`
          : 'This number has not yet been verified by a call. Until it is, your listing is flagged as unverified to the public.',
      }),
    ])
  );

  mount.appendChild(advancedSettings(provider, locationConfirmed));

  if (locationConfirmed) {
    mount.appendChild(
      el('p', {}, [el('a', { href: `ambulance.html?id=${provider.id}` }, 'View your public listing')])
    );
  }
}

/* ---------- init ------------------------------------------------------ */
if (Auth.token()) loadDashboard();
