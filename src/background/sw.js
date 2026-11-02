import { refreshDictionary } from '../lib/dictionaryStore.js';

const ALARM = 'dict';
const refresh = () => refreshDictionary(chrome.storage.local, (url) => fetch(url, { cache: 'no-cache' }), Date.now());

function ensureAlarm() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1440 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refresh();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refreshDictionary') {
    refresh().then(sendResponse, () => sendResponse('failed'));
    return true;
  }
});
