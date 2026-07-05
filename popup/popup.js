const DEFAULT_MODELS = {
  gemini: 'gemini-1.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet',
  groq: 'llama-3.1-8b-instant',
  custom: 'llama3'
};

const MODEL_HINTS = {
  gemini: 'Default: gemini-1.5-flash (Google AI Studio)',
  openai: 'Default: gpt-4o-mini',
  anthropic: 'Default: claude-3-5-sonnet',
  groq: 'Default: llama-3.1-8b-instant',
  custom: 'e.g. llama3, mistral (Local or Custom)'
};

document.addEventListener('DOMContentLoaded', async () => {
  const providerSelect = document.getElementById('provider');
  const keyGroup = document.getElementById('key-group');
  const apiKeyInput = document.getElementById('api-key');
  const apiKeyLabel = document.getElementById('api-key-label');
  const urlGroup = document.getElementById('url-group');
  const customUrlInput = document.getElementById('custom-url');
  const modelInput = document.getElementById('model');
  const modelHint = document.getElementById('model-hint');
  const settingsForm = document.getElementById('settings-form');
  const statusMsg = document.getElementById('status-message');
  const testBtn = document.getElementById('test-btn');

  // Load saved configurations
  const config = await chrome.storage.local.get(['provider', 'apiKey', 'customUrl', 'model']);
  
  if (config.provider) {
    providerSelect.value = config.provider;
  }
  
  updateFieldsForProvider(providerSelect.value);

  if (config.apiKey) {
    apiKeyInput.value = config.apiKey;
  }
  if (config.customUrl) {
    customUrlInput.value = config.customUrl;
  }
  if (config.model) {
    modelInput.value = config.model;
  } else {
    modelInput.value = DEFAULT_MODELS[providerSelect.value];
  }

  // Handle provider changes
  providerSelect.addEventListener('change', () => {
    const selectedProvider = providerSelect.value;
    updateFieldsForProvider(selectedProvider);
    modelInput.value = DEFAULT_MODELS[selectedProvider];
  });

  // Handle save
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const customUrl = customUrlInput.value.trim();
    const model = modelInput.value.trim();

    await chrome.storage.local.set({ provider, apiKey, customUrl, model });
    showStatus('Settings saved successfully!', 'success');
  });

  // Handle connection test
  testBtn.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const customUrl = customUrlInput.value.trim();
    const model = modelInput.value.trim();

    if (provider !== 'custom' && !apiKey) {
      showStatus('API Key is required to test the connection.', 'error');
      return;
    }

    showStatus('Testing connection... Please wait.', 'info');
    testBtn.disabled = true;

    try {
      // Send a test connection command to background script
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        config: { provider, apiKey, customUrl, model }
      });

      if (response && response.success) {
        showStatus('Connection successful! Model responded.', 'success');
      } else {
        const errMsg = response?.error || 'Unknown error occurred.';
        showStatus(`Connection failed: ${errMsg}`, 'error');
      }
    } catch (err) {
      showStatus(`Message error: ${err.message}`, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  function updateFieldsForProvider(provider) {
    modelHint.textContent = MODEL_HINTS[provider];

    if (provider === 'custom') {
      urlGroup.classList.remove('hidden');
      customUrlInput.required = true;
      if (!customUrlInput.value) {
        customUrlInput.value = 'http://localhost:11434/v1';
      }
      apiKeyLabel.textContent = 'API Key (Optional)';
      apiKeyInput.required = false;
      apiKeyInput.placeholder = 'Optional key if custom endpoint requires it';
    } else {
      urlGroup.classList.add('hidden');
      customUrlInput.required = false;
      apiKeyLabel.textContent = 'API Key';
      apiKeyInput.required = true;
      apiKeyInput.placeholder = 'Enter your API key';
    }
  }

  function showStatus(message, type) {
    statusMsg.className = `status-msg ${type}`;
    statusMsg.textContent = message;
    statusMsg.classList.remove('hidden');
    setTimeout(() => {
      // Keep visible unless it is temporary, let's keep it visible so user can see it but fade in/out
    }, 4000);
  }
});
