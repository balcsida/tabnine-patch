// Pure helpers for the Tabnine patcher. Side-effect free so they can be unit
// tested and so the runtime helpers can be serialised into the injected
// bundle code via Function.prototype.toString.

export const AGENTS_MD_MARKER = 'AGENTS_MD_PREFERRED';
export const TOKEN_PATCH_MARKER = 'TOKEN_LIMIT=180000';
export const MCP_READONLY_MARKER = 'MCP_READONLY_PATCH';

export const DEFAULT_TOKEN_LIMIT = 180000;
export const DEFAULT_TOKEN_TARGET = 140000;

// --- Runtime helpers (serialised into the bundle) ---------------------------

export function estimateHistoryTokens(hist) {
  if (!hist || !hist.length) return 0;
  const enc = new TextEncoder();
  let tokens = 0;
  for (const msg of hist) {
    if (!msg || !msg.parts) continue;
    for (const part of msg.parts) {
      if (typeof part.text === 'string') {
        tokens += enc.encode(part.text).length / 3.5;
      } else {
        tokens += enc.encode(JSON.stringify(part)).length / 3.0;
      }
    }
  }
  return Math.ceil(tokens);
}

export function truncateHistory(hist, targetTokens) {
  if (!hist || hist.length <= 2) return hist;
  const first = hist[0];
  const firstTokens = estimateHistoryTokens([first]);

  const kept = [];
  let tokens = firstTokens;
  for (let i = hist.length - 1; i >= 1; i--) {
    const msg = hist[i];
    const msgTokens = estimateHistoryTokens([msg]);
    if (tokens + msgTokens > targetTokens && kept.length > 0) break;
    kept.unshift(msg);
    tokens += msgTokens;
  }

  const isFunctionResponseOnly = (msg) =>
    msg && msg.parts && msg.parts.length > 0 &&
    msg.parts.every((p) => p && p.functionResponse);
  while (kept.length > 0 && isFunctionResponseOnly(kept[0])) {
    kept.shift();
  }

  return [first, ...kept];
}

// --- Patcher helpers --------------------------------------------------------

export function findAgentsMdReplacements(content) {
  const replacements = [];
  const seen = new Set();

  const idRe = /([A-Za-z_$][\w$]*)="TABNINE\.md"/g;
  let m;
  let firstSeen = false;
  while ((m = idRe.exec(content)) !== null) {
    const pattern = m[0];
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    const id = m[1];
    if (!firstSeen) {
      replacements.push([pattern, `${id}="AGENTS.md"/*${AGENTS_MD_MARKER}*/`]);
      firstSeen = true;
    } else {
      replacements.push([pattern, `${id}="AGENTS.md"`]);
    }
  }

  if (content.includes('return["TABNINE.md"]')) {
    replacements.push(['return["TABNINE.md"]', 'return["AGENTS.md"]']);
  }

  return replacements;
}

export function findTokenInjectionSite(content) {
  const withPushRe = /this\.history\.push\([^)]+\);let (\w+)=this\.getHistory\(!0\);/;
  const withPush = withPushRe.exec(content);
  if (withPush) {
    return { pattern: withPush[0], historyVar: withPush[1] };
  }

  const standaloneRe = /let (\w+)=this\.getHistory\(!0\);/;
  const standalone = standaloneRe.exec(content);
  if (standalone) {
    return { pattern: standalone[0], historyVar: standalone[1] };
  }

  return null;
}

// Append a [[rule]] to a read-only.toml policy file that allows MCP tools
// annotated with `readOnlyHint = true`. Idempotent via the marker comment.
// Mirrors the rule already present in plan.toml at priority 70 (which there
// is `ask_user`); in read-only mode the user has already opted into a
// restricted profile, so we go straight to `allow`.
export function addMcpReadOnlyRule(content) {
  if (content.includes(MCP_READONLY_MARKER)) return content;
  const rule = [
    '',
    `# ${MCP_READONLY_MARKER}: allow MCP tools annotated as read-only.`,
    '[[rule]]',
    'mcpName = "*"',
    'toolAnnotations = { readOnlyHint = true }',
    'decision = "allow"',
    'priority = 50',
    '',
  ].join('\n');
  return content.endsWith('\n') ? content + rule : content + '\n' + rule;
}

export function buildTokenProtectionCode(historyVar, {
  tokenLimit = DEFAULT_TOKEN_LIMIT,
  tokenTarget = DEFAULT_TOKEN_TARGET,
} = {}) {
  return [
    `const TOKEN_LIMIT=${tokenLimit},TOKEN_TRUNCATE_TARGET=${tokenTarget};`,
    `const estimateHistoryTokens=${estimateHistoryTokens.toString()};`,
    `const truncateHistory=${truncateHistory.toString()};`,
    `if(estimateHistoryTokens(${historyVar})>TOKEN_LIMIT){`,
    `console.warn("[tabnine-patch] token limit protection: truncating history");`,
    `${historyVar}=truncateHistory(${historyVar},TOKEN_TRUNCATE_TARGET);`,
    `this.history=${historyVar}.slice();`,
    `}`,
  ].join('');
}
