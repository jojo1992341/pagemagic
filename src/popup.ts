import { anthropicService } from './api.js';

interface PromptHistoryItem {
  id: string;
  prompt: string;
  css: string;
  timestamp: number;
  disabled?: boolean;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Check for API key first
  const result = await chrome.storage.sync.get(['anthropicApiKey']);
  if (!result.anthropicApiKey) {
    // Show "no API key" message instead of regular UI
    document.body.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h3 style="margin: 0 0 10px 0; color: #333;">No API key set</h3>
        <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Go to settings to set your Anthropic API key.</p>
        <button id="open-settings" style="
          background: #007bff; 
          color: white; 
          border: none; 
          padding: 8px 16px; 
          border-radius: 4px; 
          cursor: pointer; 
          font-size: 14px;
        ">Open Settings</button>
      </div>
    `;
    
    // Add settings button handler
    const openSettingsBtn = document.getElementById('open-settings');
    openSettingsBtn?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    return; // Exit early, don't load the rest of the UI
  }

  const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const applyButton = document.getElementById('apply-changes') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const historySection = document.getElementById('history-section') as HTMLDivElement;
  const historyList = document.getElementById('history-list') as HTMLDivElement;
  const dailyCost = document.getElementById('daily-cost') as HTMLSpanElement;
  const totalCost = document.getElementById('total-cost') as HTMLSpanElement;
  const settingsLink = document.getElementById('settings-link') as HTMLAnchorElement;
  const domainWideCheckbox = document.getElementById('domain-wide') as HTMLInputElement;
  const disableAllButton = document.getElementById('disable-all') as HTMLButtonElement;
  const removeAllButton = document.getElementById('remove-all') as HTMLButtonElement;
  
  let currentFileId: string | null = null;
  let currentTabId: number | null = null;
  
  // Get current URL key for storage
  async function getCurrentUrlKey(useDomainWide?: boolean): Promise<string> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url!);
    const isDomainWide = useDomainWide ?? domainWideCheckbox.checked;
    
    if (isDomainWide) {
      return `pagemagic_history_${url.origin}`;
    } else {
      return `pagemagic_history_${url.origin}${url.pathname}`;
    }
  }
  
  // Get prompt history for current URL
  async function getPromptHistory(): Promise<PromptHistoryItem[]> {
    try {
      const urlKey = await getCurrentUrlKey();
      const result = await chrome.storage.local.get([urlKey]);
      return result[urlKey] || [];
    } catch (error) {
      console.warn('Failed to get prompt history:', error);
      return [];
    }
  }
  
  // Save prompt history for current URL
  async function savePromptHistory(history: PromptHistoryItem[]): Promise<void> {
    try {
      const urlKey = await getCurrentUrlKey();
      await chrome.storage.local.set({ [urlKey]: history });
    } catch (error) {
      console.warn('Failed to save prompt history:', error);
    }
  }
  
  // Add new prompt to history
  async function addToHistory(prompt: string, css: string): Promise<void> {
    const history = await getPromptHistory();
    const newItem: PromptHistoryItem = {
      id: Date.now().toString(),
      prompt,
      css,
      timestamp: Date.now()
    };
    history.push(newItem);
    await savePromptHistory(history);
    
    // Update the CSS storage to reflect the new history
    await updateCSSStorage(history);
    await displayHistory();
  }
  
  // Remove prompt from history and update storage
  async function removeFromHistory(id: string): Promise<void> {
    const history = await getPromptHistory();
    const updatedHistory = history.filter(item => item.id !== id);
    await savePromptHistory(updatedHistory);
    
    // Update the CSS storage to reflect the removal
    await updateCSSStorage(updatedHistory);
    await displayHistory();
  }
  
  // Toggle disabled state of a history item
  async function toggleDisabled(id: string): Promise<void> {
    const history = await getPromptHistory();
    const updatedHistory = history.map(item => 
      item.id === id ? { ...item, disabled: !item.disabled } : item
    );
    await savePromptHistory(updatedHistory);
    
    // Update the CSS storage to reflect the change
    await updateCSSStorage(updatedHistory);
    
    await displayHistory();
  }
  
  // Update CSS storage with current history
  async function updateCSSStorage(history: PromptHistoryItem[], useDomainWide?: boolean): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url!);
      const isDomainWide = useDomainWide ?? domainWideCheckbox.checked;
      
      const urlKey = isDomainWide 
        ? `pagemagic_css_${url.origin}`
        : `pagemagic_css_${url.origin}${url.pathname}`;
      
      const enabledHistory = history.filter(item => !item.disabled);
      if (enabledHistory.length > 0) {
        const cssArray = enabledHistory.map(item => item.css);
        await chrome.storage.local.set({ [urlKey]: cssArray });
      } else {
        await chrome.storage.local.remove(urlKey);
      }
    } catch (error) {
      console.warn('Failed to update CSS storage:', error);
    }
  }
  
  // Display prompt history in the UI
  async function displayHistory(): Promise<void> {
    const history = await getPromptHistory();
    
    if (history.length === 0) {
      historySection.style.display = 'none';
      return;
    }
    
    historySection.style.display = 'block';
    historyList.innerHTML = '';
    
    // Update button text based on current state of all items
    const allDisabled = history.every(item => item.disabled);
    disableAllButton.textContent = allDisabled ? 'Enable All' : 'Disable All';
    
    history.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      
      const promptDiv = document.createElement('div');
      promptDiv.className = 'history-prompt';
      promptDiv.textContent = item.prompt;
      
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'history-buttons';
      
      const editButton = document.createElement('button');
      editButton.className = 'history-edit';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', async () => {
        try {
          // Remove from history
          await removeFromHistory(item.id);
          
          // Put prompt back in text area
          promptInput.value = item.prompt;
          
          // Focus the text area for immediate editing
          promptInput.focus();
          
          // Reapply remaining CSS changes
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const response = await chrome.tabs.sendMessage(tab.id!, { action: 'reloadCSS' });
          
          if (response?.success) {
            // Update undo button visibility
            const updatedHistory = await getPromptHistory();
            if (updatedHistory.length === 0) {
              removeAllButton.style.display = 'none';
            }
          } else {
            throw new Error(response?.error || 'Failed to reload CSS');
          }
        } catch (error) {
          showStatus(formatErrorMessage(error) || 'Failed to edit change', 'error');
        }
      });
      
      const disableButton = document.createElement('button');
      disableButton.className = 'history-disable';
      disableButton.textContent = item.disabled ? 'Enable' : 'Disable';
      disableButton.addEventListener('click', async () => {
        try {
          await toggleDisabled(item.id);
          
          // Reapply CSS changes to reflect the toggle
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const response = await chrome.tabs.sendMessage(tab.id!, { action: 'reloadCSS' });
          
          if (!response?.success) {
            throw new Error(response?.error || 'Failed to reload CSS');
          }
        } catch (error) {
          showStatus(formatErrorMessage(error) || 'Failed to toggle change', 'error');
        }
      });
      
      const deleteButton = document.createElement('button');
      deleteButton.className = 'history-delete';
      deleteButton.textContent = 'Remove';
      deleteButton.addEventListener('click', async () => {
        try {
          await removeFromHistory(item.id);
          
          // Reapply remaining CSS changes
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const response = await chrome.tabs.sendMessage(tab.id!, { action: 'reloadCSS' });
          
          if (response?.success) {
            // Update history display
            const updatedHistory = await getPromptHistory();
            if (updatedHistory.length === 0) {
              historySection.style.display = 'none';
            }
          } else {
            throw new Error(response?.error || 'Failed to reload CSS');
          }
        } catch (error) {
          showStatus(formatErrorMessage(error) || 'Failed to remove change', 'error');
        }
      });
      
      buttonContainer.appendChild(editButton);
      buttonContainer.appendChild(disableButton);
      buttonContainer.appendChild(deleteButton);
      
      // Apply disabled styling to the prompt if disabled
      if (item.disabled) {
        historyItem.classList.add('disabled');
      }
      
      historyItem.appendChild(promptDiv);
      historyItem.appendChild(buttonContainer);
      historyList.appendChild(historyItem);
    });
  }
  
  // Load persisted state on popup open
  async function loadState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.storage.local.get([`pagemagic_state_${tab.id}`]);
      const state = result[`pagemagic_state_${tab.id}`];
      
      if (state) {
        currentFileId = state.fileId;
        currentTabId = tab.id!;
      }
      
      // Also check if there are stored customizations for this URL or domain
      const url = new URL(tab.url!);
      const pageUrlKey = `pagemagic_css_${url.origin}${url.pathname}`;
      const domainUrlKey = `pagemagic_css_${url.origin}`;
      const cssResult = await chrome.storage.local.get([pageUrlKey, domainUrlKey]);
      const pageCSS = cssResult[pageUrlKey];
      const domainCSS = cssResult[domainUrlKey];
      
      // Load domain-wide checkbox state FIRST (needed for history display)
      await loadDomainWideState();
      
      // Load and display prompt history
      await displayHistory();
      
      // Show history section if there are customizations
      const history = await getPromptHistory();
      if (history.length > 0) {
        historySection.style.display = 'block';
      }
    } catch (error) {
      console.warn('Failed to load state:', error);
    }
  }
  
  // Save state to storage
  async function saveState(hasChanges: boolean) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const state = {
        fileId: currentFileId,
        hasChanges: hasChanges
      };
      await chrome.storage.local.set({ [`pagemagic_state_${tab.id}`]: state });
    } catch (error) {
      console.warn('Failed to save state:', error);
    }
  }

  function formatErrorMessage(error: any): string {
    if (error instanceof Error) {
      // Check if the error message contains a 429 status or rate limit indication
      if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit')) {
        return 'Rate limit exceeded.';
      }
      if (error.message.includes('prompt is too long')) {
        return 'Page content is too long (> 200k tokens).';
      }
      return error.message;
    }
    return 'Unknown error occurred';
  }

  function showStatus(message: string, type: 'success' | 'error' | 'loading') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    // Only auto-hide success messages, keep errors and loading visible
    if (type === 'success') {
      setTimeout(() => {
        status.style.display = 'none';
      }, 3000);
    }
  }

  // Disable/enable UI during processing
  function setUIProcessing(processing: boolean) {
    applyButton.disabled = processing;
    promptInput.readOnly = processing;
    
    if (processing) {
      promptInput.style.opacity = '0.6';
      promptInput.style.cursor = 'not-allowed';
    } else {
      promptInput.style.opacity = '1';
      promptInput.style.cursor = 'text';
    }
  }

  // Load domain-wide checkbox state
  async function loadDomainWideState() {
    try {
      const result = await chrome.storage.local.get(['pagemagic_domain_wide']);
      domainWideCheckbox.checked = result.pagemagic_domain_wide || false;
    } catch (error) {
      console.warn('Failed to load domain-wide state:', error);
    }
  }

  // Save domain-wide checkbox state
  async function saveDomainWideState() {
    try {
      await chrome.storage.local.set({ 
        pagemagic_domain_wide: domainWideCheckbox.checked 
      });
    } catch (error) {
      console.warn('Failed to save domain-wide state:', error);
    }
  }

  // Cleanup function
  async function cleanup() {
    if (currentFileId) {
      try {
        await anthropicService.deleteFile(currentFileId);
      } catch (error) {
        console.warn('Failed to delete uploaded file:', error);
      }
      currentFileId = null;
    }
  }

  // Load state when popup opens
  await loadState();
  
  // Add keyboard shortcut for Cmd+Enter
  promptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      applyButton?.click();
    }
  });
  
  // Focus the textarea when popup opens
  promptInput?.focus();

  // Settings link handler
  settingsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Domain-wide checkbox handler
  domainWideCheckbox?.addEventListener('change', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url!);
    
    // Get the old scope key (opposite of current checkbox state)
    const oldIsDomainWide = !domainWideCheckbox.checked;
    const oldHistoryKey = oldIsDomainWide ? 
      `pagemagic_history_${url.origin}` : 
      `pagemagic_history_${url.origin}${url.pathname}`;
    const oldCSSKey = oldIsDomainWide ? 
      `pagemagic_css_${url.origin}` : 
      `pagemagic_css_${url.origin}${url.pathname}`;
    
    // Get data from old scope
    const oldHistoryResult = await chrome.storage.local.get([oldHistoryKey]);
    const oldHistory = oldHistoryResult[oldHistoryKey] || [];
    
    // Save the new domain-wide preference
    await saveDomainWideState();
    
    // If there's data in the old scope, migrate it to the new scope
    if (oldHistory.length > 0) {
      // Save history to new scope
      await savePromptHistory(oldHistory);
      
      // Update CSS storage for the new scope
      await updateCSSStorage(oldHistory);
      
      // Clean up old scope data
      await chrome.storage.local.remove([oldHistoryKey, oldCSSKey]);
    } else {
      // No migration needed, just update CSS storage for current (empty) history
      const currentHistory = await getPromptHistory();
      await updateCSSStorage(currentHistory);
    }
    
    // Refresh history display since scope might have changed
    await displayHistory();
  });

  // Cleanup when popup/window is closed
  window.addEventListener('beforeunload', cleanup);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cleanup();
    }
  });

  applyButton?.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    
    if (!prompt) {
      showStatus('Please enter a customization request', 'error');
      return;
    }

    try {
      setUIProcessing(true);
      applyButton.textContent = 'Applying...';
      applyButton.disabled = true;
      
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if we need to upload HTML (first request or different tab)
      if (!currentFileId || currentTabId !== tab.id) {
        showStatus('Getting page content...', 'loading');
        
        // Get page HTML
        const htmlResponse = await chrome.tabs.sendMessage(tab.id!, { action: 'getHTML' });
        if (!htmlResponse?.html) {
          throw new Error('Failed to get page content');
        }

        showStatus('Uploading page content...', 'loading');
        
        // Initialize API service
        const initialized = await anthropicService.initialize();
        if (!initialized) {
          throw new Error('API not configured. Please check settings.');
        }

        // Clean up previous file if exists
        if (currentFileId) {
          await anthropicService.deleteFile(currentFileId);
        }

        // Upload HTML to Files API
        const uploadResponse = await anthropicService.uploadHTML(htmlResponse.html);
        currentFileId = uploadResponse.fileId;
        currentTabId = tab.id!;
      } else {
        // Initialize API service for subsequent requests
        const initialized = await anthropicService.initialize();
        if (!initialized) {
          throw new Error('API not configured. Please check settings.');
        }
      }

      showStatus('Generating CSS...', 'loading');

      // Generate CSS using file ID
      let cssResponse;
      try {
        cssResponse = await anthropicService.generateCSS({
          fileId: currentFileId,
          prompt: prompt
        });
      } catch (error) {
        // If file not found, clear the file ID and retry with fresh upload
        if (error instanceof Error && error.message.includes('File not found')) {
          currentFileId = null;
          currentTabId = null;
          await saveState(false);
          
          showStatus('Re-uploading page content...', 'loading');
          
          // Get page HTML again
          const htmlResponse = await chrome.tabs.sendMessage(tab.id!, { action: 'getHTML' });
          if (!htmlResponse?.html) {
            throw new Error('Failed to get page content');
          }
          
          // Upload HTML to Files API
          const uploadResponse = await anthropicService.uploadHTML(htmlResponse.html);
          currentFileId = uploadResponse.fileId;
          currentTabId = tab.id!;
          
          showStatus('Generating CSS...', 'loading');
          
          // Retry CSS generation
          cssResponse = await anthropicService.generateCSS({
            fileId: currentFileId,
            prompt: prompt
          });
        } else {
          throw error;
        }
      }

      if (!cssResponse.css) {
        throw new Error('No CSS generated');
      }

      // Log the generated CSS for debugging
      console.log('Generated CSS:', cssResponse.css);

      showStatus('Applying changes...', 'loading');
      
      // Inject CSS
      const injectResponse = await chrome.tabs.sendMessage(tab.id!, { 
        action: 'injectCSS', 
        css: cssResponse.css 
      });

      if (injectResponse?.success) {
        showStatus('Changes applied.', 'success');
        
        // Add to history
        await addToHistory(prompt, cssResponse.css);
        
        promptInput.value = '';
        
        // Save state with changes applied
        await saveState(true);
      } else {
        throw new Error(injectResponse?.error || 'Failed to apply changes');
      }
    } catch (error) {
      showStatus(formatErrorMessage(error), 'error');
    } finally {
      setUIProcessing(false);
      applyButton.textContent = 'Apply Changes';
      applyButton.disabled = false;
    }
  });

  // Add event listeners for the new buttons
  disableAllButton?.addEventListener('click', async () => {
    try {
      setUIProcessing(true);
      
      const history = await getPromptHistory();
      if (history.length === 0) {
        showStatus('No changes to disable', 'error');
        return;
      }

      // Check if all items are currently disabled
      const allDisabled = history.every(item => item.disabled);
      
      // Toggle all items to the opposite state
      const updatedHistory = history.map(item => ({ ...item, disabled: !allDisabled }));
      await savePromptHistory(updatedHistory);
      
      // Update the CSS storage to reflect the changes
      await updateCSSStorage(updatedHistory);
      
      // Reapply CSS changes
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id!, { action: 'reloadCSS' });
      
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to reload CSS');
      }
      
      // Update button text based on new state
      disableAllButton.textContent = allDisabled ? 'Disable All' : 'Enable All';
      
      await displayHistory();
    } catch (error) {
      showStatus(formatErrorMessage(error) || 'Failed to toggle changes', 'error');
    } finally {
      setUIProcessing(false);
    }
  });

  removeAllButton?.addEventListener('click', async () => {
    try {
      const history = await getPromptHistory();
      if (history.length === 0) {
        showStatus('No changes to remove', 'error');
        return;
      }
      
      // Clear history
      await savePromptHistory([]);
      
      // Remove CSS from storage
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url!);
      const pageUrlKey = `pagemagic_css_${url.origin}${url.pathname}`;
      const domainUrlKey = `pagemagic_css_${url.origin}`;
      await chrome.storage.local.remove([pageUrlKey, domainUrlKey]);
      
      // Remove CSS from page
      try {
        const response = await chrome.tabs.sendMessage(tab.id!, { action: 'removeCSS' });
        if (!response?.success) {
          throw new Error(response?.error || 'Failed to remove CSS');
        }
      } catch (messageError) {
        // If content script not responding, try to remove CSS directly
        if (messageError instanceof Error && messageError.message.includes('Receiving end does not exist')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            func: () => {
              const pagemagicStyles = document.querySelectorAll('style[data-pagemagic="true"]');
              pagemagicStyles.forEach(style => style.remove());
            }
          });
        } else {
          throw messageError;
        }
      }
      
      historySection.style.display = 'none';
      
      // Save state with changes removed
      await saveState(false);
    } catch (error) {
      showStatus(formatErrorMessage(error) || 'Failed to remove all changes', 'error');
    } finally {
      setUIProcessing(false);
    }
  });

});
