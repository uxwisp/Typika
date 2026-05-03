const activeTabIds = new Set();
const logsEnabledTabIds = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'toggleLogs',
    title: '📋 Включить логи',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: 'toggleAnimSettings',
    title: '🎛 Анимация тултипа',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'toggleAnimSettings') {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleAnimSettings' });
    } catch(e) {}
    return;
  }
  if (info.menuItemId !== 'toggleLogs') return;
  const enabled = !logsEnabledTabIds.has(tab.id);
  if (enabled) {
    logsEnabledTabIds.add(tab.id);
    chrome.contextMenus.update('toggleLogs', { title: '📋 Выключить логи' });
  } else {
    logsEnabledTabIds.delete(tab.id);
    chrome.contextMenus.update('toggleLogs', { title: '📋 Включить логи' });
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'setLogs', enabled });
  } catch(e) {
    if (activeTabIds.has(tab.id)) {
      await injectScripts(tab.id);
      await chrome.tabs.sendMessage(tab.id, { action: 'setLogs', enabled });
    }
  }
});

async function injectScripts(tabId) {
  // Injection order matters: gf-db.js → opentype.min.js → content.js
  await chrome.scripting.executeScript({ target: { tabId }, files: ['gf-db.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['opentype.min.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const isActive = activeTabIds.has(tab.id);
  try {
    if (!isActive) {
      await injectScripts(tab.id);
      if (logsEnabledTabIds.has(tab.id)) {
        await chrome.tabs.sendMessage(tab.id, { action: 'setLogs', enabled: true });
      }
      activeTabIds.add(tab.id);
      chrome.action.setIcon({ tabId: tab.id, path: { 16: 'icons/icon16_on.png', 48: 'icons/icon48_on.png', 128: 'icons/icon128_on.png' } });
      chrome.action.setTitle({ tabId: tab.id, title: 'Font Inspector — ON (click to deactivate)' });
    } else {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__fontInspectorDestroy?.(); } });
      activeTabIds.delete(tab.id);
      chrome.action.setIcon({ tabId: tab.id, path: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } });
      chrome.action.setTitle({ tabId: tab.id, title: 'Font Inspector — click to activate' });
    }
  } catch(e) { console.error('Font Inspector:', e); }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'searchFont' && msg.font) {
    chrome.search.query({ text: msg.font + ' font', disposition: 'NEW_TAB' });
  }
  if (msg.action === 'openUrl' && msg.url) {
    chrome.tabs.create({ url: msg.url });
  }
  if (msg.action === 'inspectorOff') {
    // Called when user presses Escape — update icon/title
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      activeTabIds.delete(tabId);
      chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } }).catch(() => {});
      chrome.action.setTitle({ tabId, title: 'Font Inspector — click to activate' }).catch(() => {});
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => { activeTabIds.delete(tabId); logsEnabledTabIds.delete(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    activeTabIds.delete(tabId);
    chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } }).catch(() => {});
  }
});
