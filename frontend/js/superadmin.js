/* Superadmin dashboard: contact requests, the whole directory (searched
   page by page), organization admins and their recorded changes. */

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginMessage = document.getElementById('login-message');
const SUPERADMIN_KEY = 'mf.superadmin.token';
const HEALTH_CATEGORIES = ['hospital', 'clinic'];
const TABS = [
  { id: 'directory', label: 'Directory' },
  { id: 'requests', label: 'Contact requests' },
  { id: 'admins', label: 'Organization admins' },
  { id: 'activity', label: 'Activity' },
  { id: 'add', label: 'Add organization' },
];

/* Reference lists for the forms, loaded once per sign-in. */
const reference = { regions: [], classifications: [], organizationTypes: [], categories: [] };
/* The overview (requests, admins, changes, counts) and the directory search. */
const state = {
  overview: null,
  tab: 'directory',
  kind: 'facilities',
  page: 1,
  searchSeq: 0,
};

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

function superApi(path, params = {}, options = {}) {
  return api(path, params, { token: SuperAuth.token(), ...options });
}

function showMessage(mount, text, isError = false) {
  clear(mount).appendChild(el('div', {
    class: isError ? 'error' : 'ok',
    role: isError ? 'alert' : 'status',
    text,
  }));
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function cell(value) {
  return el('td', { text: value === null || value === undefined || value === '' ? '—' : String(value) });
}

function makeTable(headers, rows) {
  if (!rows.length) return el('p', { class: 'empty', text: 'Nothing to show yet.' });
  const table = el('table', { class: 'admin-table' }, [
    el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { scope: 'col', text: h })))]),
    el('tbody', {}, rows.map((row) => el('tr', {}, row.map((value) =>
      (typeof value === 'string' || typeof value === 'number' || value === null ? cell(value) : el('td', {}, value))
    )))),
  ]);
  return el('div', { class: 'table-scroll' }, table);
}

/* ---------- form helpers ---------------------------------------------- */
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
    list: options.list,
    placeholder: options.placeholder,
    ...(options.maxlength ? { maxlength: options.maxlength } : {}),
  });
  if (type === 'checkbox') {
    return el('label', { class: 'check-field', for: control.id }, [control, label]);
  }
  return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control]);
}

/* Choices are plain strings, or { value, label } when they differ. */
function editorSelect(name, label, value, choices, prefix, { required = true } = {}) {
  const list = choices.map((choice) => (typeof choice === 'string' ? { value: choice, label: choice } : choice));
  if (value && !list.some((o) => o.value === value)) list.push({ value, label: value });
  const control = el('select', { id: `${prefix}-${name}`, name, required },
    list.map((o) => el('option', { value: o.value, selected: o.value === value, text: o.label })));
  return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control]);
}

function editorText(name, label, value, prefix, hint) {
  return el('div', { class: 'field' }, [
    el('label', { for: `${prefix}-${name}`, text: label }),
    el('textarea', { id: `${prefix}-${name}`, name, rows: '4', text: value || '' }),
    hint ? el('p', { class: 'hint', text: hint }) : null,
  ]);
}

function group(title, children) {
  return el('fieldset', { class: 'editor-group' }, [el('legend', { text: title }), ...children]);
}

function formValues(form) {
  const values = {};
  for (const control of form.elements) {
    if (!control.name) continue;
    values[control.name] = control.type === 'checkbox' ? control.checked : control.value;
  }
  return values;
}

function showFormError(form, message) {
  const old = form.querySelector('.editor-error');
  if (old) old.remove();
  const box = el('div', { class: 'error editor-error', role: 'alert', text: message });
  form.prepend(box);
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function categoryChoices() {
  return reference.categories.map((c) => ({ value: c, label: CATEGORY_LABEL[c] || c }));
}

function levelChoices() {
  return [
    ...reference.classifications.map((c) => ({ value: c.level, label: `${c.level} — ${c.name}` })),
    { value: 'Not classified', label: 'Not classified (pharmacy, lab, hearse, caregiver)' },
  ];
}

function typeLabel(value) {
  const match = reference.organizationTypes.find((item) => item.value === value);
  return match ? match.label : value;
}

/* ---------- directory editors ----------------------------------------- */
/* Services are edited one per line; "(unavailable)" after a name pauses it. */
const PAUSED = ' (unavailable)';

function servicesText(details) {
  return details.map((s) => s.service_name + (s.is_active ? '' : PAUSED)).join('\n');
}

function parseServices(text) {
  return text.split(/\n|,/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const paused = line.toLowerCase().endsWith(PAUSED.trim());
    return {
      service_name: paused ? line.slice(0, -PAUSED.trim().length).trim() : line,
      is_active: !paused,
    };
  });
}

