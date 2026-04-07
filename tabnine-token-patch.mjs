#!/usr/bin/env node
/**
 * Tabnine Patch
 * Patches tabnine.mjs to:
 * - Use AGENTS.md instead of TABNINE.md as the context file
 * - Pre-emptively estimate and truncate token history to avoid "prompt is too long" errors
 * - Enable checkpointing (shadow git snapshots + conversation checkpoints)
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';
const SUPPORTED_VERSION = '0.5.3';
const EXPECTED_CHECKSUM = 'd38639c91f9074cd9b34e98897f44b2efed677e2976c4804186ee6eaffdc72c7';
const AGENTS_MD_MARKER = 'AGENTS_MD_PREFERRED';
const TOKEN_PATCH_MARKER = 'TOKEN_LIMIT=180000';

// Token limit protection code to inject after getHistory
const TOKEN_PROTECTION_CODE = `const TOKEN_LIMIT=180000,TOKEN_TRUNCATE_TARGET=140000,estimateHistoryTokens=(hist)=>{let tokens=0;for(const msg of hist){if(!msg.parts)continue;for(const part of msg.parts){if(typeof part.text==='string'){for(const ch of part.text){tokens+=ch.codePointAt(0)<=127?0.25:1.3;}}else{tokens+=JSON.stringify(part).length/4;}}}return Math.ceil(tokens);},truncateHistory=(hist,targetTokens)=>{if(hist.length<=2)return hist;const firstMsg=hist[0];let remaining=hist.slice(1);while(remaining.length>1&&estimateHistoryTokens([firstMsg,...remaining])>targetTokens){remaining=remaining.slice(1);}return[firstMsg,...remaining];};if(estimateHistoryTokens(l)>TOKEN_LIMIT){Ee.warn("Token limit protection: truncating history...");l=truncateHistory(l,TOKEN_TRUNCATE_TARGET);this.history=l.slice();}`;

function applyPatch() {
  const filePath = join(TABNINE_DIR, SUPPORTED_VERSION, TARGET_FILE);

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Error: ${filePath} not found`);
    console.error(`This patcher only supports Tabnine CLI version ${SUPPORTED_VERSION}.`);
    process.exit(1);
  }

  // Check if all patches already applied
  if (content.includes(AGENTS_MD_MARKER) && content.includes(TOKEN_PATCH_MARKER)) {
    console.log(`All patches already applied to ${filePath}`);
    return;
  }

  // Verify checksum of unpatched file
  const checksum = createHash('sha256').update(content).digest('hex');
  if (checksum !== EXPECTED_CHECKSUM) {
    console.error(`Error: Checksum mismatch for ${filePath}`);
    console.error(`  Expected: ${EXPECTED_CHECKSUM}`);
    console.error(`  Got:      ${checksum}`);
    console.error('The file may have been modified or belongs to an unsupported version.');
    process.exit(1);
  }

  console.log(`Patching ${filePath}...`);

  // Create backup
  const backupPath = `${filePath}.bak`;
  copyFileSync(filePath, backupPath);

  let patchedContent = content;
  let patchCount = 0;

  // Patch 1: Replace TABNINE.md with AGENTS.md
  if (!patchedContent.includes(AGENTS_MD_MARKER)) {
    const replacements = [
      ['nUe="TABNINE.md"', 'nUe="AGENTS.md"/*AGENTS_MD_PREFERRED*/'],
      ['rPn="TABNINE.md"', 'rPn="AGENTS.md"'],
      ['DMt="TABNINE.md"', 'DMt="AGENTS.md"'],
      ['return["TABNINE.md"]', 'return["AGENTS.md"]'],
    ];
    let count = 0;
    for (const [pattern, replacement] of replacements) {
      if (patchedContent.includes(pattern)) {
        patchedContent = patchedContent.replace(pattern, replacement);
        count++;
      }
    }
    if (count > 0) {
      patchCount++;
      console.log(`  ✓ Replaced TABNINE.md with AGENTS.md (${count} occurrences)`);
    } else {
      console.error('  ✗ Could not find TABNINE.md patterns');
    }
  } else {
    console.log('  - AGENTS.md preference already applied');
  }

  // Patch 2: Inject token limit protection after getHistory
  if (!patchedContent.includes(TOKEN_PATCH_MARKER)) {
    const getHistoryPattern = 'let l=this.getHistory(!0);';
    if (patchedContent.includes(getHistoryPattern)) {
      patchedContent = patchedContent.replace(
        getHistoryPattern,
        getHistoryPattern + TOKEN_PROTECTION_CODE
      );
      patchCount++;
      console.log('  ✓ Injected token limit protection');
    } else {
      console.error('  ✗ Could not find getHistory pattern');
    }
  } else {
    console.log('  - Token limit protection already applied');
  }

  if (patchCount === 0) {
    console.error('Error: No patches applied. The file format may have changed.');
    process.exit(1);
  }

  writeFileSync(filePath, patchedContent);
  console.log(`\nPatch applied successfully! (${patchCount} patches)`);
  console.log(`Backup saved to: ${backupPath}`);
  console.log('Restart Tabnine CLI to activate the changes.');
}

function enableCheckpointing() {
  const settingsPath = join(homedir(), '.tabnine/agent/settings.json');

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error(`Error: Could not read ${settingsPath}`);
    return false;
  }

  if (settings.general?.checkpointing?.enabled === true && settings.experimental?.enableAgents === true) {
    console.log('  - Checkpointing and subagents already enabled in settings.json');
    return true;
  }

  // Backup settings
  const backupPath = `${settingsPath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(settingsPath, backupPath);
  }

  settings.general = settings.general || {};
  settings.general.checkpointing = { enabled: true };

  settings.experimental = settings.experimental || {};
  settings.experimental.enableAgents = true;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('  ✓ Enabled checkpointing in settings.json');
  console.log('  ✓ Enabled subagents in settings.json');
  return true;
}

applyPatch();
enableCheckpointing();
