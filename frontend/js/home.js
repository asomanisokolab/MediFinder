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
// Each search gets a number; an answer for an older one is dropped, so a
// slow response can never overwrite the results of a newer search.
let searchSeq = 0;

const dom = {};
['q', 'category', 'region', 'district', 'city', 'service-other', 'insurance', 'classification', 'type', 'is24',
 'hasamb', 'results', 'results-count', 'results-title', 'pager', 'emergency-btn',
 'emergency-panel', 'locate-btn', 'locate-status', 'search-form', 'service-checks',
 'search-btn', 'search-feedback', 'suggestions', 'busy-legend',
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
  const seq = ++searchSeq;
  const params = currentParams();
  hideSuggestions();
  setLoading(dom['search-btn'], true);
  feedback(dom['search-feedback'], 'info', params.q ? `Searching for “${params.q}”…` : 'Searching…');
  showLoading(dom.results);
  dom.pager.replaceChildren();
  try {
    const body = await api('/facilities/search', params);
    if (seq !== searchSeq) return;
    renderResults(body, params);
  } catch (err) {
    if (seq !== searchSeq) return;
    showError(dom.results, err.message);
    dom['results-count'].textContent = '';
    feedback(dom['search-feedback'], 'error', `Search did not work: ${err.message}`, {
      label: 'Try again',
      onClick: search,
    });
  } finally {
    if (seq === searchSeq) setLoading(dom['search-btn'], false);
  }
}

/* What "Looking for" finds, in words: a laboratory search also finds
   hospitals and clinics that run one. */
const RESULT_NOUN = {
  hospital: ['hospital', 'hospitals'],
  clinic: ['clinic', 'clinics'],
  laboratory: ['place with a laboratory', 'places with a laboratory'],
  pharmacy: ['pharmacy', 'pharmacies'],
  imaging: ['place for scans and X-rays', 'places for scans and X-rays'],
  dental: ['place for dental care', 'places for dental care'],
  eye: ['place for eye care', 'places for eye care'],
  maternity: ['place for maternity care', 'places for maternity care'],
  hearse: ['hearse service', 'hearse services'],
  caregiver: ['caregiver', 'caregivers'],
};

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/* One sentence saying what was found, in the words the user searched with. */
function describeResults(body, params) {
  if (body.matched_place) {
    let text = `Found ${plural(body.place_total, 'facility', 'facilities')} in ${body.matched_place}`;
    const elsewhere = body.total - body.place_total;
    if (elsewhere > 0) text += `, and ${elsewhere.toLocaleString()} named after it elsewhere`;
    return `${text}.`;
  }
  const where = [params.city, params.district, params.region].find(Boolean);
  const [one, many] = RESULT_NOUN[params.category] || ['facility', 'facilities'];
  let text = `Found ${plural(body.total, one, many)}`;
  if (params.q) text += ` for “${params.q}”`;
  if (where) text += ` in ${where}`;
  if (state.coords) text += ', nearest first';
  return `${text}.`;
}

function renderResults(body, params) {
  dom['results-title'].textContent = state.coords ? 'Nearest facilities' : 'Facilities';
  dom['results-count'].textContent = plural(body.total, 'facility', 'facilities');

  if (!body.items.length) {
    const tried = params.q ? ` for “${params.q}”` : '';
    feedback(
      dom['search-feedback'],
      'empty',
      `No facilities found${tried}. Check the spelling, try a nearby town, or remove a filter.`
    );
    showEmpty(dom.results, 'Nothing matches yet. Try a nearby town or fewer filters.');
    return;
  }

  feedback(dom['search-feedback'], 'ok', describeResults(body, params));
  clear(dom.results);
  body.items.forEach((facility) => dom.results.appendChild(facilityCard(facility)));
  renderPager(body);
}

/* ---------- suggestions ------------------------------------------------
   Places first (choosing one lists everything there), then facilities
   (choosing one opens its profile). */
let suggestTimer;
let suggestSeq = 0;
let activeSuggestion = -1;

