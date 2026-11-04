/* Contact us: organizations ask to be listed. Nothing here creates an
   account; a superadmin verifies the request and emails the login. */

const form = document.getElementById('contact-form');
const message = document.getElementById('contact-message');
const button = document.getElementById('contact-btn');

const FIELD_ERRORS = {
  'facility-name': 'Enter the name of your facility or business.',
  'organization-type': 'Choose the type of care you provide.',
  phone: 'Enter a phone number we can call, for example +233 24 000 0000.',
  email: 'Enter an email address like name@example.com.',
};

function showMessage(text, kind = 'ok') {
  clear(message).appendChild(
    el('div', { class: kind, role: kind === 'error' ? 'alert' : 'status', text })
  );
}

/* Shows or clears the message under one field. Returns true when valid. */
function checkField(input) {
  const errorId = `${input.id}-error`;
  let error = document.getElementById(errorId);
  if (input.checkValidity()) {
    input.removeAttribute('aria-invalid');
    if (error) error.remove();
    return true;
  }
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', errorId);
  if (!error) {
    error = el('p', { class: 'field-error', id: errorId });
    input.insertAdjacentElement('afterend', error);
  }
  error.textContent = FIELD_ERRORS[input.id] || input.validationMessage;
  return false;
}

form.setAttribute('novalidate', '');
form.querySelectorAll('input, select, textarea').forEach((input) => {
  // Validate after the visitor leaves a field, then live while they fix it.
  input.addEventListener('blur', () => {
    if (input.value) checkField(input);
  });
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid')) checkField(input);
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clear(message);
  const invalid = [...form.elements].filter(
    (input) => input.willValidate && !checkField(input)
  );
  if (invalid.length) {
    showMessage(
      invalid.length === 1 ? 'Please fix the highlighted field.' : `Please fix the ${invalid.length} highlighted fields.`,
      'error'
    );
    invalid[0].focus();
    return;
  }

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  clear(button).append(el('span', { class: 'spinner light', 'aria-hidden': 'true' }), 'Sending…');
  try {
    await api('/contact', {}, {
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
    window.location.assign('/thank-you.html');
  } catch (err) {
    showMessage(err.message, 'error');
    message.scrollIntoView({ block: 'center', behavior: 'smooth' });
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Send request';
  }
});
