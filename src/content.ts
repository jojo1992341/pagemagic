let injectedStyleElement: HTMLStyleElement | null = null;
let accumulatedCSS: string[] = [];

// Get URL key for storage (normalize URL by removing hash and query params for consistency)
async function getUrlKey(): Promise<string> {
  const url = new URL(window.location.href);
  
  // Check if domain-wide mode is enabled
  try {
    const result = await chrome.storage.local.get(['pagebuddy_domain_wide']);
    const isDomainWide = result.pagebuddy_domain_wide || false;
    
    if (isDomainWide) {
      return `pagebuddy_css_${url.origin}`;
    } else {
      return `pagebuddy_css_${url.origin}${url.pathname}`;
    }
  } catch (error) {
    console.warn('Failed to check domain-wide setting, defaulting to page-specific:', error);
    return `pagebuddy_css_${url.origin}${url.pathname}`;
  }
}

// Save CSS to storage for this URL
async function saveCSSToStorage() {
  try {
    const urlKey = await getUrlKey();
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
    const urlKey = await getUrlKey();
    const result = await chrome.storage.local.get([urlKey]);
    const storedCSS = result[urlKey];
    
    if (storedCSS && Array.isArray(storedCSS) && storedCSS.length > 0) {
      accumulatedCSS = storedCSS;
      
      // Create style element
      injectedStyleElement = document.createElement('style');
      injectedStyleElement.setAttribute('data-pagebuddy', 'true');
      injectedStyleElement.textContent = accumulatedCSS.join('\n\n/* --- */\n\n');
      
      // Inject as early as possible to prevent flickering
      injectStyleElement();
    }
  } catch (error) {
    console.warn('Failed to load CSS from storage:', error);
  }
}

// Inject style element as early as possible
function injectStyleElement() {
  if (!injectedStyleElement) return;
  
  // If head exists, inject there
  if (document.head) {
    document.head.appendChild(injectedStyleElement);
    return;
  }
  
  // If document.documentElement doesn't exist yet, wait for it
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyleElement();
    });
    return;
  }
  
  // If head doesn't exist yet, wait for it
  const observer = new MutationObserver((mutations, obs) => {
    if (document.head) {
      document.head.appendChild(injectedStyleElement);
      obs.disconnect();
    }
  });
  
  // Start observing
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  
  // Fallback: inject into html element if head takes too long
  setTimeout(() => {
    if (injectedStyleElement && !injectedStyleElement.parentNode) {
      if (document.head) {
        document.head.appendChild(injectedStyleElement);
      } else if (document.documentElement) {
        document.documentElement.insertBefore(injectedStyleElement, document.documentElement.firstChild);
      }
      observer.disconnect();
    }
  }, 100);
}

// Load CSS immediately when script runs (document_start)
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
        
        // Inject into head using our helper function
        injectStyleElement();
        
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
        const urlKey = await getUrlKey();
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
          injectStyleElement();
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