function facilityEditor(facility, onSaved) {
  const prefix = `facility-${facility.id}`;
  const save = el('button', { type: 'submit' }, 'Save changes');
  const form = el('form', { class: 'editor' }, [
    el('div', { class: 'editor-grid' }, [
      group('Basic details', [
        editorField('name', 'Name', facility.name, 'text', { prefix, required: true, maxlength: 200 }),
        el('div', { class: 'row' }, [
          editorSelect('category', 'Category', facility.category, categoryChoices(), prefix),
          editorSelect('type', 'Ownership', facility.type,
            [{ value: 'government', label: 'Government' }, { value: 'private', label: 'Private' }], prefix),
        ]),
        editorSelect('classification', 'Level', facility.classification, levelChoices(), prefix),
      ]),
      group('Location', [
        el('div', { class: 'row' }, [
          editorSelect('region', 'Region', facility.region, reference.regions, prefix),
          editorField('district', 'District / municipal', facility.district, 'text', { prefix, maxlength: 80 }),
        ]),
        el('div', { class: 'row' }, [
          editorField('city', 'City or town', facility.city, 'text', { prefix, maxlength: 80 }),
          editorField('town', 'Community', facility.town, 'text', { prefix, maxlength: 80 }),
        ]),
        editorField('address', 'Address', facility.address, 'text', { prefix, maxlength: 300 }),
        el('div', { class: 'row' }, [
          editorField('lat', 'Latitude', facility.lat, 'number', { prefix, required: true, min: -90, max: 90, step: 'any' }),
          editorField('lng', 'Longitude', facility.lng, 'number', { prefix, required: true, min: -180, max: 180, step: 'any' }),
        ]),
      ]),
      group('Contact and hours', [
        el('div', { class: 'row' }, [
          editorField('phone', 'Phone', facility.phone, 'text', { prefix, maxlength: 40 }),
          editorField('hours', 'Opening hours', facility.hours, 'text', { prefix, maxlength: 120 }),
        ]),
        editorField('is_24_hour', 'Open 24 hours', facility.is_24_hour, 'checkbox', { prefix }),
        editorField('has_ambulance', 'Has its own ambulance', facility.has_ambulance, 'checkbox', { prefix }),
        el('div', { class: 'row' }, [
          editorField('ambulance_phone', 'Ambulance phone', facility.ambulance_phone, 'text', { prefix, maxlength: 40 }),
          editorField('ambulance_provider_id', 'Linked provider ID', facility.ambulance_provider_id, 'number', { prefix, min: 1 }),
        ]),
      ]),
      group('Services, insurance and beds', [
        editorText('services', 'Services, one per line', servicesText(facility.service_detail), prefix,
          'Add "(unavailable)" after a service that is paused.'),
        editorText('insurance', 'Insurance accepted, separated by commas', facility.insurance.join(', '), prefix),
        el('div', { class: 'row' }, [
          editorField('total_beds', 'Total beds', facility.admin_beds?.total_beds, 'number', { prefix, min: 0, max: 10000, placeholder: 'Blank: no beds' }),
          editorField('available_beds', 'Beds free', facility.admin_beds?.available_beds, 'number', { prefix, min: 0, max: 10000 }),
        ]),
      ]),
    ]),
    editorField('verified', 'Verified: details checked with the facility', facility.verified, 'checkbox', { prefix }),
    el('div', { class: 'editor-actions' }, [save]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    setLoading(save, true, 'Saving…');
    try {
      await superApi(`/superadmin/facilities/${facility.id}`, {}, {
        method: 'PUT',
        body: {
          ...values,
          lat: Number(values.lat),
          lng: Number(values.lng),
          ambulance_provider_id: values.ambulance_provider_id === '' ? null : Number(values.ambulance_provider_id),
          services: parseServices(values.services),
          insurance: values.insurance.split(',').map((i) => i.trim()).filter(Boolean),
          total_beds: values.total_beds === '' ? null : Number(values.total_beds),
          available_beds: values.available_beds === '' ? null : Number(values.available_beds),
        },
      });
      toast(`Saved ${values.name}`);
      onSaved();
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      setLoading(save, false);
    }
  });
  return form;
}

function providerEditor(provider, onSaved) {
  const prefix = `provider-${provider.id}`;
  const coverage = provider.coverage.map((c) => (c.district ? `${c.region} | ${c.district}` : c.region)).join('\n');
  const save = el('button', { type: 'submit' }, 'Save changes');
  const form = el('form', { class: 'editor' }, [
    el('div', { class: 'editor-grid' }, [
      group('Basic details', [
        editorField('name', 'Name', provider.name, 'text', { prefix, required: true, maxlength: 200 }),
        el('div', { class: 'row' }, [
          editorSelect('operator_type', 'Operator', provider.operator_type, [
            { value: 'government', label: 'Government' },
            { value: 'private', label: 'Private' },
            { value: 'facility_attached', label: 'Hospital unit' },
          ], prefix),
          editorSelect('service_level', 'Service level', provider.service_level, [
            { value: 'BLS', label: 'BLS — Basic' }, { value: 'ALS', label: 'ALS — Advanced' },
          ], prefix),
        ]),
        editorSelect('cost_band', 'Cost', provider.cost_band, [
          { value: '', label: 'Not stated' }, { value: 'free', label: 'No charge' }, { value: 'low', label: 'Low' },
          { value: 'moderate', label: 'Moderate' }, { value: 'premium', label: 'Premium' },
        ], prefix, { required: false }),
      ]),
      group('Base location', [
        el('div', { class: 'row' }, [
          editorSelect('region', 'Region', provider.region, reference.regions, prefix),
          editorField('district', 'District / municipal', provider.district, 'text', { prefix, maxlength: 80 }),
        ]),
        editorField('base_address', 'Base address', provider.base_address, 'text', { prefix, maxlength: 300 }),
        el('div', { class: 'row' }, [
          editorField('lat', 'Latitude', provider.lat, 'number', { prefix, required: true, min: -90, max: 90, step: 'any' }),
          editorField('lng', 'Longitude', provider.lng, 'number', { prefix, required: true, min: -180, max: 180, step: 'any' }),
        ]),
      ]),
      group('Contact', [
        el('div', { class: 'row' }, [
          editorField('phone', 'Dispatch phone', provider.phone, 'text', { prefix, required: true, maxlength: 40 }),
          editorField('alt_phone', 'Other phone', provider.alt_phone, 'text', { prefix, maxlength: 40 }),
        ]),
        editorField('hours', 'Hours', provider.hours, 'text', { prefix, maxlength: 120 }),
        editorField('is_24_hour', 'Available 24 hours', provider.is_24_hour, 'checkbox', { prefix }),
        editorField('phone_verified', 'Dispatch number checked by a call', Boolean(provider.phone_verified_at), 'checkbox', { prefix }),
      ]),
      group('Coverage and fleet', [
        editorText('coverage', 'Areas covered, one per line', coverage, prefix,
          'Write "Region" or "Region | District".'),
        el('div', { class: 'row' }, [
          editorField('total_units', 'Total ambulances', provider.admin_status?.total_units, 'number', { prefix, min: 0, max: 1000, placeholder: 'Blank: no report' }),
          editorField('units_available', 'Available now', provider.admin_status?.units_available, 'number', { prefix, min: 0, max: 1000 }),
        ]),
      ]),
    ]),
    editorField('verified', 'Verified: details checked with the provider', provider.verified, 'checkbox', { prefix }),
    el('div', { class: 'editor-actions' }, [save]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    setLoading(save, true, 'Saving…');
    try {
      await superApi(`/superadmin/providers/${provider.id}`, {}, {
        method: 'PUT',
        body: {
          ...values,
          lat: Number(values.lat),
          lng: Number(values.lng),
          coverage: values.coverage.split(/\n|,/).map((line) => line.trim()).filter(Boolean).map((line) => {
            const [region, ...district] = line.split('|');
            return { region: region.trim(), district: district.join('|').trim() };
          }),
          total_units: values.total_units === '' ? null : Number(values.total_units),
          units_available: values.units_available === '' ? null : Number(values.units_available),
        },
      });
      toast(`Saved ${values.name}`);
      onSaved();
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      setLoading(save, false);
    }
  });
  return form;
}

/* ---------- directory rows -------------------------------------------- */
function placeOf(record) {
  const local = [record.town, record.city].filter((v, i, all) => v && all.indexOf(v) === i);
  return [...local, record.district, record.region].filter(Boolean).join(' · ');
}

function statusChips(record, kind) {
  const chips = [];
  if (kind === 'facilities') {
    chips.push(el('li', { class: 'chip', text: CATEGORY_LABEL[record.category] || record.category }));
    if (HEALTH_CATEGORIES.includes(record.category) && record.classification !== 'Private') {
      chips.push(el('li', { class: 'chip', text: record.classification }));
    }
    chips.push(el('li', { class: 'chip grey', text: record.type === 'government' ? 'Government' : 'Private' }));
  } else {
    chips.push(el('li', { class: 'chip', text: record.service_level === 'ALS' ? 'ALS · Advanced' : 'BLS · Basic' }));
    chips.push(el('li', {
      class: 'chip grey',
      text: { government: 'Government', private: 'Private', facility_attached: 'Hospital unit' }[record.operator_type],
    }));
  }
  chips.push(record.verified
    ? el('li', { class: 'chip green', text: 'Verified' })
    : el('li', { class: 'chip grey', text: 'Unverified' }));
  if (!record.location_confirmed) chips.push(el('li', { class: 'chip amber', text: 'Hidden: no map location' }));
  if (record.managed) chips.push(el('li', { class: 'chip care', text: 'Has a login' }));
  if (record.source) chips.push(el('li', { class: 'chip grey', text: record.source.startsWith('osm') ? 'OpenStreetMap' : record.source }));
  return chips;
}

function directoryRow(record, kind) {
  const editorMount = el('div', { class: 'row-editor', hidden: true });
  const edit = el('button', { type: 'button', class: 'secondary', 'aria-expanded': 'false' }, 'Edit');
  edit.addEventListener('click', () => {
    const opening = editorMount.hidden;
    if (opening && !editorMount.firstChild) {
      const reload = () => { runSearch({ keepPage: true }); refreshOverview(); };
      editorMount.appendChild(kind === 'facilities' ? facilityEditor(record, reload) : providerEditor(record, reload));
    }
    editorMount.hidden = !opening;
    edit.textContent = opening ? 'Close' : 'Edit';
    edit.setAttribute('aria-expanded', String(opening));
  });
  const publicHref = kind === 'facilities' ? `/facility.html?id=${record.id}` : `/ambulance.html?id=${record.id}`;
  const remove = el('button', { type: 'button', class: 'danger-outline' }, 'Delete');
  remove.addEventListener('click', () => deleteDirectoryRecord(kind, record));

  const detail = kind === 'facilities'
    ? [record.phone || 'No phone', record.beds && !record.beds.is_stale ? record.beds.display : null]
    : [record.phone, record.status ? record.status.display : null];

  return el('article', { class: 'sa-row' }, [
    el('div', { class: 'sa-row-main' }, [
      el('div', { class: 'sa-row-title' }, [
        el('h3', { text: record.name }),
        el('span', { class: 'sa-id', text: `#${record.id}` }),
      ]),
      el('p', { class: 'meta', text: placeOf(record) || 'No place recorded' }),
      el('p', { class: 'meta', text: detail.filter(Boolean).join(' · ') }),
      el('ul', { class: 'chips' }, statusChips(record, kind)),
    ]),
    el('div', { class: 'sa-row-actions' }, [
      edit,
      record.location_confirmed
        ? el('a', { class: 'btn secondary', href: publicHref, target: '_blank', rel: 'noopener' }, 'Public page')
        : null,
      remove,
    ]),
    editorMount,
  ]);
}

/* ---------- directory search ------------------------------------------ */
const search = {};

function selectField(id, label, options) {
  const control = el('select', { id }, options.map((o) =>
    (typeof o === 'string' ? el('option', { value: o, text: o }) : el('option', { value: o.value, text: o.label }))));
  search[id] = control;
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control]);
}

