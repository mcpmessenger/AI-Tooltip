// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key-input');
  const saveButton = document.getElementById('save-button');
  const statusMessage = document.getElementById('status-message');
  const usageCount = document.getElementById('usage-count');
  const upgradeButton = document.getElementById('upgrade-button');

  const FALLBACK_CONFIG = {
    FREE_TIER_LIMIT: 100,
    GOOGLE_OAUTH_CLIENT_ID: ''
  };
  const CONFIG = window.CONFIG ? { ...FALLBACK_CONFIG, ...window.CONFIG } : FALLBACK_CONFIG;
  const FREE_TIER_LIMIT = typeof CONFIG.FREE_TIER_LIMIT === 'number' ? CONFIG.FREE_TIER_LIMIT : 100;
  const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_OAUTH_CLIENT_ID;

  const usageSection = document.getElementById('usage-section');
  const renderUsage = (data) => {
    const subscriptionStatus = data.subscriptionStatus || 'free';
    const hasCustomKey = Boolean(data.llmApiKey);
    if (subscriptionStatus === 'paid' || hasCustomKey || subscriptionStatus === 'custom') {
      usageCount.textContent = '✨ Unlimited tooltips enabled.';
      if (usageSection) {
        usageSection.classList.add('unlimited');
      }
      return;
    }
    if (usageSection) {
      usageSection.classList.remove('unlimited');
    }
    const used = Number.isFinite(data.freeTooltipsUsed) ? data.freeTooltipsUsed : 0;
    const remaining = Math.max(FREE_TIER_LIMIT - used, 0);
    usageCount.textContent = `${remaining} of ${FREE_TIER_LIMIT} free tooltips remaining`;
  };

  const loadState = () => {
    chrome.storage.sync.get(['llmApiKey', 'freeTooltipsUsed', 'subscriptionStatus'], (data) => {
      if (data.llmApiKey) {
        apiKeyInput.value = data.llmApiKey;
        statusMessage.textContent = 'API Key loaded.';
        statusMessage.className = '';
      } else {
        statusMessage.textContent = 'Use the shared free tier or add your own LLM API key.';
        statusMessage.className = '';
      }
      renderUsage(data);
    });
  };

  if (!GOOGLE_CLIENT_ID) {
    upgradeButton.disabled = true;
    upgradeButton.textContent = 'Add Google OAuth Client ID to enable upgrades';
    upgradeButton.title = 'Set GOOGLE_OAUTH_CLIENT_ID in config.js to activate this button.';
  }

  const startGoogleUpgrade = () => {
    if (!GOOGLE_CLIENT_ID) {
      statusMessage.textContent = 'Google OAuth is not configured. Update config.js.';
      statusMessage.className = 'error';
      return;
    }

    upgradeButton.disabled = true;
    upgradeButton.textContent = 'Opening Google Sign-In…';

    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'profile email');
    authUrl.searchParams.set('prompt', 'consent');

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (redirectUrl) => {
        upgradeButton.disabled = false;
        upgradeButton.textContent = 'Sign in with Google to Upgrade ($3/mo)';

        if (chrome.runtime.lastError) {
          statusMessage.textContent = `Google sign-in failed: ${chrome.runtime.lastError.message}`;
          statusMessage.className = 'error';
          return;
        }

        if (!redirectUrl || redirectUrl.indexOf('access_token=') === -1) {
          statusMessage.textContent = 'Google sign-in did not return an access token.';
          statusMessage.className = 'error';
          return;
        }

        await chrome.storage.sync.set({ subscriptionStatus: 'paid' });
        statusMessage.textContent =
          'Upgrade successful! Add your personal API key for premium usage.';
        statusMessage.className = 'success';
        loadState();
      }
    );
  };

  // Event bindings
  upgradeButton.addEventListener('click', startGoogleUpgrade);

  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.sync.set({ llmApiKey: apiKey, subscriptionStatus: 'custom' }, () => {
        statusMessage.textContent = 'API Key saved successfully!';
        statusMessage.className = 'success';
        setTimeout(() => {
          statusMessage.className = '';
          statusMessage.textContent = 'API Key loaded.';
        }, 2000);
        loadState();
      });
    } else {
      statusMessage.textContent = 'API Key cannot be empty.';
      statusMessage.className = 'error';
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && (changes.freeTooltipsUsed || changes.subscriptionStatus)) {
      loadState();
    }
  });

  loadState();
});
