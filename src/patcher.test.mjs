import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateHistoryTokens,
  truncateHistory,
  findAgentsMdReplacements,
  findTokenInjectionSite,
  buildTokenProtectionCode,
  AGENTS_MD_MARKER,
  TOKEN_PATCH_MARKER,
} from './patcher.mjs';

// --- estimateHistoryTokens --------------------------------------------------

test('estimator returns 0 for empty history', () => {
  assert.equal(estimateHistoryTokens([]), 0);
  assert.equal(estimateHistoryTokens(null), 0);
});

test('estimator counts ASCII text at ~bytes/3.5', () => {
  const hist = [{ parts: [{ text: 'a'.repeat(350) }] }];
  // 350 bytes / 3.5 = 100 tokens, ceiled.
  assert.equal(estimateHistoryTokens(hist), 100);
});

test('estimator counts UTF-8 bytes for multi-byte chars', () => {
  // Each 漢 is 3 bytes in UTF-8 → 100 chars = 300 bytes / 3.5 ≈ 86.
  const hist = [{ parts: [{ text: '漢'.repeat(100) }] }];
  const tokens = estimateHistoryTokens(hist);
  assert.ok(tokens >= 85 && tokens <= 90, `expected ~86, got ${tokens}`);
});

test('estimator treats function-call parts as denser than prose', () => {
  const longText = 'a'.repeat(900); // 900 / 3.5 ≈ 257
  const callPayload = 'b'.repeat(900); // serialised JSON ≈ 900 / 3 = 300
  const textHist = [{ parts: [{ text: longText }] }];
  const callHist = [{
    parts: [{ functionCall: { name: 'x', args: { v: callPayload } } }],
  }];
  assert.ok(
    estimateHistoryTokens(callHist) > estimateHistoryTokens(textHist),
    'function-call parts should count more tokens per byte than text parts',
  );
});

test('estimator skips messages without parts without throwing', () => {
  assert.equal(estimateHistoryTokens([{ role: 'user' }, {}]), 0);
});

// --- truncateHistory --------------------------------------------------------

const text = (s) => ({ role: 'user', parts: [{ text: s }] });
const modelText = (s) => ({ role: 'model', parts: [{ text: s }] });
const call = (name) => ({
  role: 'model',
  parts: [{ functionCall: { name, args: {} } }],
});
const response = (name) => ({
  role: 'user',
  parts: [{ functionResponse: { name, response: { ok: true } } }],
});

test('truncate returns history unchanged when ≤2 messages', () => {
  const hist = [text('sys'), text('hi')];
  assert.deepEqual(truncateHistory(hist, 1), hist);
});

test('truncate always preserves the first message', () => {
  const hist = [
    text('SYSTEM'),
    text('a'.repeat(2000)),
    text('b'.repeat(2000)),
    text('c'.repeat(2000)),
    text('d'),
  ];
  const out = truncateHistory(hist, 50);
  assert.equal(out[0].parts[0].text, 'SYSTEM');
});

test('truncate keeps tail (most recent) messages', () => {
  const hist = [
    text('SYSTEM'),
    text('a'.repeat(2000)),
    text('b'.repeat(2000)),
    text('LAST'),
  ];
  const out = truncateHistory(hist, 50);
  assert.equal(out[out.length - 1].parts[0].text, 'LAST');
});

test('truncate drops orphan functionResponse at head of kept range', () => {
  // Big middle messages will get evicted; without orphan-cleanup the kept
  // range would start with response('search'), which has no matching call.
  const hist = [
    text('SYSTEM'),
    call('search'),
    text('a'.repeat(5000)),
    text('b'.repeat(5000)),
    response('search'),
    text('LAST'),
  ];
  const out = truncateHistory(hist, 200);
  // First message after SYSTEM must not be a bare functionResponse.
  const firstAfterSystem = out[1];
  const isResponse = firstAfterSystem.parts.every((p) => p.functionResponse);
  assert.ok(!isResponse, 'orphan functionResponse should be dropped');
});

test('truncate keeps a recent functionCall→functionResponse pair together', () => {
  const hist = [
    text('SYSTEM'),
    text('older'),
    call('lookup'),
    response('lookup'),
    text('LAST'),
  ];
  // Target large enough to fit pair + last; old text might or might not fit.
  const out = truncateHistory(hist, 1000);
  const names = out.flatMap((m) => m.parts.map((p) =>
    p.functionCall ? `call:${p.functionCall.name}` :
    p.functionResponse ? `resp:${p.functionResponse.name}` :
    p.text));
  // If a response is kept, its call must also be kept.
  for (let i = 0; i < names.length; i++) {
    if (names[i].startsWith('resp:')) {
      const name = names[i].slice(5);
      const callBefore = names.slice(0, i).some((n) => n === `call:${name}`);
      assert.ok(callBefore, `response for ${name} kept without preceding call`);
    }
  }
});

