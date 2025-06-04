// pagemagic-main/src/settings.ts
import { openRouterService } from './api.js'; // Modifié ici

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

  // Load existing settings
  // Modifié: anthropicApiKey -> openRouterApiKey
  const result = await chrome.storage.sync.get(['openRouterApiKey', 'selectedModel']);
  if (result.openRouterApiKey) {
    apiKeyInput.value = result.openRouterApiKey;
  }

  // Load available models
  async function loadModels() {
    try {
      // Modifié: result.anthropicApiKey -> result.openRouterApiKey
      if (result.openRouterApiKey) {
        // Modifié: anthropicApiKey -> openRouterApiKey
        await chrome.storage.sync.set({ openRouterApiKey: result.openRouterApiKey });
        // Modifié: anthropicService -> openRouterService
        const initialized = await openRouterService.initialize();
        
        if (initialized) {
          // Modifié: anthropicService -> openRouterService
          const models = await openRouterService.getAvailableModels();
          populateModelSelect(models);
          
          const modelLookup: Record<string, string> = {};
          models.forEach(model => {
            modelLookup[model.id] = model.display_name;
          });
          await chrome.storage.local.set({ pagemagic_model_lookup: modelLookup });
          
          if (result.selectedModel && models.some(m => m.id === result.selectedModel)) {
            modelSelect.value = result.selectedModel;
          } else if (models.length > 0) {
            modelSelect.value = models[0].id; 
          }
          modelSelect.disabled = models.length === 0;
          testBtn.disabled = models.length === 0;
          if (models.length === 0) {
            modelSelect.innerHTML = '<option value="">No (free) models found</option>';
          }
        } else {
            modelSelect.innerHTML = '<option value="">API Key Error or No Network</option>';
            modelSelect.disabled = true;
            testBtn.disabled = true;
        }
      } else {
        modelSelect.innerHTML = '<option value="">No API Key found</option>';
        modelSelect.disabled = true;
        testBtn.disabled = true;
      }
    } catch (error) {
      console.error('Failed to load models:', error); // Modifié le message d'erreur
      modelSelect.innerHTML = `<option value="">Error: ${(error as Error).message || 'Failed to load models'}</option>`;
      modelSelect.disabled = true;
      testBtn.disabled = true;
    }
  }

  function populateModelSelect(models: any[]) {
    modelSelect.innerHTML = '';
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No (free) models found</option>';
      modelSelect.disabled = true;
      return;
    }
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      // Le display_name contient déjà l'ID ou le nom complet d'OpenRouter
      option.textContent = `${model.display_name}`; 
      modelSelect.appendChild(option);
    });
    modelSelect.disabled = false;
  }

  await loadModels();
  await loadUsageInfo();
  await loadStorageStats();
  await loadCustomizedSites();

  apiKeyInput.addEventListener('input', async () => {
    const currentKey = apiKeyInput.value.trim();
    // Modifié: sk-ant- -> sk-or- // OpenRouter keys start with sk-or-
    if (currentKey && currentKey.startsWith('sk-or-') && currentKey !== result.openRouterApiKey) {
      modelSelect.innerHTML = '<option value="">Loading models...</option>';
      modelSelect.disabled = true;
      testBtn.disabled = true;
      
      try {
        // Modifié: anthropicApiKey -> openRouterApiKey
        await chrome.storage.sync.set({ openRouterApiKey: currentKey });
        result.openRouterApiKey = currentKey; // Mettre à jour la variable locale
        // Modifié: anthropicService -> openRouterService
        const initialized = await openRouterService.initialize();
        
        if (initialized) {
          // Modifié: anthropicService -> openRouterService
          const models = await openRouterService.getAvailableModels();
          populateModelSelect(models);
          
          const modelLookup: Record<string, string> = {};
          models.forEach(model => {
            modelLookup[model.id] = model.display_name;
          });
          await chrome.storage.local.set({ pagemagic_model_lookup: modelLookup });
          
          if (models.length > 0) {
            modelSelect.value = models[0].id;
            testBtn.disabled = false;
          } else {
            testBtn.disabled = true;
          }
           modelSelect.disabled = models.length === 0;

        } else {
             modelSelect.innerHTML = '<option value="">API Key Error or No Network</option>';
        }
      } catch (error) {
        console.error('Failed to reload models:', error); // Modifié
        modelSelect.innerHTML = `<option value="">Error: ${(error as Error).message || 'Failed to load'}</option>`;
        modelSelect.disabled = true;
        testBtn.disabled = true;
      }
    } else if (!currentKey) {
        modelSelect.innerHTML = '<option value="">No API Key found</option>';
        modelSelect.disabled = true;
        testBtn.disabled = true;
    }
  });

  async function loadUsageInfo() {
    try {
      // Modifié: anthropicService -> openRouterService
      const totalUsage = await openRouterService.getTotalUsage();
      const dailyUsage = await openRouterService.getDailyUsage();
      
      // Pour les modèles gratuits, le coût sera souvent de 0.
      dailyUsageCost.textContent = `$${dailyUsage.totalCost.toFixed(6)}`; // plus de précision pour les micro-coûts
      dailyUsageRequests.textContent = `${dailyUsage.requests} requests`;
      
      totalUsageCost.textContent = `$${totalUsage.totalCost.toFixed(6)}`;
      totalUsageRequests.textContent = `${totalUsage.totalRequests} requests`;
      
      const lookupResult = await chrome.storage.local.get(['pagemagic_model_lookup']);
      const modelLookup = lookupResult.pagemagic_model_lookup || {};
      
      modelBreakdownList.innerHTML = '';
      if (dailyUsage.models && Object.keys(dailyUsage.models).length > 0) {
        const sortedDailyEntries = Object.entries(dailyUsage.models).sort(([modelIdA], [modelIdB]) => {
          const modelNameA = modelLookup[modelIdA] || modelIdA;
          const modelNameB = modelLookup[modelIdB] || modelIdB;
          return modelNameA.localeCompare(modelNameB);
        });
        
        sortedDailyEntries.forEach(([modelId, data]: [string, any]) => {
          const modelDiv = document.createElement('div');
          modelDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px;';
          const modelName = modelLookup[modelId] || modelId;
          modelDiv.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;" title="${modelName}">${modelName}</span>
            <span>$${data.cost.toFixed(6)} (${data.requests} req)</span>
          `;
          modelBreakdownList.appendChild(modelDiv);
        });
      } else {
        modelBreakdownList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 10px;">No usage today</div>';
      }
      
      allTimeBreakdownList.innerHTML = '';
      if (totalUsage.models && Object.keys(totalUsage.models).length > 0) {
        const sortedAllTimeEntries = Object.entries(totalUsage.models).sort(([modelIdA], [modelIdB]) => {
          const modelNameA = modelLookup[modelIdA] || modelIdA;
          const modelNameB = modelLookup[modelIdB] || modelIdB;
          return modelNameA.localeCompare(modelNameB);
        });
        
        sortedAllTimeEntries.forEach(([modelId, data]: [string, any]) => {
          const modelDiv = document.createElement('div');
          modelDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px;';
          const modelName = modelLookup[modelId] || modelId;
          modelDiv.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;" title="${modelName}">${modelName}</span>
            <span>$${data.cost.toFixed(6)} (${data.requests} req)</span>
          `;
          allTimeBreakdownList.appendChild(modelDiv);
        });
      } else {
        allTimeBreakdownList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 10px;">No usage yet</div>';
      }
      
      const hasUsageData = totalUsage.totalRequests > 0 || (totalUsage.models && Object.keys(totalUsage.models).length > 0);
      clearUsageBtn.disabled = !hasUsageData;
    } catch (error) {
      console.warn('Failed to load usage info:', error);
      clearUsageBtn.disabled = true; 
    }
  }

  // loadStorageStats et loadCustomizedSites peuvent rester les mêmes.
  // ... (copiez les fonctions loadStorageStats et loadCustomizedSites de l'original) ...
  // La fonction showStatus peut rester la même.
  // ... (copiez la fonction showStatus de l'original) ...

  // Remplacez les fonctions copiées ici
  async function loadStorageStats() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_css_'));
      const historyKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_history_'));
      
      const domains = new Set();
      [...cssKeys, ...historyKeys].forEach(key => {
        const urlPart = key.replace('pagemagic_css_', '').replace('pagemagic_history_', '');
        try { // try-catch pour les clés mal formées
            const url = new URL(urlPart.startsWith('http') ? urlPart : `https://${urlPart}`);
            domains.add(url.origin); // Utilisez url.origin pour une meilleure agrégation par domaine
        } catch (e) {
            console.warn("Malformed URL key in storage:", key);
        }
      });
      
      let totalBytes = 0;
      Object.keys(allStorage).forEach(key => {
        if (key.startsWith('pagemagic_')) { // Ne compte que les données de PageMagic
          totalBytes += JSON.stringify(allStorage[key]).length + key.length; // Compter aussi la clé
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
      
      const hasData = cssKeys.length > 0 || historyKeys.length > 0;
      clearAllBtn.disabled = !hasData;
    } catch (error) {
      console.warn('Failed to load storage stats:', error);
      cssCount.textContent = 'Error';
      historyCount.textContent = 'Error';
      domainCount.textContent = 'Error';
      totalSize.textContent = 'Error';
      clearAllBtn.disabled = true; 
    }
  }

  async function loadCustomizedSites() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const cssKeys = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_css_'));
      
      const sites = new Map<string, { isEnabled: boolean; isPageSpecific: boolean; cssKey: string; displayUrl: string }>();
      
      cssKeys.forEach(key => {
        const rawUrlPart = key.replace('pagemagic_css_', '');
        let displayUrl = rawUrlPart;
        let isPageSpecific = false;
        try {
            const url = new URL(rawUrlPart.startsWith('http') ? rawUrlPart : `https://${rawUrlPart}`);
            displayUrl = url.href; // URL normalisée
            isPageSpecific = url.pathname !== '/' && url.pathname !== '';
        } catch (e) {
            console.warn("Malformed URL for site display:", rawUrlPart);
            // displayUrl reste rawUrlPart
            isPageSpecific = rawUrlPart.substring(rawUrlPart.indexOf('/')+2).includes('/');
        }
        
        const cssData = allStorage[key];
        const isEnabled = cssData && Array.isArray(cssData) && cssData.length > 0;
        
        sites.set(rawUrlPart, { isEnabled, isPageSpecific, cssKey: key, displayUrl });
      });

      if (sites.size === 0) {
        customizedSitesList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 14px;">No customized sites found</div>';
        return;
      }

      customizedSitesList.innerHTML = '';
      
      const sortedSites = Array.from(sites.entries()).sort(([aKey], [bKey]) => {
          const aSite = sites.get(aKey)!.displayUrl;
          const bSite = sites.get(bKey)!.displayUrl;
          return aSite.localeCompare(bSite);
      });
      
      sortedSites.forEach(([siteKey, data]) => { // siteKey est la clé de stockage, data.displayUrl est l'URL à afficher/utiliser
        const siteDiv = document.createElement('div');
        siteDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 15px; border-bottom: 1px solid #f0f0f0; font-size: 14px;';
        
        const siteInfo = document.createElement('div');
        siteInfo.style.cssText = 'flex: 1; min-width: 0; margin-right: 10px;';
        
        const siteName = document.createElement('a');
        siteName.href = data.displayUrl;
        siteName.target = '_blank';
        siteName.rel = 'noopener noreferrer';
        siteName.style.cssText = 'font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1976d2; text-decoration: none; display: block;';
        siteName.textContent = data.displayUrl;
        siteName.title = data.displayUrl;
        
        siteName.addEventListener('mouseenter', () => { siteName.style.textDecoration = 'underline'; });
        siteName.addEventListener('mouseleave', () => { siteName.style.textDecoration = 'none'; });
        
        const siteType = document.createElement('div');
        siteType.style.cssText = 'font-size: 12px; color: #666; margin-top: 2px;';
        siteType.textContent = data.isPageSpecific ? 'Specific page' : 'Entire domain';
        
        siteInfo.appendChild(siteName);
        siteInfo.appendChild(siteType);
        
        const toggleButton = document.createElement('button');
        toggleButton.style.cssText = `
          background: ${data.isEnabled ? '#28a745' : '#6c757d'};
          color: white; border: none; padding: 6px 12px; border-radius: 4px;
          cursor: pointer; font-size: 12px; margin-left: 10px; flex-shrink: 0;`;
        toggleButton.textContent = data.isEnabled ? 'Enabled' : 'Disabled';
        
        const handleToggle = async () => { /* ... (même logique qu'avant) ... */ };
        toggleButton.addEventListener('click', handleToggle);
        // ... (même logique pour mouseenter/mouseleave) ...

        const deleteButton = document.createElement('button');
        deleteButton.style.cssText = `
          background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px;
          cursor: pointer; font-size: 12px; margin-left: 8px; flex-shrink: 0;`;
        deleteButton.textContent = 'Delete';
        
        const handleDelete = async () => {
          const confirmed = confirm(
            `Are you sure you want to delete all customizations for "${data.displayUrl}"?\n\n` +
            'This will permanently remove all CSS, prompt history, and data for this site/page.\n\n' +
            'This action cannot be undone!'
          );
          if (!confirmed) return;
          // ... (même logique qu'avant, mais utiliser data.cssKey) ...
           try {
            deleteButton.disabled = true;
            deleteButton.textContent = 'Deleting...';
            const historyKey = data.cssKey.replace('pagemagic_css_', 'pagemagic_history_');
            await chrome.storage.local.remove([data.cssKey, historyKey]);
            await loadCustomizedSites();
            await loadStorageStats();
            showStatus(`Successfully deleted customizations for ${data.displayUrl}`, 'success');
          } catch (error) {
            console.warn('Failed to delete site:', error);
            showStatus('Failed to delete site customizations', 'error');
            await loadCustomizedSites(); // Recharger pour restaurer l'état
          } finally {
            // Le bouton sera recréé par loadCustomizedSites, donc pas besoin de réinitialiser ici
          }
        };
        deleteButton.addEventListener('click', handleDelete);
        // ... (même logique pour mouseenter/mouseleave) ...

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
    const selectedModel = modelSelect.value;
    
    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    // Modifié: sk-ant- -> sk-or-
    if (!apiKey.startsWith('sk-or-')) {
      showStatus('OpenRouter API key should start with sk-or-', 'error');
      return;
    }

    if (!selectedModel && modelSelect.options.length > 0 && modelSelect.options[0].value !== "") {
        // Si aucun modèle n'est sélectionné mais que la liste n'est pas vide (et pas "aucun modèle trouvé")
        showStatus('Please select a model', 'error');
        return;
    }
    if (modelSelect.options.length === 0 || modelSelect.options[0].value === "") {
        showStatus('No models available to select. Check API key and network.', 'error');
        return;
    }


    try {
      // Modifié: anthropicApiKey -> openRouterApiKey
      await chrome.storage.sync.set({ 
        openRouterApiKey: apiKey,
        selectedModel: selectedModel
      });
      result.openRouterApiKey = apiKey; // Mettre à jour la variable locale
      result.selectedModel = selectedModel;
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      showStatus('Failed to save settings', 'error');
    }
  });

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedModel = modelSelect.value;
    
    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }
    if (!selectedModel || modelSelect.options[0].value === "") {
      showStatus('Please select a model first (or ensure models are loaded)', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    status.style.display = 'none'; // Cacher le statut précédent

    try {
      // Modifié: anthropicApiKey -> openRouterApiKey
      await chrome.storage.sync.set({ 
        openRouterApiKey: apiKey,
        selectedModel: selectedModel
      });
      
      // Modifié: anthropicService -> openRouterService
      const initialized = await openRouterService.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize service with new key.');
      }

      // Test CSS generation (plus besoin d'uploadHTML ou deleteFile)
      const response = await openRouterService.generateCSS({
        htmlContent: '<body><p>Test paragraph.</p></body>', // Simple HTML
        prompt: 'make the paragraph text red'
      });
      
      if (response.css && response.css.includes('red')) { // Vérification basique
        showStatus('Connection successful!', 'success');
      } else {
        throw new Error('No valid CSS returned or CSS did not seem to match prompt.');
      }
    } catch (error) {
      console.error("Test connection error:", error);
      showStatus(`Connection failed: ${(error instanceof Error ? error.message : 'Unknown error')}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  // Les fonctions clearAllBtn, clearUsageBtn, factoryResetBtn restent globalement les mêmes
  // Assurez-vous juste que les clés de stockage (sync et local) sont correctement nettoyées.
  // ... (copiez les listeners pour clearAllBtn, clearUsageBtn, factoryResetBtn de l'original,
  //      en vérifiant que les clés de stockage sont bien `openRouterApiKey` etc.)
  clearAllBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Are you sure you want to clear ALL CSS customizations from ALL websites?\n\n' +
      'This will permanently remove all CSS changes, prompt history, and customization data.\n\n' +
      'This action cannot be undone!'
    );

    if (!confirmed) return;

    clearAllBtn.disabled = true;
    clearAllBtn.textContent = 'Clearing...';

    try {
      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove: string[] = Object.keys(allStorage).filter(key => 
        key.startsWith('pagemagic_css_') || key.startsWith('pagemagic_history_')
      );

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
      showStatus(`Successfully cleared ${keysToRemove.length} items of CSS/history data`, 'success');
      await loadStorageStats();
      await loadCustomizedSites();
    } catch (error) {
      showStatus(`Failed to clear CSS data: ${(error instanceof Error ? error.message : 'Unknown error')}`, 'error');
    } finally {
      clearAllBtn.textContent = 'Clear All CSS Data';
      // L'état du bouton sera mis à jour par loadStorageStats()
    }
  });

  clearUsageBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Are you sure you want to clear ALL usage data?\n\n' +
      'This will permanently remove all daily/total usage statistics, model breakdowns, and cost tracking.\n\n' +
      'This action cannot be undone!'
    );
    if (!confirmed) return;

    clearUsageBtn.disabled = true;
    clearUsageBtn.textContent = 'Clearing...';

    try {
      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove: string[] = Object.keys(allStorage).filter(key =>
        key.startsWith('pagemagic_usage_') || 
        key === 'pagemagic_total_usage' ||
        key === 'pagemagic_model_lookup' // Aussi nettoyer la table de lookup des modèles
      );

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
      showStatus(`Successfully cleared ${keysToRemove.length} items of usage data`, 'success');
      await loadUsageInfo(); // Cela mettra à jour l'état du bouton
    } catch (error) {
      showStatus(`Failed to clear usage data: ${(error instanceof Error ? error.message : 'Unknown error')}`, 'error');
    } finally {
      // Pas besoin de réinitialiser le texte/état ici, loadUsageInfo s'en charge
    }
  });

  factoryResetBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Are you sure you want to perform a factory reset?\n\n' +
      'This will permanently remove your API key, selected model, all CSS customizations, prompt history, usage statistics, and all extension settings.\n\n' +
      'This action cannot be undone!'
    );
    if (!confirmed) return;

    factoryResetBtn.disabled = true;
    factoryResetBtn.textContent = 'Resetting...';

    try {
      await chrome.storage.sync.clear(); // Nettoie API key, selected model

      const allStorage = await chrome.storage.local.get(null);
      const keysToRemove: string[] = Object.keys(allStorage).filter(key => key.startsWith('pagemagic_'));
      
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      showStatus('Factory reset complete. Please re-enter your API key.', 'success');
      
      apiKeyInput.value = '';
      modelSelect.innerHTML = '<option value="">No API Key found</option>';
      modelSelect.disabled = true;
      testBtn.disabled = true;
      result.openRouterApiKey = null; // Mettre à jour la variable locale
      result.selectedModel = null;

      await loadUsageInfo();
      await loadStorageStats();
      await loadCustomizedSites();
      
    } catch (error) {
      showStatus(`Failed to perform factory reset: ${(error instanceof Error ? error.message : 'Unknown error')}`, 'error');
    } finally {
      factoryResetBtn.disabled = false;
      factoryResetBtn.textContent = 'Factory Reset';
    }
  });

});
