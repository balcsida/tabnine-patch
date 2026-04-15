# Repository Guide

Guidance for AI agents working in this repository.

## Overview

Node.js patcher for the Tabnine CLI (`tabnine.mjs`). Targets the **active** bundle only (per `~/.tabnine/agent/.bundles/.active`) and applies:

- `AGENTS.md` as the context file instead of `TABNINE.md` (bundle string patch).
- Pre-emptive history truncation to avoid "prompt is too long" errors (bundle JS injection).
- An MCP-readonly rule appended to `policies/read-only.toml` so MCP tools annotated `readOnlyHint = true` are allowed in read-only mode.
- Checkpointing and experimental subagents via `settings.json`.

## Running the Patcher

```bash
node tabnine-token-patch.mjs            # patch all installed bundles
node tabnine-token-patch.mjs --dry-run  # show what would change, write nothing
node tabnine-token-patch.mjs --strict   # refuse unknown checksums (no auto-detect fallback)
```

The script reads `~/.tabnine/agent/.bundles/.active`, patches that one bundle's `tabnine.mjs` and `policies/read-only.toml`, and updates `~/.tabnine/agent/settings.json`. Markers (`AGENTS_MD_MARKER`, `TOKEN_PATCH_MARKER`, `MCP_READONLY_MARKER`) make re-runs idempotent.

## Architecture

Two files:

- `tabnine-token-patch.mjs` — CLI entry: walks the bundle dir, drives I/O, manages backups and `settings.json`.
- `src/patcher.mjs` — pure helpers (no I/O): runtime token estimator + truncator that get serialised into the bundle, and regex-based detectors for the patch sites. Unit-tested in `src/patcher.test.mjs`.

The minified Tabnine bundle is patched via regex auto-detection, not a per-version recipe table. Specifically:

- `findAgentsMdReplacements` finds every `<id>="TABNINE.md"` and the `return["TABNINE.md"]` literal.
- `findTokenInjectionSite` finds the `[this.history.push(…);]let <var>=this.getHistory(!0);` site and captures the history variable name.
- `buildTokenProtectionCode` serialises the runtime helpers (`estimateHistoryTokens`, `truncateHistory`) via `Function.prototype.toString` so the in-bundle code matches what the unit tests cover.
- `addMcpReadOnlyRule` appends an `[[rule]]` to a `read-only.toml` body that allows MCP tools whose schema sets `readOnlyHint = true`.

`KNOWN_CHECKSUMS` in the CLI is now advisory: a mismatch is a warning unless `--strict` is passed.

## Tests

```bash
node --test src/patcher.test.mjs
```

## Adding Support for a New Tabnine Version

In most cases nothing — auto-detection handles new bundles. To pin a known-good checksum:

1. Compute SHA-256 of the unpatched `tabnine.mjs` and add it to `KNOWN_CHECKSUMS`.
2. Run the patcher; verify the reported site count and the `historyVar` look right.

If auto-detection fails on a new bundle, inspect with `--dry-run` and extend the regexes in `src/patcher.mjs` (and add a test).
