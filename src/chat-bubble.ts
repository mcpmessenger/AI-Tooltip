// chat-bubble.ts - Interactive chat bubble with voice input

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

let chatBubble: HTMLDivElement | null = null;
let chatPanel: HTMLDivElement | null = null;
let isOpen = false;
let messages: ChatMessage[] = [];
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let bubbleDragOffset = { x: 0, y: 0 };
let bubbleIsDragging = false;
let bubbleDragStart = { x: 0, y: 0 };
let recognition: SpeechRecognition | null = null;
let isListening = false;
let lastToggleTime = 0;
let lastOpenTime = 0;
let isDarkMode = false;
const TOGGLE_DEBOUNCE_MS = 200;
const MIN_OPEN_DURATION_MS = 300; // Panel must stay open for at least 300ms

const CHAT_STORAGE_KEY = 'ai-tooltip-chat-history';
const MAX_MESSAGES = 50; // Keep last 50 messages

console.log('Chat bubble module loaded.');

function createChatBubble(): void {
  if (chatBubble) {
    return;
  }

  // Create floating button
  chatBubble = document.createElement('div');
  chatBubble.id = 'ai-chat-bubble';
  chatBubble.innerHTML = `
    <img src="${chrome.runtime.getURL('icons/glippy.png')}" alt="AI Assistant" class="ai-chat-icon" />
  `;
  chatBubble.className = 'ai-chat-bubble';
  document.body.appendChild(chatBubble);

  // Create chat panel
  chatPanel = document.createElement('div');
  chatPanel.id = 'ai-chat-panel';
  chatPanel.className = 'ai-chat-panel';
  chatPanel.innerHTML = `
    <div class="ai-chat-header">
      <div class="ai-chat-header-content">
        <img src="${chrome.runtime.getURL('icons/glippy.png')}" alt="AI Assistant" class="ai-chat-header-icon" />
        <span>AI Assistant</span>
      </div>
      <div class="ai-chat-header-actions">
        <button class="ai-chat-theme-toggle" id="ai-chat-theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode">🌙</button>
        <button class="ai-chat-close" aria-label="Close chat">×</button>
      </div>
    </div>
    <div class="ai-chat-usage" id="ai-chat-usage"></div>
    <div class="ai-chat-messages" id="ai-chat-messages"></div>
    <div class="ai-chat-input-container">
      <button class="ai-chat-voice-btn" id="ai-chat-voice-btn" aria-label="Voice input" title="Voice input">
        Mic
      </button>
      <textarea
        class="ai-chat-input"
        id="ai-chat-input"
        placeholder="Ask me anything about this page..."
        rows="2"
      ></textarea>
      <button class="ai-chat-send" id="ai-chat-send" aria-label="Send message">Send</button>
    </div>
    <div class="ai-chat-voice-status" id="ai-chat-voice-status"></div>
  `;
  document.body.appendChild(chatPanel);

  // Load chat history
  loadChatHistory();

  // Event listeners
  // Make bubble draggable
  chatBubble.addEventListener('mousedown', startBubbleDrag);
  chatPanel.querySelector('.ai-chat-close')?.addEventListener('click', toggleChat);
  chatPanel.querySelector('#ai-chat-theme-toggle')?.addEventListener('click', toggleDarkMode);
  chatPanel.querySelector('#ai-chat-send')?.addEventListener('click', sendMessage);
  chatPanel.querySelector('#ai-chat-voice-btn')?.addEventListener('click', toggleVoiceInput);
  
  // Load dark mode preference
  loadDarkModePreference();
  
  // Load and display usage info
  loadUsageInfo();

  const input = chatPanel.querySelector('#ai-chat-input') as HTMLTextAreaElement;
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Make panel draggable
  const header = chatPanel.querySelector('.ai-chat-header');
  if (header) {
    header.addEventListener('mousedown', startDrag as EventListener);
  }

  // Prevent clicks inside panel from closing it
  chatPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // Prevent document clicks from closing panel (only close button should close it)
  document.addEventListener('click', (e) => {
    if (isOpen && chatPanel && chatBubble) {
      const target = e.target as HTMLElement;
      // Only close if clicking outside both panel and bubble
      if (!chatPanel.contains(target) && !chatBubble.contains(target)) {
        // Don't auto-close - user must use close button
        // This prevents accidental closes
      }
    }
  });

  // Initialize voice recognition
  initializeVoiceRecognition();
}

