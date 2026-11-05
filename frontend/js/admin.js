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
  setLoading(button, true, 'Signing in…');
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
    setLoading(button, false);
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
      const careTypes = await api('/care-types');
      renderFacilityDash(body.facility, body.stale_after_hours, body.location_confirmed, careTypes);
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
function renderFacilityDash(facility, staleHours, locationConfirmed, careTypes) {
  const mount = clear(dashView);
  const subtitle = HEALTH_CATEGORIES.includes(facility.category)
    ? `${facility.classification} · ${facility.region}`
    : `${CATEGORY_LABEL[facility.category] || facility.category} · ${facility.region}`;
  mount.append(...dashHeader(facility.name, subtitle));
  const banner = locationBanner(locationConfirmed);
  if (banner) mount.appendChild(banner);

  if (facility.busy) mount.appendChild(busyNowCard(facility));
  if (HEALTH_CATEGORIES.includes(facility.category)) mount.appendChild(bedCard(facility, staleHours));
  mount.appendChild(offeringsCard(facility, careTypes));
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

/* ---------- how busy are you? ------------------------------------------ */
const BUSY_LEVELS = [
  { level: 'busy', label: 'Busy', hint: 'Long queues, long waits' },
  { level: 'less_busy', label: 'Less busy', hint: 'Some waiting' },
  { level: 'not_busy', label: 'Not busy', hint: 'Little or no wait' },
];

function busyNowCard(facility) {
  const current = el('div', {}, [busyBadge(facility.busy)]);
  const message = el('div');
  const buttons = BUSY_LEVELS.map((choice) => {
    const button = el('button', { type: 'button', class: `busy-choice busy-${choice.level}` }, [
      el('span', { class: 'busy-dot', 'aria-hidden': 'true' }),
      el('span', {}, [el('strong', { text: choice.label }), el('small', { text: choice.hint })]),
    ]);
    button.addEventListener('click', async () => {
      buttons.forEach((b) => { b.disabled = true; });
      setLoading(button, true, 'Saving…');
      try {
        const busy = await api(`/facilities/${facility.id}/busy`, {}, {
          method: 'PUT',
          body: { level: choice.level },
        });
        clear(current).appendChild(busyBadge(busy));
        flash(message, `Saved. The public now sees "${busy.label}" for the next 3 hours.`);
        toast('Busy status updated');
      } catch (err) {
        flash(message, err.message, 'error');
      } finally {
        setLoading(button, false);
        buttons.forEach((b) => { b.disabled = false; });
      }
    });
    return button;
  });

  return el('section', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', text: 'How busy are you right now?' }),
    current,
    el('p', {
      class: 'notice',
      text: 'Your answer is shown to the public in red, yellow or green for 3 hours, ahead of visitor reports and predictions. Update it when things change.',
    }),
    el('div', { class: 'busy-choices' }, buttons),
    message,
  ]);
}

/* ---------- what you offer --------------------------------------------
   The kinds of care the facility provides (a hospital can also run a
   laboratory and a pharmacy), chosen from a dropdown, with the services
   listed under each. Saving replaces the whole list. */
