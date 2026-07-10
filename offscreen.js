// offscreen document: Translator API 実行係
'use strict';

let translator = null;
let detector = null;
const langTranslators = new Map();

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

// 英語字幕に混ざる外国語セリフ(独語等)を言語判定して該当ペアで訳す
// モデルDLはバックグラウンドで行い、準備中はnull(保留)を返してキューを止めない
const langCreating = new Set();

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function translateSmart(text) {
  try {
    if (typeof LanguageDetector !== 'undefined') {
      if (!detector) detector = await withTimeout(LanguageDetector.create(), 10000);
      const [top] = await detector.detect(text);
      const lang = top?.detectedLanguage;
      if (lang && lang !== 'en' && lang !== 'ja' && top.confidence >= 0.5) {
        if (langTranslators.has(lang)) {
          const lt = langTranslators.get(lang);
          if (lt) return await withTimeout(lt.translate(text), 15000);
        } else {
          if (!langCreating.has(lang)) {
            langCreating.add(lang);
            (async () => {
              try {
                const avail = await Translator.availability({ sourceLanguage: lang, targetLanguage: 'ja' });
                langTranslators.set(lang, avail === 'unavailable' ? null
                  : await Translator.create({ sourceLanguage: lang, targetLanguage: 'ja' }));
              } catch (e) { langTranslators.set(lang, null); }
              langCreating.delete(lang);
            })();
          }
          return null;
        }
      }
    }
  } catch (e) { /* 通常翻訳へ */ }
  return await withTimeout(translator.translate(text), 15000);
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
          try { out.push(await translateSmart(t)); } catch (e) { out.push(null); }
        }
      } else {
        for (const _ of msg.texts || []) out.push(null);
      }
      sendResponse({ results: out });
    })();
    return true;
  }
});
