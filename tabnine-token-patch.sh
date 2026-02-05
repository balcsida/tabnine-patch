#!/bin/bash
# Tabnine Token Limit Protection Patch
# Automatically patches tabnine.mjs to handle "prompt is too long" errors
# Usage: curl -sSL <gist-raw-url> | bash

set -e

TABNINE_DIR="$HOME/.tabnine/agent/.bundles"
TARGET_FILE="tabnine.mjs"

# Find the latest bundle
LATEST_BUNDLE=$(ls -1 "$TABNINE_DIR" 2>/dev/null | sort -V | tail -1)

if [ -z "$LATEST_BUNDLE" ]; then
    echo "Error: No Tabnine bundle found in $TABNINE_DIR"
    exit 1
fi

FILE_PATH="$TABNINE_DIR/$LATEST_BUNDLE/$TARGET_FILE"

if [ ! -f "$FILE_PATH" ]; then
    echo "Error: $FILE_PATH not found"
    exit 1
fi

# Check if already patched
if grep -q "TOKEN_LIMIT = 180000" "$FILE_PATH"; then
    echo "Patch already applied to $FILE_PATH"
    exit 0
fi

echo "Patching $FILE_PATH..."

# Create backup
cp "$FILE_PATH" "$FILE_PATH.bak"

# Apply patch using sed
sed -i.tmp '
/let s = this\.getHistory(!0);/a\
          // PATCH: Token limit protection - estimate tokens and truncate if needed\
          const TOKEN_LIMIT = 180000; // Safe limit (90% of 200k Anthropic limit)\
          const TOKEN_TRUNCATE_TARGET = 140000; // Target after truncation (70% of limit)\
          const estimateHistoryTokens = (hist) => {\
            let tokens = 0;\
            for (const msg of hist) {\
              if (!msg.parts) continue;\
              for (const part of msg.parts) {\
                if (typeof part.text === '\''string'\'') {\
                  for (const ch of part.text) {\
                    tokens += ch.codePointAt(0) <= 127 ? 0.25 : 1.3;\
                  }\
                } else {\
                  tokens += JSON.stringify(part).length / 4;\
                }\
              }\
            }\
            return Math.ceil(tokens);\
          };\
          const truncateHistory = (hist, targetTokens) => {\
            if (hist.length <= 2) return hist;\
            const firstMsg = hist[0];\
            let remaining = hist.slice(1);\
            while (remaining.length > 1 \&\& estimateHistoryTokens([firstMsg, ...remaining]) > targetTokens) {\
              remaining = remaining.slice(1);\
            }\
            return [firstMsg, ...remaining];\
          };\
          const isPromptTooLongError = (err) => {\
            const msg = err?.message || err?.response?.data?.error?.message || String(err);\
            return msg.includes('\''prompt is too long'\'') || msg.includes('\''tokens >'\'') || msg.includes('\''maximum'\'');\
          };\
          let estimatedTokens = estimateHistoryTokens(s);\
          if (estimatedTokens > TOKEN_LIMIT) {\
            Ee.warn(`Token limit protection: estimated ${estimatedTokens} tokens, truncating history...`);\
            s = truncateHistory(s, TOKEN_TRUNCATE_TARGET);\
            this.history = s.slice();\
            estimatedTokens = estimateHistoryTokens(s);\
            Ee.warn(`History truncated to ~${estimatedTokens} tokens`);\
          }
' "$FILE_PATH"

# Patch maxAttempts +1 for retry
sed -i.tmp 's/m = f3r\.maxAttempts;/m = f3r.maxAttempts + 1; \/\/ PATCH: +1 for token-too-long retry\
              let tokenTruncationAttempted = false;/' "$FILE_PATH"

# Add error handler after "f = v;"
sed -i.tmp '/f = v;/a\
                  // PATCH: Handle "prompt is too long" error by truncating history\
                  if (!tokenTruncationAttempted \&\& isPromptTooLongError(v)) {\
                    Ee.warn('\''Token limit error detected, truncating history and retrying...'\'');\
                    s = truncateHistory(s, TOKEN_TRUNCATE_TARGET);\
                    this.history = s.slice();\
                    tokenTruncationAttempted = true;\
                    continue;\
                  }
' "$FILE_PATH"

# Cleanup temp files
rm -f "$FILE_PATH.tmp"

echo "Patch applied successfully!"
echo "Backup saved to: $FILE_PATH.bak"
echo "Restart Tabnine CLI to activate the changes."