function directoryPanel() {
  search.q = el('input', {
    type: 'search', id: 'sa-q', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Name, ID, community, town, district or region',
  });
  search.button = el('button', {
    type: 'submit',
    class: 'search-btn',
    'aria-label': 'Search',
    html: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span>',
  });
  search.feedback = el('div', { class: 'feedback', role: 'status', 'aria-live': 'polite', hidden: true });
  search.results = el('div', { class: 'sa-results' });
  search.pager = el('div', { class: 'pager' });

  const kindButtons = [['facilities', 'Facilities'], ['providers', 'Ambulance providers']].map(([value, label]) => {
    const button = el('button', {
      type: 'button',
      class: 'segment',
      'aria-pressed': String(state.kind === value),
    }, label);
    button.addEventListener('click', () => {
      if (state.kind === value) return;
      search.setKind(value);
      runSearch();
    });
    return button;
  });
  search.setKind = (value) => {
    state.kind = value;
    kindButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (value === 'facilities'))));
    syncKindFilters();
  };

  const facilityOnly = el('div', { class: 'row filter-row' }, [
    selectField('sa-category', 'Category', [{ value: '', label: 'Any category' }, ...categoryChoices()]),
    selectField('sa-type', 'Ownership', [
      { value: '', label: 'Any ownership' }, { value: 'government', label: 'Government' }, { value: 'private', label: 'Private' },
    ]),
    selectField('sa-managed', 'Login', [
      { value: '', label: 'With or without' }, { value: 'yes', label: 'Has a login' }, { value: 'no', label: 'No login yet' },
    ]),
  ]);
  const providerOnly = el('div', { class: 'row filter-row' }, [
    selectField('sa-operator', 'Operator', [
      { value: '', label: 'Any operator' }, { value: 'government', label: 'Government' },
      { value: 'private', label: 'Private' }, { value: 'facility_attached', label: 'Hospital unit' },
    ]),
    selectField('sa-level', 'Service level', [
      { value: '', label: 'Any level' }, { value: 'ALS', label: 'ALS — Advanced' }, { value: 'BLS', label: 'BLS — Basic' },
    ]),
  ]);
  function syncKindFilters() {
    facilityOnly.hidden = state.kind !== 'facilities';
    providerOnly.hidden = state.kind !== 'providers';
    search['sa-city'].closest('.field').hidden = state.kind !== 'facilities';
  }

  const clearButton = el('button', { type: 'button', class: 'link-plain' }, 'Clear search and filters');
  const form = el('form', { class: 'panel sa-search', role: 'search' }, [
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'What to search' }, kindButtons),
    el('label', { for: 'sa-q', text: 'Search the directory' }),
    el('div', { class: 'searchbar' }, [
      el('div', { class: 'search-box' }, [
        el('span', { class: 'search-icon', html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }),
        search.q,
      ]),
      search.button,
    ]),
    el('div', { class: 'row filter-row' }, [
      selectField('sa-region', 'Region', [{ value: '', label: 'All regions' }, ...reference.regions]),
      selectField('sa-district', 'District / municipal', [{ value: '', label: 'All districts' }]),
      selectField('sa-city', 'City or town', [{ value: '', label: 'All' }]),
    ]),
    facilityOnly,
    providerOnly,
    el('div', { class: 'row filter-row' }, [
      selectField('sa-verified', 'Verified', [
        { value: '', label: 'Verified or not' }, { value: 'yes', label: 'Verified' }, { value: 'no', label: 'Unverified' },
      ]),
      selectField('sa-location', 'Map location', [
        { value: '', label: 'Set or missing' }, { value: 'set', label: 'Set (public)' }, { value: 'missing', label: 'Missing (hidden)' },
      ]),
    ]),
    clearButton,
  ]);

  search.form = form;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  search['sa-region'].addEventListener('change', async () => {
    await loadDistricts();
    runSearch();
  });
  search['sa-district'].addEventListener('change', async () => {
    await loadCities();
    runSearch();
  });
  ['sa-city', 'sa-category', 'sa-type', 'sa-managed', 'sa-operator', 'sa-level', 'sa-verified', 'sa-location']
    .forEach((id) => search[id].addEventListener('change', () => runSearch()));
  search.q.addEventListener('search', () => { if (!search.q.value) runSearch(); });
  clearButton.addEventListener('click', async () => {
    form.reset();
    await loadDistricts();
    runSearch();
  });
  syncKindFilters();

  return el('div', {}, [form, search.feedback, search.results, search.pager]);
}

