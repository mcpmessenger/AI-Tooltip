const CONFIG = {
  /**
   * Total number of free tooltips a new user can trigger before being asked to upgrade.
   * Set to 1000 for development and testing.
   */
  FREE_TIER_LIMIT: 1000,
  /**
   * Developer-managed API key that will be used for the free tier.
   * DO NOT commit your real key. Copy this file to `config.js` and populate it locally.
   */
  DEFAULT_FREE_API_KEY: '',
  /**
   * Google OAuth Client ID (e.g. from Google Cloud Console).
   * Used when launching the Google sign-in flow from the popup.
   */
  GOOGLE_OAUTH_CLIENT_ID: ''
};

// Expose CONFIG to service workers, content scripts, and popups.
if (typeof self !== 'undefined') {
  self.CONFIG = CONFIG;
}
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
