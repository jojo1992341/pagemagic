import { anthropicService } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
  const clearAllBtn = document.getElementById('clear-all-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const dailyUsageCost = document.getElementById('daily-usage-cost') as HTMLDivElement;
  const dailyUsageRequests = document.getElementById('daily-usage-requests') as HTMLDivElement;
  const totalUsageCost = document.getElementById('total-usage-cost') as HTMLDivElement;
  const totalUsageRequests = document.getElementById('total-usage-requests') as HTMLDivElement;
  const modelBreakdownList = document.getElementById('model-breakdown-list') as HTMLDivElement;
  const cssCount = document.getElementById('css-count') as HTMLSpanElement;
  const historyCount = document.getElementById('history-count') as HTMLSpanElement;
  const domainCount = document.getElementById('domain-count') as HTMLSpanElement;
  const totalSize = document.getElementById('total-size') as HTMLSpanElement;
  const customizedSitesList = document.getElementById('customized-sites-list') as HTMLDivElement;

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
  
  // Load usage information
  await loadUsageInfo();
  
  // Load storage statistics
  await loadStorageStats();
  
  // Load customized sites
  await loadCustomizedSites();

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

  // Load and display usage information
  async function loadUsageInfo() {
    try {
      const totalUsage = await anthropicService.getTotalUsage();
      const dailyUsage = await anthropicService.getDailyUsage();
      
      dailyUsageCost.textContent = `$${dailyUsage.totalCost.toFixed(4)}`;
      dailyUsageRequests.textContent = `${dailyUsage.requests} requests`;
      
      totalUsageCost.textContent = `$${totalUsage.totalCost.toFixed(4)}`;
      totalUsageRequests.textContent = `${totalUsage.totalRequests} requests`;
      
      // Display model breakdown
      modelBreakdownList.innerHTML = '';
      if (Object.keys(dailyUsage.models || {}).length > 0) {
        Object.entries(dailyUsage.models).forEach(([model, data]: [string, any]) => {
          const modelDiv = document.createElement('div');
          modelDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px;';
          
          const modelName = model.includes('sonnet') ? 'Claude Sonnet' :
                           model.includes('haiku') ? 'Claude Haiku' :
                           model.includes('opus') ? 'Claude Opus' : model;
          
          modelDiv.innerHTML = `
            <span>${modelName}</span>
            <span>$${data.cost.toFixed(4)} (${data.requests} requests)</span>
          `;
          modelBreakdownList.appendChild(modelDiv);
        });
      } else {
        modelBreakdownList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 10px;">No usage today</div>';
      }
    } catch (error) {
      console.warn('Failed to load usage info:', error);
    }
  }

  // Load and display storage statistics
  async function loadStorageStats() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagebuddy_css_'));
      const historyKeys = Object.keys(allStorage).filter(key => key.startsWith('pagebuddy_history_'));
      
      // Calculate domains/websites
      const domains = new Set();
      [...cssKeys, ...historyKeys].forEach(key => {
        const urlPart = key.replace('pagebuddy_css_', '').replace('pagebuddy_history_', '');
        const domain = urlPart.split('/')[0]; // Get just the domain part
        domains.add(domain);
      });
      
      // Calculate approximate storage size
      let totalBytes = 0;
      [...cssKeys, ...historyKeys].forEach(key => {
        const value = allStorage[key];
        if (value) {
          totalBytes += JSON.stringify(value).length;
        }
      });
      
      const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };
      
      cssCount.textContent = cssKeys.length.toString();
      historyCount.textContent = historyKeys.length.toString();
      domainCount.textContent = domains.size.toString();
      totalSize.textContent = formatSize(totalBytes);
    } catch (error) {
      console.warn('Failed to load storage stats:', error);
      cssCount.textContent = 'Error';
      historyCount.textContent = 'Error';
      domainCount.textContent = 'Error';
      totalSize.textContent = 'Error';
    }
  }

  // Load and display customized sites
  async function loadCustomizedSites() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagebuddy_css_'));
      
      // Group by domain/site and check if disabled
      const sites = new Map<string, { isEnabled: boolean; isPageSpecific: boolean; cssKey: string }>();
      
      cssKeys.forEach(key => {
        const urlPart = key.replace('pagebuddy_css_', '');
        // Check if there's a path after the domain (not just protocol slashes)
        // Domain-wide: https://example.com
        // Page-specific: https://example.com/path
        const url = new URL(urlPart);
        const isPageSpecific = url.pathname !== '/';
        const site = urlPart; // Use the full URL part as the site identifier
        
        const cssData = allStorage[key];
        const isEnabled = cssData && Array.isArray(cssData) && cssData.length > 0;
        
        sites.set(site, { isEnabled, isPageSpecific, cssKey: key });
      });

      if (sites.size === 0) {
        customizedSitesList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 14px;">No customized sites found</div>';
        return;
      }

      customizedSitesList.innerHTML = '';
      
      // Sort sites alphabetically
      const sortedSites = Array.from(sites.entries()).sort(([a], [b]) => a.localeCompare(b));
      
      sortedSites.forEach(([site, data]) => {
        const siteDiv = document.createElement('div');
        siteDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #f0f0f0; font-size: 14px;';
        
        const siteInfo = document.createElement('div');
        siteInfo.style.cssText = 'flex: 1; min-width: 0;';
        
        const siteName = document.createElement('div');
        siteName.style.cssText = 'font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        siteName.textContent = site;
        
        const siteType = document.createElement('div');
        siteType.style.cssText = 'font-size: 12px; color: #666; margin-top: 2px;';
        siteType.textContent = data.isPageSpecific ? 'Specific page' : 'Entire domain';
        
        siteInfo.appendChild(siteName);
        siteInfo.appendChild(siteType);
        
        const toggleButton = document.createElement('button');
        toggleButton.style.cssText = `
          background: ${data.isEnabled ? '#28a745' : '#6c757d'};
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-left: 10px;
        `;
        toggleButton.textContent = data.isEnabled ? 'Enabled' : 'Disabled';
        
        const handleToggle = async () => {
          try {
            toggleButton.disabled = true;
            toggleButton.textContent = 'Updating...';
            
            // Get current state from storage to ensure we have the latest data
            const currentStorage = await chrome.storage.local.get([data.cssKey]);
            const currentCssData = currentStorage[data.cssKey];
            const currentlyEnabled = currentCssData && Array.isArray(currentCssData) && currentCssData.length > 0;
            
            if (currentlyEnabled) {
              // Disable by setting CSS data to empty array
              await chrome.storage.local.set({ [data.cssKey]: [] });
            } else {
              // Enable by restoring from history if available
              const historyKey = data.cssKey.replace('pagebuddy_css_', 'pagebuddy_history_');
              const historyResult = await chrome.storage.local.get([historyKey]);
              const history = historyResult[historyKey] || [];
              
              const enabledHistory = history.filter((item: any) => !item.disabled);
              const cssArray = enabledHistory.map((item: any) => item.css);
              
              if (cssArray.length > 0) {
                await chrome.storage.local.set({ [data.cssKey]: cssArray });
              } else {
                // No history available, create empty CSS entry to mark as enabled
                await chrome.storage.local.set({ [data.cssKey]: ['/* No customizations yet */'] });
              }
            }
            
            // Refresh the entire display to ensure everything is in sync
            await loadCustomizedSites();
            await loadStorageStats();
            
          } catch (error) {
            console.warn('Failed to toggle site:', error);
            showStatus('Failed to update site settings', 'error');
            // Refresh display anyway to restore correct state
            await loadCustomizedSites();
          }
        };
        
        toggleButton.addEventListener('click', handleToggle);
        
        toggleButton.addEventListener('mouseenter', () => {
          if (!toggleButton.disabled) {
            toggleButton.style.background = data.isEnabled ? '#218838' : '#5a6268';
          }
        });
        
        toggleButton.addEventListener('mouseleave', () => {
          if (!toggleButton.disabled) {
            toggleButton.style.background = data.isEnabled ? '#28a745' : '#6c757d';
          }
        });

        const deleteButton = document.createElement('button');
        deleteButton.style.cssText = `
          background: #dc3545;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-left: 8px;
        `;
        deleteButton.textContent = 'Delete';
        
        const handleDelete = async () => {
          const confirmed = confirm(
            `Are you sure you want to delete all customizations for "${site}"?\n\n` +
            'This will permanently remove:\n' +
            '• All CSS customizations\n' +
            '• All prompt history\n' +
            '• All data for this site\n\n' +
            'This action cannot be undone!'
          );

          if (!confirmed) {
            return;
          }

          try {
            deleteButton.disabled = true;
            deleteButton.textContent = 'Deleting...';
            
            // Remove both CSS and history data for this site
            const historyKey = data.cssKey.replace('pagebuddy_css_', 'pagebuddy_history_');
            await chrome.storage.local.remove([data.cssKey, historyKey]);
            
            // Refresh the display
            await loadCustomizedSites();
            await loadStorageStats();
            
            showStatus(`Successfully deleted customizations for ${site}`, 'success');
            
          } catch (error) {
            console.warn('Failed to delete site:', error);
            showStatus('Failed to delete site customizations', 'error');
            // Refresh display anyway to restore correct state
            await loadCustomizedSites();
          }
        };
        
        deleteButton.addEventListener('click', handleDelete);
        
        deleteButton.addEventListener('mouseenter', () => {
          if (!deleteButton.disabled) {
            deleteButton.style.background = '#c82333';
          }
        });
        
        deleteButton.addEventListener('mouseleave', () => {
          if (!deleteButton.disabled) {
            deleteButton.style.background = '#dc3545';
          }
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; align-items: center;';
        buttonContainer.appendChild(toggleButton);
        buttonContainer.appendChild(deleteButton);
        
        siteDiv.appendChild(siteInfo);
        siteDiv.appendChild(buttonContainer);
        customizedSitesList.appendChild(siteDiv);
      });
      
    } catch (error) {
      console.warn('Failed to load customized sites:', error);
      customizedSitesList.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545; font-size: 14px;">Error loading sites</div>';
    }
  }

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

  clearAllBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Are you sure you want to clear ALL CSS customizations from ALL websites?\n\n' +
      'This will permanently remove:\n' +
      '• All CSS changes on all pages\n' +
      '• All prompt history\n' +
      '• All customization data\n\n' +
      'This action cannot be undone!'
    );

    if (!confirmed) {
      return;
    }

    clearAllBtn.disabled = true;
    clearAllBtn.textContent = 'Clearing...';

    try {
      // Get all storage keys
      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove: string[] = [];
      
      // Find all PageBuddy CSS and history keys
      Object.keys(allStorage).forEach(key => {
        if (key.startsWith('pagebuddy_css_') || 
            key.startsWith('pagebuddy_history_')) {
          keysToRemove.push(key);
        }
      });

      // Remove all CSS and history data
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      showStatus(`Successfully cleared ${keysToRemove.length} items of CSS data`, 'success');
      
      // Refresh storage stats and customized sites
      await loadStorageStats();
      await loadCustomizedSites();
    } catch (error) {
      showStatus(`Failed to clear CSS data: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      clearAllBtn.disabled = false;
      clearAllBtn.textContent = 'Clear All CSS Data';
    }
  });
});