# HomeProxy Simple UI

Lightweight web interface for managing [homeproxy](https://github.com/immortalwrt/homeproxy) on OpenWrt routers without LuCI.

## Architecture

- **Target runtime**: OpenWrt (ash shell, uhttpd, UCI config system, sing-box)
- **Backend**: Shell CGI script (`cgi-bin/homeproxy-api`) — reads/writes UCI config via `uci` commands, returns JSON
- **Frontend**: Vanilla JS/HTML/CSS single-page app (no build step, no framework, no dependencies)
- **Subscription updater**: `scripts/update_subscriptions.uc` — ucode script that fetches VPN subscription URLs, parses node URIs (ss/vless/vmess/trojan/hysteria2/wireguard/tuic), and updates UCI config

## Project structure

```
htdocs/index.html       — Single HTML page (tabs: VPNs, Domains)
htdocs/style.css        — All styles, CSS custom properties, responsive
htdocs/app.js           — IIFE, all app logic (API calls, DOM rendering, modals, i18n)
htdocs/langs.js         — EN/RU translation strings (window.HP_LANGS)
cgi-bin/homeproxy-api   — Shell CGI backend (POSIX sh, uses uci/jsonfilter)
scripts/update_subscriptions.uc — ucode subscription updater (runs on router)
install.sh              — Copies files to correct OpenWrt paths
```

## Key constraints

- **No build tooling** — files are deployed as-is via scp to the router
- **POSIX shell only** in the CGI backend — no bash, no node, no python on the router
- **No external JS/CSS dependencies** — everything is self-contained and must stay lightweight for router hardware
- **UCI is the data layer** — all state lives in `/etc/config/homeproxy`; the CGI script wraps `uci` commands
- **ES5-compatible JS** — the frontend uses `var`, `.forEach`, no arrow functions, no template literals (browser compat on older devices)

## API pattern

The CGI backend (`cgi-bin/homeproxy-api`) dispatches on an `action` parameter:
- GET requests: `?action=<name>&param=value`
- POST requests: JSON body with `{"action": "<name>", ...params}`
- Response: `{"ok": true, "data": ...}` or `{"ok": false, "error": "..."}`

Actions: `get_subscriptions`, `add_subscription`, `delete_subscription`, `refresh_subscriptions`, `toggle_subscription`, `get_subscription_nodes`, `get_manual_nodes`, `add_node`, `delete_node`, `get_rulesets`, `add_ruleset`, `delete_ruleset`, `get_custom_rules`, `add_custom_rule`, `delete_custom_rule`, `restart`, `get_status`

## Development notes

- Frontend changes can be tested by opening `htdocs/index.html` locally (API calls will fail but layout/styling works)
- To test on a router: `scp -O` the changed files and refresh the browser
- The subscription updater uses ucode imports (`digest`, `fs`, `ubus`, `uci`, `luci.http`, `homeproxy`) — these are only available on OpenWrt with homeproxy installed
- i18n: all user-visible strings go through `t('key')` in JS and `data-i18n="key"` in HTML; translations live in `langs.js`
- Routing model: each subscription/node gets a `routing_node` (urltest) + `routing_rule` that references all active `ruleset` sections
