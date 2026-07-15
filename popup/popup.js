'use strict';

const DEFAULTS = {
  enabled: true, subMode: 'both', learnMode: false, autoPause: 'off',
  hoverPause: true, blurJa: false, fontScale: 1, bgOpacity: 0.55,
  aiNaturalTranslation: true,
};
let settings = { ...DEFAULTS };

const $ = (s) => document.querySelector(s);

async function load() {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = Object.assign({}, DEFAULTS, s || {});
  bind();
  render();
  refreshModelStatus();
  refreshAiModelStatus();
  refreshTrProgress();
  renderWordbook();
}

function save() { chrome.storage.local.set({ settings }); }

function bind() {
  // タブ
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  }));

  // モード(学習/日本語/英語/オフの一本化)
  $('#viewMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const m = b.dataset.v;
    settings.learnMode = m === 'learn';
    settings.subMode = m === 'learn' ? 'both' : m;
    save(); render();
  });
  // セグメント選択
  for (const [id, key, cast] of [['#autoPause', 'autoPause', String], ['#fontScale', 'fontScale', Number]]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = cast(b.dataset.v);
      save(); render();
    });
  }
  // チェックボックス
  for (const key of ['enabled', 'hoverPause', 'blurJa', 'aiNaturalTranslation']) {
    $('#' + key).addEventListener('change', (e) => { settings[key] = e.target.checked; save(); });
  }
  $('#bgOpacity').addEventListener('input', (e) => { settings.bgOpacity = Number(e.target.value); save(); });
  $('#geminiKey').addEventListener('change', (e) => { settings.geminiKey = e.target.value.trim(); save(); });

  $('#downloadModel').addEventListener('click', downloadModel);
  $('#prepareAiModel').addEventListener('click', prepareAiModel);
  $('#wbExport').addEventListener('click', exportCSV);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.trProgress) refreshTrProgress();
    if (ch.wordbook) renderWordbook();
  });
}

function render() {
  for (const key of ['enabled', 'hoverPause', 'blurJa', 'aiNaturalTranslation']) $('#' + key).checked = !!settings[key];
  $('#bgOpacity').value = settings.bgOpacity;
  $('#geminiKey').value = settings.geminiKey || '';
  const mode = settings.learnMode ? 'learn' : (settings.subMode === 'both' ? 'ja' : settings.subMode);
  document.querySelectorAll('#viewMode button').forEach(b => b.classList.toggle('on', mode === b.dataset.v));
  for (const [id, key] of [['#autoPause', 'autoPause'], ['#fontScale', 'fontScale']]) {
    document.querySelectorAll(id + ' button').forEach(b =>
      b.classList.toggle('on', String(settings[key]) === b.dataset.v));
  }
}

// ---------- 翻訳モデル ----------
async function refreshModelStatus() {
  const st = $('#modelStatus'), btn = $('#downloadModel');
  if (typeof Translator === 'undefined') {
    st.textContent = '⚠ このChromeは内蔵翻訳API非対応(138+が必要)';
    return;
  }
  try {
    const a = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' });
    if (a === 'available') { st.textContent = '✓ 翻訳モデル導入済み(英→日)'; btn.classList.add('hidden'); }
    else if (a === 'downloadable') { st.textContent = '翻訳モデル未導入'; btn.classList.remove('hidden'); }
    else if (a === 'downloading') { st.textContent = 'ダウンロード中…'; }
    else { st.textContent = '⚠ この環境では利用不可'; }
  } catch (e) {
    st.textContent = '⚠ 状態取得エラー: ' + e.message;
  }
}

async function downloadModel() {
  const st = $('#modelStatus'), btn = $('#downloadModel'), bar = $('#dlProgress');
  btn.classList.add('hidden');
  bar.classList.remove('hidden');
  st.textContent = 'ダウンロード中…';
  try {
    await Translator.create({
      sourceLanguage: 'en', targetLanguage: 'ja',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => { bar.value = e.loaded; });
      },
    });
    bar.classList.add('hidden');
    st.textContent = '✓ 翻訳モデル導入済み(英→日)';
  } catch (e) {
    bar.classList.add('hidden');
    st.textContent = '⚠ ダウンロード失敗: ' + e.message;
    btn.classList.remove('hidden');
  }
}

