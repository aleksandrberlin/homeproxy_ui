# Device Routing — Design

**Date:** 2026-06-29
**Feature:** Route all traffic from specific LAN devices to VPN / Direct / Block.

## Goal

Add a new **Devices** tab listing static DHCP devices. Each device has a
dropdown — **Default**, **VPN**, **Direct**, **Block**. Choosing VPN, Direct, or
Block routes *all* traffic from that device's IP through the corresponding
outbound. **Default** means no special route (hint: "No special route selected").

## Key constraint (why we can't reuse the existing pool rules)

sing-box route-rule matching is documented as:

```
(domain || domain_suffix || … || ip_cidr || ip_is_private)
&& (port || port_range)
&& (source_geoip || source_ip_cidr || source_ip_is_private)
&& (source_port || source_port_range)
&& <other fields>
```

Categories are AND-ed; only entries within one category are OR-ed. So adding a
device IP to `hp_pool_rule` (which already carries `domain_suffix`/`ip_cidr`/
`rule_set`) would match `domain ∈ proxy-domains && source_ip = device` — i.e. the
device only reaches the VPN for proxy domains, not all traffic. Therefore device
routing needs **dedicated rules carrying only `source_ip_cidr`**.

## Routing model

Three new managed routing rules, emitted **after** the existing domain pool
rules so domain/ruleset matches keep winning (domains first; the device rule is
the per-device default for everything else). First-match-wins ⇒ order:

```
1. hp_pool_block    domains/rulesets → reject
2. hp_pool_direct   domains/rulesets → direct
3. hp_pool_rule     domains/rulesets → VPN pool
   ── then ──
4. hp_dev_block     source_ip ∈ blocked devices → reject
5. hp_dev_direct    source_ip ∈ direct  devices → direct-out
6. hp_dev_vpn       source_ip ∈ VPN     devices → hp_pool (urltest)
```

New section-name constants in `cgi-bin/homeproxy-api`:
`DEV_VPN="hp_dev_vpn"`, `DEV_DIRECT="hp_dev_direct"`, `DEV_BLOCK="hp_dev_block"`.

Each `hp_dev_*` is a `routing_rule` with `enabled=1`, an action
(`reject` for block, `route` + `outbound` for direct/vpn), and a `source_ip_cidr`
list of `<ip>/32` device addresses. `generate_client.uc` already maps
`routing_rule.source_ip_cidr` 1:1 to a sing-box rule — **no `.uc` change needed**.

## Source of truth & state

The `source_ip_cidr` lists on the three `hp_dev_*` rules **are** the state — no
parallel UCI section. A device's current selection is derived by checking which
`hp_dev_*` rule contains its `<ip>/32`:

- in `hp_dev_block` → Block
- in `hp_dev_direct` → Direct
- in `hp_dev_vpn` → VPN
- in none → Default

## Devices source

Static DHCP leases = `config host` sections in `/etc/config/dhcp`, read via
`uci`. Per host we surface `name`, `mac`, `ip`. Hosts without an `ip` are skipped
(can't route by IP). This is distinct from the existing `get_dhcp_leases`, which
reads *dynamic* leases from `/tmp/dhcp.leases`.

## `rebuild_pool` integration

`rebuild_pool` is the single regenerator and already tears down + recreates the
pool rules each call (appending them to the end of the config). To keep the
`hp_dev_*` rules ordered **after** the pool rules, `rebuild_pool` takes ownership
of their lifecycle, mirroring its existing domain-preservation pattern:

1. At the top, save each `hp_dev_*` rule's `source_ip_cidr` list.
2. Delete `hp_dev_vpn`/`hp_dev_direct`/`hp_dev_block` alongside the pool deletes.
3. After recreating `hp_pool_block`/`direct`/`rule`, recreate each `hp_dev_*`
   rule **iff** its saved IP list is non-empty, re-applying the saved IPs.

Like `hp_pool_rule`, `hp_dev_vpn` is recreated even when no VPN nodes exist (its
`outbound=hp_pool` then dangles, yielding a stopped service until a VPN returns);
the user's device assignments are preserved rather than silently dropped. This
matches the existing "preserve custom proxy domains" behaviour.

## API actions (`cgi-bin/homeproxy-api`)

- **`get_devices`** — returns `[{name, mac, ip, route}]` for every static DHCP
  host with an IP, where `route ∈ {default, vpn, direct, block}` derived from the
  `hp_dev_*` lists.
- **`set_device_route`** — params `ip`, `route` (`default|vpn|direct|block`).
  Removes `<ip>/32` from all three `hp_dev_*` lists, adds it to the chosen list
  (none for `default`), then `rebuild_pool` (which guarantees ordering &
  preservation) + `uci commit` + `restart_hp`. Validates `ip` format and `route`.

Both registered in the action dispatcher.

## Frontend (`htdocs/`)

- **`index.html`** — new `<button class="tab" data-tab="devices">` and a
  `#tab-devices` section with a section hint and a device list container.
- **`app.js`** — `loadDevices()` calls `get_devices`, renders a row per device
  (name / IP / MAC) with a `<select>` (Default/VPN/Direct/Block). `change` →
  `set_device_route`, with the existing button/loading + restart-status pattern.
  Default option carries the "No special route selected" hint (title/help text).
  Empty state when no static devices exist.
- **`langs.js`** — EN + RU strings: `tab.devices`, `devices.title`,
  `devices.hint`, `devices.route.default/vpn/direct/block`,
  `devices.defaultHint` ("No special route selected"), `devices.empty`,
  column labels.
- **`style.css`** — reuse existing row/list styles; add only if needed.

ES5-only JS (`var`, `.forEach`, no arrow/template literals), POSIX sh backend,
no new dependencies — per existing project constraints.

## Out of scope (YAGNI)

- Routing by MAC (IP is stable for static leases and is what sing-box matches on).
- Listing dynamic / non-static devices.
- Surfacing "orphaned" assignments whose IP is no longer a static host (the rule
  still routes them; they just won't appear in the list).
- Per-device port/protocol granularity.

## Testing

- Manual on router: assign a device to VPN/Direct/Block, confirm generated
  sing-box config places `hp_dev_*` rules after `hp_pool_*` with correct
  `source_ip_cidr`; verify a domain in a Block ruleset still blocks for a
  VPN-assigned device (domains-first), and other traffic from it follows the
  device route.
- Toggle all VPNs off and back on; confirm device assignments survive
  `rebuild_pool` (preserved like custom proxy domains).
- Set a device back to Default; confirm its IP is removed from all `hp_dev_*`
  lists and empty rules disappear.
