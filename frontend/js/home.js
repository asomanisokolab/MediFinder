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
['q', 'category', 'region', 'district', 'city', 'service-other', 'insurance', 'classification', 'type', 'ward', 'is24',
 'hasamb', 'results', 'results-count', 'results-title', 'pager', 'emergency-btn',
 'emergency-panel', 'locate-btn', 'locate-status', 'search-form', 'service-checks',
 'search-btn', 'search-feedback', 'suggestions', 'busy-legend',
 'find-btn', 'search-summary', 'search-summary-value', 'change-search', 'search-title',
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
      el('option', { value: c.level, text: c.name, title: c.description })
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
    ward: dom.ward.value,
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

/* ---------- search ----------------------------------------------------
   collapse: the user pressed Search. If anything is found the form folds
   into a one-line summary and the results take the screen; if nothing is
   found the form stays open so they can change it. */
async function search({ collapse = false } = {}) {
  const seq = ++searchSeq;
  const params = currentParams();
  hideSuggestions();
  setLoading(dom['search-btn'], true);
  setLoading(dom['find-btn'], true);
  feedback(dom['search-feedback'], 'info', params.q ? `Searching for “${params.q}”…` : 'Searching…');
  showLoading(dom.results);
  dom.pager.replaceChildren();
  try {
    const body = await api('/facilities/search', params);
    if (seq !== searchSeq) return;
    renderResults(body, params);
    if (body.items.length && collapse) {
      foldSearch(params);
      showResults();
    } else if (!body.items.length) {
      unfoldSearch();
      if (collapse) dom['search-feedback'].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (err) {
    if (seq !== searchSeq) return;
    showError(dom.results, err.message);
    dom['results-count'].textContent = '';
    feedback(dom['search-feedback'], 'error', `Search did not work: ${err.message}`, {
      label: 'Try again',
      onClick: () => search({ collapse }),
    });
  } finally {
    if (seq === searchSeq) {
      setLoading(dom['search-btn'], false);
      setLoading(dom['find-btn'], false);
    }
  }
}

function newSearch() {
  state.page = 1;
  search({ collapse: true });
}

/* The choices behind the current results, in a few words. */
function searchSummary(params) {
  const option = (select) => select.options[select.selectedIndex];
  const parts = [];
  if (params.q) parts.push(`“${params.q}”`);
  if (params.category) parts.push(option(dom.category).text);
  if (params.classification) parts.push(params.classification);
  const where = [params.city, params.district, params.region].filter(Boolean);
  if (where.length) parts.push(where.join(', '));
  if (state.coords) parts.push('near you');
  const extra = params.service.length + [params.insurance, params.type, params.ward,
    params.is_24_hour, params.has_ambulance].filter(Boolean).length;
  if (extra) parts.push(extra === 1 ? '1 more filter' : `${extra} more filters`);
  return parts.length ? parts.join(' · ') : 'All types of care, all of Ghana';
}

function foldSearch(params) {
  dom['search-summary-value'].textContent = searchSummary(params);
  dom['search-summary'].hidden = false;
  dom['search-form'].hidden = true;
}

function unfoldSearch() {
  dom['search-summary'].hidden = true;
  dom['search-form'].hidden = false;
}

/* Bring the results into view and move keyboard and screen-reader focus there. */
function showResults() {
  dom['results-title'].focus({ preventScroll: true });
  dom['search-title'].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* What "Looking for" finds, in words: a laboratory search also finds
   hospitals and clinics that run one. */
const RESULT_NOUN = {
  hospital: ['hospital', 'hospitals'],
  clinic: ['clinic', 'clinics'],
  laboratory: ['place with a medical laboratory', 'places with a medical laboratory'],
  pharmacy: ['pharmacy', 'pharmacies'],
  hearse: ['hearse service', 'hearse services'],
  caregiver: ['caregiver', 'caregivers'],
};

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/* One sentence saying what was found, in the words the user searched with. */
function describeResults(body, params) {
  const [one, many] = RESULT_NOUN[params.category] || ['facility', 'facilities'];
  if (body.matched_place) {
    let text = `Found ${plural(body.place_total, one, many)} in ${body.matched_place}`;
    const elsewhere = body.total - body.place_total;
    if (elsewhere > 0) text += `, and ${elsewhere.toLocaleString()} named after it elsewhere`;
    return `${text}.`;
  }
  const where = [params.city, params.district, params.region].find(Boolean);
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
      newSearch();
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
  newSearch();
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
  newSearch();
});
dom['find-btn'].addEventListener('click', newSearch);
dom['change-search'].addEventListener('click', () => {
  unfoldSearch();
  dom['search-title'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  dom.q.focus({ preventScroll: true });
});
dom['emergency-btn'].addEventListener('click', emergency);
// The sticky phone bar links here with ?emergency=1; on this page, skip the reload.
document.getElementById('mobile-emergency').addEventListener('click', (event) => {
  event.preventDefault();
  emergency();
});
dom['locate-btn'].addEventListener('click', locate);
// Choices only fill in the narrower lists; nothing is searched until the
// user presses Search.
dom.region.addEventListener('change', loadDistricts);
dom.district.addEventListener('change', loadLocalities);

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
