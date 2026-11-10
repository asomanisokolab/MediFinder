/* Shared rendering: cards, chips, banners.
   Every screen that shows a facility or a provider goes through here, so
   the staleness and verification rules cannot drift between pages. */

const COST_LABEL = {
  free: 'No charge',
  low: 'Low cost',
  moderate: 'Moderate cost',
  premium: 'Premium cost',
};

const CATEGORY_LABEL = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  laboratory: 'Medical laboratory',
  pharmacy: 'Pharmacy / medical store',
  hearse: 'Hearse service',
  caregiver: 'Caregiver',
};

/* Kinds of care one facility can offer besides its main category
   (a hospital's laboratory, pharmacy or scan unit). */
const WARD_LABEL = { children: 'Children’s ward', female: 'Female ward', male: 'Male ward' };

const CARE_TYPE_LABEL = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  laboratory: 'Medical laboratory',
  pharmacy: 'Pharmacy',
  hearse: 'Hearse service',
  caregiver: 'Caregiving',
};

/* Beds and GHS levels only mean something for hospitals and clinics. */
function isHealthFacility(facility) {
  return facility.category === 'hospital' || facility.category === 'clinic';
}

/* Category, then GHS level where one applies, then the other kinds of
   care it offers ("Laboratory" on a hospital), then ownership. */
function facilityKindChips(facility) {
  const chips = [el('li', { class: 'chip', text: CATEGORY_LABEL[facility.category] || facility.category })];
  // Only a known category; "Private" (older data) would repeat the ownership chip.
  if (isHealthFacility(facility) && !['Private', 'Not classified'].includes(facility.classification)) {
    chips.push(el('li', { class: 'chip', text: facility.classification }));
  }
  const extra = (facility.care_types || []).filter((t) => t !== facility.category);
  extra.slice(0, 3).forEach((t) =>
    chips.push(el('li', { class: `chip care care-${t}`, text: `+ ${CARE_TYPE_LABEL[t] || t}` }))
  );
  if (extra.length > 3) chips.push(el('li', { class: 'chip care', text: `+${extra.length - 3} more` }));
  chips.push(el('li', {
    class: 'chip grey',
    text: facility.type === 'government' ? 'Government' : 'Private',
  }));
  return chips;
}

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
            'Listings come from public sources and have not been confirmed by the ' +
            'facilities. Some phone numbers are placeholders, and others may be out ' +
            'of date. In a real emergency call 112.',
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

/* ---------- busy status: red busy, yellow less busy, green not busy ---- */
const BUSY_SOURCE = {
  facility: 'Facility update',
  visitors: 'Visitor reports',
  predicted: 'Predicted',
  hours: 'Opening hours',
};

/* Colour, word and where it came from: a prediction is never shown as if
   someone had checked. */
function busyBadge(busy) {
  if (!busy) return null;
  const when = busy.updated_at ? ` · ${fmtWhen(busy.updated_at)}` : '';
  return el('p', { class: `busy busy-${busy.level}`, title: busy.detail }, [
    el('span', { class: 'busy-dot', 'aria-hidden': 'true' }),
    el('strong', { text: busy.label }),
    el('span', { class: 'busy-source', text: (BUSY_SOURCE[busy.source] || '') + when }),
  ]);
}

function busyLegend() {
  return el('p', { class: 'busy-legend' }, [
    el('span', { class: 'busy-key busy-busy' }, 'Busy'),
    el('span', { class: 'busy-key busy-less_busy' }, 'Less busy'),
    el('span', { class: 'busy-key busy-not_busy' }, 'Not busy'),
  ]);
}

/* ---------- feedback ---------------------------------------------------
   A status line for "what just happened" (results found, nothing found,
   saved, failed), read out by screen readers. kind: ok | info | empty | error */
function feedback(mount, kind, message, action) {
  if (!mount) return;
  clear(mount);
  mount.hidden = !message;
  mount.className = `feedback ${kind}`;
  if (!message) return;
  mount.append(el('span', { class: 'feedback-icon', 'aria-hidden': 'true' }), el('span', { text: message }));
  if (action) {
    mount.appendChild(el('button', { type: 'button', class: 'feedback-action', onclick: action.onClick }, action.label));
  }
}

/* A short message that fades on its own, for actions done away from the
   place they show up (a report sent, a profile saved). */
function toast(message, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const item = el('div', { class: `toast ${kind}` }, [
    el('span', { class: 'feedback-icon', 'aria-hidden': 'true' }),
    el('span', { text: message }),
  ]);
  host.appendChild(item);
  setTimeout(() => item.classList.add('leaving'), 3500);
  setTimeout(() => item.remove(), 4000);
}

/* Grey with a spinning circle while a request runs, and disabled so a
   second tap cannot send it twice. */
const _buttonContent = new WeakMap();
function setLoading(button, loading, label = 'Searching…') {
  if (!button) return;
  if (loading) {
    if (!_buttonContent.has(button)) _buttonContent.set(button, Array.from(button.childNodes));
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: label }));
  } else if (_buttonContent.has(button)) {
    button.replaceChildren(..._buttonContent.get(button));
    _buttonContent.delete(button);
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
  }
}

/* ---------- facility card -------------------------------------------- */
function facilityCard(facility, { showServices = true } = {}) {
  const chips = facilityKindChips(facility);
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
    busyBadge(facility.busy),
    el('ul', { class: 'chips' }, chips),
    isHealthFacility(facility) ? statusLine(facility.beds) : null,
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
    el('div', { class: 'loading', role: 'status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), ' ', message])
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
