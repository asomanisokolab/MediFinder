/* Home: emergency mode, search, filters, pagination. */

const QUICK_SERVICES = [
  'Accident and Emergency',
  'Maternity',
  'Dental',
  'Surgery',
  'Paediatrics',
  'ICU',
];

const state = { page: 1, coords: null };

const dom = {};
['q', 'category', 'region', 'district', 'city', 'service-other', 'insurance', 'classification', 'type', 'is24',
 'hasamb', 'results', 'results-count', 'results-title', 'pager', 'emergency-btn',
 'emergency-panel', 'locate-btn', 'locate-status', 'search-form', 'service-checks',
].forEach((id) => {
  dom[id] = document.getElementById(id);
});

/* ---------- filter population ---------------------------------------- */
async function loadReference() {
  const [regions, services, insurance, classifications] = await Promise.all([
    api('/regions'),
    api('/services'),
    api('/insurance'),
    api('/classifications'),
  ]);

  regions.forEach((r) => dom.region.appendChild(el('option', { value: r, text: r })));
  insurance.forEach((i) => dom.insurance.appendChild(el('option', { value: i, text: i })));
  classifications.forEach((c) =>
    dom.classification.appendChild(
      el('option', { value: c.level, text: `${c.level} — ${c.name}` })
    )
  );

  QUICK_SERVICES.filter((s) => services.includes(s)).forEach((s) => {
    dom['service-checks'].appendChild(
      el('label', {}, [
        el('input', { type: 'checkbox', value: s, 'data-service': true }),
        s === 'ICU' ? 'ICU' : s,
      ])
    );
  });

  services
    .filter((s) => !QUICK_SERVICES.includes(s))
    .forEach((s) => dom['service-other'].appendChild(el('option', { value: s, text: s })));
}

async function loadDistricts() {
  clear(dom.district).appendChild(el('option', { value: '', text: 'All districts' }));
  if (dom.region.value) {
    try {
      const districts = await api(`/regions/${encodeURIComponent(dom.region.value)}/districts`);
      districts.forEach((d) => dom.district.appendChild(el('option', { value: d, text: d })));
    } catch (err) {
      /* the free-text field still works */
    }
  }
  await loadLocalities();
}

async function loadLocalities() {
  clear(dom.city).appendChild(el('option', { value: '', text: 'All' }));
  if (!dom.region.value) return;
  try {
    const towns = await api(`/regions/${encodeURIComponent(dom.region.value)}/localities`, {
      district: dom.district.value,
    });
    towns.forEach((t) => dom.city.appendChild(el('option', { value: t, text: t })));
  } catch (err) {
    /* the free-text field still works */
  }
}

function selectedServices() {
  const picked = Array.from(
    document.querySelectorAll('#service-checks input[data-service]:checked')
  ).map((input) => input.value);
  if (dom['service-other'].value) picked.push(dom['service-other'].value);
  return picked;
}

function currentParams() {
  const params = {
    q: dom.q.value.trim(),
    category: dom.category.value,
    region: dom.region.value,
    district: dom.district.value,
    city: dom.city.value,
    insurance: dom.insurance.value,
    classification: dom.classification.value,
    type: dom.type.value,
    service: selectedServices(),
    page: state.page,
    page_size: 20,
  };
  if (dom.is24.checked) params.is_24_hour = 'true';
  if (dom.hasamb.checked) params.has_ambulance = 'true';
  if (state.coords) {
    params.lat = state.coords.lat;
    params.lng = state.coords.lng;
  }
  return params;
}

/* ---------- search ---------------------------------------------------- */
async function search() {
  showLoading(dom.results);
  dom.pager.replaceChildren();
  try {
    const body = await api('/facilities/search', currentParams());
    renderResults(body);
  } catch (err) {
    showError(dom.results, err.message);
    dom['results-count'].textContent = '';
  }
}

function renderResults(body) {
  dom['results-title'].textContent = state.coords ? 'Nearest facilities' : 'Facilities';
  dom['results-count'].textContent = body.total === 1 ? '1 facility' : `${body.total} facilities`;

  if (!body.items.length) {
    showEmpty(
      dom.results,
      'No facilities match those filters. Try removing a filter or widening the region.'
    );
    return;
  }

  clear(dom.results);
  body.items.forEach((facility) => dom.results.appendChild(facilityCard(facility)));
  renderPager(body);
}

