import { anthropicService } from './api.js';

interface PromptHistoryItem {
  id: string;
  prompt: string;
  css: string;
  timestamp: number;
  disabled?: boolean;
}

document.addEventListener('DOMContentLoaded', async () => {
  const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const applyButton = document.getElementById('apply-changes') as HTMLButtonElement;
  const undoButton = document.getElementById('undo-changes') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const historySection = document.getElementById('history-section') as HTMLDivElement;
  const historyList = document.getElementById('history-list') as HTMLDivElement;
  const dailyCost = document.getElementById('daily-cost') as HTMLSpanElement;
  const totalCost = document.getElementById('total-cost') as HTMLSpanElement;
  const settingsLink = document.getElementById('settings-link') as HTMLAnchorElement;
  const domainWideCheckbox = document.getElementById('domain-wide') as HTMLInputElement;
  
  let currentFileId: string | null = null;
  let currentTabId: number | null = null;
  
  // Get current URL key for storage
  async function getCurrentUrlKey(useDomainWide?: boolean): Promise<string> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url!);
    const isDomainWide = useDomainWide ?? domainWideCheckbox.checked;
    
    if (isDomainWide) {
      return `pagebuddy_history_${url.origin}`;
    } else {
      return `pagebuddy_history_${url.origin}${url.pathname}`;
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
        ? `pagebuddy_css_${url.origin}`
        : `pagebuddy_css_${url.origin}${url.pathname}`;
      
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
    
    history.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      
      const promptDiv = document.createElement('div');
      promptDiv.className = 'history-prompt';
      promptDiv.textContent = item.prompt;
      
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'history-buttons';
      
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
          showStatus(error instanceof Error ? error.message : 'Failed to toggle change', 'error');
        }
      });
      
      const deleteButton = document.createElement('button');
      deleteButton.className = 'history-delete';
      deleteButton.textContent = 'Remove';
      deleteButton.addEventListener('click', async () => {
        try {
          showStatus('Removing change...', 'loading');
          await removeFromHistory(item.id);
          
          // Reapply remaining CSS changes
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const response = await chrome.tabs.sendMessage(tab.id!, { action: 'reloadCSS' });
          
          if (response?.success) {
            showStatus('Change removed', 'success');
            
            // Update undo button visibility
            const updatedHistory = await getPromptHistory();
            if (updatedHistory.length === 0) {
              undoButton.style.display = 'none';
            }
          } else {
            throw new Error(response?.error || 'Failed to reload CSS');
          }
        } catch (error) {
          showStatus(error instanceof Error ? error.message : 'Failed to remove change', 'error');
        }
      });
      
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
              undoButton.style.display = 'none';
            }
          } else {
            throw new Error(response?.error || 'Failed to reload CSS');
          }
        } catch (error) {
          showStatus(error instanceof Error ? error.message : 'Failed to edit change', 'error');
        }
      });
      
      buttonContainer.appendChild(disableButton);
      buttonContainer.appendChild(editButton);
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
      const result = await chrome.storage.local.get([`pagebuddy_state_${tab.id}`]);
      const state = result[`pagebuddy_state_${tab.id}`];
      
      if (state) {
        currentFileId = state.fileId;
        currentTabId = tab.id!;
        
        if (state.hasChanges) {
          undoButton.style.display = 'inline-block';
        }
      }
      
      // Also check if there are stored customizations for this URL or domain
      const url = new URL(tab.url!);
      const pageUrlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
      const domainUrlKey = `pagebuddy_css_${url.origin}`;
      const cssResult = await chrome.storage.local.get([pageUrlKey, domainUrlKey]);
      const pageCSS = cssResult[pageUrlKey];
      const domainCSS = cssResult[domainUrlKey];
      
      if ((pageCSS && Array.isArray(pageCSS) && pageCSS.length > 0) ||
          (domainCSS && Array.isArray(domainCSS) && domainCSS.length > 0)) {
        undoButton.style.display = 'inline-block';
      }
      
      // Load domain-wide checkbox state FIRST (needed for history display)
      await loadDomainWideState();
      
      // Load and display prompt history
      await displayHistory();
      
      // Load usage information
      await loadUsageInfo();
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
      await chrome.storage.local.set({ [`pagebuddy_state_${tab.id}`]: state });
    } catch (error) {
      console.warn('Failed to save state:', error);
    }
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
    undoButton.disabled = processing;
    promptInput.readOnly = processing;
    
    if (processing) {
      promptInput.style.opacity = '0.6';
      promptInput.style.cursor = 'not-allowed';
    } else {
      promptInput.style.opacity = '1';
      promptInput.style.cursor = 'text';
    }
  }

  // Load and display usage information
  async function loadUsageInfo() {
    try {
      const totalUsage = await anthropicService.getTotalUsage();
      const dailyUsage = await anthropicService.getDailyUsage();
      
      dailyCost.textContent = `$${dailyUsage.totalCost.toFixed(4)}`;
      totalCost.textContent = `$${totalUsage.totalCost.toFixed(4)}`;
    } catch (error) {
      console.warn('Failed to load usage info:', error);
    }
  }

  // Load domain-wide checkbox state
  async function loadDomainWideState() {
    try {
      const result = await chrome.storage.local.get(['pagebuddy_domain_wide']);
      domainWideCheckbox.checked = result.pagebuddy_domain_wide || false;
    } catch (error) {
      console.warn('Failed to load domain-wide state:', error);
    }
  }

  // Save domain-wide checkbox state
  async function saveDomainWideState() {
    try {
      await chrome.storage.local.set({ 
        pagebuddy_domain_wide: domainWideCheckbox.checked 
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
      `pagebuddy_history_${url.origin}` : 
      `pagebuddy_history_${url.origin}${url.pathname}`;
    const oldCSSKey = oldIsDomainWide ? 
      `pagebuddy_css_${url.origin}` : 
      `pagebuddy_css_${url.origin}${url.pathname}`;
    
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

      if (!injectResponse?.success) {
        throw new Error(injectResponse?.error || 'Failed to apply changes');
      }

      showStatus('Changes applied.', 'success');
      undoButton.style.display = 'inline-block';
      
      // Add to history
      await addToHistory(prompt, cssResponse.css);
      
      // Update usage display
      await loadUsageInfo();
      
      promptInput.value = '';
      
      // Save state with changes applied
      await saveState(true);
      
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Unknown error occurred', 'error');
    } finally {
      setUIProcessing(false);
      applyButton.textContent = 'Apply Changes';
    }
  });

  undoButton?.addEventListener('click', async () => {
    try {
      setUIProcessing(true);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      showStatus('Removing changes...', 'loading');
      
      try {
        const response = await chrome.tabs.sendMessage(tab.id!, { action: 'removeCSS' });
        
        if (response?.success) {
          showStatus('Changes removed', 'success');
          undoButton.style.display = 'none';
          
          // Clear history when all changes are removed
          await savePromptHistory([]);
          await displayHistory();
          
          // Save state with changes removed
          await saveState(false);
        } else {
          throw new Error(response?.error || 'Failed to remove changes');
        }
      } catch (messageError) {
        // If content script not responding, try to remove CSS directly via script injection
        if (messageError instanceof Error && messageError.message.includes('Receiving end does not exist')) {
          showStatus('Removing customizations directly...', 'loading');
          
          try {
            // Inject script to remove PageBuddy styles directly
            await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              func: () => {
                // Remove all PageBuddy style elements
                const pagebuddyStyles = document.querySelectorAll('style[data-pagebuddy="true"]');
                pagebuddyStyles.forEach(style => style.remove());
              }
            });
            
            // Remove CSS from storage (both page-specific and domain-wide)
            const url = new URL(tab.url!);
            const pageUrlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
            const domainUrlKey = `pagebuddy_css_${url.origin}`;
            await chrome.storage.local.remove([pageUrlKey, domainUrlKey]);
            
            showStatus('Changes removed', 'success');
            undoButton.style.display = 'none';
            
            // Clear history when all changes are removed
            await savePromptHistory([]);
            await displayHistory();
            
            await saveState(false);
          } catch (scriptError) {
            // Final fallback - just remove from storage
            const url = new URL(tab.url!);
            const pageUrlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
            const domainUrlKey = `pagebuddy_css_${url.origin}`;
            await chrome.storage.local.remove([pageUrlKey, domainUrlKey]);
            
            showStatus('Stored customizations removed. Please refresh the page.', 'success');
            undoButton.style.display = 'none';
            
            // Clear history when all changes are removed
            await savePromptHistory([]);
            await displayHistory();
            
            await saveState(false);
          }
        } else {
          throw messageError;
        }
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Failed to undo changes', 'error');
    } finally {
      setUIProcessing(false);
    }
  });

});
