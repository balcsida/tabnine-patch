#!/usr/bin/env node
/**
 * Tabnine Patch
 * Patches the active Tabnine bundle to:
 * - Use AGENTS.md instead of TABNINE.md as the context file
 * - Allow MCP tools annotated as read-only in read-only mode
 * - Enable checkpointing, experimental subagents, and remote extension installs in settings.json
 *
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createHash } from 'crypto';

import {
  AGENTS_MD_MARKER,
  MCP_READONLY_MARKER,
  findAgentsMdReplacements,
  addMcpReadOnlyRule,
} from './src/patcher.mjs';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';
const READ_ONLY_POLICY = join('policies', 'read-only.toml');

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

  if (content.includes(AGENTS_MD_MARKER)) {
    console.log(`${version}: bundle already patched`);
    return true;
  }

  const checksum = createHash('sha256').update(content).digest('hex');
  const expected = KNOWN_CHECKSUMS[version];
  if (expected && checksum !== expected) {
    const msg = `${version}: checksum mismatch (got ${checksum.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`;
    if (STRICT) {
      console.error(`${msg} — refusing to patch (--strict)`);
      return false;
    }
    console.warn(`${msg} — proceeding via auto-detection`);
  }

  const replacements = findAgentsMdReplacements(content);
  if (replacements.length === 0) {
    console.error(`${version}: no TABNINE.md identifiers found`);
    return false;
  }

  console.log(`Patching ${filePath}${DRY_RUN ? ' (dry-run)' : ''}…`);

  let patched = content;
  let count = 0;
  for (const [pattern, replacement] of replacements) {
    if (patched.includes(pattern)) {
      patched = patched.replace(pattern, replacement);
      count++;
    }
  }
  console.log(`  Replaced TABNINE.md with AGENTS.md (${count}/${replacements.length} sites)`);

  if (DRY_RUN) {
    console.log(`${version}: would write bundle (dry-run)`);
    return true;
  }

  const backupPath = `${filePath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(filePath, backupPath);
  }
  writeFileSync(filePath, patched);
  console.log(`${version}: bundle patched (backup at ${backupPath})`);
  return true;
}

function patchReadOnlyPolicy(version) {
  const policyPath = join(TABNINE_DIR, version, READ_ONLY_POLICY);

  let content;
  try {
    content = readFileSync(policyPath, 'utf8');
  } catch {
    console.log(`${version}: ${policyPath} not found, skipping policy patch`);
    return false;
  }

  if (content.includes(MCP_READONLY_MARKER)) {
    console.log(`${version}: read-only policy already expanded`);
    return true;
  }

  const updated = addMcpReadOnlyRule(content);

  if (DRY_RUN) {
    console.log(`${version}: would expand read-only policy (dry-run)`);
    return true;
  }

  const backupPath = `${policyPath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(policyPath, backupPath);
  }
  writeFileSync(policyPath, updated);
  console.log(`${version}: expanded read-only policy (backup at ${backupPath})`);
  return true;
}

function applyAgentSettings() {
  const settingsPath = join(homedir(), '.tabnine/agent/settings.json');

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error(`settings.json: could not read ${settingsPath}`);
    return false;
  }

  const alreadyApplied =
    settings.general?.checkpointing?.enabled === true &&
    settings.experimental?.enableAgents === true &&
    settings.security?.blockGitExtensions === false;

  if (alreadyApplied) {
    console.log('settings.json: checkpointing, subagents, and remote extensions already enabled');
    return true;
  }

  if (DRY_RUN) {
    console.log('settings.json: would enable checkpointing, subagents, and remote extensions (dry-run)');
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
  settings.security = settings.security || {};
  settings.security.blockGitExtensions = false;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('settings.json: enabled checkpointing, subagents, and remote extensions');
  return true;
}

function activeBundleVersion() {
  const activePath = join(TABNINE_DIR, '.active');
  let active;
  try {
    active = readFileSync(activePath, 'utf8').trim();
  } catch {
    return null;
  }
  if (!active) return null;
  if (!existsSync(join(TABNINE_DIR, active, TARGET_FILE))) return null;
  return active;
}

function main() {
  if (!existsSync(TABNINE_DIR)) {
    console.error(`Error: ${TABNINE_DIR} not found`);
    process.exit(1);
  }

  const version = activeBundleVersion();
  if (!version) {
    console.error(`No active Tabnine bundle (missing or invalid ${join(TABNINE_DIR, '.active')})`);
    process.exit(1);
  }
  console.log(`Active bundle: ${version}`);

  const ok = applyPatch(version);
  patchReadOnlyPolicy(version);
  applyAgentSettings();

  if (!ok) {
    process.exit(1);
  }
  console.log('\nRestart Tabnine CLI to activate the changes.');
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