test('truncate keeps at least one tail message even if oversize', () => {
  // A single tail message larger than the target: we still want to include
  // it (the alternative is sending nothing at all).
  const hist = [text('SYSTEM'), text('huge'.repeat(10000))];
  const out = truncateHistory(hist, 10);
  assert.equal(out.length, 2);
});

// --- findAgentsMdReplacements ----------------------------------------------

test('finds a single TABNINE.md identifier assignment', () => {
  const src = 'var nUe="TABNINE.md";';
  const repls = findAgentsMdReplacements(src);
  assert.equal(repls.length, 1);
  assert.equal(repls[0][0], 'nUe="TABNINE.md"');
  assert.ok(repls[0][1].startsWith('nUe="AGENTS.md"'));
});

test('first replacement embeds the AGENTS_MD_MARKER for idempotency', () => {
  const src = 'var nUe="TABNINE.md",rPn="TABNINE.md";';
  const repls = findAgentsMdReplacements(src);
  assert.ok(repls[0][1].includes(AGENTS_MD_MARKER));
  // Subsequent ones do not — only the first sentinel is needed.
  assert.ok(!repls[1][1].includes(AGENTS_MD_MARKER));
});

test('finds all distinct identifier assignments and the array literal', () => {
  const src = 'a="TABNINE.md";b="TABNINE.md";c="TABNINE.md";return["TABNINE.md"]';
  const repls = findAgentsMdReplacements(src);
  const patterns = repls.map((r) => r[0]);
  assert.deepEqual(patterns, [
    'a="TABNINE.md"',
    'b="TABNINE.md"',
    'c="TABNINE.md"',
    'return["TABNINE.md"]',
  ]);
});

test('handles obfuscated identifiers with $ and digits', () => {
  const src = '$4e="TABNINE.md";_x9="TABNINE.md";';
  const repls = findAgentsMdReplacements(src);
  assert.deepEqual(repls.map((r) => r[0]), [
    '$4e="TABNINE.md"',
    '_x9="TABNINE.md"',
  ]);
});

test('returns empty list when no TABNINE.md present', () => {
  assert.deepEqual(findAgentsMdReplacements('nothing here'), []);
});

// --- findTokenInjectionSite ------------------------------------------------

test('finds the post-push getHistory site (0.12.1 shape)', () => {
  const src = 'this.history.push(u);let f=this.getHistory(!0);';
  const site = findTokenInjectionSite(src);
  assert.equal(site.historyVar, 'f');
  assert.equal(site.pattern, 'this.history.push(u);let f=this.getHistory(!0);');
});

test('falls back to the standalone getHistory site (0.5.3 shape)', () => {
  const src = 'foo();let l=this.getHistory(!0);bar();';
  const site = findTokenInjectionSite(src);
  assert.equal(site.historyVar, 'l');
  assert.equal(site.pattern, 'let l=this.getHistory(!0);');
});

test('prefers the post-push form when both could match', () => {
  const src = 'let q=this.getHistory(!0);this.history.push(z);let r=this.getHistory(!0);';
  const site = findTokenInjectionSite(src);
  assert.equal(site.historyVar, 'r');
});

test('returns null when no injection site is present', () => {
  assert.equal(findTokenInjectionSite('unrelated code'), null);
});

// --- buildTokenProtectionCode ----------------------------------------------

test('built injection contains the token-patch marker', () => {
  const code = buildTokenProtectionCode('h');
  assert.ok(code.includes(TOKEN_PATCH_MARKER));
});

test('built injection assigns back to the named history variable', () => {
  const code = buildTokenProtectionCode('myHist');
  assert.ok(code.includes('myHist=truncateHistory(myHist'));
  assert.ok(code.includes('estimateHistoryTokens(myHist)'));
});

test('built injection inlines the runtime helpers', () => {
  const code = buildTokenProtectionCode('h');
  assert.ok(code.includes('function estimateHistoryTokens') ||
            code.includes('estimateHistoryTokens=function') ||
            code.includes('estimateHistoryTokens=(') ||
            code.includes('estimateHistoryTokens=h=>') ||
            /estimateHistoryTokens\s*=/.test(code));
  assert.ok(/truncateHistory\s*=/.test(code));
});

test('built injection survives a syntax check via new Function', () => {
  // Wrap with a stub `this` and a no-op call so it parses standalone.
  const code = buildTokenProtectionCode('h');
  assert.doesNotThrow(() => {
    // Wrap in a function so `this` and `return` are allowed.
    new Function('h', code + '; return h;');
  });
});