function initializeVoiceRecognition(): void {
  const win = window as WindowWithSpeech;
  if (!win.webkitSpeechRecognition && !win.SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser.');
    const voiceBtn = document.getElementById('ai-chat-voice-btn');
    if (voiceBtn) {
      voiceBtn.style.display = 'none';
    }
    return;
  }

  const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) {
    return;
  }
  recognition = new SpeechRecognitionClass();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    updateVoiceStatus('Listening...', true);
    const voiceBtn = document.getElementById('ai-chat-voice-btn');
    if (voiceBtn) {
      voiceBtn.classList.add('listening');
    }
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const transcript = Array.from(event.results)
      .map((result: SpeechRecognitionResult) => {
        const firstAlternative = result[0];
        return firstAlternative ? firstAlternative.transcript : '';
      })
      .join(' ');
    const input = document.getElementById('ai-chat-input') as HTMLTextAreaElement;
    if (input) {
      input.value = transcript;
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    console.error('Speech recognition error:', event.error);
    updateVoiceStatus(`Error: ${event.error}`, false);
    stopVoiceRecognition();
  };

  recognition.onend = () => {
    stopVoiceRecognition();
  };
}

function toggleVoiceInput(): void {
  if (!recognition) {
    return;
  }

  if (isListening) {
    recognition.stop();
  } else {
    try {
      recognition?.start();
    } catch (error) {
      console.error('Failed to start voice recognition:', error);
      updateVoiceStatus('Failed to start. Try again.', false);
    }
  }
}

function stopVoiceRecognition(): void {
  isListening = false;
  const voiceBtn = document.getElementById('ai-chat-voice-btn');
  if (voiceBtn) {
    voiceBtn.classList.remove('listening');
  }
  updateVoiceStatus('', false);
}

function updateVoiceStatus(message: string, isActive: boolean): void {
  const statusEl = document.getElementById('ai-chat-voice-status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `ai-chat-voice-status ${isActive ? 'active' : ''}`;
  }
}

function startBubbleDrag(e: MouseEvent): void {
  if (!chatBubble) {
    return;
  }
  bubbleIsDragging = false;
  bubbleDragStart.x = e.clientX;
  bubbleDragStart.y = e.clientY;
  const rect = chatBubble.getBoundingClientRect();
  bubbleDragOffset.x = e.clientX - rect.left;
  bubbleDragOffset.y = e.clientY - rect.top;

  document.addEventListener('mousemove', onBubbleDrag);
  document.addEventListener('mouseup', stopBubbleDrag);
  e.preventDefault();
  e.stopPropagation();
}

function onBubbleDrag(e: MouseEvent): void {
  if (!chatBubble) {
    return;
  }
  const deltaX = Math.abs(e.clientX - bubbleDragStart.x);
  const deltaY = Math.abs(e.clientY - bubbleDragStart.y);

  // If moved more than 5px, consider it a drag
  if (deltaX > 5 || deltaY > 5) {
    bubbleIsDragging = true;
  }

  if (bubbleIsDragging) {
    chatBubble.style.left = `${e.clientX - bubbleDragOffset.x}px`;
    chatBubble.style.top = `${e.clientY - bubbleDragOffset.y}px`;
    chatBubble.style.right = 'auto';
    chatBubble.style.bottom = 'auto';
  }
}

function stopBubbleDrag(e: MouseEvent): void {
  const wasDragging = bubbleIsDragging;
  bubbleIsDragging = false;
  document.removeEventListener('mousemove', onBubbleDrag);
  document.removeEventListener('mouseup', stopBubbleDrag);
  e.preventDefault();
  e.stopPropagation();

  // If it wasn't a drag, treat it as a click
  // Use setTimeout to ensure all events have settled
  if (!wasDragging) {
    setTimeout(() => {
      toggleChat();
    }, 50);
  }
}

function startDrag(e: MouseEvent): void {
  if (!chatPanel) {
    return;
  }
  isDragging = true;
  const rect = chatPanel.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;

  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
}

function onDrag(e: MouseEvent): void {
  if (!chatPanel || !isDragging) {
    return;
  }
  chatPanel.style.left = `${e.clientX - dragOffset.x}px`;
  chatPanel.style.top = `${e.clientY - dragOffset.y}px`;
  chatPanel.style.right = 'auto';
  chatPanel.style.bottom = 'auto';
}

