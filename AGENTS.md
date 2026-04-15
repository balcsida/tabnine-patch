# Repository Guide

Guidance for AI agents working in this repository.

## Overview

Node.js patcher for the Tabnine CLI (`tabnine.mjs`). Applies binary patches to the bundled Tabnine agent to:

- Use `AGENTS.md` as the context file instead of `TABNINE.md`.
- Pre-emptively estimate and truncate conversation history to avoid "prompt is too long" errors.
- Enable checkpointing and subagents via `settings.json`.

## Running the Patcher

```bash
node tabnine-token-patch.mjs            # patch all installed bundles
node tabnine-token-patch.mjs --dry-run  # show what would change, write nothing
node tabnine-token-patch.mjs --strict   # refuse unknown checksums (no auto-detect fallback)
```

The script walks every `~/.tabnine/agent/.bundles/<version>/tabnine.mjs` and applies patches via auto-detection. Markers (`AGENTS_MD_MARKER`, `TOKEN_PATCH_MARKER`) make re-runs idempotent.

## Architecture

Two files:

- `tabnine-token-patch.mjs` — CLI entry: walks the bundle dir, drives I/O, manages backups and `settings.json`.
- `src/patcher.mjs` — pure helpers (no I/O): runtime token estimator + truncator that get serialised into the bundle, and regex-based detectors for the patch sites. Unit-tested in `src/patcher.test.mjs`.

The minified Tabnine bundle is patched via regex auto-detection, not a per-version recipe table. Specifically:

- `findAgentsMdReplacements` finds every `<id>="TABNINE.md"` and the `return["TABNINE.md"]` literal.
- `findTokenInjectionSite` finds the `[this.history.push(…);]let <var>=this.getHistory(!0);` site and captures the history variable name.
- `buildTokenProtectionCode` serialises the runtime helpers via `Function.prototype.toString` so the in-bundle code matches what the unit tests cover.

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
