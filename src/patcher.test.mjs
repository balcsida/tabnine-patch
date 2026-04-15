import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findAgentsMdReplacements,
  addMcpReadOnlyRule,
  AGENTS_MD_MARKER,
  MCP_READONLY_MARKER,
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
