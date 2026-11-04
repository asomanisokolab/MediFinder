/* Cookie consent and analytics. Loaded by every public page after
   /site-config.js. Google Analytics only loads once a visitor accepts;
   with no measurement ID configured there are no optional cookies, so
   no banner is shown. Standalone: does not need api.js. */

(function () {
  const config = window.SITE_CONFIG || {};
  const measurementId = config.gaMeasurementId;
  const KEY = 'fc.cookies';

  function choice() {
    try {
      return localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (err) {
      /* private mode: ask again next visit */
    }
  }

  let analyticsLoaded = false;
  function loadAnalytics() {
    if (analyticsLoaded || !measurementId) return;
    analyticsLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
  }

  function clearAnalyticsCookies() {
    document.cookie.split(';').forEach((part) => {
      const name = part.split('=')[0].trim();
      if (name === '_ga' || name.startsWith('_ga_')) {
        const host = window.location.hostname.replace(/^www\./, '');
        document.cookie = `${name}=; Max-Age=0; path=/`;
        document.cookie = `${name}=; Max-Age=0; path=/; domain=.${host}`;
      }
    });
  }

  function showBanner() {
    if (document.getElementById('cookie-banner')) return;
    const banner = document.createElement('section');
    banner.id = 'cookie-banner';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.innerHTML =
      '<p><strong>Cookies</strong> We would like to use analytics cookies to see how ' +
      'FindCare Ghana is used and make it better. They are off unless you accept. ' +
      '<a href="/privacy.html#cookies">Read more</a></p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="secondary" data-choice="declined">Decline</button>' +
      '<button type="button" data-choice="accepted">Accept</button>' +
      '</div>';
    banner.addEventListener('click', (event) => {
      const value = event.target.getAttribute && event.target.getAttribute('data-choice');
      if (!value) return;
      remember(value);
      banner.remove();
      document.body.classList.remove('has-cookie-banner');
      if (value === 'accepted') loadAnalytics();
      else if (analyticsLoaded) window.location.reload();
      else clearAnalyticsCookies();
    });
    document.body.appendChild(banner);
    document.body.classList.add('has-cookie-banner');
  }

  function addSettingsLink() {
    const footer = document.querySelector('.footer-legal');
    if (!footer) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = 'Cookie settings';
    button.addEventListener('click', showBanner);
    footer.appendChild(button);
  }

  function init() {
    if (!measurementId) return;
    addSettingsLink();
    const current = choice();
    if (current === 'accepted') loadAnalytics();
    else if (current !== 'declined') showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
