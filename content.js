// content.js - Runs in the context of the web page

console.log('AI-Powered Tooltip Content Script loaded.');

// --- Hover Detection and Tooltip Injection ---

let currentTooltip = null;
let hoverTimeout = null;
const HOVER_DELAY = 500; // Delay in ms before showing tooltip

function showTooltip(element, content, isProcessing = false) {
  // Remove existing tooltip
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
  // Remove any fixed summary tooltip
  const fixedSummary = document.getElementById('ai-tooltip-summary');
  if (fixedSummary) {
    fixedSummary.remove();
  }

  const rect = element.getBoundingClientRect();
  const tooltip = document.createElement('div');
  tooltip.className = 'ai-tooltip visible';
  tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
  tooltip.style.left = `${rect.left + window.scrollX}px`;
  tooltip.innerHTML = isProcessing ? `${content} <span class="loading-spinner"></span>` : content;
  document.body.appendChild(tooltip);
  currentTooltip = tooltip;

  // Hide tooltip on mouseout
  element.addEventListener(
    'mouseout',
    () => {
      if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
      }
    },
    { once: true }
  );

  // Auto-hide result tooltips after a delay
  if (!isProcessing) {
    setTimeout(() => {
      if (currentTooltip === tooltip) {
        currentTooltip.remove();
        currentTooltip = null;
      }
    }, 5000);
  }
}

document.addEventListener('mouseover', (event) => {
  const target = event.target;

  // Clear any pending hover timeout
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
  }

  // 1. Image Hover Detection
  if (target.tagName === 'IMG' && target.src) {
    const imageUrl = target.src;

    hoverTimeout = setTimeout(() => {
      // Show processing tooltip immediately
      showTooltip(target, '<p>Processing Image OCR...</p><p>Loading...</p>', true);

      // Send message to background worker for OCR
      chrome.runtime.sendMessage(
        {
          action: 'ocrImage',
          data: { imageUrl: imageUrl }
        },
        (response) => {
          const usageInfo = response && response.usageInfo;
          const usageFooter =
            usageInfo && typeof usageInfo.freeTooltipsRemaining === 'number'
              ? `<p class="ai-tooltip-footer">Free tooltips left: ${usageInfo.freeTooltipsRemaining}/${usageInfo.freeTierLimit}</p>`
              : '';

          if (response && response.success) {
            showTooltip(
              target,
              `<p><strong>Image OCR Result:</strong></p><p>${response.result}</p>${usageFooter}`
            );
          } else if (response && response.error) {
            const upgradeHint =
              response.errorCode === 'FREE_TIER_EXHAUSTED'
                ? `<p><em>Limit reached. Open the extension popup to upgrade.</em></p>`
                : '';
            showTooltip(
              target,
              `<p><strong>Error:</strong></p><p>${response.error}</p>${upgradeHint}`
            );
          } else {
            showTooltip(
              target,
              `<p><strong>Error:</strong></p><p>Failed to get response from background worker.</p>`
            );
          }
        }
      );
    }, HOVER_DELAY);
  }

  // 2. Text Hover Detection (To be implemented later for full feature)
  // For now, we focus on the image OCR and context menu summary.
});

document.addEventListener('mouseout', (event) => {
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
  }
});

// --- Context Menu Summary Handling ---

// Listener for messages from the background worker (e.g., from context menu)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showSummaryTooltip') {
    // Placeholder for displaying the tooltip
    // For context menu summary, we use a fixed position for better visibility
    const fixedTooltip = document.createElement('div');
    fixedTooltip.className = 'ai-tooltip visible';
    fixedTooltip.id = 'ai-tooltip-summary';
    fixedTooltip.innerHTML = `<p>Processing summary for: <strong>${request.text.substring(0, 50)}...</strong></p><p>Loading... <span class="loading-spinner"></span></p>`;
    document.body.appendChild(fixedTooltip);

    // Position the tooltip in the center of the screen
    fixedTooltip.style.position = 'fixed';
    fixedTooltip.style.top = '50%';
    fixedTooltip.style.left = '50%';
    fixedTooltip.style.transform = 'translate(-50%, -50%)';

    // Send the request to the background service worker
    chrome.runtime.sendMessage(
      {
        action: 'summarizeText',
        data: { text: request.text }
      },
      (response) => {
        const usageInfo = response && response.usageInfo;
        const usageFooter =
          usageInfo && typeof usageInfo.freeTooltipsRemaining === 'number'
            ? `<p class="ai-tooltip-footer">Free tooltips left: ${usageInfo.freeTooltipsRemaining}/${usageInfo.freeTierLimit}</p>`
            : '';

        if (response && response.success) {
          fixedTooltip.innerHTML = `<p><strong>Summary:</strong></p><p>${response.result}</p>${usageFooter}`;
        } else if (response && response.error) {
          const upgradeHint =
            response.errorCode === 'FREE_TIER_EXHAUSTED'
              ? `<p><em>Limit reached. Open the extension popup to upgrade.</em></p>`
              : '';
          fixedTooltip.innerHTML = `<p><strong>Error:</strong></p><p>${response.error}</p>${upgradeHint}${usageFooter}`;
        } else {
          fixedTooltip.innerHTML = `<p><strong>Error:</strong></p><p>Failed to get response from background worker.</p>`;
        }

        // Auto-hide the tooltip after a delay
        setTimeout(() => {
          fixedTooltip.remove();
        }, 5000);
      }
    );

    sendResponse({ status: 'Processing started' });
  }
});