async function loadDistricts() {
  clear(search['sa-district']).appendChild(el('option', { value: '', text: 'All districts' }));
  const region = search['sa-region'].value;
  if (region) {
    try {
      const districts = await api(`/regions/${encodeURIComponent(region)}/districts`, {}, { auth: false });
      districts.forEach((d) => search['sa-district'].appendChild(el('option', { value: d, text: d })));
    } catch (err) {
      /* typing the district in the search box still works */
    }
  }
  await loadCities();
}

async function loadCities() {
  clear(search['sa-city']).appendChild(el('option', { value: '', text: 'All' }));
  const region = search['sa-region'].value;
  if (!region) return;
  try {
    const towns = await api(`/regions/${encodeURIComponent(region)}/localities`,
      { district: search['sa-district'].value }, { auth: false });
    towns.forEach((t) => search['sa-city'].appendChild(el('option', { value: t, text: t })));
  } catch (err) {
    /* typing the town in the search box still works */
  }
}

function searchParams() {
  const common = {
    q: search.q.value.trim(),
    region: search['sa-region'].value,
    district: search['sa-district'].value,
    verified: search['sa-verified'].value,
    location: search['sa-location'].value,
    page: state.page,
    page_size: 20,
  };
  if (state.kind === 'facilities') {
    return {
      ...common,
      city: search['sa-city'].value,
      category: search['sa-category'].value,
      type: search['sa-type'].value,
      managed: search['sa-managed'].value,
    };
  }
  return { ...common, operator_type: search['sa-operator'].value, service_level: search['sa-level'].value };
}