function hideSuggestions() {
  clearTimeout(suggestTimer);
  suggestSeq += 1;
  dom.suggestions.hidden = true;
  clear(dom.suggestions);
  dom.q.setAttribute('aria-expanded', 'false');
  dom.q.removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}

function suggestionRow(index, kind, title, detail, onChoose) {
  const row = el('li', {
    id: `suggestion-${index}`,
    role: 'option',
    class: `suggestion ${kind}`,
    'aria-selected': 'false',
  }, [
    el('span', { class: 'suggestion-kind', text: kind === 'place' ? 'Place' : 'Facility' }),
    el('span', { class: 'suggestion-text' }, [
      el('strong', { text: title }),
      el('span', { text: detail }),
    ]),
  ]);
  // mousedown, not click: it runs before the search box loses focus.
  row.addEventListener('mousedown', (event) => {
    event.preventDefault();
    onChoose();
  });
  return row;
}

async function loadSuggestions() {
  const text = dom.q.value.trim();
  if (text.length < 2) {
    hideSuggestions();
    return;
  }
  const seq = ++suggestSeq;
  let body;
  try {
    body = await api('/facilities/suggest', { q: text });
  } catch (err) {
    return; /* suggestions are a convenience; the Search button still works */
  }
  if (seq !== suggestSeq) return;

  const rows = [];
  body.places.forEach((p) => {
    const detail = `${p.region} · ${plural(p.count, 'listing', 'listings')}`;
    rows.push(suggestionRow(rows.length, 'place', p.name, detail, () => {
      dom.q.value = p.name;
      state.page = 1;
      search();
    }));
  });
  body.facilities.forEach((f) => {
    const detail = [CATEGORY_LABEL[f.category] || f.category, f.city || f.region].filter(Boolean).join(' · ');
    rows.push(suggestionRow(rows.length, 'facility', f.name, detail, () => {
      hideSuggestions();
      window.location.href = `facility.html?id=${f.id}`;
    }));
  });

  if (!rows.length) {
    hideSuggestions();
    return;
  }
  clear(dom.suggestions).append(...rows);
  activeSuggestion = -1;
  dom.suggestions.hidden = false;
  dom.q.setAttribute('aria-expanded', 'true');
}

function moveSuggestion(step) {
  const rows = Array.from(dom.suggestions.children);
  if (!rows.length) return;
  activeSuggestion = (activeSuggestion + step + rows.length) % rows.length;
  rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === activeSuggestion)));
  dom.q.setAttribute('aria-activedescendant', rows[activeSuggestion].id);
  rows[activeSuggestion].scrollIntoView({ block: 'nearest' });
}

dom.q.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(loadSuggestions, 250);
});
dom.q.addEventListener('keydown', (event) => {
  if (dom.suggestions.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggestion(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Escape') {
    hideSuggestions();
  } else if (event.key === 'Enter' && activeSuggestion >= 0) {
    event.preventDefault();
    dom.suggestions.children[activeSuggestion].dispatchEvent(new MouseEvent('mousedown'));
  }
});
dom.q.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
// The clear (x) inside the search box empties it: show everything again.
dom.q.addEventListener('search', () => {
  if (!dom.q.value) {
    state.page = 1;
    search();
  }
});

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
  dom['locate-status'].textContent = '';
  setLoading(dom['locate-btn'], true, 'Finding your location…');
  try {
    state.coords = await Location.request({ useCache: false });
    dom['locate-status'].textContent =
      'Using your location. Results are sorted by distance.';
  } catch (err) {
    state.coords = null;
    dom['locate-status'].textContent = err.message;
    feedback(dom['search-feedback'], 'error', err.message);
    dom.region.focus();
    return;
  } finally {
    setLoading(dom['locate-btn'], false);
  }
  state.page = 1;
  search();
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
// Every choice applies straight away; the Search button is for typed text.
dom.region.addEventListener('change', async () => {
  state.page = 1;
  await loadDistricts();
  search();
});
dom.district.addEventListener('change', async () => {
  state.page = 1;
  await loadLocalities();
  search();
});
['category', 'city', 'service-other', 'insurance', 'classification', 'type'].forEach((id) =>
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
  dom['busy-legend'].appendChild(busyLegend());
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
