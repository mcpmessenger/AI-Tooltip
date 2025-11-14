// background.js - Service Worker

let CONFIG = {};
try {
  importScripts('config.js');
  CONFIG = self.CONFIG || {};
} catch (error) {
  console.warn('config.js not found. Using default configuration values.', error);
}

const FREE_TIER_LIMIT = typeof CONFIG.FREE_TIER_LIMIT === 'number' ? CONFIG.FREE_TIER_LIMIT : 100;
const DEFAULT_FREE_API_KEY = CONFIG.DEFAULT_FREE_API_KEY || '';

const storageSyncGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));

const storageSyncSet = (items) => new Promise((resolve) => chrome.storage.sync.set(items, resolve));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to create the offscreen document
async function createOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS', 'CLIPBOARD', 'WEB_RTC', 'WORKERS'], // Reasons for heavy processing
    justification: 'To perform heavy tasks like OCR and LLM calls without blocking the main thread.'
  });
}

async function pingOffscreen(timeoutMs = 2000) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out waiting for offscreen ping response.'));
      }
    }, timeoutMs);

    chrome.runtime.sendMessage({ action: 'pingOffscreen' }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || response.status !== 'ok') {
        reject(new Error('Offscreen ping returned unexpected response.'));
        return;
      }

      resolve();
    });
  });
}

async function ensureOffscreenReady() {
  const MAX_ATTEMPTS = 5;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;

    if (!(await chrome.offscreen.hasDocument())) {
      console.log(`Offscreen document missing; creating (attempt ${attempt})`);
      await createOffscreen();
      await delay(100 * attempt);
    }

    try {
      await pingOffscreen();
      if (attempt > 1) {
        console.log('Offscreen became reachable after %d attempts.', attempt);
      }
      return;
    } catch (error) {
      console.warn(`Ping attempt ${attempt} failed: ${error.message}`);
      if (attempt >= MAX_ATTEMPTS) {
        console.error('Offscreen ping failed after maximum retries.');
        throw error;
      }
      // Recreate the offscreen document in case it is hung.
      try {
        await chrome.offscreen.closeDocument();
      } catch (closeError) {
        console.warn('Failed to close offscreen document during retry:', closeError);
      }
      await delay(150 * attempt);
    }
  }
}

async function initializeFreeTierDefaults() {
  const data = await storageSyncGet(['freeTooltipsUsed', 'subscriptionStatus']);
  const updates = {};
  if (typeof data.freeTooltipsUsed !== 'number') {
    updates.freeTooltipsUsed = 0;
  }
  if (!data.subscriptionStatus) {
    updates.subscriptionStatus = 'free';
  }
  if (Object.keys(updates).length > 0) {
    await storageSyncSet(updates);
  }
}

async function resolveUsageAndApiKey(action) {
  const data = await storageSyncGet(['llmApiKey', 'freeTooltipsUsed', 'subscriptionStatus']);
  const subscriptionStatus = data.subscriptionStatus || 'free';
  const used = Number.isFinite(data.freeTooltipsUsed) ? data.freeTooltipsUsed : 0;
  const remainingBeforeUse = Math.max(FREE_TIER_LIMIT - used, 0);

  const usageInfoBase = {
    plan: subscriptionStatus,
    freeTierLimit: FREE_TIER_LIMIT,
    freeTooltipsRemaining: remainingBeforeUse,
    freeTooltipsUsed: used
  };

  if (data.llmApiKey) {
    return {
      apiKey: data.llmApiKey,
      usageInfo: { ...usageInfoBase, plan: subscriptionStatus === 'paid' ? 'paid' : 'custom' }
    };
  }

  if (subscriptionStatus === 'paid') {
    return {
      error: 'Subscription active. Please add your personal API key in the popup to continue.',
      requiresUpgrade: false,
      usageInfo: usageInfoBase
    };
  }

  if (used >= FREE_TIER_LIMIT) {
    return {
      error: `Free tier limit of ${FREE_TIER_LIMIT} tooltips reached. Sign in with Google to upgrade for $3/month.`,
      requiresUpgrade: true,
      usageInfo: { ...usageInfoBase, freeTooltipsRemaining: 0 }
    };
  }

  if (action === 'summarizeText' && !DEFAULT_FREE_API_KEY) {
    return {
      error:
        'Free tier unavailable. Configure a developer-managed API key locally to enable the first 100 tooltips.',
      requiresUpgrade: true,
      usageInfo: usageInfoBase
    };
  }

  const newUsedCount = used + 1;
  await storageSyncSet({ freeTooltipsUsed: newUsedCount });

  return {
    apiKey: action === 'summarizeText' ? DEFAULT_FREE_API_KEY : undefined,
    usageInfo: {
      ...usageInfoBase,
      plan: 'free',
      freeTooltipsRemaining: Math.max(FREE_TIER_LIMIT - newUsedCount, 0),
      freeTooltipsUsed: newUsedCount
    }
  };
}

