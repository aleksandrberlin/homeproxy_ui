(function () {
    'use strict';

    // ── i18n ────────────────────────────────────────────────

    var langs = window.HP_LANGS || {};
    var currentLang = localStorage.getItem('hp-lang') || 'en';

    function t(key, params) {
        var s = (langs[currentLang] || langs.en)[key] || key;
        if (params) {
            Object.keys(params).forEach(function (k) {
                s = s.replace('{' + k + '}', params[k]);
            });
        }
        return s;
    }

    function applyLang() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            el.textContent = t(el.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            el.innerHTML = t(el.dataset.i18nHtml);
        });
        document.querySelectorAll('.lang-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.lang === currentLang);
        });
    }

    function setLang(lang) {
        currentLang = lang;
        localStorage.setItem('hp-lang', lang);
        applyLang();
        renderSubscriptions();
        loadRulesets();
        loadCustomRules();
        updateStatus();
        if (manualNodesCache.length) renderManualNodes(manualNodesCache);
    }

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            setLang(btn.dataset.lang);
        });
    });

    // ── Theme ──────────────────────────────────────────────

    var themeOrder = ['system', 'light', 'dark'];
    var themeIcons = { system: '◑', light: '☀', dark: '☾' };
    var currentTheme = localStorage.getItem('hp-theme') || 'system';

    function applyTheme(theme) {
        currentTheme = theme;
        localStorage.setItem('hp-theme', theme);
        if (theme === 'system') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
        var icon = themeIcons[theme];
        document.getElementById('btn-theme').textContent = icon;
        var btnM = document.getElementById('btn-theme-m');
        if (btnM) btnM.textContent = icon;
    }

    function cycleTheme() {
        var idx = (themeOrder.indexOf(currentTheme) + 1) % themeOrder.length;
        applyTheme(themeOrder[idx]);
    }

    document.getElementById('btn-theme').addEventListener('click', cycleTheme);
    var btnThemeM = document.getElementById('btn-theme-m');
    if (btnThemeM) btnThemeM.addEventListener('click', cycleTheme);

    applyTheme(currentTheme);

    // ── Mobile menu ────────────────────────────────────────────

    var menuBtn = document.getElementById('btn-menu');
    var dropdown = document.getElementById('header-dropdown');

    if (menuBtn && dropdown) {
        menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', function (e) {
            if (!dropdown.contains(e.target) && e.target !== menuBtn) {
                dropdown.classList.add('hidden');
            }
        });
    }

    // ── State ───────────────────────────────────────────────

    var API = '/cgi-bin/homeproxy-api';

    var subscriptions = [];
    var rulesets = [];
    var status = {};
    var manualNodesCache = [];
    var customRules = [];
    var proxyDelays = {};
    var nodeTraffic = {};
    var prevConns = {};
    var prevConnTime = 0;
    var nodeSpeeds = {};

    // ── API ──────────────────────────────────────────────────

    function api(action, body) {
        var opts = {};
        var url = API + '?action=' + action;
        if (body) {
            body.action = action;
            opts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            };
            url = API;
        }
        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function apiGet(action, params) {
        var qs = 'action=' + action;
        if (params) {
            Object.keys(params).forEach(function (k) {
                qs += '&' + k + '=' + encodeURIComponent(params[k]);
            });
        }
        return fetch(API + '?' + qs).then(function (r) { return r.json(); });
    }

    // ── Proxy Status ────────────────────────────────────────

    function fetchProxyStatus() {
        return Promise.all([
            apiGet('get_proxy_status'),
            apiGet('get_connections')
        ]).then(function (res) {
            if (res[0].ok && res[0].data && res[0].data.proxies) {
                var proxies = res[0].data.proxies;
                var delays = {};
                Object.keys(proxies).forEach(function (name) {
                    var m = name.match(/^cfg-(.+)-out$/);
                    if (!m) return;
                    var id = m[1];
                    var h = proxies[name].history;
                    if (h && h.length) {
                        delays[id] = h[h.length - 1].delay || 0;
                    }
                });
                proxyDelays = delays;
            }
            if (res[1].ok && res[1].data) {
                var traffic = {};
                var curr = {};
                (res[1].data.connections || []).forEach(function (c) {
                    var chain = c.chains && c.chains[0] || '';
                    var m = chain.match(/^cfg-(.+)-out$/);
                    if (!m) return;
                    var id = m[1];
                    if (!traffic[id]) traffic[id] = { conns: 0, dl: 0, ul: 0 };
                    traffic[id].conns++;
                    traffic[id].dl += c.download || 0;
                    traffic[id].ul += c.upload || 0;
                    curr[c.id] = { node: id, dl: c.download || 0, ul: c.upload || 0 };
                });
                var now = Date.now();
                var dt = (now - prevConnTime) / 1000;
                if (prevConnTime && dt > 0) {
                    var commonCount = 0;
                    var deltas = {};
                    Object.keys(curr).forEach(function (cid) {
                        if (!prevConns[cid]) return;
                        commonCount++;
                        var nid = curr[cid].node;
                        if (!deltas[nid]) deltas[nid] = { dl: 0, ul: 0 };
                        deltas[nid].dl += curr[cid].dl - prevConns[cid].dl;
                        deltas[nid].ul += curr[cid].ul - prevConns[cid].ul;
                    });
                    var speeds = {};
                    Object.keys(traffic).forEach(function (nid) {
                        var d = deltas[nid] || { dl: 0, ul: 0 };
                        speeds[nid] = { dl: d.dl / dt, ul: d.ul / dt };
                    });
                    nodeSpeeds = speeds;
                }
                prevConns = curr;
                prevConnTime = now;
                nodeTraffic = traffic;
            }
        }).catch(function () {});
    }

    function formatBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(1) + ' GB';
    }

    function bindTestButtons(container) {
        container.querySelectorAll('[data-test]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                testDelayInline(btn.dataset.test, container);
            });
        });
    }

    function testDelayInline(nodeId, container) {
        var metrics = container.querySelector('.node-metrics');
        if (!metrics) {
            metrics = document.createElement('div');
            metrics.className = 'node-metrics';
            container.appendChild(metrics);
        }
        var first = metrics.querySelector('.metric');
        var badge;
        if (first) {
            badge = first.querySelector('.metric-val');
        } else {
            first = document.createElement('span');
            first.className = 'metric';
            first.innerHTML = '<span class="metric-val">...</span>';
            metrics.insertBefore(first, metrics.firstChild);
            badge = first.querySelector('.metric-val');
        }
        badge.textContent = '...';
        badge.className = 'metric-val node-delay-testing';
        api('test_delay', { node_id: nodeId }).then(function (res) {
            if (res.delay !== undefined) {
                var d = res.delay;
                proxyDelays[nodeId] = d;
                if (d === 0) {
                    badge.textContent = t('status.timeout');
                    badge.className = 'metric-val node-delay-fail';
                } else {
                    badge.textContent = d + 'ms';
                    badge.className = 'metric-val ' + (d < 200 ? 'node-delay-good' : d < 500 ? 'node-delay-mid' : 'node-delay-bad');
                }
            } else {
                badge.textContent = t('status.timeout');
                badge.className = 'metric-val node-delay-fail';
            }
        }).catch(function () {
            badge.textContent = '?';
            badge.className = 'metric-val node-delay-fail';
        });
    }

    function formatSpeed(bps) {
        if (bps < 1024) return bps.toFixed(0) + ' B/s';
        if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
        return (bps / 1048576).toFixed(1) + ' MB/s';
    }

    function metricsHtml(nodeId, enabled) {
        if (enabled === false) return '';
        var testBtn = '<button class="btn-test-inline" data-test="' + esc(nodeId) + '">&#8635;</button>';
        var parts = [];
        var d = proxyDelays[nodeId];
        if (d !== undefined) {
            if (d === 0) {
                parts.push('<span class="metric"><span class="metric-val node-delay-fail">' + esc(t('status.timeout')) + '</span>' + testBtn + '</span>');
            } else {
                var cls = d < 200 ? 'node-delay-good' : d < 500 ? 'node-delay-mid' : 'node-delay-bad';
                parts.push('<span class="metric"><span class="metric-val ' + cls + '">' + d + 'ms</span>' + testBtn + '</span>');
            }
        } else {
            parts.push('<span class="metric">' + testBtn + '</span>');
        }
        var tr = nodeTraffic[nodeId];
        if (tr) {
            var sp = nodeSpeeds[nodeId] || { dl: 0, ul: 0 };
            parts.push('<span class="metric"><span class="metric-icon metric-dl">&#9660;</span><span class="metric-val metric-speed">' + formatSpeed(sp.dl) + '</span></span>');
            parts.push('<span class="metric"><span class="metric-icon metric-ul">&#9650;</span><span class="metric-val metric-speed">' + formatSpeed(sp.ul) + '</span></span>');
        }
        if (!parts.length) return '';
        return '<div class="node-metrics">' + parts.join('') + '</div>';
    }


    // ── Toast ────────────────────────────────────────────────

    function toast(msg, ok) {
        var el = document.createElement('div');
        el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
        el.textContent = msg;
        document.getElementById('toasts').appendChild(el);
        setTimeout(function () { el.remove(); }, 3000);
    }

    // ── Helpers ──────────────────────────────────────────────

    function esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    function btnLoading(btn, loading) {
        if (loading) {
            btn.disabled = true;
            btn.dataset.origHtml = btn.innerHTML;
            btn.innerHTML = '<span class="spinner spinner-dark spinner-sm"></span>';
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.origHtml || '&times;';
        }
    }

    // ── Modal ────────────────────────────────────────────────

    var modalSubmitFn = null;
    var modalBusy = false;

    function modal(title, fields, onSubmit) {
        var m = document.getElementById('modal');
        document.getElementById('modal-title').textContent = title;
        var body = document.getElementById('modal-body');
        body.innerHTML = '';

        var conditionalFields = [];

        fields.forEach(function (f) {
            var div = document.createElement('div');
            div.className = 'field';
            var lbl = document.createElement('label');
            lbl.textContent = f.label;
            lbl.setAttribute('for', 'mf-' + f.name);
            div.appendChild(lbl);

            if (f.options) {
                var sel = document.createElement('select');
                sel.id = 'mf-' + f.name;
                sel.name = f.name;
                f.options.forEach(function (o) {
                    var opt = document.createElement('option');
                    opt.value = o.value;
                    opt.textContent = o.text;
                    sel.appendChild(opt);
                });
                div.appendChild(sel);
            } else {
                var input = document.createElement('input');
                input.id = 'mf-' + f.name;
                input.name = f.name;
                input.type = f.type || 'text';
                input.placeholder = f.placeholder || '';
                input.value = f.value || '';
                input.required = !!f.required;
                div.appendChild(input);
            }
            if (f.showFor) {
                conditionalFields.push({ el: div, showFor: f.showFor, driver: f.showForDriver || 'type' });
                div.style.display = 'none';
            }
            body.appendChild(div);
        });

        if (conditionalFields.length) {
            var driverName = conditionalFields[0].driver;
            var driverEl = body.querySelector('[name="' + driverName + '"]');
            if (driverEl) {
                var updateVisibility = function () {
                    var val = driverEl.value;
                    conditionalFields.forEach(function (cf) {
                        cf.el.style.display = cf.showFor.indexOf(val) !== -1 ? '' : 'none';
                    });
                };
                driverEl.addEventListener('change', updateVisibility);
                updateVisibility();
            }
        }

        modalSubmitFn = onSubmit;
        modalBusy = false;
        var okBtn = document.getElementById('modal-ok');
        okBtn.disabled = false;
        okBtn.textContent = t('modal.save');
        document.getElementById('modal-cancel').disabled = false;

        m.classList.remove('hidden');
        var first = body.querySelector('input,select');
        if (first) first.focus();
    }

    function closeModal() {
        if (modalBusy) return;
        document.getElementById('modal').classList.add('hidden');
        modalSubmitFn = null;
    }

    function modalSetBusy(busy) {
        modalBusy = busy;
        var okBtn = document.getElementById('modal-ok');
        var cancelBtn = document.getElementById('modal-cancel');
        if (busy) {
            okBtn.disabled = true;
            okBtn.innerHTML = '<span class="spinner spinner-dark spinner-sm"></span>';
            cancelBtn.disabled = true;
        } else {
            okBtn.disabled = false;
            okBtn.textContent = t('modal.save');
            cancelBtn.disabled = false;
        }
    }

    function getModalValues() {
        var vals = {};
        document.querySelectorAll('#modal-body input, #modal-body select').forEach(function (el) {
            vals[el.name] = el.value.trim();
        });
        return vals;
    }

    document.getElementById('modal-ok').addEventListener('click', function () {
        if (modalBusy || !modalSubmitFn) return;
        var vals = getModalValues();
        var result = modalSubmitFn(vals);
        if (!result || typeof result.then !== 'function') return;
        modalSetBusy(true);
        result.then(function (ok) {
            modalSetBusy(false);
            if (ok !== false) closeModal();
        }).catch(function () {
            modalSetBusy(false);
        });
    });
    document.getElementById('modal-cancel').addEventListener('click', function () { closeModal(); });
    document.querySelector('.modal-close').addEventListener('click', function () { closeModal(); });
    document.querySelector('.modal-backdrop').addEventListener('click', function () { closeModal(); });

    // ── Tabs ─────────────────────────────────────────────────

    document.querySelectorAll('.tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            if (tab.dataset.tab === 'rulesets') {
                loadRulesets();
                loadCustomRules();
            }
        });
    });

    // ── Subscriptions ────────────────────────────────────────

    var chkInsecure = document.getElementById('chk-allow-insecure');
    var inpUrltestUrl = document.getElementById('inp-urltest-url');
    var btnSaveUrltest = document.getElementById('btn-save-urltest');

    chkInsecure.addEventListener('change', function () {
        var val = this.checked ? '1' : '0';
        var toggle = this.closest('.toggle');
        var input = this;
        toggle.classList.add('loading');
        input.disabled = true;
        api('set_allow_insecure', { value: val }).then(function (res) {
            toggle.classList.remove('loading');
            input.disabled = false;
            if (!res.ok) {
                input.checked = !input.checked;
                toast(res.error, false);
            }
        }).catch(function () {
            toggle.classList.remove('loading');
            input.disabled = false;
            input.checked = !input.checked;
            toast(t('msg.connFailed'), false);
        });
    });

    btnSaveUrltest.addEventListener('click', function () {
        var val = inpUrltestUrl.value.trim();
        btnLoading(btnSaveUrltest, true);
        api('set_urltest_url', { value: val }).then(function (res) {
            btnLoading(btnSaveUrltest, false);
            if (res.ok) toast(t('msg.settingsSaved'), true);
            else toast(res.error, false);
        }).catch(function () {
            btnLoading(btnSaveUrltest, false);
            toast(t('msg.connFailed'), false);
        });
    });

    function loadAll() {
        Promise.all([
            api('get_subscriptions'),
            api('get_rulesets'),
            api('get_status'),
            api('get_manual_nodes'),
            apiGet('get_settings'),
            fetchProxyStatus()
        ]).then(function (res) {
            if (res[0].ok) subscriptions = res[0].data || [];
            if (res[1].ok) rulesets = res[1].data || [];
            if (res[2].ok) {
                status = res[2].data || {};
                updateStatus();
                var warn = document.getElementById('routing-mode-warning');
                if (status.routing_mode && status.routing_mode !== 'custom') {
                    warn.classList.remove('hidden');
                } else {
                    warn.classList.add('hidden');
                }
            }
            if (res[3].ok) {
                manualNodesCache = res[3].data || [];
                renderManualNodes(manualNodesCache);
            }
            if (res[4].ok && res[4].data) {
                chkInsecure.checked = (res[4].data.allow_insecure === '1');
                inpUrltestUrl.value = res[4].data.urltest_url || '';
            }
            renderSubscriptions();
        }).catch(function (e) { toast(t('msg.error') + e.message, false); });
    }

    function renderSubscriptions() {
        var list = document.getElementById('subscriptions-list');
        if (!subscriptions.length) {
            list.innerHTML = '<div class="empty">' + esc(t('subs.empty')) + '</div>';
            return;
        }
        list.innerHTML = '';
        subscriptions.forEach(function (sub) {
            var disabled = sub.enabled === false;
            var card = document.createElement('div');
            card.className = 'card' + (disabled ? ' card-disabled' : '');

            var header = document.createElement('div');
            header.className = 'card-row card-toggle';
            header.innerHTML =
                '<div class="card-info">' +
                    '<div class="card-title">' +
                        '<span class="expand-icon">&#9654;</span>' +
                        esc(sub.name) +
                        '<span class="node-badge">' + sub.nodes + '</span>' +
                    '</div>' +
                    '<div class="card-meta">' + esc(sub.url.replace(/#.*$/, '')) + '</div>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<label class="toggle"><input type="checkbox" data-toggle-sub' +
                    (disabled ? '' : ' checked') +
                    '><span class="toggle-slider"></span></label>' +
                    '<button class="btn-icon" title="Delete" data-delete>&times;</button>' +
                '</div>';
            card.appendChild(header);

            var expand = document.createElement('div');
            expand.className = 'card-expand hidden';
            expand.dataset.hash = sub.hash;
            card.appendChild(expand);

            header.querySelector('.card-info').addEventListener('click', function () {
                var icon = header.querySelector('.expand-icon');
                if (expand.classList.contains('hidden')) {
                    expand.classList.remove('hidden');
                    icon.classList.add('open');
                    loadSubscriptionNodes(sub.hash, expand);
                } else {
                    expand.classList.add('hidden');
                    icon.classList.remove('open');
                }
            });

            header.querySelector('[data-toggle-sub]').addEventListener('change', function () {
                var enabled = this.checked;
                var toggle = this.closest('.toggle');
                var input = this;
                toggle.classList.add('loading');
                input.disabled = true;
                api('toggle_subscription', { url: sub.url, enabled: enabled ? '1' : '0' }).then(function (res) {
                    toggle.classList.remove('loading');
                    input.disabled = false;
                    if (res.ok) {
                        toast(enabled ? t('msg.subEnabled') : t('msg.subDisabled'), true);
                        loadAll();
                    } else {
                        input.checked = !enabled;
                        toast(res.error, false);
                    }
                }).catch(function () {
                    toggle.classList.remove('loading');
                    input.disabled = false;
                    input.checked = !enabled;
                    toast(t('msg.connFailed'), false);
                });
            });

            header.querySelector('[data-delete]').addEventListener('click', function (e) {
                e.stopPropagation();
                if (!confirm(t('confirm.deleteSub', { name: sub.name }))) return;
                var btn = this;
                btnLoading(btn, true);
                api('delete_subscription', { url: sub.url }).then(function (res) {
                    if (res.ok) { toast(t('msg.deleted'), true); loadAll(); }
                    else { btnLoading(btn, false); toast(res.error, false); }
                }).catch(function () { btnLoading(btn, false); toast(t('msg.connFailed'), false); });
            });

            list.appendChild(card);
        });
    }

    function loadSubscriptionNodes(hash, container) {
        container.innerHTML = '<div class="empty" style="padding:12px">' + esc(t('subs.loading')) + '</div>';
        apiGet('get_subscription_nodes', { hash: hash }).then(function (res) {
            if (!res.ok || !res.data || !res.data.length) {
                container.innerHTML = '<div class="empty" style="padding:12px">' + esc(t('subs.noServers')) + '</div>';
                return;
            }
            container.innerHTML = '';
            res.data.forEach(function (n) {
                var item = document.createElement('div');
                item.className = 'node-card';
                item.dataset.nodeId = n.id;
                item.innerHTML =
                    '<div class="node-card-head">' +
                        '<span class="node-type">' + esc(n.type || '?') + '</span>' +
                        '<span class="node-label">' + esc(n.label || 'Unnamed') + '</span>' +
                        '<span class="node-addr">' + esc((n.address || '') + ':' + (n.port || '')) + '</span>' +
                    '</div>' +
                    metricsHtml(n.id);
                bindTestButtons(item);
                container.appendChild(item);
            });
        });
    }

    document.getElementById('btn-add-sub').addEventListener('click', function () {
        modal(t('modal.addSub'), [
            { name: 'name', label: t('field.name'), placeholder: t('ph.name'), required: true },
            { name: 'url', label: t('field.url'), placeholder: t('ph.url'), required: true }
        ], function (vals) {
            if (!vals.url) { toast(t('msg.urlRequired'), false); return; }
            return api('add_subscription', { url: vals.url, name: vals.name }).then(function (res) {
                if (res.ok) { toast(t('msg.subAdded'), true); loadAll(); }
                else { toast(res.error, false); return false; }
            });
        });
    });

    document.getElementById('btn-refresh-subs').addEventListener('click', function () {
        var btn = document.getElementById('btn-refresh-subs');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner spinner-dark"></span> ' + esc(t('btn.updating'));
        api('refresh_subscriptions').then(function (res) {
            btn.disabled = false;
            btn.textContent = t('subs.refresh');
            if (res.ok) { toast(t('msg.subsUpdated'), true); loadAll(); }
            else toast(res.error || t('msg.updateFailed'), false);
        }).catch(function () {
            btn.disabled = false;
            btn.textContent = t('subs.refresh');
            toast(t('msg.connFailed'), false);
        });
    });

    // ── Custom Servers ───────────────────────────────────────

    function renderManualNodes(nodes) {
        manualNodesCache = nodes;
        var list = document.getElementById('manual-nodes-list');
        if (!nodes.length) {
            list.innerHTML = '<div class="empty">' + esc(t('nodes.empty')) + '</div>';
            return;
        }
        list.innerHTML = '';
        nodes.forEach(function (n) {
            var disabled = n.enabled === false;
            var card = document.createElement('div');
            card.className = 'card' + (disabled ? ' card-disabled' : '');
            card.dataset.nodeId = n.id;
            card.dataset.nodeEnabled = disabled ? '0' : '1';

            var addr = (n.address || '') + ':' + (n.port || '');
            var showAddr = n.label !== addr;
            card.innerHTML =
                '<div class="card-row">' +
                    '<div class="card-info">' +
                        '<div class="card-title">' + esc(n.label) +
                            '<span class="node-badge">' + esc(n.type || '') + '</span>' +
                            (showAddr ? '<span class="node-addr">' + esc(addr) + '</span>' : '') +
                            '</div>' +
                    '</div>' +
                    '<div class="card-actions">' +
                        '<label class="toggle"><input type="checkbox" data-toggle-node' +
                        (disabled ? '' : ' checked') +
                        '><span class="toggle-slider"></span></label>' +
                        '<button class="btn-icon" title="Delete" data-delete>&times;</button>' +
                    '</div>' +
                '</div>' +
                metricsHtml(n.id, n.enabled);

            bindTestButtons(card);

            card.querySelector('[data-toggle-node]').addEventListener('change', function () {
                var enabled = this.checked;
                var toggle = this.closest('.toggle');
                var input = this;
                toggle.classList.add('loading');
                input.disabled = true;
                api('toggle_node', { id: n.id, enabled: enabled ? '1' : '0' }).then(function (res) {
                    toggle.classList.remove('loading');
                    input.disabled = false;
                    if (res.ok) {
                        toast(enabled ? t('msg.nodeEnabled') : t('msg.nodeDisabled'), true);
                        loadAll();
                    } else {
                        input.checked = !enabled;
                        toast(res.error, false);
                    }
                }).catch(function () {
                    toggle.classList.remove('loading');
                    input.disabled = false;
                    input.checked = !enabled;
                    toast(t('msg.connFailed'), false);
                });
            });

            card.querySelector('[data-delete]').addEventListener('click', function () {
                if (!confirm(t('confirm.deleteNode', { name: n.label }))) return;
                var btn = this;
                btnLoading(btn, true);
                api('delete_node', { id: n.id }).then(function (res) {
                    if (res.ok) { toast(t('msg.deleted'), true); loadAll(); }
                    else { btnLoading(btn, false); toast(res.error, false); }
                }).catch(function () { btnLoading(btn, false); toast(t('msg.connFailed'), false); });
            });

            list.appendChild(card);
        });
    }

    function parseNodeUri(raw) {
        raw = raw.trim();
        var idx = raw.indexOf('://');
        if (idx === -1) return null;
        var scheme = raw.substring(0, idx).toLowerCase();
        var rest = raw.substring(idx + 3);

        if (scheme === 'vmess') {
            return parseVmessUri(rest);
        }

        if (scheme === 'wireguard' || scheme === 'wg') {
            return parseWireguardUri(rest);
        }

        var url;
        try { url = new URL('http://' + rest); } catch (e) { return null; }
        var p = {};
        url.searchParams.forEach(function (v, k) { p[k] = v; });
        var label = url.hash ? decodeURIComponent(url.hash.substring(1)) : '';
        var host = url.hostname.replace(/^\[|]$/g, '');
        var port = url.port;

        switch (scheme) {
        case 'vless':
            var cfg = {
                type: 'vless', label: label, address: host, port: port,
                uuid: decodeURIComponent(url.username),
                tls: (p.security === 'tls' || p.security === 'reality') ? '1' : '0',
                tls_sni: p.sni || ''
            };
            if (p.flow) cfg.vless_flow = p.flow;
            if (p.type && p.type !== 'tcp') cfg.transport = p.type;
            if (p.type === 'ws') { cfg.ws_host = p.host || ''; cfg.ws_path = p.path || ''; }
            if (p.type === 'grpc') cfg.grpc_servicename = p.serviceName || '';
            if (p.type === 'http' || p.headerType === 'http') { cfg.http_host = p.host || ''; cfg.http_path = p.path || ''; }
            if (p.type === 'httpupgrade') { cfg.httpupgrade_host = p.host || ''; cfg.http_path = p.path || ''; }
            return cfg;

        case 'trojan':
            var cfg = {
                type: 'trojan', label: label, address: host, port: port,
                password: decodeURIComponent(url.username),
                tls: '1', tls_sni: p.sni || ''
            };
            if (p.type && p.type !== 'tcp') cfg.transport = p.type;
            if (p.type === 'ws') { cfg.ws_host = p.host || ''; cfg.ws_path = p.path || ''; }
            if (p.type === 'grpc') cfg.grpc_servicename = p.serviceName || '';
            return cfg;

        case 'ss':
            var userPart = rest.split('#')[0];
            var userinfo, hostPart;
            var atIdx = userPart.lastIndexOf('@');
            if (atIdx !== -1) {
                var encoded = userPart.substring(0, atIdx);
                hostPart = userPart.substring(atIdx + 1);
                var decoded;
                try { decoded = atob(decodeURIComponent(encoded)); } catch (e) { decoded = null; }
                if (decoded && decoded.indexOf(':') !== -1) {
                    userinfo = decoded.split(':');
                } else {
                    userinfo = [decodeURIComponent(url.username), decodeURIComponent(url.password)];
                }
            } else {
                try {
                    var decoded = atob(userPart.split('#')[0]);
                    var u2 = new URL('http://' + decoded);
                    userinfo = atob(decodeURIComponent(u2.username)).split(':');
                    host = u2.hostname; port = u2.port;
                    label = url.hash ? decodeURIComponent(url.hash.substring(1)) : '';
                } catch (e) { return null; }
            }
            return {
                type: 'shadowsocks', label: label, address: host, port: port,
                shadowsocks_encrypt_method: userinfo[0] || '',
                password: userinfo.slice(1).join(':') || ''
            };

        case 'hysteria2':
        case 'hy2':
            return {
                type: 'hysteria2', label: label, address: host, port: port,
                password: url.username ? decodeURIComponent(url.username + (url.password ? ':' + url.password : '')) : '',
                tls_sni: p.sni || '',
                hysteria_obfs_password: p['obfs-password'] || ''
            };

        default:
            return null;
        }
    }

    function parseWireguardUri(rest) {
        var hashIdx = rest.indexOf('#');
        var label = '';
        var b64 = rest;
        if (hashIdx !== -1) {
            label = decodeURIComponent(rest.substring(hashIdx + 1));
            b64 = rest.substring(0, hashIdx);
        }

        var conf;
        try { conf = atob(b64); } catch (e) { return null; }

        var lines = conf.split('\n');
        var vals = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '[') continue;
            var eq = line.indexOf('=');
            if (eq === -1) continue;
            var key = line.substring(0, eq).trim();
            var val = line.substring(eq + 1).trim();
            vals[key] = val;
        }

        if (!vals.Endpoint) return null;
        var ep = vals.Endpoint;
        var colonIdx = ep.lastIndexOf(':');
        var address = ep.substring(0, colonIdx);
        var port = ep.substring(colonIdx + 1);
        address = address.replace(/^\[|]$/g, '');

        var addrs = (vals.Address || '').split(',');
        var ipv4 = '', ipv6 = '';
        for (var i = 0; i < addrs.length; i++) {
            var a = addrs[i].trim();
            if (!a) continue;
            if (a.indexOf(':') !== -1) ipv6 = a;
            else ipv4 = a;
        }

        return {
            type: 'wireguard',
            label: label || address + ':' + port,
            address: address,
            port: port,
            private_key: vals.PrivateKey || '',
            peer_public_key: vals.PublicKey || '',
            pre_shared_key: vals.PresharedKey || vals.PreSharedKey || '',
            local_address_ipv4: ipv4,
            local_address_ipv6: ipv6,
            dns: (vals.DNS || '').replace(/,/g, ', '),
            allowed_ips: (vals.AllowedIPs || vals.AllowedIps || '').replace(/,/g, ', '),
            mtu: vals.MTU || ''
        };
    }

    function parseVmessUri(b64) {
        var json;
        try { json = JSON.parse(atob(b64)); } catch (e) { return null; }
        if (!json.add || !json.port || !json.id) return null;
        var cfg = {
            type: 'vmess', label: json.ps || '', address: json.add, port: String(json.port),
            uuid: json.id, vmess_encrypt: json.scy || 'auto',
            tls: (json.tls === 'tls') ? '1' : '0',
            tls_sni: json.sni || json.host || ''
        };
        if (json.net && json.net !== 'tcp') {
            cfg.transport = json.net === 'h2' ? 'http' : json.net;
        }
        if (json.net === 'ws') { cfg.ws_host = json.host || ''; cfg.ws_path = json.path || ''; }
        if (json.net === 'grpc') cfg.grpc_servicename = json.path || '';
        if (json.net === 'h2' || json.type === 'http') { cfg.http_host = json.host || ''; cfg.http_path = json.path || ''; }
        if (json.net === 'httpupgrade') { cfg.httpupgrade_host = json.host || ''; cfg.http_path = json.path || ''; }
        return cfg;
    }

    function openAddNodeManual() {
        var wg = ['wireguard'];
        var ss = ['shadowsocks'];
        var hasUuid = ['vless', 'vmess'];
        var hasPw = ['shadowsocks', 'trojan', 'hysteria2'];
        var hasTls = ['vless', 'vmess', 'trojan', 'hysteria2'];
        var hasTransport = ['vless', 'vmess', 'trojan'];
        modal(t('modal.addServer'), [
            { name: 'type', label: t('field.type'), options: [
                { value: 'wireguard', text: 'WireGuard' },
                { value: 'shadowsocks', text: 'Shadowsocks' },
                { value: 'vless', text: 'VLESS' },
                { value: 'vmess', text: 'VMess' },
                { value: 'trojan', text: 'Trojan' },
                { value: 'hysteria2', text: 'Hysteria 2' }
            ]},
            { name: 'label', label: t('field.serverName'), placeholder: t('ph.serverName'), required: true },
            { name: 'address', label: t('field.serverAddr'), placeholder: t('ph.serverAddr'), required: true },
            { name: 'port', label: t('field.serverPort'), placeholder: t('ph.serverPort'), required: true },
            // Shadowsocks
            { name: 'shadowsocks_encrypt_method', label: t('field.ssMethod'), showFor: ss, options: [
                { value: '2022-blake3-aes-128-gcm', text: '2022-blake3-aes-128-gcm' },
                { value: '2022-blake3-aes-256-gcm', text: '2022-blake3-aes-256-gcm' },
                { value: '2022-blake3-chacha20-poly1305', text: '2022-blake3-chacha20-poly1305' },
                { value: 'aes-128-gcm', text: 'aes-128-gcm' },
                { value: 'aes-256-gcm', text: 'aes-256-gcm' },
                { value: 'chacha20-ietf-poly1305', text: 'chacha20-ietf-poly1305' },
                { value: 'none', text: 'none' }
            ]},
            // UUID (VLESS, VMess)
            { name: 'uuid', label: 'UUID', placeholder: t('ph.uuid'), showFor: hasUuid },
            // Password (SS, Trojan, Hysteria2)
            { name: 'password', label: t('field.password'), placeholder: t('ph.password'), showFor: hasPw },
            // VMess
            { name: 'vmess_encrypt', label: t('field.vmessEncrypt'), showFor: ['vmess'], options: [
                { value: 'auto', text: 'auto' },
                { value: 'aes-128-gcm', text: 'aes-128-gcm' },
                { value: 'chacha20-poly1305', text: 'chacha20-poly1305' },
                { value: 'none', text: 'none' }
            ]},
            // VLESS flow
            { name: 'vless_flow', label: t('field.vlessFlow'), showFor: ['vless'], options: [
                { value: 'none', text: t('opt.none') },
                { value: 'xtls-rprx-vision', text: 'xtls-rprx-vision' }
            ]},
            // TLS
            { name: 'tls', label: 'TLS', showFor: hasTls, options: [
                { value: '0', text: t('opt.disabled') },
                { value: '1', text: t('opt.enabled') }
            ]},
            { name: 'tls_sni', label: 'TLS SNI', placeholder: t('ph.tlsSni'), showFor: hasTls },
            // Transport
            { name: 'transport', label: t('field.transport'), showFor: hasTransport, options: [
                { value: 'none', text: t('opt.none') },
                { value: 'ws', text: 'WebSocket' },
                { value: 'grpc', text: 'gRPC' },
                { value: 'http', text: 'HTTP' },
                { value: 'httpupgrade', text: 'HTTPUpgrade' }
            ]},
            { name: 'ws_host', label: t('field.wsHost'), placeholder: t('ph.wsHost'), showFor: hasTransport },
            { name: 'ws_path', label: t('field.wsPath'), placeholder: t('ph.wsPath'), showFor: hasTransport },
            { name: 'grpc_servicename', label: t('field.grpcService'), placeholder: t('ph.grpcService'), showFor: hasTransport },
            { name: 'http_host', label: t('field.httpHost'), placeholder: t('ph.httpHost'), showFor: hasTransport },
            { name: 'http_path', label: t('field.httpPath'), placeholder: t('ph.httpPath'), showFor: hasTransport },
            { name: 'httpupgrade_host', label: t('field.httpupgradeHost'), placeholder: t('ph.httpupgradeHost'), showFor: hasTransport },
            // Hysteria2
            { name: 'hysteria_obfs_password', label: t('field.hyObfsPassword'), placeholder: t('ph.hyObfsPassword'), showFor: ['hysteria2'] },
            // WireGuard
            { name: 'private_key', label: t('field.privateKey'), placeholder: t('ph.privateKey'), showFor: wg },
            { name: 'peer_public_key', label: t('field.peerPublicKey'), placeholder: t('ph.peerPublicKey'), showFor: wg },
            { name: 'pre_shared_key', label: t('field.preSharedKey'), placeholder: t('ph.preSharedKey'), showFor: wg },
            { name: 'local_address_ipv4', label: t('field.localIpv4'), placeholder: t('ph.localIpv4'), showFor: wg },
            { name: 'local_address_ipv6', label: t('field.localIpv6'), placeholder: t('ph.localIpv6'), showFor: wg },
            { name: 'dns', label: t('field.dns'), placeholder: t('ph.dns'), showFor: wg },
            { name: 'allowed_ips', label: t('field.allowedIps'), placeholder: t('ph.allowedIps'), showFor: wg },
            { name: 'mtu', label: t('field.mtu'), placeholder: t('ph.mtu'), showFor: wg },
            { name: 'reserved', label: t('field.reserved'), placeholder: t('ph.reserved'), showFor: wg }
        ], function (vals) {
            if (!vals.label || !vals.address || !vals.port) {
                toast(t('msg.nameAddrPortRequired'), false);
                return;
            }
            return api('add_node', vals).then(function (res) {
                if (res.ok) { toast(t('msg.serverAdded'), true); loadAll(); }
                else { toast(res.error, false); return false; }
            });
        });
    }

    document.getElementById('btn-add-node').addEventListener('click', function () {
        modal(t('modal.addServer'), [
            { name: 'uri', label: t('field.importUri'), placeholder: t('ph.importUri') }
        ], function (vals) {
            if (vals.uri) {
                var parsed = parseNodeUri(vals.uri);
                if (!parsed) { toast(t('msg.invalidUri'), false); return; }
                if (!parsed.label) parsed.label = parsed.address + ':' + parsed.port;
                return api('add_node', parsed).then(function (res) {
                    if (res.ok) { toast(t('msg.serverAdded'), true); loadAll(); }
                    else { toast(res.error, false); return false; }
                });
            }
            toast(t('msg.pasteUri'), false);
        });

        var body = document.getElementById('modal-body');
        var divider = document.createElement('div');
        divider.className = 'modal-divider';
        divider.innerHTML = '<span>' + esc(t('modal.or')) + '</span>';
        body.appendChild(divider);

        var manualBtn = document.createElement('button');
        manualBtn.className = 'btn btn-secondary btn-block';
        manualBtn.textContent = t('modal.manualEntry');
        manualBtn.addEventListener('click', function () {
            openAddNodeManual();
        });
        body.appendChild(manualBtn);
    });

    // ── Custom Rules ─────────────────────────────────────────

    function loadCustomRules() {
        api('get_custom_rules').then(function (res) {
            if (!res.ok) return;
            customRules = res.data || [];
            renderCustomRules();
        });
    }

    function renderCustomRules() {
        var list = document.getElementById('custom-rules-list');
        if (!customRules.length) {
            list.innerHTML = '<div class="empty">' + esc(t('custom.empty')) + '</div>';
            return;
        }
        list.innerHTML = '';
        customRules.forEach(function (rule) {
            var item = document.createElement('div');
            item.className = 'node-item';
            item.innerHTML =
                '<span class="node-type">' + esc(rule.type) + '</span>' +
                '<span class="node-label">' + esc(rule.value) + '</span>' +
                '<button class="btn-icon btn-icon-sm" data-delete-rule>&times;</button>';

            item.querySelector('[data-delete-rule]').addEventListener('click', function () {
                if (!confirm(t('confirm.deleteRule', { value: rule.value }))) return;
                var btn = this;
                btnLoading(btn, true);
                api('delete_custom_rule', { type: rule.type, value: rule.value }).then(function (res) {
                    if (res.ok) { toast(t('msg.deleted'), true); loadCustomRules(); }
                    else { btnLoading(btn, false); toast(res.error, false); }
                }).catch(function () { btnLoading(btn, false); toast(t('msg.connFailed'), false); });
            });

            list.appendChild(item);
        });
    }

    document.getElementById('btn-add-custom-rule').addEventListener('click', function () {
        modal(t('modal.addCustomRule'), [
            { name: 'type', label: t('field.ruleType'), options: [
                { value: 'domain', text: 'Domain' },
                { value: 'ip_cidr', text: 'IP CIDR' }
            ]},
            { name: 'value', label: t('field.ruleValue'), placeholder: t('ph.domain'), required: true }
        ], function (vals) {
            if (!vals.value) { toast(t('msg.valueRequired'), false); return; }
            return api('add_custom_rule', { type: vals.type, value: vals.value }).then(function (res) {
                if (res.ok) { toast(t('msg.ruleAdded'), true); loadCustomRules(); }
                else { toast(res.error, false); return false; }
            });
        });
    });

    // ── Rule Sets ────────────────────────────────────────────

    function loadRulesets() {
        api('get_rulesets').then(function (res) {
            if (!res.ok) { toast(res.error, false); return; }
            rulesets = res.data || [];
            renderRulesets();
        });
    }

    function renderRulesets() {
        var list = document.getElementById('rulesets-list');
        if (!rulesets.length) {
            list.innerHTML = '<div class="empty">' + esc(t('rulesets.empty')) + '</div>';
            return;
        }
        list.innerHTML = '';
        rulesets.forEach(function (rs) {
            var card = document.createElement('div');
            card.className = 'card';
            card.innerHTML =
                '<div class="card-row">' +
                    '<div class="card-info">' +
                        '<div class="card-title">' + esc(rs.label || 'Unnamed') + '</div>' +
                        '<div class="card-meta">' + esc(rs.url || '') + '</div>' +
                    '</div>' +
                    '<div class="card-actions">' +
                        '<button class="btn-icon" title="Delete" data-delete>&times;</button>' +
                    '</div>' +
                '</div>';
            card.querySelector('[data-delete]').addEventListener('click', function () {
                if (!confirm(t('confirm.deleteRuleset', { name: rs.label || rs.id }))) return;
                var btn = this;
                btnLoading(btn, true);
                api('delete_ruleset', { id: rs.id }).then(function (r) {
                    if (r.ok) { toast(t('msg.deleted'), true); loadRulesets(); loadAll(); }
                    else { btnLoading(btn, false); toast(r.error, false); }
                }).catch(function () { btnLoading(btn, false); toast(t('msg.connFailed'), false); });
            });
            list.appendChild(card);
        });
    }

    document.getElementById('btn-add-ruleset').addEventListener('click', function () {
        modal(t('modal.addRuleset'), [
            { name: 'label', label: t('field.rulesetName'), placeholder: t('ph.rulesetName'), required: true },
            { name: 'url', label: t('field.rulesetUrl'), placeholder: t('ph.rulesetUrl'), required: true }
        ], function (vals) {
            if (!vals.label || !vals.url) { toast(t('msg.nameUrlRequired'), false); return; }
            return api('add_ruleset', { label: vals.label, url: vals.url }).then(function (res) {
                if (res.ok) { toast(t('msg.rulesetAdded'), true); loadRulesets(); }
                else { toast(res.error, false); return false; }
            });
        });
    });

    // ── Restart / Status ────────────────────────────────────

    function updateStatus() {
        var badge = document.getElementById('status-badge');
        if (status.running) {
            var label = t('status.running');
            if (status.engine) {
                label = status.engine;
                if (status.version) label += ' ' + status.version;
            }
            badge.textContent = label;
            badge.className = 'badge badge-on';
        } else {
            badge.textContent = t('status.stopped');
            badge.className = 'badge badge-off';
        }
    }

    function doRestart() {
        if (!confirm(t('confirm.restart'))) return;
        var btns = [document.getElementById('btn-apply'), document.getElementById('btn-apply-m')];
        btns.forEach(function (b) { if (b) { b.disabled = true; b.innerHTML = '<span class="spinner spinner-dark"></span> ' + esc(t('btn.restarting')); } });
        api('restart').then(function (res) {
            btns.forEach(function (b) { if (b) { b.disabled = false; b.textContent = t('header.restart'); } });
            if (res.ok) { toast(t('msg.restarted'), true); loadAll(); }
            else toast(res.error, false);
        }).catch(function () {
            btns.forEach(function (b) { if (b) { b.disabled = false; b.textContent = t('header.restart'); } });
            toast(t('msg.connFailed'), false);
        });
    }

    document.getElementById('btn-apply').addEventListener('click', doRestart);
    var btnApplyM = document.getElementById('btn-apply-m');
    if (btnApplyM) btnApplyM.addEventListener('click', doRestart);

    // ── Init ─────────────────────────────────────────────────

    applyLang();
    loadAll();

    setInterval(function () {
        api('get_status').then(function (res) {
            if (res.ok) {
                status = res.data || {};
                updateStatus();
            }
        });
    }, 10000);

    function updateMetricsInPlace() {
        document.querySelectorAll('[data-node-id]').forEach(function (el) {
            var nodeId = el.dataset.nodeId;
            var existing = el.querySelector('.node-metrics');
            var enabled = el.dataset.nodeEnabled !== '0';
            var html = metricsHtml(nodeId, enabled);
            if (!html) {
                if (existing) existing.remove();
                return;
            }
            if (existing) {
                existing.innerHTML = html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
            } else {
                var div = document.createElement('div');
                div.className = 'node-metrics';
                div.innerHTML = html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
                el.appendChild(div);
            }
            bindTestButtons(el);
        });
    }

    setInterval(function () {
        fetchProxyStatus().then(function () {
            updateMetricsInPlace();
        });
    }, 3000);
})();
