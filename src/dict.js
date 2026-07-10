// 辞書(EJDict英和 / CMUdict発音 / 頻度リスト)の遅延ロードと検索
'use strict';

const SPJS_DICT = (() => {
  let ejdict = null;    // Map<word, meaning>
  let cmu = null;       // Map<word, phones[]>
  let freq = null;      // Map<word, rank>
  let loading = null;

  async function fetchText(path) {
    const res = await fetch(SPJS.assetURL(path));
    if (!res.ok) throw new Error(`dict fetch failed: ${path} ${res.status}`);
    return res.text();
  }

  async function load() {
    if (ejdict) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        await doLoad();
      } catch (e) {
        loading = null; // 失敗しても次のホバーで再試行できるように
        throw e;
      }
    })();
    return loading;
  }

  async function doLoad() {
    {
      const [ej, cm, fr] = await Promise.all([
        fetchText('data/ejdict.txt'),
        fetchText('data/cmudict.dict'),
        fetchText('data/freq10k.txt'),
      ]);
      const ejMap = new Map();
      for (const line of ej.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const keys = line.slice(0, tab);
        const meaning = line.slice(tab + 1);
        // "word,word2" 形式のキーに対応
        for (const k of keys.split(',')) {
          const key = k.trim().toLowerCase();
          if (key && !ejMap.has(key)) ejMap.set(key, meaning);
        }
      }
      const cmMap = new Map();
      for (const line of cm.split('\n')) {
        if (!line || line.startsWith(';')) continue;
        const sp = line.indexOf(' ');
        if (sp < 0) continue;
        let w = line.slice(0, sp);
        if (w.includes('(')) continue; // 異読 word(2) はスキップ(第1発音のみ)
        cmMap.set(w.toLowerCase(), line.slice(sp + 1).trim().split(/\s+/));
      }
      const frMap = new Map();
      let rank = 1;
      for (const line of fr.split('\n')) {
        const w = line.trim().toLowerCase();
        if (w) frMap.set(w, rank++);
      }
      ejdict = ejMap; cmu = cmMap; freq = frMap;
    }
  }

  function isLoaded() { return !!ejdict; }

  // 単語1つの完全ルックアップ(原形化込み)
  function lookup(wordRaw) {
    if (!ejdict) return null;
    const cands = SPJS_LEMMA.candidates(wordRaw);
    let entry = null;
    for (const c of cands) {
      const m = ejdict.get(c);
      if (m) { entry = { lemma: c, meaning: m }; break; }
    }
    const base = entry ? entry.lemma : wordRaw.toLowerCase();
    const phones = cmu.get(wordRaw.toLowerCase()) || cmu.get(base) || null;
    const rank = freq.get(base) ?? freq.get(wordRaw.toLowerCase()) ?? null;
    if (!entry && !phones) return null;
    return {
      word: wordRaw,
      lemma: entry ? entry.lemma : null,
      meaning: entry ? entry.meaning : null,
      kana: phones ? SPJS_KANA.toKatakana(phones) : null,
      ipa: phones ? SPJS_KANA.toIPA(phones) : null,
      rank,
      band: rank == null ? null : rank <= 1000 ? 'basic' : rank <= 3000 ? 'common' : null,
    };
  }

  // 学習モードの未知語判定用: 基礎語(top1000)か
  function isBasic(wordRaw) {
    if (!freq) return true;
    for (const c of SPJS_LEMMA.candidates(wordRaw)) {
      const r = freq.get(c);
      if (r != null && r <= 1000) return true;
    }
    return false;
  }

  return { load, isLoaded, lookup, isBasic };
})();