function stopDrag(): void {
  isDragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

function toggleChat(): void {
  const now = Date.now();
  // Prevent rapid toggling
  if (now - lastToggleTime < TOGGLE_DEBOUNCE_MS) {
    return;
  }
  
  lastToggleTime = now;

  isOpen = !isOpen;
  if (chatPanel && chatBubble) {
    if (isOpen) {
      lastOpenTime = now;
      // Ensure panel is in DOM
      if (!document.body.contains(chatPanel)) {
        document.body.appendChild(chatPanel);
      }
      // Force display and visibility
      chatPanel.style.display = 'flex';
      chatPanel.style.visibility = 'visible';
      chatPanel.classList.add('open');
      // Position panel near bubble but offset to avoid overlap
      const bubbleRect = chatBubble.getBoundingClientRect();
      if (!chatPanel.style.left || chatPanel.style.left === 'auto') {
        chatPanel.style.left = `${bubbleRect.left - 350}px`;
        chatPanel.style.top = `${bubbleRect.top}px`;
        chatPanel.style.right = 'auto';
        chatPanel.style.bottom = 'auto';
      }
      // Force it to stay open
      requestAnimationFrame(() => {
        if (chatPanel && isOpen) {
          chatPanel.classList.add('open');
          chatPanel.style.display = 'flex';
          chatPanel.style.visibility = 'visible';
        }
      });
      scrollToBottom();
      loadUsageInfo(); // Refresh usage when opening
    } else {
      chatPanel.classList.remove('open');
    }
    // Paperclip icon always stays visible
  }
}

function scrollToBottom(): void {
  const messagesEl = document.getElementById('ai-chat-messages');
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function addMessage(role: 'user' | 'assistant', content: string, isHtml = false): void {
  const message: ChatMessage = {
    role,
    content,
    timestamp: Date.now()
  };
  messages.push(message);

  // Keep only last MAX_MESSAGES
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(-MAX_MESSAGES);
  }

  renderMessages(isHtml);
  saveChatHistory();
  scrollToBottom();
}

function renderMessages(allowHtml = false): void {
  const messagesEl = document.getElementById('ai-chat-messages');
  if (!messagesEl) {
    return;
  }

  messagesEl.innerHTML = messages
    .map((msg, index) => {
      const className = msg.role === 'user' ? 'user-message' : 'assistant-message';
      const content = allowHtml && index === messages.length - 1 && msg.content.includes('<span') 
        ? msg.content 
        : escapeHtml(msg.content);
      return `<div class="ai-chat-message ${className}">${content}</div>`;
    })
    .join('');

  if (messages.length === 0) {
    messagesEl.innerHTML =
      '<div class="ai-chat-welcome">👋 Hi! I can help you understand this page. Ask me anything!</div>';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendMessage(): Promise<void> {
  const input = document.getElementById('ai-chat-input') as HTMLTextAreaElement;
  if (!input || !input.value.trim()) {
    return;
  }

  const userMessage = input.value.trim();
  input.value = '';

  // Add user message
  addMessage('user', userMessage);

  // Show loading with spinner
  addMessage('assistant', '<span class="loading-spinner-inline"></span> Thinking...', true);
  const loadingIndex = messages.length - 1;

  try {
    // Get page context for better responses
    const pageContext = getPageContext();

    // Send to background for LLM processing
    chrome.runtime.sendMessage(
      {
        action: 'chatMessage',
        data: {
          message: userMessage,
          context: pageContext,
          history: messages.slice(-5).map((m) => ({
            role: m.role,
            content: m.content
          }))
        }
      },
      (response?: { success?: boolean; result?: string; error?: string; usageInfo?: any }) => {
        // Remove loading message
        if (messages[loadingIndex]?.content.includes('Thinking...')) {
          messages.splice(loadingIndex, 1);
        }

        if (chrome.runtime.lastError) {
          addMessage('assistant', `Error: ${chrome.runtime.lastError.message}`);
          return;
        }

        // Update usage info if provided
        if (response?.usageInfo) {
          updateUsageDisplay(response.usageInfo);
        }

        if (response?.success && response.result) {
          addMessage('assistant', response.result);
        } else if (response?.error) {
          addMessage('assistant', `Error: ${response.error}`);
        } else {
          addMessage('assistant', 'Sorry, I could not process your request.');
        }
      }
    );
  } catch (error) {
    // Remove loading message
    if (messages[loadingIndex]?.content === 'Thinking...') {
      messages.splice(loadingIndex, 1);
    }
    const message = error instanceof Error ? error.message : 'Unexpected error occurred.';
    addMessage('assistant', `Error: ${message}`);
  }
}

function getPageContext(): string {
  const context: string[] = [];
  context.push(`Page URL: ${window.location.href}`);
  context.push(`Page Title: ${document.title}`);

  // Get visible text content (first 500 chars)
  const bodyText = document.body.textContent?.trim().slice(0, 500);
  if (bodyText) {
    context.push(`Page content: ${bodyText}...`);
  }

  return context.join('\n');
}

function loadChatHistory(): void {
  chrome.storage.local.get([CHAT_STORAGE_KEY], (items) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to load chat history:', chrome.runtime.lastError);
      return;
    }

    const stored = items[CHAT_STORAGE_KEY] as ChatMessage[] | undefined;
    if (stored && Array.isArray(stored)) {
      messages = stored.slice(-MAX_MESSAGES);
      renderMessages();
    }
  });
}

function saveChatHistory(): void {
  chrome.storage.local.set({ [CHAT_STORAGE_KEY]: messages }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to save chat history:', chrome.runtime.lastError);
    }
  });
}

