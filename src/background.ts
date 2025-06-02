chrome.runtime.onInstalled.addListener(() => {
  console.log('Page Buddy extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Page Buddy action clicked on tab:', tab.id);
});