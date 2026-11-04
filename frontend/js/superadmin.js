const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginMessage = document.getElementById('login-message');
const SUPERADMIN_KEY = 'mf.superadmin.token';
const HEALTH_CATEGORIES = ['hospital', 'clinic'];

/* Reference lists for the forms, loaded once per sign-in. */
const reference = { regions: [], classifications: [], organizationTypes: [], categories: [] };

const SuperAuth = {
  token() {
    try {
      return sessionStorage.getItem(SUPERADMIN_KEY);
    } catch (err) {
      return null;
    }
  },
  set(token) {
    sessionStorage.setItem(SUPERADMIN_KEY, token);
  },
  clear() {
    sessionStorage.removeItem(SUPERADMIN_KEY);
  },
};

function showMessage(mount, text, isError = false) {
  clear(mount).appendChild(el('div', {
    class: isError ? 'error' : 'ok',
    role: isError ? 'alert' : 'status',
    text,
  }));
}

function cell(value) {
  return el('td', { text: value === null || value === undefined ? '—' : String(value) });
}

function makeTable(headers, rows) {
  if (!rows.length) return el('p', { class: 'notice', text: 'Nothing to show yet.' });
  const table = el('table', { class: 'admin-table' });
  const head = el('thead');
  const headerRow = el('tr');
  for (const header of headers) headerRow.appendChild(el('th', { scope: 'col', text: header }));
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const value of row) tr.appendChild(typeof value === 'string' || typeof value === 'number' ? cell(value) : el('td', {}, value));
    body.appendChild(tr);
  }
  table.appendChild(body);
  return el('div', { class: 'table-scroll' }, table);
}

function addSection(mount, title, content) {
  mount.appendChild(el('section', { class: 'admin-section' }, [
    el('h2', { text: title }),
    content,
  ]));
}

