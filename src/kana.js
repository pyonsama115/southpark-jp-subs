// ARPAbet(CMUdict)発音 → カタカナ読み + IPA 変換
'use strict';

const SPJS_KANA = (() => {
  // 母音クラス: first=子音と結合する母音字, rest=後続文字列
  const VOWELS = {
    AA: { c: 'a', rest: '' },  AE: { c: 'a', rest: '' },  AH: { c: 'a', rest: '' },
    AO: { c: 'o', rest: '' },  AW: { c: 'a', rest: 'ウ' }, AY: { c: 'a', rest: 'イ' },
    EH: { c: 'e', rest: '' },  ER: { c: 'a', rest: 'ー' }, EY: { c: 'e', rest: 'イ' },
    IH: { c: 'i', rest: '' },  IY: { c: 'i', rest: 'ー' }, OW: { c: 'o', rest: 'ー' },
    OY: { c: 'o', rest: 'イ' }, UH: { c: 'u', rest: '' },  UW: { c: 'u', rest: 'ー' },
  };
  // 子音行: a/i/u/e/o に対応するカナ
  const CONS = {
    B:  { a: 'バ', i: 'ビ', u: 'ブ', e: 'ベ', o: 'ボ', solo: 'ブ' },
    CH: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ', solo: 'チ' },
    D:  { a: 'ダ', i: 'ディ', u: 'ドゥ', e: 'デ', o: 'ド', solo: 'ド' },
    DH: { a: 'ザ', i: 'ジ', u: 'ズ', e: 'ゼ', o: 'ゾ', solo: 'ズ' },
    F:  { a: 'ファ', i: 'フィ', u: 'フ', e: 'フェ', o: 'フォ', solo: 'フ' },
    G:  { a: 'ガ', i: 'ギ', u: 'グ', e: 'ゲ', o: 'ゴ', solo: 'グ' },
    HH: { a: 'ハ', i: 'ヒ', u: 'フ', e: 'ヘ', o: 'ホ', solo: '' },
    JH: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ', solo: 'ジ' },
    K:  { a: 'カ', i: 'キ', u: 'ク', e: 'ケ', o: 'コ', solo: 'ク' },
    L:  { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ', solo: 'ル' },
    M:  { a: 'マ', i: 'ミ', u: 'ム', e: 'メ', o: 'モ', solo: 'ム' },
    N:  { a: 'ナ', i: 'ニ', u: 'ヌ', e: 'ネ', o: 'ノ', solo: 'ン' },
    NG: { a: 'ンガ', i: 'ンギ', u: 'ング', e: 'ンゲ', o: 'ンゴ', solo: 'ング' },
    P:  { a: 'パ', i: 'ピ', u: 'プ', e: 'ペ', o: 'ポ', solo: 'プ' },
    R:  { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ', solo: 'ー' },
    S:  { a: 'サ', i: 'シ', u: 'ス', e: 'セ', o: 'ソ', solo: 'ス' },
    SH: { a: 'シャ', i: 'シ', u: 'シュ', e: 'シェ', o: 'ショ', solo: 'シュ' },
    T:  { a: 'タ', i: 'ティ', u: 'トゥ', e: 'テ', o: 'ト', solo: 'ト' },
    TH: { a: 'サ', i: 'シ', u: 'ス', e: 'セ', o: 'ソ', solo: 'ス' },
    V:  { a: 'ヴァ', i: 'ヴィ', u: 'ヴ', e: 'ヴェ', o: 'ヴォ', solo: 'ヴ' },
    W:  { a: 'ワ', i: 'ウィ', u: 'ウ', e: 'ウェ', o: 'ウォ', solo: 'ウ' },
    Y:  { a: 'ヤ', i: 'イ', u: 'ユ', e: 'イェ', o: 'ヨ', solo: 'イ' },
    Z:  { a: 'ザ', i: 'ジ', u: 'ズ', e: 'ゼ', o: 'ゾ', solo: 'ズ' },
    ZH: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ', solo: 'ジュ' },
  };
  const VOWEL_KANA = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ' };

  const IPA = {
    AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɚ',
    EY: 'eɪ', IH: 'ɪ', IY: 'iː', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː',
    B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k',
    L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't',
    TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
  };

  // phones: ["P","R","IY1","S","T"] のような配列(ストレス数字付き)
  function toKatakana(phones) {
    const ps = phones.map(p => p.replace(/\d/g, ''));
    let out = '';
    let i = 0;
    while (i < ps.length) {
      const p = ps[i];
      if (VOWELS[p]) {
        const v = VOWELS[p];
        out += VOWEL_KANA[v.c] + v.rest;
        i++;
        continue;
      }
      const c = CONS[p];
      if (!c) { i++; continue; }
      const next = ps[i + 1];
      // 拗音: 子音+Y+母音 (community -> ミュ, cute -> キュ)
      if (next === 'Y' && ps[i + 2] && VOWELS[ps[i + 2]]) {
        const v = VOWELS[ps[i + 2]];
        const small = { a: 'ャ', u: 'ュ', o: 'ョ', e: 'ェ', i: '' }[v.c];
        let base = c.i;
        if (base.endsWith('ィ')) base = base.slice(0, -1);
        out += base + small + v.rest;
        i += 3;
        continue;
      }
      // 撥音: M は唇音(P/B/M/F/V)の前では「ン」(important -> インポータント)
      if (p === 'M' && ['P', 'B', 'M', 'F', 'V'].includes(next)) {
        out += 'ン';
        i++;
        continue;
      }
      if (next && VOWELS[next]) {
        const v = VOWELS[next];
        out += c[v.c] + v.rest;
        i += 2;
      } else {
        // 促音: 短母音の後の無声破裂音で締まる感じに(pot -> ポット)
        const isFinalStop = (p === 'P' || p === 'T' || p === 'K' || p === 'CH') && i === ps.length - 1;
        const prev = ps[i - 1];
        const prevShortVowel = prev && VOWELS[prev] && VOWELS[prev].rest === '';
        if (isFinalStop && prevShortVowel) out += 'ッ';
        out += c.solo;
        i++;
      }
    }
    return out;
  }

  function toIPA(phones) {
    let out = '';
    for (const raw of phones) {
      const p = raw.replace(/\d/g, '');
      if (/1/.test(raw)) out += 'ˈ';
      out += IPA[p] || '';
    }
    return '/' + out + '/';
  }

  // 発音辞書に無い語: 綴りからざっくりカタカナ化(最終手段)
  function fallbackKana(word) {
    return null; // 無理に出さない(誤読を出すより非表示)
  }

  return { toKatakana, toIPA, fallbackKana };
})();
