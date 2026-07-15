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
  // 重要: 言語ペアのモデルDLをキュー内でawaitすると翻訳全体が詰まるため、
  // 準備はバックグラウンドで行い、準備中のセリフはnull(保留→次バッチで再試行)を返す。
  let detector = null;
  const langTranslators = new Map(); // lang -> Translator|null(null=作成失敗)
  const langCreating = new Set();
  let offscreenRequestSeq = 0;

  function abortError() {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function linkedController(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const relay = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) relay();
    else externalSignal?.addEventListener?.('abort', relay, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    return {
      signal: controller.signal,
      dispose() {
        clearTimeout(timer);
        externalSignal?.removeEventListener?.('abort', relay);
      },
    };
  }

  async function runAbortable(factory, externalSignal, timeoutMs) {
    const linked = linkedController(externalSignal, timeoutMs);
    try { return await factory(linked.signal); }
    finally { linked.dispose(); }
  }

  function waitForSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(abortError()); };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(
        value => { cleanup(); resolve(value); },
        error => { cleanup(); reject(error); },
      );
    });
  }

  function hasJapanese(value) {
    return /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶ]/.test(String(value || ''));
  }

  function isLanguageNeutral(value) {
    const text = String(value || '').trim();
    return !!text && (!/[A-Za-z]/.test(text) ||
      /^(?:OK|O\.K\.|TV|PC|DVD|DNA|FBI|CIA|NBA|NFL|WWE|U\.?S\.?A\.?)[!?…。]*$/i.test(text));
  }

  async function translateDetectedForeign(text, signal) {
    if (typeof LanguageDetector === 'undefined') return { handled: false };
    if (!detector) {
      detector = await runAbortable(
        linkedSignal => LanguageDetector.create({ signal: linkedSignal }), signal, 10000,
      );
    }
    const [top] = await runAbortable(
      linkedSignal => detector.detect(text, { signal: linkedSignal }), signal, 5000,
    );
    const lang = top?.detectedLanguage;
    if (!lang || lang === 'en' || lang === 'ja' || top.confidence < 0.5) return { handled: false };
    if (langTranslators.has(lang)) {
      const lt = langTranslators.get(lang);
      return lt
        ? {
            handled: true,
            value: await runAbortable(
              linkedSignal => lt.translate(text, { signal: linkedSignal }), signal, 15000,
            ),
          }
        : { handled: false };
    }
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
    return { handled: true, value: null }; // 外国語モデル準備中はこのcueだけ保留
  }

  async function translateSmart(text, signal) {
    let primary = null;
    let primaryError = null;
    try {
      primary = await runAbortable(
        linkedSignal => translator.translate(text, { signal: linkedSignal }), signal, 15000,
      );
    }
    catch (e) { primaryError = e; }
    if (signal?.aborted) throw primaryError || abortError();
    if (primaryError) throw primaryError;
    // 通常の英語字幕は言語判定を待たず、この最速経路で完了する。
    if (hasJapanese(primary)) return primary;
    try {
      const foreign = await translateDetectedForeign(text, signal);
      if (foreign.handled) return foreign.value;
    } catch (e) { /* 判定失敗時はen→jaの結果を使う */ }
    return isLanguageNeutral(primary) ? primary : null;
  }

  // texts: string[] -> ja string[](失敗した要素は null)
  async function translateOffscreen(texts, signal) {
    const requestId = `${Date.now()}-${++offscreenRequestSeq}-${Math.random().toString(36).slice(2)}`;
    const request = chrome.runtime.sendMessage({ type: 'spjs-translate', texts, requestId });
    if (!signal) return request;
    const cancel = () => {
      chrome.runtime.sendMessage({ type: 'spjs-cancel-translate', requestId }).catch(() => {});
    };
    if (signal.aborted) { cancel(); throw abortError(); }
    signal.addEventListener('abort', cancel, { once: true });
    try { return await waitForSignal(request, signal); }
    finally { signal.removeEventListener('abort', cancel); }
  }

  async function translateBatch(texts, signal = null) {
    let m;
    try { m = await waitForSignal(ensure(), signal); }
    catch (e) { return texts.map(() => null); }
    if (m === 'local') {
      const out = [];
      for (const t of texts) {
        if (signal?.aborted) { out.push(null); continue; }
        try { out.push(await translateSmart(t, signal)); }
        catch (e) { out.push(null); }
      }
      return out;
    }
    if (m === 'offscreen') {
      try {
        const r = await translateOffscreen(texts, signal);
        return r?.results || texts.map(() => null);
      } catch (e) { return texts.map(() => null); }
    }
    return texts.map(() => null);
  }

  function getMode() { return mode; }

  return { availability, ensure, translateBatch, getMode };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SPJS_TR;
