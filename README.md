# Tabnine CLI Patches

Patches the **active** Tabnine CLI bundle to:

- Use `AGENTS.md` instead of `TABNINE.md` as the context file (so the same file works across multiple AI coding tools).
- Pre-emptively truncate conversation history before it overflows the model token limit.
- Allow MCP tools annotated as read-only to run in read-only mode.
- Enable checkpointing (session recovery) and the experimental subagents feature.

## Installation

Run these commands in your terminal:

```bash
git clone https://github.com/balcsida/tabnine-patch.git
node tabnine-patch/tabnine-token-patch.mjs
```

Flags:

- `--dry-run` — show what would change, write nothing.
- `--strict` — refuse to patch unless the bundle checksum matches a known-good value.

## Post-installation

Restart Tabnine CLI to activate the changes.

## Compatibility

Verified against **Tabnine CLI v0.12.1** (the currently active bundle in `~/.tabnine/agent/.bundles/.active`). The patcher only touches the active bundle — older installed versions are left alone. Newer bundles are auto-detected via regex when they become active; if detection fails, run with `--dry-run` to inspect.

## Notes

- A backup of the original `tabnine.mjs` is saved as `tabnine.mjs.bak`.
- A backup of the original `policies/read-only.toml` is saved as `read-only.toml.bak`.
- A backup of the original `settings.json` is saved as `settings.json.bak`.
- The patch must be re-applied after Tabnine activates a new bundle version.
- Running the script multiple times is safe — it detects already-applied patches and is a no-op.

## Checkpointing

The patcher enables Tabnine's built-in checkpointing feature (inherited from Gemini CLI):

- **`/restore`** — Lists and restores file-level checkpoints (shadow git snapshots taken before each file modification).
- **`/chat save <tag>`** — Save the current conversation as a named checkpoint.
- **`/chat resume <tag>`** — Resume a conversation from a saved checkpoint.
- **`/chat list`** — List all saved conversation checkpoints.
- **`/chat delete <tag>`** — Delete a conversation checkpoint.

## Subagents

The patcher enables the experimental subagents feature, allowing Tabnine to spawn local and remote sub-agents for parallel task execution. Note: this is an experimental feature that uses YOLO mode for subagents.

## Read-only policy expansion

Tabnine's default read-only profile only whitelists five built-in tools (`glob`, `grep_search`, `list_directory`, `read_file`, `google_web_search`) and blocks every MCP server tool — even ones that declare themselves read-only via `readOnlyHint = true`. The patcher appends one rule to `policies/read-only.toml` that allows any MCP tool with `readOnlyHint = true`, so MCP read-only operations work in read-only mode out of the box.
