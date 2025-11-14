type UsageInfo = {
  freeTooltipsRemaining?: number;
  freeTierLimit?: number;
  freeTooltipsUsed?: number;
};

type TooltipResponse = {
  success?: boolean;
  result?: string;
  error?: string;
  errorCode?: string;
  usageInfo?: UsageInfo;
};

type CapturePreviewResponse =
  | { success: true; dataUrl: string }
  | { success: false; error?: string };

type PreviewCacheEntry = {
  dataUrl: string;
  timestamp: number;
};

const TOOLTIP_ID = 'ai-tooltip-summary';
const HOVER_DELAY = 500; // Delay in ms before showing tooltip
const AUTO_HIDE_DELAY = 5000;
const PREVIEW_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

let currentTooltip: HTMLDivElement | null = null;
let hoverTimeout: number | null = null;

console.log('AI-Powered Tooltip Content Script loaded.');

function removeCurrentTooltip(): void {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

function removeFixedSummaryTooltip(): void {
  const fixedSummary = document.getElementById(TOOLTIP_ID);
  if (fixedSummary) {
    fixedSummary.remove();
  }
}

function buildUsageFooter(usageInfo?: UsageInfo): string {
  if (!usageInfo || typeof usageInfo.freeTooltipsRemaining !== 'number') {
    return '';
  }

  return `<p class="ai-tooltip-footer">Free tooltips left: ${usageInfo.freeTooltipsRemaining}/${usageInfo.freeTierLimit}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function getElementLabel(element: HTMLElement): string | null {
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.textContent ||
    (element instanceof HTMLAnchorElement ? element.href : null);

  if (!label) {
    return null;
  }
  return label.trim().replace(/\s+/g, ' ');
}

function getPreviewCacheKey(element: HTMLElement): string | null {
  if (
    !(element instanceof HTMLAnchorElement) &&
    !(element instanceof HTMLButtonElement) &&
    element.getAttribute('role') !== 'button'
  ) {
    return null;
  }

  const pageId = `${window.location.origin}${window.location.pathname}`;
  const identifier =
    element instanceof HTMLAnchorElement
      ? element.href || element.textContent || element.getAttribute('aria-label') || element.id
      : element.id || element.getAttribute('aria-label') || element.textContent;

  if (!identifier) {
    return null;
  }

  const trimmed = identifier.trim().replace(/\s+/g, ' ').slice(0, 200);
  const encoded = encodeURIComponent(trimmed);
  const elementType = element instanceof HTMLAnchorElement ? 'link' : 'button';
  return `preview::${elementType}::${pageId}::${encoded}`;
}

function getCachedPreview(previewKey: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([previewKey], (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const entry = items[previewKey] as PreviewCacheEntry | undefined;
      if (!entry) {
        resolve(null);
        return;
      }
      const isExpired = Date.now() - entry.timestamp > PREVIEW_CACHE_DURATION_MS;
      if (isExpired) {
        chrome.storage.local.remove(previewKey);
        resolve(null);
        return;
      }
      resolve(entry.dataUrl);
    });
  });
}

function cachePreview(previewKey: string, dataUrl: string): Promise<void> {
  const entry: PreviewCacheEntry = {
    dataUrl,
    timestamp: Date.now()
  };
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [previewKey]: entry }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function requestPreviewCapture(windowId?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'capturePreview',
        windowId
      },
      (response?: CapturePreviewResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success && response.dataUrl) {
          resolve(response.dataUrl);
          return;
        }
        const errorMessage =
          response && 'error' in response && response.error
            ? response.error
            : 'Failed to capture preview.';
        reject(new Error(errorMessage));
      }
    );
  });
}

async function getOrCapturePreview(previewKey: string): Promise<string | null> {
  try {
    const cached = await getCachedPreview(previewKey);
    if (cached) {
      return cached;
    }
  } catch (error) {
    console.warn('Failed to read preview cache:', error);
  }

  try {
    const dataUrl = await requestPreviewCapture();
    await cachePreview(previewKey, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn('Failed to capture preview:', error);
    return null;
  }
}

function showTooltip(element: HTMLElement, content: string, isProcessing = false): void {
  removeCurrentTooltip();
  removeFixedSummaryTooltip();

  const rect = element.getBoundingClientRect();
  const tooltip = document.createElement('div');
  tooltip.className = 'ai-tooltip visible';
  tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
  tooltip.style.left = `${rect.left + window.scrollX}px`;
  tooltip.innerHTML = isProcessing ? `${content} <span class="loading-spinner"></span>` : content;
  document.body.appendChild(tooltip);
  currentTooltip = tooltip;

  element.addEventListener(
    'mouseout',
    () => {
      removeCurrentTooltip();
    },
    { once: true }
  );

  if (!isProcessing) {
    window.setTimeout(() => {
      if (currentTooltip === tooltip) {
        removeCurrentTooltip();
      }
    }, AUTO_HIDE_DELAY);
  }
}

function scheduleImageHover(target: HTMLImageElement): void {
  const imageUrl = target.src;
  hoverTimeout = window.setTimeout(() => {
    showTooltip(target, '<p>Processing Image OCR...</p><p>Loading...</p>', true);

    chrome.runtime.sendMessage(
      {
        action: 'ocrImage',
        data: { imageUrl }
      },
      (response?: TooltipResponse) => {
        if (chrome.runtime.lastError) {
          showTooltip(
            target,
            `<p><strong>Error:</strong></p><p>${chrome.runtime.lastError.message}</p>`
          );
          return;
        }

        const usageFooter = buildUsageFooter(response?.usageInfo);

        if (response?.success) {
          showTooltip(
            target,
            `<p><strong>Image OCR Result:</strong></p><p>${response.result ?? ''}</p>${usageFooter}`
          );
          return;
        }

        if (response?.error) {
          const upgradeHint =
            response.errorCode === 'FREE_TIER_EXHAUSTED'
              ? `<p><em>Limit reached. Open the extension popup to upgrade.</em></p>`
              : '';
          showTooltip(
            target,
            `<p><strong>Error:</strong></p><p>${response.error}</p>${upgradeHint}${usageFooter}`
          );
          return;
        }

        showTooltip(
          target,
          `<p><strong>Error:</strong></p><p>Failed to get response from background worker.</p>${usageFooter}`
        );
      }
    );
  }, HOVER_DELAY);
}

function schedulePreviewHover(target: HTMLElement, previewKey: string): void {
  const label = getElementLabel(target);

  hoverTimeout = window.setTimeout(() => {
    showTooltip(target, '<p>Capturing preview...</p>', true);

    void (async () => {
      const dataUrl = await getOrCapturePreview(previewKey);

      if (!document.body.contains(target)) {
        return;
      }

      if (dataUrl) {
        const title = label ? escapeHtml(label) : target.tagName.toLowerCase();
        showTooltip(
          target,
          `<div><p><strong>Preview:</strong> ${title}</p><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview for ${title}" /></div>`
        );
        return;
      }

      showTooltip(
        target,
        `<p><strong>Preview unavailable.</strong></p><p>Interact with the element to capture a fresh preview.</p>`
      );
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected error occurred.';
      showTooltip(target, `<p><strong>Error:</strong></p><p>${escapeHtml(message)}</p>`);
    });
  }, HOVER_DELAY);
}

