#!/bin/sh
# Install HomeProxy Simple UI on OpenWRT router.
#
# Usage:
#   1. Copy this project to the router:
#      scp -r ./htdocs ./cgi-bin ./scripts ./install.sh root@ROUTER_IP:/tmp/hpui/
#
#   2. SSH into the router and run:
#      sh /tmp/hpui/install.sh
#
#   3. Open in browser:
#      http://ROUTER_IP/homeproxy-ui/

set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="/www/homeproxy-ui"
CGI_DIR="/www/cgi-bin"
SCRIPTS_DIR="/etc/homeproxy/scripts"

echo "Installing HomeProxy Simple UI..."

mkdir -p "$WEB_DIR" "$CGI_DIR" "$SCRIPTS_DIR"

cp "$SRC/htdocs/index.html" "$WEB_DIR/"
cp "$SRC/htdocs/style.css"  "$WEB_DIR/"
cp "$SRC/htdocs/langs.js"   "$WEB_DIR/"
cp "$SRC/htdocs/app.js"     "$WEB_DIR/"

cp "$SRC/cgi-bin/homeproxy-api" "$CGI_DIR/"
chmod 755 "$CGI_DIR/homeproxy-api"

cp "$SRC/scripts/update_subscriptions.uc" "$SCRIPTS_DIR/"
chmod 755 "$SCRIPTS_DIR/update_subscriptions.uc"

LAN_IP=$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1)
[ -z "$LAN_IP" ] && LAN_IP="router-ip"

echo ""
echo "Done! Access the UI at:"
echo "  http://${LAN_IP}/homeproxy-ui/"
echo ""
echo "To uninstall:"
echo "  rm -rf $WEB_DIR $CGI_DIR/homeproxy-api"
