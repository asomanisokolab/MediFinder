/* Contact us: organizations ask to be listed. Nothing here creates an
   account; a superadmin verifies the request and emails the login. */

const form = document.getElementById('contact-form');
const message = document.getElementById('contact-message');

function showMessage(text, kind = 'ok') {
  clear(message).appendChild(
    el('div', { class: kind, role: kind === 'error' ? 'alert' : 'status', text })
  );
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('contact-btn');
  button.disabled = true;
  clear(message);
  try {
    const result = await api('/contact', {}, {
      method: 'POST',
      auth: false,
      body: {
        facility_name: document.getElementById('facility-name').value.trim(),
        organization_type: document.getElementById('organization-type').value,
        phone: document.getElementById('phone').value.trim(),
        email: document.getElementById('email').value.trim(),
        contact_name: document.getElementById('contact-name').value.trim(),
        message: document.getElementById('message').value.trim(),
      },
    });
    form.reset();
    showMessage(result.message);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});
