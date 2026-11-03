/* Shared rendering: cards, chips, banners.
   Every screen that shows a facility or a provider goes through here, so
   the staleness and verification rules cannot drift between pages. */

const COST_LABEL = {
  free: 'No charge',
  low: 'Low cost',
  moderate: 'Moderate cost',
  premium: 'Premium cost',
};

/* PRD 7.1: while the dataset is unverified, say so on every screen. */
async function renderDataBanner(target) {
  const mount = typeof target === 'string' ? document.getElementById(target) : target;
  if (!mount) return;
  try {
    const health = await api('/health', {}, { auth: false });
    if (health.data_verified) return;
    mount.appendChild(
      el('div', { class: 'banner warn', role: 'note' }, [
        el('strong', { text: 'Unverified directory data' }),
        el('span', {
          text:
            'Facility and ambulance details here are seed data and have not been ' +
            'confirmed. Phone numbers are placeholders and will not connect. ' +
            'In a real emergency call 112.',
        }),
      ])
    );
  } catch (err) {
    /* the banner is advisory; never block the page on it */
  }
}

/* Addresses often already end with the region ("Accra, Greater Accra"),
   so only append it when it is genuinely missing. */
function placeLine(address, region) {
  if (address && region && address.toLowerCase().includes(region.toLowerCase())) return address;
  return [address, region].filter(Boolean).join(' · ');
}

function verificationChips(record) {
  const chips = [];
  if (record.verified) {
    chips.push(el('li', { class: 'chip green', text: 'Verified profile' }));
  } else {
    chips.push(el('li', { class: 'chip grey', text: 'Unverified' }));
  }
  return chips;
}

function statusLine(status) {
  if (!status) return null;
  const cls = status.is_stale ? 'status stale' : 'status fresh';
  const when = status.updated_at ? ` · updated ${fmtWhen(status.updated_at)}` : '';
  return el('p', { class: cls, text: status.display + (status.is_stale ? '' : when) });
}

/* ---------- facility card -------------------------------------------- */
function facilityCard(facility, { showServices = true } = {}) {
  const chips = [
    el('li', { class: 'chip', text: facility.classification }),
    el('li', {
      class: 'chip grey',
      text: facility.type === 'government' ? 'Government' : 'Private',
    }),
  ];
  if (facility.is_24_hour) chips.push(el('li', { class: 'chip green', text: 'Open 24 hours' }));
  if (facility.has_ambulance) chips.push(el('li', { class: 'chip red', text: 'Has ambulance' }));
  if (showServices && facility.services && facility.services.includes('Dental')) {
    chips.push(el('li', { class: 'chip dental', text: 'Dental' }));
  }
  chips.push(...verificationChips(facility));

  const actions = [
    el(
      'a',
      { class: 'btn', href: telHref(facility.phone), 'aria-label': `Call ${facility.name}` },
      'Call'
    ),
    el(
      'a',
      {
        class: 'btn secondary',
        href: directionsHref(facility.lat, facility.lng),
        target: '_blank',
        rel: 'noopener',
      },
      'Directions'
    ),
    el('a', { class: 'btn secondary', href: `facility.html?id=${facility.id}` }, 'Details'),
  ];

  return el('article', { class: 'card' }, [
    el('div', { class: 'top' }, [
      el('div', {}, [
        el('h3', {}, [el('a', { href: `facility.html?id=${facility.id}`, text: facility.name })]),
        el('p', {
          class: 'meta',
          text: [facility.city, facility.region].filter(Boolean).join(', '),
        }),
      ]),
      facility.distance_km !== null && facility.distance_km !== undefined
        ? el('span', { class: 'distance', text: fmtDistance(facility.distance_km) })
        : null,
    ]),
    el('ul', { class: 'chips' }, chips),
    statusLine(facility.beds),
    el('div', { class: 'actions' }, actions),
  ]);
}

/* ---------- ambulance card ------------------------------------------- */
function ambulanceCard(provider) {
  const chips = [
    el('li', {
      class: provider.service_level === 'ALS' ? 'chip green' : 'chip',
      text: provider.service_level === 'ALS' ? 'ALS · Advanced' : 'BLS · Basic',
    }),
    el('li', {
      class: 'chip grey',
      text:
        provider.operator_type === 'government'
          ? 'Government'
          : provider.operator_type === 'private'
          ? 'Private'
          : 'Hospital unit',
    }),
  ];
  if (provider.covers_user_area === true) {
    chips.push(el('li', { class: 'chip green', text: 'Covers your area' }));
  } else if (provider.covers_user_area === false) {
    chips.push(el('li', { class: 'chip amber', text: 'Outside your area' }));
  }
  if (provider.cost_band) {
    chips.push(el('li', { class: 'chip grey', text: COST_LABEL[provider.cost_band] || provider.cost_band }));
  }
  if (!provider.phone_verified_at) {
    chips.push(el('li', { class: 'chip amber', text: 'Number not verified' }));
  }

  const actions = [
    el(
      'a',
      {
        class: 'btn',
        href: telHref(provider.phone),
        'aria-label': `Call ${provider.name}`,
      },
      'Call provider'
    ),
    el('a', { class: 'btn secondary', href: `ambulance.html?id=${provider.id}` }, 'Details'),
  ];

  return el('article', { class: 'card' }, [
    el('div', { class: 'top' }, [
      el('div', {}, [
        el('h3', {}, [el('a', { href: `ambulance.html?id=${provider.id}`, text: provider.name })]),
        el('p', {
          class: 'meta',
          text: [provider.district, provider.region].filter(Boolean).join(', '),
        }),
      ]),
      provider.distance_km !== null && provider.distance_km !== undefined
        ? el('span', { class: 'distance', text: fmtDistance(provider.distance_km) })
        : null,
    ]),
    el('ul', { class: 'chips' }, chips),
    statusLine(provider.status),
    el('div', { class: 'actions' }, actions),
  ]);
}

function showError(mount, message) {
  clear(mount).appendChild(el('div', { class: 'error', role: 'alert', text: message }));
}

function showLoading(mount, message = 'Searching…') {
  clear(mount).appendChild(
    el('div', { class: 'loading' }, [el('span', { class: 'spinner' }), ' ', message])
  );
}

function showEmpty(mount, message) {
  clear(mount).appendChild(el('div', { class: 'empty', text: message }));
}

/* Marks the current page in the header nav. */
function markNav() {
  const here = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('header.site nav a').forEach((link) => {
    if (link.getAttribute('href') === here) link.setAttribute('aria-current', 'page');
  });
}
document.addEventListener('DOMContentLoaded', markNav);
