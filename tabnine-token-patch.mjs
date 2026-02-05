#!/usr/bin/env node
/**
 * Tabnine Token Limit Protection Patch
 * Automatically patches tabnine.mjs to handle "prompt is too long" errors
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';
const PATCH_MARKER = 'TOKEN_LIMIT=180000';

// Token limit protection code to inject
const TOKEN_PROTECTION_CODE = `const TOKEN_LIMIT=180000,TOKEN_TRUNCATE_TARGET=140000,estimateHistoryTokens=(hist)=>{let tokens=0;for(const msg of hist){if(!msg.parts)continue;for(const part of msg.parts){if(typeof part.text==='string'){for(const ch of part.text){tokens+=ch.codePointAt(0)<=127?0.25:1.3;}}else{tokens+=JSON.stringify(part).length/4;}}}return Math.ceil(tokens);},truncateHistory=(hist,targetTokens)=>{if(hist.length<=2)return hist;const firstMsg=hist[0];let remaining=hist.slice(1);while(remaining.length>1&&estimateHistoryTokens([firstMsg,...remaining])>targetTokens){remaining=remaining.slice(1);}return[firstMsg,...remaining];};if(estimateHistoryTokens(s)>TOKEN_LIMIT){Ee.warn("Token limit protection: truncating history...");s=truncateHistory(s,TOKEN_TRUNCATE_TARGET);this.history=s.slice();}`;

function findLatestBundle() {
  try {
    const bundles = readdirSync(TABNINE_DIR)
      .filter(f => /^\d+\.\d+\.\d+$/.test(f))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        return (aMajor - bMajor) || (aMinor - bMinor) || (aPatch - bPatch);
      });
    return bundles[bundles.length - 1];
  } catch (e) {
    return null;
  }
}

function applyPatch() {
  // Find latest bundle
  const latestBundle = findLatestBundle();
  if (!latestBundle) {
    console.error(`Error: No Tabnine bundle found in ${TABNINE_DIR}`);
    process.exit(1);
  }

  const filePath = join(TABNINE_DIR, latestBundle, TARGET_FILE);

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Error: ${filePath} not found`);
    process.exit(1);
  }

  // Check if already patched
  if (content.includes(PATCH_MARKER)) {
    console.log(`Patch already applied to ${filePath}`);
    process.exit(0);
  }

  console.log(`Patching ${filePath}...`);

  // Create backup
  const backupPath = `${filePath}.bak`;
  copyFileSync(filePath, backupPath);

  // Apply patches
  let patchedContent = content;
  let patchCount = 0;

  // Patch 1: Inject token limit protection after getHistory
  const getHistoryPattern = 'let s=this.getHistory(!0);';
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

  // Patch 2: Increase maxAttempts for retry
  const maxAttemptsPattern = 'm=f3r.maxAttempts';
  if (patchedContent.includes(maxAttemptsPattern)) {
    patchedContent = patchedContent.replace(
      maxAttemptsPattern,
      'm=f3r.maxAttempts+1'
    );
    patchCount++;
    console.log('  ✓ Increased maxAttempts for retry');
  } else {
    console.error('  ✗ Could not find maxAttempts pattern');
  }

  if (patchCount === 0) {
    console.error('Error: No patches applied. The file format may have changed.');
    process.exit(1);
  }

  // Write patched file
  writeFileSync(filePath, patchedContent);

  console.log(`\nPatch applied successfully! (${patchCount}/2 patches)`);
  console.log(`Backup saved to: ${backupPath}`);
  console.log('Restart Tabnine CLI to activate the changes.');
}

applyPatch();
