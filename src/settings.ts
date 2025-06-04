// pagemagic-main/src/settings.ts
import { openRouterService } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
  const clearAllBtn = document.getElementById('clear-all-btn') as HTMLButtonElement;
  const clearUsageBtn = document.getElementById('clear-usage-btn') as HTMLButtonElement;
  const factoryResetBtn = document.getElementById('factory-reset-btn') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const dailyUsageCost = document.getElementById('daily-usage-cost') as HTMLDivElement;
  const dailyUsageRequests = document.getElementById('daily-usage-requests') as HTMLDivElement;
  const totalUsageCost = document.getElementById('total-usage-cost') as HTMLDivElement;
  const totalUsageRequests = document.getElementById('total-usage-requests') as HTMLDivElement;
  const modelBreakdownList = document.getElementById('model-breakdown-list') as HTMLDivElement;
  const allTimeBreakdownList = document.getElementById('all-time-breakdown-list') as HTMLDivElement;
  const cssCount = document.getElementById('css-count') as HTMLSpanElement;
  const historyCount = document.getElementById('history-count') as HTMLSpanElement;
  const domainCount = document.getElementById('domain-count') as HTMLSpanElement;
  const totalSize = document.getElementById('total-size') as HTMLSpanElement;
  const customizedSitesList = document.getElementById('customized-sites-list') as HTMLDivElement;

  // Stocker les valeurs récupérées pour éviter des appels répétés à chrome.storage.sync
  let currentSettings = {
    openRouterApiKey: null as string | null,
    selectedModel: null as string | null,
  };

  // Load existing settings
  const storedSettings = await chrome.storage.sync.get(['openRouterApiKey', 'selectedModel']);
  currentSettings.openRouterApiKey = storedSettings.openRouterApiKey || null;
  currentSettings.selectedModel = storedSettings.selectedModel || null;

  if (currentSettings.openRouterApiKey) {
    apiKeyInput.value = currentSettings.openRouterApiKey;
  }

  // Load available models
  async function loadModels() {
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;
    testBtn.disabled = true;

    try {
      if (currentSettings.openRouterApiKey) {
        // L'initialisation de openRouterService se fait maintenant avec la clé stockée
        // ou celle qui vient d'être saisie.
        const initialized = await openRouterService.initialize(); // Tentera de charger la clé depuis storage
        
        if (initialized) {
          const models = await openRouterService.getAvailableModels();
          populateModelSelect(models);
          
          const modelLookup: Record<string, string> = {};
          models.forEach(model => {
            modelLookup[model.id] = model.display_name;
          });
          await chrome.storage.local.set({ pagemagic_model_lookup: modelLookup });
          
          if (currentSettings.selectedModel && models.some(m => m.id === currentSettings.selectedModel)) {
            modelSelect.value = currentSettings.selectedModel;
          } else if (models.length > 0) {
            modelSelect.value = models[0].id; 
            currentSettings.selectedModel = models[0].id; // Mettre à jour le modèle sélectionné
          }
          
          modelSelect.disabled = models.length === 0;
          testBtn.disabled = models.length === 0;

          if (models.length === 0) {
            modelSelect.innerHTML = '<option value="">No (free) models found</option>';
            showStatus('No (free) models found for this API key or check network.', 'error');
          }
        } else {
            // Cas où initialize retourne false (pas de clé valide dans storage)
            modelSelect.innerHTML = '<option value="">API Key Invalid or Not Set</option>';
            showStatus('API Key is invalid or not set in storage.', 'error');
        }
      } else {
        modelSelect.innerHTML = '<option value="">No API Key found</option>';
      }
    } catch (error) {
      console.error('Failed to load models:', error);
      const errorMessage = (error instanceof Error) ? error.message : 'Unknown error loading models';
      modelSelect.innerHTML = `<option value="">Error loading models</option>`;
      showStatus(`Error loading models: ${errorMessage}`, 'error');
    }
  }

  function populateModelSelect(models: { id: string, display_name: string }[]) {
    modelSelect.innerHTML = ''; // Important pour effacer "Loading..."
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No (free) models found</option>';
      modelSelect.disabled = true;
      return;
    }
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.display_name;
      modelSelect.appendChild(option);
    });
    modelSelect.disabled = false;
  }

  await loadModels();
  await loadUsageInfo();
  await loadStorageStats();
  await loadCustomizedSites();

  apiKeyInput.addEventListener('input', async () => {
    const newApiKey = apiKeyInput.value.trim();
    // Mettre à jour la clé dans currentSettings immédiatement pour que loadModels l'utilise
    currentSettings.openRouterApiKey = newApiKey || null; 
    
    if (newApiKey && newApiKey.startsWith('sk-or-')) {
        // Tentative de chargement des modèles avec la nouvelle clé
        // On suppose que saveBtn sera cliqué pour la persistance
        await chrome.storage.sync.set({ openRouterApiKey: newApiKey }); // Sauvegarde temporaire pour initialize
        await loadModels();
    } else if (!newApiKey) {
        modelSelect.innerHTML = '<option value="">No API Key found</option>';
        modelSelect.disabled = true;
        testBtn.disabled = true;
    } else if (newApiKey && !newApiKey.startsWith('sk-or-')) {
        modelSelect.innerHTML = '<option value="">Invalid API Key format</option>';
        modelSelect.disabled = true;
        testBtn.disabled = true;
        showStatus('OpenRouter API key should start with sk-or-', 'error');
    }
  });

  async function loadUsageInfo() {
    try {
      const totalUsage = await openRouterService.getTotalUsage();
      const dailyUsage = await openRouterService.getDailyUsage();
      
      dailyUsageCost.textContent = `$${(dailyUsage.totalCost || 0).toFixed(6)}`;
      dailyUsageRequests.textContent = `${dailyUsage.requests || 0} requests`;
      
      totalUsageCost.textContent = `$${(totalUsage.totalCost || 0).toFixed(6)}`;
      totalUsageRequests.textContent = `${totalUsage.totalRequests || 0} requests`;
      
      const lookupResult = await chrome.storage.local.get(['pagemagic_model_lookup']);
      const modelLookup = lookupResult.pagemagic_model_lookup || {};
      
      modelBreakdownList.innerHTML = '';
      if (dailyUsage.models && Object.keys(dailyUsage.models).length > 0) {
        const sortedDailyEntries = Object.entries(dailyUsage.models).sort(([modelIdA], [modelIdB]) => 
          (modelLookup[modelIdA] || modelIdA).localeCompare(modelLookup[modelIdB] || modelIdB)
        );
        sortedDailyEntries.forEach(([modelId, data]: [string, any]) => {
          const modelDiv = document.createElement('div');
          modelDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px;';
          const modelName = modelLookup[modelId] || modelId;
          modelDiv.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;" title="${modelName}">${modelName}</span>
            <span>$${(data.cost || 0).toFixed(6)} (${data.requests || 0} req)</span>`;
          modelBreakdownList.appendChild(modelDiv);
        });
      } else {
        modelBreakdownList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 10px;">No usage today</div>';
      }
      
      allTimeBreakdownList.innerHTML = '';
      if (totalUsage.models && Object.keys(totalUsage.models).length > 0) {
        const sortedAllTimeEntries = Object.entries(totalUsage.models).sort(([modelIdA], [modelIdB]) => 
          (modelLookup[modelIdA] || modelIdA).localeCompare(modelLookup[modelIdB] || modelIdB)
        );
        sortedAllTimeEntries.forEach(([modelId, data]: [string, any]) => {
          const modelDiv = document.createElement('div');
          modelDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px;';
          const modelName = modelLookup[modelId] || modelId;
          modelDiv.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;" title="${modelName}">${modelName}</span>
            <span>$${(data.cost || 0).toFixed(6)} (${data.requests || 0} req)</span>`;
          allTimeBreakdownList.appendChild(modelDiv);
        });
      } else {
        allTimeBreakdownList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 10px;">No usage yet</div>';
      }
      
      const hasUsageData = (totalUsage.totalRequests || 0) > 0 || (totalUsage.models && Object.keys(totalUsage.models).length > 0);
      clearUsageBtn.disabled = !hasUsageData;
    } catch (error) {
      console.warn('Failed to load usage info:', error);
      clearUsageBtn.disabled = true; 
    }
  }

  async function loadStorageStats() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_css_'));
      const historyKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_history_'));
      
      const domains = new Set<string>();
      [...cssKeys, ...historyKeys].forEach(key => {
        const urlPart = key.replace(/^pagemagic_(css|history)_/, '');
        try {
            const url = new URL(urlPart.startsWith('http') ? urlPart : `https://${urlPart}`);
            domains.add(url.origin);
        } catch (e) {
            console.warn("Malformed URL key in storage for domain count:", key, e);
        }
      });
      
      let totalBytes = 0;
      Object.keys(allStorage).forEach(key => {
        if (key.startsWith('pagemagic_')) {
          totalBytes += (JSON.stringify(allStorage[key]).length + key.length) * 2; // Approximation for UTF-16
        }
      });
      
      const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };
      
      cssCount.textContent = cssKeys.length.toString();
      historyCount.textContent = historyKeys.length.toString();
      domainCount.textContent = domains.size.toString();
      totalSize.textContent = formatSize(totalBytes);
      
      const hasData = cssKeys.length > 0 || historyKeys.length > 0;
      clearAllBtn.disabled = !hasData;
    } catch (error) {
      console.warn('Failed to load storage stats:', error);
      ['cssCount', 'historyCount', 'domainCount', 'totalSize'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Error';
      });
      clearAllBtn.disabled = true; 
    }
  }

  async function loadCustomizedSites() {
    try {
      customizedSitesList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666; font-size: 14px;">Loading...</div>';
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_css_'));
      
      const sites = new Map<string, { isEnabled: boolean; isPageSpecific: boolean; cssKey: string; displayUrl: string }>();
      
      cssKeys.forEach(key => {
        const rawUrlPart = key.replace('pagemagic_css_', '');
        let displayUrl = rawUrlPart;
        let isPageSpecific = false;
        try {
            const url = new URL(rawUrlPart.startsWith('http') ? rawUrlPart : `https://${rawUrlPart}`);
            displayUrl = url.href;
            isPageSpecific = url.pathname !== '/' && url.pathname !== '';
        } catch (e) {
            console.warn("Malformed URL for site display in loadCustomizedSites:", rawUrlPart, e);
            isPageSpecific = rawUrlPart.substring(rawUrlPart.indexOf('//') + 2).includes('/');
        }
        
        const cssData = allStorage[key];
        const isEnabled = cssData && Array.isArray(cssData) && cssData.length > 0 && cssData[0] !== '/* Site disabled */';
        sites.set(rawUrlPart, { isEnabled, isPageSpecific, cssKey: key, displayUrl });
      });

      if (sites.size === 0) {
        customizedSitesList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 14px;">No customized sites found</div>';
        return;
      }

      customizedSitesList.innerHTML = '';
      const sortedSites = Array.from(sites.entries()).sort(([,aData], [,bData]) => 
          aData.displayUrl.localeCompare(bData.displayUrl)
      );
      
      sortedSites.forEach(([siteKey, data]) => {
        const siteDiv = document.createElement('div');
        siteDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 15px; border-bottom: 1px solid #f0f0f0; font-size: 14px;';
        
        const siteInfo = document.createElement('div');
        siteInfo.style.cssText = 'flex: 1; min-width: 0; margin-right: 10px;';
        
        const siteNameLink = document.createElement('a');
        siteNameLink.href = data.displayUrl;
        siteNameLink.target = '_blank';
        siteNameLink.rel = 'noopener noreferrer';
        siteNameLink.style.cssText = 'font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1976d2; text-decoration: none; display: block;';
        siteNameLink.textContent = data.displayUrl;
        siteNameLink.title = data.displayUrl;
        siteNameLink.addEventListener('mouseenter', () => { siteNameLink.style.textDecoration = 'underline'; });
        siteNameLink.addEventListener('mouseleave', () => { siteNameLink.style.textDecoration = 'none'; });
        
        const siteTypeDiv = document.createElement('div');
        siteTypeDiv.style.cssText = 'font-size: 12px; color: #666; margin-top: 2px;';
        siteTypeDiv.textContent = data.isPageSpecific ? 'Specific page' : 'Entire domain';
        
        siteInfo.appendChild(siteNameLink);
        siteInfo.appendChild(siteTypeDiv);
        
        const toggleButton = document.createElement('button');
        toggleButton.style.cssText = `background: ${data.isEnabled ? '#28a745' : '#6c757d'}; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 10px; flex-shrink: 0;`;
        toggleButton.textContent = data.isEnabled ? 'Enabled' : 'Disabled';
        
        toggleButton.addEventListener('click', async () => {
          try {
            toggleButton.disabled = true;
            toggleButton.textContent = 'Updating...';
            const historyKey = data.cssKey.replace('pagemagic_css_', 'pagemagic_history_');
            const historyResult = await chrome.storage.local.get([historyKey]);
            const history = historyResult[historyKey] || [];

            if (data.isEnabled) { // If currently enabled, disable it
              await chrome.storage.local.set({ [data.cssKey]: ['/* Site disabled */'] });
            } else { // If currently disabled, re-enable it
              const enabledHistoryCSS = history.filter((item: any) => !item.disabled).map((item: any) => item.css);
              if (enabledHistoryCSS.length > 0) {
                await chrome.storage.local.set({ [data.cssKey]: enabledHistoryCSS });
              } else {
                // If no active history items, remove the disabled marker to effectively enable an empty state
                await chrome.storage.local.set({ [data.cssKey]: [] }); 
              }
            }
            await loadCustomizedSites(); // Refresh the list
          } catch (err) {
            showStatus('Failed to toggle site status.', 'error');
            console.error("Toggle site error:", err);
            await loadCustomizedSites(); // Refresh to show original state
          }
        });
        
        const deleteButton = document.createElement('button');
        deleteButton.style.cssText = `background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px; flex-shrink: 0;`;
        deleteButton.textContent = 'Delete';
        
        deleteButton.addEventListener('click', async () => {
          const confirmed = confirm(`Delete all customizations for "${data.displayUrl}"? This cannot be undone.`);
          if (!confirmed) return;
          try {
            deleteButton.disabled = true;
            deleteButton.textContent = 'Deleting...';
            const historyKey = data.cssKey.replace('pagemagic_css_', 'pagemagic_history_');
            await chrome.storage.local.remove([data.cssKey, historyKey]);
            await loadCustomizedSites();
            await loadStorageStats();
            showStatus(`Deleted customizations for ${data.displayUrl}`, 'success');
          } catch (err) {
            showStatus('Failed to delete site customizations.', 'error');
            console.error("Delete site error:", err);
            await loadCustomizedSites();
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
      customizedSitesList.innerHTML = `<div style="padding: 20px; text-align: center; color: #dc3545; font-size: 14px;">Error loading sites: ${(error as Error).message}</div>`;
    }
  }

  function showStatus(message: string, type: 'success' | 'error') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => {
        if (status.textContent === message) status.style.display = 'none';
      }, 3000);
    }
  }

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedModelValue = modelSelect.value;
    
    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }
    if (!apiKey.startsWith('sk-or-')) {
      showStatus('OpenRouter API key should start with sk-or-', 'error');
      return;
    }
    if (!selectedModelValue && modelSelect.options.length > 0 && modelSelect.options[0]?.value !== "") {
        showStatus('Please select a model', 'error');
        return;
    }
     if (modelSelect.options.length === 0 || modelSelect.options[0]?.value === "") {
        showStatus('No models available. Check API key or ensure models loaded.', 'error');
        return;
    }

    try {
      await chrome.storage.sync.set({ 
        openRouterApiKey: apiKey,
        selectedModel: selectedModelValue 
      });
      currentSettings.openRouterApiKey = apiKey;
      currentSettings.selectedModel = selectedModelValue;
      showStatus('Settings saved successfully!', 'success');
      // Re-check models if API key changed and was saved successfully
      await loadModels();
    } catch (error) {
      showStatus('Failed to save settings', 'error');
    }
  });

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedModelValue = modelSelect.value;
    
    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }
    if (!selectedModelValue || modelSelect.options[0]?.value === "") {
      showStatus('Please select a model (or ensure models are loaded)', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    status.style.display = 'none';

    try {
      // Temporarily set for the service to use, even if not saved yet
      await chrome.storage.sync.set({ openRouterApiKey: apiKey, selectedModel: selectedModelValue });
      const initialized = await openRouterService.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize service with the provided key.');
      }

      const response = await openRouterService.generateCSS({
        htmlContent: '<body><p>Test paragraph.</p></body>',
        prompt: 'make the paragraph text red'
      });
      
      if (response.css && response.css.toLowerCase().includes('red')) {
        showStatus('Connection successful!', 'success');
      } else {
        throw new Error('Test failed: No valid CSS returned or CSS did not match prompt.');
      }
    } catch (error) {
      console.error("Test connection error:", error);
      showStatus(`Connection failed: ${(error instanceof Error ? error.message : 'Unknown error')}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
      // Restaurer les paramètres précédemment sauvegardés si le test n'implique pas de sauvegarde
      await chrome.storage.sync.set({ 
          openRouterApiKey: currentSettings.openRouterApiKey, 
          selectedModel: currentSettings.selectedModel 
      });
      await openRouterService.initialize(); // Réinitialiser avec les paramètres sauvegardés
    }
  });

  clearAllBtn.addEventListener('click', async () => {
    const confirmed = confirm('Clear ALL CSS customizations and history from ALL websites? This cannot be undone.');
    if (!confirmed) return;
    clearAllBtn.disabled = true;
    clearAllBtn.textContent = 'Clearing...';
    try {
      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(allStorage).filter(key => 
        key.startsWith('pagemagic_css_') || key.startsWith('pagemagic_history_')
      );
      if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
      showStatus(`Cleared ${keysToRemove.length} CSS/history items`, 'success');
    } catch (e) { showStatus('Error clearing CSS data', 'error'); console.error(e); }
    finally {
      await loadStorageStats();
      await loadCustomizedSites();
      clearAllBtn.textContent = 'Clear All CSS Data';
      // La désactivation sera gérée par loadStorageStats
    }
  });

  clearUsageBtn.addEventListener('click', async () => {
    const confirmed = confirm('Clear ALL usage data (costs, requests, model breakdowns)? This cannot be undone.');
    if (!confirmed) return;
    clearUsageBtn.disabled = true;
    clearUsageBtn.textContent = 'Clearing...';
    try {
      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(allStorage).filter(key =>
        key.startsWith('pagemagic_usage_') || 
        key === 'pagemagic_total_usage' ||
        key === 'pagemagic_model_lookup'
      );
      if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
      showStatus(`Cleared ${keysToRemove.length} usage data items`, 'success');
    } catch (e) { showStatus('Error clearing usage data', 'error'); console.error(e); }
    finally {
      await loadUsageInfo();
      clearUsageBtn.textContent = 'Clear All Usage Data';
      // La désactivation sera gérée par loadUsageInfo
    }
  });

  factoryResetBtn.addEventListener('click', async () => {
    const confirmed = confirm('Factory reset ALL extension data (API key, settings, CSS, history, usage)? This cannot be undone.');
    if (!confirmed) return;
    factoryResetBtn.disabled = true;
    factoryResetBtn.textContent = 'Resetting...';
    try {
      await chrome.storage.sync.clear();
      const allLocal = await chrome.storage.local.get(null);
      const localKeysToRemove = Object.keys(allLocal).filter(k => k.startsWith('pagemagic_'));
      if (localKeysToRemove.length > 0) await chrome.storage.local.remove(localKeysToRemove);
      
      currentSettings.openRouterApiKey = null;
      currentSettings.selectedModel = null;
      apiKeyInput.value = '';
      modelSelect.innerHTML = '<option value="">No API Key found</option>';
      modelSelect.disabled = true;
      testBtn.disabled = true;
      
      showStatus('Factory reset complete. Please re-enter API key.', 'success');
    } catch (e) { showStatus('Error during factory reset', 'error'); console.error(e); }
    finally {
      await loadModels(); // tentera de charger les modèles (échouera sans clé)
      await loadUsageInfo();
      await loadStorageStats();
      await loadCustomizedSites();
      factoryResetBtn.disabled = false;
      factoryResetBtn.textContent = 'Factory Reset';
    }
  });
});
