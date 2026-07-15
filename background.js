// content script 内で Translator API が使えない場合の offscreen フォールバック中継
'use strict';

let offscreenReady = null;

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const has = await chrome.offscreen.hasDocument?.();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: 'オンデバイス翻訳(Translator API)の実行',
      });
    }
    return true;
  })();
  return offscreenReady;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type?.startsWith('spjs-')) return;
  if (msg.type === 'spjs-availability') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ type: 'spjs-off-availability' }))
      .then(sendResponse)
      .catch(() => sendResponse({ availability: 'unavailable' }));
    return true;
  }
  if (msg.type === 'spjs-ensure') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ type: 'spjs-off-ensure' }))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'spjs-translate') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({
        type: 'spjs-off-translate', texts: msg.texts, requestId: msg.requestId,
      }))
      .then(sendResponse)
      .catch(() => sendResponse({ results: (msg.texts || []).map(() => null) }));
    return true;
  }
  if (msg.type === 'spjs-cancel-translate') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({
        type: 'spjs-off-cancel-translate', requestId: msg.requestId,
      }))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
