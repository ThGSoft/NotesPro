/**
 * NotesPro ```shop``` / ```eshop``` block — catalog, cart, checkout.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProShop = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const FENCE_RE = /```(?:swshop|software|shop|eshop|webshop|store)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const ARCHIVE_FENCE_RE = /```(?:shoporder|eshop-order|store-order)(?:\{([^}]*)\})?[ \t]*(?:\r?\n([\s\S]*?))?```/gi;
  const MAX_QTY = 99;

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
    if (raw === 'dm' || raw === 'private' || raw === 'message') return 'dm';
    if (raw === 'chat' || raw === 'group' || raw === 'workspace') return 'chat';
    return 'mail';
  }

  function parseToList(cfg) {
    const raw = String(cfg.to || cfg.user || cfg.an || '').trim();
    if (!raw) return [];
    return raw.split(/[,+\s]+/).map((part) => part.trim()).filter(Boolean);
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

  function formatMoney(amount, samplePrice, currency) {
    if (!Number.isFinite(amount)) return '';
    const parsed = parseMoney(samplePrice);
    const n = amount.toFixed(2);
    if (parsed.prefix) return `${parsed.prefix} ${n}`.trim();
    if (parsed.suffix) return `${n} ${parsed.suffix}`.trim();
    const cur = String(currency || '').trim();
    return cur ? `${n} ${cur}` : n;
  }

  function resolveMediaHref(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href) || /^data:/i.test(href)) return href;
    const appBase = (typeof window !== 'undefined' && window.APP_BASE)
      ? String(window.APP_BASE).replace(/\/$/, '')
      : '';
    let path = String(href).replace(/\\/g, '/');
    if (/^media\//i.test(path)) {
      return appBase ? `${appBase}/${path}` : `/${path}`;
    }
    if (path.startsWith('/')) {
      return appBase && !path.startsWith(`${appBase}/`) ? `${appBase}${path}` : path;
    }
    return appBase ? `${appBase}/${path}` : `/${path}`;
  }

  function looksLikeImageSrc(text) {
    const t = String(text || '').trim();
    if (!t || /\s/.test(t)) return false;
    if (/^javascript:/i.test(t) || /^data:/i.test(t)) return false;
    if (/!\[[^\]]*\]\(([^)\s]+)\)/.test(t)) return true;
    if (/^(media\/|\/media\/)/i.test(t)) return true;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(t)) return true;
    if (/^https?:\/\//i.test(t)) return true;
    return false;
  }

  function extractImage(note) {
    const text = String(note || '');
    const md = text.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
    if (md) {
      return { src: md[1], note: text.replace(md[0], '').replace(/\s+/g, ' ').trim() };
    }
    const url = text.match(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?/i);
    if (url) {
      return { src: url[0], note: text.replace(url[0], '').replace(/\s+/g, ' ').trim() };
    }
    const lone = text.trim();
    if (looksLikeImageSrc(lone)) {
      return { src: lone, note: '' };
    }
    return { src: '', note: text.trim() };
  }

  function looksLikeDownloadSrc(text) {
    const t = String(text || '').trim().replace(/^download\s*[:=]\s*/i, '');
    if (!t || /^javascript:/i.test(t) || /^data:/i.test(t)) return false;
    if (/\.(zip|exe|msi|dmg|7z|gz|tgz|pdf|apk|deb|rpm|iso)(\?|#|$)/i.test(t)) return true;
    if (/github\.com\/[^/\s]+\/[^/\s]+\/(?:releases|archive)/i.test(t)) return true;
    return false;
  }

  function extractDownload(part) {
    const text = String(part || '').trim();
    if (!text) return { href: '', note: '' };
    const md = text.match(/\[(?:download|dl)\]\(([^)\s]+)\)/i);
    if (md) {
      return { href: md[1], note: text.replace(md[0], '').replace(/\s+/g, ' ').trim() };
    }
    const prefixed = text.match(/^download\s*[:=]\s*(\S+)(.*)$/i);
    if (prefixed) {
      return { href: prefixed[1], note: String(prefixed[2] || '').trim() };
    }
    if (looksLikeDownloadSrc(text) && !/\s/.test(text)) {
      return { href: text.replace(/^download\s*[:=]\s*/i, ''), note: '' };
    }
    return { href: '', note: text };
  }

  function parseProductParts(parts) {
    const name = parts[0];
    const price = parts[1] || '';
    let image = '';
    let download = '';
    let info = '';
    const notes = [];
    parts.slice(2).forEach((part) => {
      const dl = extractDownload(part);
      if (dl.href && !download) {
        download = dl.href;
        if (dl.note) notes.push(dl.note);
        return;
      }
      const extracted = extractImage(part);
      if (extracted.src && !image) {
        image = extracted.src;
        if (extracted.note) notes.push(extracted.note);
        return;
      }
      if (!part) return;
      if (!info && notes.length) info = part;
      else notes.push(part);
    });
    return {
      name,
      price,
      note: notes.join(' — ').trim(),
      image,
      download,
      info,
    };
  }

  function looksLikeCardNumber(value) {
    const raw = String(value || '').trim();
    if (/[A-Za-z]/.test(raw)) return false;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19;
  }

  function sanitizeKonto(value) {
    const konto = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    return looksLikeCardNumber(konto) ? '' : konto;
  }

  function normalizeMerchant(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const images = Array.isArray(src.images)
      ? src.images
      : (src.image ? [src.image] : []);
    return {
      description: String(src.description || src.desc || '').trim(),
      info: String(src.info || src.additional_info || src.about || '').trim(),
      images: images.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8),
      paypalEnabled: src.paypal_enabled === true || src.paypalEnabled === true
        || String(src.paypal_enabled || '').toLowerCase() === 'true',
      paypal: String(src.paypal || src.paypal_email || src.paypalme || '').trim(),
      visaEnabled: src.visa_enabled === true || src.visaEnabled === true
        || String(src.visa_enabled || '').toLowerCase() === 'true',
      mastercardEnabled: src.mastercard_enabled === true || src.mastercardEnabled === true
        || String(src.mastercard_enabled || '').toLowerCase() === 'true',
      mastercard: String(src.mastercard || src.card || src.card_note || '').trim(),
      konto: sanitizeKonto(src.konto || src.iban || src.account),
    };
  }

  function readMerchant(options) {
    if (options && options.merchant) return normalizeMerchant(options.merchant);
    if (typeof window !== 'undefined') {
      return normalizeMerchant(window.APP_BOOT?.extraConfigs?.shop);
    }
    return normalizeMerchant({});
  }

  function paypalCheckoutUrl(paypal, extras = {}) {
    const raw = String(paypal || '').trim();
    if (!raw) return '';
    const me = raw.match(/paypal\.me\/([A-Za-z0-9._-]+)/i);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
    const handle = me
      ? me[1]
      : (!email ? raw.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '') : '');
    const amount = Number.isFinite(extras.amount) ? extras.amount : null;
    const currency = String(extras.currency || 'EUR').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'EUR';
    const title = String(extras.title || 'Shop order').slice(0, 120);
    if (handle) {
      return amount != null
        ? `https://www.paypal.me/${encodeURIComponent(handle)}/${amount.toFixed(2)}${currency}`
        : `https://www.paypal.me/${encodeURIComponent(handle)}`;
    }
    if (!email) return '';
    const params = new URLSearchParams({
      cmd: '_xclick',
      business: email,
      item_name: title,
      currency_code: currency,
    });
    if (amount != null) params.set('amount', amount.toFixed(2));
    return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
  }

  function paymentLabel(pay) {
    const key = String(pay || '').toLowerCase();
    if (key === 'paypal') return 'PayPal';
    if (key === 'visa') return 'Visa';
    if (key === 'mastercard' || key === 'master' || key === 'card') return 'Mastercard';
    return 'Order';
  }

  function isCardPayment(pay) {
    const key = String(pay || '').toLowerCase();
    return key === 'visa' || key === 'mastercard' || key === 'master' || key === 'card';
  }

  function parseCatalog(source, cfg) {
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
      current.items.push(parseProductParts(parts));
    });
    if (current.items.length || current.title) sections.push(current);
    const kindRaw = String(cfg.kind || cfg.type || '').trim().toLowerCase();
    const kind = (kindRaw === 'sw' || kindRaw === 'software' || kindRaw === 'download')
      ? 'sw'
      : 'shop';
    return {
      title: String(cfg.title || (kind === 'sw' ? 'SW Shop' : 'Shop')).trim() || (kind === 'sw' ? 'SW Shop' : 'Shop'),
      kind,
      to: parseToList(cfg),
      via: resolveVia(cfg),
      msg: String(cfg.msg || cfg.message || cfg.text || '').trim(),
      info: String(cfg.info || cfg.about || cfg.extra || '').trim(),
      currency: String(cfg.currency || cfg.curr || '').trim(),
      sendTo: String(cfg.sendto || cfg.sentto || cfg.ship || cfg.shipping || '').trim(),
      billTo: String(cfg.billto || cfg.bill || cfg.billing || '').trim(),
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

  function cartStorageKey(el, spec) {
    const idx = el?.dataset?.shopIndex || '0';
    const title = spec?.title || '';
    return `notespro-shop:${location.pathname}:${idx}:${title}`;
  }

  function loadState(el, spec) {
    const empty = { lines: [], note: '' };
    try {
      const raw = sessionStorage.getItem(cartStorageKey(el, spec));
      const data = raw ? JSON.parse(raw) : null;
      if (!data) return empty;
      return {
        lines: Array.isArray(data.lines) ? data.lines : [],
        note: String(data.note || ''),
      };
    } catch (_) {
      return empty;
    }
  }

  function saveState(el, spec, state) {
    try {
      sessionStorage.setItem(cartStorageKey(el, spec), JSON.stringify({
        lines: state.lines || [],
        note: state.note || '',
      }));
    } catch (_) { /* ignore */ }
  }

  function lineKey(item) {
    return `${item.name || ''}\n${item.price || ''}\n${item.note || ''}`;
  }

  function displayPrice(price, currency) {
    const text = String(price || '').trim();
    if (!text) return '';
    if (!currency) return text;
    const parsed = parseMoney(text);
    if (parsed.prefix || parsed.suffix) return text;
    return `${text} ${currency}`.trim();
  }

  function summarizeCart(cart, currency) {
    let total = 0;
    let priced = 0;
    let sample = '';
    const lines = (cart.lines || []).map((line) => {
      const qty = Math.max(1, Math.min(MAX_QTY, Number(line.qty) || 1));
      const money = parseMoney(line.price);
      let lineTotal = null;
      let lineTotalLabel = displayPrice(line.price, currency);
      if (money.amount != null) {
        lineTotal = money.amount * qty;
        total += lineTotal;
        priced += 1;
        if (!sample) sample = line.price;
        lineTotalLabel = formatMoney(lineTotal, line.price, currency);
      } else if (qty > 1 && line.price) {
        lineTotalLabel = `${qty} × ${displayPrice(line.price, currency)}`;
      }
      return { ...line, qty, lineTotal, lineTotalLabel };
    });
    return {
      lines,
      note: cart.note || '',
      total: priced ? total : null,
      totalLabel: priced ? formatMoney(total, sample, currency) : '',
    };
  }

  function addCartLine(el, spec, item, qty = 1) {
    const state = loadState(el, spec);
    const key = lineKey(item);
    const existing = state.lines.find((line) => lineKey(line) === key);
    const add = Math.max(1, Math.min(MAX_QTY, Number(qty) || 1));
    if (existing) {
      existing.qty = Math.max(1, Math.min(MAX_QTY, (Number(existing.qty) || 1) + add));
    } else {
      state.lines.push({
        name: item.name || '',
        price: item.price || '',
        note: item.note || '',
        download: item.download || '',
        info: item.info || '',
        qty: add,
      });
    }
    saveState(el, spec, state);
    renderCart(el, spec);
    return getCart(el, spec);
  }

  function setCartQty(el, spec, key, qty) {
    const state = loadState(el, spec);
    const next = Math.max(0, Math.min(MAX_QTY, Number(qty) || 0));
    state.lines = state.lines
      .map((line) => (lineKey(line) === key ? { ...line, qty: next } : line))
      .filter((line) => (Number(line.qty) || 0) > 0);
    saveState(el, spec, state);
    renderCart(el, spec);
  }

  function setCartNote(el, spec, note) {
    const state = loadState(el, spec);
    state.note = String(note || '');
    saveState(el, spec, state);
  }

  function clearCart(el, spec) {
    const state = loadState(el, spec);
    state.lines = [];
    saveState(el, spec, state);
    renderCart(el, spec);
  }

  function getCart(el, spec) {
    return summarizeCart(loadState(el, spec), spec?.currency);
  }

  function formatCheckoutText(spec, cart, extras = {}) {
    const pageTitle = extras.pageTitle || 'page';
    const shopTitle = spec?.title || 'Shop';
    const lines = (cart.lines || []).map((line) => {
      const qty = line.qty > 1 ? ` ×${line.qty}` : '';
      const extra = line.note ? ` (${line.note})` : '';
      const price = line.lineTotalLabel || displayPrice(line.price, spec?.currency) || '';
      return `• ${line.name}${qty}${extra}${price ? ` — ${price}` : ''}`;
    });
    const sum = cart.totalLabel ? `\nTotal: ${cart.totalLabel}` : '';
    const when = extras.at ? formatDateTime(extras.at) : '';
    const whenLine = when ? `\nDate: ${when}` : '';
    const noteLine = cart.note ? `\nNote: ${cart.note}` : '';
    const sendTo = String(spec?.sendTo || '').trim();
    const billTo = String(spec?.billTo || '').trim() || sendTo;
    const sendLine = sendTo ? `\nSent to: ${sendTo}` : '';
    const billLine = billTo ? `\nBill to: ${billTo}` : '';
    const pay = extras.payment || extras.pay || '';
    const payName = extras.paymentLabel || paymentLabel(pay);
    const payNote = String(extras.paymentNote || '').trim();
    const payLine = pay ? `\nPayment: ${payName}` : '';
    const payNoteLine = payNote ? `\nCard instructions: ${payNote}` : '';
    const buyerKonto = String(extras.buyerKonto || extras.fromKonto || extras.from || '').trim();
    const merchantKonto = String(extras.merchantKonto || extras.toKonto || extras.to || '').trim();
    const fromLine = buyerKonto ? `\nTransfer from: ${buyerKonto}` : '';
    const toLine = merchantKonto ? `\nTransfer to: ${merchantKonto}` : '';
    const downloads = (cart.lines || [])
      .map((line) => line.download)
      .filter(Boolean);
    const downloadLine = downloads.length
      ? `\nDownload:\n${downloads.map((href) => `• ${href}`).join('\n')}`
      : '';
    const custom = String(spec?.msg || '').trim();
    if (custom && /\{(cart|order|lines|sum)\}/i.test(custom)) {
      return custom
        .replace(/\{shop\}/gi, shopTitle)
        .replace(/\{menu\}/gi, shopTitle)
        .replace(/\{page\}/gi, pageTitle)
        .replace(/\{sum\}/gi, cart.totalLabel || '')
        .replace(/\{date\}/gi, when)
        .replace(/\{note\}/gi, cart.note || '')
        .replace(/\{sendto\}/gi, sendTo)
        .replace(/\{billto\}/gi, billTo)
        .replace(/\{pay\}/gi, payName)
        .replace(/\{payment\}/gi, payName)
        .replace(/\{from\}/gi, buyerKonto)
        .replace(/\{to\}/gi, merchantKonto)
        .replace(/\{konto\}/gi, merchantKonto)
        .replace(/\{buyerkonto\}/gi, buyerKonto)
        .replace(/\{cart\}/gi, lines.join('\n'))
        .replace(/\{order\}/gi, lines.join('\n'))
        .replace(/\{lines\}/gi, lines.join('\n'))
        .replace(/\{download\}/gi, downloads.join('\n'));
    }
    return `Shop payment — ${shopTitle} (${pageTitle})${whenLine}${sendLine}${billLine}${payLine}${fromLine}${toLine}${payNoteLine}${noteLine}${downloadLine}\n${lines.join('\n')}${sum}`;
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
      const cart = summarizeCart({ lines, note: cfg.note || '' }, cfg.currency || '');
      const sendTo = String(cfg.sendto || cfg.sentto || cfg.ship || '').trim();
      const billTo = String(cfg.billto || cfg.bill || '').trim();
      const pay = String(cfg.pay || cfg.payment || '').trim();
      entries.push({
        shop: cfg.shop || cfg.title || '',
        index: cfg.index != null && cfg.index !== '' ? String(cfg.index) : '',
        note: cfg.note || '',
        pay,
        payLabel: paymentLabel(pay),
        fromKonto: String(cfg.from || cfg.buyerkonto || cfg.buyer || '').trim(),
        toKonto: String(cfg.to || cfg.konto || cfg.merchantkonto || '').trim(),
        sendTo,
        billTo,
        at: at && !Number.isNaN(at.getTime()) ? at : null,
        atLabel: at && !Number.isNaN(at.getTime()) ? formatDateTime(at) : String(atRaw || ''),
        lines: cart.lines,
        totalLabel: cfg.total || cart.totalLabel,
      });
    }
    entries.sort((a, b) => {
      const ta = a.at ? a.at.getTime() : 0;
      const tb = b.at ? b.at.getTime() : 0;
      return tb - ta;
    });
    return entries;
  }

  function formatArchiveFence(spec, cart, extras = {}) {
    const at = extras.at instanceof Date ? extras.at : new Date();
    const shop = sanitizeFenceValue(spec?.title || 'Shop');
    const total = sanitizeFenceValue(cart.totalLabel || '');
    const index = extras.index != null ? String(extras.index) : '';
    const note = sanitizeFenceValue(cart.note || '');
    const attrs = [`at=${toIsoLocal(at)}`, `shop=${shop}`];
    const sendTo = sanitizeFenceValue(spec?.sendTo || '');
    const billTo = sanitizeFenceValue(spec?.billTo || '');
    if (index !== '') attrs.push(`index=${sanitizeFenceValue(index)}`);
    if (total) attrs.push(`total=${total}`);
    if (note) attrs.push(`note=${note}`);
    if (sendTo) attrs.push(`sendto=${sendTo}`);
    if (billTo) attrs.push(`billto=${billTo}`);
    const pay = sanitizeFenceValue(extras.payment || extras.pay || '');
    if (pay) attrs.push(`pay=${pay}`);
    const fromKonto = sanitizeFenceValue(extras.buyerKonto || extras.fromKonto || extras.from || '');
    const toKonto = sanitizeFenceValue(extras.merchantKonto || extras.toKonto || extras.to || '');
    if (fromKonto) attrs.push(`from=${fromKonto}`);
    if (toKonto) attrs.push(`to=${toKonto}`);
    const lines = (cart.lines || []).map((line) => {
      const qty = Number(line.qty) > 1 ? `qty=${line.qty}` : '';
      const extra = [qty, line.note || ''].filter(Boolean).join('; ');
      return extra ? `${line.name} | ${line.price || ''} | ${extra}` : `${line.name} | ${line.price || ''}`;
    });
    return `\`\`\`shoporder{${attrs.join(';')}}\n${lines.join('\n')}\n\`\`\``;
  }

  function renderArchiveEntry(entry) {
    const when = entry.atLabel || 'Unknown date';
    const note = entry.note
      ? `<p class="shop-archive-note">${escapeHtml(entry.note)}</p>`
      : '';
    const sendTo = entry.sendTo
      ? `<p class="shop-archive-address"><span>Sent to</span> ${escapeHtml(entry.sendTo)}</p>`
      : '';
    const billTo = (entry.billTo || entry.sendTo)
      ? `<p class="shop-archive-address"><span>Bill to</span> ${escapeHtml(entry.billTo || entry.sendTo)}</p>`
      : '';
    const pay = entry.pay
      ? `<p class="shop-archive-address"><span>Payment</span> ${escapeHtml(entry.payLabel || paymentLabel(entry.pay))}</p>`
      : '';
    const fromKonto = entry.fromKonto
      ? `<p class="shop-archive-address"><span>From</span> ${escapeHtml(entry.fromKonto)}</p>`
      : '';
    const toKonto = entry.toKonto
      ? `<p class="shop-archive-address"><span>To</span> ${escapeHtml(entry.toKonto)}</p>`
      : '';
    const total = entry.totalLabel
      ? `<div class="shop-cart-total"><span>Total</span><span class="shop-cart-sum">${escapeHtml(entry.totalLabel)}</span></div>`
      : '';
    const lines = (entry.lines || []).length
      ? `<ul class="shop-cart-lines">${(entry.lines || []).map((line) => {
          const qty = line.qty > 1 ? `<span class="shop-cart-qty">×${escapeHtml(String(line.qty))}</span>` : '';
          const price = line.lineTotalLabel || line.price
            ? `<span class="shop-cart-price">${escapeHtml(line.lineTotalLabel || line.price)}</span>`
            : '';
          return `<li class="shop-cart-line"><span class="shop-cart-name">${escapeHtml(line.name)}${qty}</span>${price}</li>`;
        }).join('')}</ul>`
      : '<p class="shop-cart-empty">No items</p>';
    return [
      `<article class="md-panel md-panel--note shop-archive-entry">`,
      `<div class="md-panel-title">${escapeHtml(when)}</div>`,
      `<div class="md-panel-body">`,
      sendTo,
      billTo,
      pay,
      fromKonto,
      toKonto,
      note,
      lines,
      total,
      `</div>`,
      `</article>`,
    ].join('');
  }

  function renderArchiveSection(markdown, options = {}) {
    const index = options.shopIndex != null ? String(options.shopIndex) : '';
    const shop = options.shopTitle || '';
    let entries = parseArchiveEntries(markdown);
    if (index !== '') {
      const matched = entries.filter((entry) => entry.index === index);
      if (matched.length) entries = matched;
      else if (shop) entries = entries.filter((entry) => !entry.index && (!entry.shop || entry.shop === shop));
    } else if (shop) {
      entries = entries.filter((entry) => !entry.shop || entry.shop === shop);
    }
    if (!entries.length) return '';
    return [
      `<details class="shop-archive">`,
      `<summary>Archived orders (${entries.length})</summary>`,
      `<div class="shop-archive-body">${entries.map(renderArchiveEntry).join('')}</div>`,
      `</details>`,
    ].join('');
  }

  function flattenItems(spec) {
    const items = [];
    (spec.sections || []).forEach((section) => {
      (section.items || []).forEach((item) => items.push(item));
    });
    return items;
  }

  function renderProduct(item, index, currency, options = {}) {
    const note = item.note
      ? `<p class="shop-card-note">${escapeHtml(item.note)}</p>`
      : '';
    const extra = item.info
      ? `<details class="shop-card-info"><summary>Additional info</summary><p>${escapeHtml(item.info)}</p></details>`
      : '';
    const price = item.price
      ? `<span class="shop-card-price">${escapeHtml(displayPrice(item.price, currency))}</span>`
      : '';
    const src = item.image ? resolveMediaHref(item.image) : '';
    const image = src
      ? `<img class="shop-card-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.name)}" loading="lazy">`
      : (options.editable
        ? `<div class="shop-card-image shop-card-image--empty">Paste image</div>`
        : '');
    const downloadHref = item.download ? resolveMediaHref(item.download) : '';
    const download = downloadHref
      ? `<a class="shop-download-btn" href="${escapeHtml(downloadHref)}" target="_blank" rel="noopener noreferrer">Download</a>`
      : '';
    return [
      `<article class="shop-card" data-shop-item="${index}"${options.editable ? ' tabindex="0"' : ''}>`,
      image,
      `<div class="shop-card-body">`,
      `<div class="shop-card-name">${escapeHtml(item.name)}</div>`,
      note,
      extra,
      `</div>`,
      `<div class="shop-card-foot">`,
      price,
      `<span class="shop-card-actions">${download}<button type="button" class="shop-add-btn" data-shop-add="${index}">Add</button></span>`,
      `</div>`,
      `</article>`,
    ].join('');
  }

  function resetPayPrompt(el) {
    const methods = el?.querySelector?.('.shop-pay-prompt-actions');
    const kontoStep = el?.querySelector?.('.shop-pay-konto');
    const buyer = el?.querySelector?.('[data-shop-buyer-konto]');
    const title = el?.querySelector?.('[data-shop-pay-title]');
    if (methods) methods.hidden = false;
    if (kontoStep) kontoStep.hidden = true;
    if (title) title.hidden = false;
    if (buyer && document.activeElement !== buyer) buyer.value = '';
    el?.querySelector?.('[data-shop-pay-method]')?.removeAttribute('value');
  }

  function hidePayPrompt(el) {
    const prompt = el?.querySelector?.('.shop-pay-prompt');
    const checkoutBtn = el?.querySelector?.('[data-shop-checkout]');
    resetPayPrompt(el);
    if (prompt) prompt.hidden = true;
    if (checkoutBtn) checkoutBtn.hidden = false;
  }

  function showPayPrompt(el) {
    const prompt = el?.querySelector?.('.shop-pay-prompt');
    const checkoutBtn = el?.querySelector?.('[data-shop-checkout]');
    if (!prompt) return false;
    resetPayPrompt(el);
    prompt.hidden = false;
    if (checkoutBtn) checkoutBtn.hidden = true;
    prompt.querySelector('[data-shop-pay]')?.focus();
    return true;
  }

  function showKontoPrompt(el, payment) {
    const prompt = el?.querySelector?.('.shop-pay-prompt');
    const methods = el?.querySelector?.('.shop-pay-prompt-actions');
    const kontoStep = el?.querySelector?.('.shop-pay-konto');
    if (!prompt || !kontoStep) return false;
    prompt.hidden = false;
    if (methods) methods.hidden = true;
    kontoStep.hidden = false;
    const method = el.querySelector('[data-shop-pay-method]');
    const title = el.querySelector('[data-shop-pay-title]');
    if (method) method.value = String(payment || '');
    if (title) title.hidden = true;
    el.querySelector('[data-shop-buyer-konto]')?.focus();
    return true;
  }

  function renderCart(el, spec) {
    if (!el) return;
    const cart = getCart(el, spec);
    const list = el.querySelector('.shop-cart-lines');
    const emptyEl = el.querySelector('.shop-cart-empty');
    const sumEl = el.querySelector('.shop-cart-sum');
    const checkoutBtn = el.querySelector('[data-shop-checkout]');
    const countEl = el.querySelector('.shop-cart-count');
    const noteEl = el.querySelector('[data-shop-note]');
    const n = cart.lines.reduce((sum, line) => sum + (Number(line.qty) || 1), 0);
    if (countEl) {
      countEl.hidden = n < 1;
      countEl.textContent = n ? String(n) : '';
    }
    if (noteEl && document.activeElement !== noteEl) noteEl.value = cart.note || '';
    if (!list) return;
    if (!cart.lines.length) {
      list.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (sumEl) sumEl.textContent = '—';
      if (checkoutBtn) checkoutBtn.disabled = true;
      hidePayPrompt(el);
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    if (checkoutBtn) checkoutBtn.disabled = false;
    list.innerHTML = cart.lines.map((line, lineIndex) => {
      const note = line.note
        ? `<span class="shop-cart-note">${escapeHtml(line.note)}</span>`
        : '';
      const price = line.lineTotalLabel
        ? `<span class="shop-cart-price">${escapeHtml(line.lineTotalLabel)}</span>`
        : '';
      return [
        `<li class="shop-cart-line" data-shop-line-index="${lineIndex}">`,
        `<span class="shop-cart-name">${escapeHtml(line.name)}</span>`,
        note,
        `<span class="shop-qty">`,
        `<button type="button" class="shop-qty-btn" data-shop-qty="-1" aria-label="Decrease quantity">−</button>`,
        `<span class="shop-qty-value">${escapeHtml(String(line.qty))}</span>`,
        `<button type="button" class="shop-qty-btn" data-shop-qty="1" aria-label="Increase quantity">+</button>`,
        `</span>`,
        price,
        `<button type="button" class="shop-remove-btn" data-shop-remove aria-label="Remove">×</button>`,
        `</li>`,
      ].join('');
    }).join('');
    if (sumEl) sumEl.textContent = cart.totalLabel || '—';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    if (options.kind === 'sw' && cfg.kind == null) cfg.kind = 'sw';
    const spec = parseCatalog(source, cfg);
    const style = spec.style;
    const themeClass = style.theme ? ` shop-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' shop-block--custom' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--shop-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--shop-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const index = Number.isFinite(options.shopIndex) ? options.shopIndex : 0;
    const merchant = readMerchant(options);
    const viaLabel = spec.via === 'dm' ? 'private message' : (spec.via === 'chat' ? 'group chat' : 'mail');
    const toLabel = spec.to.length ? spec.to.join(', ') : 'workspace owner';
    let itemIndex = 0;
    const catalogHtml = spec.sections.length
      ? spec.sections.map((section) => {
          const heading = section.title
            ? `<h3 class="shop-section-title">${escapeHtml(section.title)}</h3>`
            : '';
          const items = (section.items || []).map((item) => renderProduct(item, itemIndex++, spec.currency, options)).join('');
          return `<section class="shop-section">${heading}<div class="shop-products">${items}</div></section>`;
        }).join('')
      : `<p class="shop-empty">Add products as <code>Name | price | description | image | download | additional info</code></p>`;
    const merchantImages = merchant.images.length
      ? `<div class="shop-merchant-images">${merchant.images.map((src) => `<img src="${escapeHtml(resolveMediaHref(src))}" alt="" loading="lazy">`).join('')}</div>`
      : '';
    const merchantDesc = merchant.description
      ? `<p class="shop-merchant-desc">${escapeHtml(merchant.description)}</p>`
      : '';
    const extraInfoText = spec.info || merchant.info;
    const extraInfo = extraInfoText
      ? `<details class="shop-extra-info"><summary>Additional info</summary><p>${escapeHtml(extraInfoText)}</p></details>`
      : '';
    const payBadges = [
      merchant.paypalEnabled ? '<span class="shop-pay-badge shop-pay-badge--paypal">PayPal</span>' : '',
      merchant.visaEnabled ? '<span class="shop-pay-badge shop-pay-badge--visa">Visa</span>' : '',
      merchant.mastercardEnabled ? '<span class="shop-pay-badge shop-pay-badge--mastercard">Mastercard</span>' : '',
    ].filter(Boolean).join('');
    const payBadgeHtml = payBadges
      ? `<div class="shop-pay-badges" aria-label="Accepted payments">${payBadges}</div>`
      : '';
    const payMethods = [
      merchant.paypalEnabled ? ['paypal', 'PayPal'] : null,
      merchant.visaEnabled ? ['visa', 'Visa'] : null,
      merchant.mastercardEnabled ? ['mastercard', 'Mastercard'] : null,
    ].filter(Boolean);
    const payButtons = payMethods
      .map(([value, label]) => `<button type="button" class="shop-pay-prompt-btn shop-pay-prompt-btn--${value}" data-shop-pay="${value}">${label}</button>`)
      .join('');
    const merchantKonto = sanitizeKonto(merchant.konto);
    const kontoStepHtml = merchantKonto
      ? [
          `<p class="shop-pay-konto-to">Transfer to <strong data-shop-merchant-konto>${escapeHtml(merchantKonto)}</strong></p>`,
          `<label class="shop-note-field shop-pay-konto-field">Your Konto`,
          `<input type="text" class="shop-note-input" data-shop-buyer-konto maxlength="42" placeholder="IBAN or account" autocomplete="off">`,
          `</label>`,
          `<button type="button" class="shop-pay-prompt-btn shop-pay-prompt-btn--transfer" data-shop-transfer>Transfer</button>`,
        ].join('')
      : `<p class="shop-pay-prompt-empty">Add a Konto in Settings to receive Visa and Mastercard transfers.</p>`;
    const payPromptHtml = [
      `<div class="shop-pay-prompt" hidden>`,
      `<input type="hidden" data-shop-pay-method value="">`,
      `<p class="shop-pay-prompt-title" data-shop-pay-title>How would you like to pay?</p>`,
      payButtons
        ? `<div class="shop-pay-prompt-actions">${payButtons}</div>`
        : `<p class="shop-pay-prompt-empty">Enable PayPal, Visa, or Mastercard in Settings.</p>`,
      `<div class="shop-pay-konto" hidden>`,
      `<p class="shop-pay-prompt-title">Transfer from your Konto</p>`,
      kontoStepHtml,
      `</div>`,
      `<button type="button" class="shop-pay-prompt-cancel" data-shop-pay-cancel>Back</button>`,
      `</div>`,
    ].join('');
    const sameBill = spec.sendTo && spec.billTo && spec.sendTo === spec.billTo;
    const settingsHtml = options.editable
      ? [
          `<button type="button" class="shop-settings-btn" data-shop-settings aria-expanded="false" title="Shop settings">⚙</button>`,
          `<div class="shop-settings" hidden>`,
          `<label class="shop-settings-field">Currency`,
          `<input type="text" class="shop-currency-input" data-shop-currency maxlength="8" value="${escapeHtml(spec.currency)}" placeholder="EUR">`,
          `</label>`,
          `<label class="shop-settings-field shop-settings-field--block">Sent to address`,
          `<textarea class="shop-address-input" data-shop-sendto rows="2" maxlength="240" placeholder="Name, street, city">${escapeHtml(spec.sendTo)}</textarea>`,
          `</label>`,
          `<label class="shop-settings-field shop-settings-field--block">Bill to address`,
          `<textarea class="shop-address-input" data-shop-billto rows="2" maxlength="240" placeholder="Name, street, city"${sameBill ? ' disabled' : ''}>${escapeHtml(spec.billTo || (sameBill ? spec.sendTo : ''))}</textarea>`,
          `</label>`,
          `<label class="shop-settings-check"><input type="checkbox" data-shop-bill-same${sameBill ? ' checked' : ''}> Same as sent to</label>`,
          `<p class="shop-settings-hint">Shop images, description, Konto, PayPal, Visa, Mastercard and additional info are in user Settings.</p>`,
          `</div>`,
        ].join('')
      : '';
    const archiveHtml = renderArchiveSection(options.archiveMarkdown || '', {
      shopIndex: index,
      shopTitle: spec.title,
    });
    return [
      `<div class="shop-block${themeClass}${customClass}"${styleAttr}`,
      ` data-shop-index="${index}"`,
      ` data-shop-konto="${escapeHtml(merchantKonto)}"`,
      ` data-shop-spec="${escapeHtml(encodeSpec(spec))}">`,
      `<div class="shop-header">`,
      `<div class="shop-heading">`,
      `<div class="shop-title">${escapeHtml(spec.title)}</div>`,
      `<div class="shop-meta">${spec.kind === 'sw' ? 'Download or add to cart · ' : 'Add to cart · '}checkout, then pay with PayPal, Visa, or Mastercard · Visa/Mastercard transfer to the Settings Konto · sent by ${escapeHtml(viaLabel)} to ${escapeHtml(toLabel)}</div>`,
      payBadgeHtml,
      `</div>`,
      settingsHtml,
      `</div>`,
      merchantImages,
      merchantDesc,
      extraInfo,
      `<div class="shop-layout">`,
      `<div class="shop-catalog">${catalogHtml}</div>`,
      `<aside class="md-panel md-panel--${THEMES.includes(style.theme) ? style.theme : 'info'} shop-cart">`,
      `<div class="md-panel-title shop-cart-title">`,
      `<span>Cart</span>`,
      `<span class="shop-cart-count" hidden></span>`,
      `<button type="button" class="shop-cart-clear" data-shop-clear>Clear</button>`,
      `</div>`,
      `<div class="md-panel-body">`,
      `<p class="shop-cart-empty">Your cart is empty.</p>`,
      `<ul class="shop-cart-lines"></ul>`,
      spec.sendTo || spec.billTo
        ? `<div class="shop-cart-addresses">${spec.sendTo ? `<p><span>Sent to</span> ${escapeHtml(spec.sendTo)}</p>` : ''}${spec.billTo || spec.sendTo ? `<p><span>Bill to</span> ${escapeHtml(spec.billTo || spec.sendTo)}</p>` : ''}</div>`
        : '',
      `<label class="shop-note-field">Note`,
      `<input type="text" class="shop-note-input" data-shop-note maxlength="120" placeholder="Delivery or desk">`,
      `</label>`,
      `<div class="shop-cart-total"><span>Total</span><span class="shop-cart-sum">—</span></div>`,
      `<button type="button" class="shop-checkout-btn" data-shop-checkout disabled>Checkout</button>`,
      payPromptHtml,
      `</div>`,
      `</aside>`,
      `</div>`,
      archiveHtml,
      `</div>`,
    ].join('');
  }

  function hydrateBlock(el, hooks = {}) {
    if (!el || el.dataset.shopHydrated === '1') return;
    const spec = decodeSpec(el.dataset.shopSpec);
    if (!spec) return;
    el.dataset.shopHydrated = '1';
    const items = flattenItems(spec);
    renderCart(el, spec);

    const settingsBtn = el.querySelector('[data-shop-settings]');
    const settingsPanel = el.querySelector('.shop-settings');
    const currencyInput = el.querySelector('[data-shop-currency]');
    const sendToInput = el.querySelector('[data-shop-sendto]');
    const billToInput = el.querySelector('[data-shop-billto]');
    const sameBillInput = el.querySelector('[data-shop-bill-same]');
    const emitSettings = () => {
      const sendTo = (sendToInput?.value || '').trim();
      const same = !!sameBillInput?.checked;
      if (same && billToInput) {
        billToInput.value = sendTo;
        billToInput.disabled = true;
      } else if (billToInput) {
        billToInput.disabled = false;
      }
      hooks.onSettings?.({
        spec,
        el,
        currency: (currencyInput?.value || '').trim(),
        sendTo,
        billTo: same ? sendTo : (billToInput?.value || '').trim(),
      });
    };
    settingsBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = settingsPanel?.hidden !== false;
      if (settingsPanel) settingsPanel.hidden = !open;
      settingsBtn.classList.toggle('is-open', open);
      settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    [currencyInput, sendToInput, billToInput].forEach((input) => {
      input?.addEventListener('click', (event) => event.stopPropagation());
      input?.addEventListener('keydown', (event) => event.stopPropagation());
      input?.addEventListener('change', emitSettings);
    });
    sameBillInput?.addEventListener('click', (event) => event.stopPropagation());
    sameBillInput?.addEventListener('change', () => {
      if (sameBillInput.checked && billToInput) billToInput.value = (sendToInput?.value || '').trim();
      emitSettings();
    });
    el.querySelector('.shop-settings')?.addEventListener('click', (event) => event.stopPropagation());
    el.querySelector('.shop-archive')?.addEventListener('click', (event) => event.stopPropagation());

    const noteInput = el.querySelector('[data-shop-note]');
    noteInput?.addEventListener('click', (event) => event.stopPropagation());
    noteInput?.addEventListener('keydown', (event) => event.stopPropagation());
    noteInput?.addEventListener('input', () => setCartNote(el, spec, noteInput.value));

    el.querySelector('.shop-pay-prompt')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-shop-pay], [data-shop-pay-cancel], [data-shop-transfer], [data-shop-buyer-konto]')) return;
      event.stopPropagation();
    });

    const buyerKontoInput = el.querySelector('[data-shop-buyer-konto]');
    buyerKontoInput?.addEventListener('click', (event) => event.stopPropagation());
    buyerKontoInput?.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        el.querySelector('[data-shop-transfer]')?.click();
      }
    });

    async function handlePasteFiles(files, itemIndex) {
      const imageFiles = [...files].filter((file) => file && String(file.type || '').startsWith('image/'));
      if (!imageFiles.length || typeof hooks.onPasteImage !== 'function') return false;
      for (const file of imageFiles) {
        await hooks.onPasteImage(file, itemIndex, spec, el);
      }
      return true;
    }

    function itemIndexFromEvent(event) {
      const card = event.target.closest?.('[data-shop-item]');
      if (!card || !el.contains(card)) return 0;
      const idx = parseInt(card.dataset.shopItem, 10);
      return Number.isFinite(idx) ? idx : 0;
    }

    if (typeof hooks.onPasteImage === 'function') {
      el.addEventListener('paste', (event) => {
        const items = [...(event.clipboardData?.items || [])];
        const files = items
          .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void handlePasteFiles(files, itemIndexFromEvent(event));
      });
      el.addEventListener('dragover', (event) => {
        if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
        event.preventDefault();
        el.classList.add('shop-block--drop');
      });
      el.addEventListener('dragleave', () => el.classList.remove('shop-block--drop'));
      el.addEventListener('drop', (event) => {
        el.classList.remove('shop-block--drop');
        const files = [...(event.dataTransfer?.files || [])].filter((file) => String(file.type || '').startsWith('image/'));
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void handlePasteFiles(files, itemIndexFromEvent(event));
      });
    }

    el.addEventListener('click', (event) => {
      const clearBtn = event.target.closest('[data-shop-clear]');
      if (clearBtn && el.contains(clearBtn)) {
        event.preventDefault();
        event.stopPropagation();
        clearCart(el, spec);
        return;
      }
      const checkoutBtn = event.target.closest('[data-shop-checkout]');
      if (checkoutBtn && el.contains(checkoutBtn) && !checkoutBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        if (!getCart(el, spec).lines.length) return;
        showPayPrompt(el);
        return;
      }
      const cancelPay = event.target.closest('[data-shop-pay-cancel]');
      if (cancelPay && el.contains(cancelPay)) {
        event.preventDefault();
        event.stopPropagation();
        const kontoStep = el.querySelector('.shop-pay-konto');
        if (kontoStep && !kontoStep.hidden) {
          resetPayPrompt(el);
          el.querySelector('[data-shop-pay]')?.focus();
          return;
        }
        hidePayPrompt(el);
        return;
      }
      const payBtn = event.target.closest('[data-shop-pay]');
      if (payBtn && el.contains(payBtn) && !payBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const cart = getCart(el, spec);
        if (!cart.lines.length) return;
        const payment = String(payBtn.dataset.shopPay || '').toLowerCase();
        if (isCardPayment(payment)) {
          showKontoPrompt(el, payment);
          return;
        }
        hooks.onCheckout?.({ spec, cart, el, btn: payBtn, payment });
        return;
      }
      const transferBtn = event.target.closest('[data-shop-transfer]');
      if (transferBtn && el.contains(transferBtn) && !transferBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        const cart = getCart(el, spec);
        if (!cart.lines.length) return;
        const payment = String(el.querySelector('[data-shop-pay-method]')?.value || '').toLowerCase();
        const buyerKonto = String(el.querySelector('[data-shop-buyer-konto]')?.value || '').replace(/\s+/g, ' ').trim();
        const merchantKonto = sanitizeKonto(el.dataset.shopKonto || el.querySelector('[data-shop-merchant-konto]')?.textContent);
        hooks.onCheckout?.({
          spec,
          cart,
          el,
          btn: transferBtn,
          payment,
          buyerKonto,
          merchantKonto,
        });
        return;
      }
      const qtyBtn = event.target.closest('[data-shop-qty]');
      if (qtyBtn && el.contains(qtyBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const row = qtyBtn.closest('[data-shop-line-index]');
        const line = getCart(el, spec).lines[parseInt(row?.dataset?.shopLineIndex, 10)];
        if (!line) return;
        setCartQty(el, spec, lineKey(line), (Number(line.qty) || 1) + (parseInt(qtyBtn.dataset.shopQty, 10) || 0));
        return;
      }
      const removeBtn = event.target.closest('[data-shop-remove]');
      if (removeBtn && el.contains(removeBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const row = removeBtn.closest('[data-shop-line-index]');
        const line = getCart(el, spec).lines[parseInt(row?.dataset?.shopLineIndex, 10)];
        if (!line) return;
        setCartQty(el, spec, lineKey(line), 0);
        return;
      }
      const addBtn = event.target.closest('[data-shop-add]');
      if (!addBtn || !el.contains(addBtn) || addBtn.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      const idx = parseInt(addBtn.dataset.shopAdd, 10);
      const item = items[idx];
      if (!item) return;
      addCartLine(el, spec, item, 1);
      addBtn.classList.add('is-added');
      setTimeout(() => addBtn.classList.remove('is-added'), 900);
    });
  }

  function hydrate(root, hooks = {}) {
    (root || document).querySelectorAll('.shop-block[data-shop-spec]').forEach((el) => {
      hydrateBlock(el, hooks);
    });
  }

  return {
    FENCE_RE,
    ARCHIVE_FENCE_RE,
    parseFenceAttrs,
    parseCatalog,
    parseMoney,
    formatMoney,
    formatCheckoutText,
    formatArchiveFence,
    parseArchiveEntries,
    getCart,
    addCartLine,
    clearCart,
    renderBlock,
    hydrateBlock,
    hydrate,
    normalizeMerchant,
    paypalCheckoutUrl,
    paymentLabel,
    isCardPayment,
    looksLikeCardNumber,
    sanitizeKonto,
    readMerchant,
  };
}));
