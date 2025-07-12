#!/bin/bash

# Path to license header file
HEADER_FILE="scripts/license-header.txt"

# Default target directory
TARGET_DIR="src"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    -dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown parameter passed: $1"
      echo "Usage: sh scripts/add-license-header.sh [-dir target_directory]"
      exit 1
      ;;
  esac
done

# File extensions to process
EXTENSIONS=("ts" "js")

# What to check to detect existing license
CHECK_PHRASE="Licensed under the Apache License"

if [ ! -f "$HEADER_FILE" ]; then
  echo "❌ Error: $HEADER_FILE not found."
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "❌ Error: Directory '$TARGET_DIR' does not exist."
  exit 1
fi

HEADER_CONTENT=$(cat "$HEADER_FILE")

echo "📂 Applying license headers to .${EXTENSIONS[*]} files in '$TARGET_DIR'..."

for ext in "${EXTENSIONS[@]}"; do
  find "$TARGET_DIR" -type f -name "*.${ext}" | while read -r file; do
    if grep -q "$CHECK_PHRASE" "$file"; then
      # do nothing
      :
    else
      # echo "➕ Adding license to $file"
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
