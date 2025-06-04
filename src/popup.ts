// pagemagic-main/src/popup.ts
import { openRouterService } from './api.js';

interface PromptHistoryItem {
  id: string;
  prompt: string;
  css: string;
  timestamp: number;
  disabled?: boolean;
}

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(['openRouterApiKey']);
  if (!result.openRouterApiKey) {
    document.body.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h3 style="margin: 0 0 10px 0; color: #333;">No API key set</h3>
        <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Go to settings to set your OpenRouter API key.</p>
        <button id="open-settings" style="
          background: #1976d2; /* Couleur du thème */
          color: white; border: none; padding: 8px 16px; 
          border-radius: 4px; cursor: pointer; font-size: 14px;
        ">Open Settings</button>
      </div>
    `;
    const openSettingsBtn = document.getElementById('open-settings');
    openSettingsBtn?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const applyButton = document.getElementById('apply-changes') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;
  const historySection = document.getElementById('history-section') as HTMLDivElement;
  const historyList = document.getElementById('history-list') as HTMLDivElement;
  const settingsLink = document.getElementById('settings-link') as HTMLAnchorElement;
  const domainWideCheckbox = document.getElementById('domain-wide') as HTMLInputElement;
  const disableAllButton = document.getElementById('disable-all') as HTMLButtonElement;
  const removeAllButton = document.getElementById('remove-all') as HTMLButtonElement;
  
  let currentTabId: number | null = null;
  let pageHTMLCache: string | null = null;
  let currentTabUrl: string | null = null; // Pour détecter si l'URL a changé au sein du même onglet

  async function getCurrentUrlKey(useDomainWide?: boolean): Promise<string> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error("Cannot get URL of current tab for storage key.");
    const url = new URL(tab.url);
    const isDomainWide = useDomainWide ?? domainWideCheckbox.checked;
    const basePath = `pagemagic_history_${url.origin}`;
    
    if (isDomainWide) {
      return basePath;
    } else {
      // Normaliser le pathname en supprimant le slash de fin s'il existe et n'est pas la racine
      let path = url.pathname;
      if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      return `${basePath}${path}`;
    }
  }
  
  async function getPromptHistory(): Promise<PromptHistoryItem[]> {
    try {
      const urlKey = await getCurrentUrlKey();
      const storageResult = await chrome.storage.local.get([urlKey]);
      return storageResult[urlKey] || [];
    } catch (error) {
      console.warn('Failed to get prompt history:', error);
      showStatus('Error loading history.', 'error');
      return [];
    }
  }
  
  async function savePromptHistory(history: PromptHistoryItem[]): Promise<void> {
    try {
      const urlKey = await getCurrentUrlKey();
      await chrome.storage.local.set({ [urlKey]: history });
    } catch (error) {
      console.warn('Failed to save prompt history:', error);
      showStatus('Error saving history.', 'error');
    }
  }
  
  async function addToHistory(prompt: string, css: string): Promise<void> {
    const history = await getPromptHistory();
    const newItem: PromptHistoryItem = {
      id: Date.now().toString() + Math.random().toString(36).substring(2,7), // Plus d'unicité
      prompt,
      css,
      timestamp: Date.now()
    };
    history.push(newItem);
    await savePromptHistory(history);
    await updateCSSStorage(history); // Ceci applique le CSS combiné
    await displayHistory();
  }
  
  async function removeFromHistory(id: string): Promise<void> {
    let history = await getPromptHistory();
    history = history.filter(item => item.id !== id);
    await savePromptHistory(history);
    await updateCSSStorage(history);
    await displayHistory();
    await reloadCSSOnPage(); // S'assurer que le CSS est réappliqué sur la page
  }
  
  async function toggleDisabled(id: string): Promise<void> {
    let history = await getPromptHistory();
    history = history.map(item => 
      item.id === id ? { ...item, disabled: !item.disabled } : item
    );
    await savePromptHistory(history);
    await updateCSSStorage(history);
    await displayHistory();
    await reloadCSSOnPage();
  }
  
  async function updateCSSStorage(history: PromptHistoryItem[], useDomainWide?: boolean): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error("Cannot get URL of current tab for CSS storage.");
      const url = new URL(tab.url);
      const isDomainWide = useDomainWide ?? domainWideCheckbox.checked;
      
      const cssUrlKey = (isDomainWide 
        ? `pagemagic_css_${url.origin}`
        : `pagemagic_css_${url.origin}${url.pathname.endsWith('/') && url.pathname !=='/' ? url.pathname.slice(0,-1) : url.pathname}`
      );
      
      const enabledHistoryCSS = history.filter(item => !item.disabled).map(item => item.css);
      
      if (enabledHistoryCSS.length > 0) {
        await chrome.storage.local.set({ [cssUrlKey]: enabledHistoryCSS });
      } else {
        await chrome.storage.local.remove(cssUrlKey); // Supprime la clé si plus de CSS actif
      }
    } catch (error) {
      console.warn('Failed to update CSS storage:', error);
      showStatus('Error updating CSS storage.', 'error');
    }
  }

  async function reloadCSSOnPage() {
    if (currentTabId) {
        try {
            const response = await chrome.tabs.sendMessage(currentTabId, { action: 'reloadCSS' });
            if (!response?.success) {
                console.warn('Failed to reload CSS on page or content script not ready:', response?.error);
            }
        } catch (e) {
            console.warn('Error sending reloadCSS message, content script might not be injected yet.', e);
        }
    }
  }
  
  async function displayHistory(): Promise<void> {
    const history = await getPromptHistory();
    
    if (history.length === 0) {
      historySection.style.display = 'none';
      return;
    }
    
    historySection.style.display = 'block';
    historyList.innerHTML = ''; // Clear previous items
    
    const allItemsDisabled = history.every(item => item.disabled);
    disableAllButton.textContent = allItemsDisabled ? 'Enable All' : 'Disable All';
    
    history.slice().reverse().forEach(item => { // Afficher les plus récents en premier
      const historyItemDiv = document.createElement('div');
      historyItemDiv.className = 'history-item';
      if (item.disabled) historyItemDiv.classList.add('disabled');
      
      const promptDiv = document.createElement('div');
      promptDiv.className = 'history-prompt';
      promptDiv.textContent = item.prompt;
      
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'history-buttons';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'history-edit';
      editBtn.textContent = 'Edit';
      editBtn.title = "Edit this change (removes current, refills prompt)";
      editBtn.addEventListener('click', async () => {
        promptInput.value = item.prompt;
        await removeFromHistory(item.id); // Ceci va aussi appeler displayHistory et reloadCSS
        promptInput.focus();
      });
      
      const disableBtn = document.createElement('button');
      disableBtn.className = 'history-disable';
      disableBtn.textContent = item.disabled ? 'Enable' : 'Disable';
      disableBtn.title = item.disabled ? "Enable this change" : "Disable this change";
      disableBtn.addEventListener('click', () => toggleDisabled(item.id));
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete';
      deleteBtn.textContent = 'Remove';
      deleteBtn.title = "Permanently remove this change";
      deleteBtn.addEventListener('click', () => removeFromHistory(item.id));
      
      buttonsDiv.appendChild(editBtn);
      buttonsDiv.appendChild(disableBtn);
      buttonsDiv.appendChild(deleteBtn);
      historyItemDiv.appendChild(promptDiv);
      historyItemDiv.appendChild(buttonsDiv);
      historyList.appendChild(historyItemDiv);
    });
  }
  
  async function loadState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab?.url) {
          console.warn("Popup opened on invalid tab.");
          applyButton.disabled = true; // Désactiver si l'onglet n'est pas valide
          showStatus("Cannot operate on this tab.", "error");
          return;
      }
      currentTabId = tab.id;
      currentTabUrl = tab.url; // Stocker l'URL actuelle
      pageHTMLCache = null; 

      await loadDomainWideState(); // Doit être chargé avant displayHistory pour la clé correcte
      await displayHistory();
      
      const history = await getPromptHistory();
      historySection.style.display = history.length > 0 ? 'block' : 'none';
    } catch (error) {
      console.warn('Failed to load state:', error);
      showStatus("Error loading extension state.", "error");
    }
  }

  function formatErrorMessage(error: any): string {
    if (error instanceof Error) {
      if (error.message.includes('API key not configured')) {
        return 'API key missing. Go to Settings.';
      }
      if (error.message.includes('401') || error.message.toLowerCase().includes('authentication failed')) {
        return 'Authentication failed. Check API key in Settings.';
      }
      if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit')) {
        return 'Rate limit exceeded with API. Try again later.';
      }
      if (error.message.toLowerCase().includes('context_length_exceeded') || error.message.includes('page content too long')) {
        return 'Page content too long for this model.';
      }
      return error.message.length > 100 ? error.message.substring(0, 97) + "..." : error.message;
    }
    return 'An unknown error occurred.';
  }

  function showStatus(message: string, type: 'success' | 'error' | 'loading') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`; // Assurez-vous que la classe 'status' est toujours là
    statusDiv.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => {
        // Cache le message uniquement s'il n'a pas été remplacé entre-temps
        if (statusDiv.textContent === message && statusDiv.classList.contains('success')) {
          statusDiv.style.display = 'none';
        }
      }, 3000);
    }
  }

  function setUIProcessing(processing: boolean) {
    applyButton.disabled = processing;
    promptInput.readOnly = processing;
    disableAllButton.disabled = processing;
    removeAllButton.disabled = processing;
    // Désactiver les boutons d'historique individuels aussi
    historyList.querySelectorAll('button').forEach(btn => (btn as HTMLButtonElement).disabled = processing);

    promptInput.style.opacity = processing ? '0.7' : '1';
    promptInput.style.cursor = processing ? 'wait' : 'text';
    if(processing) applyButton.textContent = 'Applying...';
    else applyButton.textContent = 'Apply Changes';
  }

  async function loadDomainWideState() {
    try {
      const storageResult = await chrome.storage.local.get(['pagemagic_domain_wide']);
      domainWideCheckbox.checked = storageResult.pagemagic_domain_wide || false;
    } catch (error) {
      console.warn('Failed to load domain-wide state:', error);
    }
  }

  async function saveDomainWideState() {
    try {
      await chrome.storage.local.set({ 
        pagemagic_domain_wide: domainWideCheckbox.checked 
      });
    } catch (error) {
      console.warn('Failed to save domain-wide state:', error);
    }
  }

  await loadState();
  
  promptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!applyButton.disabled) applyButton.click();
    }
  });
  
  promptInput?.focus();

  settingsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  domainWideCheckbox?.addEventListener('change', async () => {
    const previousDomainWide = !domainWideCheckbox.checked;
    const oldKey = await getCurrentUrlKey(previousDomainWide); // Clé pour l'ancien scope
    const oldHistoryResult = await chrome.storage.local.get([oldKey]);
    const oldHistory: PromptHistoryItem[] = oldHistoryResult[oldKey] || [];
    
    await saveDomainWideState(); // Enregistre la nouvelle préférence

    const newKey = await getCurrentUrlKey(); // Clé pour le nouveau scope
    if (oldKey !== newKey) { // Si le scope a réellement changé
        if (oldHistory.length > 0) {
            await chrome.storage.local.set({ [newKey]: oldHistory }); // Migrer l'historique
            await chrome.storage.local.remove(oldKey); // Nettoyer l'ancien historique

            // Migrer aussi le CSS
            const oldCssKey = oldKey.replace('_history_', '_css_');
            const newCssKey = newKey.replace('_history_', '_css_');
            const oldCssResult = await chrome.storage.local.get([oldCssKey]);
            if (oldCssResult[oldCssKey]) {
                await chrome.storage.local.set({ [newCssKey]: oldCssResult[oldCssKey] });
                await chrome.storage.local.remove(oldCssKey);
            }
        }
    }
    // Mettre à jour l'affichage et le CSS sur la page
    await displayHistory(); 
    await reloadCSSOnPage();
  });

  applyButton?.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      showStatus('Please enter a customization request.', 'error');
      return;
    }
    if (!currentTabId) {
      showStatus('No active tab identified. Cannot apply changes.', 'error');
      return;
    }

    setUIProcessing(true);
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
       if (!tab?.id || !tab?.url) {
          throw new Error("Current tab is not valid for applying changes.");
      }
      // Vérifier si l'URL a changé depuis le dernier cache HTML (navigation SPA)
      if (tab.id !== currentTabId || tab.url !== currentTabUrl || !pageHTMLCache) {
        showStatus('Getting page content...', 'loading');
        const htmlResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getHTML' });
        if (!htmlResponse?.html) {
          throw new Error('Failed to get page content.');
        }
        pageHTMLCache = htmlResponse.html;
        currentTabId = tab.id;
        currentTabUrl = tab.url;
      }
      
      const initialized = await openRouterService.initialize();
      if (!initialized) {
        throw new Error('API not configured. Please check settings.');
      }

      showStatus('Generating CSS...', 'loading');
      const cssResponse = await openRouterService.generateCSS({
        htmlContent: pageHTMLCache,
        prompt: prompt
      });

      if (!cssResponse.css || cssResponse.css.trim() === "") {
        console.warn("Generated CSS is empty.");
        showStatus('Model returned empty CSS. Try rephrasing or a different model.', 'error');
        setUIProcessing(false); // Important de le remettre à false ici
        return;
      }
      console.log('Generated CSS:', cssResponse.css);

      showStatus('Applying changes...', 'loading');
      const injectResponse = await chrome.tabs.sendMessage(currentTabId, { 
        action: 'injectCSS', 
        css: cssResponse.css 
      });

      if (injectResponse?.success) {
        await addToHistory(prompt, cssResponse.css); // addToHistory appelle displayHistory et updateCSSStorage
        promptInput.value = '';
        showStatus('Changes applied!', 'success');
      } else {
        throw new Error(injectResponse?.error || 'Failed to apply changes to the page.');
      }
    } catch (error) {
      console.error("Error in applyButton click:", error);
      showStatus(formatErrorMessage(error), 'error');
    } finally {
      setUIProcessing(false);
    }
  });

  disableAllButton?.addEventListener('click', async () => {
    setUIProcessing(true);
    try {
      const history = await getPromptHistory();
      if (history.length === 0) {
        showStatus('No changes to disable/enable.', 'error');
        return;
      }
      const allCurrentlyDisabled = history.every(item => item.disabled);
      const newDisabledStateForAll = !allCurrentlyDisabled;

      const updatedHistory = history.map(item => ({ ...item, disabled: newDisabledStateForAll }));
      await savePromptHistory(updatedHistory);
      await updateCSSStorage(updatedHistory);
      await displayHistory(); // Met à jour le texte du bouton "Disable All" / "Enable All"
      await reloadCSSOnPage();
      showStatus(newDisabledStateForAll ? 'All changes disabled.' : 'All changes enabled.', 'success');
    } catch (error) {
      showStatus(formatErrorMessage(error) || 'Failed to toggle all changes.', 'error');
    } finally {
      setUIProcessing(false);
    }
  });

  removeAllButton?.addEventListener('click', async () => {
    const history = await getPromptHistory();
    if (history.length === 0) {
        showStatus('No changes to remove.', 'error');
        return;
    }
    const confirmed = confirm("Are you sure you want to remove ALL applied changes for this page/domain? This action cannot be undone.");
    if (!confirmed) return;

    setUIProcessing(true);
    try {
      await savePromptHistory([]); // Vide l'historique pour la clé actuelle
      await updateCSSStorage([]); // Vide le CSS stocké pour la clé actuelle (via histoire vide)
      
      if (currentTabId) {
          try {
            const response = await chrome.tabs.sendMessage(currentTabId, { action: 'removeCSS' });
            if (!response?.success) {
              console.warn('Failed to remove CSS via message, content script might not be active:', response?.error);
              // Fallback si le content script ne répond pas (ex: rechargement de page, erreur)
              await chrome.scripting.executeScript({
                target: { tabId: currentTabId },
                func: () => {
                  const pagemagicStyles = document.querySelectorAll('style[data-pagemagic="true"]');
                  pagemagicStyles.forEach(style => style.remove());
                }
              });
            }
          } catch (e) {
             console.warn('Error sending removeCSS message or executing script:', e);
             // Tenter le script d'exécution comme fallback
             await chrome.scripting.executeScript({
                target: { tabId: currentTabId },
                func: () => {
                  const pagemagicStyles = document.querySelectorAll('style[data-pagemagic="true"]');
                  pagemagicStyles.forEach(style => style.remove());
                }
              });
          }
      }
      await displayHistory(); // Met à jour l'UI pour refléter l'historique vide
      showStatus('All changes removed.', 'success');
    } catch (error) {
      showStatus(formatErrorMessage(error) || 'Failed to remove all changes.', 'error');
    } finally {
      setUIProcessing(false);
    }
  });

  // Vérifier l'URL actuelle lorsque la popup gagne le focus (pour les SPA)
  window.addEventListener('focus', async () => {
    if (currentTabId) {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (tab && tab.id === currentTabId && tab.url && tab.url !== currentTabUrl) {
            console.log("URL changed in focused tab, reloading state.");
            pageHTMLCache = null; // Invalider le cache HTML
            currentTabUrl = tab.url;
            await loadDomainWideState(); // Le scope peut dépendre du nouveau path si pas domain-wide
            await displayHistory();
            // Pas besoin de recharger le CSS sur la page ici, car si l'URL a changé,
            // le content_script de la nouvelle page aura déjà chargé le CSS approprié.
        }
    }
  });

});
