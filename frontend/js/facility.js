/* Facility profile page (PRD 5.1.3). */

const mount = document.getElementById('profile');

function chipList(values, className = 'chip') {
  return el(
    'ul',
    { class: 'chips' },
    values.map((v) => el('li', { class: className, text: v }))
  );
}

function render(facility) {
  clear(mount);

  const header = [
    el('h1', { text: facility.name }),
    el('p', { class: 'lede', text: placeLine(facility.address, facility.region) }),
  ];

  const badges = facilityKindChips(facility);
  if (facility.is_24_hour) badges.push(el('li', { class: 'chip green', text: 'Open 24 hours' }));
  badges.push(...verificationChips(facility));
  if (facility.distance_km !== null && facility.distance_km !== undefined) {
    badges.push(el('li', { class: 'chip', text: `${fmtDistance(facility.distance_km)} away` }));
  }

  mount.append(...header, el('ul', { class: 'chips' }, badges));

  /* actions */
  mount.appendChild(
    el('div', { class: 'actions', style: 'margin:16px 0' }, [
      el('a', { class: 'btn', href: telHref(facility.phone) }, 'Call facility'),
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
    ])
  );

  /* beds -- PRD 5.1.3 and 7.3 */
  const beds = facility.beds || { display: 'Not updated', is_stale: true };
  if (isHealthFacility(facility)) mount.appendChild(
    el('section', { class: 'card' }, [
      el('h2', { style: 'margin-top:0', text: 'Bed availability' }),
      statusLine(beds),
      el('p', {
        class: 'notice',
        text: beds.is_stale
          ? 'This facility has not updated its bed count in the last 24 hours. Call before travelling.'
          : 'Updated by facility staff. Call to confirm before travelling.',
      }),
    ])
  );

  /* ambulance -- PRD v1.1 5.1.3 */
  const ambulanceBody = [el('h2', { style: 'margin-top:0', text: 'Ambulance' })];
  if (facility.has_ambulance) {
    ambulanceBody.push(el('p', { text: 'This facility operates its own ambulance.' }));
    if (facility.ambulance_phone) {
      ambulanceBody.push(
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn', href: telHref(facility.ambulance_phone) }, 'Call ambulance'),
          facility.ambulance_provider_id
            ? el(
                'a',
                {
                  class: 'btn secondary',
                  href: `ambulance.html?id=${facility.ambulance_provider_id}`,
                },
                'Provider details'
              )
            : null,
        ])
      );
    }
    ambulanceBody.push(
      el('p', {
        class: 'notice',
        text: 'FindCare places the call. It does not dispatch an ambulance.',
      })
    );
  } else {
    ambulanceBody.push(
      el('p', { text: 'This facility does not operate its own ambulance.' }),
      el('div', { class: 'actions' }, [
        el(
          'a',
          { class: 'btn secondary', href: `ambulance.html?region=${encodeURIComponent(facility.region)}` },
          'Find ambulance providers'
        ),
      ])
    );
  }
  mount.appendChild(el('section', { class: 'card' }, ambulanceBody));

  /* services */
  const active = facility.service_detail.filter((s) => s.is_active).map((s) => s.service_name);
  const inactive = facility.service_detail.filter((s) => !s.is_active).map((s) => s.service_name);
  const servicesBody = [el('h2', { style: 'margin-top:0', text: 'Services' })];
  if (active.length) {
    servicesBody.push(chipList(active));
  } else {
    servicesBody.push(el('p', { class: 'notice', text: 'No services listed.' }));
  }
  if (inactive.length) {
    servicesBody.push(
      el('p', { class: 'notice', style: 'margin-top:12px', text: 'Temporarily unavailable:' }),
      chipList(inactive, 'chip amber')
    );
  }
  mount.appendChild(el('section', { class: 'card' }, servicesBody));

  /* insurance */
  mount.appendChild(
    el('section', { class: 'card' }, [
      el('h2', { style: 'margin-top:0', text: 'Insurance accepted' }),
      facility.insurance.length
        ? chipList(facility.insurance, 'chip green')
        : el('p', { class: 'notice', text: 'No insurance information recorded.' }),
    ])
  );

  /* details */
  mount.appendChild(
    el('section', { class: 'card' }, [
      el('h2', { style: 'margin-top:0', text: 'Details' }),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Opening hours' }),
        el('dd', { text: facility.hours || 'Not recorded' }),
        el('dt', { text: 'Phone' }),
        el('dd', { text: facility.phone || 'Not recorded' }),
        /^https?:\/\//.test(facility.website) ? el('dt', { text: 'Website' }) : null,
        /^https?:\/\//.test(facility.website)
          ? el('dd', {}, [el('a', { href: facility.website, target: '_blank', rel: 'noopener nofollow', text: facility.website.replace(/^https?:\/\//, '') })])
          : null,
        el('dt', { text: 'Region' }),
        el('dd', { text: facility.region }),
        facility.district ? el('dt', { text: 'District / municipal' }) : null,
        facility.district ? el('dd', { text: facility.district }) : null,
        el('dt', { text: 'City or town' }),
        el('dd', { text: facility.city || 'Not recorded' }),
        facility.town && facility.town !== facility.city ? el('dt', { text: 'Community' }) : null,
        facility.town && facility.town !== facility.city ? el('dd', { text: facility.town }) : null,
        el('dt', { text: 'GPS coordinates' }),
        el('dd', { text: `${facility.lat.toFixed(5)}, ${facility.lng.toFixed(5)}` }),
        // PRD 5.1.3: last data verification date is shown on the profile.
        el('dt', { text: 'Last verified' }),
        el('dd', {
          text: facility.last_verified
            ? fmtWhen(facility.last_verified)
            : 'Never verified by this facility',
        }),
        el('dt', { text: 'Record last updated' }),
        el('dd', { text: fmtWhen(facility.last_updated) }),
      ]),
      // "osm+seed": a hand-entered record merged with its OpenStreetMap twin.
      SOURCE_CREDIT[facility.source.replace('+seed', '')]
        ? el('p', { class: 'notice', html: SOURCE_CREDIT[facility.source.replace('+seed', '')] })
        : null,
    ])
  );
}

/* Attribution required by the open-data licences of imported records. */
const SOURCE_CREDIT = {
  osm: 'Listing data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL). Not yet confirmed by the facility.',
  'who-ssa': 'Listing data from the WHO list of public health facilities in sub-Saharan Africa (CC BY 4.0). Not yet confirmed by the facility.',
};

/* Page description and canonical link for this facility, for search engines
   and link previews. */
function describePage(facility) {
  const kind = CATEGORY_LABEL[facility.category] || 'Health facility';
  const place = [facility.city || facility.town, facility.region].filter(Boolean).join(', ');
  const description =
    `${facility.name}: ${kind.toLowerCase()} in ${place}. ` +
    'Phone number, services, opening hours and directions on FindCare Ghana.';
  const url = `https://findcareghana.com/facility.html?id=${encodeURIComponent(facility.id)}`;
  document.querySelector('meta[name="description"]').setAttribute('content', description);
  document.querySelector('meta[property="og:title"]').setAttribute('content', document.title);
  document.querySelector('meta[property="og:description"]').setAttribute('content', description);
  document.head.appendChild(el('link', { rel: 'canonical', href: url }));
}

(async function init() {
  renderDataBanner('banner');
  const id = qs('id');
  if (!id) {
    // Bare facility.html is not a page of its own; keep it out of search.
    document.head.appendChild(el('meta', { name: 'robots', content: 'noindex' }));
  }
  if (!id) {
    showError(mount, 'No facility selected.');
    return;
  }
  showLoading(mount, 'Loading facility…');
  const coords = Location.cached() || {};
  try {
    const facility = await api(`/facilities/${encodeURIComponent(id)}`, coords);
    document.title = `${facility.name} — FindCare Ghana`;
    describePage(facility);
    render(facility);
  } catch (err) {
    showError(mount, err.message);
  }
})();
