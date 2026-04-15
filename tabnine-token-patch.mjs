#!/usr/bin/env node
/**
 * Tabnine Patch
 * Patches tabnine.mjs to:
 * - Use AGENTS.md instead of TABNINE.md as the context file
 * - Pre-emptively estimate and truncate token history to avoid "prompt is too long" errors
 * - Enable checkpointing (shadow git snapshots + conversation checkpoints)
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';
const AGENTS_MD_MARKER = 'AGENTS_MD_PREFERRED';
const TOKEN_PATCH_MARKER = 'TOKEN_LIMIT=180000';

const tokenProtectionCode = (historyVar, logger) =>
  `const TOKEN_LIMIT=180000,TOKEN_TRUNCATE_TARGET=140000,estimateHistoryTokens=(hist)=>{let tokens=0;for(const msg of hist){if(!msg.parts)continue;for(const part of msg.parts){if(typeof part.text==='string'){for(const ch of part.text){tokens+=ch.codePointAt(0)<=127?0.25:1.3;}}else{tokens+=JSON.stringify(part).length/4;}}}return Math.ceil(tokens);},truncateHistory=(hist,targetTokens)=>{if(hist.length<=2)return hist;const firstMsg=hist[0];let remaining=hist.slice(1);while(remaining.length>1&&estimateHistoryTokens([firstMsg,...remaining])>targetTokens){remaining=remaining.slice(1);}return[firstMsg,...remaining];};if(estimateHistoryTokens(${historyVar})>TOKEN_LIMIT){${logger}.warn("Token limit protection: truncating history...");${historyVar}=truncateHistory(${historyVar},TOKEN_TRUNCATE_TARGET);this.history=${historyVar}.slice();}`;

// Per-version patch recipes. Obfuscated identifiers change between bundles.
const VERSIONS = {
  '0.5.3': {
    checksum: 'd38639c91f9074cd9b34e98897f44b2efed677e2976c4804186ee6eaffdc72c7',
    agentsMdReplacements: [
      ['nUe="TABNINE.md"', `nUe="AGENTS.md"/*${AGENTS_MD_MARKER}*/`],
      ['rPn="TABNINE.md"', 'rPn="AGENTS.md"'],
      ['DMt="TABNINE.md"', 'DMt="AGENTS.md"'],
      ['return["TABNINE.md"]', 'return["AGENTS.md"]'],
    ],
    tokenInjection: {
      pattern: 'let l=this.getHistory(!0);',
      historyVar: 'l',
      logger: 'Ee',
    },
  },
  '0.12.1': {
    checksum: '1d29d8835d2281cfea5436eb497b353cf8f7f7387a02afcef8d1b43af4793334',
    agentsMdReplacements: [
      ['ume="TABNINE.md"', `ume="AGENTS.md"/*${AGENTS_MD_MARKER}*/`],
      ['$4e="TABNINE.md"', '$4e="AGENTS.md"'],
      ['b3t="TABNINE.md"', 'b3t="AGENTS.md"'],
      ['return["TABNINE.md"]', 'return["AGENTS.md"]'],
    ],
    tokenInjection: {
      pattern: 'this.history.push(u);let f=this.getHistory(!0);',
      historyVar: 'f',
      logger: 'V',
    },
  },
};

function applyPatch(version, recipe) {
  const filePath = join(TABNINE_DIR, version, TARGET_FILE);

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.log(`Skipping ${version}: ${filePath} not found`);
    return false;
  }

  if (content.includes(AGENTS_MD_MARKER) && content.includes(TOKEN_PATCH_MARKER)) {
    console.log(`${version}: all patches already applied`);
    return true;
  }

  const checksum = createHash('sha256').update(content).digest('hex');
  const alreadyPatched = content.includes(AGENTS_MD_MARKER) || content.includes(TOKEN_PATCH_MARKER);
  if (!alreadyPatched && checksum !== recipe.checksum) {
    console.error(`${version}: checksum mismatch`);
    console.error(`  Expected: ${recipe.checksum}`);
    console.error(`  Got:      ${checksum}`);
    console.error('  File may have been modified or this is an unrecognized build.');
    return false;
  }

  console.log(`Patching ${filePath}...`);

  const backupPath = `${filePath}.bak`;
  if (!existsSync(backupPath)) {
    copyFileSync(filePath, backupPath);
  }

  let patched = content;
  let patchCount = 0;

  if (!patched.includes(AGENTS_MD_MARKER)) {
    let count = 0;
    for (const [pattern, replacement] of recipe.agentsMdReplacements) {
      if (patched.includes(pattern)) {
        patched = patched.replace(pattern, replacement);
        count++;
      }
    }
    if (count > 0) {
      patchCount++;
      console.log(`  Replaced TABNINE.md with AGENTS.md (${count}/${recipe.agentsMdReplacements.length} patterns)`);
    } else {
      console.error('  Could not find any TABNINE.md patterns');
    }
  } else {
    console.log('  AGENTS.md preference already applied');
  }

  if (!patched.includes(TOKEN_PATCH_MARKER)) {
    const { pattern, historyVar, logger } = recipe.tokenInjection;
    if (patched.includes(pattern)) {
      patched = patched.replace(pattern, pattern + tokenProtectionCode(historyVar, logger));
      patchCount++;
      console.log('  Injected token limit protection');
    } else {
      console.error('  Could not find getHistory injection pattern');
    }
  } else {
    console.log('  Token limit protection already applied');
  }

  if (patchCount === 0) {
    console.error(`${version}: no patches applied`);
    return false;
  }

  writeFileSync(filePath, patched);
  console.log(`${version}: patch applied (${patchCount} patches, backup at ${backupPath})`);
  return true;
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
    console.log('settings.json: checkpointing and subagents already enabled');
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

  const known = installed.filter(v => VERSIONS[v]);
  const unknown = installed.filter(v => !VERSIONS[v]);

  if (known.length === 0) {
    console.error(`No supported Tabnine CLI version found in ${TABNINE_DIR}`);
    console.error(`Installed: ${installed.join(', ') || '(none)'}`);
    console.error(`Supported: ${Object.keys(VERSIONS).join(', ')}`);
    process.exit(1);
  }

  let patched = 0;
  for (const version of known) {
    if (applyPatch(version, VERSIONS[version])) patched++;
  }
  for (const version of unknown) {
    console.log(`Skipping ${version}: unsupported version`);
  }

  enableCheckpointing();

  if (patched === 0) {
    process.exit(1);
  }
  console.log('\nRestart Tabnine CLI to activate the changes.');
}

main();
