'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('manifest loads character and natural translation layers before content', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/characters.js') < scripts.indexOf('src/natural-translator.js'));
  assert.ok(scripts.indexOf('src/natural-translator.js') < scripts.indexOf('src/content.js'));
  assert.equal(manifest.version, '1.2.3');
});

test('AI natural translation is enabled by default and wired to popup controls', () => {
  const common = fs.readFileSync(path.join(root, 'src/common.js'), 'utf8');
  const popupJs = fs.readFileSync(path.join(root, 'popup/popup.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
  assert.match(common, /aiNaturalTranslation:\s*true/);
  assert.match(popupJs, /aiNaturalTranslation:\s*true/);
  assert.match(popupHtml, /id="aiNaturalTranslation"/);
  assert.match(popupHtml, /id="prepareAiModel"/);
  assert.match(popupHtml, /id="aiModelStatus"/);
});

test('content translation uses a one-cue live fast lane and cancels stale workers', () => {
  const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
  assert.match(content, /const BASIC_BATCH_SIZE = 1/);
  assert.match(content, /const BASE_CACHE_PREFIX = 'v2\|'/);
  assert.match(content, /baseCacheKey\(batch\[i\]\)/);
  assert.match(content, /prioritizeTargets\(pending, t0, BASIC_BATCH_SIZE\)/);
  assert.match(content, /const batchSize = liveCuePending \? 1/);
  assert.match(content, /allPending\.filter\(cue => cue\.ja\)/);
  assert.match(content, /baseJa: cue\.ja \|\| null/);
  assert.match(content, /status = 'base-fallback'/);
  assert.match(content, /result\.fallbackValues\?\.get\(cue\.key\)/);
  assert.match(content, /submittedBaseHash !== currentBaseHash/);
  assert.match(content, /base-fallback-retry-limit/);
  assert.match(content, /completeBaseFallback\(cue, cue\.ja/);
  assert.match(content, /SPJS_TR\.translateBatch\(texts, workerController\.signal\)/);
  assert.match(content, /function cancelBaseWorker\(\)/);
  assert.match(content, /reprioritizeBaseTranslation\(\)/);
  assert.match(content, /warmup\('available', workerController\.signal\)/);
  assert.match(content, /signal: workerController\.signal/);
  assert.match(content, /function cancelNaturalWorker\(\)/);
  assert.match(content, /result\.errors\?\.includes\('TimeoutError'\)/);
  assert.match(content, /cancelExplanation\(false, false\);[\s\S]*naturalPauseUntil = 0/);
});

test('base translation attempts en-to-ja before optional language detection', () => {
  const translator = fs.readFileSync(path.join(root, 'src/translator.js'), 'utf8');
  const offscreen = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');
  for (const source of [translator, offscreen]) {
    const smart = source.slice(source.indexOf('async function translateSmart'));
    assert.ok(smart.indexOf('translator.translate(text,') < smart.indexOf('translateDetectedForeign(text,'));
    assert.match(source, /translate\(text, \{ signal: linkedSignal \}\)/);
  }
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(background, /spjs-cancel-translate/);
  assert.match(offscreen, /spjs-off-cancel-translate/);
});

test('explanations clone a clean session and remain cancellable', () => {
  const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
  assert.match(content, /base\.clone\(\{ signal \}\)/);
  assert.match(content, /promptStreaming\([\s\S]*\{ signal: controller\.signal \}/);
  assert.match(content, /explainViaGeminiAPI\(ctx, target, controller\.signal\)/);
  assert.match(content, /cancelExplanation\(true\)/);
});
