// offscreen document: Translator API 実行係
'use strict';

let translator = null;
let detector = null;
const langTranslators = new Map();
const translationControllers = new Map();
const canceledRequests = new Set();

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
  return { handled: true, value: null };
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
  if (signal?.aborted) throw primaryError || new DOMException('Aborted', 'AbortError');
  if (primaryError) throw primaryError;
  if (hasJapanese(primary)) return primary;
  try {
    const foreign = await translateDetectedForeign(text, signal);
    if (foreign.handled) return foreign.value;
  } catch (e) { /* 判定失敗時はen→jaの結果を使う */ }
  return isLanguageNeutral(primary) ? primary : null;
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
      const requestId = String(msg.requestId || 'legacy');
      if (canceledRequests.delete(requestId)) {
        return sendResponse({ results: (msg.texts || []).map(() => null) });
      }
      const controller = new AbortController();
      translationControllers.set(requestId, controller);
      if (await ensure() && !controller.signal.aborted) {
        for (const t of msg.texts || []) {
          if (controller.signal.aborted) out.push(null);
          else try { out.push(await translateSmart(t, controller.signal)); } catch (e) { out.push(null); }
        }
      } else {
        for (const _ of msg.texts || []) out.push(null);
      }
      translationControllers.delete(requestId);
      sendResponse({ results: out });
    })();
    return true;
  }
  if (msg.type === 'spjs-off-cancel-translate') {
    const requestId = String(msg.requestId || '');
    canceledRequests.add(requestId);
    translationControllers.get(requestId)?.abort();
    setTimeout(() => canceledRequests.delete(requestId), 60000);
    sendResponse({ ok: true });
    return;
  }
});
