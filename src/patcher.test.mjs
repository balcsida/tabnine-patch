import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findAgentsMdReplacements,
  addMcpReadOnlyRule,
  findGeminiExtensionFallback,
  findAnalyticsHostGuard,
  AGENTS_MD_MARKER,
  MCP_READONLY_MARKER,
  GEMINI_EXT_FALLBACK_MARKER,
  ANALYTICS_HOST_GUARD_MARKER,
} from './patcher.mjs';

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

// --- addMcpReadOnlyRule -----------------------------------------------------

const sampleReadOnlyToml = `# Comment header.

[[rule]]
toolName = "glob"
decision = "allow"
priority = 50

[[rule]]
toolName = "read_file"
decision = "allow"
priority = 50
`;

test('appends an MCP-readonly rule with the marker', () => {
  const out = addMcpReadOnlyRule(sampleReadOnlyToml);
  assert.ok(out.includes(MCP_READONLY_MARKER), 'marker missing');
  assert.ok(out.includes('mcpName = "*"'), 'mcpName="*" missing');
  assert.ok(out.includes('readOnlyHint = true'), 'readOnlyHint=true missing');
  assert.ok(out.includes('decision = "allow"'), 'decision=allow missing');
});

test('preserves existing rules verbatim', () => {
  const out = addMcpReadOnlyRule(sampleReadOnlyToml);
  assert.ok(out.includes('toolName = "glob"'));
  assert.ok(out.includes('toolName = "read_file"'));
});

test('appends rule at the end (after existing rules)', () => {
  const out = addMcpReadOnlyRule(sampleReadOnlyToml);
  const lastReadFileIdx = out.lastIndexOf('toolName = "read_file"');
  const newRuleIdx = out.indexOf('mcpName = "*"');
  assert.ok(newRuleIdx > lastReadFileIdx, 'new rule should be after existing rules');
});

test('is idempotent: running twice yields same content', () => {
  const once = addMcpReadOnlyRule(sampleReadOnlyToml);
  const twice = addMcpReadOnlyRule(once);
  assert.equal(once, twice);
});

test('does not add the rule if marker already present', () => {
  const already = sampleReadOnlyToml + `\n# ${MCP_READONLY_MARKER}\n[[rule]]\nfoo = "bar"\n`;
  const out = addMcpReadOnlyRule(already);
  assert.equal(out, already);
});

test('produces a valid TOML body (no syntax landmines)', () => {
  // Loose check: every [[rule]] block should be followed by at least one
  // key=value line before the next blank-line break.
  const out = addMcpReadOnlyRule(sampleReadOnlyToml);
  const blocks = out.split(/\[\[rule\]\]/).slice(1);
  for (const block of blocks) {
    assert.match(block, /^[\s\S]*?\w+\s*=\s*\S/, 'block has no key=value');
  }
});

// --- findGeminiExtensionFallback -------------------------------------------

const sampleLoadExt =
  'async loadExtensionConfig(e){let r=Ip.join(e,Eoe);' +
  'if(!c_.existsSync(r))throw new Error(`Configuration file not found at ${r}`);' +
  'try{let n=await c_.promises.readFile(r,"utf-8")}';

test('wraps loadExtensionConfig with a gemini-extension.json fallback', () => {
  const repls = findGeminiExtensionFallback(sampleLoadExt);
  assert.equal(repls.length, 1);
  const [pattern, replacement] = repls[0];
  assert.ok(pattern.startsWith('async loadExtensionConfig(e)'));
  assert.ok(replacement.includes('"gemini-extension.json"'));
  assert.ok(replacement.includes(GEMINI_EXT_FALLBACK_MARKER));
  // Still throws when neither file exists.
  assert.ok(replacement.includes('Configuration file not found at'));
});

test('preserves the original minified identifiers', () => {
  const src =
    'async loadExtensionConfig($x){let q_=A2a.join($x,fNa);' +
    'if(!z7.existsSync(q_))throw new Error(`Configuration file not found at ${q_}`);try{}';
  const [[, replacement]] = findGeminiExtensionFallback(src);
  assert.ok(replacement.includes('A2a.join($x,"gemini-extension.json")'));
  assert.ok(replacement.includes('q_=_gef'));
  assert.ok(replacement.includes('z7.existsSync'));
});

test('applying the replacement produces valid JS that keeps the try-block', () => {
  const [[pattern, replacement]] = findGeminiExtensionFallback(sampleLoadExt);
  const out = sampleLoadExt.replace(pattern, replacement);
  // The `try{` that originally followed the guard must still be there.
  assert.ok(out.includes('try{let n=await c_.promises.readFile'));
  // The injected block closes with a matching brace before `try{`.
  assert.match(out, /\}\/\*GEMINI_EXT_FALLBACK\*\/try\{/);
});

test('is idempotent: returns [] when marker already present', () => {
  const already = sampleLoadExt + `/*${GEMINI_EXT_FALLBACK_MARKER}*/`;
  assert.deepEqual(findGeminiExtensionFallback(already), []);
});

test('returns [] when loadExtensionConfig pattern is absent', () => {
  assert.deepEqual(findGeminiExtensionFallback('unrelated content'), []);
});

// --- findAnalyticsHostGuard -------------------------------------------------

const sampleSend =
  'async send(e){if(process.env.TABNINE_ANALYTICS_DISABLED!=="true")try{' +
  'let r=this.config.getTabnineHost().replace(/\\/$/,""),n=`${r}/notify/v1`;' +
  '}catch(r){console.error?.(`Failed to send analytics event ${e.kind}:`,r)}}';

test('guards send() with a tabnineHost presence check', () => {
  const repls = findAnalyticsHostGuard(sampleSend);
  assert.equal(repls.length, 1);
  const [pattern, replacement] = repls[0];
  assert.ok(pattern.startsWith('async send(e){'));
  assert.ok(replacement.includes('this.config.tabnineHost'));
  assert.ok(replacement.includes(ANALYTICS_HOST_GUARD_MARKER));
});

test('short-circuits before entering the try-block (no getTabnineHost call)', () => {
  const [[pattern, replacement]] = findAnalyticsHostGuard(sampleSend);
  const patched = sampleSend.replace(pattern, replacement);
  // The `try{` must still follow the guard expression.
  assert.match(patched, /&&this\.config\.tabnineHost[^)]*\)try\{/);
  // The original TABNINE_ANALYTICS_DISABLED env check is preserved.
  assert.ok(patched.includes('process.env.TABNINE_ANALYTICS_DISABLED'));
});

test('preserves the original minified parameter name', () => {
  const src =
    'async send($7){if(process.env.TABNINE_ANALYTICS_DISABLED!=="true")try{}catch(r){}}';
  const [[, replacement]] = findAnalyticsHostGuard(src);
  assert.ok(replacement.startsWith('async send($7){'));
});

test('is idempotent: returns [] when marker already present', () => {
  const already = sampleSend + `/*${ANALYTICS_HOST_GUARD_MARKER}*/`;
  assert.deepEqual(findAnalyticsHostGuard(already), []);
});

test('returns [] when the send pattern is absent', () => {
  assert.deepEqual(findAnalyticsHostGuard('nothing here'), []);
});
