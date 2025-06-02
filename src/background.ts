chrome.runtime.onInstalled.addListener(() => {
  console.log('Page Magic extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Page Magic action clicked on tab:', tab.id);
});