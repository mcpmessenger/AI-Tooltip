// offscreen.js - Runs in the context of the offscreen document

if (typeof runClientSideOCR !== 'function') {
  console.error('Mock OCR library failed to load.');
}

console.log('AI-Powered Tooltip Offscreen Worker loaded.');

const OPENAI_SUMMARY_MODEL = 'gpt-4.1-mini';
const OPENAI_SUMMARY_MAX_OUTPUT_TOKENS = 256;

function extractOpenAIOutputText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string') {
    return payload.output_text.trim();
  }
  if (Array.isArray(payload.output)) {
    const textParts = [];
    payload.output.forEach((block) => {
      if (Array.isArray(block.content)) {
        block.content.forEach((item) => {
          if (item && typeof item === 'object') {
            if (item.type === 'output_text' && typeof item.text === 'string') {
              textParts.push(item.text);
            }
            if (item.type === 'text' && typeof item.text === 'string') {
              textParts.push(item.text);
            }
          }
        });
      }
    });
    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }
  }
  if (Array.isArray(payload.choices) && payload.choices[0]?.message?.content) {
    return payload.choices[0].message.content.trim();
  }
  return '';
}

async function callOpenAISummarize({ apiKey, text }) {
  if (!apiKey) {
    throw new Error('Missing OpenAI API key.');
  }

  const prompt = `Summarize the following text in 2-3 concise sentences for a tooltip.\n\n${text}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_SUMMARY_MODEL,
      input: prompt,
      max_output_tokens: OPENAI_SUMMARY_MAX_OUTPUT_TOKENS
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `OpenAI request failed (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const payload = await response.json();
  const outputText = extractOpenAIOutputText(payload);
  if (!outputText) {
    throw new Error('OpenAI returned an empty response.');
  }
  return outputText;
}

// LLM API Key will be passed in the message data
let LLM_API_KEY = null;

// Placeholder for LLM processing function
async function processLLM(type, data) {
  if (type === 'summarize') {
    LLM_API_KEY = data.apiKey;
    try {
      const summary = await callOpenAISummarize({
        apiKey: LLM_API_KEY,
        text: data.text
      });
      return { success: true, result: summary };
    } catch (error) {
      return { success: false, error: error.message || 'OpenAI request failed.' };
    }
  }

  // OCR processing
  if (type === 'ocr') {
    const imageUrl = data.imageUrl;
    try {
      const ocrResult = await runClientSideOCR(imageUrl);
      return { success: true, result: ocrResult };
    } catch (error) {
      return { success: false, error: `OCR failed: ${error.message}` };
    }
  }

  return { success: false, error: 'Unknown processing type.' };
}

// Listen for messages from the service worker (background.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'pingOffscreen') {
    sendResponse({ status: 'ok' });
    return;
  }

  if (message.action === 'processInOffscreen') {
    console.log('Offscreen received task:', message.type);

    // Process the request and send the response back
    processLLM(message.type, message.data)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate that sendResponse will be called asynchronously
    return true;
  }
});
