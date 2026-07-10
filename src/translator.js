// 翻訳レイヤ: Chrome内蔵 Translator API(en→ja)
// content script 内で直接使えない場合は background(offscreen)へ委譲する。
// 将来 DeepL 等へ差し替える場合はこのファイルの translateBatch だけ入れ替える。
'use strict';

const SPJS_TR = (() => {
  let translator = null;
  let creating = null;
  let mode = null; // 'local' | 'offscreen' | 'unavailable'

  async function availability() {
    try {
      if (typeof Translator !== 'undefined') {
        return await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' });
      }
    } catch (e) { /* fallthrough */ }
    if (SPJS.hasChrome && chrome.runtime?.sendMessage) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'spjs-availability' });
        return r?.availability ?? 'unavailable';
      } catch (e) { return 'unavailable'; }
    }
    return 'unavailable';
  }

  async function ensure() {
    if (translator || mode === 'offscreen') return mode;
    if (creating) return creating;
    creating = (async () => {
      if (typeof Translator !== 'undefined') {
        try {
          const avail = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' });
          if (avail === 'available' || avail === 'downloadable' || avail === 'downloading') {
            translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja' });
            mode = 'local';
            return mode;
          }
        } catch (e) {
          console.warn('[SPJS] page Translator unavailable, falling back to offscreen:', e.message);
        }
      }
      if (SPJS.hasChrome && chrome.runtime?.sendMessage) {
        try {
          const r = await chrome.runtime.sendMessage({ type: 'spjs-ensure' });
          if (r?.ok) { mode = 'offscreen'; return mode; }
        } catch (e) { /* fallthrough */ }
      }
      mode = 'unavailable';
      return mode;
    })();
    const m = await creating;
    creating = null;
    return m;
  }

  // texts: string[] -> ja string[](失敗した要素は null)
  async function translateBatch(texts) {
    const m = await ensure();
    if (m === 'local') {
      const out = [];
      for (const t of texts) {
        try { out.push(await translator.translate(t)); }
        catch (e) { out.push(null); }
      }
      return out;
    }
    if (m === 'offscreen') {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'spjs-translate', texts });
        return r?.results || texts.map(() => null);
      } catch (e) { return texts.map(() => null); }
    }
    return texts.map(() => null);
  }

  function getMode() { return mode; }

  return { availability, ensure, translateBatch, getMode };
})();
