// Pure helpers for the Tabnine patcher. Side-effect free so they can be unit
// tested in isolation.

export const AGENTS_MD_MARKER = 'AGENTS_MD_PREFERRED';
export const MCP_READONLY_MARKER = 'MCP_READONLY_PATCH';

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
