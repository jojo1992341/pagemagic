let injectedStyleElement: HTMLStyleElement | null = null;
let accumulatedCSS: string[] = [];

// Get URL key for storage (normalize URL by removing hash and query params for consistency)
function getUrlKey(): string {
  const url = new URL(window.location.href);
  return `pagebuddy_css_${url.origin}${url.pathname}`;
}

// Save CSS to storage for this URL
async function saveCSSToStorage() {
  try {
    const urlKey = getUrlKey();
    if (accumulatedCSS.length > 0) {
      await chrome.storage.local.set({ [urlKey]: accumulatedCSS });
    } else {
      await chrome.storage.local.remove(urlKey);
    }
  } catch (error) {
    console.warn('Failed to save CSS to storage:', error);
  }
}

// Load and apply CSS from storage for this URL
async function loadCSSFromStorage() {
  try {
    const urlKey = getUrlKey();
    const result = await chrome.storage.local.get([urlKey]);
    const storedCSS = result[urlKey];
    
    if (storedCSS && Array.isArray(storedCSS) && storedCSS.length > 0) {
      accumulatedCSS = storedCSS;
      
      // Create and inject style element
      injectedStyleElement = document.createElement('style');
      injectedStyleElement.setAttribute('data-pagebuddy', 'true');
      injectedStyleElement.textContent = accumulatedCSS.join('\n\n/* --- */\n\n');
      document.head.appendChild(injectedStyleElement);
    }
  } catch (error) {
    console.warn('Failed to load CSS from storage:', error);
  }
}

// Load CSS when page loads
loadCSSFromStorage();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTitle') {
    sendResponse({ title: document.title });
    return false;
  }
  
  if (request.action === 'getHTML') {
    sendResponse({ html: document.documentElement.outerHTML });
    return false;
  }
  
  if (request.action === 'injectCSS') {
    (async () => {
      try {
        // Add new CSS to accumulated styles
        accumulatedCSS.push(request.css);
        
        // Remove existing injected styles
        if (injectedStyleElement) {
          injectedStyleElement.remove();
        }
        
        // Create new style element with all accumulated CSS
        injectedStyleElement = document.createElement('style');
        injectedStyleElement.setAttribute('data-pagebuddy', 'true');
        injectedStyleElement.textContent = accumulatedCSS.join('\n\n/* --- */\n\n');
        
        // Inject into head
        document.head.appendChild(injectedStyleElement);
        
        // Debug logging
        console.log('PageBuddy: Injected CSS:', injectedStyleElement.textContent);
        console.log('PageBuddy: Style element position in head:', Array.from(document.head.children).indexOf(injectedStyleElement));
        
        // Check if code elements exist and log their computed styles
        const codeElements = document.querySelectorAll('code');
        if (codeElements.length > 0) {
          const firstCode = codeElements[0];
          const computedStyle = window.getComputedStyle(firstCode);
          console.log('PageBuddy: First code element computed font-size:', computedStyle.fontSize);
        }
        
        // Save to storage for persistence across page refreshes
        await saveCSSToStorage();
        
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'removeCSS') {
    (async () => {
      try {
        // Clear accumulated CSS and remove style element
        accumulatedCSS = [];
        if (injectedStyleElement) {
          injectedStyleElement.remove();
          injectedStyleElement = null;
        }
        
        // Remove from storage
        await saveCSSToStorage();
        
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'reloadCSS') {
    (async () => {
      try {
        // Reload CSS from storage and reapply
        const urlKey = getUrlKey();
        const result = await chrome.storage.local.get([urlKey]);
        const storedCSS = result[urlKey];
        
        // Remove existing style element
        if (injectedStyleElement) {
          injectedStyleElement.remove();
          injectedStyleElement = null;
        }
        
        if (storedCSS && Array.isArray(storedCSS) && storedCSS.length > 0) {
          accumulatedCSS = storedCSS;
          
          // Create and inject new style element
          injectedStyleElement = document.createElement('style');
          injectedStyleElement.setAttribute('data-pagebuddy', 'true');
          injectedStyleElement.textContent = accumulatedCSS.join('\n\n/* --- */\n\n');
          document.head.appendChild(injectedStyleElement);
        } else {
          accumulatedCSS = [];
        }
        
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true; // Will respond asynchronously
  }
  
  return false;
});