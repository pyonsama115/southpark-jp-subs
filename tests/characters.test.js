'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const characters = require('../src/characters.js');

test('known speaker aliases resolve to canonical profiles', () => {
  assert.equal(characters.resolve('ERIC CARTMAN').id, 'cartman');
  assert.equal(characters.resolve('Mrs. Cartman').id, 'liane');
  assert.equal(characters.resolve('Mr Mackey').id, 'mackey');
  assert.equal(characters.resolve('Token Black').id, 'tolkien');
  assert.equal(characters.resolve('Unknown Extra').id, null);
  assert.equal(characters.resolve('Mom').id, null);
  assert.equal(characters.resolve('Dad').id, null);
});

test('getCueAsHTML voice metadata is preferred when Chrome exposes it', () => {
  const voiceNode = {
    getAttribute(name) { return name === 'title' ? 'Liane Cartman' : null; },
    textContent: 'Eric, sweetie.',
  };
  const parsed = characters.parseCue({
    text: 'Eric, sweetie.',
    getCueAsHTML() {
      return {
        textContent: 'Eric, sweetie.',
        querySelectorAll(selector) { return selector === 'span[title]' ? [voiceNode] : []; },
      };
    },
  });
  assert.equal(parsed.speakerId, 'liane');
  assert.equal(parsed.speakerSource, 'vtt');
  assert.equal(parsed.segments[0].text, 'Eric, sweetie.');
});

test('raw WebVTT voice tag is preserved before markup removal', () => {
  const parsed = characters.parseCue({ text: '<v Eric Cartman><i>Respect my authority!</i>' });
  assert.equal(parsed.text, 'Respect my authority!');
  assert.equal(parsed.speakerRaw, 'Eric Cartman');
  assert.equal(parsed.speakerId, 'cartman');
  assert.equal(parsed.speakerSource, 'vtt');
  assert.deepEqual(parsed.segments, [{
    speakerRaw: 'Eric Cartman', text: 'Respect my authority!', speakerId: 'cartman',
  }]);
});

test('multiple WebVTT voices remain separate and do not become one speaker', () => {
  const parsed = characters.parseCue({ text: '<v Stan>Yeah.\n<v Kyle>No way.' });
  assert.equal(parsed.speakerId, null);
  assert.equal(parsed.speakerSource, 'multi');
  assert.deepEqual(parsed.segments.map(s => s.speakerId), ['stan', 'kyle']);
  assert.match(parsed.text, /Yeah/);
  assert.match(parsed.text, /No way/);
});

test('known caption labels are recognized but arbitrary colon text is not', () => {
  const bracketed = characters.parseCue({ text: '[Mrs. Cartman]: Eric, honey.' });
  assert.equal(bracketed.speakerId, 'liane');
  assert.equal(bracketed.text, 'Eric, honey.');
  const labelled = characters.parseCue({ text: 'Mrs. Cartman: Eric, honey.' });
  assert.equal(labelled.speakerId, 'liane');
  assert.equal(labelled.text, 'Eric, honey.');
  assert.equal(characters.parseCue({ text: '[CARTMAN] Respect my authority!' }).speakerId, 'cartman');
  assert.equal(characters.parseCue({ text: 'WARNING: This is not a speaker.' }).speakerId, null);
});

test('target-scoped terminology fixes character and place names without inner duplicates', () => {
  const terms = characters.translationTermsFor(
    'Eric Cartman said Kyle lives in South Park.', 'stan',
  );
  assert.deepEqual(terms.map(term => term.source), ['Eric Cartman', 'Kyle', 'South Park']);
  const fixed = characters.canonicalizeTranslation(
    'エリック・カートマンが ケイルは南パークに住んでると言った', terms,
  );
  assert.equal(fixed.text, 'エリック・カートマンが カイルはサウスパークに住んでると言った');
  assert.deepEqual(fixed.missing, []);
});

test('vocative names may be omitted, while meaning-bearing names and places must remain', () => {
  const vocative = characters.translationTermsFor('Come on, Kyle.', 'stan');
  assert.equal(vocative[0].mustPreserve, false);
  assert.deepEqual(characters.canonicalizeTranslation('行こうぜ', vocative).missing, []);

  const contrast = characters.translationTermsFor('Kyle won, not Stan.', 'wendy');
  assert.ok(contrast.every(term => term.mustPreserve));
  assert.equal(characters.canonicalizeTranslation('カイルが勝った', contrast).missing[0].source, 'Stan');

  const place = characters.translationTermsFor('We live in South Park.', 'stan');
  assert.equal(characters.canonicalizeTranslation('ここに住んでる', place).missing[0].source, 'South Park');
});

