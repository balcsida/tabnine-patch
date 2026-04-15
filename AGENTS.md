# Repository Guide

Guidance for AI agents working in this repository.

## Overview

Node.js patcher for the Tabnine CLI (`tabnine.mjs`). Applies binary patches to the bundled Tabnine agent to:

- Use `AGENTS.md` as the context file instead of `TABNINE.md`.
- Pre-emptively estimate and truncate conversation history to avoid "prompt is too long" errors.
- Enable checkpointing and subagents via `settings.json`.

## Running the Patcher

```bash
node tabnine-token-patch.mjs
```

The script walks all installed bundles under `~/.tabnine/agent/.bundles/<version>/tabnine.mjs`, applies patches to versions listed in the `VERSIONS` table, and skips unknown ones.

## Architecture

Single-file patcher (`tabnine-token-patch.mjs`). The minified Tabnine bundle is patched via literal string matching (not AST), so patches are fragile and version-specific. Each patch has a marker constant (`AGENTS_MD_MARKER`, `TOKEN_PATCH_MARKER`) so re-runs are idempotent.

Per-version recipes live in the `VERSIONS` object keyed by Tabnine CLI version. Each entry contains:

- `checksum` — SHA-256 of the unpatched `tabnine.mjs`.
- `agentsMdReplacements` — literal string substitutions mapping obfuscated `TABNINE.md` constants to `AGENTS.md`.
- `tokenInjection` — the `getHistory` injection pattern, the history variable name, and the logger name in scope at that site.

## Adding Support for a New Tabnine Version

1. Compute SHA-256 of the new unpatched `tabnine.mjs`.
2. Locate the obfuscated identifiers assigned to `"TABNINE.md"` (e.g. `rg -oE '[A-Za-z_$][A-Za-z0-9_$]*="TABNINE\.md"' tabnine.mjs`).
3. Locate the `getHistory(!0)` call site used for message sending; note the surrounding `let X=this.getHistory(!0);` pattern, the history variable name, and the logger in scope.
4. Add a new entry to the `VERSIONS` object in `tabnine-token-patch.mjs`.
5. Run the patcher — it should report the new version's patch count and leave a `.bak` file next to the patched bundle.
