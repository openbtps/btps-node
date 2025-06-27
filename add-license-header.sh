#!/bin/bash

# Path to license header file
HEADER_FILE="license-header.txt"

# Directory to apply headers to
TARGET_DIR="src"

# File extensions to process
EXTENSIONS=("ts" "js")

# What to check to detect existing license
CHECK_PHRASE="Licensed under the Apache License"

if [ ! -f "$HEADER_FILE" ]; then
  echo "Error: $HEADER_FILE not found."
  exit 1
fi

HEADER_CONTENT=$(cat "$HEADER_FILE")

echo "Applying license headers to .$EXTENSIONS in $TARGET_DIR..."

for ext in "${EXTENSIONS[@]}"; do
  find "$TARGET_DIR" -type f -name "*.${ext}" | while read -r file; do
    if grep -q "$CHECK_PHRASE" "$file"; then
      echo "✔ Skipping $file (already licensed)"
    else
      echo "➕ Adding license to $file"
      TMP_FILE="$(mktemp)"
      {
        echo "$HEADER_CONTENT"
        echo ""
        cat "$file"
      } > "$TMP_FILE"
      mv "$TMP_FILE" "$file"
    fi
  done
done

echo "✅ License headers applied."