async function handleRequest(message) {
  const { action } = message;
  const apiResolution = await resolveUsageAndApiKey(action);
  if (apiResolution.error) {
    return {
      success: false,
      error: apiResolution.error,
      errorCode: apiResolution.requiresUpgrade ? 'FREE_TIER_EXHAUSTED' : 'API_KEY_REQUIRED',
      usageInfo: apiResolution.usageInfo
    };
  }

  const processType = action === 'summarizeText' ? 'summarize' : 'ocr';
  const requestData = { ...message.data };
  if (typeof apiResolution.apiKey === 'string' && apiResolution.apiKey.length > 0) {
    requestData.apiKey = apiResolution.apiKey;
  }

  return new Promise(async (resolve) => {
    try {
      await ensureOffscreenReady();
    } catch (error) {
      console.error('Failed to ensure offscreen document:', error);
      resolve({
        success: false,
        error: 'Background worker unavailable. Try reloading the extension.',
        errorCode: 'OFFSCREEN_UNAVAILABLE',
        usageInfo: apiResolution.usageInfo
      });
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'processInOffscreen',
        type: processType,
        data: requestData
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to contact offscreen document:', chrome.runtime.lastError);
          resolve({
            success: false,
            error: chrome.runtime.lastError.message || 'Processor unavailable.',
            errorCode: 'OFFSCREEN_UNAVAILABLE',
            usageInfo: apiResolution.usageInfo
          });
          return;
        }

        const payload = response || {
          success: false,
          error: 'No response from processor.',
          errorCode: 'NO_PROCESSOR_RESPONSE'
        };
        payload.usageInfo = apiResolution.usageInfo;
        resolve(payload);
      }
    );
  });
}

// Listen for extension startup and create the offscreen document
chrome.runtime.onStartup.addListener(createOffscreen);
chrome.runtime.onInstalled.addListener(async () => {
  await createOffscreen();
  await initializeFreeTierDefaults();
});

// Message handling from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capturePreview') {
    const windowId =
      sender.tab && typeof sender.tab.windowId === 'number' ? sender.tab.windowId : undefined;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        const errorMessage = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : 'Failed to capture preview.';
        sendResponse({ success: false, error: errorMessage });
        return;
      }
      sendResponse({ success: true, dataUrl });
    });
    return true;
  }

  if (message.action === 'summarizeText' || message.action === 'ocrImage') {
    console.log('Message received in background worker:', message.action);
    handleRequest(message)
      .then(sendResponse)
      .catch((error) => {
        console.error('Failed to handle request:', error);
        sendResponse({
          success: false,
          error: error.message || 'Unexpected error occurred.',
          errorCode: 'UNEXPECTED_ERROR'
        });
      });
    return true; // Indicates that sendResponse will be called asynchronously
  }
});

// Context menu creation (for "Summarize with AI" right-click)
// Remove existing menu item first to avoid duplicate ID errors on reload
chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({
    id: 'summarizeWithAI',
    title: 'Summarize with AI',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'summarizeWithAI' && info.selectionText) {
    // Send the selected text to the content script to display the "Processing" tooltip
    chrome.tabs.sendMessage(tab.id, {
      action: 'showSummaryTooltip',
      text: info.selectionText,
      source: 'contextMenu'
    });
  }
});

console.log('AI-Powered Tooltip Service Worker loaded.');
