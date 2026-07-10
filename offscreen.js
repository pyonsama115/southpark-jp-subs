// offscreen document: Translator API 実行係
'use strict';

let translator = null;

async function ensure() {
  if (translator) return true;
  if (typeof Translator === 'undefined') return false;
  try {
    translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja' });
    return true;
  } catch (e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type?.startsWith('spjs-off-')) return;
  if (msg.type === 'spjs-off-availability') {
    (async () => {
      try {
        if (typeof Translator === 'undefined') return sendResponse({ availability: 'unavailable' });
        const a = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' });
        sendResponse({ availability: a });
      } catch (e) { sendResponse({ availability: 'unavailable' }); }
    })();
    return true;
  }
  if (msg.type === 'spjs-off-ensure') {
    ensure().then(ok => sendResponse({ ok }));
    return true;
  }
  if (msg.type === 'spjs-off-translate') {
    (async () => {
      const out = [];
      if (await ensure()) {
        for (const t of msg.texts || []) {
          try { out.push(await translator.translate(t)); } catch (e) { out.push(null); }
        }
      } else {
        for (const _ of msg.texts || []) out.push(null);
      }
      sendResponse({ results: out });
    })();
    return true;
  }
});
