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
  let cues = new Map();        // key -> {key,start,end,en,speakerId,ja,jaAi}
  let cueList = [];            // start順
  let cache = {};              // v2|hash(en)|speaker -> Translator生訳 (エピソード単位)
  let aiCache = {};            // cue.key -> AI自然訳メタデータ (エピソード単位)
  let epId = null;
  let knownWords = new Set();
  let wordbook = {};
  let cacheDirty = false;
  let aiCacheDirty = false;
  let trRunning = false;
  let aiTrRunning = false;
  let trRunSeq = 0;
  let aiRunSeq = 0;
  let aiAvailability = 'unknown';
  let aiAvailabilityAt = 0;
  let generation = 0;
  let translationRevision = 0;
  let naturalPauseUntil = 0;
  const aiAttempts = new Map();
  const BASIC_BATCH_SIZE = 1;
  const AI_BATCH_SIZE = SPJS_NATURAL_TR.MAX_BATCH_SIZE || 5;
  const AI_MAX_ATTEMPTS = 3;
  const AI_RETRY_BASE_MS = 5000;
  const BASE_CACHE_PREFIX = 'v2|';
  let aiPreferredBatchSize = AI_BATCH_SIZE;
  let aiWarmupFailures = 0;
  let aiWarmupRetryAt = 0;
  let trController = null;
  let aiWorkerController = null;
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
    window.addEventListener('pagehide', () => {
      flushCache();
      cancelBaseWorker();
      cancelNaturalWorker();
      cancelExplanation(false, false);
      destroyExplainBase();
      SPJS_NATURAL_TR.destroy();
    }, { once: true });
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
    scheduleNaturalTranslate();
    scheduleTranslate();
  }

  function reset() {
    flushCache();
    generation++;
    cancelNaturalWorker();
    cancelExplanation(false, false);
    naturalPauseUntil = 0;
    cues = new Map(); cueList = []; cache = {}; aiCache = {}; lastActiveKey = null; autoPausedKey = null;
    aiAttempts.clear(); translationRevision = 0;
    aiPreferredBatchSize = AI_BATCH_SIZE;
    aiWarmupFailures = 0; aiWarmupRetryAt = 0;
    cancelBaseWorker();
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
      const loadingEp = epId, loadingGeneration = generation;
      const st = await SPJS.storage.get(['tr:' + loadingEp, 'tr-ai:' + loadingEp]);
      if (loadingGeneration !== generation || epId !== loadingEp) return;
      const storedBaseCache = st['tr:' + loadingEp] || {};
      cache = Object.fromEntries(Object.entries(storedBaseCache)
        .filter(([key, value]) => key.startsWith(BASE_CACHE_PREFIX) && typeof value === 'string'));
      if (Object.keys(cache).length !== Object.keys(storedBaseCache).length) cacheDirty = true;
      const storedAi = st['tr-ai:' + loadingEp];
      aiCache = storedAi?.version === SPJS_NATURAL_TR.CACHE_VERSION &&
        storedAi?.profileVersion === SPJS_CHARACTERS.PROFILE_VERSION
        ? (storedAi.entries || {}) : {};
      for (const cue of cues.values()) applyCachedTranslations(cue);
    }
    let added = false;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      // WebVTT voiceタグ(<v Name>)を保持してから装飾を除去する。
      const parsed = SPJS_CHARACTERS.parseCue(c);
      const text = parsed.text;
      if (!text) continue;
      const key = c.startTime.toFixed(2) + '|' + hash(text);
      if (cues.has(key)) continue;
      const h = hash(text);
      const cue = {
        key, start: c.startTime, end: c.endTime, en: text, h,
        speakerRaw: parsed.speakerRaw, speakerId: parsed.speakerId,
        speakerSource: parsed.speakerSource, segments: parsed.segments,
        ja: null, jaAi: null,
      };
      applyCachedTranslations(cue);
      cues.set(key, cue);
      added = true;
    }
    if (added) {
      cueList = [...cues.values()].sort((a, b) => a.start - b.start);
      reportProgress();
    }
  }

  function applyCachedTranslations(cue) {
    if (!cue) return;
    const cacheKey = baseCacheKey(cue);
    if (!cue.ja && cache[cacheKey]) cue.ja = canonicalBaseTranslation(cue, cache[cacheKey]);
    const entry = aiCache[cue.key];
    const currentBaseHash = cue.ja ? hash(cue.ja) : null;
    if (entry && entry.sourceHash === cue.h &&
        entry.baseHash === currentBaseHash &&
        entry.speakerId === (cue.speakerId || null) && typeof entry.ja === 'string') {
      cue.jaAi = entry.ja;
    } else if (cue.ja && entry && entry.sourceHash === cue.h &&
        entry.speakerId === (cue.speakerId || null) && entry.baseHash !== currentBaseHash) {
      // direct-Nanoや別の基本訳を参照した古い自然訳は、基本訳到着時に必ず再編集する。
      cue.jaAi = null;
      delete aiCache[cue.key];
      aiCacheDirty = true;
      aiAttempts.delete(cue.key);
    }
  }

  function baseCacheKey(cue) {
    return `${BASE_CACHE_PREFIX}${cue?.h || ''}|${cue?.speakerId || '-'}`;
  }

  function canonicalBaseTranslation(cue, value) {
    const terms = SPJS_CHARACTERS.translationTermsFor(cue?.en, cue?.speakerId);
    const fixed = SPJS_CHARACTERS.canonicalizeTranslation(value, terms).text.trim();
    return fixed || String(value || '').trim();
  }

  function effectiveJa(cue) {
    if (!cue) return null;
    return settings.aiNaturalTranslation && cue.jaAi ? cue.jaAi : cue.ja;
  }

  // ---------- 翻訳 ----------
  function scheduleTranslate() {
    if (trRunning || !settings.enabled) return;
    const pending = cueList.filter(c => !c.ja);
    if (!pending.length) return;
    trRunning = true;
    const runSeq = ++trRunSeq;
    const workerController = new AbortController();
    trController = workerController;
    let continueImmediately = false;
    (async () => {
      const runGeneration = generation, runEp = epId;
      try {
        // 現在 → 未来 → 過去。シーク後も過去の近接cueより先読みを優先する。
        const t0 = video ? video.currentTime : 0;
        // Translator APIは1件ずつ直列なので、小分けにして現在付近を早く表示する。
        const batch = SPJS_NATURAL_TR.prioritizeTargets(pending, t0, BASIC_BATCH_SIZE);
        const texts = batch.map(c => c.en.replace(/\s*\n\s*/g, ' '));
        const results = await SPJS_TR.translateBatch(texts, workerController.signal);
        if (runSeq !== trRunSeq || runGeneration !== generation || runEp !== epId ||
            workerController.signal.aborted) return;
        let ok = false;
        results.forEach((ja, i) => {
          if (ja) {
            const raw = String(ja).trim();
            const fixed = canonicalBaseTranslation(batch[i], raw);
            batch[i].ja = fixed;
            cache[baseCacheKey(batch[i])] = raw;
            applyCachedTranslations(batch[i]);
            ok = true;
          }
        });
        if (ok) {
          cacheDirty = true; translationRevision++;
          flushCacheSoon(); reportProgress(); renderNow();
          // 1件目の意味参照訳が完成した時点でNano編集を始め、残りを待たない。
          setTimeout(scheduleNaturalTranslate, 0);
          continueImmediately = cueList.some(cue => !cue.ja);
        }
        else if (SPJS_TR.getMode() === 'unavailable') toastOnce('tr-unavail', '翻訳モデル未導入。拡張アイコン → モデルをダウンロード してください');
      } finally {
        if (trController === workerController) trController = null;
        if (runSeq === trRunSeq) {
          trRunning = false;
          if (continueImmediately) setTimeout(scheduleTranslate, 0);
        }
      }
    })();
  }

  function cancelBaseWorker() {
    trRunSeq++;
    trRunning = false;
    trController?.abort();
    trController = null;
  }

  function reprioritizeBaseTranslation() {
    if (!settings.enabled) return;
    if (trRunning) cancelBaseWorker();
    setTimeout(scheduleTranslate, 0);
  }

  async function currentAiAvailability() {
    const now = Date.now();
    if (now - aiAvailabilityAt < 15000) return aiAvailability;
    aiAvailabilityAt = now;
    aiAvailability = await SPJS_NATURAL_TR.availability();
    reportProgress();
    return aiAvailability;
  }

  function aiItem(cue) {
    const seconds = Math.max(0.5, cue.end - cue.start);
    return {
      id: cue.key, start: cue.start, end: cue.end, en: cue.en,
      baseJa: cue.ja || null,
      budget: Math.max(6, Math.min(26, Math.floor(seconds * 4))),
      speakerRaw: cue.speakerRaw, speakerId: cue.speakerId,
      speakerSource: cue.speakerSource, segments: cue.segments || [],
    };
  }

  function canAttemptAi(cue) {
    const attempt = aiAttempts.get(cue.key);
    if (!attempt) return true;
    return attempt.count < AI_MAX_ATTEMPTS && Date.now() >= attempt.nextAt;
  }

  function recordAiFailure(cue, baseDelay = AI_RETRY_BASE_MS) {
    const previous = aiAttempts.get(cue.key);
    const count = (previous?.count || 0) + 1;
    const delay = Math.min(120000, baseDelay * (2 ** Math.max(0, count - 1)));
    aiAttempts.set(cue.key, { count, nextAt: Date.now() + delay });
    if (count >= AI_MAX_ATTEMPTS && completeBaseFallback(cue, cue.ja, 'base-fallback-retry-limit')) {
      return true;
    }
    return false;
  }

  function completeBaseFallback(cue, value, status = 'base-fallback') {
    if (!cue?.ja || !value) return false;
    const baseCheck = SPJS_NATURAL_TR.baseFallbackValue({ ...aiItem(cue), baseJa: cue.ja });
    const valueCheck = SPJS_NATURAL_TR.baseFallbackValue({ ...aiItem(cue), baseJa: value });
    if (!baseCheck.safe || !valueCheck.safe) return false;
    cue.jaAi = valueCheck.value;
    aiCache[cue.key] = {
      sourceHash: cue.h,
      baseHash: hash(cue.ja),
      speakerId: cue.speakerId || null,
      status,
      ja: cue.jaAi,
    };
    aiAttempts.delete(cue.key);
    return true;
  }

  function naturalRunCurrent(runSeq, runGeneration, runEp) {
    return runSeq === aiRunSeq && runGeneration === generation && runEp === epId &&
      settings.enabled && settings.aiNaturalTranslation && Date.now() >= naturalPauseUntil &&
      !aiWorkerController?.signal.aborted &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  }

  function cancelNaturalWorker() {
    aiRunSeq++;
    aiTrRunning = false;
    aiWorkerController?.abort();
    aiWorkerController = null;
    SPJS_NATURAL_TR.abort();
  }

  function scheduleNaturalTranslate() {
    if (aiTrRunning || !settings.enabled || !settings.aiNaturalTranslation ||
        !cueList.length || Date.now() < naturalPauseUntil) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    aiTrRunning = true;
    const runSeq = ++aiRunSeq;
    const workerController = new AbortController();
    aiWorkerController = workerController;
    let continueImmediately = false;
    (async () => {
      const runGeneration = generation, runEp = epId;
      try {
        const allPending = cueList.filter(c => !c.jaAi && canAttemptAi(c));
        // Translator APIが使える時は、意味参照訳ができたcueだけをNanoへ渡す。
        // 利用不能時だけ英語＋用語集による直接生成へフォールバックする。
        const pending = SPJS_TR.getMode() === 'unavailable'
          ? allPending : allPending.filter(cue => cue.ja);
        if (!pending.length || Date.now() < aiWarmupRetryAt) return;
        // 自動キューから巨大モデルのDLは始めない。解説またはpopupの明示操作で準備する。
        if (await currentAiAvailability() !== 'available') return;
        if (!naturalRunCurrent(runSeq, runGeneration, runEp)) return;
        // 1件の基本訳ができたら、次の基本訳と並行してNano編集を進める。
        let warmupTimedOut = false;
        const warmupTimer = setTimeout(() => {
          warmupTimedOut = true;
          workerController.abort();
        }, 45000);
        const warmed = await SPJS_NATURAL_TR.warmup('available', workerController.signal);
        clearTimeout(warmupTimer);
        if (!warmed) {
          const identityStillCurrent = runSeq === aiRunSeq && runGeneration === generation &&
            runEp === epId && settings.enabled && settings.aiNaturalTranslation;
          if (identityStillCurrent) {
            aiWarmupFailures++;
            const baseDelay = warmupTimedOut ? 15000 : 5000;
            aiWarmupRetryAt = Date.now() + Math.min(60000, baseDelay * (2 ** (aiWarmupFailures - 1)));
          }
          return;
        }
        if (!naturalRunCurrent(runSeq, runGeneration, runEp)) return;
        aiWarmupFailures = 0;
        aiWarmupRetryAt = 0;

        const t0 = video ? video.currentTime : 0;
        const liveCuePending = pending.some(cue => cue.start <= t0 + EPS && cue.end >= t0 - EPS);
        // いま表示中の1件を最短promptで先に返し、その後は未来を最大5件ずつ処理する。
        const batchSize = liveCuePending ? 1 : Math.min(aiPreferredBatchSize, AI_BATCH_SIZE);
        const targets = SPJS_NATURAL_TR.prioritizeTargets(pending, t0, batchSize);
        if (!targets.length) return;

        const contextIndexes = new Set();
        for (const target of targets) {
          const index = cueList.indexOf(target);
          if (index > 0) contextIndexes.add(index - 1);
          if (index >= 0) contextIndexes.add(index);
          if (index + 1 < cueList.length) contextIndexes.add(index + 1);
        }
        const context = [...contextIndexes].sort((a, b) => a - b).map(index => cueList[index]);
        const submittedTargets = targets.map(aiItem);
        const submittedBaseHashes = new Map(submittedTargets.map(item => [
          item.id, item.baseJa ? hash(item.baseJa) : null,
        ]));
        const result = await SPJS_NATURAL_TR.translateBatch({
          targets: submittedTargets, context: context.map(aiItem),
          signal: workerController.signal,
        });
        if (!naturalRunCurrent(runSeq, runGeneration, runEp)) return;
        if (result.errors?.includes('AbortError')) return;
        const timedOut = result.errors?.includes('TimeoutError');
        if (timedOut) aiPreferredBatchSize = Math.max(1, Math.ceil(batchSize / 2));

        let ok = false;
        for (const cue of targets) {
          const submittedBaseHash = submittedBaseHashes.get(cue.key) ?? null;
          const currentBaseHash = cue.ja ? hash(cue.ja) : null;
          // direct生成中にTranslatorが復旧した場合、その結果をhybrid訳として誤保存しない。
          if (submittedBaseHash !== currentBaseHash) {
            aiAttempts.delete(cue.key);
            continue;
          }
          const ja = result.values.get(cue.key);
          if (result.fallbackIds?.has(cue.key) && cue.ja) {
            const fallbackJa = result.fallbackValues?.get(cue.key);
            if (fallbackJa && completeBaseFallback(cue, fallbackJa)) ok = true;
            else if (recordAiFailure(cue, timedOut ? 15000 : AI_RETRY_BASE_MS)) ok = true;
            continue;
          }
          if (!ja) {
            if (recordAiFailure(cue, timedOut ? 15000 : AI_RETRY_BASE_MS)) ok = true;
            continue;
          }
          cue.jaAi = ja;
          aiCache[cue.key] = {
            sourceHash: cue.h,
            baseHash: submittedBaseHash,
            speakerId: cue.speakerId || null,
            status: 'nano',
            ja,
          };
          aiAttempts.delete(cue.key);
          ok = true;
        }
        if (ok) {
          if (!timedOut && aiPreferredBatchSize < AI_BATCH_SIZE) aiPreferredBatchSize++;
          aiCacheDirty = true; translationRevision++;
          flushCacheSoon(); reportProgress(); renderNow();
        }
        continueImmediately = cueList.some(c => !c.jaAi && canAttemptAi(c));
      } finally {
        if (aiWorkerController === workerController) aiWorkerController = null;
        if (runSeq === aiRunSeq) {
          aiTrRunning = false;
          // cue発見は800ms周期のまま、AIバッチ間の空白だけをなくす。
          if (continueImmediately) setTimeout(scheduleNaturalTranslate, 0);
        }
      }
    })();
  }

  function reprioritizeNaturalTranslation() {
    if (!settings.enabled || !settings.aiNaturalTranslation) return;
    if (aiTrRunning) cancelNaturalWorker();
    setTimeout(scheduleNaturalTranslate, 0);
  }

  let flushTimer = null;
  function flushCacheSoon() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushCache, 3000);
  }
  async function flushCache() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if ((!cacheDirty && !aiCacheDirty) || !epId) return;
    const writeEp = epId;
    const writeBase = cacheDirty;
    const writeAi = aiCacheDirty;
    const values = {};
    if (writeBase) values['tr:' + writeEp] = { ...cache };
    if (writeAi) {
      values['tr-ai:' + writeEp] = {
        version: SPJS_NATURAL_TR.CACHE_VERSION,
        profileVersion: SPJS_CHARACTERS.PROFILE_VERSION,
        entries: { ...aiCache },
      };
    }
    cacheDirty = false;
    aiCacheDirty = false;
    try {
      await SPJS.storage.set(values);
    } catch (e) {
      console.warn('[SPJS] Translation cache save failed:', e?.message || e);
      if (epId === writeEp) {
        if (writeBase) cacheDirty = true;
        if (writeAi) aiCacheDirty = true;
        flushCacheSoon();
      }
    }
  }

  function reportProgress() {
    const total = cueList.length, done = cueList.filter(c => c.ja).length;
    const aiDone = cueList.filter(c => c.jaAi).length;
    SPJS.storage.set({ trProgress: {
      ep: epId, total, done, aiDone,
      aiEnabled: !!settings.aiNaturalTranslation,
      aiStatus: aiAvailability,
      at: Date.now(),
    } });
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
    // 字幕の右横に「解説」ボタン(学習モード時のみCSSで表示)
    const exBtn = el('button', 'spjs-ex-btn', '解説');
    exBtn.title = 'このセリフの塊・文法をAI解説 (E)';
    exBtn.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); explainCurrentCue(); });
    subBox.append(exBtn);
    subWrap.append(subBox);

    const chip = buildChip();
    const dictPop = el('div', 'spjs-dictpop spjs-hidden');
    const drawer = el('div', 'spjs-drawer spjs-hidden');
    const cheat = buildCheatsheet();
    const toast = el('div', 'spjs-toast spjs-hidden');
    const explain = el('div', 'spjs-explain spjs-hidden');

    root.append(subWrap, chip, dictPop, drawer, cheat, toast, explain);
    container.append(root);
    ui = {
      root, subWrap, subBox, enLine, jaLine, chip, dictPop, drawer, cheat, toast, explain,
      drawerBuiltCount: 0, drawerBuiltRevision: -1,
    };

    video.addEventListener('timeupdate', renderNow);
    video.addEventListener('seeked', () => {
      autoPausedKey = null;
      renderNow();
      reprioritizeBaseTranslation();
      reprioritizeNaturalTranslation();
    });
    new ResizeObserver(applyFontSize).observe(video);
    applyFontSize();
    applySettings();

    // 字幕ホバーで一時停止
    subBox.addEventListener('mouseenter', () => {
      // ホバー一時停止は学習モード限定(視聴モードでは止めない)
      if (!settings.learnMode || !settings.hoverPause || !video || video.paused) return;
      video.pause(); pausedByHover = true;
    });
    subBox.addEventListener('mouseleave', () => {
      hideDictSoon();
      if (pausedByHover && video) { video.play(); pausedByHover = false; }
    });

    // 単語ホバー辞書(イベント委譲)
    subBox.addEventListener('mouseover', (e) => {
      if (!settings.learnMode) return; // 単語ホバー辞書は学習モード限定
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
      if (!settings.learnMode) return;
      const w = e.target.closest('.spjs-w');
      if (w) toggleKnown(w.dataset.w);
    });
    ui.dictPop.addEventListener('mouseenter', () => clearTimeout(ui.hideTimer));
    ui.dictPop.addEventListener('mouseleave', hideDictSoon);

    // コントロールチップ/解説ボタン: プレーヤー上でマウスが動いている間だけ表示。
    // 一定時間動きが無ければ隠す(全画面では常にプレーヤー内なので、内側判定だけだと出っぱなしになる)
    // (サイトUIのレイヤにmousemoveを食われるためdocumentレベルで判定)
    let idleTimer = null;
    const hideHoverUI = () => {
      ui.chip.classList.remove('spjs-show');
      ui.root.classList.remove('spjs-hover');
    };
    document.addEventListener('mousemove', (e) => {
      if (!ui || !container.isConnected) return;
      const r = container.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      clearTimeout(idleTimer);
      if (!inside) { hideHoverUI(); return; }
      ui.chip.classList.add('spjs-show');
      ui.root.classList.add('spjs-hover');
      // チップ/字幕/パネル類にホバー中は消さない(操作中に消えると不便)
      const overUI = e.target.closest?.('.spjs-chip, .spjs-subbox, .spjs-ex-btn, .spjs-dictpop, .spjs-explain, .spjs-drawer');
      if (!overUI) idleTimer = setTimeout(hideHoverUI, 2500);
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
    if (!settings.enabled) cancelBaseWorker();
    if (!settings.enabled || !settings.aiNaturalTranslation) cancelNaturalWorker();
    if (!ui) return;
    translationRevision++;
    ui.root.classList.toggle('spjs-learn', settings.learnMode);
    ui.root.classList.toggle('spjs-blurja', settings.blurJa);
    ui.root.style.setProperty('--spjs-bg', `rgba(0,0,0,${settings.bgOpacity})`);
    applyFontSize();
    updateChip();
    renderNow(true);
    if (settings.learnMode) SPJS_DICT.load().then(() => renderNow(true));
    if (track) track.mode = settings.enabled ? 'hidden' : 'disabled';
    reportProgress();
    if (settings.aiNaturalTranslation) scheduleNaturalTranslate();
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
  let renderedEnKey = '';
  function renderNow(force) {
    if (!ui || !video) return;
    const t = video.currentTime;
    const cue = settings.enabled && settings.subMode !== 'off' ? activeCue(t) : null;

    handleAutoPause(cue, t);
    updateDrawerHighlight(cue);

    const ja = effectiveJa(cue);
    const stateKey = cue ? cue.key + '|' + hash(ja || '') + '|' + settings.subMode + settings.learnMode : 'none';
    if (force) renderedEnKey = ''; // 設定変更・既知語登録時は英語行も再構築
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

    // 英語行はcue/モードが変わった時だけ再構築(翻訳到着のたびに単語spanを
    // 差し替えるとホバー中の辞書処理が死ぬため)
    const enKey = cue.key + '|' + settings.subMode + settings.learnMode;
    if (showEn && enKey !== renderedEnKey) { renderEnLine(cue); renderedEnKey = enKey; }
    if (showJa) ui.jaLine.textContent = ja || (cue.en ? '(翻訳中…)' : '');
    if (showJa && !ja) ui.jaLine.classList.add('spjs-pending'); else ui.jaLine.classList.remove('spjs-pending');
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
    const word = wordEl.dataset.w;
    await SPJS_DICT.load();
    if (!wordEl.isConnected) {
      // 辞書ロード中に再描画された場合は同じ単語の新しい要素を探す
      wordEl = ui.enLine.querySelector(`[data-w="${CSS.escape(word)}"]`);
      if (!wordEl) return;
    }
    clearTimeout(ui.hideTimer);     // 表示中に古い「閉じる」予約が発火しないように
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
      case 'e': case 'E':
        explainCurrentCue();
        break;
      case '?':
        ui.cheat.classList.toggle('spjs-hidden');
        break;
      case 'Escape':
        ui.cheat.classList.add('spjs-hidden');
        cancelExplanation(true);
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
      mk('mode', '学', 'モード切替: 学習(英日+辞書) → 日本語 → 英語 → オフ'),
      mk('explain', '解', 'このセリフの塊・文法をAI解説 (E)'),
      mk('pause', '⏸', 'オートポーズ: オフ/毎セリフ/未知語のみ'),
      mk('replay', '↻', 'このセリフをリプレイ (←)'),
      mk('drawer', '≡', 'セリフ一覧 (T)'),
      mk('help', '?', 'ショートカット一覧 (?)'),
    );
    chip.addEventListener('click', (e) => {
      const b = e.target.closest('.spjs-chip-btn');
      if (!b) return;
      e.stopPropagation();
      b.blur(); // フォーカスが残るとスペースキーがボタン再押下になり再生/停止を奪う
      switch (b.dataset.id) {
        case 'mode': {
          // 学習(英日+辞書) → 日本語のみ → 英語のみ → オフ の一本トグル
          cycleMode();
          break;
        }
        case 'pause':
          onKey({ key: 's', target: null, preventDefault() {}, stopImmediatePropagation() {} });
          break;
        case 'replay': {
          const c = activeCue(video.currentTime) || prevCue();
          if (c) { video.currentTime = c.start + 0.01; video.play(); }
          break;
        }
        case 'explain': explainCurrentCue(); break;
        case 'drawer': toggleDrawer(); break;
        case 'help': ui.cheat.classList.toggle('spjs-hidden'); break;
      }
      updateChip();
    });
    return chip;
  }

  // 表示モードの一本化: learn(英日+辞書) / ja / en / off
  function currentMode() {
    if (settings.learnMode) return 'learn';
    return settings.subMode === 'both' ? 'ja' : settings.subMode; // 非学習のbothはjaに丸める
  }

  const MODE_DEFS = {
    learn: { learnMode: true, subMode: 'both', label: '学', name: '学習モード(英日+辞書)' },
    ja:    { learnMode: false, subMode: 'ja',  label: 'あ', name: '日本語のみ' },
    en:    { learnMode: false, subMode: 'en',  label: 'A',  name: '英語のみ' },
    off:   { learnMode: false, subMode: 'off', label: '無', name: '字幕オフ' },
  };

  function setMode(mode) {
    const d = MODE_DEFS[mode];
    if (!d) return;
    settings.learnMode = d.learnMode;
    settings.subMode = d.subMode;
    SPJS.saveSettings(settings);
    applySettings();
    toast('モード: ' + d.name);
  }

  function cycleMode() {
    const order = ['learn', 'ja', 'en', 'off'];
    setMode(order[(order.indexOf(currentMode()) + 1) % order.length]);
  }

  function updateChip() {
    if (!ui) return;
    const q = (id) => ui.chip.querySelector(`[data-id="${id}"]`);
    const m = currentMode();
    q('mode').textContent = MODE_DEFS[m].label;
    q('mode').classList.toggle('spjs-on', m === 'learn');
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
      const W = container.clientWidth, H = container.clientHeight;
      const drawerW = Math.min(360, W * 0.42);
      const k = Math.max(0.3, (W - drawerW) / W);
      video.style.transformOrigin = 'left center';
      video.style.transform = `scale(${k})`;
      ui.root.style.setProperty('--spjs-drawer-w', drawerW + 'px');
      // 字幕を縮小後の動画エリア(左寄せ・上下中央)に合わせる
      ui.root.style.setProperty('--spjs-sub-right', drawerW + 'px');
      ui.root.style.setProperty('--spjs-sub-bottom', Math.round((1 - k) * H / 2 + 0.06 * k * H) + 'px');
    } else {
      video.style.transform = '';
      video.style.transformOrigin = '';
      ui.root.style.removeProperty('--spjs-sub-right');
      ui.root.style.removeProperty('--spjs-sub-bottom');
    }
  }

  function buildDrawer() {
    const d = ui.drawer;
    d.textContent = '';
    const head = el('div', 'spjs-dr-title');
    head.append(el('span', '', 'セリフ一覧(クリックでジャンプ)'));
    const close = el('button', 'spjs-dr-close', '✕');
    close.title = '閉じる (T)';
    close.addEventListener('click', (e) => { e.currentTarget.blur(); toggleDrawer(); });
    head.append(close);
    d.append(head);
    const list = el('div', 'spjs-dr-list');
    for (const c of cueList) {
      const row = el('div', 'spjs-dr-row');
      row.dataset.key = c.key;
      row.append(el('span', 'spjs-dr-time', fmtTime(c.start)));
      const body = el('div', 'spjs-dr-body');
      body.append(el('div', 'spjs-dr-en', c.en.replace(/\n/g, ' ')));
      const ja = effectiveJa(c);
      if (ja) body.append(el('div', 'spjs-dr-ja', ja));
      row.append(body);
      row.addEventListener('click', () => { video.currentTime = c.start + 0.01; video.play(); });
      list.append(row);
    }
    d.append(list);
    ui.drawerBuiltCount = cueList.length;
    ui.drawerBuiltRevision = translationRevision;
  }

  function updateDrawerHighlight(cue) {
    const d = ui?.drawer;
    if (!d || d.classList.contains('spjs-hidden')) return;
    if (ui.drawerBuiltCount !== cueList.length || ui.drawerBuiltRevision !== translationRevision) buildDrawer();
    const cur = d.querySelector('.spjs-dr-cur');
    const key = cue?.key;
    if (cur && cur.dataset.key === key) return;
    cur?.classList.remove('spjs-dr-cur');
    if (key) {
      const row = d.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (row) { row.classList.add('spjs-dr-cur'); row.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // ---------- 塊・文法解説(Prompt API / Gemini Nano) ----------
  let explainBaseSession = null;
  let explainCreating = null;
  let explainBaseRevision = 0;
  let explainController = null;
  const explainCache = new Map(); // cue.h -> text
  let explainSeq = 0;

  function destroyExplainSession(session) {
    try { session?.destroy?.(); } catch (e) { /* best effort */ }
  }

  function waitForExplainSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(
        value => { cleanup(); resolve(value); },
        error => { cleanup(); reject(error); },
      );
    });
  }

  function destroyExplainBase() {
    explainBaseRevision++;
    destroyExplainSession(explainBaseSession);
    explainBaseSession = null;
  }

  async function ensureExplainBase(onProgress, signal) {
    if (explainBaseSession) return explainBaseSession;
    if (explainCreating) {
      const existing = await waitForExplainSignal(explainCreating, signal);
      if (existing || signal?.aborted) return existing;
    }
    if (typeof LanguageModel === 'undefined') return null;
    const requestedRevision = explainBaseRevision;
    explainCreating = (async () => {
      try {
        const createPromise = LanguageModel.create({
          ...SPJS_NATURAL_TR.CAPABILITY_OPTIONS,
          ...(signal ? { signal } : {}),
          initialPrompts: [{ role: 'system', content: EXPLAIN_SYSTEM }],
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
          },
        });
        createPromise.then(created => {
          if (signal?.aborted) destroyExplainSession(created);
        }, () => {});
        const created = await waitForExplainSignal(createPromise, signal);
        if (signal?.aborted || requestedRevision !== explainBaseRevision) {
          destroyExplainSession(created);
          return null;
        }
        explainBaseSession = created;
        return explainBaseSession;
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('[SPJS] LanguageModel unavailable:', e.message);
        return null;
      } finally {
        explainCreating = null;
      }
    })();
    return explainCreating;
  }

  async function createExplainSession(onProgress, signal) {
    const base = await ensureExplainBase(onProgress, signal);
    if (!base || signal?.aborted) return null;
    if (typeof base.clone === 'function') {
      let cloned;
      try { cloned = await waitForExplainSignal(base.clone({ signal }), signal); }
      catch (e) {
        if (e?.name !== 'TypeError') throw e;
        cloned = await waitForExplainSignal(base.clone(), signal);
      }
      if (signal?.aborted) { destroyExplainSession(cloned); return null; }
      return cloned;
    }
    return waitForExplainSignal(LanguageModel.create({
      ...SPJS_NATURAL_TR.CAPABILITY_OPTIONS,
      signal,
      initialPrompts: [{ role: 'system', content: EXPLAIN_SYSTEM }],
    }), signal);
  }

  function resumeNaturalAfterExplanation() {
    naturalPauseUntil = Date.now() + 500;
    setTimeout(scheduleNaturalTranslate, 500);
  }

  function cancelExplanation(hidePanel = true, resume = true) {
    const hadActiveWork = !!explainController || naturalPauseUntil === Number.POSITIVE_INFINITY;
    explainSeq++;
    explainController?.abort();
    explainController = null;
    if (hidePanel) ui?.explain?.classList.add('spjs-hidden');
    if (resume && hadActiveWork) resumeNaturalAfterExplanation();
  }

  async function explainCurrentCue() {
    const cue = activeCue(video.currentTime) || prevCue();
    if (!cue) { toast('解説対象のセリフがありません'); return; }
    cancelExplanation(false);
    if (!video.paused) video.pause();
    const seq = ++explainSeq;
    const panel = ui.explain;
    panel.textContent = '';
    const head = el('div', 'spjs-dr-title');
    head.append(el('span', '', '💡 塊・文法解説'));
    const close = el('button', 'spjs-dr-close', '✕');
    close.addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (seq === explainSeq) cancelExplanation(true);
      else panel.classList.add('spjs-hidden');
    });
    head.append(close);
    const enq = el('div', 'spjs-ex-en', cue.en.replace(/\n/g, ' '));
    const body = el('div', 'spjs-ex-body', '');
    panel.append(head, enq, body);
    panel.classList.remove('spjs-hidden');

    // キャッシュ表示だけなら、進行中の自然訳を止めない。
    if (explainCache.has(cue.h)) { body.textContent = explainCache.get(cue.h); return; }

    // 実際に推論する間だけ自然訳を譲る。シーク・設定OFFと同じ経路で旧workerを止める。
    naturalPauseUntil = Number.POSITIVE_INFINITY;
    cancelNaturalWorker();
    const controller = new AbortController();
    explainController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);

    const idx = cueList.indexOf(cue);
    const ctx = idx > 0 ? `直前のセリフ: ${cueList[idx - 1].en.replace(/\n/g, ' ')}\n` : '';
    const target = cue.en.replace(/\n/g, ' ');

    try {
    // 1) オンデバイス(Gemini Nano)
    let lmAvail = 'unavailable';
    try {
      if (typeof LanguageModel !== 'undefined') {
        lmAvail = await waitForExplainSignal(
          LanguageModel.availability(SPJS_NATURAL_TR.CAPABILITY_OPTIONS),
          controller.signal,
        );
      }
    } catch (e) { /* unavailable */ }
    if (seq !== explainSeq || controller.signal.aborted) return;
    if (lmAvail !== 'unavailable') {
      body.textContent = 'AIモデル準備中…(初回はダウンロードに数分かかることがあります)';
      const session = await createExplainSession((p) => {
        if (seq === explainSeq) body.textContent = `AIモデルをダウンロード中… ${Math.round(p * 100)}%`;
      }, controller.signal);
      if (seq !== explainSeq || controller.signal.aborted) {
        destroyExplainSession(session);
        return;
      }
      if (session) {
        body.textContent = '解説を生成中…';
        try {
          const stream = session.promptStreaming(
            `${ctx}解説対象: ${target}`,
            { signal: controller.signal },
          );
          let out = '';
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await waitForExplainSignal(iterator.next(), controller.signal);
            if (next.done) break;
            const chunk = next.value;
            if (seq !== explainSeq || controller.signal.aborted) return;
            out += chunk;
            body.textContent = out;
          }
          explainCache.set(cue.h, out);
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          // ローカル推論失敗時だけクラウドへフォールバックする。
        } finally {
          destroyExplainSession(session);
        }
      }
    }

    if (controller.signal.aborted) return;
    // 2) Gemini API(無料枠・popupでキー設定)
    if (settings.geminiKey) {
      body.textContent = '解説を生成中…(Gemini API)';
      try {
        const out = await explainViaGeminiAPI(ctx, target, controller.signal);
        if (seq !== explainSeq || controller.signal.aborted) return;
        body.textContent = out;
        explainCache.set(cue.h, out);
      } catch (e) {
        if (seq === explainSeq && !controller.signal.aborted) body.textContent = 'Gemini APIエラー: ' + e.message;
      }
      return;
    }

    body.textContent = 'オンデバイスAIが使えません(Gemini Nanoはディスク空き容量 約22GB が必要です)。\n\n代わりに拡張アイコン → 設定 → Gemini APIキー(無料枠あり)を設定すると解説が使えます。\nキー取得: https://aistudio.google.com/apikey';
    } finally {
      clearTimeout(timeout);
      if (seq === explainSeq && explainController === controller) {
        explainController = null;
        if (timedOut) body.textContent = '解説が60秒でタイムアウトしました。もう一度お試しください。';
        resumeNaturalAfterExplanation();
      }
    }
  }

  const EXPLAIN_SYSTEM = 'あなたは英語教師です。与えられた英語のセリフについて、意味の塊(句動詞・イディオム・口語表現・コロケーション)と文法ポイントを日本語で簡潔に解説します。形式: 最初に全体の自然な和訳を1行。次に「・塊: 説明」の箇条書き(重要なもののみ2〜4個)。最後に文法ポイントがあれば「・文法: 説明」を1〜2個。前置きや締めの文は書かない。';

  async function explainViaGeminiAPI(ctx, target, signal) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(settings.geminiKey)}`,
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EXPLAIN_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `${ctx}解説対象: ${target}` }] }],
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text) throw new Error('空の応答');
    return text;
  }

  // ---------- チートシート / トースト ----------
  function buildCheatsheet() {
    const c = el('div', 'spjs-cheat spjs-hidden');
    c.append(el('div', 'spjs-dr-title', 'ショートカット'));
    const rows = [
      ['←', 'このセリフをリプレイ(学習モード時)'],
      ['A / D', '前のセリフ / 次のセリフ'],
      ['S', 'オートポーズ切替(オフ→毎セリフ→未知語のみ)'],
      ['E', 'このセリフの塊・文法をAI解説'],
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
