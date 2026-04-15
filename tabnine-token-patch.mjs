#!/usr/bin/env node
/**
 * Tabnine Patch
 * Patches tabnine.mjs to:
 * - Use AGENTS.md instead of TABNINE.md as the context file
 * - Pre-emptively estimate and truncate token history to avoid "prompt is too long" errors
 * - Enable checkpointing (shadow git snapshots + conversation checkpoints)
 *
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createHash } from 'crypto';

import {
  AGENTS_MD_MARKER,
  TOKEN_PATCH_MARKER,
  findAgentsMdReplacements,
  findTokenInjectionSite,
  buildTokenProtectionCode,
} from './src/patcher.mjs';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';

// Known-good SHA-256 checksums of unpatched bundles. Auto-detection is the
// source of truth; these are advisory — a mismatch downgrades the run to a
// warning unless --strict is passed.
const KNOWN_CHECKSUMS = {
  '0.5.3':  'd38639c91f9074cd9b34e98897f44b2efed677e2976c4804186ee6eaffdc72c7',
  '0.12.1': '1d29d8835d2281cfea5436eb497b353cf8f7f7387a02afcef8d1b43af4793334',
};

const STRICT = process.argv.includes('--strict');
const DRY_RUN = process.argv.includes('--dry-run');

function applyPatch(version) {
  const filePath = join(TABNINE_DIR, version, TARGET_FILE);

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.log(`${version}: ${filePath} not found, skipping`);
    return false;
  }

  const hasAgentsMarker = content.includes(AGENTS_MD_MARKER);
  const hasTokenMarker = content.includes(TOKEN_PATCH_MARKER);
  if (hasAgentsMarker && hasTokenMarker) {
    console.log(`${version}: all patches already applied`);
    return true;
  }

  const checksum = createHash('sha256').update(content).digest('hex');
  const expected = KNOWN_CHECKSUMS[version];
  if (expected && !hasAgentsMarker && !hasTokenMarker && checksum !== expected) {
    const msg = `${version}: checksum mismatch (got ${checksum.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`;
    if (STRICT) {
      console.error(`${msg} — refusing to patch (--strict)`);
      return false;
    }
    console.warn(`${msg} — proceeding via auto-detection`);
  }

  const replacements = findAgentsMdReplacements(content);
  const injection = findTokenInjectionSite(content);

  if (!hasAgentsMarker && replacements.length === 0) {
    console.error(`${version}: no TABNINE.md identifiers found`);
    return false;
  }
  if (!hasTokenMarker && !injection) {
    console.error(`${version}: no getHistory injection site found`);
    return false;
  }

  console.log(`Patching ${filePath}${DRY_RUN ? ' (dry-run)' : ''}…`);

  let patched = content;
  let patchCount = 0;

  if (!hasAgentsMarker) {
    let count = 0;
    for (const [pattern, replacement] of replacements) {
      if (patched.includes(pattern)) {
        patched = patched.replace(pattern, replacement);
        count++;
      }
    }
    if (count > 0) {
      patchCount++;
      console.log(`  Replaced TABNINE.md with AGENTS.md (${count}/${replacements.length} sites)`);
    }
  } else {
    console.log('  AGENTS.md preference already applied');
  }

  if (!hasTokenMarker) {
    const code = buildTokenProtectionCode(injection.historyVar);
    patched = patched.replace(injection.pattern, injection.pattern + code);
    patchCount++;
    console.log(`  Injected token limit protection (history var: ${injection.historyVar})`);
  } else {
    console.log('  Token limit protection already applied');
  }

  if (patchCount === 0) {
    console.error(`${version}: no patches applied`);
    return false;
  }

  if (DRY_RUN) {
    console.log(`${version}: ${patchCount} patches would apply (dry-run, no files written)`);
    return true;
  }

  const backupPath = `${filePath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(filePath, backupPath);
  }
  writeFileSync(filePath, patched);
  console.log(`${version}: ${patchCount} patches applied (backup at ${backupPath})`);
  return true;
}

function enableCheckpointing() {
  const settingsPath = join(homedir(), '.tabnine/agent/settings.json');

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error(`settings.json: could not read ${settingsPath}`);
    return false;
  }

  if (settings.general?.checkpointing?.enabled === true && settings.experimental?.enableAgents === true) {
    console.log('settings.json: checkpointing and subagents already enabled');
    return true;
  }

  if (DRY_RUN) {
    console.log('settings.json: would enable checkpointing and subagents (dry-run)');
    return true;
  }

  const backupPath = `${settingsPath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(settingsPath, backupPath);
  }

  settings.general = settings.general || {};
  settings.general.checkpointing = { enabled: true };
  settings.experimental = settings.experimental || {};
  settings.experimental.enableAgents = true;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('settings.json: enabled checkpointing and subagents');
  return true;
}

function main() {
  let installed = [];
  try {
    installed = readdirSync(TABNINE_DIR);
  } catch {
    console.error(`Error: ${TABNINE_DIR} not found`);
    process.exit(1);
  }

  // Patch every bundle that contains a tabnine.mjs. Auto-detection makes the
  // VERSIONS allow-list unnecessary; unknown versions just get a checksum
  // warning.
  const candidates = installed.filter((v) =>
    existsSync(join(TABNINE_DIR, v, TARGET_FILE)),
  );
  if (candidates.length === 0) {
    console.error(`No tabnine.mjs found under ${TABNINE_DIR}`);
    console.error(`Installed: ${installed.join(', ') || '(none)'}`);
    process.exit(1);
  }

  let patched = 0;
  for (const version of candidates) {
    if (applyPatch(version)) patched++;
  }

  enableCheckpointing();

  if (patched === 0) {
    process.exit(1);
  }
  console.log('\nRestart Tabnine CLI to activate the changes.');
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