function describeSearch(body, params) {
  const [one, many] = state.kind === 'facilities' ? ['facility', 'facilities'] : ['ambulance provider', 'ambulance providers'];
  const where = [params.city, params.district, params.region].find(Boolean);
  let text = `Found ${plural(body.total, one, many)}`;
  if (params.q) text += ` for “${params.q}”`;
  if (where) text += ` in ${where}`;
  return `${text}.`;
}

async function runSearch({ keepPage = false } = {}) {
  if (!keepPage) state.page = 1;
  const seq = ++state.searchSeq;
  const params = searchParams();
  setLoading(search.button, true);
  feedback(search.feedback, 'info', params.q ? `Searching for “${params.q}”…` : 'Searching…');
  if (!keepPage) showLoading(search.results, 'Searching the directory…');
  clear(search.pager);
  try {
    const body = await superApi(`/superadmin/${state.kind}`, params);
    if (seq !== state.searchSeq) return;
    if (!body.items.length) {
      feedback(search.feedback, 'empty', `Nothing found${params.q ? ` for “${params.q}”` : ''}. Check the spelling or clear a filter.`);
      showEmpty(search.results, 'No records match.');
      return;
    }
    feedback(search.feedback, 'ok', describeSearch(body, params));
    clear(search.results).append(...body.items.map((record) => directoryRow(record, state.kind)));
    renderPager(body);
  } catch (err) {
    if (seq !== state.searchSeq) return;
    feedback(search.feedback, 'error', `Search did not work: ${err.message}`, { label: 'Try again', onClick: () => runSearch({ keepPage: true }) });
    clear(search.results);
  } finally {
    if (seq === state.searchSeq) setLoading(search.button, false);
  }
}

