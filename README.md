# Tabnine Token Limit Protection Patch

Automatically patches `tabnine.mjs` to handle "prompt is too long" errors by implementing token estimation and history truncation.

## What it does

1. **Pre-emptive token estimation** - Estimates tokens before sending and automatically truncates history if it exceeds 180,000 tokens (90% of Anthropic's 200k limit)
2. **Error recovery** - Detects "prompt is too long" errors and automatically truncates history then retries
3. **Preserves context** - Keeps the first message (system context) and most recent messages when truncating

## Installation

Run this command in your terminal:

```bash
curl -sSL https://github.dev.global.tesco.org/gist/HU901131/7bd5f903e98f7a4a9ce0f314c2d88f6d/raw/tabnine-token-patch.sh | bash
```

## Post-installation

Restart Tabnine CLI to activate the changes.

## Notes

- A backup of the original file is saved as `tabnine.mjs.bak`
- The patch is applied to the latest Tabnine bundle in `~/.tabnine/agent/.bundles/`
- This patch will need to be re-applied after Tabnine updates to a new bundle version
- Running the script multiple times is safe - it detects if the patch is already applied
