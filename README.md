# Tabnine CLI Patches

Automatically patches `tabnine.mjs` to use `AGENTS.md` instead of `TABNINE.md` as the context file, so the same file works across multiple AI coding tools. Also enables checkpointing for session recovery.

## Installation

Run these commands in your terminal:

```bash
git clone https://github.com/balcsida/tabnine-patch.git
node tabnine-patch/tabnine-token-patch.mjs
```

## Post-installation

Restart Tabnine CLI to activate the changes.

## Compatibility

Verified against **Tabnine CLI v0.5.3** and **v0.12.1**. Other versions are auto-detected via regex; pass `--strict` to require a known checksum, `--dry-run` to preview without writing.

## Notes

- A backup of the original file is saved as `tabnine.mjs.bak`
- The patch is applied to the latest Tabnine bundle in `~/.tabnine/agent/.bundles/`
- This patch will need to be re-applied after Tabnine updates to a new bundle version
- Running the script multiple times is safe - it detects if the patch is already applied
- Checkpointing and subagents are enabled in `~/.tabnine/agent/settings.json` (backup saved as `settings.json.bak`)

## Checkpointing

The patcher enables Tabnine's built-in checkpointing feature (inherited from Gemini CLI):

- **`/restore`** — Lists and restores file-level checkpoints (shadow git snapshots taken before each file modification)
- **`/chat save <tag>`** — Save the current conversation as a named checkpoint
- **`/chat resume <tag>`** — Resume a conversation from a saved checkpoint
- **`/chat list`** — List all saved conversation checkpoints
- **`/chat delete <tag>`** — Delete a conversation checkpoint

## Subagents

The patcher enables the experimental subagents feature, allowing Tabnine to spawn local and remote sub-agents for parallel task execution. Note: this is an experimental feature that uses YOLO mode for subagents.