function renderPager(body) {
  if (body.pages <= 1) return;
  const go = (page) => {
    state.page = page;
    runSearch({ keepPage: true });
    search.feedback.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  search.pager.append(
    el('button', { class: 'secondary', disabled: body.page <= 1, onclick: () => go(body.page - 1) }, 'Previous'),
    el('span', { text: `Page ${body.page} of ${body.pages}` }),
    el('button', { class: 'secondary', disabled: body.page >= body.pages, onclick: () => go(body.page + 1) }, 'Next'),
  );
}

async function deleteDirectoryRecord(kind, record) {
  const label = kind === 'facilities' ? 'facility' : 'ambulance provider';
  if (!window.confirm(`Permanently delete ${label} "${record.name}" and its related records?`)) return;
  try {
    await superApi(`/superadmin/${kind}/${record.id}`, {}, { method: 'DELETE' });
    toast(`Deleted ${record.name}`);
    runSearch({ keepPage: true });
    refreshOverview();
  } catch (err) {
    feedback(search.feedback, 'error', err.message);
  }
}

/* ---------- organization creation ------------------------------------- */
/* Creates a listing and its admin login. With a contact request it is
   prefilled from it, and saving also approves the request. */
function organizationForm(request) {
  const prefix = request ? `request-${request.id}` : 'new-organization';
  const typeField = editorSelect(
    'organization_type', 'Type', request ? request.organization_type : '',
    [{ value: '', label: 'Choose a type' }, ...reference.organizationTypes], prefix
  );
  const ownershipField = editorSelect(
    'ownership', 'Ownership', 'private',
    [{ value: 'private', label: 'Private' }, { value: 'government', label: 'Government' }], prefix
  );
  const classificationField = editorSelect(
    'classification', 'Level', '',
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

  const submit = el('button', { type: 'submit' }, 'Create login');
  const form = el('form', { class: 'editor' }, [
    el('div', { class: 'editor-grid' }, [
      group('Organization', [
        typeField,
        editorField('name', 'Name', request?.facility_name, 'text', { prefix, required: true, maxlength: 200 }),
        el('div', { class: 'row' }, [ownershipField, classificationField]),
      ]),
      group('Login', [
        editorField('email', 'Login email', request?.email, 'email', { prefix, required: true, maxlength: 160 }),
        editorField('phone', 'Phone', request?.phone, 'text', { prefix, required: true, maxlength: 40 }),
        editorField('full_name', 'Contact person', request?.contact_name, 'text', { prefix, maxlength: 120 }),
      ]),
      group('Location', [
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
          class: 'hint',
          text: 'Leave the coordinates blank to let the organization set its own location after signing in. The listing stays out of public search until then.',
        }),
      ]),
    ]),
    el('div', { class: 'editor-actions' }, [submit]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    setLoading(submit, true, 'Creating…');
    try {
      const result = await superApi('/superadmin/organizations', {}, {
        method: 'POST',
        body: {
          ...values,
          contact_request_id: request ? request.id : null,
          ownership: values.ownership || null,
          lat: values.lat === '' ? null : Number(values.lat),
          lng: values.lng === '' ? null : Number(values.lng),
        },
      });
      await refreshOverview(credentialsNotice(result, result.organization_name));
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      setLoading(submit, false);
    }
  });
  return form;
}

/* One-time result of creating an account or resetting a lost password. The
   app sends no email: the superadmin emails this message to the
   organization, from their email app or by copying it. */
function credentialsNotice(result, organizationName) {
  const { subject, body } = result.message;
  const status = el('span', { role: 'status' });
  const messageBox = el('textarea', { rows: '12', readonly: true, 'aria-label': 'Login message', text: body });
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

  return el('div', { class: 'ok credentials', role: 'status' }, [
    el('strong', { text: `Now email ${organizationName} their login details.` }),
    el('p', { text: 'This is the only time the default password is shown. They choose their own password when they first sign in.' }),
    el('p', {}, ['Default password: ', el('code', { class: 'secret', text: result.temporary_password })]),
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

/* ---------- requests, admins, activity -------------------------------- */
function requestsPanel(requests) {
  if (!requests.length) {
    return el('p', { class: 'empty', text: 'No contact requests waiting. New ones from the Contact us page appear here.' });
  }
  return el('div', { class: 'card-list' }, requests.map((request) => {
    const formMount = el('div', { class: 'row-editor', hidden: true });
    const approve = el('button', { type: 'button' }, 'Approve and create login');
    approve.addEventListener('click', () => {
      if (!formMount.firstChild) formMount.appendChild(organizationForm(request));
      formMount.hidden = !formMount.hidden;
      approve.textContent = formMount.hidden ? 'Approve and create login' : 'Close';
    });
    return el('article', { class: 'sa-row' }, [
      el('div', { class: 'sa-row-main' }, [
        el('div', { class: 'sa-row-title' }, [
          el('h3', { text: request.facility_name }),
          el('span', { class: 'sa-id', text: `#${request.id}` }),
        ]),
        el('ul', { class: 'chips' }, [
          el('li', { class: 'chip', text: typeLabel(request.organization_type) }),
          el('li', { class: 'chip grey', text: `Sent ${when(request.created_at)}` }),
        ]),
        el('p', { class: 'meta' }, [
          request.contact_name ? `${request.contact_name} · ` : '',
          el('a', { href: `mailto:${request.email}`, text: request.email }),
          ' · ',
          el('a', { href: telHref(request.phone), text: request.phone }),
        ]),
        request.message ? el('blockquote', { class: 'request-message', text: request.message }) : null,
      ]),
      el('div', { class: 'sa-row-actions' }, [
        approve,
        el('button', { type: 'button', class: 'danger-outline', onclick: () => rejectContactRequest(request) }, 'Reject'),
      ]),
      formMount,
    ]);
  }));
}

function adminsPanel(admins) {
  const filter = el('input', {
    type: 'search', placeholder: 'Filter by name, email or organization', 'aria-label': 'Filter organization admins',
  });
  const mount = el('div');
  function render() {
    const text = filter.value.trim().toLowerCase();
    const shown = admins.filter((a) =>
      !text || `${a.full_name} ${a.email} ${a.organization_name}`.toLowerCase().includes(text));
    clear(mount).appendChild(makeTable(['Name', 'Email', 'Organization', 'Status', 'Created', ''], shown.map((admin) => [
      admin.full_name || '—',
      admin.email,
      el('span', {}, [admin.organization_name, el('small', { class: 'sa-sub', text: admin.scope === 'facility' ? 'Facility' : 'Ambulance provider' })]),
      el('span', {
        class: admin.must_change_password ? 'chip amber' : 'chip green',
        text: admin.must_change_password ? 'Awaiting first sign-in' : 'Active',
      }),
      when(admin.created_at),
      el('div', { class: 'table-actions' }, [
        el('button', { type: 'button', class: 'secondary', onclick: () => resetAdminPassword(admin) }, 'Reset password'),
        el('button', { type: 'button', class: 'danger-outline', onclick: () => revokeAdmin(admin) }, 'Revoke'),
      ]),
    ])));
  }
  filter.addEventListener('input', render);
  render();
  return el('div', {}, [el('div', { class: 'field' }, [filter]), mount]);
}

const ACTION_LABEL = {
  'beds.updated': 'Updated beds',
  'services.updated': 'Updated services',
  'offerings.updated': 'Updated what they offer',
  'busy.updated': 'Updated busy status',
  'fleet.updated': 'Updated fleet',
  'location.updated': 'Set map location',
  'facility.updated_by_superadmin': 'Edited by superadmin',
  'provider.updated_by_superadmin': 'Edited by superadmin',
  'facility.deleted_by_superadmin': 'Deleted by superadmin',
  'provider.deleted_by_superadmin': 'Deleted by superadmin',
  'facility.created_by_superadmin': 'Created by superadmin',
  'provider.created_by_superadmin': 'Created by superadmin',
};

function shortValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'object' && item !== null
      ? item.service_name || [item.region, item.district].filter(Boolean).join(' | ') || JSON.stringify(item)
      : item)).join(', ') || '—';
  }
  if (typeof value === 'object') {
    if ('care_type' in value) return `${value.is_active ? 'available' : 'paused'} (${CARE_TYPE_LABEL[value.care_type] || value.care_type})`;
    return Object.entries(value).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
  }
  return String(value);
}

