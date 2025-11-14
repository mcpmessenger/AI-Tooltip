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

type SummaryCacheEntry = {
  summary: string;
  timestamp: number;
};

const TOOLTIP_ID = 'ai-tooltip-summary';
const HOVER_DELAY = 500; // Delay in ms before showing tooltip
const AUTO_HIDE_DELAY = 5000;
const PREVIEW_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SUMMARY_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MIN_TEXT_LENGTH = 50; // Minimum text length to trigger summarization
const MAX_TEXT_LENGTH = 2000; // Maximum text length to summarize

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

function extractTextFromElement(element: HTMLElement): string | null {
  // Skip interactive elements (they have their own handlers)
  if (
    element instanceof HTMLAnchorElement ||
    element instanceof HTMLButtonElement ||
    element.getAttribute('role') === 'button' ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return null;
  }

  // Focus on text containers: paragraphs, headings, list items, blockquotes, etc.
  const textContainers = [
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'LI',
    'BLOCKQUOTE',
    'DD',
    'DT',
    'TD',
    'TH',
    'SPAN',
    'DIV',
    'ARTICLE',
    'SECTION'
  ];

  if (!textContainers.includes(element.tagName)) {
    return null;
  }

  // Get text content, excluding nested interactive elements
  const text = element.textContent?.trim() || '';
  if (text.length < MIN_TEXT_LENGTH) {
    return null;
  }

  // Truncate if too long
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + '...' : text;
}

function getSummaryCacheKey(text: string): string {
  const pageId = `${window.location.origin}${window.location.pathname}`;
  const textHash = text.slice(0, 100).replace(/\s+/g, ' ').trim();
  const encoded = encodeURIComponent(textHash);
  return `summary::${pageId}::${encoded}`;
}

function getButtonSummaryCacheKey(
  element: HTMLElement,
  buttonText: string,
  href: string | null
): string {
  const pageId = `${window.location.origin}${window.location.pathname}`;
  const identifier = href || buttonText || element.id || element.getAttribute('aria-label') || '';
  const hash = identifier.slice(0, 100).replace(/\s+/g, ' ').trim();
  const encoded = encodeURIComponent(hash);
  return `button-summary::${pageId}::${encoded}`;
}

function buildButtonContext(element: HTMLElement, buttonText: string, href: string | null): string {
  const parts: string[] = [];

  if (buttonText) {
    parts.push(`Button text: "${buttonText}"`);
  }

  if (href) {
    parts.push(`Link URL: ${href}`);
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel !== buttonText) {
    parts.push(`Aria label: "${ariaLabel}"`);
  }

  const title = element.getAttribute('title');
  if (title && title !== buttonText) {
    parts.push(`Title: "${title}"`);
  }

  // Get surrounding context (parent element text if available)
  const parent = element.parentElement;
  if (parent) {
    const parentText = parent.textContent?.trim();
    if (parentText && parentText.length < 200) {
      parts.push(`Context: ${parentText}`);
    }
  }

  return parts.join('\n');
}

function getCachedSummary(summaryKey: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get([summaryKey], (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const entry = items[summaryKey] as SummaryCacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        const isExpired = Date.now() - entry.timestamp > SUMMARY_CACHE_DURATION_MS;
        if (isExpired) {
          chrome.storage.local.remove(summaryKey);
          resolve(null);
          return;
        }
        resolve(entry.summary);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to access storage.'));
    }
  });
}

function cacheSummary(summaryKey: string, summary: string): Promise<void> {
  const entry: SummaryCacheEntry = {
    summary,
    timestamp: Date.now()
  };
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [summaryKey]: entry }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to write storage.'));
    }
  });
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
    try {
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
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to access storage.'));
    }
  });
}