function when(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function editorField(name, label, value, type = 'text', options = {}) {
  const control = el('input', {
    id: `${options.prefix || 'edit'}-${name}`,
    name,
    type,
    value: type === 'checkbox' ? undefined : value ?? '',
    checked: type === 'checkbox' ? Boolean(value) : undefined,
    required: options.required || undefined,
    min: options.min,
    max: options.max,
    step: options.step,
    ...(options.maxlength ? { maxlength: options.maxlength } : {}),
  });
  return el('div', { class: 'field' }, [
    el('label', { for: control.id, text: label }),
    control,
  ]);
}

/* Choices are plain strings, or { value, label } when they differ. */
function editorSelect(name, label, value, choices, prefix, { required = true } = {}) {
  const control = el('select', {
    id: `${prefix}-${name}`,
    name,
    required,
  }, choices.map((choice) => {
    const option = typeof choice === 'string' ? { value: choice, label: choice } : choice;
    return el('option', {
      value: option.value,
      selected: option.value === value,
      text: option.label,
    });
  }));
  return el('div', { class: 'field' }, [
    el('label', { for: control.id, text: label }),
    control,
  ]);
}

function editorText(name, label, value, prefix) {
  return el('div', { class: 'field' }, [
    el('label', { for: `${prefix}-${name}`, text: label }),
    el('textarea', {
      id: `${prefix}-${name}`,
      name,
      rows: '3',
      text: value || '',
    }),
  ]);
}

function formValues(form) {
  const values = {};
  for (const control of form.elements) {
    if (!control.name) continue;
    values[control.name] = control.type === 'checkbox' ? control.checked : control.value;
  }
  return values;
}

function facilityEditor(facility) {
  const prefix = `facility-${facility.id}`;
  const services = facility.service_detail
    .map((item) => `${item.service_name}=${item.is_active}`)
    .join(', ');
  const form = el('form', { class: 'card editor-form' }, [
    el('h3', { text: `Edit ${facility.name}` }),
    editorField('name', 'Name', facility.name, 'text', { prefix, required: true, maxlength: 200 }),
    el('div', { class: 'row' }, [
      editorSelect('category', 'Category', facility.category, reference.categories, prefix),
      editorSelect('type', 'Ownership', facility.type, ['government', 'private'], prefix),
    ]),
    el('div', { class: 'row' }, [
      editorField('classification', 'Classification', facility.classification, 'text', { prefix, required: true }),
      editorField('region', 'Region', facility.region, 'text', { prefix, required: true }),
    ]),
    el('div', { class: 'row' }, [
      editorField('city', 'City', facility.city, 'text', { prefix }),
      editorField('town', 'Town', facility.town, 'text', { prefix }),
    ]),
    editorField('address', 'Address', facility.address, 'text', { prefix }),
    el('div', { class: 'row' }, [
      editorField('lat', 'Latitude', facility.lat, 'number', { prefix, required: true, min: -90, max: 90, step: 'any' }),
      editorField('lng', 'Longitude', facility.lng, 'number', { prefix, required: true, min: -180, max: 180, step: 'any' }),
    ]),
    el('div', { class: 'row' }, [
      editorField('phone', 'Phone', facility.phone, 'text', { prefix }),
      editorField('hours', 'Hours', facility.hours, 'text', { prefix }),
    ]),
    el('div', { class: 'row' }, [
      editorField('has_ambulance', 'Has ambulance', facility.has_ambulance, 'checkbox', { prefix }),
      editorField('ambulance_phone', 'Ambulance phone', facility.ambulance_phone, 'text', { prefix }),
      editorField('ambulance_provider_id', 'Linked provider ID', facility.ambulance_provider_id, 'number', { prefix, min: 1 }),
    ]),
    el('div', { class: 'row' }, [
      editorField('is_24_hour', 'Open 24 hours', facility.is_24_hour, 'checkbox', { prefix }),
      editorField('verified', 'Verified (only after checking)', facility.verified, 'checkbox', { prefix }),
    ]),
    editorText('services', 'Services as Name=true/false, separated by commas', services, prefix),
    editorText('insurance', 'Accepted insurance, separated by commas', facility.insurance.join(', '), prefix),
    el('div', { class: 'row' }, [
      editorField('total_beds', 'Total beds (blank clears beds)', facility.admin_beds?.total_beds, 'number', { prefix, min: 0, max: 10000 }),
      editorField('available_beds', 'Available beds', facility.admin_beds?.available_beds, 'number', { prefix, min: 0, max: 10000 }),
    ]),
    el('button', { type: 'submit' }, 'Save facility'),
  ]);
  form.addEventListener('submit', (event) => saveFacility(event, form, facility.id));
  return el('details', {}, [
    el('summary', { text: 'Edit facility details' }),
    form,
  ]);
}

function providerEditor(provider) {
  const prefix = `provider-${provider.id}`;
  const coverage = provider.coverage
    .map((item) => `${item.region}|${item.district}`)
    .join(', ');
  const form = el('form', { class: 'card editor-form' }, [
    el('h3', { text: `Edit ${provider.name}` }),
    editorField('name', 'Name', provider.name, 'text', { prefix, required: true, maxlength: 200 }),
    el('div', { class: 'row' }, [
      editorSelect('operator_type', 'Operator type', provider.operator_type, ['government', 'private', 'facility_attached'], prefix),
      editorSelect('service_level', 'Service level', provider.service_level, ['BLS', 'ALS'], prefix),
    ]),
    editorField('base_address', 'Base address', provider.base_address, 'text', { prefix }),
    el('div', { class: 'row' }, [
      editorField('region', 'Region', provider.region, 'text', { prefix, required: true }),
      editorField('district', 'District', provider.district, 'text', { prefix }),
    ]),
    el('div', { class: 'row' }, [
      editorField('lat', 'Latitude', provider.lat, 'number', { prefix, required: true, min: -90, max: 90, step: 'any' }),
      editorField('lng', 'Longitude', provider.lng, 'number', { prefix, required: true, min: -180, max: 180, step: 'any' }),
    ]),
    el('div', { class: 'row' }, [
      editorField('phone', 'Phone', provider.phone, 'text', { prefix, required: true }),
      editorField('alt_phone', 'Alternate phone', provider.alt_phone, 'text', { prefix }),
    ]),
    el('div', { class: 'row' }, [
      editorField('hours', 'Hours', provider.hours, 'text', { prefix }),
      editorField('cost_band', 'Cost band', provider.cost_band, 'text', { prefix }),
    ]),
    el('div', { class: 'row' }, [
      editorField('is_24_hour', 'Open 24 hours', provider.is_24_hour, 'checkbox', { prefix }),
      editorField('verified', 'Verified (only after checking)', provider.verified, 'checkbox', { prefix }),
      editorField('phone_verified', 'Phone was call-verified', Boolean(provider.phone_verified_at), 'checkbox', { prefix }),
    ]),
    editorText('coverage', 'Coverage as Region|District, separated by commas', coverage, prefix),
    el('div', { class: 'row' }, [
      editorField('total_units', 'Total units (blank clears status)', provider.admin_status?.total_units, 'number', { prefix, min: 0, max: 1000 }),
      editorField('units_available', 'Available units', provider.admin_status?.units_available, 'number', { prefix, min: 0, max: 1000 }),
    ]),
    el('button', { type: 'submit' }, 'Save provider'),
  ]);
  form.addEventListener('submit', (event) => saveProvider(event, form, provider.id));
  return el('details', {}, [
    el('summary', { text: 'Edit provider details' }),
    form,
  ]);
}

function typeLabel(value) {
  const match = reference.organizationTypes.find((item) => item.value === value);
  return match ? match.label : value;
}

/* Creates a listing and its admin login. With a contact request it is
   prefilled from it, and saving also approves the request. */
function organizationForm(request) {
  const prefix = request ? `request-${request.id}` : 'new-organization';
  const typeField = editorSelect(
    'organization_type', 'Type', request ? request.organization_type : '',
    [{ value: '', label: 'Choose a type' }, ...reference.organizationTypes], prefix
  );
  const ownershipField = editorSelect(
    'ownership', 'Ownership', 'private', ['private', 'government'], prefix
  );
  const classificationField = editorSelect(
    'classification', 'Classification', '',
    [{ value: '', label: 'Choose a level' },
     ...reference.classifications.map((item) => ({ value: item.level, label: `${item.level} — ${item.name}` }))],
    prefix, { required: false }
  );
  const typeControl = typeField.querySelector('select');
  const classificationControl = classificationField.querySelector('select');

  /* Hospitals take their ownership from the type; only hospitals and
     clinics are on the GHS classification scale. */
  function syncTypeFields() {
    const type = reference.organizationTypes.find((item) => item.value === typeControl.value);
    const category = type ? type.category : null;
    ownershipField.hidden = !type || category === 'hospital';
    classificationField.hidden = !HEALTH_CATEGORIES.includes(category);
    classificationControl.required = !classificationField.hidden;
  }
  typeControl.addEventListener('change', syncTypeFields);
  syncTypeFields();

  const form = el('form', { class: 'card editor-form' }, [
    el('h3', { text: request ? `Create login for ${request.facility_name}` : 'New organization' }),
    typeField,
    editorField('name', 'Name', request?.facility_name, 'text', { prefix, required: true, maxlength: 200 }),
    el('div', { class: 'row' }, [
      editorField('email', 'Login email', request?.email, 'email', { prefix, required: true, maxlength: 160 }),
      editorField('phone', 'Phone', request?.phone, 'text', { prefix, required: true, maxlength: 40 }),
    ]),
    editorField('full_name', 'Contact person', request?.contact_name, 'text', { prefix, maxlength: 120 }),
    el('div', { class: 'row' }, [ownershipField, classificationField]),
    el('div', { class: 'row' }, [
      editorSelect('region', 'Region', '', [{ value: '', label: 'Choose a region' }, ...reference.regions], prefix),
      editorField('city', 'City, town or district', '', 'text', { prefix, maxlength: 80 }),
    ]),
    editorField('address', 'Address', '', 'text', { prefix, maxlength: 300 }),
    el('div', { class: 'row' }, [
      editorField('lat', 'Latitude (optional)', '', 'number', { prefix, min: -90, max: 90, step: 'any' }),
      editorField('lng', 'Longitude (optional)', '', 'number', { prefix, min: -180, max: 180, step: 'any' }),
    ]),
    el('p', {
      class: 'notice',
      text: 'Leave the coordinates blank to let the organization set its own location after signing in. The listing stays out of public search until a location is set.',
    }),
    el('button', { type: 'submit' }, 'Create login'),
  ]);
  form.addEventListener('submit', (event) => createOrganization(event, form, request));
  return form;
}

/* One-time result of creating an account or resetting a lost password. The
   app sends no email: the superadmin emails this message to the
   organization, from their email app or by copying it. */
function credentialsNotice(result, organizationName) {
  const { subject, body } = result.message;
  const status = el('span', { role: 'status' });
  const copy = el('button', { type: 'button', class: 'secondary' }, 'Copy message');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      status.textContent = ' Copied.';
    } catch (err) {
      messageBox.select();
      status.textContent = ' Select the text above and copy it.';
    }
  });
  const messageBox = el('textarea', { rows: '12', readonly: true, 'aria-label': 'Login message', text: body });

  return el('div', { class: 'ok', role: 'status' }, [
    el('strong', { text: `Now email ${organizationName} their login details. ` }),
    'This is the only time the default password is shown. They choose their own password when they first sign in. ',
    'Default password: ',
    el('code', { class: 'secret', text: result.temporary_password }),
    el('p', { style: 'margin:8px 0 4px', text: `To: ${result.email} · Subject: ${subject}` }),
    messageBox,
    el('div', { class: 'actions' }, [
      el('a', {
        class: 'btn',
        href: `mailto:${encodeURIComponent(result.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      }, 'Open in email app'),
      copy,
    ]),
    status,
  ]);
}

function renderOverview(data, notice) {
  const mount = clear(dashboardView);
  mount.appendChild(el('div', { class: 'results-head' }, [
    el('h1', { style: 'margin:0', text: 'System management' }),
    el('button', { class: 'secondary', onclick: signOut }, 'Sign out'),
  ]));
  mount.appendChild(el('p', { class: 'lede', text: 'Review contact requests, create organization logins, inspect all directory records, and audit changes made by organization administrators.' }));
  if (notice) mount.appendChild(notice);

  const requestRows = data.contact_requests.map((request) => [
    request.id,
    request.facility_name,
    typeLabel(request.organization_type),
    request.contact_name || '—',
    request.email,
    request.phone,
    request.message || '—',
    when(request.created_at),
    el('div', { class: 'admin-actions' }, [
      el('details', {}, [
        el('summary', { text: 'Approve and create login' }),
        organizationForm(request),
      ]),
      el('button', {
        type: 'button',
        class: 'secondary',
        onclick: () => rejectContactRequest(request),
        text: 'Reject',
      }),
    ]),
  ]);
  addSection(mount, `Contact requests (${data.contact_requests.length})`,
    makeTable(['ID', 'Organization', 'Type', 'Contact', 'Email', 'Phone', 'Message', 'Submitted', 'Decision'], requestRows));

  addSection(mount, 'Add an organization', el('details', { class: 'admin-actions' }, [
    el('summary', { text: 'Create a listing and login without a contact request' }),
    organizationForm(null),
  ]));

  const adminRows = data.admins.map((admin) => [
    admin.id, admin.full_name, admin.email, admin.scope, admin.organization_name,
    admin.must_change_password ? 'Awaiting first sign-in' : 'Active',
    when(admin.created_at),
    el('div', { class: 'actions' }, [
      el('button', {
        type: 'button',
        class: 'secondary',
        onclick: () => resetAdminPassword(admin),
        text: 'Reset password',
      }),
      el('button', {
        type: 'button',
        class: 'secondary',
        onclick: () => revokeAdmin(admin),
        text: 'Revoke access',
      }),
    ]),
  ]);
  addSection(mount, `Organization admins (${data.admins.length})`,
    makeTable(['ID', 'Name', 'Email', 'Type', 'Organization', 'Status', 'Created', 'Action'], adminRows));

  const facilityRows = data.facilities.map((facility) => [
    facility.id, facility.name, facility.category, facility.type, facility.classification,
    `${facility.city || facility.town}, ${facility.region}`,
    facility.location_confirmed ? 'Set' : 'Not set (hidden)',
    facility.services.join(', '),
    facility.beds ? facility.beds.display : 'No bed report',
    facility.verified ? 'Yes' : 'No',
    el('div', { class: 'admin-actions' }, [
      facilityEditor(facility),
      el('button', {
        type: 'button',
        class: 'danger',
        onclick: () => deleteDirectoryRecord('facilities', facility),
        text: 'Delete',
      }),
    ]),
  ]);
  addSection(mount, `Facilities (${data.facilities.length})`,
    makeTable(['ID', 'Facility', 'Category', 'Ownership', 'Level', 'Place', 'Map location', 'Services', 'Beds', 'Verified', 'Manage'], facilityRows));

  const providerRows = data.providers.map((provider) => [
    provider.id, provider.name, provider.operator_type, provider.service_level,
    `${provider.district}, ${provider.region}`,
    provider.location_confirmed ? 'Set' : 'Not set (hidden)',
    provider.phone,
    provider.status ? provider.status.display : 'Not updated',
    provider.verified ? 'Yes' : 'No',
    el('div', { class: 'admin-actions' }, [
      providerEditor(provider),
      el('button', {
        type: 'button',
        class: 'danger',
        onclick: () => deleteDirectoryRecord('providers', provider),
        text: 'Delete',
      }),
    ]),
  ]);
  addSection(mount, `Ambulance providers (${data.providers.length})`,
    makeTable(['ID', 'Provider', 'Operator', 'Level', 'Place', 'Map location', 'Phone', 'Fleet', 'Verified', 'Manage'], providerRows));

  const changeRows = data.changes.map((change) => [
    when(change.created_at),
    change.admin_email,
    `${change.organization_type}: ${change.organization_name}`,
    change.action,
    JSON.stringify(change.changes),
  ]);
  addSection(mount, `Recent admin changes (${data.changes.length}; latest 200)`,
    makeTable(['When', 'Admin', 'Organization', 'Update', 'Before → after'], changeRows));
}

function parseCsv(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function saveFacility(event, form, facilityId) {
  event.preventDefault();
  const values = formValues(form);
  try {
    const services = parseCsv(values.services).map((entry) => {
      const separator = entry.lastIndexOf('=');
      if (separator < 1 || !['true', 'false'].includes(entry.slice(separator + 1).trim().toLowerCase())) {
        throw new Error('Services must use Name=true or Name=false format.');
      }
      return {
        service_name: entry.slice(0, separator).trim(),
        is_active: entry.slice(separator + 1).trim().toLowerCase() === 'true',
      };
    });
    const totalBeds = values.total_beds === '' ? null : Number(values.total_beds);
    const availableBeds = values.available_beds === '' ? null : Number(values.available_beds);
    await api(`/superadmin/facilities/${facilityId}`, {}, {
      method: 'PUT',
      token: SuperAuth.token(),
      body: {
        ...values,
        lat: Number(values.lat),
        lng: Number(values.lng),
        ambulance_provider_id: values.ambulance_provider_id === '' ? null : Number(values.ambulance_provider_id),
        services,
        insurance: parseCsv(values.insurance),
        total_beds: totalBeds,
        available_beds: availableBeds,
      },
    });
    await loadOverview();
  } catch (err) {
    const oldError = form.querySelector('.editor-error');
    if (oldError) oldError.remove();
    form.prepend(el('div', { class: 'error editor-error', role: 'alert', text: err.message }));
  }
}

async function saveProvider(event, form, providerId) {
  event.preventDefault();
  const values = formValues(form);
  try {
    const coverage = parseCsv(values.coverage).map((entry) => {
      const [region, ...district] = entry.split('|');
      return { region: region.trim(), district: district.join('|').trim() };
    });
    const totalUnits = values.total_units === '' ? null : Number(values.total_units);
    const availableUnits = values.units_available === '' ? null : Number(values.units_available);
    await api(`/superadmin/providers/${providerId}`, {}, {
      method: 'PUT',
      token: SuperAuth.token(),
      body: {
        ...values,
        lat: Number(values.lat),
        lng: Number(values.lng),
        coverage,
        total_units: totalUnits,
        units_available: availableUnits,
      },
    });
    await loadOverview();
  } catch (err) {
    const oldError = form.querySelector('.editor-error');
    if (oldError) oldError.remove();
    form.prepend(el('div', { class: 'error editor-error', role: 'alert', text: err.message }));
  }
}

async function deleteDirectoryRecord(collection, record) {
  const kind = collection === 'facilities' ? 'facility' : 'ambulance provider';
  if (!window.confirm(`Permanently delete ${kind} "${record.name}" and its related records?`)) return;
  try {
    await api(`/superadmin/${collection}/${record.id}`, {}, {
      method: 'DELETE',
      token: SuperAuth.token(),
    });
    await loadOverview();
  } catch (err) {
    showMessage(dashboardView, err.message, true);
  }
}

async function loadReference() {
  if (reference.regions.length) return;
  const [regions, classifications, enums] = await Promise.all([
    api('/regions', {}, { auth: false }),
    api('/classifications', {}, { auth: false }),
    api('/enums', {}, { auth: false }),
  ]);
  reference.regions = regions;
  reference.classifications = classifications;
  reference.organizationTypes = enums.organization_types;
  reference.categories = enums.facility_categories;
}

async function loadOverview(notice) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  dashboardView.innerHTML = '<p class="loading">Loading management data…</p>';
  try {
    await loadReference();
    const data = await api('/superadmin/overview', {}, { token: SuperAuth.token() });
    renderOverview(data, notice);
  } catch (err) {
    signOut();
    showMessage(loginMessage, err.message, true);
  }
}

async function createOrganization(event, form, request) {
  event.preventDefault();
  const values = formValues(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/superadmin/organizations', {}, {
      method: 'POST',
      token: SuperAuth.token(),
      body: {
        ...values,
        contact_request_id: request ? request.id : null,
        ownership: values.ownership || null,
        lat: values.lat === '' ? null : Number(values.lat),
        lng: values.lng === '' ? null : Number(values.lng),
      },
    });
    await loadOverview(credentialsNotice(result, result.organization_name));
  } catch (err) {
    const oldError = form.querySelector('.editor-error');
    if (oldError) oldError.remove();
    form.prepend(el('div', { class: 'error editor-error', role: 'alert', text: err.message }));
    button.disabled = false;
  }
}

async function rejectContactRequest(request) {
  if (!window.confirm(`Reject the request from ${request.facility_name}? They are not notified automatically.`)) return;
  try {
    await api(`/superadmin/contact-requests/${request.id}/reject`, {}, {
      method: 'POST',
      token: SuperAuth.token(),
    });
    await loadOverview();
  } catch (err) {
    showMessage(dashboardView, err.message, true);
  }
}

/* Only when an organization has lost its password and contacted us. */
async function resetAdminPassword(admin) {
  if (!window.confirm(`Reset the password for ${admin.full_name} (${admin.email}) at ${admin.organization_name}?\n\nOnly do this if they contacted you because they lost it. Their current password stops working immediately, and you will email them a new default password.`)) return;
  try {
    const result = await api(`/superadmin/admins/${admin.id}/reset-password`, {}, {
      method: 'POST',
      token: SuperAuth.token(),
    });
    await loadOverview(credentialsNotice(result, admin.organization_name));
  } catch (err) {
    showMessage(dashboardView, err.message, true);
  }
}

async function revokeAdmin(admin) {
  if (!window.confirm(`Revoke ${admin.full_name}'s access to ${admin.organization_name}?`)) return;
  try {
    await api(`/superadmin/admins/${admin.id}`, {}, {
      method: 'DELETE',
      token: SuperAuth.token(),
    });
    await loadOverview();
  } catch (err) {
    showMessage(dashboardView, err.message, true);
  }
}

function signOut() {
  SuperAuth.clear();
  dashboardView.hidden = true;
  clear(dashboardView);
  loginView.hidden = false;
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('login-btn');
  button.disabled = true;
  clear(loginMessage);
  try {
    const result = await api('/superadmin/login', {}, {
      method: 'POST',
      auth: false,
      body: {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
      },
    });
    SuperAuth.set(result.access_token);
    document.getElementById('password').value = '';
    await loadOverview();
  } catch (err) {
    showMessage(loginMessage, err.message, true);
  } finally {
    button.disabled = false;
  }
});

if (SuperAuth.token()) loadOverview();
