/* Admin dashboard v1 (PRD 5.2.1, pulled into Phase 1).

   Facility admins update beds and service availability.
   Ambulance provider admins update fleet status. */

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
    const body = await api('/admin/dashboard');
    if (body.scope === 'facility') renderFacilityDash(body.facility, body.stale_after_hours);
    else renderProviderDash(body.provider, body.stale_after_hours);
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

/* ---------- facility scope -------------------------------------------- */
function renderFacilityDash(facility, staleHours) {
  const mount = clear(dashView);
  mount.append(...dashHeader(facility.name, `${facility.classification} · ${facility.region}`));

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
  mount.appendChild(bedForm);

  /* services */
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
  mount.appendChild(svcForm);

  mount.appendChild(
    el('p', {}, [el('a', { href: `facility.html?id=${facility.id}` }, 'View your public profile')])
  );
}

/* ---------- provider scope -------------------------------------------- */
function renderProviderDash(provider, staleHours) {
  const mount = clear(dashView);
  mount.append(
    ...dashHeader(provider.name, `${provider.service_level} · ${provider.region}`)
  );

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

  mount.appendChild(
    el('p', {}, [el('a', { href: `ambulance.html?id=${provider.id}` }, 'View your public listing')])
  );
}

/* ---------- init ------------------------------------------------------ */
if (Auth.token()) loadDashboard();