// ---------- AI自然訳モデル(LanguageModel / Gemini Nano) ----------
const AI_CAPABILITY_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en', 'ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
};

async function refreshAiModelStatus() {
  const st = $('#aiModelStatus'), btn = $('#prepareAiModel');
  if (typeof LanguageModel === 'undefined') {
    st.textContent = '⚠ AI自然訳はこのChromeで利用できません';
    btn.classList.add('hidden');
    return;
  }
  try {
    const a = await LanguageModel.availability(AI_CAPABILITY_OPTIONS);
    if (a === 'available') {
      st.textContent = '✓ 解説用AIを自然訳にも利用できます';
      btn.classList.add('hidden');
    } else if (a === 'downloadable') {
      st.textContent = 'AIモデル未準備';
      btn.classList.remove('hidden');
    } else if (a === 'downloading') {
      st.textContent = 'AIモデルをダウンロード中…';
      btn.classList.add('hidden');
    } else {
      st.textContent = '⚠ 日本語AI自然訳は利用できません';
      btn.classList.add('hidden');
    }
  } catch (e) {
    st.textContent = '⚠ AI状態取得エラー: ' + e.message;
    btn.classList.add('hidden');
  }
}

async function prepareAiModel() {
  const st = $('#aiModelStatus'), btn = $('#prepareAiModel'), bar = $('#aiDlProgress');
  btn.classList.add('hidden');
  bar.classList.remove('hidden');
  st.textContent = 'AIモデルを準備中…';
  let session = null;
  try {
    session = await LanguageModel.create({
      ...AI_CAPABILITY_OPTIONS,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => { bar.value = e.loaded; });
      },
    });
    st.textContent = '✓ 解説用AIを自然訳にも利用できます';
  } catch (e) {
    st.textContent = '⚠ AIモデル準備失敗: ' + e.message;
    btn.classList.remove('hidden');
  } finally {
    try { session?.destroy?.(); } catch (e) { /* best effort */ }
    bar.classList.add('hidden');
  }
}

async function refreshTrProgress() {
  const { trProgress } = await chrome.storage.local.get('trProgress');
  const elp = $('#trProgress');
  if (trProgress && trProgress.total && Date.now() - trProgress.at < 300000) {
    const ai = trProgress.aiEnabled
      ? ` / AI自然訳 ${trProgress.aiDone || 0}/${trProgress.total}` : '';
    elp.textContent = `このエピソード: 基本訳 ${trProgress.done}/${trProgress.total}${ai}`;
  } else {
    elp.textContent = '';
  }
}

// ---------- 単語帳 ----------
async function renderWordbook() {
  const { wordbook } = await chrome.storage.local.get('wordbook');
  const wb = wordbook || {};
  const rows = Object.values(wb).sort((a, b) => (b.at || 0) - (a.at || 0));
  $('#wbCount').textContent = `${rows.length} 語`;
  const list = $('#wbList');
  list.textContent = '';
  for (const r of rows.slice(0, 300)) {
    const d = document.createElement('div');
    d.className = 'wb-row';
    d.innerHTML = `
      <span class="wb-count">${r.count}回</span>
      <span class="wb-w"></span><span class="wb-kana"></span>
      <div class="wb-m"></div>
      <div class="wb-ctx"></div>`;
    d.querySelector('.wb-w').textContent = r.word;
    d.querySelector('.wb-kana').textContent = r.kana || '';
    d.querySelector('.wb-m').textContent = r.meaning || '';
    d.querySelector('.wb-ctx').textContent = r.context || '';
    list.append(d);
  }
}

async function exportCSV() {
  const { wordbook } = await chrome.storage.local.get('wordbook');
  const rows = Object.values(wordbook || {});
  const esc = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
  const csv = ['word,kana,meaning,context,count,episode']
    .concat(rows.map(r => [r.word, r.kana, r.meaning, r.context, r.count, r.ep].map(esc).join(',')))
    .join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'southpark-wordbook.csv';
  a.click();
  URL.revokeObjectURL(url);
}

load();
