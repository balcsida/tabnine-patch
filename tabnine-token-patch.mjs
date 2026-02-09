#!/usr/bin/env node
/**
 * Tabnine Token Limit Protection Patch
 * Automatically patches tabnine.mjs to handle "prompt is too long" errors
 * Usage: node tabnine-token-patch.mjs
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const TABNINE_DIR = join(homedir(), '.tabnine/agent/.bundles');
const TARGET_FILE = 'tabnine.mjs';
const SUPPORTED_VERSION = '0.3.21';
const EXPECTED_CHECKSUM = 'daf72ca6cd726e2be7a733decf9d8ef65fbcf77a40deae62979f61ddcf5a681e';
const TOKEN_PATCH_MARKER = 'TOKEN_LIMIT=180000';
const ANALYTICS_PATCH_MARKER = 'ANALYTICS_HOST_GUARD';

// Token limit protection code to inject
const TOKEN_PROTECTION_CODE = `const TOKEN_LIMIT=180000,TOKEN_TRUNCATE_TARGET=140000,estimateHistoryTokens=(hist)=>{let tokens=0;for(const msg of hist){if(!msg.parts)continue;for(const part of msg.parts){if(typeof part.text==='string'){for(const ch of part.text){tokens+=ch.codePointAt(0)<=127?0.25:1.3;}}else{tokens+=JSON.stringify(part).length/4;}}}return Math.ceil(tokens);},truncateHistory=(hist,targetTokens)=>{if(hist.length<=2)return hist;const firstMsg=hist[0];let remaining=hist.slice(1);while(remaining.length>1&&estimateHistoryTokens([firstMsg,...remaining])>targetTokens){remaining=remaining.slice(1);}return[firstMsg,...remaining];};if(estimateHistoryTokens(s)>TOKEN_LIMIT){Ee.warn("Token limit protection: truncating history...");s=truncateHistory(s,TOKEN_TRUNCATE_TARGET);this.history=s.slice();}`;

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
  if (content.includes(TOKEN_PATCH_MARKER) && content.includes(ANALYTICS_PATCH_MARKER)) {
    console.log(`All patches already applied to ${filePath}`);
    process.exit(0);
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

  // Apply patches
  let patchedContent = content;
  let patchCount = 0;

  // Patch 1: Inject token limit protection after getHistory
  if (!patchedContent.includes(TOKEN_PATCH_MARKER)) {
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
  } else {
    console.log('  - Token limit protection already applied');
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
  } else if (!patchedContent.includes('m=f3r.maxAttempts+1')) {
    console.error('  ✗ Could not find maxAttempts pattern');
  } else {
    console.log('  - maxAttempts retry already applied');
  }

  // Patch 3: Resolve tabnineHost from settings when missing in config
  // Fixes "tabnineHost is required" error during extension install/enable
  // by reading the host from settings.json as a fallback, so the analytics event still gets sent
  if (!patchedContent.includes(ANALYTICS_PATCH_MARKER)) {
    const analyticsSendPattern = 'async send(e){if(process.env.TABNINE_ANALYTICS_DISABLED!=="true")try{let n=`${this.config.getTabnineHost()';
    if (patchedContent.includes(analyticsSendPattern)) {
      patchedContent = patchedContent.replace(
        analyticsSendPattern,
        'async send(e){/*ANALYTICS_HOST_GUARD*/if(process.env.TABNINE_ANALYTICS_DISABLED!=="true")try{if(!this.config.tabnineHost){try{let _o=await import("node:os"),_p=await import("node:path"),_f=await import("node:fs"),_c=JSON.parse(_f.readFileSync(_p.join(_o.homedir(),".tabnine/agent","settings.json"),"utf8"));if(_c.general?.tabnineHost)this.config.tabnineHost=_c.general.tabnineHost;else return;}catch{return;}}let n=`${this.config.getTabnineHost()'
      );
      patchCount++;
      console.log('  ✓ Added analytics tabnineHost settings fallback');
    } else {
      console.error('  ✗ Could not find analytics send pattern');
    }
  } else {
    console.log('  - Analytics tabnineHost settings fallback already applied');
  }

  if (patchCount === 0) {
    console.error('Error: No patches applied. The file format may have changed.');
    process.exit(1);
  }

  // Write patched file
  writeFileSync(filePath, patchedContent);

  console.log(`\nPatch applied successfully! (${patchCount} patches)`);
  console.log(`Backup saved to: ${backupPath}`);
  console.log('Restart Tabnine CLI to activate the changes.');
}

applyPatch();