/* Organization admins record each changed field as {before, after}; the
   superadmin records whole snapshots, so those are compared field by field. */
function changedFields(changes) {
  const { before, after } = changes || {};
  const snapshot = changes && 'before' in changes && 'after' in changes
    && (before === null || typeof before === 'object') && (after === null || typeof after === 'object');
  if (!snapshot) return Object.entries(changes || {});
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return Array.from(keys)
    .filter((key) => JSON.stringify((before || {})[key]) !== JSON.stringify((after || {})[key]))
    .filter((key) => after !== null || ['name', 'region', 'city'].includes(key))
    .map((key) => [key, { before: (before || {})[key], after: (after || {})[key] }]);
}

function activityPanel(changes) {
  if (!changes.length) return el('p', { class: 'empty', text: 'No changes recorded yet.' });
  return el('ol', { class: 'activity' }, changes.map((change) => {
    const fields = changedFields(change.changes);
    return el('li', {}, [
      el('div', { class: 'activity-head' }, [
        el('strong', { text: change.organization_name }),
        el('span', { text: ACTION_LABEL[change.action] || change.action }),
      ]),
      el('p', { class: 'meta', text: `${change.admin_email} · ${when(change.created_at)}` }),
      fields.length
        ? el('ul', { class: 'activity-changes' }, fields.slice(0, 12).map(([field, diff]) =>
          el('li', {}, [
            el('span', { class: 'activity-field', text: field.replace(/_/g, ' ') }),
            ` ${shortValue(diff && diff.before)} → ${shortValue(diff && diff.after)}`,
          ])))
        : null,
      fields.length > 12 ? el('p', { class: 'hint', text: `and ${fields.length - 12} more` }) : null,
      fields.length ? null : el('p', { class: 'hint', text: 'Saved with no details changed.' }),
    ]);
  }));
}

/* ---------- dashboard shell ------------------------------------------- */
function statCard(label, value, hint, onClick, tone = '') {
  return el('button', { type: 'button', class: `stat ${tone}`, onclick: onClick }, [
    el('span', { class: 'stat-value', text: value.toLocaleString() }),
    el('span', { class: 'stat-label', text: label }),
    hint ? el('span', { class: 'stat-hint', text: hint }) : null,
  ]);
}

const panels = {};
const shell = {};

function showTab(id, { focus = false } = {}) {
  state.tab = id;
  document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
    const selected = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== id; });
  try {
    history.replaceState(null, '', `#${id}`);
  } catch (err) {
    /* not important */
  }
}

/* A summary card jumps to the directory with matching filters. */
function filterDirectory(settings) {
  showTab('directory');
  search.form.reset();
  loadDistricts();
  search.setKind(settings.kind || 'facilities');
  search['sa-verified'].value = settings.verified || '';
  search['sa-location'].value = settings.location || '';
  runSearch();
}

