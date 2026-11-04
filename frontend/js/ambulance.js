/* Ambulance directory and provider detail (PRD v1.1 5.1.6). */

const view = {
  directory: document.getElementById('directory'),
  detail: document.getElementById('detail'),
  results: document.getElementById('results'),
  count: document.getElementById('results-count'),
  title: document.getElementById('results-title'),
  pager: document.getElementById('pager'),
  region: document.getElementById('region'),
  level: document.getElementById('level'),
  operator: document.getElementById('operator'),
  q: document.getElementById('q'),
  locateBtn: document.getElementById('locate-btn'),
  locateStatus: document.getElementById('locate-status'),
};

const st = { page: 1, coords: null, covering: false };

/* ---------- detail --------------------------------------------------- */
async function renderDetail(id) {
  view.directory.hidden = true;
  view.detail.hidden = false;
  showLoading(view.detail, 'Loading provider…');

  try {
    const p = await api(`/ambulance/providers/${encodeURIComponent(id)}`, Location.cached() || {});
    document.title = `${p.name} — FindCare Ghana`;
    const mount = clear(view.detail);

    mount.appendChild(el('p', { style: 'margin:16px 0 0' }, [
      el('a', { href: 'ambulance.html' }, '← All ambulance providers'),
    ]));
    mount.appendChild(el('h1', { text: p.name }));
    mount.appendChild(
      el('p', { class: 'lede', text: placeLine(p.base_address, p.region) })
    );

    const chips = [
      el('li', {
        class: p.service_level === 'ALS' ? 'chip green' : 'chip',
        text: p.service_level === 'ALS' ? 'ALS — Advanced Life Support' : 'BLS — Basic Life Support',
      }),
      el('li', {
        class: 'chip grey',
        text:
          p.operator_type === 'government'
            ? 'Government'
            : p.operator_type === 'private'
            ? 'Private'
            : 'Hospital unit',
      }),
    ];
    if (p.is_24_hour) chips.push(el('li', { class: 'chip green', text: 'Available 24 hours' }));
    if (p.cost_band) {
      chips.push(el('li', { class: 'chip grey', text: COST_LABEL[p.cost_band] || p.cost_band }));
    }
    if (!p.phone_verified_at) {
      chips.push(el('li', { class: 'chip amber', text: 'Number not verified' }));
    }
    if (p.covers_user_area === true) {
      chips.push(el('li', { class: 'chip green', text: 'Covers your area' }));
    } else if (p.covers_user_area === false) {
      chips.push(el('li', { class: 'chip amber', text: 'Outside your area' }));
    }
    mount.appendChild(el('ul', { class: 'chips' }, chips));

    mount.appendChild(
      el('p', {
        class: 'disclaimer',
        style: 'margin-top:16px',
        text:
          'FindCare places the call. It does not dispatch an ambulance. ' +
          'If no one answers, call 112.',
      })
    );

    const actions = [el('a', { class: 'btn', href: telHref(p.phone) }, 'Call provider')];
    if (p.alt_phone) {
      actions.push(el('a', { class: 'btn secondary', href: telHref(p.alt_phone) }, 'Alternate number'));
    }
    actions.push(el('a', { class: 'btn secondary', href: 'tel:112' }, 'Call 112'));
    mount.appendChild(el('div', { class: 'actions', style: 'margin:16px 0' }, actions));

    mount.appendChild(
      el('section', { class: 'card' }, [
        el('h2', { style: 'margin-top:0', text: 'Fleet status' }),
        statusLine(p.status),
        el('p', {
          class: 'notice',
          text: p.status && p.status.is_stale
            ? 'This provider has not updated its fleet in the last 24 hours. Call to confirm, and try a second provider if no one answers.'
            : 'Updated by the provider. Call to confirm.',
        }),
      ])
    );

    const areas = p.coverage.map((c) => (c.district ? `${c.district}, ${c.region}` : `${c.region} (all districts)`));
    mount.appendChild(
      el('section', { class: 'card' }, [
        el('h2', { style: 'margin-top:0', text: 'Areas covered' }),
        areas.length
          ? el('ul', { class: 'chips' }, areas.map((a) => el('li', { class: 'chip', text: a })))
          : el('p', { class: 'notice', text: 'No coverage recorded.' }),
      ])
    );

    mount.appendChild(
      el('section', { class: 'card' }, [
        el('h2', { style: 'margin-top:0', text: 'Details' }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'Dispatch number' }),
          el('dd', { text: p.phone }),
          el('dt', { text: 'Number verified' }),
          el('dd', {
            text: p.phone_verified_at
              ? fmtWhen(p.phone_verified_at)
              : 'Not yet verified by a call',
          }),
          el('dt', { text: 'Base station' }),
          el('dd', { text: p.base_address || 'Not recorded' }),
          el('dt', { text: 'Hours' }),
          el('dd', { text: p.hours || 'Not recorded' }),
          el('dt', { text: 'Record last updated' }),
          el('dd', { text: fmtWhen(p.last_updated) }),
        ]),
      ])
    );
  } catch (err) {
    showError(view.detail, err.message);
  }
}

