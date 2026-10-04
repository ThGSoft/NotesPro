/**
 * Paste an Outlook / Word message the way Word does:
 * bold header lines, formatted body, lists, tables, links, and inline images.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProOutlookPaste = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL', 'PRE',
    'BLOCKQUOTE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'CENTER', 'TR', 'LI',
  ]);
  const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'XML', 'NOSCRIPT']);
  const HEADER_LINE = /^(from|von|de|van|da|od|från|fra|lähettäjä|feladó|sent|gesendet|envoyé|envoye|enviado|inviato|verzonden|skickat|sendt|lähetetty|elküldve|date|datum|to|an|à|para|aan|till|til|vastaanottaja|címzett|cc|bcc|kopie|blindkopie|reply-to|antwort-an|subject|betreff|objet|asunto|oggetto|onderwerp|ämne|emne|aihe|tárgy|tema)\s*:\s*\S/i;
  const SUBJECT_LABEL = /^(subject|betreff|objet|asunto|oggetto|onderwerp|ämne|emne|aihe|tárgy|tema)$/i;
  const SENT_LABEL = /^(sent|gesendet|envoyé|envoye|enviado|inviato|verzonden|skickat|sendt|lähetetty|elküldve|date|datum)$/i;
  const MAIL_LABEL = /^(from|von|de|van|da|od|sent|gesendet|envoyé|envoye|enviado|inviato|verzonden|skickat|sendt|to|an|à|para|cc|bcc|subject|betreff|objet|asunto|oggetto|date|datum)$/i;
  const NO_FLAGS = { bold: false, italic: false, strike: false, underline: false, code: false, style: '' };

  let convertCtx = null;

  function tagName(el) {
    return String(el?.tagName || '').toUpperCase();
  }

  function collapseWs(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  }

  function escapeMd(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\')
      .replace(/([`*_\[\]|])/g, '\\$1');
  }

  function markerKind(text) {
    const compact = String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, '');
    if (!compact) return 'ul';
    if (/^[•·●○▪▸►‣∙◦\-–—*oO]$/.test(compact)) return 'ul';
    if (/^\d+[.)]?$/.test(compact)) return 'ol';
    if (/^[a-z][.)]$/i.test(compact)) return 'ol';
    if (/^[ivxlcdm]+[.)]$/i.test(compact)) return 'ol';
    if (/[•·●○▪]/.test(compact) && compact.length < 8) return 'ul';
    if (/^\d+/.test(compact) && compact.length < 6) return 'ol';
    return 'ul';
  }

  function preprocess(html) {
    let src = String(html || '');
    const marker = src.search(/<html[\s>]/i);
    if (marker > 0 && /StartHTML\s*:/i.test(src.slice(0, marker))) src = src.slice(marker);
    src = src.replace(/<\?xml[\s\S]*?\?>/gi, '');
    src = src.replace(/<style[\s\S]*?<\/style>/gi, '');
    src = src.replace(/<script[\s\S]*?<\/script>/gi, '');
    src = src.replace(/<!--\[if gte vml[\s\S]*?<!\[endif\]-->/gi, '');
    src = src.replace(/<!--\[if !vml\]>([\s\S]*?)<!\[endif\]-->/gi, '$1');
    src = src.replace(/<!\[if !vml\]>([\s\S]*?)<!\[endif\]>/gi, '$1');
    src = src.replace(/<!\[if !supportLists\]>([\s\S]*?)<!\[endif\]>/gi, (block) => {
      const kind = markerKind(block.replace(/<[^>]+>/g, ' '));
      return `<span data-list-kind="${kind}"></span>`;
    });
    src = src.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    src = src.replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, '');
    src = src.replace(/<!--[\s\S]*?-->/g, '');
    return src;
  }

  function isWordOrOutlookHtml(html) {
    const raw = String(html || '');
    if (!/<[a-z!/]/i.test(raw)) return false;
    return /schemas-microsoft-com:(?:office|vml)|mso-|MsoNormal|MsoList|WordSection\d|elementToProof|Word\.Document|content\s*=\s*["']Microsoft (?:Word|Outlook)|class\s*=\s*["']?Mso/i.test(raw);
  }

  function formatPlainHeaders(plain) {
    const lines = String(plain || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let i = 0;
    if (lines[0] && lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1);
    if (lines[i] && !lines[i].trim()) i += 1;
    const header = [];
    while (i < lines.length && header.length < 8) {
      const line = lines[i].trim();
      if (!line || !HEADER_LINE.test(line)) break;
      const match = line.match(/^([^:]{1,40}?)\s*:\s*(.*)$/);
      if (!match) break;
      header.push(`**${match[1].trim()}:** ${match[2].trim()}`);
      i += 1;
    }
    if (header.length < 2) return null;
    const blob = header.join('\n');
    const labels = header.map((line) => (line.match(/^\*\*([^*]+):\*\*/) || [])[1] || '');
    const hasSubject = labels.some((label) => SUBJECT_LABEL.test(label));
    const looksMail = /@/.test(blob) || labels.some((label) => SENT_LABEL.test(label));
    if (!hasSubject || !looksMail) return null;
    while (i < lines.length && !lines[i].trim()) i += 1;
    const body = lines.slice(i).join('\n').trim();
    return body ? `${blob}\n\n${body}` : blob;
  }

  function shouldHandle(html, plain) {
    if (isWordOrOutlookHtml(html)) return true;
    if (String(html || '').trim()) return false;
    return Boolean(formatPlainHeaders(plain));
  }

  function hoistListMarkers(root) {
    const doc = root.ownerDocument || root;
    [...root.querySelectorAll('span')].forEach((span) => {
      const style = span.getAttribute('style') || '';
      if (!/mso-list\s*:\s*Ignore/i.test(style)) return;
      const mark = doc.createElement('span');
      mark.setAttribute('data-list-kind', markerKind(span.textContent || ''));
      if (span.parentNode) span.parentNode.replaceChild(mark, span);
    });
  }

  function findMarker(el) {
    const kids = [...(el.children || [])];
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      if (child.getAttribute?.('data-list-kind')) return child;
      const grands = [...(child.children || [])];
      for (let j = 0; j < grands.length; j += 1) {
        const grand = grands[j];
        if (grand.getAttribute?.('data-list-kind')) return grand;
        const greats = [...(grand.children || [])];
        for (let k = 0; k < greats.length; k += 1) {
          if (greats[k].getAttribute?.('data-list-kind')) return greats[k];
        }
      }
    }
    return null;
  }

  function listInfo(el) {
    if (!el || el.nodeType !== 1) return null;
    const style = el.getAttribute('style') || '';
    const cls = el.getAttribute('class') || '';
    if (!/mso-list\s*:/i.test(style) && !/MsoList/i.test(cls)) return null;
    const marker = findMarker(el);
    const kind = marker?.getAttribute('data-list-kind') === 'ol' ? 'ol' : 'ul';
    let level = 1;
    const levelMatch = /mso-list\s*:[^;"']*level\s*(\d+)/i.exec(style);
    if (levelMatch) level = Math.max(1, parseInt(levelMatch[1], 10) || 1);
    else {
      const margin = /margin-left\s*:\s*([\d.]+)\s*pt/i.exec(style);
      if (margin) level = Math.max(1, Math.round(parseFloat(margin[1]) / 36) || 1);
    }
    return { kind, level };
  }

  function headingLevel(el) {
    const tag = tagName(el);
    if (/^H[1-6]$/.test(tag)) return Number(tag[1]);
    const cls = el.getAttribute?.('class') || '';
    const named = /(?:MsoHeading|Heading)\s*([1-6])/i.exec(cls);
    if (named) return Number(named[1]);
    if (/\bMsoTitle\b/i.test(cls)) return 1;
    return 0;
  }

  function hasTopRule(el) {
    const style = el.getAttribute?.('style') || '';
    return /border-top\s*:\s*solid/i.test(style);
  }

  function hasBlockChildren(node) {
    return [...(node.children || [])].some((el) => {
      const tag = tagName(el);
      return BLOCK_TAGS.has(tag) || Boolean(listInfo(el)) || Boolean(headingLevel(el));
    });
  }

  function isDefaultColor(value) {
    const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    return !v || v === 'windowtext' || v === 'auto' || v === 'black' || v === '#000' || v === '#000000'
      || v === 'rgb(0,0,0)' || v === 'rgba(0,0,0,1)' || v === 'inherit' || v === 'currentcolor';
  }

  function isDefaultBg(value) {
    const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    return !v || v === 'transparent' || v === 'auto' || v === 'white' || v === '#fff' || v === '#ffffff'
      || v === 'rgb(255,255,255)' || v === 'window' || v === 'inherit';
  }

  function safeColor(value) {
    const v = String(value || '').trim().replace(/\s+/g, '');
    if (!/^(#[0-9a-f]{3,8}|rgb\(\d{1,3},\d{1,3},\d{1,3}\)|rgba\(\d{1,3},\d{1,3},\d{1,3},[\d.]+\)|[a-z]{3,20})$/i.test(v)) return '';
    return v;
  }

  function flagsFrom(el) {
    const tag = tagName(el);
    const style = el.getAttribute('style') || '';
    const flags = { ...NO_FLAGS };
    if (tag === 'B' || tag === 'STRONG' || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) flags.bold = true;
    if (tag === 'I' || tag === 'EM' || /font-style\s*:\s*italic/i.test(style)) flags.italic = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) flags.strike = true;
    if (tag !== 'A' && (tag === 'U' || /text-decoration(?:-line)?\s*:[^;]*underline/i.test(style))) flags.underline = true;
    if (tag === 'CODE') flags.code = true;
    const styleColor = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
    const bg = /(?:^|;)\s*(?:background-color|mso-highlight)\s*:\s*([^;]+)/i.exec(style);
    const color = (styleColor && styleColor[1]) || (tag === 'FONT' ? el.getAttribute('color') || '' : '');
    const parts = [];
    const safe = safeColor(color);
    const safeBg = safeColor(bg && bg[1]);
    if (safe && !isDefaultColor(safe) && tag !== 'A') parts.push(`color:${safe}`);
    if (safeBg && !isDefaultBg(safeBg)) parts.push(`background-color:${safeBg}`);
    if (parts.length && (tag === 'SPAN' || tag === 'FONT' || flags.bold || flags.italic)) flags.style = parts.join(';');
    return flags;
  }

  function mergeFlags(parent, extra) {
    const style = [parent.style, extra.style].filter(Boolean).join(';');
    return {
      bold: Boolean(parent.bold || extra.bold),
      italic: Boolean(parent.italic || extra.italic),
      strike: Boolean(parent.strike || extra.strike),
      underline: Boolean(parent.underline || extra.underline),
      code: Boolean(parent.code || extra.code),
      style,
    };
  }

  function decorate(text, flags) {
    if (!flags || (!flags.bold && !flags.italic && !flags.strike && !flags.underline && !flags.code && !flags.style)) {
      return text;
    }
    const leadLen = (text.match(/^\s*/) || [''])[0].length;
    const trailLen = (text.match(/\s*$/) || [''])[0].length;
    if (leadLen + trailLen >= text.length) return text;
    let core = text.slice(leadLen, text.length - trailLen);
    const lead = text.slice(0, leadLen);
    const trail = text.slice(text.length - trailLen);
    if (flags.code) return `${lead}\`${core.replace(/`/g, '')}\`${trail}`;
    const useHtml = Boolean(flags.style || flags.underline) || /[<>]/.test(core);
    if (useHtml) {
      if (flags.bold) core = `<b>${core}</b>`;
      if (flags.italic) core = `<i>${core}</i>`;
      if (flags.strike) core = `<s>${core}</s>`;
      if (flags.underline) core = `<u>${core}</u>`;
      if (flags.style) core = `<span style="${flags.style}">${core}</span>`;
      return lead + core + trail;
    }
    if (flags.strike) core = `~~${core}~~`;
    if (flags.bold && flags.italic) core = `***${core}***`;
    else if (flags.bold) core = `**${core}**`;
    else if (flags.italic) core = `*${core}*`;
    return lead + core + trail;
  }

  function isTrackingPixel(el) {
    const src = el.getAttribute('src') || '';
    if (/spacer|blank\.gif|pixel\.gif|trans\.gif|tracking/i.test(src)) return true;
    const w = parseInt(el.getAttribute('width') || '', 10);
    const h = parseInt(el.getAttribute('height') || '', 10);
    return (w > 0 && w <= 2) || (h > 0 && h <= 2);
  }

  function imageWidth(el) {
    const attr = el.getAttribute('width') || '';
    if (/^\d+(\.\d+)?$/.test(attr)) return `${Math.round(parseFloat(attr))}px`;
    const style = el.getAttribute('style') || '';
    const match = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*(px|pt)?/i.exec(style);
    if (!match) return '';
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n) || n <= 2) return '';
    const unit = (match[2] || 'px').toLowerCase();
    return `${Math.round(unit === 'pt' ? n * 1.333 : n)}px`;
  }

  function altFromSrc(src, alt) {
    const given = String(alt || '').trim();
    if (given) return given;
    const clean = String(src || '').replace(/^cid:/i, '').split('@')[0];
    const base = clean.split(/[/\\]/).pop() || 'image';
    return base.replace(/\.[a-z0-9]{2,5}$/i, '') || 'image';
  }

  function imageToken(el) {
    if (!convertCtx || isTrackingPixel(el)) return '';
    const src = el.getAttribute('src') || '';
    if (!src) return '';
    const id = convertCtx.images.length;
    convertCtx.images.push({
      id,
      src,
      alt: altFromSrc(src, el.getAttribute('alt') || ''),
      width: imageWidth(el),
    });
    return `%%NPIMG${id}%%`;
  }

  function renderInline(node, flags) {
    let out = '';
    [...(node.childNodes || [])].forEach((child) => {
      out += renderChild(child, flags);
    });
    return out;
  }

  function renderChild(child, flags) {
    if (!child) return '';
    if (child.nodeType === 3) return decorate(escapeMd(collapseWs(child.textContent)), flags);
    if (child.nodeType !== 1) return '';
    const tag = tagName(child);
    if (SKIP_TAGS.has(tag) || child.getAttribute?.('data-list-kind')) return '';
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') return imageToken(child);
    if (tag === 'A') return renderLink(child, flags);
    if (tag === 'TABLE') return renderTable(child);
    if (BLOCK_TAGS.has(tag) || listInfo(child) || headingLevel(child)) {
      return joinBlocks(collectBlocks(child)).replace(/\n{2,}/g, '\n');
    }
    return renderInline(child, mergeFlags(flags, flagsFrom(child)));
  }

  function inlineText(node) {
    return renderInline(node, NO_FLAGS)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  const PAGE_SLUG = '[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*';
  const LOCAL_PAGE_REF = new RegExp(`^(${PAGE_SLUG}):(${PAGE_SLUG})$`);
  const BLOCKED_LINK_SCHEME = /^(https?|mailto|file|javascript|data|ftp|ftps|news|tel|sms)$/i;

  function localPageRef(href) {
    const value = String(href || '').trim();
    if (!value) return '';
    const direct = value.match(LOCAL_PAGE_REF);
    if (direct && !BLOCKED_LINK_SCHEME.test(direct[1])) return `${direct[1]}:${direct[2]}`;
    let path = value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      try {
        path = new URL(value).pathname;
      } catch (_) {
        return '';
      }
    }
    const match = String(path).match(new RegExp(`/p/[^/]+/(${PAGE_SLUG})/(${PAGE_SLUG})/?$`, 'i'));
    if (!match) return '';
    return `${match[1]}:${match[2]}`;
  }

  function safeHref(href) {
    const value = String(href || '').trim();
    if (!/^(https?:|mailto:|file:)/i.test(value)) return '';
    return value.replace(/\s/g, '%20').replace(/[()]/g, (ch) => encodeURIComponent(ch));
  }

  function renderLink(el, flags) {
    const raw = String(el.getAttribute('href') || '').trim();
    const local = localPageRef(raw);
    const href = local || safeHref(raw);
    const label = renderInline(el, flags).replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
    if (!label && !href) return '';
    if (label.includes('%%NPIMG') || !href) return label;
    const text = (label.replace(/[\[\]]/g, '') || href).trim();
    if (local) return `[${text === raw ? local : text}](${local})`;
    if (text === href) return href;
    return `[${text}](${href})`;
  }

  function stripMarker(text) {
    return String(text || '')
      .replace(/^(?:[•·●○▪▸►‣∙◦\-–—]|&bull;)\s+/, '')
      .replace(/^\d{1,3}[.)]\s+/, '')
      .replace(/^[oO]\s+/, '')
      .trim();
  }

  function directRows(table) {
    const sections = [...table.children].filter((el) => {
      const tag = tagName(el);
      return tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT';
    });
    const parents = sections.length ? sections : [table];
    const rows = [];
    parents.forEach((parent) => {
      [...parent.children].forEach((el) => {
        if (tagName(el) === 'TR') rows.push(el);
      });
    });
    return rows;
  }

  function rowCells(tr) {
    return [...tr.children].filter((el) => tagName(el) === 'TD' || tagName(el) === 'TH');
  }

  function isMailHeaderTable(table) {
    const rows = directRows(table);
    if (rows.length < 2 || rows.length > 10) return false;
    let hits = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const cells = rowCells(rows[i]);
      if (cells.length < 2) return false;
      const label = collapseWs(cells[0].textContent).trim().replace(/:$/, '');
      if (MAIL_LABEL.test(label)) hits += 1;
    }
    return hits >= 2;
  }

  function renderHeaderTable(table) {
    const lines = [];
    directRows(table).forEach((tr) => {
      const cells = rowCells(tr);
      const label = collapseWs(cells[0]?.textContent || '').trim().replace(/:$/, '');
      const value = cells.slice(1).map((cell) => inlineText(cell)).filter(Boolean).join(' ');
      if (!label && !value) return;
      lines.push(label ? `**${label}:** ${value}`.trim() : value);
    });
    return lines.join('\n');
  }

  function renderCell(cell) {
    const text = joinBlocks(collectBlocks(cell)).replace(/\s*\n+\s*/g, '<br>').trim();
    return text || ' ';
  }

  function renderTable(table) {
    if (isMailHeaderTable(table)) return renderHeaderTable(table);
    const rows = directRows(table).map((tr) => rowCells(tr).map((cell) => renderCell(cell)));
    const kept = rows.filter((row) => row.some((cell) => cell.trim()));
    if (!kept.length) return '';
    const width = Math.max(...kept.map((row) => row.length));
    if (width <= 1) {
      return kept.map((row) => row[0]).filter((cell) => cell.trim() && cell.trim() !== ' ').join('\n\n');
    }
    const norm = kept.map((row) => {
      const copy = row.slice();
      while (copy.length < width) copy.push(' ');
      return copy;
    });
    const lines = [
      `| ${norm[0].join(' | ')} |`,
      `| ${norm[0].map(() => '---').join(' | ')} |`,
      ...norm.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ];
    return lines.join('\n');
  }

  function renderHtmlList(listEl, level) {
    const ordered = tagName(listEl) === 'OL';
    const startAttr = parseInt(listEl.getAttribute('start') || '1', 10);
    let index = Number.isFinite(startAttr) && startAttr > 0 ? startAttr - 1 : 0;
    const lines = [];
    [...listEl.children].forEach((li) => {
      if (tagName(li) !== 'LI') return;
      index += 1;
      const indent = '  '.repeat(Math.max(0, level - 1));
      const bullet = ordered ? `${index}. ` : '- ';
      const nested = [...li.children].filter((el) => tagName(el) === 'UL' || tagName(el) === 'OL');
      const clone = li.cloneNode(true);
      [...clone.children].forEach((el) => {
        if (tagName(el) === 'UL' || tagName(el) === 'OL') el.remove();
      });
      lines.push(`${indent}${bullet}${inlineText(clone)}`);
      nested.forEach((sub) => {
        const subLines = renderHtmlList(sub, level + 1);
        if (subLines) lines.push(subLines);
      });
    });
    return lines.join('\n');
  }

  function joinBlocks(chunks) {
    const parts = [];
    let blanks = 0;
    let started = false;
    chunks.forEach((chunk) => {
      if (chunk == null) return;
      if (chunk === '') {
        if (started) blanks += 1;
        return;
      }
      if (started) {
        const gap = Math.min(2, blanks + 1);
        parts.push('\n'.repeat(gap + 1));
      }
      blanks = 0;
      started = true;
      parts.push(chunk);
    });
    return parts.join('').trim();
  }

  function collectBlocks(parent) {
    const chunks = [];
    let listState = null;

    function flushList() {
      if (!listState) return;
      if (listState.lines.length) chunks.push(listState.lines.join('\n'));
      listState = null;
    }

    function pushListItem(info, text) {
      if (!listState || listState.kind !== info.kind) {
        flushList();
        listState = { kind: info.kind, counters: [], lines: [] };
      }
      const level = Math.max(1, info.level || 1);
      listState.counters.length = level;
      if (!listState.counters[level - 1]) listState.counters[level - 1] = 0;
      listState.counters[level - 1] += 1;
      const indent = '  '.repeat(level - 1);
      const bullet = info.kind === 'ol' ? `${listState.counters[level - 1]}. ` : '- ';
      listState.lines.push(`${indent}${bullet}${text}`);
    }

    [...(parent.childNodes || [])].forEach((node) => {
      if (node.nodeType === 3) {
        const text = escapeMd(collapseWs(node.textContent).trim());
        if (!text) return;
        flushList();
        chunks.push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = tagName(node);
      if (SKIP_TAGS.has(tag)) return;
      const info = listInfo(node);
      if (info) {
        const text = stripMarker(inlineText(node));
        if (text) pushListItem(info, text);
        return;
      }
      flushList();
      if (tag === 'BR') {
        chunks.push('');
        return;
      }
      if (tag === 'HR') {
        chunks.push('---');
        return;
      }
      if (tag === 'IMG') {
        const token = imageToken(node);
        if (token) chunks.push(token);
        return;
      }
      if (tag === 'TABLE') {
        const table = renderTable(node);
        if (table) chunks.push(table);
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const list = renderHtmlList(node, 1);
        if (list) chunks.push(list);
        return;
      }
      if (tag === 'PRE') {
        const code = String(node.textContent || '').replace(/\n$/, '');
        chunks.push(`\`\`\`\n${code.replace(/```/g, '`\u200b``')}\n\`\`\``);
        return;
      }
      if (tag === 'BLOCKQUOTE') {
        const inner = hasBlockChildren(node) ? joinBlocks(collectBlocks(node)) : inlineText(node);
        if (inner) chunks.push(inner.split('\n').map((line) => `> ${line}`).join('\n'));
        return;
      }
      if (tag === 'A') {
        const link = renderLink(node, NO_FLAGS);
        if (link) chunks.push(link);
        return;
      }
      const level = headingLevel(node);
      if (level) {
        const text = inlineText(node);
        if (text) chunks.push(`${'#'.repeat(level)} ${text}`);
        return;
      }
      if (hasTopRule(node)) chunks.push('---');
      if (hasBlockChildren(node)) {
        const inner = joinBlocks(collectBlocks(node));
        if (inner) chunks.push(inner);
        return;
      }
      const text = inlineText(node);
      if (text) chunks.push(text);
    });
    flushList();
    return chunks;
  }

  function htmlToMarkdown(html) {
    const ctx = { images: [] };
    convertCtx = ctx;
    try {
      if (typeof DOMParser === 'undefined') return { markdown: '', images: [] };
      const doc = new DOMParser().parseFromString(preprocess(html), 'text/html');
      const root = doc.body || doc.documentElement;
      if (!root) return { markdown: '', images: [] };
      hoistListMarkers(root);
      const markdown = joinBlocks(collectBlocks(root)).replace(/\n{4,}/g, '\n\n\n').trim();
      return { markdown, images: ctx.images };
    } catch (err) {
      return { markdown: '', images: [] };
    } finally {
      convertCtx = null;
    }
  }

  function selfTest() {
    const fails = [];
    const check = (name, ok) => { if (!ok) fails.push(name); };

    const plain = [
      'From: Alice Example <alice@example.com>',
      'Sent: Friday, October 3, 2026 8:00 AM',
      'To: Bob <bob@example.com>',
      'Subject: Notes from today',
      '',
      'Hi Bob,',
    ].join('\n');
    const plainMd = formatPlainHeaders(plain);
    check('plain headers', plainMd === [
      '**From:** Alice Example <alice@example.com>',
      '**Sent:** Friday, October 3, 2026 8:00 AM',
      '**To:** Bob <bob@example.com>',
      '**Subject:** Notes from today',
      '',
      'Hi Bob,',
    ].join('\n'));
    check('plain ignores notes', formatPlainHeaders('From the desk\nSubject: widgets\n\nHello') === null);
    check('skip web html', shouldHandle('<p>From: a@b.c</p><p>Subject: Hi</p>', plain) === false);
    check('handle plain mail', shouldHandle('', plain) === true);
    check('handle outlook html', shouldHandle('<p class="MsoNormal">Hi</p>', 'Hi') === true);
    check('local page ref', localPageRef('https://notes.example/p/demo/main/welcome/') === 'main:welcome');
    check('local page ref subpath', localPageRef('/DjangoNotesPro/p/demo/docs/read-me') === 'docs:read-me');
    check('local page ref already', localPageRef('main:welcome') === 'main:welcome');
    check('external stays external', localPageRef('https://example.com/docs') === '');

    if (typeof DOMParser === 'undefined') return fails;

    const classic = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office">
      <head><meta name="Generator" content="Microsoft Word 15 (filtered medium)"></head>
      <body><div class="WordSection1">
      <p class="MsoNormal"><b>From:</b> Alice Example &lt;alice@example.com&gt;<br>
      <b>Sent:</b> Friday, October 3, 2026 8:00 AM<br>
      <b>To:</b> Bob &lt;bob@example.com&gt;<br>
      <b>Cc:</b> Cara &lt;cara@example.com&gt;<br>
      <b>Subject:</b> Notes from today</p>
      <p class="MsoNormal">&nbsp;</p>
      <p class="MsoNormal">Hi Bob,</p>
      <p class="MsoNormal">Please see the <b>notes</b> and the <a href="https://example.com/doc">doc</a>.</p>
      <p class="MsoListParagraph" style="margin-left:36.0pt;mso-list:l0 level1 lfo1"><span style="font-family:Symbol"><span style="mso-list:Ignore">·<span style="font:7.0pt">&nbsp;&nbsp;&nbsp;</span></span></span>First item</p>
      <p class="MsoListParagraph" style="margin-left:72.0pt;mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">o<span>&nbsp;</span></span>Nested item</p>
      <p class="MsoNormal"><img width="320" height="180" src="cid:image001.png@01DC" alt="chart"></p>
      <table><tr><td>Name</td><td>Qty</td></tr><tr><td>Pens</td><td>2</td></tr></table>
      </div></body></html>`;
    const converted = htmlToMarkdown(classic);
    const expected = [
      '**From:** Alice Example &lt;alice@example.com&gt;',
      '**Sent:** Friday, October 3, 2026 8:00 AM',
      '**To:** Bob &lt;bob@example.com&gt;',
      '**Cc:** Cara &lt;cara@example.com&gt;',
      '**Subject:** Notes from today',
      '',
      'Hi Bob,',
      '',
      'Please see the **notes** and the [doc](https://example.com/doc).',
      '',
      '- First item',
      '  - Nested item',
      '',
      '%%NPIMG0%%',
      '',
      '| Name | Qty |',
      '| --- | --- |',
      '| Pens | 2 |',
    ].join('\n');
    check('classic outlook', converted.markdown === expected);
    check('classic image', converted.images.length === 1 && converted.images[0].src.indexOf('cid:image001') === 0 && converted.images[0].width === '320px');

    const numbered = htmlToMarkdown(`
      <p class="MsoListParagraph" style="mso-list:l1 level1 lfo2"><![if !supportLists]><span>1.</span><![endif]>Alpha</p>
      <p class="MsoListParagraph" style="mso-list:l1 level1 lfo2"><![if !supportLists]><span>2.</span><![endif]>Beta</p>`);
    check('numbered mso list', numbered.markdown === '1. Alpha\n2. Beta');

    const modern = htmlToMarkdown(`
      <div class="elementToProof">
        <p>Please <i>review</i> this.</p>
        <ul><li>One</li><li>Two</li></ul>
      </div>`);
    check('modern outlook', modern.markdown === 'Please *review* this.\n\n- One\n- Two');

    const headerTable = htmlToMarkdown(`
      <table border="0">
        <tr><td><b>From:</b></td><td>Ada &lt;ada@example.com&gt;</td></tr>
        <tr><td><b>Sent:</b></td><td>Monday</td></tr>
        <tr><td><b>Subject:</b></td><td>Hello</td></tr>
      </table>
      <p class="MsoNormal">Body text</p>`);
    check('header table', headerTable.markdown === '**From:** Ada &lt;ada@example.com&gt;\n**Sent:** Monday\n**Subject:** Hello\n\nBody text');

    const word = htmlToMarkdown('<p class="MsoNormal">Hello <b>world</b></p>');
    check('word paragraph', word.markdown === 'Hello **world**');
    const pageLink = htmlToMarkdown('<p class="MsoNormal">See the <a href="https://notes.example/p/demo/main/welcome/">welcome page</a>.</p>');
    check('outlook page link', pageLink.markdown === 'See the [welcome page](main:welcome).');

    if (fails.length) {
      fails.forEach((name) => {
        if (name === 'classic outlook') {
          // leave the actual markdown for the runner via a side channel
          selfTest.classic = converted.markdown;
        }
      });
    }
    selfTest.classic = converted.markdown;
    return fails;
  }

  return {
    isWordOrOutlookHtml,
    formatPlainHeaders,
    shouldHandle,
    localPageRef,
    htmlToMarkdown,
    selfTest,
  };
}));

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fails = module.exports.selfTest();
  if (fails.length) {
    console.error(`outlook paste self-test failed (${fails.length}):`);
    fails.forEach((name) => console.error(' -', name));
    if (module.exports.selfTest.classic) {
      console.error('--- classic markdown ---');
      console.error(module.exports.selfTest.classic);
    }
    process.exit(1);
  }
  const htmlRan = typeof DOMParser !== 'undefined';
  console.log(htmlRan ? 'outlook paste self-test ok' : 'outlook paste self-test ok (html skipped)');
}
