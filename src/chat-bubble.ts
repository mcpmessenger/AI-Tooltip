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
      <button class="ai-chat-close" aria-label="Close chat">×</button>
    </div>
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
  chatPanel.querySelector('#ai-chat-send')?.addEventListener('click', sendMessage);
  chatPanel.querySelector('#ai-chat-voice-btn')?.addEventListener('click', toggleVoiceInput);

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

  // If it wasn't a drag, treat it as a click
  if (!wasDragging) {
    toggleChat();
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
  isOpen = !isOpen;
  if (chatPanel && chatBubble) {
    if (isOpen) {
      chatPanel.classList.add('open');
      chatBubble.classList.add('hidden');
      scrollToBottom();
    } else {
      chatPanel.classList.remove('open');
      chatBubble.classList.remove('hidden');
    }
  }
}

function scrollToBottom(): void {
  const messagesEl = document.getElementById('ai-chat-messages');
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function addMessage(role: 'user' | 'assistant', content: string): void {
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

  renderMessages();
  saveChatHistory();
  scrollToBottom();
}

function renderMessages(): void {
  const messagesEl = document.getElementById('ai-chat-messages');
  if (!messagesEl) {
    return;
  }

  messagesEl.innerHTML = messages
    .map((msg) => {
      const className = msg.role === 'user' ? 'user-message' : 'assistant-message';
      return `<div class="ai-chat-message ${className}">${escapeHtml(msg.content)}</div>`;
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

  // Show loading
  addMessage('assistant', 'Thinking...');
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
      (response?: { success?: boolean; result?: string; error?: string }) => {
        // Remove loading message
        if (messages[loadingIndex]?.content === 'Thinking...') {
          messages.splice(loadingIndex, 1);
        }

        if (chrome.runtime.lastError) {
          addMessage('assistant', `Error: ${chrome.runtime.lastError.message}`);
          return;
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

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createChatBubble);
} else {
  createChatBubble();
}

// Export for potential external use
export { toggleChat, addMessage };
