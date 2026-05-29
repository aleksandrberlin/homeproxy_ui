# HomeProxy Simple UI

A lightweight web interface for managing [homeproxy](https://github.com/immortalwrt/homeproxy) on OpenWrt routers. No LuCI dependency required.

## Features

- Manage VPN subscriptions (add, refresh, enable/disable, delete)
- Add custom VPN servers (WireGuard, Shadowsocks, VLESS, VMess, Trojan, Hysteria 2)
- Custom routing rules (domains and IP CIDRs)
- Remote rule sets (.srs files)
- Link rule sets to VPN nodes for traffic routing
- English and Russian language support
- Mobile-friendly responsive design

## Requirements

- OpenWrt router with [homeproxy](https://github.com/immortalwrt/homeproxy) installed
- uhttpd web server (default on OpenWrt)

## Install

### Option 1: One-file installer (recommended)

Download `homeproxy-ui-install.sh` from the [latest release](../../releases/latest), copy it to the router, and run:

```sh
scp -O homeproxy-ui-install.sh root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'sh /tmp/homeproxy-ui-install.sh'
```

### Option 2: From source

```sh
scp -O -r htdocs cgi-bin scripts install.sh root@192.168.1.1:/tmp/hpui/
ssh root@192.168.1.1 'sh /tmp/hpui/install.sh'
```

Replace `192.168.1.1` with your router's IP address.

### Open the UI

```
http://192.168.1.1/homeproxy-ui/
```

## Update

Download the latest installer and re-run. No restart needed - just refresh the browser.

## Uninstall

```sh
ssh root@192.168.1.1 'rm -rf /www/homeproxy-ui /www/cgi-bin/homeproxy-api'
```

## Project Structure

```
htdocs/
  index.html    - Main HTML page
  style.css     - Styles
  langs.js      - EN/RU translations
  app.js        - Application logic
cgi-bin/
  homeproxy-api - Shell CGI backend (UCI commands)
scripts/
  update_subscriptions.uc - Subscription update script
install.sh      - Installer for OpenWrt
build.sh        - Builds self-extracting installer
```

## Building the installer locally

```sh
sh build.sh
# creates homeproxy-ui-install.sh (~40KB)
```

The installer is also built automatically by GitHub Actions on every push to `main` and attached to tagged releases.

### Creating a release

```sh
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds the installer and attaches it to the release on GitHub.