function renderStats(s) {
  clear(shell.stats).append(
    statCard('Contact requests', s.pending_requests, s.pending_requests ? 'Waiting for review' : 'All reviewed',
      () => showTab('requests'), s.pending_requests ? 'attention' : ''),
    statCard('Facilities', s.facilities, null, () => filterDirectory({})),
    statCard('Ambulance providers', s.providers, null, () => filterDirectory({ kind: 'providers' })),
    statCard('Hidden facilities', s.hidden_facilities, 'No map location yet', () => filterDirectory({ location: 'missing' }),
      s.hidden_facilities ? 'warn' : ''),
    statCard('Unverified facilities', s.unverified_facilities, null, () => filterDirectory({ verified: 'no' })),
    statCard('Organization logins', s.admins, null, () => showTab('admins')),
  );
  const counts = { requests: s.pending_requests, admins: s.admins };
  document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
    const count = tab.querySelector('.tab-count');
    count.textContent = counts[tab.dataset.tab] ? String(counts[tab.dataset.tab]) : '';
  });
}

/* Everything except the directory search, which keeps its own state. */
function renderOverviewParts(data) {
  renderStats(data.stats);
  clear(panels.requests).appendChild(requestsPanel(data.contact_requests));
  clear(panels.admins).appendChild(adminsPanel(data.admins));
  clear(panels.activity).appendChild(activityPanel(data.changes));
}

function renderDashboard(data) {
  const mount = clear(dashboardView);
  mount.appendChild(el('div', { class: 'sa-head' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', text: 'System management' }),
      el('h1', { text: 'FindCare dashboard' }),
    ]),
    el('button', { class: 'secondary', onclick: signOut }, 'Sign out'),
  ]));
  shell.notice = el('div');
  shell.stats = el('div', { class: 'stats' });
  mount.append(shell.notice, shell.stats);

  const tabList = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' }, TABS.map((tab) =>
    el('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-controls': `panel-${tab.id}`,
      'data-tab': tab.id,
      onclick: () => showTab(tab.id),
    }, [tab.label, el('span', { class: 'tab-count' })])
  ));
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex((t) => t.id === state.tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(next.id, { focus: true });
  });
  mount.appendChild(tabList);

  TABS.forEach((tab) => {
    panels[tab.id] = el('section', {
      class: 'tab-panel', role: 'tabpanel', id: `panel-${tab.id}`, 'aria-labelledby': `tab-${tab.id}`,
    });
    mount.appendChild(panels[tab.id]);
  });
  panels.directory.appendChild(directoryPanel());
  panels.add.appendChild(el('div', { class: 'panel' }, [
    el('h2', { text: 'Add an organization without a contact request' }),
    organizationForm(null),
  ]));
  renderOverviewParts(data);

  const fromHash = window.location.hash.slice(1);
  showTab(TABS.some((t) => t.id === fromHash) ? fromHash : state.tab);
  runSearch();
}

/* After an action: new counts, requests, admins and activity. A notice (new
   login details) is shown at the top until the next one. */
async function refreshOverview(notice) {
  try {
    const data = await superApi('/superadmin/overview');
    state.overview = data;
    renderOverviewParts(data);
    if (notice) {
      clear(shell.notice).appendChild(notice);
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (err) {
    toast(err.message, 'error');
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

async function loadOverview() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  showLoading(dashboardView, 'Loading the dashboard…');
  try {
    await loadReference();
    const data = await superApi('/superadmin/overview');
    state.overview = data;
    renderDashboard(data);
  } catch (err) {
    signOut();
    showMessage(loginMessage, err.message, true);
  }
}

async function rejectContactRequest(request) {
  if (!window.confirm(`Reject the request from ${request.facility_name}? They are not notified automatically.`)) return;
  try {
    await superApi(`/superadmin/contact-requests/${request.id}/reject`, {}, { method: 'POST' });
    toast(`Rejected ${request.facility_name}`);
    await refreshOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* Only when an organization has lost its password and contacted us. */
async function resetAdminPassword(admin) {
  if (!window.confirm(`Reset the password for ${admin.full_name} (${admin.email}) at ${admin.organization_name}?\n\nOnly do this if they contacted you because they lost it. Their current password stops working immediately, and you will email them a new default password.`)) return;
  try {
    const result = await superApi(`/superadmin/admins/${admin.id}/reset-password`, {}, { method: 'POST' });
    await refreshOverview(credentialsNotice(result, admin.organization_name));
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function revokeAdmin(admin) {
  if (!window.confirm(`Revoke ${admin.full_name}'s access to ${admin.organization_name}?`)) return;
  try {
    await superApi(`/superadmin/admins/${admin.id}`, {}, { method: 'DELETE' });
    toast(`Revoked ${admin.email}`);
    await refreshOverview();
  } catch (err) {
    toast(err.message, 'error');
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
  setLoading(button, true, 'Signing in…');
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
    setLoading(button, false);
  }
});

if (SuperAuth.token()) loadOverview();
