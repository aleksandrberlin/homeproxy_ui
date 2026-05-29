#!/bin/sh
# Build a self-extracting installer for HomeProxy Simple UI.
# Output: homeproxy-ui-install.sh (single file, runs on OpenWrt)

set -e

cd "$(dirname "$0")"

VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')-$(date +%Y%m%d)"
OUT="homeproxy-ui-install.sh"
ARCHIVE=$(mktemp)

tar cz htdocs cgi-bin scripts install.sh > "$ARCHIVE"

# Write header with placeholder offset (fixed 6-char width so replacement doesn't shift bytes)
cat > "$OUT" << 'HEADER'
#!/bin/sh
set -e

echo "HomeProxy Simple UI — version %%VER%%"

TMP=$(mktemp -d 2>/dev/null || { mkdir -p /tmp/hpui-$$; echo /tmp/hpui-$$; })
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Extracting..."
tail -c +OFFSET "$0" | tar xz -C "$TMP"
sh "$TMP/install.sh"
exit 0
HEADER

# Replace version placeholder
TMP_SED=$(mktemp)
sed "s/%%VER%%/$VERSION/" "$OUT" > "$TMP_SED" && mv "$TMP_SED" "$OUT"

# Calculate byte offset: header size + 1
HEADER_SIZE=$(wc -c < "$OUT" | tr -d ' ')
OFFSET=$((HEADER_SIZE + 1))

# Replace OFFSET placeholder (must not change byte count — pad to 6 chars)
PADDED=$(printf '%06d' "$OFFSET")
TMP_SED=$(mktemp)
sed "s/OFFSET/$PADDED/" "$OUT" > "$TMP_SED" && mv "$TMP_SED" "$OUT"

cat "$ARCHIVE" >> "$OUT"
rm "$ARCHIVE"
chmod +x "$OUT"

echo "Built: $OUT  version=$VERSION  ($(wc -c < "$OUT" | tr -d ' ') bytes)"
