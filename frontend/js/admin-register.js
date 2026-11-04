const form = document.getElementById('registration-form');
const message = document.getElementById('registration-message');
const scope = document.getElementById('scope');
const facilitySelect = document.getElementById('facility');
const providerSelect = document.getElementById('provider');

function showMessage(text, kind = 'ok') {
  clear(message).appendChild(
    el('div', { class: kind, role: kind === 'error' ? 'alert' : 'status', text })
  );
}

async function loadOrganizations() {
  try {
    const [facilities, providers] = await Promise.all([
      api('/facilities', { page_size: 100 }, { auth: false }),
      api('/ambulance/providers', { page_size: 100 }, { auth: false }),
    ]);
    for (const facility of facilities.items) {
      facilitySelect.appendChild(el('option', {
        value: facility.id,
        text: `${facility.name} — ${facility.region}`,
      }));
    }
    for (const provider of providers.items) {
      providerSelect.appendChild(el('option', {
        value: provider.id,
        text: `${provider.name} — ${provider.region}`,
      }));
    }
  } catch (err) {
    showMessage(`Could not load the organization list: ${err.message}`, 'error');
    document.getElementById('registration-btn').disabled = true;
  }
}

scope.addEventListener('change', () => {
  const isFacility = scope.value === 'facility';
  document.getElementById('facility-field').hidden = !isFacility;
  document.getElementById('provider-field').hidden = scope.value !== 'provider';
  facilitySelect.required = isFacility;
  providerSelect.required = scope.value === 'provider';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('registration-btn');
  button.disabled = true;
  clear(message);
  const accountScope = scope.value;
  try {
    const result = await api('/admin/register', {}, {
      method: 'POST',
      auth: false,
      body: {
        full_name: document.getElementById('full-name').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
        scope: accountScope,
        facility_id: accountScope === 'facility' ? Number(facilitySelect.value) : null,
        provider_id: accountScope === 'provider' ? Number(providerSelect.value) : null,
      },
    });
    form.reset();
    document.getElementById('facility-field').hidden = true;
    document.getElementById('provider-field').hidden = true;
    facilitySelect.required = false;
    providerSelect.required = false;
    showMessage(result.message);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

loadOrganizations();
