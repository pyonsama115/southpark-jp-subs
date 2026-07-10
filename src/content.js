// South Park 日本語字幕 - メインコンテンツスクリプト
// 字幕cue収集 → オンデバイス翻訳 → オーバーレイ描画 + 学習モード
'use strict';

(() => {
  if (window.__spjsLoaded) return;
  window.__spjsLoaded = true;

  const { el, hash, fmtTime } = SPJS;

  // ---------- 状態 ----------
  let settings = SPJS.DEFAULT_SETTINGS;
  let video = null;
  let track = null;
  let container = null;
  let ui = null;               // オーバーレイDOM一式
  let cues = new Map();        // key -> {key,start,end,en,ja}
  let cueList = [];            // start順
  let cache = {};              // hash(en) -> ja (エピソード単位)
  let epId = null;
  let knownWords = new Set();
  let wordbook = {};
  let cacheDirty = false;
  let trRunning = false;
  let lastActiveKey = null;
  let pausedByHover = false;
  let autoPausedKey = null;
  let hoverTimer = null;
  let currentHref = location.href;

  const EPS = 0.04;

  // ---------- 初期化 ----------
  async function init() {
    settings = await SPJS.loadSettings();
    const kw = await SPJS.storage.get(['knownWords', 'wordbook']);
    knownWords = new Set(kw.knownWords || []);
    wordbook = kw.wordbook || {};

    SPJS.storage.onChanged((changes) => {
      if (changes.settings) { settings = Object.assign({}, SPJS.DEFAULT_SETTINGS, changes.settings.newValue); applySettings(); }
      if (changes.knownWords) knownWords = new Set(changes.knownWords.newValue || []);
    });

    setInterval(tick, 800);
    document.addEventListener('keydown', onKey, true);
  }

  function currentEpId() {
    const m = location.pathname.match(/\/episodes\/([^/]+)/);
    return m ? m[1] : null;
  }

  // 常駐ループ: SPA遷移検知 + video/track発見 + cue収集
  function tick() {
    if (location.href !== currentHref) {
      currentHref = location.href;
      reset();
    }
    const v = document.querySelector('video');
    if (v !== video) {
      video = v;
      if (video) attach();
    }
    if (!video) return;
    ensureTrack();
    collectCues();
    scheduleTranslate();
  }

  function reset() {
    flushCache();
    cues = new Map(); cueList = []; cache = {}; lastActiveKey = null; autoPausedKey = null;
    epId = null; track = null;
    if (ui) { ui.root.remove(); ui = null; }
    video = null;
  }

  // ---------- トラック制御 ----------
  function ensureTrack() {
    if (!video) return;
    let best = null;
    for (const t of video.textTracks) {
      if (t.kind === 'subtitles' || t.kind === 'captions') { best = t; break; }
    }
    if (!best) return;
    if (track !== best) {
      track = best;
      track.addEventListener('cuechange', () => renderNow());
    }
    // サイト側が showing に戻すので hidden を強制維持(ロードは継続される)
    const want = settings.enabled ? 'hidden' : 'disabled';
    if (track.mode !== want) track.mode = want;
  }

  // ---------- cue収集 ----------
  async function collectCues() {
    if (!track || !track.cues || !settings.enabled) return;
    if (!epId) {
      epId = currentEpId() || 'unknown';
      const st = await SPJS.storage.get('tr:' + epId);
      cache = st['tr:' + epId] || {};
      for (const c of cues.values()) if (!c.ja && cache[c.h]) c.ja = cache[c.h];
    }
    let added = false;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      // WebVTTの装飾タグ(<i> <b> <c.class> 等)と実体参照を除去
      const text = (c.text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .trim();
      if (!text) continue;
      const key = c.startTime.toFixed(2) + '|' + hash(text);
      if (cues.has(key)) continue;
      const h = hash(text);
      cues.set(key, { key, start: c.startTime, end: c.endTime, en: text, h, ja: cache[h] || null });
      added = true;
    }
    if (added) {
      cueList = [...cues.values()].sort((a, b) => a.start - b.start);
      reportProgress();
    }
  }

  // ---------- 翻訳 ----------
  function scheduleTranslate() {
    if (trRunning || !settings.enabled) return;
    const pending = cueList.filter(c => !c.ja);
    if (!pending.length) return;
    trRunning = true;
    (async () => {
      try {
        // 再生位置に近い順に優先
        const t0 = video ? video.currentTime : 0;
        pending.sort((a, b) => Math.abs(a.start - t0) - Math.abs(b.start - t0));
        const batch = pending.slice(0, 12);
        const texts = batch.map(c => c.en.replace(/\s*\n\s*/g, ' '));
        const results = await SPJS_TR.translateBatch(texts);
        let ok = false;
        results.forEach((ja, i) => {
          if (ja) { batch[i].ja = ja; cache[batch[i].h] = ja; ok = true; }
        });
        if (ok) { cacheDirty = true; flushCacheSoon(); reportProgress(); renderNow(); }
        else if (SPJS_TR.getMode() === 'unavailable') toastOnce('tr-unavail', '翻訳モデル未導入。拡張アイコン → モデルをダウンロード してください');
      } finally {
        trRunning = false;
      }
    })();
  }

  let flushTimer = null;
  function flushCacheSoon() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushCache, 3000);
  }
  function flushCache() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!cacheDirty || !epId) return;
    cacheDirty = false;
    SPJS.storage.set({ ['tr:' + epId]: cache });
  }

  function reportProgress() {
    const total = cueList.length, done = cueList.filter(c => c.ja).length;
    SPJS.storage.set({ trProgress: { ep: epId, total, done, at: Date.now() } });
  }

  // ---------- オーバーレイUI ----------
  function attach() {
    const parent = video.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    container = parent;

    const root = el('div', 'spjs-root');
    const subWrap = el('div', 'spjs-subwrap');
    const subBox = el('div', 'spjs-subbox');
    const enLine = el('div', 'spjs-en');
    const jaLine = el('div', 'spjs-ja');
    subBox.append(enLine, jaLine);
    subWrap.append(subBox);

    const chip = buildChip();
    const dictPop = el('div', 'spjs-dictpop spjs-hidden');
    const drawer = el('div', 'spjs-drawer spjs-hidden');
    const cheat = buildCheatsheet();
    const toast = el('div', 'spjs-toast spjs-hidden');

    root.append(subWrap, chip, dictPop, drawer, cheat, toast);
    container.append(root);
    ui = { root, subWrap, subBox, enLine, jaLine, chip, dictPop, drawer, cheat, toast, drawerBuiltCount: 0 };

    video.addEventListener('timeupdate', renderNow);
    video.addEventListener('seeked', () => { autoPausedKey = null; renderNow(); });
    new ResizeObserver(applyFontSize).observe(video);
    applyFontSize();
    applySettings();

    // 字幕ホバーで一時停止
    subBox.addEventListener('mouseenter', () => {
      if (!settings.hoverPause || !video || video.paused) return;
      video.pause(); pausedByHover = true;
    });
    subBox.addEventListener('mouseleave', () => {
      hideDictSoon();
      if (pausedByHover && video) { video.play(); pausedByHover = false; }
    });

    // 単語ホバー辞書(イベント委譲)
    subBox.addEventListener('mouseover', (e) => {
      const w = e.target.closest('.spjs-w');
      if (!w) return;
      clearTimeout(hoverTimer);
      clearTimeout(ui.hideTimer); // 直前の単語のmouseoutによる「閉じる」予約を取り消す
      hoverTimer = setTimeout(() => showDict(w), 120);
    });
    subBox.addEventListener('mouseout', (e) => {
      if (e.target.closest('.spjs-w')) { clearTimeout(hoverTimer); hideDictSoon(); }
    });
    subBox.addEventListener('click', (e) => {
      const w = e.target.closest('.spjs-w');
      if (w) toggleKnown(w.dataset.w);
    });
    ui.dictPop.addEventListener('mouseenter', () => clearTimeout(ui.hideTimer));
    ui.dictPop.addEventListener('mouseleave', hideDictSoon);

    // コントロールチップ: プレーヤー上にマウスがある間は常時表示
    // (サイトUIのレイヤにmousemoveを食われるためdocumentレベルで判定)
    document.addEventListener('mousemove', (e) => {
      if (!ui || !container.isConnected) return;
      const r = container.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      ui.chip.classList.toggle('spjs-show', inside);
    }, { passive: true });

    firstRunHint();
  }

  function applyFontSize() {
    if (!ui || !video) return;
    const base = Math.min(42, Math.max(14, video.clientWidth * 0.021)) * settings.fontScale;
    ui.root.style.setProperty('--spjs-fs', base + 'px');
    if (ui.root.classList.contains('spjs-drawer-open')) applyDrawerLayout(true); // リサイズ追従
  }

  function applySettings() {
    if (!ui) return;
    ui.root.classList.toggle('spjs-learn', settings.learnMode);
    ui.root.classList.toggle('spjs-blurja', settings.blurJa);
    ui.root.style.setProperty('--spjs-bg', `rgba(0,0,0,${settings.bgOpacity})`);
    applyFontSize();
    updateChip();
    renderNow(true);
    if (settings.learnMode) SPJS_DICT.load().then(() => renderNow(true));
    if (track) track.mode = settings.enabled ? 'hidden' : 'disabled';
  }

  // ---------- 描画 ----------
  function activeCue(t) {
    // cueListはstart順。範囲内の最後(=最新)を返す
    let found = null;
    for (const c of cueList) {
      if (c.start - EPS <= t && t < c.end + EPS) found = c;
      if (c.start > t) break;
    }
    return found;
  }

  let renderedKey = '';
  function renderNow(force) {
    if (!ui || !video) return;
    const t = video.currentTime;
    const cue = settings.enabled && settings.subMode !== 'off' ? activeCue(t) : null;

    handleAutoPause(cue, t);
    updateDrawerHighlight(cue);

    const stateKey = cue ? cue.key + '|' + (cue.ja ? 1 : 0) + '|' + settings.subMode + settings.learnMode : 'none';
    if (!force && stateKey === renderedKey) return;
    // cue切替でポップアップを閉じる(ただし読んでいる最中=ホバー中は残す)
    if (stateKey !== renderedKey && !ui.dictPop.matches(':hover') && !ui.subBox.matches(':hover')) {
      ui.dictPop.classList.add('spjs-hidden');
    }
    renderedKey = stateKey;

    if (!cue) { ui.subBox.classList.add('spjs-hidden'); return; }
    ui.subBox.classList.remove('spjs-hidden');

    const showEn = settings.subMode === 'en' || settings.subMode === 'both';
    const showJa = settings.subMode === 'ja' || settings.subMode === 'both';

    ui.enLine.classList.toggle('spjs-hidden', !showEn);
    ui.jaLine.classList.toggle('spjs-hidden', !showJa);

    if (showEn) renderEnLine(cue);
    if (showJa) ui.jaLine.textContent = cue.ja || (cue.en ? '(翻訳中…)' : '');
    if (showJa && !cue.ja) ui.jaLine.classList.add('spjs-pending'); else ui.jaLine.classList.remove('spjs-pending');
  }

  function renderEnLine(cue) {
    ui.enLine.textContent = '';
    for (const rawLine of cue.en.split('\n')) {
      const lineEl = el('span', 'spjs-enline');
      const parts = rawLine.split(/([A-Za-z][A-Za-z']*)/);
      parts.forEach((p, i) => {
        if (i % 2 === 1) {
          const w = el('span', 'spjs-w', p);
          w.dataset.w = p;
          if (settings.learnMode && SPJS_DICT.isLoaded()) {
            const lower = p.toLowerCase();
            if (!knownWords.has(lower) && !SPJS_DICT.isBasic(p)) w.classList.add('spjs-unknown');
          }
          lineEl.append(w);
        } else if (p) {
          lineEl.append(document.createTextNode(p));
        }
      });
      ui.enLine.append(lineEl);
    }
  }

  // ---------- オートポーズ ----------
  function handleAutoPause(cue, t) {
    const curKey = cue ? cue.key : null;
    if (curKey !== lastActiveKey) {
      const prev = lastActiveKey ? cues.get(lastActiveKey) : null;
      lastActiveKey = curKey;
      if (prev && settings.autoPause !== 'off' && !video.paused &&
          t >= prev.end - 0.3 && t <= prev.end + 1.2 && autoPausedKey !== prev.key) {
        const should = settings.autoPause === 'all' || (settings.autoPause === 'smart' && hasUnknownWord(prev));
        if (should) {
          autoPausedKey = prev.key;
          video.pause();
          toast('⏸ オートポーズ(Dで次へ / ←でリプレイ)');
        }
      }
    }
  }

  function hasUnknownWord(cue) {
    if (!SPJS_DICT.isLoaded()) return false;
    for (const m of cue.en.matchAll(/[A-Za-z][A-Za-z']*/g)) {
      const w = m[0];
      if (!knownWords.has(w.toLowerCase()) && !SPJS_DICT.isBasic(w)) return true;
    }
    return false;
  }

  // ---------- 辞書ポップアップ ----------
  async function showDict(wordEl) {
    await SPJS_DICT.load();
    if (!wordEl.isConnected) return; // cueが切り替わって単語が消えた後は出さない
    clearTimeout(ui.hideTimer);     // 表示中に古い「閉じる」予約が発火しないように
    const word = wordEl.dataset.w;
    const info = SPJS_DICT.lookup(word);
    const pop = ui.dictPop;
    pop.textContent = '';

    const head = el('div', 'spjs-dp-head');
    head.append(el('span', 'spjs-dp-word', word.toLowerCase()));
    if (info?.band === 'basic') head.append(el('span', 'spjs-dp-badge spjs-dp-basic', '基礎'));
    else if (info?.band === 'common') head.append(el('span', 'spjs-dp-badge spjs-dp-common', '頻出'));
    if (knownWords.has(word.toLowerCase())) head.append(el('span', 'spjs-dp-badge spjs-dp-known', '既知'));
    pop.append(head);

    if (info?.kana) {
      const pr = el('div', 'spjs-dp-pron');
      pr.append(el('span', 'spjs-dp-kana', info.kana));
      pr.append(el('span', 'spjs-dp-ipa', info.ipa));
      pop.append(pr);
    }
    if (info?.lemma && info.lemma !== word.toLowerCase()) {
      pop.append(el('div', 'spjs-dp-lemma', '原形: ' + info.lemma));
    }
    if (info?.meaning) {
      const senses = info.meaning.split(' / ').slice(0, 4);
      const ul = el('div', 'spjs-dp-senses');
      senses.forEach(s => ul.append(el('div', 'spjs-dp-sense', s)));
      pop.append(ul);
    } else {
      // 辞書に無い語は内蔵翻訳でフォールバック
      const ph = el('div', 'spjs-dp-senses', '…');
      pop.append(ph);
      SPJS_TR.translateBatch([word]).then(([ja]) => { if (ja) ph.textContent = ja; else ph.textContent = '(訳なし)'; });
    }
    pop.append(el('div', 'spjs-dp-hint', 'クリックで「知ってる」登録/解除'));

    // 配置: 単語の直上。字幕行を隠さないよう上下自動反転
    pop.classList.remove('spjs-hidden');
    const wr = wordEl.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const pw = pop.offsetWidth, ph2 = pop.offsetHeight;
    let x = wr.left - cr.left + wr.width / 2 - pw / 2;
    x = Math.max(8, Math.min(cr.width - pw - 8, x));
    let y = wr.top - cr.top - ph2 - 10;
    if (y < 8) y = wr.bottom - cr.top + 10;
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';

    recordWordbook(word, info);
  }

  function hideDictSoon() {
    clearTimeout(ui.hideTimer);
    ui.hideTimer = setTimeout(() => ui.dictPop.classList.add('spjs-hidden'), 250);
  }

  async function toggleKnown(word) {
    const w = word.toLowerCase();
    if (knownWords.has(w)) { knownWords.delete(w); toast(`「${w}」を未知に戻しました`); }
    else { knownWords.add(w); toast(`「${w}」を既知に登録`); }
    await SPJS.storage.set({ knownWords: [...knownWords] });
    renderNow(true);
  }

  let wbDirty = null;
  function recordWordbook(word, info) {
    const key = (info?.lemma || word.toLowerCase());
    if (SPJS_DICT.isLoaded() && SPJS_DICT.isBasic(word)) return; // 基礎語は記録しない
    const cue = lastActiveKey ? cues.get(lastActiveKey) : null;
    const e = wordbook[key] || { count: 0 };
    e.count++;
    e.word = key;
    e.kana = info?.kana || e.kana || '';
    e.meaning = (info?.meaning || '').split(' / ')[0] || e.meaning || '';
    e.context = cue ? cue.en.replace(/\n/g, ' ') : e.context || '';
    e.ep = epId;
    e.at = Date.now();
    wordbook[key] = e;
    clearTimeout(wbDirty);
    wbDirty = setTimeout(() => SPJS.storage.set({ wordbook }), 1500);
  }

  // ---------- キーボード ----------
  function onKey(e) {
    if (!video || !ui) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cue = activeCue(video.currentTime) || prevCue();
    switch (e.key) {
      case 'ArrowLeft':
        if (!settings.learnMode) return; // 視聴モードではサイト標準のシークを尊重
        e.preventDefault(); e.stopImmediatePropagation();
        if (cue) { video.currentTime = cue.start + 0.01; video.play(); }
        break;
      case 'a': case 'A': {
        const p = prevCue(true);
        if (p) { video.currentTime = p.start + 0.01; video.play(); }
        break;
      }
      case 'd': case 'D': {
        const n = nextCue();
        if (n) { video.currentTime = n.start + 0.01; video.play(); }
        break;
      }
      case 's': case 'S': {
        const order = ['off', 'all', 'smart'];
        const next = order[(order.indexOf(settings.autoPause) + 1) % order.length];
        settings.autoPause = next;
        SPJS.saveSettings(settings);
        toast('オートポーズ: ' + ({ off: 'オフ', all: '毎セリフ', smart: '未知語のみ' })[next]);
        break;
      }
      case 't': case 'T':
        toggleDrawer();
        break;
      case '?':
        ui.cheat.classList.toggle('spjs-hidden');
        break;
      case 'Escape':
        ui.cheat.classList.add('spjs-hidden');
        if (!ui.drawer.classList.contains('spjs-hidden')) toggleDrawer();
        break;
    }
  }

  function prevCue(strict) {
    const t = video.currentTime;
    let prev = null;
    for (const c of cueList) {
      if (c.start < t - (strict ? 0.5 : 0)) prev = c; else break;
    }
    return prev;
  }
  function nextCue() {
    const t = video.currentTime;
    for (const c of cueList) if (c.start > t + 0.05) return c;
    return null;
  }

  // ---------- コントロールチップ ----------
  function buildChip() {
    const chip = el('div', 'spjs-chip');
    const mk = (id, label, title) => {
      const b = el('button', 'spjs-chip-btn', label);
      b.dataset.id = id;
      b.title = title;
      return b;
    };
    chip.append(
      mk('mode', '両', '字幕: 日本語/英語/両方/オフ'),
      mk('learn', '学', '学習モード(単語辞書・未知語ハイライト)'),
      mk('pause', '⏸', 'オートポーズ: オフ/毎セリフ/未知語のみ'),
      mk('replay', '↻', 'このセリフをリプレイ (←)'),
      mk('drawer', '≡', 'セリフ一覧 (T)'),
      mk('help', '?', 'ショートカット一覧 (?)'),
    );
    chip.addEventListener('click', (e) => {
      const b = e.target.closest('.spjs-chip-btn');
      if (!b) return;
      e.stopPropagation();
      switch (b.dataset.id) {
        case 'mode': {
          const order = ['both', 'ja', 'en', 'off'];
          settings.subMode = order[(order.indexOf(settings.subMode) + 1) % order.length];
          SPJS.saveSettings(settings); applySettings();
          toast('字幕: ' + ({ both: '英日両方', ja: '日本語のみ', en: '英語のみ', off: 'オフ' })[settings.subMode]);
          break;
        }
        case 'learn':
          settings.learnMode = !settings.learnMode;
          SPJS.saveSettings(settings); applySettings();
          toast('学習モード: ' + (settings.learnMode ? 'ON(単語ホバーで辞書)' : 'OFF'));
          break;
        case 'pause':
          onKey({ key: 's', target: null, preventDefault() {}, stopImmediatePropagation() {} });
          break;
        case 'replay': {
          const c = activeCue(video.currentTime) || prevCue();
          if (c) { video.currentTime = c.start + 0.01; video.play(); }
          break;
        }
        case 'drawer': toggleDrawer(); break;
        case 'help': ui.cheat.classList.toggle('spjs-hidden'); break;
      }
      updateChip();
    });
    return chip;
  }

  function updateChip() {
    if (!ui) return;
    const q = (id) => ui.chip.querySelector(`[data-id="${id}"]`);
    q('mode').textContent = ({ both: '両', ja: 'あ', en: 'A', off: '無' })[settings.subMode];
    q('learn').classList.toggle('spjs-on', settings.learnMode);
    q('pause').classList.toggle('spjs-on', settings.autoPause !== 'off');
    q('pause').textContent = settings.autoPause === 'smart' ? '⏸?' : '⏸';
  }

  // ---------- トランスクリプトドロワー ----------
  function toggleDrawer() {
    const d = ui.drawer;
    const open = d.classList.contains('spjs-hidden');
    if (open) { buildDrawer(); d.classList.remove('spjs-hidden'); }
    else d.classList.add('spjs-hidden');
    applyDrawerLayout(open);
  }

  // ドロワー展開中は動画を左に寄せて縮小し、セリフ一覧と被らないようにする
  function applyDrawerLayout(open) {
    if (!video || !container) return;
    ui.root.classList.toggle('spjs-drawer-open', open);
    if (open) {
      const drawerW = Math.min(360, container.clientWidth * 0.42);
      const k = Math.max(0.3, (container.clientWidth - drawerW) / container.clientWidth);
      video.style.transformOrigin = 'left center';
      video.style.transform = `scale(${k})`;
      ui.root.style.setProperty('--spjs-drawer-w', drawerW + 'px');
    } else {
      video.style.transform = '';
      video.style.transformOrigin = '';
    }
  }

  function buildDrawer() {
    const d = ui.drawer;
    d.textContent = '';
    const head = el('div', 'spjs-dr-title');
    head.append(el('span', '', 'セリフ一覧(クリックでジャンプ)'));
    const close = el('button', 'spjs-dr-close', '✕');
    close.title = '閉じる (T)';
    close.addEventListener('click', toggleDrawer);
    head.append(close);
    d.append(head);
    const list = el('div', 'spjs-dr-list');
    for (const c of cueList) {
      const row = el('div', 'spjs-dr-row');
      row.dataset.key = c.key;
      row.append(el('span', 'spjs-dr-time', fmtTime(c.start)));
      const body = el('div', 'spjs-dr-body');
      body.append(el('div', 'spjs-dr-en', c.en.replace(/\n/g, ' ')));
      if (c.ja) body.append(el('div', 'spjs-dr-ja', c.ja));
      row.append(body);
      row.addEventListener('click', () => { video.currentTime = c.start + 0.01; video.play(); });
      list.append(row);
    }
    d.append(list);
    ui.drawerBuiltCount = cueList.length;
  }

  function updateDrawerHighlight(cue) {
    const d = ui?.drawer;
    if (!d || d.classList.contains('spjs-hidden')) return;
    if (ui.drawerBuiltCount !== cueList.length) buildDrawer();
    const cur = d.querySelector('.spjs-dr-cur');
    const key = cue?.key;
    if (cur && cur.dataset.key === key) return;
    cur?.classList.remove('spjs-dr-cur');
    if (key) {
      const row = d.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (row) { row.classList.add('spjs-dr-cur'); row.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // ---------- チートシート / トースト ----------
  function buildCheatsheet() {
    const c = el('div', 'spjs-cheat spjs-hidden');
    c.append(el('div', 'spjs-dr-title', 'ショートカット'));
    const rows = [
      ['←', 'このセリフをリプレイ(学習モード時)'],
      ['A / D', '前のセリフ / 次のセリフ'],
      ['S', 'オートポーズ切替(オフ→毎セリフ→未知語のみ)'],
      ['T', 'セリフ一覧を開閉'],
      ['単語ホバー', '読み+意味を表示(自動一時停止)'],
      ['単語クリック', '「知ってる」登録(ハイライト除外)'],
      ['?', 'この一覧'],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'spjs-cheat-row');
      r.append(el('kbd', '', k), el('span', '', v));
      c.append(r);
    }
    return c;
  }

  let toastTimer = null;
  function toast(msg) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.classList.remove('spjs-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add('spjs-hidden'), 2200);
  }
  const toastShown = new Set();
  function toastOnce(id, msg) { if (!toastShown.has(id)) { toastShown.add(id); toast(msg); } }

  async function firstRunHint() {
    const { hinted } = await SPJS.storage.get('hinted');
    if (hinted) return;
    await SPJS.storage.set({ hinted: true });
    setTimeout(() => toast('日本語字幕ON。「?」キーでショートカット一覧'), 1500);
  }

  window.addEventListener('beforeunload', flushCache);

  init();
})();
