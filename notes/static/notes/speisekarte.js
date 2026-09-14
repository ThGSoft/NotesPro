/**
 * NotesPro ```speisekarte``` / ```menu``` block — tap a dish to message a user.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProSpeisekarte = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const FENCE_RE = /```(?:speisekarte|speise|menukarte|menucard|menu)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const ARCHIVE_FENCE_RE = /```(?:menubill|speisekarte-bill)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const MAX_TABLES = 40;
  const DEFAULT_TABLES = ['1', '2', '3', '4'];

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(';').forEach((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        config[trimmed.toLowerCase()] = '';
        return;
      }
      config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim();
    });
    return config;
  }

  function sanitizeColor(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
    if (/^(rgb|hsl)a?\([^)]+\)$/i.test(value)) return value;
    if (/^[a-z]{3,20}$/i.test(value)) return value;
    return '';
  }

  function resolveStyle(cfg) {
    const colRaw = String(cfg.col || cfg.color || '').trim();
    const lower = colRaw.toLowerCase();
    let theme = '';
    let colorCss = '';
    if (THEMES.includes(lower)) theme = lower;
    else if (colRaw) colorCss = sanitizeColor(colRaw);
    const bgCss = sanitizeColor(cfg.bkcol || cfg.bgcol || cfg.bg || '');
    return { theme, colorCss, bgCss };
  }

  function resolveVia(cfg) {
    const raw = String(cfg.via || cfg.send || cfg.channel || 'mail').trim().toLowerCase();
    if (raw === 'dm' || raw === 'chat' || raw === 'private' || raw === 'message') return 'dm';
    if (raw === 'group' || raw === 'workspace') return 'chat';
    return 'mail';
  }

  function parseToList(cfg) {
    const raw = String(cfg.to || cfg.user || cfg.an || cfg.anwender || '').trim();
    if (!raw) return [];
    return raw.split(/[,+\s]+/).map((part) => part.trim()).filter(Boolean);
  }

  function expandTableToken(token) {
    const value = String(token || '').trim();
    if (!value) return [];
    const range = value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!range) return [value];
    const start = Math.min(parseInt(range[1], 10), parseInt(range[2], 10));
    const end = Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
    const out = [];
    for (let i = start; i <= end && out.length < MAX_TABLES; i += 1) out.push(String(i));
    return out;
  }

  function tablesFromCount(count) {
    const n = Math.max(1, Math.min(MAX_TABLES, Number(count) || 0));
    return expandTableToken(`1-${n}`);
  }

  function parseTables(cfg) {
    const raw = String(
      cfg.tables || cfg.tische || cfg.tisch || cfg.table || cfg.tischnr || cfg.tablenr || cfg.nr || '',
    ).trim();
    if (!raw) {
      const count = parseInt(cfg.count || cfg.n || '', 10);
      return count >= 1 ? tablesFromCount(count) : DEFAULT_TABLES.slice();
    }
    const seen = new Set();
    const tables = [];
    raw.split(/[,;+]/).forEach((part) => {
      expandTableToken(part.trim()).forEach((id) => {
        if (!id || seen.has(id) || tables.length >= MAX_TABLES) return;
        seen.add(id);
        tables.push(id);
      });
    });
    return tables.length ? tables : DEFAULT_TABLES.slice();
  }

  function tableLabel(id) {
    return /^\d+$/.test(String(id)) ? `Table ${id}` : String(id);
  }

  function sanitizeFenceValue(raw) {
    return String(raw || '').replace(/[;{}\n\r]/g, ' ').trim();
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toIsoLocal(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function formatDateTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function parseMoney(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/(-?\d+(?:[.,]\d+)?)/);
    if (!match) return { amount: null, prefix: '', suffix: '' };
    const amount = parseFloat(match[1].replace(',', '.'));
    return {
      amount: Number.isFinite(amount) ? amount : null,
      prefix: text.slice(0, match.index).trim(),
      suffix: text.slice(match.index + match[1].length).trim(),
    };
  }

  function formatMoney(amount, samplePrice) {
    if (!Number.isFinite(amount)) return '';
    const parsed = parseMoney(samplePrice);
    const n = amount.toFixed(2);
    if (parsed.prefix) return `${parsed.prefix} ${n}`.trim();
    if (parsed.suffix) return `${n} ${parsed.suffix}`.trim();
    return n;
  }

  function parseMenu(source, cfg) {
    const sections = [];
    let current = { title: '', items: [] };
    String(source || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^#+\s+/.test(trimmed)) {
        if (current.items.length || current.title) sections.push(current);
        current = { title: trimmed.replace(/^#+\s+/, '').trim(), items: [] };
        return;
      }
      const row = trimmed.replace(/^[-*•]\s+/, '');
      const parts = row.split('|').map((part) => part.trim());
      const name = parts[0];
      if (!name) return;
      current.items.push({
        name,
        price: parts[1] || '',
        note: parts.slice(2).join(' | '),
      });
    });
    if (current.items.length || current.title) sections.push(current);
    const tables = parseTables(cfg);
    return {
      title: String(cfg.title || 'Menu').trim() || 'Menu',
      to: parseToList(cfg),
      via: resolveVia(cfg),
      msg: String(cfg.msg || cfg.message || cfg.text || '').trim(),
      tables,
      table: tables[0] || '',
      style: resolveStyle(cfg),
      sections,
    };
  }

  function encodeSpec(spec) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
    } catch (_) {
      return '';
    }
  }

  function decodeSpec(raw) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(String(raw || '')))));
    } catch (_) {
      return null;
    }
  }

  function billStorageKey(el, spec) {
    const idx = el?.dataset?.speisekarteIndex || '0';
    const title = spec?.title || '';
    return `notespro-speisekarte:${location.pathname}:${idx}:${title}`;
  }

  function loadState(el, spec) {
    const tables = spec?.tables?.length ? spec.tables : DEFAULT_TABLES;
    const empty = { active: tables[0] || '', bills: {} };
    try {
      const raw = sessionStorage.getItem(billStorageKey(el, spec));
      const data = raw ? JSON.parse(raw) : null;
      if (!data) return empty;
      if (Array.isArray(data.lines)) {
        const table = String(data.table || tables[0] || '');
        return { active: table, bills: table ? { [table]: data.lines } : {} };
      }
      const bills = data.bills && typeof data.bills === 'object' ? data.bills : {};
      let active = String(data.active || '');
      if (!tables.includes(active)) active = tables[0] || '';
      return { active, bills };
    } catch (_) {
      return empty;
    }
  }

  function saveState(el, spec, state) {
    try {
      sessionStorage.setItem(billStorageKey(el, spec), JSON.stringify({
        active: state.active || '',
        bills: state.bills || {},
      }));
    } catch (_) { /* ignore */ }
  }

  function lineKey(item) {
    return `${item.name || ''}\n${item.price || ''}\n${item.note || ''}`;
  }

  function summarizeBill(bill) {
    let total = 0;
    let priced = 0;
    let sample = '';
    const lines = (bill.lines || []).map((line) => {
      const qty = Math.max(1, Number(line.qty) || 1);
      const money = parseMoney(line.price);
      let lineTotal = null;
      let lineTotalLabel = line.price || '';
      if (money.amount != null) {
        lineTotal = money.amount * qty;
        total += lineTotal;
        priced += 1;
        if (!sample) sample = line.price;
        lineTotalLabel = formatMoney(lineTotal, line.price);
      } else if (qty > 1 && line.price) {
        lineTotalLabel = `${qty} × ${line.price}`;
      }
      return { ...line, qty, lineTotal, lineTotalLabel };
    });
    return {
      table: bill.table || '',
      lines,
      total: priced ? total : null,
      totalLabel: priced ? formatMoney(total, sample) : '',
    };
  }

  function readActiveTable(el, spec) {
    const marked = el?.dataset?.speisekarteActive;
    if (marked) return marked;
    return loadState(el, spec).active || spec?.table || spec?.tables?.[0] || '';
  }

  function setActiveTable(el, spec, table) {
    const id = String(table || '').trim();
    if (!id) return;
    const state = loadState(el, spec);
    state.active = id;
    saveState(el, spec, state);
    if (el) el.dataset.speisekarteActive = id;
    renderBills(el, spec);
  }

  function addBillLine(el, spec, item, table) {
    const tableId = String(table || readActiveTable(el, spec) || '').trim();
    if (!tableId) return summarizeBill({ table: '', lines: [] });
    const state = loadState(el, spec);
    state.active = tableId;
    const lines = Array.isArray(state.bills[tableId]) ? state.bills[tableId] : [];
    const key = lineKey(item);
    const existing = lines.find((line) => lineKey(line) === key);
    if (existing) existing.qty = Math.max(1, Number(existing.qty) || 1) + 1;
    else {
      lines.push({
        name: item.name || '',
        price: item.price || '',
        note: item.note || '',
        qty: 1,
      });
    }
    state.bills[tableId] = lines;
    saveState(el, spec, state);
    if (el) el.dataset.speisekarteActive = tableId;
    renderBills(el, spec);
    return summarizeBill({ table: tableId, lines });
  }

  function clearBill(el, spec, table) {
    const tableId = String(table || readActiveTable(el, spec) || '').trim();
    const state = loadState(el, spec);
    if (tableId) state.bills[tableId] = [];
    saveState(el, spec, state);
    renderBills(el, spec);
  }

  function getBill(el, spec, table) {
    const tableId = String(table || readActiveTable(el, spec) || '').trim();
    const state = loadState(el, spec);
    return summarizeBill({ table: tableId, lines: state.bills[tableId] || [] });
  }

  function formatOrderText(spec, item, extras = {}) {
    const pageTitle = extras.pageTitle || 'page';
    const table = extras.table || spec?.table || '';
    const menuTitle = spec?.title || 'Menu';
    const extra = item.note ? ` (${item.note})` : '';
    const price = item.price ? ` — ${item.price}` : '';
    const tableLine = table ? `\nTable: ${table}` : '';
    const custom = String(spec?.msg || '').trim();
    if (custom) {
      return custom
        .replace(/\{name\}/gi, item.name || '')
        .replace(/\{price\}/gi, item.price || '')
        .replace(/\{note\}/gi, item.note || '')
        .replace(/\{menu\}/gi, menuTitle)
        .replace(/\{page\}/gi, pageTitle)
        .replace(/\{table\}/gi, table)
        .replace(/\{tisch\}/gi, table);
    }
    return `Order from ${menuTitle} (${pageTitle}): ${item.name}${extra}${price}${tableLine}`;
  }

  function formatBillText(spec, bill, extras = {}) {
    const pageTitle = extras.pageTitle || 'page';
    const menuTitle = spec?.title || 'Menu';
    const table = bill.table || spec?.table || '';
    const lines = (bill.lines || []).map((line) => {
      const qty = line.qty > 1 ? ` ×${line.qty}` : '';
      const extra = line.note ? ` (${line.note})` : '';
      const price = line.lineTotalLabel || line.price || '';
      return `• ${line.name}${qty}${extra}${price ? ` — ${price}` : ''}`;
    });
    const sum = bill.totalLabel ? `\nTotal: ${bill.totalLabel}` : '';
    const when = extras.at ? formatDateTime(extras.at) : '';
    const whenLine = when ? `\nDate: ${when}` : '';
    const custom = String(spec?.msg || '').trim();
    if (custom && /\{(bill|lines|sum)\}/i.test(custom)) {
      return custom
        .replace(/\{menu\}/gi, menuTitle)
        .replace(/\{page\}/gi, pageTitle)
        .replace(/\{table\}/gi, table)
        .replace(/\{tisch\}/gi, table)
        .replace(/\{sum\}/gi, bill.totalLabel || '')
        .replace(/\{date\}/gi, when)
        .replace(/\{bill\}/gi, lines.join('\n'))
        .replace(/\{lines\}/gi, lines.join('\n'));
    }
    return `Bill · Table ${table || '—'} — ${menuTitle} (${pageTitle})${whenLine}\n${lines.join('\n')}${sum}`;
  }

  function parseArchiveItemLine(line) {
    const row = String(line || '').replace(/^[-*•]\s+/, '').trim();
    if (!row) return null;
    const parts = row.split('|').map((part) => part.trim());
    const name = parts[0];
    if (!name) return null;
    const price = parts[1] || '';
    const rest = parts.slice(2).join(' | ');
    let qty = 1;
    let note = rest;
    const qtyMatch = rest.match(/(?:^|;)\s*qty\s*=\s*(\d+)/i);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1], 10) || 1;
      note = rest.replace(/(?:^|;)\s*qty\s*=\s*\d+/i, '').replace(/^;+|;+$/g, '').trim();
    }
    return { name, price, note, qty };
  }

  function parseArchiveEntries(markdown) {
    const entries = [];
    const re = new RegExp(ARCHIVE_FENCE_RE.source, ARCHIVE_FENCE_RE.flags);
    let match;
    while ((match = re.exec(String(markdown || ''))) !== null) {
      const cfg = parseFenceAttrs(match[1]);
      const lines = [];
      String(match[2] || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
        const item = parseArchiveItemLine(line);
        if (item) lines.push(item);
      });
      const atRaw = cfg.at || cfg.date || cfg.time || '';
      const at = atRaw ? new Date(atRaw) : null;
      entries.push({
        table: cfg.table || cfg.tisch || '',
        menu: cfg.menu || cfg.title || '',
        index: cfg.index != null && cfg.index !== '' ? String(cfg.index) : '',
        total: cfg.total || '',
        at: at && !Number.isNaN(at.getTime()) ? at : null,
        atLabel: at && !Number.isNaN(at.getTime()) ? formatDateTime(at) : String(atRaw || ''),
        lines: summarizeBill({ table: cfg.table || '', lines }).lines,
        totalLabel: cfg.total || summarizeBill({ table: cfg.table || '', lines }).totalLabel,
      });
    }
    entries.sort((a, b) => {
      const ta = a.at ? a.at.getTime() : 0;
      const tb = b.at ? b.at.getTime() : 0;
      return tb - ta;
    });
    return entries;
  }

  function formatArchiveFence(spec, bill, extras = {}) {
    const at = extras.at instanceof Date ? extras.at : new Date();
    const table = sanitizeFenceValue(bill.table || spec?.table || '');
    const menu = sanitizeFenceValue(spec?.title || 'Menu');
    const total = sanitizeFenceValue(bill.totalLabel || '');
    const index = extras.index != null ? String(extras.index) : '';
    const attrs = [`table=${table}`, `at=${toIsoLocal(at)}`, `menu=${menu}`];
    if (index !== '') attrs.push(`index=${sanitizeFenceValue(index)}`);
    if (total) attrs.push(`total=${total}`);
    const lines = (bill.lines || []).map((line) => {
      const qty = Number(line.qty) > 1 ? `qty=${line.qty}` : '';
      const extra = [qty, line.note || ''].filter(Boolean).join('; ');
      return extra ? `${line.name} | ${line.price || ''} | ${extra}` : `${line.name} | ${line.price || ''}`;
    });
    return `\`\`\`menubill{${attrs.join(';')}}\n${lines.join('\n')}\n\`\`\``;
  }

  function renderArchiveEntry(entry) {
    const when = entry.atLabel || 'Unknown date';
    const table = entry.table ? tableLabel(entry.table) : 'Table';
    const total = entry.totalLabel ? `<div class="speisekarte-bill-total"><span>Total</span><span class="speisekarte-bill-sum">${escapeHtml(entry.totalLabel)}</span></div>` : '';
    const lines = (entry.lines || []).length
      ? `<ul class="speisekarte-bill-lines">${(entry.lines || []).map((line) => {
          const qty = line.qty > 1 ? `<span class="speisekarte-bill-qty">×${escapeHtml(String(line.qty))}</span>` : '';
          const price = line.lineTotalLabel || line.price
            ? `<span class="speisekarte-bill-price">${escapeHtml(line.lineTotalLabel || line.price)}</span>`
            : '';
          return `<li class="speisekarte-bill-line"><span class="speisekarte-bill-name">${escapeHtml(line.name)}${qty}</span>${price}</li>`;
        }).join('')}</ul>`
      : '<p class="speisekarte-bill-empty">No items</p>';
    return [
      `<article class="md-panel md-panel--note speisekarte-archive-entry">`,
      `<div class="md-panel-title">${escapeHtml(table)} · ${escapeHtml(when)}</div>`,
      `<div class="md-panel-body">`,
      lines,
      total,
      `</div>`,
      `</article>`,
    ].join('');
  }

  function renderArchiveSection(markdown, options = {}) {
    const index = options.speisekarteIndex != null ? String(options.speisekarteIndex) : '';
    const menu = options.menuTitle || '';
    let entries = parseArchiveEntries(markdown);
    if (index !== '') {
      const matched = entries.filter((entry) => entry.index === index);
      if (matched.length) entries = matched;
      else if (menu) entries = entries.filter((entry) => !entry.index && (!entry.menu || entry.menu === menu));
    } else if (menu) {
      entries = entries.filter((entry) => !entry.menu || entry.menu === menu);
    }
    if (!entries.length) return '';
    return [
      `<details class="speisekarte-archive">`,
      `<summary>Archived bills (${entries.length})</summary>`,
      `<div class="speisekarte-archive-body">${entries.map(renderArchiveEntry).join('')}</div>`,
      `</details>`,
    ].join('');
  }

  function renderItem(item, index) {
    const note = item.note
      ? `<span class="speisekarte-item-note">${escapeHtml(item.note)}</span>`
      : '';
    const price = item.price
      ? `<span class="speisekarte-item-price">${escapeHtml(item.price)}</span>`
      : '';
    return [
      `<button type="button" class="speisekarte-item" data-menu-index="${index}">`,
      `<span class="speisekarte-item-main">`,
      `<span class="speisekarte-item-name">${escapeHtml(item.name)}</span>`,
      note,
      `</span>`,
      `<span class="speisekarte-item-dots" aria-hidden="true"></span>`,
      price,
      `</button>`,
    ].join('');
  }

  function flattenItems(spec) {
    const items = [];
    (spec.sections || []).forEach((section) => {
      (section.items || []).forEach((item) => items.push(item));
    });
    return items;
  }

  function panelTheme(spec) {
    return THEMES.includes(spec?.style?.theme) ? spec.style.theme : 'warning';
  }

  function renderTablePanel(spec, tableId) {
    const theme = panelTheme(spec);
    const id = escapeHtml(tableId);
    return [
      `<article class="md-panel md-panel--${theme} speisekarte-table-panel" data-speisekarte-table="${id}">`,
      `<div class="md-panel-title speisekarte-table-title">`,
      `<span class="speisekarte-table-name">${escapeHtml(tableLabel(tableId))}</span>`,
      `<span class="speisekarte-table-count" hidden></span>`,
      `<button type="button" class="speisekarte-bill-clear" data-speisekarte-clear data-speisekarte-table="${id}">Clear</button>`,
      `</div>`,
      `<div class="md-panel-body">`,
      `<p class="speisekarte-bill-empty">Free</p>`,
      `<ul class="speisekarte-bill-lines"></ul>`,
      `<div class="speisekarte-bill-total">`,
      `<span>Total</span>`,
      `<span class="speisekarte-bill-sum">—</span>`,
      `</div>`,
      `<button type="button" class="speisekarte-bill-btn" data-speisekarte-bill data-speisekarte-table="${id}" disabled>Bill</button>`,
      `</div>`,
      `</article>`,
    ].join('');
  }

  function renderBills(el, spec) {
    if (!el) return;
    const state = loadState(el, spec);
    const active = el.dataset.speisekarteActive || state.active;
    el.querySelectorAll('.speisekarte-table-panel').forEach((panel) => {
      const tableId = panel.dataset.speisekarteTable || '';
      const bill = summarizeBill({ table: tableId, lines: state.bills[tableId] || [] });
      const list = panel.querySelector('.speisekarte-bill-lines');
      const sumEl = panel.querySelector('.speisekarte-bill-sum');
      const emptyEl = panel.querySelector('.speisekarte-bill-empty');
      const billBtn = panel.querySelector('[data-speisekarte-bill]');
      const countEl = panel.querySelector('.speisekarte-table-count');
      panel.classList.toggle('is-active', tableId === active);
      panel.classList.toggle('is-occupied', bill.lines.length > 0);
      if (countEl) {
        const n = bill.lines.reduce((sum, line) => sum + (Number(line.qty) || 1), 0);
        countEl.hidden = n < 1;
        countEl.textContent = n ? String(n) : '';
      }
      if (!list) return;
      if (!bill.lines.length) {
        list.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (sumEl) sumEl.textContent = '—';
        if (billBtn) billBtn.disabled = true;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      if (billBtn) billBtn.disabled = false;
      list.innerHTML = bill.lines.map((line) => {
        const qty = line.qty > 1 ? `<span class="speisekarte-bill-qty">×${escapeHtml(String(line.qty))}</span>` : '';
        const note = line.note
          ? `<span class="speisekarte-bill-note">${escapeHtml(line.note)}</span>`
          : '';
        const price = line.lineTotalLabel
          ? `<span class="speisekarte-bill-price">${escapeHtml(line.lineTotalLabel)}</span>`
          : '';
        return [
          `<li class="speisekarte-bill-line">`,
          `<span class="speisekarte-bill-name">${escapeHtml(line.name)}${qty}</span>`,
          note,
          price,
          `</li>`,
        ].join('');
      }).join('');
      if (sumEl) sumEl.textContent = bill.totalLabel || '—';
    });
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const spec = parseMenu(source, cfg);
    const style = spec.style;
    const themeClass = style.theme ? ` speisekarte-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' speisekarte-block--custom' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--speisekarte-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--speisekarte-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const index = Number.isFinite(options.speisekarteIndex) ? options.speisekarteIndex : 0;
    const viaLabel = spec.via === 'dm' ? 'private message' : (spec.via === 'chat' ? 'group chat' : 'mail');
    const toLabel = spec.to.length ? spec.to.join(', ') : 'workspace owner';
    let itemIndex = 0;
    const sectionsHtml = spec.sections.length
      ? spec.sections.map((section) => {
          const heading = section.title
            ? `<h3 class="speisekarte-section-title">${escapeHtml(section.title)}</h3>`
            : '';
          const items = (section.items || []).map((item) => renderItem(item, itemIndex++)).join('');
          return `<section class="speisekarte-section">${heading}${items}</section>`;
        }).join('')
      : '<p class="speisekarte-empty">Add dishes as <code>Name | price | extra</code></p>';
    const tablesHtml = (spec.tables || []).map((id) => renderTablePanel(spec, id)).join('');
    const tableCount = spec.tables?.length || DEFAULT_TABLES.length;
    const settingsHtml = options.editable
      ? [
          `<button type="button" class="speisekarte-settings-btn" data-speisekarte-settings aria-expanded="false" title="Menu settings">⚙</button>`,
          `<div class="speisekarte-settings" hidden>`,
          `<label class="speisekarte-settings-field">Number of tables`,
          `<input type="number" class="speisekarte-tables-input" data-speisekarte-tables min="1" max="${MAX_TABLES}" value="${tableCount}">`,
          `</label>`,
          `</div>`,
        ].join('')
      : '';
    const archiveHtml = renderArchiveSection(options.archiveMarkdown || '', {
      speisekarteIndex: index,
      menuTitle: spec.title,
    });
    return [
      `<div class="speisekarte-block${themeClass}${customClass}"${styleAttr}`,
      ` data-speisekarte-index="${index}"`,
      ` data-speisekarte-spec="${escapeHtml(encodeSpec(spec))}">`,
      `<div class="speisekarte-header">`,
      `<div class="speisekarte-heading">`,
      `<div class="speisekarte-title">${escapeHtml(spec.title)}</div>`,
      `<div class="speisekarte-meta">Select a table · click a dish · ${escapeHtml(viaLabel)} to ${escapeHtml(toLabel)}</div>`,
      `</div>`,
      settingsHtml,
      `</div>`,
      sectionsHtml,
      `<div class="speisekarte-tables">${tablesHtml}</div>`,
      archiveHtml,
      `</div>`,
    ].join('');
  }

  function hydrateBlock(el, hooks = {}) {
    if (!el || el.dataset.speisekarteHydrated === '1') return;
    const spec = decodeSpec(el.dataset.speisekarteSpec);
    if (!spec) return;
    el.dataset.speisekarteHydrated = '1';
    const items = flattenItems(spec);
    const saved = loadState(el, spec);
    el.dataset.speisekarteActive = saved.active || spec.tables?.[0] || '';
    renderBills(el, spec);

    const settingsBtn = el.querySelector('[data-speisekarte-settings]');
    const settingsPanel = el.querySelector('.speisekarte-settings');
    const tablesInput = el.querySelector('[data-speisekarte-tables]');
    settingsBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = settingsPanel?.hidden !== false;
      if (settingsPanel) settingsPanel.hidden = !open;
      settingsBtn.classList.toggle('is-open', open);
      settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    tablesInput?.addEventListener('click', (event) => event.stopPropagation());
    tablesInput?.addEventListener('keydown', (event) => event.stopPropagation());
    tablesInput?.addEventListener('change', () => {
      const tableCount = parseInt(tablesInput.value, 10);
      hooks.onSettings?.({ spec, el, tableCount });
    });
    el.querySelector('.speisekarte-settings')?.addEventListener('click', (event) => event.stopPropagation());
    el.querySelector('.speisekarte-archive')?.addEventListener('click', (event) => event.stopPropagation());

    el.addEventListener('click', (event) => {
      const clearBtn = event.target.closest('[data-speisekarte-clear]');
      if (clearBtn && el.contains(clearBtn)) {
        event.preventDefault();
        event.stopPropagation();
        clearBill(el, spec, clearBtn.dataset.speisekarteTable);
        return;
      }
      const billBtn = event.target.closest('[data-speisekarte-bill]');
      if (billBtn && el.contains(billBtn) && !billBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const table = billBtn.dataset.speisekarteTable || readActiveTable(el, spec);
        const bill = getBill(el, spec, table);
        hooks.onBill?.({ spec, bill, el, btn: billBtn, table: bill.table });
        return;
      }
      const panel = event.target.closest('.speisekarte-table-panel');
      if (panel && el.contains(panel)) {
        event.preventDefault();
        event.stopPropagation();
        setActiveTable(el, spec, panel.dataset.speisekarteTable);
        return;
      }
      const btn = event.target.closest('.speisekarte-item');
      if (!btn || !el.contains(btn) || btn.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      const idx = parseInt(btn.dataset.menuIndex, 10);
      const item = items[idx];
      if (!item) return;
      const table = readActiveTable(el, spec);
      const result = hooks.onOrder?.({ spec, item, el, btn, table });
      Promise.resolve(result).then((ok) => {
        if (ok === false) return;
        addBillLine(el, spec, item, table);
      });
    });
  }

  function hydrate(root, hooks = {}) {
    (root || document).querySelectorAll('.speisekarte-block[data-speisekarte-spec]').forEach((el) => {
      hydrateBlock(el, hooks);
    });
  }

  return {
    FENCE_RE,
    ARCHIVE_FENCE_RE,
    MAX_TABLES,
    parseFenceAttrs,
    parseMenu,
    parseMoney,
    formatMoney,
    formatOrderText,
    formatBillText,
    formatArchiveFence,
    parseArchiveEntries,
    getBill,
    addBillLine,
    clearBill,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
