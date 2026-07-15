'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('normal English subtitles skip LanguageDetector after a valid Japanese base result', async () => {
  let detectorCreates = 0;
  let translations = 0;
  let slowTranslationAborted = false;
  globalThis.SPJS = { hasChrome: false };
  globalThis.LanguageDetector = {
    async create() {
      detectorCreates++;
      return { async detect() { return [{ detectedLanguage: 'en', confidence: 1 }]; } };
    },
  };
  globalThis.Translator = {
    async availability() { return 'available'; },
    async create() {
      return {
        async translate(text, options = {}) {
          translations++;
          if (text === 'Slow.') {
            return new Promise((resolve, reject) => {
              options.signal?.addEventListener('abort', () => {
                slowTranslationAborted = true;
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          }
          if (text === 'Copy.') return text;
          return text === 'Hello.' ? 'やあ。' : '元気？';
        },
      };
    },
  };
  const translator = require('../src/translator.js');
  assert.deepEqual(await translator.translateBatch(['Hello.', 'How are you?']), ['やあ。', '元気？']);
  assert.equal(translations, 2);
  assert.equal(detectorCreates, 0);

  assert.deepEqual(await translator.translateBatch(['Copy.']), [null]);
  assert.equal(detectorCreates, 1);

  const controller = new AbortController();
  const slow = translator.translateBatch(['Slow.'], controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await slow, [null]);
  assert.equal(slowTranslationAborted, true);
  delete globalThis.SPJS;
  delete globalThis.LanguageDetector;
  delete globalThis.Translator;
});