function cachePreview(previewKey: string, dataUrl: string): Promise<void> {
  const entry: PreviewCacheEntry = {
    dataUrl,
    timestamp: Date.now()
  };
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [previewKey]: entry }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to write storage.'));
    }
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
  const isLink = target instanceof HTMLAnchorElement;
  const href = isLink ? (target as HTMLAnchorElement).href : null;
  const buttonText = target.textContent?.trim() || label || target.tagName.toLowerCase();
  const buttonContext = buildButtonContext(target, buttonText, href);
  const buttonSummaryKey = getButtonSummaryCacheKey(target, buttonText, href);

  hoverTimeout = window.setTimeout(() => {
    // Show analyzing message immediately
    showTooltip(target, '<p><em>Analyzing...</em></p>', true);

    void (async () => {
      // Try to get cached summary first
      let buttonSummary: string | null = null;
      try {
        buttonSummary = await getCachedSummary(buttonSummaryKey);
      } catch (error) {
        console.warn('Failed to read button summary cache:', error);
      }

      // Try screenshot capture in parallel
      const dataUrlPromise = getOrCapturePreview(previewKey).catch(() => null);

      if (!document.body.contains(target)) {
        return;
      }

      // If we have a cached summary, show it immediately
      if (buttonSummary) {
        const dataUrl = await dataUrlPromise;
        if (dataUrl) {
          showTooltip(
            target,
            `<div><p><strong>What it does:</strong> ${escapeHtml(buttonSummary)}</p><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview" /></div>`
          );
        } else {
          showTooltip(
            target,
            `<div><p><strong>What it does:</strong> ${escapeHtml(buttonSummary)}</p></div>`
          );
        }
        return;
      }

      // Request AI summary
      const summaryPrompt = `Based on this button/link information, explain what clicking it will do in one concise sentence:\n\n${buttonContext}`;

      chrome.runtime.sendMessage(
        {
          action: 'summarizeText',
          data: { text: summaryPrompt }
        },
        async (response?: TooltipResponse) => {
          if (!document.body.contains(target)) {
            return;
          }

          const dataUrl = await dataUrlPromise;

          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || 'Unknown error occurred.';
            if (dataUrl) {
              showTooltip(
                target,
                `<div><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview" /><p class="ai-tooltip-footer"><em>Error: ${escapeHtml(errorMessage)}</em></p></div>`
              );
            } else {
              showTooltip(
                target,
                `<div><p class="ai-tooltip-footer"><em>Error: ${escapeHtml(errorMessage)}</em></p></div>`
              );
            }
            return;
          }

          const usageFooter = buildUsageFooter(response?.usageInfo);

          if (response?.success && response.result) {
            // Cache the summary
            try {
              await cacheSummary(buttonSummaryKey, response.result);
            } catch (error) {
              console.warn('Failed to cache button summary:', error);
            }

            if (dataUrl) {
              showTooltip(
                target,
                `<div><p><strong>What it does:</strong> ${escapeHtml(response.result)}</p><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview" />${usageFooter}</div>`
              );
            } else {
              showTooltip(
                target,
                `<div><p><strong>What it does:</strong> ${escapeHtml(response.result)}</p>${usageFooter}</div>`
              );
            }
            return;
          }

          if (response?.error) {
            const upgradeHint =
              response.errorCode === 'FREE_TIER_EXHAUSTED'
                ? `<p><em>Limit reached. Open the extension popup to upgrade.</em></p>`
                : '';
            if (dataUrl) {
              showTooltip(
                target,
                `<div><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview" /><p class="ai-tooltip-footer"><em>${escapeHtml(response.error)}</em>${upgradeHint}${usageFooter}</p></div>`
              );
            } else {
              showTooltip(
                target,
                `<div><p class="ai-tooltip-footer"><em>${escapeHtml(response.error)}</em>${upgradeHint}${usageFooter}</p></div>`
              );
            }
            return;
          }

          // Fallback if summary fails
          if (dataUrl) {
            showTooltip(
              target,
              `<div><img src="${dataUrl}" class="ai-tooltip-preview" alt="Preview" /></div>`
            );
          } else {
            showTooltip(
              target,
              `<div><p class="ai-tooltip-footer"><em>Summary unavailable. Click to interact.</em></p></div>`
            );
          }
        }
      );
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected error occurred.';
      showTooltip(
        target,
        `<div><p class="ai-tooltip-footer"><em>Error: ${escapeHtml(message)}</em></p></div>`
      );
    });
  }, HOVER_DELAY);
}

function scheduleTextHover(target: HTMLElement, text: string): void {
  const summaryKey = getSummaryCacheKey(text);

  hoverTimeout = window.setTimeout(() => {
    showTooltip(target, '<p>Processing summary...</p><p>Loading...</p>', true);

    void (async () => {
      // Check cache first
      let summary: string | null = null;
      try {
        summary = await getCachedSummary(summaryKey);
      } catch (error) {
        console.warn('Failed to read summary cache:', error);
      }

      if (!document.body.contains(target)) {
        return;
      }

      // If cached, show immediately
      if (summary) {
        showTooltip(target, `<p><strong>Summary:</strong></p><p>${escapeHtml(summary)}</p>`);
        return;
      }

      // Otherwise, request from background
      chrome.runtime.sendMessage(
        {
          action: 'summarizeText',
          data: { text }
        },
        async (response?: TooltipResponse) => {
          if (!document.body.contains(target)) {
            return;
          }

          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || 'Unknown error occurred.';
            showTooltip(target, `<p><strong>Error:</strong></p><p>${escapeHtml(errorMessage)}</p>`);
            return;
          }

          const usageFooter = buildUsageFooter(response?.usageInfo);

          if (response?.success && response.result) {
            // Cache the summary
            try {
              await cacheSummary(summaryKey, response.result);
            } catch (error) {
              console.warn('Failed to cache summary:', error);
            }

            showTooltip(
              target,
              `<p><strong>Summary:</strong></p><p>${escapeHtml(response.result)}</p>${usageFooter}`
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
              `<p><strong>Error:</strong></p><p>${escapeHtml(response.error)}</p>${upgradeHint}${usageFooter}`
            );
            return;
          }

          showTooltip(
            target,
            `<p><strong>Error:</strong></p><p>Failed to get response from background worker.</p>${usageFooter}`
          );
        }
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

  // Priority 1: Images -> OCR
  if (target instanceof HTMLImageElement && target.src) {
    scheduleImageHover(target);
    return;
  }

  // Priority 2: Buttons/Links -> Preview
  const previewKey = getPreviewCacheKey(target);
  if (previewKey) {
    schedulePreviewHover(target, previewKey);
    return;
  }

  // Priority 3: Text elements -> Summarization
  const text = extractTextFromElement(target);
  if (text) {
    scheduleTextHover(target, text);
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