/* ---------- directory ------------------------------------------------- */
async function loadRegions() {
  const regions = await api('/regions');
  regions.forEach((r) => view.region.appendChild(el('option', { value: r, text: r })));
  const preset = qs('region');
  if (preset && regions.includes(preset)) view.region.value = preset;
}

async function loadProviders() {
  showLoading(view.results, 'Finding providers…');
  clear(view.pager);
  try {
    if (st.covering && st.coords) {
      const body = await api('/ambulance/covering', {
        ...st.coords,
        service_level: view.level.value,
        limit: 20,
      });
      view.title.textContent = 'Providers covering your area';
      view.count.textContent = `${body.items.length} shown`;
      if (!body.items.length) {
        showEmpty(view.results, 'No provider listed for your area yet. Call 112.');
        return;
      }
      clear(view.results);
      body.items.forEach((p) => view.results.appendChild(ambulanceCard(p)));
      return;
    }

    const body = await api('/ambulance/providers', {
      region: view.region.value,
      service_level: view.level.value,
      operator_type: view.operator.value,
      q: view.q.value.trim(),
      page: st.page,
      page_size: 20,
      ...(st.coords || {}),
    });

    view.title.textContent = 'Providers';
    view.count.textContent = body.total === 1 ? '1 provider' : `${body.total} providers`;
    if (!body.items.length) {
      showEmpty(view.results, 'No providers match those filters.');
      return;
    }
    clear(view.results);
    body.items.forEach((p) => view.results.appendChild(ambulanceCard(p)));

    if (body.pages > 1) {
      view.pager.append(
        el('button', {
          class: 'secondary',
          disabled: body.page <= 1,
          onclick: () => { st.page -= 1; loadProviders(); window.scrollTo({ top: 0 }); },
        }, 'Previous'),
        el('span', { text: `Page ${body.page} of ${body.pages}` }),
        el('button', {
          class: 'secondary',
          disabled: body.page >= body.pages,
          onclick: () => { st.page += 1; loadProviders(); window.scrollTo({ top: 0 }); },
        }, 'Next')
      );
    }
  } catch (err) {
    showError(view.results, err.message);
  }
}

async function locate() {
  view.locateBtn.disabled = true;
  view.locateStatus.textContent = 'Finding your location…';
  try {
    st.coords = await Location.request({ useCache: false });
    st.covering = true;
    view.locateStatus.textContent =
      'Showing providers whose coverage includes your location, nearest first.';
    await loadProviders();
  } catch (err) {
    view.locateStatus.textContent = err.message;
    view.region.focus();
  } finally {
    view.locateBtn.disabled = false;
  }
}

/* ---------- init ------------------------------------------------------ */
(async function init() {
  const id = qs('id');
  if (id) {
    renderDetail(id);
    return;
  }

  renderDataBanner('banner');
  view.locateBtn.addEventListener('click', locate);
  ['region', 'level', 'operator'].forEach((key) =>
    view[key].addEventListener('change', () => {
      st.page = 1;
      st.covering = false;
      loadProviders();
    })
  );
  let timer;
  view.q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      st.page = 1;
      st.covering = false;
      loadProviders();
    }, 350);
  });
  document.getElementById('filter-form').addEventListener('submit', (e) => e.preventDefault());

  try {
    await loadRegions();
  } catch (err) {
    showError(view.results, err.message);
    return;
  }
  st.coords = Location.cached();
  loadProviders();
})();
