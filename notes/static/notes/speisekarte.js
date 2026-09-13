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

  function parseTableAttr(cfg) {
    return String(cfg.tisch || cfg.table || cfg.tischnr || cfg.tablenr || cfg.nr || '').trim();
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
    return {
      title: String(cfg.title || 'Speisekarte').trim() || 'Speisekarte',
      to: parseToList(cfg),
      via: resolveVia(cfg),
      msg: String(cfg.msg || cfg.message || cfg.text || '').trim(),
      table: parseTableAttr(cfg),
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

  function loadBill(el, spec) {
    try {
      const raw = sessionStorage.getItem(billStorageKey(el, spec));
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.lines)) {
        return {
          table: String(data.table || spec.table || ''),
          lines: data.lines,
        };
      }
    } catch (_) { /* ignore */ }
    return { table: spec.table || '', lines: [] };
  }

  function saveBill(el, spec, bill) {
    try {
      sessionStorage.setItem(billStorageKey(el, spec), JSON.stringify({
        table: bill.table || '',
        lines: bill.lines || [],
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

  function readTable(el, spec) {
    const input = el?.querySelector?.('.speisekarte-table-input');
    const value = input ? String(input.value || '').trim() : '';
    return value || String(spec?.table || '').trim();
  }

  function addBillLine(el, spec, item) {
    const bill = loadBill(el, spec);
    bill.table = readTable(el, spec);
    const key = lineKey(item);
    const existing = bill.lines.find((line) => lineKey(line) === key);
    if (existing) existing.qty = Math.max(1, Number(existing.qty) || 1) + 1;
    else {
      bill.lines.push({
        name: item.name || '',
        price: item.price || '',
        note: item.note || '',
        qty: 1,
      });
    }
    saveBill(el, spec, bill);
    renderBill(el, spec);
    return summarizeBill(bill);
  }

  function clearBill(el, spec) {
    const table = readTable(el, spec);
    saveBill(el, spec, { table, lines: [] });
    renderBill(el, spec);
  }

  function getBill(el, spec) {
    const bill = loadBill(el, spec);
    bill.table = readTable(el, spec);
    return summarizeBill(bill);
  }

  function formatOrderText(spec, item, extras = {}) {
    const pageTitle = extras.pageTitle || 'page';
    const table = extras.table || spec?.table || '';
    const menuTitle = spec?.title || 'Speisekarte';
    const extra = item.note ? ` (${item.note})` : '';
    const price = item.price ? ` — ${item.price}` : '';
    const tableLine = table ? `\nTisch: ${table}` : '';
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
    const menuTitle = spec?.title || 'Speisekarte';
    const table = bill.table || spec?.table || '';
    const lines = (bill.lines || []).map((line) => {
      const qty = line.qty > 1 ? ` ×${line.qty}` : '';
      const extra = line.note ? ` (${line.note})` : '';
      const price = line.lineTotalLabel || line.price || '';
      return `• ${line.name}${qty}${extra}${price ? ` — ${price}` : ''}`;
    });
    const sum = bill.totalLabel ? `\nSumme: ${bill.totalLabel}` : '';
    const custom = String(spec?.msg || '').trim();
    if (custom && /\{(bill|lines|sum)\}/i.test(custom)) {
      return custom
        .replace(/\{menu\}/gi, menuTitle)
        .replace(/\{page\}/gi, pageTitle)
        .replace(/\{table\}/gi, table)
        .replace(/\{tisch\}/gi, table)
        .replace(/\{sum\}/gi, bill.totalLabel || '')
        .replace(/\{bill\}/gi, lines.join('\n'))
        .replace(/\{lines\}/gi, lines.join('\n'));
    }
    return `Rechnung Tisch ${table || '—'} — ${menuTitle} (${pageTitle})\n${lines.join('\n')}${sum}`;
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

  function renderBill(el, spec) {
    if (!el) return;
    const list = el.querySelector('.speisekarte-bill-lines');
    const sumEl = el.querySelector('.speisekarte-bill-sum');
    const emptyEl = el.querySelector('.speisekarte-bill-empty');
    const billBtn = el.querySelector('[data-speisekarte-bill]');
    if (!list) return;
    const bill = summarizeBill(loadBill(el, spec));
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
    const tableValue = escapeHtml(spec.table);
    return [
      `<div class="speisekarte-block${themeClass}${customClass}"${styleAttr}`,
      ` data-speisekarte-index="${index}"`,
      ` data-speisekarte-spec="${escapeHtml(encodeSpec(spec))}">`,
      `<div class="speisekarte-header">`,
      `<div class="speisekarte-title">${escapeHtml(spec.title)}</div>`,
      `<div class="speisekarte-meta">Click a dish · ${escapeHtml(viaLabel)} to ${escapeHtml(toLabel)}</div>`,
      `</div>`,
      `<label class="speisekarte-table">`,
      `<span>Tisch Nr.</span>`,
      `<input type="text" class="speisekarte-table-input" inputmode="numeric" maxlength="12"`,
      ` value="${tableValue}" placeholder="—" aria-label="Table number">`,
      `</label>`,
      sectionsHtml,
      `<footer class="speisekarte-bill">`,
      `<div class="speisekarte-bill-head">`,
      `<div class="speisekarte-bill-title">Rechnung</div>`,
      `<button type="button" class="speisekarte-bill-clear" data-speisekarte-clear>Clear</button>`,
      `</div>`,
      `<p class="speisekarte-bill-empty">Click dishes to add them here.</p>`,
      `<ul class="speisekarte-bill-lines"></ul>`,
      `<div class="speisekarte-bill-total">`,
      `<span>Summe</span>`,
      `<span class="speisekarte-bill-sum">—</span>`,
      `</div>`,
      `<button type="button" class="speisekarte-bill-btn" data-speisekarte-bill disabled>Rechnung</button>`,
      `</footer>`,
      `</div>`,
    ].join('');
  }

  function hydrateBlock(el, hooks = {}) {
    if (!el || el.dataset.speisekarteHydrated === '1') return;
    const spec = decodeSpec(el.dataset.speisekarteSpec);
    if (!spec) return;
    el.dataset.speisekarteHydrated = '1';
    const items = flattenItems(spec);
    const tableInput = el.querySelector('.speisekarte-table-input');
    const saved = loadBill(el, spec);
    if (tableInput && saved.table) tableInput.value = saved.table;
    renderBill(el, spec);

    const persistTable = () => {
      const bill = loadBill(el, spec);
      bill.table = readTable(el, spec);
      saveBill(el, spec, bill);
    };
    tableInput?.addEventListener('click', (event) => event.stopPropagation());
    tableInput?.addEventListener('keydown', (event) => event.stopPropagation());
    tableInput?.addEventListener('input', persistTable);

    el.addEventListener('click', (event) => {
      const clearBtn = event.target.closest('[data-speisekarte-clear]');
      if (clearBtn && el.contains(clearBtn)) {
        event.preventDefault();
        event.stopPropagation();
        clearBill(el, spec);
        return;
      }
      const billBtn = event.target.closest('[data-speisekarte-bill]');
      if (billBtn && el.contains(billBtn) && !billBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const bill = getBill(el, spec);
        hooks.onBill?.({ spec, bill, el, btn: billBtn, table: bill.table });
        return;
      }
      const btn = event.target.closest('.speisekarte-item');
      if (!btn || !el.contains(btn) || btn.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      const idx = parseInt(btn.dataset.menuIndex, 10);
      const item = items[idx];
      if (!item) return;
      const table = readTable(el, spec);
      const result = hooks.onOrder?.({ spec, item, el, btn, table });
      Promise.resolve(result).then((ok) => {
        if (ok === false) return;
        addBillLine(el, spec, item);
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
    parseFenceAttrs,
    parseMenu,
    parseMoney,
    formatMoney,
    formatOrderText,
    formatBillText,
    getBill,
    addBillLine,
    clearBill,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
