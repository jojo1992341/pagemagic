import { anthropicService } from './api.js';

interface PromptHistoryItem {
  id: string;
  prompt: string;
  css: string;
  timestamp: number;
}

document.addEventListener('DOMContentLoaded', async () => {
  const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const applyButton = document.getElementById('apply-changes') as HTMLButtonElement;
  const undoButton = document.getElementById('undo-changes') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const historySection = document.getElementById('history-section') as HTMLDivElement;
  const historyList = document.getElementById('history-list') as HTMLDivElement;
  
  let currentFileId: string | null = null;
  let currentTabId: number | null = null;
  
  // Get current URL key for storage
  async function getCurrentUrlKey(): Promise<string> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url!);
    return `pagebuddy_history_${url.origin}${url.pathname}`;
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
  
  // Update CSS storage with current history
  async function updateCSSStorage(history: PromptHistoryItem[]): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url!);
      const urlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
      
      if (history.length > 0) {
        const cssArray = history.map(item => item.css);
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
      
      historyItem.appendChild(promptDiv);
      historyItem.appendChild(deleteButton);
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
      
      // Also check if there are stored customizations for this URL
      const url = new URL(tab.url!);
      const urlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
      const cssResult = await chrome.storage.local.get([urlKey]);
      const storedCSS = cssResult[urlKey];
      
      if (storedCSS && Array.isArray(storedCSS) && storedCSS.length > 0) {
        undoButton.style.display = 'inline-block';
      }
      
      // Load and display prompt history
      await displayHistory();
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
      applyButton.disabled = true;
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

      showStatus('Changes applied successfully!', 'success');
      undoButton.style.display = 'inline-block';
      
      // Add to history
      await addToHistory(prompt, cssResponse.css);
      
      promptInput.value = '';
      
      // Save state with changes applied
      await saveState(true);
      
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Unknown error occurred', 'error');
    } finally {
      applyButton.disabled = false;
      applyButton.textContent = 'Apply Changes';
    }
  });

  undoButton?.addEventListener('click', async () => {
    try {
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
            
            // Remove CSS from storage
            const url = new URL(tab.url!);
            const urlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
            await chrome.storage.local.remove(urlKey);
            
            showStatus('Changes removed', 'success');
            undoButton.style.display = 'none';
            
            // Clear history when all changes are removed
            await savePromptHistory([]);
            await displayHistory();
            
            await saveState(false);
          } catch (scriptError) {
            // Final fallback - just remove from storage
            const url = new URL(tab.url!);
            const urlKey = `pagebuddy_css_${url.origin}${url.pathname}`;
            await chrome.storage.local.remove(urlKey);
            
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
    }
  });

});
