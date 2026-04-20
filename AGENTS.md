# Repository Guide

Guidance for AI agents working in this repository.

## Overview

Node.js patcher for the Tabnine CLI (`tabnine.mjs`). Targets the **active** bundle only (per `~/.tabnine/agent/.bundles/.active`) and applies:

- `AGENTS.md` as the context file instead of `TABNINE.md` (bundle string patch).
- A `gemini-extension.json` fallback inside `loadExtensionConfig`, so upstream Gemini CLI extensions install unchanged.
- An MCP-readonly rule appended to `policies/read-only.toml` so MCP tools annotated `readOnlyHint = true` are allowed in read-only mode.
- Checkpointing, experimental subagents, and `security.blockGitExtensions = false` (to allow `tabnine extensions install <git-url>`) via `settings.json`.

History truncation is **not** patched: Tabnine 0.12.1 has a native `tryCompressChat` step that runs before every `callModel` and compresses at the configurable `model.compressionThreshold` (default 0.7 of context).

## Running the Patcher

```bash
node tabnine-token-patch.mjs            # patch the active bundle
node tabnine-token-patch.mjs --dry-run  # show what would change, write nothing
node tabnine-token-patch.mjs --strict   # refuse unknown checksums (no auto-detect fallback)
```

The script reads `~/.tabnine/agent/.bundles/.active`, patches that one bundle's `tabnine.mjs` and `policies/read-only.toml`, and updates `~/.tabnine/agent/settings.json`. Markers (`AGENTS_MD_MARKER`, `MCP_READONLY_MARKER`) make re-runs idempotent.

## Architecture

Two files:

- `tabnine-token-patch.mjs` — CLI entry: resolves the active bundle, drives I/O, manages backups and `settings.json`.
- `src/patcher.mjs` — pure helpers (no I/O): regex-based detectors for patch sites. Unit-tested in `src/patcher.test.mjs`.

The minified Tabnine bundle is patched via regex auto-detection, not a per-version recipe table:

- `findAgentsMdReplacements` finds every `<id>="TABNINE.md"` and the `return["TABNINE.md"]` literal.
- `findGeminiExtensionFallback` matches the minified `loadExtensionConfig` guard and wraps it so a missing `tabnine-extension.json` falls back to `gemini-extension.json` before throwing.
- `addMcpReadOnlyRule` appends an `[[rule]]` to a `read-only.toml` body that allows MCP tools whose schema sets `readOnlyHint = true`.

`KNOWN_CHECKSUMS` in the CLI is advisory: a mismatch is a warning unless `--strict` is passed.

## Tests

```bash
node --test src/patcher.test.mjs
```

## Adding Support for a New Tabnine Version

In most cases nothing — auto-detection handles new bundles. To pin a known-good checksum:

1. Compute SHA-256 of the unpatched `tabnine.mjs` and add it to `KNOWN_CHECKSUMS`.
2. Run the patcher; verify the reported site count looks right.

If auto-detection fails on a new bundle, inspect with `--dry-run` and extend the regexes in `src/patcher.mjs` (and add a test).
