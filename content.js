/**
 * Content Script - RH Learning Assistant
 * Handles UI injection, transcript capture, and Gemini API integration
 */

(function() {
  'use strict';

  // ============================================
  // Logger Utility
  // ============================================
  const PREFIX = '[RH Learning Assistant]';
  
  const Logger = {
    info: (...args) => console.log(`${PREFIX} ℹ️`, ...args),
    success: (...args) => console.log(`${PREFIX} ✅`, ...args),
    warn: (...args) => console.warn(`${PREFIX} ⚠️`, ...args),
    error: (...args) => console.error(`${PREFIX} ❌`, ...args),
    debug: (...args) => console.log(`${PREFIX} 🔍`, ...args),
    api: (...args) => console.log(`${PREFIX} 🤖`, ...args),
    ui: (...args) => console.log(`${PREFIX} 🎨`, ...args),
  };

  // ============================================
  // Configuration
  // ============================================
  const GEMINI_API_URL ='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  // ============================================
  // State
  // ============================================
  let capturedTranscript = null;
  let isProcessing = false;
  let extensionContextValid = true;
  let chatHistory = [];  // Store conversation history for Q&A
  let currentSummary = null;  // Store the current summary for context
  let flashcards = null;  // Generated flashcard Q&A pairs
  let allFlashcards = null;  // Full set (before shuffle) for retest
  let wrongCards = [];  // Questions answered incorrectly for focus retest
  let flashcardIndex = 0;
  let flashcardScore = 0;
  let isFlashcardMode = false;

  // ============================================
  // Extension Context Helper
  // ============================================
  
  /**
   * Check if extension context is still valid
   */
  function isExtensionContextValid() {
    try {
      // Accessing chrome.runtime.id will throw if context is invalidated
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
  }

  /**
   * Safely send message to background script
   * Handles "Extension context invalidated" errors gracefully
   */
  function safeSendMessage(message) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        Logger.warn('Extension context invalidated - please refresh the page');
        extensionContextValid = false;
        resolve({ success: false, error: 'Extension context invalidated' });
        return;
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            Logger.warn(`Message failed: ${errorMsg}`);
            
            if (errorMsg.includes('context invalidated')) {
              extensionContextValid = false;
              showExtensionReloadNotice();
            }
            
            resolve({ success: false, error: errorMsg });
          } else {
            resolve(response || { success: true });
          }
        });
      } catch (e) {
        Logger.error(`sendMessage error: ${e.message}`);
        if (e.message.includes('context invalidated')) {
          extensionContextValid = false;
          showExtensionReloadNotice();
        }
        resolve({ success: false, error: e.message });
      }
    });
  }

  /**
   * Show notice when extension needs page refresh
   */
  function showExtensionReloadNotice() {
    // Only show once
    if (document.getElementById('rh-summarizer-reload-notice')) return;
    
    const notice = document.createElement('div');
    notice.id = 'rh-summarizer-reload-notice';
    notice.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000000;
      background: #fee2e2;
      border: 1px solid #ef4444;
      border-radius: 8px;
      padding: 16px 20px;
      font-family: sans-serif;
      font-size: 14px;
      color: #991b1b;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 320px;
    `;
    notice.innerHTML = `
      <strong>Extension Updated</strong><br>
      <span style="font-size: 13px;">Please refresh this page to continue using the RH Learning Assistant.</span>
      <button onclick="location.reload()" style="
        display: block;
        margin-top: 12px;
        padding: 8px 16px;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
      ">Refresh Page</button>
    `;
    document.body.appendChild(notice);
  }

  // ============================================
  // Inject the fetch interceptor script
  // ============================================
  function injectInterceptorScript() {
    Logger.info('Injecting transcript interceptor script...');
    
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function() {
        Logger.success('Interceptor script loaded successfully');
        this.remove();
      };
      script.onerror = function(e) {
        Logger.error('Failed to load interceptor script:', e);
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      Logger.error('Error injecting script:', e.message);
    }
  }

  // ============================================
  // Listen for transcript from injected script
  // ============================================
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    if (event.data?.type === 'RH_SUMMARIZER_TRANSCRIPT') {
      Logger.success('Transcript received from page context!');
      Logger.info(`Transcript length: ${event.data.transcript.length} characters`);
      
      capturedTranscript = event.data.transcript;
      
      // Store in background for persistence
      Logger.debug('Storing transcript in background service worker...');
      const response = await safeSendMessage({
        type: 'STORE_TRANSCRIPT',
        transcript: capturedTranscript
      });
      
      if (response?.success) {
        Logger.success('Transcript stored in background');
      } else {
        Logger.warn('Failed to store transcript in background');
      }

      // Update button state if exists
      updateButtonState();
      Logger.ui('Button state updated - ready to summarize');
    }
  });

  // ============================================
  // UI Components
  // ============================================

  function createSummarizeButton() {
    Logger.ui('Creating summarize button...');
    
    const button = document.createElement('button');
    button.id = 'rh-summarizer-btn';
    button.className = 'rh-summarizer-btn';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>
      <span>Learning Assistant</span>
    `;
    button.addEventListener('click', handleSummarizeClick);
    return button;
  }

  function createModal() {
    Logger.ui('Creating summary modal...');
    
    const modal = document.createElement('div');
    modal.id = 'rh-summarizer-modal';
    modal.className = 'rh-summarizer-modal';
    modal.innerHTML = `
      <div class="rh-summarizer-modal-backdrop"></div>
      <div class="rh-summarizer-modal-content">
        <div class="rh-summarizer-modal-header">
          <h2>Learning Assistant</h2>
          <button class="rh-summarizer-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="rh-summarizer-modal-body">
          <div class="rh-summarizer-loading">
            <div class="rh-summarizer-spinner"></div>
            <p>Generating summary...</p>
          </div>
          <div class="rh-summarizer-result" style="display: none;"></div>
          <div class="rh-summarizer-error" style="display: none;"></div>
          
          <!-- Flashcard Section -->
          <div class="rh-summarizer-flashcard" style="display: none;">
            <div class="rh-summarizer-flashcard-loading" style="display: none;">
              <div class="rh-summarizer-spinner"></div>
              <p>Generating flashcards...</p>
            </div>
            <div class="rh-summarizer-flashcard-quiz" style="display: none;"></div>
            <div class="rh-summarizer-flashcard-results" style="display: none;"></div>
          </div>
          <!-- Chat Section -->
          <div class="rh-summarizer-chat" style="display: none;">
            <div class="rh-summarizer-chat-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>Ask the Learning Assistant</span>
            </div>
            <div class="rh-summarizer-chat-messages"></div>
            <div class="rh-summarizer-chat-input-container">
              <input 
                type="text" 
                class="rh-summarizer-chat-input" 
                placeholder="Ask a question about the video..."
                autocomplete="off"
              >
              <button class="rh-summarizer-chat-send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="rh-summarizer-modal-footer">
          <button class="rh-summarizer-chat-scroll-btn" style="display: none;" title="Go to Chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
          <button class="rh-summarizer-flashcard-btn" style="display: none;" title="Quiz with flashcards">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            Flashcards
          </button>
          <button class="rh-summarizer-download-btn" style="display: none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Notes (PDF)
          </button>
          <button class="rh-summarizer-retry-btn" style="display: none;">Retry</button>
        </div>
      </div>
    `;

    // Event listeners
    modal.querySelector('.rh-summarizer-modal-backdrop').addEventListener('click', hideModal);
    modal.querySelector('.rh-summarizer-modal-close').addEventListener('click', hideModal);
    modal.querySelector('.rh-summarizer-flashcard-btn').addEventListener('click', handleFlashcardClick);
    modal.querySelector('.rh-summarizer-download-btn').addEventListener('click', downloadNotesAsPdf);
    modal.querySelector('.rh-summarizer-chat-scroll-btn').addEventListener('click', scrollToChat);
    modal.querySelector('.rh-summarizer-retry-btn').addEventListener('click', handleSummarizeClick);
    
    // Chat event listeners
    const chatInput = modal.querySelector('.rh-summarizer-chat-input');
    const chatSendBtn = modal.querySelector('.rh-summarizer-chat-send');
    
    chatSendBtn.addEventListener('click', () => {
      const question = chatInput.value.trim();
      if (question) {
        handleChatSubmit(question);
        chatInput.value = '';
      }
    });
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const question = chatInput.value.trim();
        if (question) {
          handleChatSubmit(question);
          chatInput.value = '';
        }
      }
    });

    return modal;
  }

  function createApiKeyModal() {
    Logger.ui('Creating API key modal...');
    
    const modal = document.createElement('div');
    modal.id = 'rh-summarizer-apikey-modal';
    modal.className = 'rh-summarizer-modal';
    modal.innerHTML = `
      <div class="rh-summarizer-modal-backdrop"></div>
      <div class="rh-summarizer-modal-content rh-summarizer-apikey-content">
        <div class="rh-summarizer-modal-header">
          <h2>Enter Gemini API Key</h2>
          <button class="rh-summarizer-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="rh-summarizer-modal-body">
          <p>To use the summarization feature, you need a Gemini API key.</p>
          <p><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Get your free API key here</a></p>
          <div class="rh-summarizer-input-group">
            <label for="rh-apikey-input">API Key:</label>
            <input type="password" id="rh-apikey-input" placeholder="Enter your Gemini API key">
          </div>
          <div class="rh-summarizer-checkbox-group">
            <input type="checkbox" id="rh-apikey-remember">
            <label for="rh-apikey-remember">Remember this key</label>
          </div>
        </div>
        <div class="rh-summarizer-modal-footer">
          <button class="rh-summarizer-cancel-btn">Cancel</button>
          <button class="rh-summarizer-save-btn">Save & Continue</button>
        </div>
      </div>
    `;

    modal.querySelector('.rh-summarizer-modal-backdrop').addEventListener('click', () => hideApiKeyModal());
    modal.querySelector('.rh-summarizer-modal-close').addEventListener('click', () => hideApiKeyModal());
    modal.querySelector('.rh-summarizer-cancel-btn').addEventListener('click', () => hideApiKeyModal());
    modal.querySelector('.rh-summarizer-save-btn').addEventListener('click', saveApiKey);

    return modal;
  }

  // ============================================
  // UI Helpers
  // ============================================

  function updateButtonState() {
    const btn = document.getElementById('rh-summarizer-btn');
    if (!btn) return;

    if (isProcessing) {
      btn.disabled = true;
      btn.classList.add('processing');
      btn.querySelector('span').textContent = 'Processing...';
    } else if (capturedTranscript) {
      btn.disabled = false;
      btn.classList.remove('processing');
      btn.classList.add('ready');
      btn.querySelector('span').textContent = 'Learning Assistant';
    } else {
      btn.disabled = false;
      btn.classList.remove('processing', 'ready');
      btn.querySelector('span').textContent = 'Learning Assistant';
    }
  }

  function showModal() {
    Logger.ui('Showing summary modal');
    const modal = document.getElementById('rh-summarizer-modal');
    if (modal) {
      modal.classList.add('visible');
      document.body.style.overflow = 'hidden';
    }
  }

  function hideModal() {
    Logger.ui('Hiding summary modal');
    const modal = document.getElementById('rh-summarizer-modal');
    if (modal) {
      modal.classList.remove('visible');
      document.body.style.overflow = '';
    }
  }

  function showApiKeyModal() {
    Logger.ui('Showing API key modal');
    const modal = document.getElementById('rh-summarizer-apikey-modal');
    if (modal) {
      modal.classList.add('visible');
      document.body.style.overflow = 'hidden';
      modal.querySelector('#rh-apikey-input').focus();
    }
  }

  function hideApiKeyModal() {
    Logger.ui('Hiding API key modal');
    const modal = document.getElementById('rh-summarizer-apikey-modal');
    if (modal) {
      modal.classList.remove('visible');
      document.body.style.overflow = '';
    }
  }

  function showLoading() {
    const modal = document.getElementById('rh-summarizer-modal');
    if (!modal) return;
    
    modal.querySelector('.rh-summarizer-loading').style.display = 'flex';
    modal.querySelector('.rh-summarizer-result').style.display = 'none';
    modal.querySelector('.rh-summarizer-error').style.display = 'none';
    modal.querySelector('.rh-summarizer-download-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-flashcard-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-chat-scroll-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-retry-btn').style.display = 'none';
    
    // Hide chat and flashcard during loading
    const chatSection = modal.querySelector('.rh-summarizer-chat');
    if (chatSection) chatSection.style.display = 'none';
    const flashcardSection = modal.querySelector('.rh-summarizer-flashcard');
    if (flashcardSection) flashcardSection.style.display = 'none';
  }

  function showResult(html) {
    const modal = document.getElementById('rh-summarizer-modal');
    if (!modal) return;
    
    modal.querySelector('.rh-summarizer-loading').style.display = 'none';
    modal.querySelector('.rh-summarizer-result').style.display = 'block';
    modal.querySelector('.rh-summarizer-result').innerHTML = html;
    modal.querySelector('.rh-summarizer-error').style.display = 'none';
    modal.querySelector('.rh-summarizer-download-btn').style.display = 'inline-flex';
    modal.querySelector('.rh-summarizer-flashcard-btn').style.display = 'inline-flex';
    modal.querySelector('.rh-summarizer-chat-scroll-btn').style.display = 'inline-flex';
    modal.querySelector('.rh-summarizer-retry-btn').style.display = 'none';
    
    // Ensure flashcard section is hidden when showing result
    const flashcardSection = modal.querySelector('.rh-summarizer-flashcard');
    if (flashcardSection) flashcardSection.style.display = 'none';
    isFlashcardMode = false;
    
    // Show chat section after summary is displayed
    const chatSection = modal.querySelector('.rh-summarizer-chat');
    if (chatSection) {
      chatSection.style.display = 'block';
      Logger.ui('Chat section enabled');
    }
  }

  function showError(message) {
    const modal = document.getElementById('rh-summarizer-modal');
    if (!modal) return;
    
    modal.querySelector('.rh-summarizer-loading').style.display = 'none';
    modal.querySelector('.rh-summarizer-result').style.display = 'none';
    modal.querySelector('.rh-summarizer-error').style.display = 'block';
    modal.querySelector('.rh-summarizer-error').innerHTML = `
      <div class="rh-summarizer-error-icon">⚠️</div>
      <p>${message}</p>
    `;
    modal.querySelector('.rh-summarizer-download-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-flashcard-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-chat-scroll-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-retry-btn').style.display = 'inline-block';
    
    // Hide chat and flashcard on error
    const chatSection = modal.querySelector('.rh-summarizer-chat');
    if (chatSection) chatSection.style.display = 'none';
    const flashcardSection = modal.querySelector('.rh-summarizer-flashcard');
    if (flashcardSection) flashcardSection.style.display = 'none';
  }

  // ============================================
  // API Key Management
  // ============================================

  async function getApiKey() {
    Logger.debug('Checking for stored API key...');
    
    if (!isExtensionContextValid()) {
      Logger.error('Extension context invalidated');
      showExtensionReloadNotice();
      return null;
    }
    
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
          if (chrome.runtime.lastError) {
            Logger.warn('Storage access failed:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          
          if (result.geminiApiKey) {
            Logger.success('API key found in storage');
          } else {
            Logger.info('No API key found in storage');
          }
          resolve(result.geminiApiKey || null);
        });
      } catch (e) {
        Logger.error('Storage error:', e.message);
        resolve(null);
      }
    });
  }

  async function saveApiKey() {
    const input = document.getElementById('rh-apikey-input');
    const remember = document.getElementById('rh-apikey-remember');
    const apiKey = input.value.trim();

    if (!apiKey) {
      Logger.warn('User submitted empty API key');
      alert('Please enter a valid API key');
      return;
    }

    Logger.info('Saving API key...');
    
    if (remember.checked) {
      await chrome.storage.local.set({ geminiApiKey: apiKey });
      Logger.success('API key saved to storage');
    } else {
      Logger.info('API key not saved (remember not checked)');
    }

    hideApiKeyModal();
    
    // Continue with summarization
    await performSummarization(apiKey);
  }

  // ============================================
  // Gemini API Integration
  // ============================================

  function buildPrompt(transcript) {
    return `You are an expert at summarizing technical video content. Analyze the following transcript from a Red Hat Learning video and provide a structured summary.

Please format your response with the following sections:

## Key Concepts
List the main topics and concepts covered in this video. Be specific and technical.

## Commands Mentioned
Extract any CLI commands, code snippets, configuration examples, or technical commands mentioned. Format them as code blocks. If no commands are mentioned, write "No specific commands mentioned."

## Practical Takeaways
List actionable insights and practical tips that learners can apply immediately.

---

TRANSCRIPT:
${transcript}

---

Provide the summary in clear, well-formatted markdown.`;
  }

  async function callGeminiApi(apiKey, prompt, options = {}) {
    const { retryCount = 0, maxTokens = 4096 } = options;
    const url = `${GEMINI_API_URL}?key=${apiKey}`;
    
    Logger.api(`Calling Gemini API (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
    Logger.debug(`Prompt length: ${prompt.length} characters, maxTokens: ${maxTokens}`);
    
    const body = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens,
        topP: 0.8,
        topK: 40
      }
    };

    try {
      Logger.api('Sending POST request to Gemini...');
      const startTime = Date.now();
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const elapsed = Date.now() - startTime;
      Logger.api(`Response received in ${elapsed}ms - Status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        Logger.error(`API error response:`, errorData);
        
        if (response.status === 429) {
          Logger.error('Rate limit exceeded');
          throw new Error('API quota exceeded. Please try again later or check your Gemini API quota.');
        } else if (response.status === 401 || response.status === 403) {
          Logger.error('Authentication failed - clearing stored key');
          await chrome.storage.local.remove(['geminiApiKey']);
          throw new Error('Invalid API key. Please enter a valid Gemini API key.');
        } else {
          throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
        }
      }

      const data = await response.json();
      Logger.debug('Parsing API response...');
      
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        Logger.error('Unexpected response structure:', JSON.stringify(data).substring(0, 200));
        throw new Error('Unexpected API response format');
      }

      const resultText = data.candidates[0].content.parts[0].text;
      Logger.success(`API response received: ${resultText.length} characters`);
      
      return resultText;
    } catch (error) {
      Logger.error(`API call failed: ${error.message}`);
      
      if (retryCount < MAX_RETRIES && (error.message.includes('network') || error.message.includes('fetch'))) {
        const delay = RETRY_DELAY_MS * (retryCount + 1);
        Logger.warn(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callGeminiApi(apiKey, prompt, { retryCount: retryCount + 1, maxTokens });
      }
      throw error;
    }
  }

  function markdownToHtml(markdown) {
    Logger.debug('Converting markdown to HTML...');
    
    const html = markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h4>$1</h4>')
      .replace(/^## (.*$)/gim, '<h3>$1</h3>')
      .replace(/^# (.*$)/gim, '<h2>$1</h2>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Unordered lists
      .replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>')
      // Ordered lists
      .replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>')
      // Wrap consecutive list items
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      // Wrap in paragraphs
      .replace(/^(?!<[hup]|<li|<pre|<code)(.+)$/gim, '<p>$1</p>')
      // Clean up
      .replace(/<p><\/p>/g, '')
      .replace(/<p><br><\/p>/g, '')
      .replace(/---/g, '<hr>');
    
    Logger.debug(`Converted to HTML: ${html.length} characters`);
    return html;
  }

  // ============================================
  // Chat Functions
  // ============================================

  /**
   * Build the chat prompt with transcript context and conversation history
   */
  function buildChatPrompt(question, transcript, history) {
    const historyText = history.length > 0 
      ? history.map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n\n')
      : 'No previous conversation.';

    return `You are a helpful assistant answering questions about a Red Hat Learning video.

IMPORTANT RULES:
- Answer ONLY based on the transcript provided below
- If the answer is not in the transcript, clearly say "This topic isn't covered in the video transcript."
- Be concise but thorough
- When relevant, quote or reference specific parts of the transcript
- Format code snippets and commands in markdown code blocks

TRANSCRIPT:
${transcript}

PREVIOUS CONVERSATION:
${historyText}

USER QUESTION: ${question}

Provide a helpful, accurate answer based strictly on the transcript content.`;
  }

  /**
   * Add a message to the chat UI
   */
  function addChatMessage(role, content, isLoading = false) {
    const messagesContainer = document.querySelector('.rh-summarizer-chat-messages');
    if (!messagesContainer) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `rh-summarizer-chat-message ${role}${isLoading ? ' loading' : ''}`;
    
    const labelText = role === 'user' ? 'You' : 'Assistant';
    
    if (isLoading) {
      messageDiv.innerHTML = `
        <div class="rh-summarizer-chat-message-label">${labelText}</div>
        <div class="rh-summarizer-chat-message-content">
          <div class="rh-summarizer-chat-typing">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      `;
    } else {
      const formattedContent = role === 'bot' ? markdownToHtml(content) : content;
      messageDiv.innerHTML = `
        <div class="rh-summarizer-chat-message-label">${labelText}</div>
        <div class="rh-summarizer-chat-message-content">${formattedContent}</div>
      `;
    }

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageDiv;
  }

  /**
   * Handle chat submission
   */
  async function handleChatSubmit(question) {
    Logger.info('Chat question submitted:', question);
    
    if (!capturedTranscript) {
      Logger.error('No transcript available for chat');
      addChatMessage('bot', 'Error: No transcript available. Please summarize a video first.');
      return;
    }

    // Get API key
    const apiKey = await getApiKey();
    if (!apiKey) {
      Logger.error('No API key for chat');
      showApiKeyModal();
      return;
    }

    // Disable input while processing
    const chatInput = document.querySelector('.rh-summarizer-chat-input');
    const chatSendBtn = document.querySelector('.rh-summarizer-chat-send');
    if (chatInput) chatInput.disabled = true;
    if (chatSendBtn) chatSendBtn.disabled = true;

    // Add user message to UI
    addChatMessage('user', question);

    // Add to history
    chatHistory.push({ role: 'user', content: question });

    // Show loading message
    const loadingMessage = addChatMessage('bot', '', true);

    try {
      // Build prompt with context
      const prompt = buildChatPrompt(question, capturedTranscript, chatHistory.slice(0, -1));
      Logger.debug(`Chat prompt length: ${prompt.length} characters`);

      // Call Gemini API
      const response = await callGeminiApi(apiKey, prompt, { maxTokens: 2048 });
      
      Logger.info(`Chat response received: ${response.length} characters`);

      // Remove loading message
      if (loadingMessage) loadingMessage.remove();

      // Add bot response to UI
      addChatMessage('bot', response);

      // Add to history
      chatHistory.push({ role: 'assistant', content: response });

    } catch (error) {
      Logger.error('Chat error:', error.message);
      
      // Remove loading message
      if (loadingMessage) loadingMessage.remove();

      // Show error message
      addChatMessage('bot', `Sorry, I encountered an error: ${error.message}`);

      // Remove the failed question from history
      chatHistory.pop();
    } finally {
      // Re-enable input
      if (chatInput) {
        chatInput.disabled = false;
        chatInput.focus();
      }
      if (chatSendBtn) chatSendBtn.disabled = false;
    }
  }

  /**
   * Clear chat history and UI
   */
  function clearChat() {
    chatHistory = [];
    const messagesContainer = document.querySelector('.rh-summarizer-chat-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }
    Logger.debug('Chat cleared');
  }

  // ============================================
  // Main Summarization Logic
  // ============================================

  async function handleSummarizeClick() {
    Logger.info('Summarize button clicked');
    
    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
      Logger.error('Extension context invalidated');
      showExtensionReloadNotice();
      return;
    }
    
    if (isProcessing) {
      Logger.warn('Already processing, ignoring click');
      return;
    }

    // Check if we have a transcript
    if (!capturedTranscript) {
      Logger.info('No transcript in memory, checking storage...');
      
      const response = await safeSendMessage({ type: 'GET_TRANSCRIPT' });
      if (response?.success) {
        capturedTranscript = response.transcript;
        Logger.success(`Retrieved transcript from storage: ${capturedTranscript.length} chars`);
      } else {
        Logger.warn('No transcript found in storage');
      }
    }

    if (!capturedTranscript) {
      Logger.warn('No transcript available - showing error to user');
      showModal();
      showError('No transcript found. Please play the video first to capture the transcript, then try again.');
      return;
    }

    Logger.info(`Transcript available: ${capturedTranscript.length} characters`);

    // Check for API key
    const apiKey = await getApiKey();
    if (!apiKey) {
      Logger.info('No API key - prompting user');
      showApiKeyModal();
      return;
    }

    await performSummarization(apiKey);
  }

  async function performSummarization(apiKey) {
    Logger.info('='.repeat(50));
    Logger.info('Starting summarization process...');
    Logger.info('='.repeat(50));
    
    isProcessing = true;
    updateButtonState();
    showModal();
    showLoading();
    
    // Clear previous chat and flashcards when starting new summarization
    clearChat();
    flashcards = null;
    allFlashcards = null;
    wrongCards = [];

    const startTime = Date.now();

    try {
      Logger.info(`Transcript length: ${capturedTranscript.length} characters`);
      
      // Build prompt and send full transcript
      const prompt = buildPrompt(capturedTranscript);
      Logger.info(`Total prompt length: ${prompt.length} characters`);
      
      const summary = await callGeminiApi(apiKey, prompt, { maxTokens: 8192 });
      
      Logger.info(`Summary received: ${summary.length} characters`);
      
      // Store summary for potential future use
      currentSummary = summary;
      
      const html = markdownToHtml(summary);
      showResult(html);

      const elapsed = Date.now() - startTime;
      Logger.success('='.repeat(50));
      Logger.success(`Summarization complete in ${(elapsed / 1000).toFixed(1)}s`);
      Logger.success('='.repeat(50));

    } catch (error) {
      const elapsed = Date.now() - startTime;
      Logger.error('='.repeat(50));
      Logger.error(`Summarization failed after ${(elapsed / 1000).toFixed(1)}s`);
      Logger.error(`Error: ${error.message}`);
      Logger.error('='.repeat(50));
      
      showError(error.message || 'An unexpected error occurred. Please try again.');
    } finally {
      isProcessing = false;
      updateButtonState();
    }
  }

  /**
   * Scroll to the chat section in the modal
   */
  function scrollToChat() {
    Logger.ui('Scrolling to chat section');
    const chatSection = document.querySelector('.rh-summarizer-chat');
    if (chatSection) {
      chatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Focus on chat input after scrolling
      setTimeout(() => {
        const chatInput = document.querySelector('.rh-summarizer-chat-input');
        if (chatInput) chatInput.focus();
      }, 300);
    }
  }

  // ============================================
  // Flashcard Functions
  // ============================================

  /**
   * Enter flashcard mode - hide result/chat, show flashcard section, hide footer buttons to prevent overlap
   */
  function enterFlashcardMode() {
    const modal = document.getElementById('rh-summarizer-modal');
    if (!modal) return;
    
    modal.querySelector('.rh-summarizer-result').style.display = 'none';
    modal.querySelector('.rh-summarizer-chat').style.display = 'none';
    modal.querySelector('.rh-summarizer-chat-scroll-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-flashcard-btn').style.display = 'none';
    modal.querySelector('.rh-summarizer-download-btn').style.display = 'none';
    const flashcardSection = modal.querySelector('.rh-summarizer-flashcard');
    if (flashcardSection) {
      flashcardSection.style.display = 'block';
      flashcardSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    isFlashcardMode = true;
  }

  /**
   * Exit flashcard mode - show result/chat, show footer buttons, hide flashcard section
   */
  function exitFlashcardMode() {
    const modal = document.getElementById('rh-summarizer-modal');
    if (!modal) return;
    
    modal.querySelector('.rh-summarizer-result').style.display = 'block';
    modal.querySelector('.rh-summarizer-chat').style.display = 'block';
    modal.querySelector('.rh-summarizer-chat-scroll-btn').style.display = 'inline-flex';
    modal.querySelector('.rh-summarizer-flashcard-btn').style.display = 'inline-flex';
    modal.querySelector('.rh-summarizer-download-btn').style.display = 'inline-flex';
    const flashcardSection = modal.querySelector('.rh-summarizer-flashcard');
    if (flashcardSection) flashcardSection.style.display = 'none';
    isFlashcardMode = false;
  }

  /**
   * Show flashcard loading state
   */
  function showFlashcardLoading() {
    const container = document.querySelector('.rh-summarizer-flashcard');
    if (!container) return;
    container.querySelector('.rh-summarizer-flashcard-loading').style.display = 'flex';
    container.querySelector('.rh-summarizer-flashcard-quiz').style.display = 'none';
    container.querySelector('.rh-summarizer-flashcard-results').style.display = 'none';
  }

  /**
   * Build Gemini prompt for flashcard generation
   */
  function buildFlashcardPrompt(transcript) {
    return `You are an expert at creating quiz questions from technical video content. Based on the following transcript from a Red Hat Learning video, generate 5-8 multiple choice quiz questions.

RULES:
- Each question must have exactly 4 options (A, B, C, D)
- The correct answer must be one of the options
- Mix up the position of the correct answer across questions
- Focus on key concepts, commands, and technical details from the transcript
- Questions should be clear and test understanding, not memorization

Respond with ONLY a valid JSON array, no other text. Format:
[{"question":"...","answer":"...","options":["A option text","B option text","C option text","D option text"]}]

The "answer" field must be the exact text of the correct option (e.g. "A option text").

TRANSCRIPT:
${transcript.substring(0, 12000)}
`;
  }

  /**
   * Parse flashcard JSON from Gemini response (handle markdown code blocks)
   */
  function parseFlashcardResponse(text) {
    let cleaned = text.trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
    return JSON.parse(cleaned);
  }

  /**
   * Generate flashcards via Gemini API
   */
  async function generateFlashcards(apiKey) {
    Logger.info('Generating flashcards...');
    
    try {
      const prompt = buildFlashcardPrompt(capturedTranscript);
      const response = await callGeminiApi(apiKey, prompt, { maxTokens: 4096 });
      
      const parsed = parseFlashcardResponse(response);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Invalid flashcard format');
      }
      
      flashcards = parsed.map(item => ({
        question: item.question || '',
        answer: item.answer || '',
        options: Array.isArray(item.options) ? item.options : []
      })).filter(f => f.question && f.answer && f.options.length >= 2);
      
      if (flashcards.length === 0) {
        throw new Error('No valid flashcards generated');
      }
      
      allFlashcards = [...flashcards];
      Logger.success(`Generated ${flashcards.length} flashcards`);
      startFlashcardQuiz();
    } catch (error) {
      Logger.error('Flashcard generation failed:', error.message);
      showFlashcardError(error.message);
    }
  }

  /**
   * Show flashcard error state
   */
  function showFlashcardError(message) {
    const container = document.querySelector('.rh-summarizer-flashcard');
    if (!container) return;
    container.querySelector('.rh-summarizer-flashcard-loading').style.display = 'none';
    container.querySelector('.rh-summarizer-flashcard-quiz').style.display = 'block';
    container.querySelector('.rh-summarizer-flashcard-quiz').innerHTML = `
      <div class="rh-summarizer-flashcard-error">
        <div class="rh-summarizer-error-icon">⚠️</div>
        <p>${escapeHtml(message)}</p>
        <button class="rh-summarizer-btn rh-summarizer-retry-btn" id="rh-flashcard-retry-gen">Retry</button>
        <button class="rh-summarizer-cancel-btn" id="rh-flashcard-back">Back to Summary</button>
      </div>
    `;
    document.getElementById('rh-flashcard-retry-gen')?.addEventListener('click', () => handleFlashcardClick());
    document.getElementById('rh-flashcard-back')?.addEventListener('click', exitFlashcardMode);
  }

  /**
   * Shuffle array (Fisher-Yates)
   */
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Start/reset flashcard quiz - shuffle and show first question
   * @param {Array} cardSet - Optional: use only these cards (e.g. wrongCards for focus retest)
   */
  function startFlashcardQuiz(cardSet = null) {
    const useCards = cardSet && cardSet.length > 0 ? cardSet : (allFlashcards || flashcards);
    if (!useCards || useCards.length === 0) return;
    
    flashcards = shuffleArray([...useCards]);
    wrongCards = [];
    flashcardIndex = 0;
    flashcardScore = 0;
    
    const container = document.querySelector('.rh-summarizer-flashcard');
    if (!container) return;
    
    container.querySelector('.rh-summarizer-flashcard-loading').style.display = 'none';
    container.querySelector('.rh-summarizer-flashcard-results').style.display = 'none';
    const quizEl = container.querySelector('.rh-summarizer-flashcard-quiz');
    quizEl.style.display = 'block';
    
    renderFlashcardQuestion();
  }

  /**
   * Retest only on questions answered incorrectly (focus on weak areas)
   */
  function startFocusRetest() {
    startFlashcardQuiz(wrongCards);
  }

  /**
   * Render current flashcard question
   */
  function renderFlashcardQuestion() {
    const card = flashcards[flashcardIndex];
    const total = flashcards.length;
    const quizEl = document.querySelector('.rh-summarizer-flashcard-quiz');
    if (!quizEl) return;
    
    const optionsHtml = card.options.map((opt, i) => {
      const label = String.fromCharCode(65 + i);
      return `
        <button class="rh-summarizer-flashcard-option" data-answer="${escapeHtml(opt)}" data-index="${i}">
          <span class="rh-summarizer-flashcard-option-label">${label}.</span>
          <span class="rh-summarizer-flashcard-option-text">${escapeHtml(opt)}</span>
        </button>
      `;
    }).join('');
    
    quizEl.innerHTML = `
      <div class="rh-summarizer-flashcard-progress">Card ${flashcardIndex + 1} of ${total}</div>
      <div class="rh-summarizer-flashcard-question">${escapeHtml(card.question)}</div>
      <div class="rh-summarizer-flashcard-options">${optionsHtml}</div>
      <div class="rh-summarizer-flashcard-actions">
        <button class="rh-summarizer-cancel-btn" id="rh-flashcard-back-btn">Back to Summary</button>
      </div>
    `;
    
    quizEl.querySelectorAll('.rh-summarizer-flashcard-option').forEach(btn => {
      btn.addEventListener('click', () => handleFlashcardAnswer(btn));
    });
    document.getElementById('rh-flashcard-back-btn')?.addEventListener('click', exitFlashcardMode);
  }

  /**
   * Escape HTML for safe display
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle user selecting an answer
   */
  function handleFlashcardAnswer(clickedBtn) {
    const card = flashcards[flashcardIndex];
    const selectedAnswer = clickedBtn.dataset.answer;
    const isCorrect = selectedAnswer === card.answer;
    
    if (isCorrect) {
      flashcardScore++;
    } else {
      wrongCards.push(card);
    }
    
    const options = clickedBtn.closest('.rh-summarizer-flashcard-options');
    if (options) {
      options.querySelectorAll('.rh-summarizer-flashcard-option').forEach(btn => {
        btn.disabled = true;
        const optText = btn.dataset.answer;
        if (optText === card.answer) {
          btn.classList.add('correct');
        } else if (optText === selectedAnswer && !isCorrect) {
          btn.classList.add('incorrect');
        }
      });
    }
    
    const quizEl = document.querySelector('.rh-summarizer-flashcard-quiz');
    const feedback = document.createElement('div');
    feedback.className = `rh-summarizer-flashcard-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    feedback.innerHTML = `
      <strong>${isCorrect ? 'Correct!' : 'Incorrect'}</strong>
      <p class="rh-summarizer-flashcard-correct-answer">Correct answer: ${escapeHtml(card.answer)}</p>
      <p class="rh-summarizer-flashcard-score">Score: ${flashcardScore}/${flashcardIndex + 1}</p>
      <button class="rh-summarizer-btn rh-summarizer-flashcard-next" id="rh-flashcard-next">
        ${flashcardIndex + 1 < flashcards.length ? 'Next' : 'See Results'}
      </button>
    `;
    quizEl.appendChild(feedback);
    
    document.getElementById('rh-flashcard-next')?.addEventListener('click', () => {
      if (flashcardIndex + 1 < flashcards.length) {
        flashcardIndex++;
        renderFlashcardQuestion();
      } else {
        showFlashcardResults();
      }
    });
  }

  /**
   * Show final flashcard results
   */
  function showFlashcardResults() {
    const total = flashcards.length;
    const percent = Math.round((flashcardScore / total) * 100);
    const wrongCount = wrongCards.length;
    
    const container = document.querySelector('.rh-summarizer-flashcard');
    if (!container) return;
    
    container.querySelector('.rh-summarizer-flashcard-loading').style.display = 'none';
    container.querySelector('.rh-summarizer-flashcard-quiz').style.display = 'none';
    const resultsEl = container.querySelector('.rh-summarizer-flashcard-results');
    resultsEl.style.display = 'block';
    
    const focusRetestHtml = wrongCount > 0
      ? `<button class="rh-summarizer-btn rh-summarizer-flashcard-focus-btn" id="rh-flashcard-retest-incorrect" title="Practice only the ${wrongCount} question(s) you got wrong">
          Retest Incorrect Only (${wrongCount} question${wrongCount === 1 ? '' : 's'})
        </button>`
      : '';
    
    resultsEl.innerHTML = `
      <div class="rh-summarizer-flashcard-results-score">
        <h3>Quiz Complete!</h3>
        <p class="rh-summarizer-flashcard-final-score">${flashcardScore} / ${total} correct (${percent}%)</p>
        ${wrongCount > 0 ? `<p class="rh-summarizer-flashcard-focus-hint">Focus on your weak areas by retesting only the questions you missed.</p>` : ''}
      </div>
      <div class="rh-summarizer-flashcard-results-actions">
        <button class="rh-summarizer-btn" id="rh-flashcard-retest">Retest All</button>
        ${focusRetestHtml}
        <button class="rh-summarizer-cancel-btn" id="rh-flashcard-back-results">Back to Summary</button>
      </div>
    `;
    
    document.getElementById('rh-flashcard-retest')?.addEventListener('click', () => startFlashcardQuiz());
    document.getElementById('rh-flashcard-retest-incorrect')?.addEventListener('click', startFocusRetest);
    document.getElementById('rh-flashcard-back-results')?.addEventListener('click', exitFlashcardMode);
  }

  /**
   * Handle Flashcards button click
   */
  async function handleFlashcardClick() {
    Logger.info('Flashcards button clicked');
    
    if (!capturedTranscript) {
      Logger.warn('No transcript for flashcards');
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      showApiKeyModal();
      return;
    }

    enterFlashcardMode();
    showFlashcardLoading();

    if (flashcards && flashcards.length > 0) {
      // Already have flashcards - show quiz (will reshuffle on retest)
      startFlashcardQuiz();
    } else {
      // Generate flashcards via Gemini
      await generateFlashcards(apiKey);
    }
  }

  /**
   * Download summary as PDF using print dialog
   */
  function downloadNotesAsPdf() {
    Logger.info('Generating PDF...');
    
    const resultDiv = document.querySelector('.rh-summarizer-result');
    if (!resultDiv) {
      Logger.error('Result div not found');
      return;
    }

    // Get the video title from the page if available
    const pageTitle = document.title || 'Video Summary';
    const videoTitle = pageTitle.replace(' - Red Hat Learning', '').trim();

    // Create a printable HTML document
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${videoTitle} - Notes</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #333;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
          }
          h1 {
            font-size: 18pt;
            color: #ee0000;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 2px solid #ee0000;
          }
          .subtitle {
            font-size: 10pt;
            color: #666;
            margin-bottom: 24px;
          }
          h2, h3 {
            font-size: 14pt;
            color: #151515;
            margin: 20px 0 12px 0;
            padding-bottom: 4px;
            border-bottom: 1px solid #ddd;
          }
          h4 {
            font-size: 12pt;
            color: #333;
            margin: 16px 0 8px 0;
          }
          p {
            margin-bottom: 12px;
          }
          ul, ol {
            margin: 0 0 16px 24px;
          }
          li {
            margin-bottom: 6px;
          }
          code {
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 10pt;
          }
          pre {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 12px 0;
            font-size: 10pt;
          }
          pre code {
            background: transparent;
            padding: 0;
            color: inherit;
          }
          hr {
            border: none;
            border-top: 1px solid #ddd;
            margin: 20px 0;
          }
          strong {
            font-weight: 600;
          }
          @media print {
            body {
              padding: 20px;
            }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
            }
          }
        </style>
      </head>
      <body>
        <h1>${videoTitle}</h1>
        <div class="subtitle">Generated by RH Learning Assistant • ${new Date().toLocaleDateString()}</div>
        ${resultDiv.innerHTML}
      </body>
      </html>
    `;

    // Open a new window for printing
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      Logger.error('Could not open print window. Please allow popups.');
      alert('Could not open print window. Please allow popups for this site.');
      return;
    }

    printWindow.document.write(printContent);
    printWindow.document.close();

    // Wait for content to load then trigger print
    printWindow.onload = function() {
      Logger.info('Opening print dialog for PDF save...');
      printWindow.print();
    };

    // Update button state temporarily
    const downloadBtn = document.querySelector('.rh-summarizer-download-btn');
    if (downloadBtn) {
      const originalText = downloadBtn.innerHTML;
      downloadBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        PDF Ready!
      `;
      setTimeout(() => {
        downloadBtn.innerHTML = originalText;
      }, 2000);
    }
  }

  // ============================================
  // Initialization
  // ============================================

  function init() {
    Logger.success('='.repeat(50));
    Logger.success('RH Learning Assistant - Content Script');
    Logger.success('='.repeat(50));
    
    Logger.info('Initializing extension...');
    Logger.debug(`Page URL: ${window.location.href}`);

    // Inject the interceptor script
    injectInterceptorScript();

    // Create and inject UI elements
    Logger.ui('Injecting UI components...');
    const button = createSummarizeButton();
    const modal = createModal();
    const apiKeyModal = createApiKeyModal();

    document.body.appendChild(button);
    document.body.appendChild(modal);
    document.body.appendChild(apiKeyModal);
    Logger.success('UI components injected');

    // Try to recover transcript from storage
    Logger.debug('Checking for existing transcript in storage...');
    safeSendMessage({ type: 'GET_TRANSCRIPT' }).then((response) => {
      if (response?.success) {
        capturedTranscript = response.transcript;
        Logger.success(`Recovered transcript from storage: ${capturedTranscript.length} chars`);
        updateButtonState();
      } else {
        Logger.info('No existing transcript found - waiting for video playback');
      }
    });

    Logger.success('Extension initialized successfully');
    Logger.info('Click "Learning Assistant" button after playing a video');
  }

  // Wait for DOM to be ready
  Logger.info('Waiting for DOM...');
  if (document.readyState === 'loading') {
    Logger.debug('DOM still loading, adding event listener');
    document.addEventListener('DOMContentLoaded', init);
  } else {
    Logger.debug('DOM already ready, initializing immediately');
    init();
  }

})();
