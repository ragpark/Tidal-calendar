// HeyCatch init for the server-rendered content pages that do not load the React bundle
// (the /vs/ comparison pages). Those pages are multi-page: every link is a full page load, so
// events are sent as they happen rather than batched.
import { analytics } from '@heycatch/sdk';
import { HEYCATCH_BASE_CONFIG, connectConsentBanner } from './config.js';

analytics.init({ ...HEYCATCH_BASE_CONFIG, requestBatching: false });
connectConsentBanner(analytics);
