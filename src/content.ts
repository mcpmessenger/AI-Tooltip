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

const TOOLTIP_ID = 'ai-tooltip-summary';
const HOVER_DELAY = 500; // Delay in ms before showing tooltip
const AUTO_HIDE_DELAY = 5000;

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