function offeringsCard(facility, careTypes) {
  const typeInfo = new Map(careTypes.map((t) => [t.value, t]));
  const main = facility.category;
  // Services by lower-case name: { name, careType, active }
  const offered = new Map();
  facility.service_detail.forEach((s) => {
    offered.set(s.service_name.toLowerCase(), {
      name: s.service_name,
      careType: typeInfo.has(s.care_type) ? s.care_type : main,
      active: s.is_active,
    });
  });
  const selected = new Set([main, ...Array.from(offered.values(), (s) => s.careType)]);

  const labelOf = (type) => (typeInfo.get(type) || { label: type }).label;
  const servicesOf = (type) => Array.from(offered.values()).filter((s) => s.careType === type);

  /* the dropdown */
  const summary = el('span', { class: 'ms-summary' });
  const toggle = el('button', {
    type: 'button',
    class: 'ms-toggle',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-controls': 'care-type-panel',
  }, [summary]);
  const panel = el('div', { class: 'ms-panel', id: 'care-type-panel', hidden: true }, careTypes.map((t) =>
    el('label', { class: 'ms-option' }, [
      el('input', {
        type: 'checkbox',
        value: t.value,
        checked: selected.has(t.value),
        disabled: t.value === main,
      }),
      el('span', { text: t.label }),
      t.value === main ? el('small', { text: 'your main listing' }) : null,
    ])
  ));
  const dropdown = el('div', { class: 'multiselect' }, [toggle, panel]);

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) setOpen(false);
  });
  dropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    }
  });
  panel.addEventListener('change', (event) => {
    const type = event.target.value;
    if (event.target.checked) {
      selected.add(type);
    } else {
      const count = servicesOf(type).length;
      if (count && !window.confirm(`Remove ${labelOf(type)} and its ${count} service${count === 1 ? '' : 's'}?`)) {
        event.target.checked = true;
        return;
      }
      servicesOf(type).forEach((s) => offered.delete(s.name.toLowerCase()));
      selected.delete(type);
    }
    render();
  });

  /* one section per selected kind of care */
  const sections = el('div', { class: 'care-sections' });

  function addService(type, rawName, input, error) {
    const name = rawName.replace(/\s+/g, ' ').trim();
    if (!name) return;
    const existing = offered.get(name.toLowerCase());
    if (existing) {
      error.hidden = false;
      error.textContent = existing.careType === type
        ? `${existing.name} is already on the list.`
        : `${existing.name} is already listed under ${labelOf(existing.careType)}.`;
      return;
    }
    offered.set(name.toLowerCase(), { name, careType: type, active: true });
    render();
    const again = sections.querySelector(`[data-care-type="${type}"] .add-row input`);
    if (again && input) again.focus();
  }

  function section(type) {
    const info = typeInfo.get(type) || { label: type, services: [] };
    const mine = servicesOf(type).sort((a, b) => a.name.localeCompare(b.name));
    const error = el('p', { class: 'field-error', hidden: true });

    const list = mine.length
      ? el('ul', { class: 'svc-list' }, mine.map((s) => {
        const switchId = `svc-${type}-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const available = el('input', { type: 'checkbox', id: switchId, checked: s.active });
        available.addEventListener('change', () => { s.active = available.checked; });
        const remove = el('button', {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Remove ${s.name}`,
          title: 'Remove',
        }, '×');
        remove.addEventListener('click', () => {
          offered.delete(s.name.toLowerCase());
          render();
        });
        return el('li', {}, [
          el('span', { class: 'svc-name', text: s.name }),
          el('label', { class: 'svc-available', for: switchId }, [available, 'Available now']),
          remove,
        ]);
      }))
      : el('p', { class: 'notice', text: `No ${info.label.toLowerCase()} services yet. Add them below.` });

    const suggestions = info.services.filter((name) => !offered.has(name.toLowerCase()));
    const input = el('input', {
      type: 'text',
      maxlength: '80',
      placeholder: `Add another ${info.label.toLowerCase()} service`,
      'aria-label': `Add another ${info.label.toLowerCase()} service`,
    });
    const add = el('button', { type: 'button', class: 'secondary' }, 'Add');
    add.addEventListener('click', () => addService(type, input.value, input, error));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addService(type, input.value, input, error);
      }
    });
    input.addEventListener('input', () => { error.hidden = true; });

    return el('fieldset', { class: 'care-section', 'data-care-type': type }, [
      el('legend', { text: info.label + (type === main ? ' (main)' : '') }),
      list,
      suggestions.length ? el('p', { class: 'sub', text: `Common ${info.label.toLowerCase()} services. Tap to add:` }) : null,
      suggestions.length
        ? el('div', { class: 'add-chips' }, suggestions.map((name) =>
          el('button', { type: 'button', class: 'chip-add', onclick: () => addService(type, name, null, error) }, `+ ${name}`)
        ))
        : null,
      el('div', { class: 'add-row' }, [input, add]),
      error,
    ]);
  }

  function render() {
    const order = careTypes.map((t) => t.value).filter((t) => selected.has(t));
    summary.textContent = order.map(labelOf).join(', ');
    clear(sections).append(...order.map(section));
  }
  render();

  const message = el('div');
  const save = el('button', { type: 'submit' }, 'Save what you offer');
  const form = el('form', { class: 'card offerings' }, [
    el('h2', { style: 'margin-top:0', text: 'What you offer' }),
    el('p', {
      class: 'notice',
      text: 'Choose every kind of care you provide, then list the services under each. A hospital with its own laboratory chooses Hospital and Laboratory. Untick "Available now" when a service is paused for a while.',
    }),
    el('div', { class: 'field' }, [
      el('p', { class: 'field-label', id: 'care-type-label', text: 'Kinds of care' }),
      dropdown,
    ]),
    sections,
    message,
    save,
  ]);
  toggle.setAttribute('aria-labelledby', 'care-type-label');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const empty = Array.from(selected).filter((t) => t !== main && !servicesOf(t).length);
    if (empty.length) {
      flash(message, `Add at least one service under ${empty.map(labelOf).join(' and ')}, or untick it in Kinds of care.`, 'error');
      return;
    }
    const services = Array.from(offered.values(), (s) => ({
      service_name: s.name,
      care_type: s.careType,
      is_active: s.active,
    }));
    setLoading(save, true, 'Saving…');
    try {
      const result = await api(`/facilities/${facility.id}/offerings`, {}, {
        method: 'PUT',
        body: { services },
      });
      const kinds = result.care_types.map(labelOf).join(', ');
      flash(message, `Saved. Your public profile lists ${result.services.length} services under ${kinds}.`);
      toast('Services saved');
    } catch (err) {
      flash(message, err.message, 'error');
    } finally {
      setLoading(save, false);
    }
  });
  return form;
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