function renderPager(body) {
  clear(dom.pager);
  if (body.pages <= 1) return;
  dom.pager.appendChild(
    el(
      'button',
      {
        class: 'secondary',
        disabled: body.page <= 1,
        onclick: () => {
          state.page -= 1;
          search();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      'Previous'
    )
  );
  dom.pager.appendChild(el('span', { text: `Page ${body.page} of ${body.pages}` }));
  dom.pager.appendChild(
    el(
      'button',
      {
        class: 'secondary',
        disabled: body.page >= body.pages,
        onclick: () => {
          state.page += 1;
          search();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      'Next'
    )
  );
}

/* ---------- location -------------------------------------------------- */
async function locate() {
  dom['locate-status'].textContent = 'Finding your location…';
  dom['locate-btn'].disabled = true;
  try {
    state.coords = await Location.request({ useCache: false });
    dom['locate-status'].textContent =
      'Using your location. Results are sorted by distance.';
    state.page = 1;
    await search();
  } catch (err) {
    state.coords = null;
    dom['locate-status'].textContent = err.message;
    dom.region.focus();
  } finally {
    dom['locate-btn'].disabled = false;
  }
}

/* ---------- emergency mode (PRD 5.1.4) -------------------------------- */
async function emergency() {
  const panel = dom['emergency-panel'];
  panel.hidden = false;
  showLoading(panel, 'Finding the nearest help…');
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });

  let params;
  try {
    const coords = await Location.request({ useCache: true, timeout: 8000 });
    params = coords;
  } catch (err) {
    // GPS denied or unavailable: fall back to the chosen region.
    if (!dom.region.value) {
      clear(panel).appendChild(
        el('div', { class: 'emergency-panel' }, [
          el('h2', { text: 'Emergency' }),
          el('a', { class: 'call-112', href: 'tel:112' }, 'Call 112 now'),
          el('div', { class: 'error', role: 'alert', text: err.message }),
          el('p', { text: 'Choose your region above, then press the emergency button again.' }),
        ])
      );
      dom.region.focus();
      return;
    }
    params = { region: dom.region.value };
  }

  try {
    const body = await api('/emergency', params);
    renderEmergency(body);
  } catch (err) {
    clear(panel).appendChild(
      el('div', { class: 'emergency-panel' }, [
        el('h2', { text: 'Emergency' }),
        el('a', { class: 'call-112', href: 'tel:112' }, 'Call 112 now'),
        el('div', { class: 'error', role: 'alert', text: err.message }),
      ])
    );
  }
}

function renderEmergency(body) {
  const panel = clear(dom['emergency-panel']);
  const inner = el('div', { class: 'emergency-panel' }, [
    el('h2', { text: 'Emergency' }),
    el(
      'a',
      { class: 'call-112', href: `tel:${body.emergency_number}` },
      `Call ${body.emergency_number} now`
    ),
    // PRD 10: never let the user believe an ambulance is already coming.
    el('p', { class: 'disclaimer', text: body.notice }),
  ]);

  inner.appendChild(el('h3', { text: 'Ambulance providers for your area' }));
  if (body.ambulance_providers.length) {
    body.ambulance_providers.forEach((p) => inner.appendChild(ambulanceCard(p)));
  } else {
    inner.appendChild(
      el('p', { class: 'empty', text: 'No ambulance provider listed for this area yet. Call 112.' })
    );
  }

  inner.appendChild(el('h3', { text: 'Nearest open facilities' }));
  if (body.facilities.length) {
    body.facilities.forEach((f) => inner.appendChild(facilityCard(f, { showServices: false })));
  } else {
    inner.appendChild(el('p', { class: 'empty', text: 'No facility found nearby.' }));
  }

  inner.appendChild(
    el('button', { class: 'secondary', onclick: () => { dom['emergency-panel'].hidden = true; } },
      'Close emergency view')
  );

  panel.appendChild(inner);
}

/* ---------- wiring ---------------------------------------------------- */
dom['search-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  state.page = 1;
  search();
});
dom['emergency-btn'].addEventListener('click', emergency);
// The sticky phone bar links here with ?emergency=1; on this page, skip the reload.
document.getElementById('mobile-emergency').addEventListener('click', (event) => {
  event.preventDefault();
  emergency();
});
dom['locate-btn'].addEventListener('click', locate);
dom.region.addEventListener('change', loadDistricts);
dom.district.addEventListener('change', loadLocalities);
['service-other', 'insurance', 'classification', 'type'].forEach((id) =>
  dom[id].addEventListener('change', () => {
    state.page = 1;
    search();
  })
);
['is24', 'hasamb'].forEach((id) =>
  dom[id].addEventListener('change', () => {
    state.page = 1;
    search();
  })
);
dom['service-checks'].addEventListener('change', () => {
  state.page = 1;
  search();
});

(async function init() {
  renderDataBanner('banner');
  try {
    await loadReference();
  } catch (err) {
    showError(dom.results, err.message);
    return;
  }
  state.coords = Location.cached();
  if (state.coords) {
    dom['locate-status'].textContent = 'Using your saved location for this visit.';
  }
  search();
  // Opened from the sticky emergency bar or the app shortcut.
  if (qs('emergency') === '1') emergency();
})();
