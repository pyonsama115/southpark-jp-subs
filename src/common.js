// 共通ユーティリティ・設定管理
// chrome.* が無い環境(ページ内スモークテスト)でも落ちないようガードする
'use strict';

const SPJS = (() => {
  const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage;

  const DEFAULT_SETTINGS = {
    enabled: true,
    subMode: 'both',        // 'ja' | 'en' | 'both' | 'off'
    learnMode: false,       // 学習モード(英語主役・単語ハイライト)
    autoPause: 'off',       // 'off' | 'all' | 'smart'
    hoverPause: true,       // 字幕ホバーで一時停止
    blurJa: false,          // 日本語をぼかしてホバーで表示
    fontScale: 1,           // 0.85 | 1 | 1.2
    bgOpacity: 0.55,
    aiNaturalTranslation: true, // 導入済みGemini Nanoで文脈・キャラ口調を反映した自然訳へ差し替え
    geminiKey: '',          // 塊・文法解説のクラウドフォールバック用(空=オンデバイスのみ)
  };

  // djb2 ハッシュ(翻訳キャッシュのキー用)
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  const storage = {
    async get(keys) {
      if (hasChrome) return chrome.storage.local.get(keys);
      const out = {};
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        const v = localStorage.getItem('spjs:' + k);
        if (v != null) out[k] = JSON.parse(v);
      }
      return out;
    },
    async set(obj) {
      if (hasChrome) return chrome.storage.local.set(obj);
      for (const [k, v] of Object.entries(obj)) localStorage.setItem('spjs:' + k, JSON.stringify(v));
    },
    onChanged(cb) {
      if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') cb(changes); });
    },
  };

  async function loadSettings() {
    const { settings } = await storage.get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }
  async function saveSettings(s) { await storage.set({ settings: s }); }

  function assetURL(path) {
    if (hasChrome && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
    // スモークテスト用フォールバック(window.__SPJS_TEST_BASE を指定)
    return (window.__SPJS_TEST_BASE || '') + path;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { hasChrome, DEFAULT_SETTINGS, hash, storage, loadSettings, saveSettings, assetURL, el, fmtTime };
})();
