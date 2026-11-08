// HeyCatch analytics configuration shared by the app bundle and the static-page entry.
// Installed per https://heycatch.ai/agents.md. The project key is publishable, so it is inlined.
export const HEYCATCH_PROJECT_KEY = 'hck_pk_LN4a3dywhgOw9klTYq0McRJnWF_8r7Mh';

export const HEYCATCH_BASE_CONFIG = {
  projectKey: HEYCATCH_PROJECT_KEY,
  install: {
    framework: 'react',
    frameworkVersion: '18',
    agent: 'claude-code',
  },
  // This project is the marketing site / landing page; the booking app lives behind sign-in on the same host.
  site: 'landing',
  // The site's cookie banner gates analytics as a whole (Silktide "Analytics" category), so nothing is
  // captured or stored until the visitor agrees. public/index.html calls optInCapturing()/optOutCapturing().
  optOutCapturingByDefault: true,
};

/**
 * Expose the SDK to the inline cookie-banner handlers in public/index.html and replay a consent
 * decision that was recorded before this module evaluated (the banner script runs first).
 */
export const connectConsentBanner = (analytics) => {
  if (typeof window === 'undefined') return;
  window.heycatch = analytics;
  if (window.__heycatchConsent === true) analytics.optInCapturing();
};
