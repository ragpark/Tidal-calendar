// HeyCatch init for the React app bundle. Imported first from src/main.jsx so it runs at module
// scope on every page the app serves, before anything else evaluates.
import { analytics } from '@heycatch/sdk';
import { HEYCATCH_BASE_CONFIG, connectConsentBanner } from './config.js';

analytics.init(HEYCATCH_BASE_CONFIG);
connectConsentBanner(analytics);
