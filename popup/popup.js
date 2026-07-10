'use strict';

const DEFAULTS = {
  enabled: true, subMode: 'both', learnMode: false, autoPause: 'off',
  hoverPause: true, blurJa: false, fontScale: 1, bgOpacity: 0.55,
};
let settings = { ...DEFAULTS };

const $ = (s) => document.querySelector(s);

async function load() {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = Object.assign({}, DEFAULTS, s || {});
  bind();
  render();
  refreshModelStatus();
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

  // セグメント選択
  for (const [id, key, cast] of [['#subMode', 'subMode', String], ['#autoPause', 'autoPause', String], ['#fontScale', 'fontScale', Number]]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = cast(b.dataset.v);
      save(); render();
    });
  }
  // チェックボックス
  for (const key of ['enabled', 'learnMode', 'hoverPause', 'blurJa']) {
    $('#' + key).addEventListener('change', (e) => { settings[key] = e.target.checked; save(); });
  }
  $('#bgOpacity').addEventListener('input', (e) => { settings.bgOpacity = Number(e.target.value); save(); });

  $('#downloadModel').addEventListener('click', downloadModel);
  $('#wbExport').addEventListener('click', exportCSV);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.trProgress) refreshTrProgress();
    if (ch.wordbook) renderWordbook();
  });
}

function render() {
  for (const key of ['enabled', 'learnMode', 'hoverPause', 'blurJa']) $('#' + key).checked = !!settings[key];
  $('#bgOpacity').value = settings.bgOpacity;
  for (const [id, key] of [['#subMode', 'subMode'], ['#autoPause', 'autoPause'], ['#fontScale', 'fontScale']]) {
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

async function refreshTrProgress() {
  const { trProgress } = await chrome.storage.local.get('trProgress');
  const elp = $('#trProgress');
  if (trProgress && trProgress.total && Date.now() - trProgress.at < 300000) {
    elp.textContent = `このエピソード: ${trProgress.done}/${trProgress.total} セリフ翻訳済み`;
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