test('Liane may render Eric as Eric-chan, but ordinary lowercase words are not terms', () => {
  const [eric] = characters.translationTermsFor('Eric, sweetie.', 'liane');
  assert.equal(eric.exactJa, 'エリックちゃん');
  assert.deepEqual(eric.acceptedJa, ['エリックちゃん', 'エリック']);
  assert.equal(characters.translationTermsFor('Eric said no.', 'stan')[0].exactJa, 'エリック');
  assert.deepEqual(characters.translationTermsFor('Ask the chef about my PC.', null), []);
});

test('short names do not match or corrupt longer names', () => {
  const terms = characters.translationTermsFor('Stan won.', 'kyle');
  const japaneseLongName = characters.canonicalizeTranslation('スタンリーが勝った', terms);
  assert.equal(japaneseLongName.missing[0].source, 'Stan');

  const englishLongName = characters.canonicalizeTranslation('Stanleyが勝った', terms);
  assert.equal(englishLongName.text, 'Stanleyが勝った');
  assert.equal(englishLongName.missing[0].source, 'Stan');
});

test('alternate full names and school names use one canonical rendering', () => {
  const fullName = characters.translationTermsFor('Kyle Broflovsky is here.', 'stan');
  assert.deepEqual(fullName.map(term => term.source), ['Kyle Broflovsky']);
  assert.equal(
    characters.canonicalizeTranslation('カイル・ブロフロフスキーが来た', fullName).missing.length,
    0,
  );

  const school = characters.translationTermsFor('South Park Elementary School is closed.', 'stan');
  assert.deepEqual(school.map(term => term.source), ['South Park Elementary School']);
  assert.equal(
    characters.canonicalizeTranslation('サウスパーク小学校学校は休校だ', school).text,
    'サウスパーク小学校は休校だ',
  );
  assert.deepEqual(
    characters.translationTermsFor('Liane spoke to Shelley and Victoria.', 'stan')
      .map(term => term.exactJa),
    ['リアン', 'シェリー', 'ヴィクトリア'],
  );
});

test('each source terminology occurrence requires a distinct output occurrence', () => {
  const nested = characters.translationTermsFor(
    'South Park Elementary is in South Park.', 'stan',
  );
  assert.deepEqual(nested.map(term => term.source), ['South Park Elementary', 'South Park']);
  assert.equal(
    characters.canonicalizeTranslation('サウスパーク小学校にある', nested).missing[0].source,
    'South Park',
  );

  const repeated = characters.translationTermsFor('Kyle called Kyle.', 'stan');
  assert.equal(repeated.length, 2);
  assert.equal(characters.canonicalizeTranslation('カイルを呼んだ', repeated).missing.length, 1);
  assert.equal(characters.canonicalizeTranslation('カイルがカイルを呼んだ', repeated).missing.length, 0);
});

test('character prompt carries parent-child forms of address', () => {
  const prompt = characters.promptProfiles(['liane', 'cartman', 'ike', 'kyle']);
  assert.match(prompt, /エリックちゃん/);
  assert.match(prompt, /アイク/);
  assert.match(prompt, /カイルを「カイル」と呼ぶ/);
  assert.match(prompt, /オイラ/);
  assert.match(prompt, /原文にない名前や口癖を足さない/);
  assert.match(prompt, /子供同士・友達同士は常体/);
  assert.match(prompt, /You guys have to listen to me!/);
});

test('explicit addressees and social register distinguish peers from adults', () => {
  assert.deepEqual(characters.explicitAddresseeIds('Kyle, can you help me?', 'stan'), ['kyle']);
  assert.deepEqual(characters.explicitAddresseeIds('Cartman: Kyle, listen!', 'cartman'), ['kyle']);
  assert.deepEqual(characters.explicitAddresseeIds('Well, Kyle, can you help me?', 'stan'), ['kyle']);
  assert.deepEqual(characters.explicitAddresseeIds('Can you help me, Kyle?', 'stan'), ['kyle']);
  assert.deepEqual(characters.explicitAddresseeIds('I saw Kyle yesterday.', 'stan'), []);
  assert.equal(characters.registerPolicy('stan', ['kyle']).mode, 'peer_casual');
  assert.ok(characters.registerPolicy('stan', ['kyle']).forbiddenForms.includes('です'));
  assert.equal(characters.registerPolicy('butters', ['stan']).mode, 'peer_casual');
  assert.equal(characters.registerPolicy('butters', ['garrison']).mode, 'child_to_adult');
  assert.equal(characters.registerPolicy(null, ['stan', 'kyle']).mode, 'neutral_casual');
  assert.equal(characters.registerPolicy('garrison', ['stan', 'randy']).mode, 'adult_contextual');
  assert.equal(characters.socialGroup('chef'), 'adult');
});
