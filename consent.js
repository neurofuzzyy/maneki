(() => {
  'use strict';

  const measurementId = 'G-SP2KYDQ9HW';
  const storageKey = 'maneki-analytics-consent';
  const validChoices = new Set(['granted', 'denied']);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  window.gtag('consent', 'default', {
    ad_personalization: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  const readChoice = () => {
    try {
      const choice = localStorage.getItem(storageKey);
      return validChoices.has(choice) ? choice : null;
    } catch {
      return null;
    }
  };

  const saveChoice = choice => {
    try {
      localStorage.setItem(storageKey, choice);
    } catch {
      // The choice still applies to this page when storage is unavailable.
    }
  };

  const updateGoogleConsent = analyticsStorage => {
    window.gtag('consent', 'update', {
      ad_personalization: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      analytics_storage: analyticsStorage
    });
  };

  const loadAnalytics = () => {
    window[`ga-disable-${measurementId}`] = false;
    updateGoogleConsent('granted');

    if (document.querySelector('script[data-maneki-analytics]')) {
      window.gtag('config', measurementId);
      return;
    }

    window.gtag('js', new Date());
    window.gtag('config', measurementId);

    const script = document.createElement('script');
    script.async = true;
    script.dataset.manekiAnalytics = '';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
  };

  const deleteAnalyticsCookies = () => {
    const cookieNames = document.cookie
      .split(';')
      .map(cookie => cookie.split('=')[0].trim())
      .filter(name => name === '_ga' || name.startsWith('_ga_'));

    const domain = location.hostname === 'maneki.studio' || location.hostname.endsWith('.maneki.studio')
      ? '; Domain=.maneki.studio'
      : '';

    cookieNames.forEach(name => {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      if (domain) document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
    });
  };

  const disableAnalytics = () => {
    window[`ga-disable-${measurementId}`] = true;
    updateGoogleConsent('denied');
    deleteAnalyticsCookies();
  };

  const banner = document.createElement('section');
  banner.className = 'privacy-banner';
  banner.setAttribute('aria-label', 'Analytics privacy choices');
  banner.setAttribute('role', 'dialog');
  banner.innerHTML = `
    <div class="privacy-banner-copy">
      <strong>Optional analytics</strong>
      <p>Maneki Studio uses Google Analytics only with your permission to understand which pages are useful. Declining does not affect the site. <a href="/privacy.html">Read the privacy policy</a>.</p>
      <span class="privacy-choice-status" aria-live="polite"></span>
    </div>
    <div class="privacy-banner-actions">
      <button type="button" data-consent="denied">Decline analytics</button>
      <button type="button" class="privacy-accept" data-consent="granted">Allow analytics</button>
    </div>`;

  const settingsButton = document.createElement('button');
  settingsButton.className = 'privacy-settings';
  settingsButton.type = 'button';
  settingsButton.textContent = 'Privacy choices';
  settingsButton.setAttribute('aria-label', 'Change analytics privacy choice');

  const status = banner.querySelector('.privacy-choice-status');
  const declineButton = banner.querySelector('[data-consent="denied"]');

  const showChoice = choice => {
    if (!choice) {
      status.textContent = '';
      banner.hidden = false;
      settingsButton.hidden = true;
      return;
    }

    status.textContent = `Current choice: analytics ${choice === 'granted' ? 'allowed' : 'declined'}.`;
    banner.hidden = true;
    settingsButton.hidden = false;
  };

  banner.addEventListener('click', event => {
    const choice = event.target.dataset.consent;
    if (!validChoices.has(choice)) return;

    saveChoice(choice);
    if (choice === 'granted') loadAnalytics();
    else disableAnalytics();
    showChoice(choice);
  });

  settingsButton.addEventListener('click', () => {
    showChoice(readChoice());
    banner.hidden = false;
    settingsButton.hidden = true;
    declineButton.focus();
  });

  document.body.append(banner, settingsButton);

  const savedChoice = readChoice();
  if (savedChoice === 'granted') loadAnalytics();
  else disableAnalytics();
  showChoice(savedChoice);
})();
