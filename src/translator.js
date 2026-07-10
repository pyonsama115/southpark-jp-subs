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

  // 英語以外のセリフ(独語等が英語字幕にそのまま入っていることがある)用
  let detector = null;
  const langTranslators = new Map(); // lang -> Translator|null
  async function translateSmart(text) {
    // 言語判定して英語以外なら該当ペアの翻訳器で訳す
    try {
      if (typeof LanguageDetector !== 'undefined') {
        if (!detector) detector = await LanguageDetector.create();
        const [top] = await detector.detect(text);
        const lang = top?.detectedLanguage;
        if (lang && lang !== 'en' && lang !== 'ja' && top.confidence >= 0.5) {
          if (!langTranslators.has(lang)) {
            try {
              const avail = await Translator.availability({ sourceLanguage: lang, targetLanguage: 'ja' });
              langTranslators.set(lang, avail === 'unavailable' ? null
                : await Translator.create({ sourceLanguage: lang, targetLanguage: 'ja' }));
            } catch (e) { langTranslators.set(lang, null); }
          }
          const lt = langTranslators.get(lang);
          if (lt) return await lt.translate(text);
        }
      }
    } catch (e) { /* 判定失敗時は通常翻訳へ */ }
    return await translator.translate(text);
  }

  // texts: string[] -> ja string[](失敗した要素は null)
  async function translateBatch(texts) {
    const m = await ensure();
    if (m === 'local') {
      const out = [];
      for (const t of texts) {
        try { out.push(await translateSmart(t)); }
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