function toggleDarkMode(): void {
  isDarkMode = !isDarkMode;
  if (chatPanel) {
    if (isDarkMode) {
      chatPanel.classList.add('dark-mode');
    } else {
      chatPanel.classList.remove('dark-mode');
    }
    const themeToggle = document.getElementById('ai-chat-theme-toggle');
    if (themeToggle) {
      themeToggle.textContent = isDarkMode ? '☀️' : '🌙';
    }
  }
  // Save preference
  chrome.storage.local.set({ 'ai-chat-dark-mode': isDarkMode }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to save dark mode preference:', chrome.runtime.lastError);
    }
  });
}

function loadDarkModePreference(): void {
  chrome.storage.local.get(['ai-chat-dark-mode'], (items) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to load dark mode preference:', chrome.runtime.lastError);
      return;
    }
    isDarkMode = Boolean(items['ai-chat-dark-mode']);
    if (chatPanel) {
      if (isDarkMode) {
        chatPanel.classList.add('dark-mode');
      }
      const themeToggle = document.getElementById('ai-chat-theme-toggle');
      if (themeToggle) {
        themeToggle.textContent = isDarkMode ? '☀️' : '🌙';
      }
    }
  });
}

function loadUsageInfo(): void {
  // Request usage info from background
  chrome.runtime.sendMessage({ action: 'getUsageInfo' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to get usage info:', chrome.runtime.lastError);
      // Fallback to storage
      chrome.storage.sync.get(['freeTooltipsUsed', 'subscriptionStatus', 'llmApiKey'], (data) => {
        updateUsageDisplay({
          plan: data.subscriptionStatus || 'free',
          freeTooltipsUsed: Number.isFinite(data.freeTooltipsUsed) ? data.freeTooltipsUsed : 0,
          freeTooltipsRemaining: 0,
          freeTierLimit: 1000
        });
      });
      return;
    }
    if (response && response.usageInfo) {
      updateUsageDisplay(response.usageInfo);
    }
  });
}

function updateUsageDisplay(usageInfo: any): void {
  const usageEl = document.getElementById('ai-chat-usage');
  if (!usageEl) {
    return;
  }

  const { plan, freeTooltipsUsed = 0, freeTooltipsRemaining = 0, freeTierLimit = 1000 } = usageInfo;
  
  if (plan === 'paid' || plan === 'custom') {
    usageEl.textContent = '✨ Unlimited tooltips enabled';
    usageEl.className = 'ai-chat-usage unlimited';
  } else {
    const remaining = Math.max(freeTierLimit - freeTooltipsUsed, 0);
    usageEl.textContent = `${remaining} of ${freeTierLimit} free tooltips remaining`;
    usageEl.className = 'ai-chat-usage free';
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createChatBubble);
} else {
  createChatBubble();
}

// Export for potential external use
export { toggleChat, addMessage };
