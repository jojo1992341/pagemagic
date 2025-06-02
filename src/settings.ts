import { anthropicService } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;

  // Load existing settings
  const result = await chrome.storage.sync.get(['anthropicApiKey', 'selectedModel']);
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
  }

  // Load available models
  async function loadModels() {
    try {
      if (result.anthropicApiKey) {
        // Initialize service to fetch models
        await chrome.storage.sync.set({ anthropicApiKey: result.anthropicApiKey });
        const initialized = await anthropicService.initialize();
        
        if (initialized) {
          const models = await anthropicService.getAvailableModels();
          populateModelSelect(models);
          
          // Set selected model
          if (result.selectedModel) {
            modelSelect.value = result.selectedModel;
          } else {
            modelSelect.value = 'claude-3-5-haiku-20241022'; // Default to Haiku
          }
          modelSelect.disabled = false;
        }
      }
    } catch (error) {
      console.warn('Failed to load models:', error);
      // Populate with fallback models
      const fallbackModels = [
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet', type: 'message' },
        { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku', type: 'message' },
        { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus', type: 'message' }
      ];
      populateModelSelect(fallbackModels);
      modelSelect.value = result.selectedModel || 'claude-3-5-haiku-20241022';
      modelSelect.disabled = false;
    }
  }

  function populateModelSelect(models: any[]) {
    modelSelect.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.display_name || model.id;
      modelSelect.appendChild(option);
    });
  }

  // Load models on page load
  await loadModels();

  // Reload models when API key changes
  apiKeyInput.addEventListener('input', async () => {
    const currentKey = apiKeyInput.value.trim();
    if (currentKey && currentKey.startsWith('sk-ant-') && currentKey !== result.anthropicApiKey) {
      modelSelect.innerHTML = '<option value="">Loading models...</option>';
      modelSelect.disabled = true;
      
      try {
        await chrome.storage.sync.set({ anthropicApiKey: currentKey });
        const initialized = await anthropicService.initialize();
        
        if (initialized) {
          const models = await anthropicService.getAvailableModels();
          populateModelSelect(models);
          modelSelect.value = 'claude-3-5-haiku-20241022'; // Reset to default
          modelSelect.disabled = false;
        }
      } catch (error) {
        console.warn('Failed to reload models:', error);
        modelSelect.innerHTML = '<option value="">Failed to load models</option>';
      }
    }
  });

  function showStatus(message: string, type: 'success' | 'error') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedModel = modelSelect.value;
    
    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
      showStatus('API key should start with sk-ant-', 'error');
      return;
    }

    if (!selectedModel) {
      showStatus('Please select a model', 'error');
      return;
    }

    try {
      await chrome.storage.sync.set({ 
        anthropicApiKey: apiKey,
        selectedModel: selectedModel
      });
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      showStatus('Failed to save settings', 'error');
    }
  });

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    try {
      // Save key temporarily for test
      await chrome.storage.sync.set({ anthropicApiKey: apiKey });
      
      // Initialize service and test
      const initialized = await anthropicService.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize service');
      }

      // Upload test HTML first
      const uploadResponse = await anthropicService.uploadHTML('<body><p>Test</p></body>');
      
      // Test CSS generation
      const response = await anthropicService.generateCSS({
        fileId: uploadResponse.fileId,
        prompt: 'make text red'
      });
      
      // Clean up test file
      await anthropicService.deleteFile(uploadResponse.fileId);

      if (response.css) {
        showStatus('Connection successful!', 'success');
      } else {
        throw new Error('No CSS returned');
      }
    } catch (error) {
      showStatus(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });
});