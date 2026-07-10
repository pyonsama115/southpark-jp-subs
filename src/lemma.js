// 英単語の原形化(軽量ルール+不規則テーブル)
'use strict';

const SPJS_LEMMA = (() => {
  const IRREGULAR = {
    // 不規則動詞(過去形/過去分詞/現在分詞の主要どころ)
    was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be', being: 'be',
    went: 'go', gone: 'go', did: 'do', done: 'do', had: 'have', has: 'have',
    said: 'say', made: 'make', got: 'get', gotten: 'get', took: 'take', taken: 'take',
    came: 'come', saw: 'see', seen: 'see', knew: 'know', known: 'know',
    thought: 'think', told: 'tell', became: 'become', gave: 'give', given: 'give',
    found: 'find', felt: 'feel', put: 'put', brought: 'bring', began: 'begin', begun: 'begin',
    kept: 'keep', held: 'hold', wrote: 'write', written: 'write', stood: 'stand',
    heard: 'hear', let: 'let', meant: 'mean', met: 'meet', ran: 'run', paid: 'pay',
    sat: 'sit', spoke: 'speak', spoken: 'speak', lay: 'lie', lain: 'lie', led: 'lead',
    read: 'read', grew: 'grow', grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall',
    sent: 'send', built: 'build', understood: 'understand', drew: 'draw', drawn: 'draw',
    broke: 'break', broken: 'break', spent: 'spend', cut: 'cut', rose: 'rise', risen: 'rise',
    drove: 'drive', driven: 'drive', bought: 'buy', wore: 'wear', worn: 'wear',
    chose: 'choose', chosen: 'choose', ate: 'eat', eaten: 'eat', slept: 'sleep',
    woke: 'wake', woken: 'wake', threw: 'throw', thrown: 'throw', caught: 'catch',
    taught: 'teach', sold: 'sell', fought: 'fight', flew: 'fly', flown: 'fly',
    forgot: 'forget', forgotten: 'forget', left: 'leave', struck: 'strike',
    swore: 'swear', sworn: 'swear', shook: 'shake', shaken: 'shake', hid: 'hide', hidden: 'hide',
    won: 'win', sang: 'sing', sung: 'sing', drank: 'drink', drunk: 'drink', rode: 'ride', ridden: 'ride',
    dying: 'die', lying: 'lie', tying: 'tie',
    // 不規則複数
    children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot',
    teeth: 'tooth', mice: 'mouse', geese: 'goose', wives: 'wife', lives: 'life',
    knives: 'knife', leaves: 'leaf', wolves: 'wolf', selves: 'self', priests: 'priest',
    // 代名詞・短縮関連はそのまま
  };

  const VOWELS = 'aeiou';

  // 候補を順に返す(辞書に載っている形を呼び出し側で選ぶ)
  function candidates(wordRaw) {
    const w = wordRaw.toLowerCase();
    const out = [w];
    if (IRREGULAR[w]) out.push(IRREGULAR[w]);

    const push = (x) => { if (x && x.length >= 2 && !out.includes(x)) out.push(x); };

    // 所有格・短縮
    if (w.endsWith("'s")) push(w.slice(0, -2));
    if (w.endsWith("n't")) push(w.slice(0, -3));

    // 複数形・三単現
    if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
    else if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1));

    // 過去形 -ed
    if (w.endsWith('ied') && w.length > 4) push(w.slice(0, -3) + 'y');
    if (w.endsWith('ed')) {
      push(w.slice(0, -2));                    // walked -> walk
      push(w.slice(0, -1));                    // liked -> like
      const stem = w.slice(0, -2);
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // stopped -> stop
    }

    // 進行形 -ing
    if (w.endsWith('ing') && w.length > 4) {
      const stem = w.slice(0, -3);
      push(stem);                              // walking -> walk
      push(stem + 'e');                        // making -> make
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // running -> run
    }

    // 比較級・最上級
    if (w.endsWith('ier') && w.length > 4) push(w.slice(0, -3) + 'y');
    if (w.endsWith('iest') && w.length > 5) push(w.slice(0, -4) + 'y');
    if (w.endsWith('er') && w.length > 3) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
    if (w.endsWith('est') && w.length > 4) { push(w.slice(0, -3)); push(w.slice(0, -2)); }

    // 副詞 -ly
    if (w.endsWith('ly') && w.length > 4) {
      push(w.slice(0, -2));
      if (w.endsWith('ily')) push(w.slice(0, -3) + 'y');
    }
    return out;
  }

  return { candidates };
})();