function handleHover(event: MouseEvent): void {
  const { target } = event;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (hoverTimeout !== null) {
    window.clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }

  if (target instanceof HTMLImageElement && target.src) {
    scheduleImageHover(target);
    return;
  }

  const previewKey = getPreviewCacheKey(target);
  if (previewKey) {
    schedulePreviewHover(target, previewKey);
  }
}

function resetHoverTimeout(): void {
  if (hoverTimeout !== null) {
    window.clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
}

document.addEventListener('mouseover', handleHover);
document.addEventListener('mouseout', resetHoverTimeout);

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action !== 'showSummaryTooltip' || typeof request.text !== 'string') {
    return;
  }

  const fixedTooltip = document.createElement('div');
  fixedTooltip.className = 'ai-tooltip visible';
  fixedTooltip.id = TOOLTIP_ID;
  const preview = request.text.slice(0, 50);
  fixedTooltip.innerHTML = `<p>Processing summary for: <strong>${preview}...</strong></p><p>Loading... <span class="loading-spinner"></span></p>`;
  document.body.appendChild(fixedTooltip);

  fixedTooltip.style.position = 'fixed';
  fixedTooltip.style.top = '50%';
  fixedTooltip.style.left = '50%';
  fixedTooltip.style.transform = 'translate(-50%, -50%)';

  chrome.runtime.sendMessage(
    {
      action: 'summarizeText',
      data: { text: request.text }
    },
    (response?: TooltipResponse) => {
      if (chrome.runtime.lastError) {
        fixedTooltip.innerHTML = `<p><strong>Error:</strong></p><p>${chrome.runtime.lastError.message}</p>`;
        window.setTimeout(() => fixedTooltip.remove(), AUTO_HIDE_DELAY);
        return;
      }

      const usageFooter = buildUsageFooter(response?.usageInfo);

      if (response?.success) {
        fixedTooltip.innerHTML = `<p><strong>Summary:</strong></p><p>${response.result ?? ''}</p>${usageFooter}`;
      } else if (response?.error) {
        const upgradeHint =
          response.errorCode === 'FREE_TIER_EXHAUSTED'
            ? `<p><em>Limit reached. Open the extension popup to upgrade.</em></p>`
            : '';
        fixedTooltip.innerHTML = `<p><strong>Error:</strong></p><p>${response.error}</p>${upgradeHint}${usageFooter}`;
      } else {
        fixedTooltip.innerHTML = `<p><strong>Error:</strong></p><p>Failed to get response from background worker.</p>${usageFooter}`;
      }

      window.setTimeout(() => fixedTooltip.remove(), AUTO_HIDE_DELAY);
    }
  );

  sendResponse({ status: 'Processing started' });
});
