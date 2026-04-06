/**
 * Popup Script - API Key Settings Management
 */

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const showBtn = document.getElementById('showBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusDiv = document.getElementById('status');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  let isKeyVisible = false;

  // Load existing API key status
  loadApiKeyStatus();

  // Event listeners
  saveBtn.addEventListener('click', saveApiKey);
  showBtn.addEventListener('click', toggleKeyVisibility);
  clearBtn.addEventListener('click', clearApiKey);
  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveApiKey();
    }
  });

  /**
   * Load and display API key status
   */
  function loadApiKeyStatus() {
    chrome.storage.local.get(['geminiApiKey'], (result) => {
      if (result.geminiApiKey) {
        statusDot.className = 'api-status-dot configured';
        statusText.textContent = 'API key configured';
        apiKeyInput.placeholder = '••••••••••••••••';
      } else {
        statusDot.className = 'api-status-dot not-configured';
        statusText.textContent = 'API key not configured';
        apiKeyInput.placeholder = 'Enter your Gemini API key';
      }
    });
  }

  /**
   * Save API key to storage
   */
  function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Please enter a valid API key', 'error');
      return;
    }

    // Basic validation - Gemini API keys start with 'AI'
    if (!apiKey.startsWith('AI') || apiKey.length < 30) {
      showStatus('Invalid API key format. Keys usually start with "AI"', 'error');
      return;
    }

    chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Failed to save API key', 'error');
        return;
      }

      showStatus('API key saved successfully!', 'success');
      apiKeyInput.value = '';
      loadApiKeyStatus();
    });
  }

  /**
   * Toggle API key visibility
   */
  function toggleKeyVisibility() {
    isKeyVisible = !isKeyVisible;
    
    if (isKeyVisible) {
      chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
          apiKeyInput.type = 'text';
          apiKeyInput.value = result.geminiApiKey;
          showBtn.textContent = 'Hide';
        } else {
          showStatus('No API key saved', 'info');
        }
      });
    } else {
      apiKeyInput.type = 'password';
      apiKeyInput.value = '';
      showBtn.textContent = 'Show';
      loadApiKeyStatus();
    }
  }

  /**
   * Clear saved API key
   */
  function clearApiKey() {
    if (!confirm('Are you sure you want to remove the saved API key?')) {
      return;
    }

    chrome.storage.local.remove(['geminiApiKey'], () => {
      if (chrome.runtime.lastError) {
        showStatus('Failed to clear API key', 'error');
        return;
      }

      showStatus('API key removed', 'success');
      apiKeyInput.value = '';
      apiKeyInput.type = 'password';
      isKeyVisible = false;
      showBtn.textContent = 'Show';
      loadApiKeyStatus();
    });
  }

  /**
   * Show status message
   */
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }
});
