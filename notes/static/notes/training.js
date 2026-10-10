/**
 * NotesPro ```training``` block — interval clock that shows each photo for its own time.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProTraining = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const sessions = new Map();

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
      config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim().replace(/,\s*$/, '');
    });
    return config;
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    Object.entries(cfg || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      parts.push(`${key}=${value}`);
    });
    return parts.join(';');
  }

  function parseDuration(raw) {
    const text = String(raw || '').trim().toLowerCase().replace(/,/g, '.');
    if (!text) return null;
    const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (clock) {
      const h = clock[3] != null ? parseInt(clock[1], 10) : 0;
      const m = clock[3] != null ? parseInt(clock[2], 10) : parseInt(clock[1], 10);
      const s = clock[3] != null ? parseInt(clock[3], 10) : parseInt(clock[2], 10);
      return clampDuration(h * 3600 + m * 60 + s);
    }
    const parts = text.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/);
    if (parts && (parts[1] || parts[2] || parts[3])) {
      const total = (parseFloat(parts[1] || '0') * 3600)
        + (parseFloat(parts[2] || '0') * 60)
        + parseFloat(parts[3] || '0');
      if (total > 0) return clampDuration(total);
    }
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const n = parseFloat(text);
      if (n > 0) return clampDuration(n);
    }
    return null;
  }

  function clampDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(6 * 3600, Math.max(1, seconds));
  }

  function formatDurationToken(seconds) {
    const total = Math.max(1, Math.round(Number(seconds) || 0));
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (!s) return `${m}m`;
    return `${m}m${s}s`;
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const tenths = Math.floor(safe * 10 + 1e-4);
    const whole = Math.floor(tenths / 10);
    const tenth = tenths % 10;
    const mm = Math.floor(whole / 60);
    const ss = whole % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenth}`;
  }

  function formatElapsed(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const mm = Math.floor(whole / 60);
    const ss = whole % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function defaultSeconds(cfg) {
    return parseDuration(cfg?.time || cfg?.seconds || cfg?.duration || '30s') || 30;
  }

  function resolveLoop(cfg) {
    const raw = String(cfg?.loop ?? '0').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  function resolveEndMessage(cfg) {
    const raw = cfg?.endmessage ?? cfg?.endmsg ?? '';
    const text = String(raw).trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    return text || 'end';
  }

  function resolveMediaHref(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href) || /^data:/i.test(href)) return href;
    const appBase = (typeof window !== 'undefined' && window.APP_BASE) ? String(window.APP_BASE).replace(/\/$/, '') : '';
    let path = String(href).replace(/\\/g, '/');
    if (/^media\//i.test(path)) return appBase ? `${appBase}/${path}` : `/${path}`;
    if (path.startsWith('/')) return appBase && !path.startsWith(`${appBase}/`) ? `${appBase}${path}` : path;
    return appBase ? `${appBase}/${path}` : `/${path}`;
  }

  function looksLikeSrc(src) {
    const value = String(src || '').trim();
    if (!value || /\s/.test(value)) return false;
    return /^https?:\/\//i.test(value)
      || value.startsWith('media/')
      || value.startsWith('/')
      || /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:$|[?#])/i.test(value);
  }

  function splitLabelAndTime(text) {
    const parts = String(text || '').split('|').map((part) => part.trim()).filter(Boolean);
    let label = '';
    let seconds = null;
    parts.forEach((part) => {
      const dur = parseDuration(part);
      if (dur != null && seconds == null) seconds = dur;
      else if (!label) label = part;
      else label = `${label} ${part}`;
    });
    return { label, seconds };
  }

  function normalizeStep(step, cfg, index) {
    const seconds = clampDuration(step?.seconds) || defaultSeconds(cfg);
    const label = String(step?.label || '').trim() || `Step ${index + 1}`;
    return {
      src: String(step?.src || '').trim(),
      label,
      seconds,
    };
  }

  function parseSteps(source, cfg) {
    const steps = [];
    String(source || '').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const image = trimmed.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (image) {
        const fromAlt = splitLabelAndTime(image[1]);
        const rest = trimmed.slice(image.index + image[0].length);
        const fromRest = splitLabelAndTime(rest);
        const src = image[2].trim();
        if (!looksLikeSrc(src) && !src) return;
        steps.push(normalizeStep({
          src,
          label: fromAlt.label || fromRest.label,
          seconds: fromRest.seconds != null ? fromRest.seconds : fromAlt.seconds,
        }, cfg, steps.length));
        return;
      }
      const bits = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
      let src = '';
      let label = '';
      let seconds = null;
      bits.forEach((part) => {
        const dur = parseDuration(part);
        if (!src && looksLikeSrc(part)) src = part;
        else if (dur != null && seconds == null) seconds = dur;
        else if (!label) label = part;
      });
      if (!src) return;
      steps.push(normalizeStep({ src, label, seconds }, cfg, steps.length));
    });
    return steps;
  }

  function formatBody(steps, cfg) {
    return (steps || []).filter((step) => step && step.src).map((step, index) => {
      const item = normalizeStep(step, cfg, index);
      const label = item.label.replace(/[\[\]]/g, '');
      return `![${label}](${item.src}) | ${formatDurationToken(item.seconds)}`;
    }).join('\n');
  }

  function fenceMarkdown(cfg, steps) {
    const attrs = buildFenceAttrsString(cfg);
    const fence = attrs ? `training{${attrs}}` : 'training';
    const body = formatBody(steps, cfg);
    return `\`\`\`${fence}\n${body}\n\`\`\``;
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
    let theme = THEMES.includes(lower) ? lower : '';
    const colorCss = theme || !colRaw ? '' : sanitizeColor(colRaw);
    const bgCss = sanitizeColor(cfg.bkcol || cfg.bgcol || cfg.bg || '');
    return { theme, colorCss, bgCss };
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
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (_) {
      return null;
    }
  }

  function renderSteps(steps, current, editable) {
    if (!steps.length) return '';
    return `<div class="training-steps" role="list">${steps.map((step, index) => {
      const currentClass = index === current ? ' is-current' : '';
      const time = editable
        ? `<input class="training-step-time" data-index="${index}" value="${escapeHtml(formatDurationToken(step.seconds))}" aria-label="Time for ${escapeHtml(step.label)}" inputmode="text">`
        : `<span class="training-step-time">${escapeHtml(formatDurationToken(step.seconds))}</span>`;
      const remove = editable
        ? `<button type="button" class="training-step-remove" data-action="delete-step" data-index="${index}" aria-label="Remove ${escapeHtml(step.label)}">×</button>`
        : '';
      const thumb = step.src
        ? `<img src="${escapeHtml(resolveMediaHref(step.src))}" alt="" draggable="false">`
        : '<span class="training-step-empty" aria-hidden="true"></span>';
      return `<div class="training-step${currentClass}" role="listitem" data-step="${index}">${thumb}<span class="training-step-label">${escapeHtml(step.label)}</span>${time}${remove}</div>`;
    }).join('')}</div>`;
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const steps = parseSteps(source, cfg);
    const spec = {
      title: String(cfg.title || 'Training').trim() || 'Training',
      steps,
      defaultSeconds: defaultSeconds(cfg),
      loop: resolveLoop(cfg),
      endMessage: resolveEndMessage(cfg),
    };
    const trainingIndex = Number.isFinite(options.trainingIndex) ? options.trainingIndex : 0;
    const editable = options.editable !== false;
    const themeClass = style.theme ? ` training-block--${style.theme}` : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--training-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--training-bg:${style.bgCss}`);
    const styleAttr = styleVars.length ? ` style="${styleVars.map((item) => escapeHtml(item)).join(';')}"` : '';
    const addTime = formatDurationToken(spec.defaultSeconds);
    const paste = editable ? [
      '<div class="training-add">',
      '<div class="gallery-paste-zone" tabindex="0" role="button" aria-label="Paste photo">',
      '<span class="gallery-paste-icon" aria-hidden="true">📷</span>',
      '<span class="gallery-paste-label">Paste a photo (Ctrl+V), like the gallery</span>',
      '</div>',
      `<label class="training-add-label">Time <input class="training-add-time" value="${escapeHtml(addTime)}" aria-label="Time for the next photo" inputmode="text"></label>`,
      '</div>',
    ].join('') : '';
    const fullscreen = window.NotesProGameFullscreen?.renderButton?.() || '';
    return [
      `<div class="training-block${themeClass}${editable ? ' training-block--editable' : ''}" data-training-index="${trainingIndex}" data-training-spec="${escapeHtml(encodeSpec(spec))}" tabindex="0"${styleAttr}>`,
      '<div class="training-head">',
      `<div class="training-title">${escapeHtml(spec.title)}</div>`,
      '<div class="training-meta"></div>',
      fullscreen,
      '</div>',
      '<div class="training-stage">',
      '<img class="training-photo" alt="" draggable="false">',
      '<div class="training-clock" role="timer" aria-live="off">00:00.0</div>',
      '</div>',
      '<div class="training-caption"></div>',
      '<div class="training-bar" aria-hidden="true"><span></span></div>',
      '<div class="training-controls">',
      '<button type="button" data-action="prev">Prev</button>',
      '<button type="button" data-action="toggle">Start</button>',
      '<button type="button" data-action="next">Next</button>',
      '<button type="button" data-action="reset">Reset</button>',
      '</div>',
      '<div class="training-step-slot"></div>',
      paste,
      '</div>',
    ].join('');
  }

  function sessionKey(el) {
    const page = new URLSearchParams(window.location.search).get('page') || 'page';
    return `${page}:${el.dataset.trainingIndex || '0'}`;
  }

  function advance(session, steps, now) {
    if (!session.running || !steps.length) {
      session.t = now;
      return false;
    }
    let dt = (now - session.t) / 1000;
    session.t = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 3600) dt = 3600;
    session.elapsed += dt;
    session.remaining -= dt;
    let changed = false;
    let guard = 0;
    while (session.remaining <= 0 && guard < 1000) {
      guard += 1;
      const overshoot = -session.remaining;
      const next = session.index + 1;
      if (next >= steps.length && !session.loop) {
        session.index = Math.max(0, steps.length - 1);
        session.remaining = 0;
        session.running = false;
        session.done = true;
        changed = true;
        break;
      }
      session.index = next % steps.length;
      session.remaining = (steps[session.index]?.seconds || 1) - overshoot;
      changed = true;
    }
    return changed;
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = beep.ctx || new Ctx();
      beep.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (_) { /* autoplay can block the tone */ }
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.trainingHydrated === '1') return;
    const spec = decodeSpec(el.dataset.trainingSpec);
    if (!spec) return;
    el.dataset.trainingHydrated = '1';
    window.NotesProGameFullscreen?.bind?.(el);
    const steps = (spec.steps || []).map((step, index) => normalizeStep(step, { time: spec.defaultSeconds }, index));
    const slot = el.querySelector('.training-step-slot');
    const key = sessionKey(el);
    let session = sessions.get(key);
    const now = performance.now();
    if (!session) {
      session = {
        index: 0,
        remaining: steps[0]?.seconds || spec.defaultSeconds || 30,
        elapsed: 0,
        running: false,
        done: false,
        loop: spec.loop !== false,
        t: now,
      };
      sessions.set(key, session);
    } else {
      session.loop = spec.loop !== false;
      if (session.index >= steps.length) session.index = 0;
      const cap = steps[session.index]?.seconds || spec.defaultSeconds || 30;
      if (session.remaining > cap) session.remaining = cap;
      advance(session, steps, now);
    }

    function paint(announce) {
      const step = steps[session.index] || null;
      const clock = el.querySelector('.training-clock');
      const caption = el.querySelector('.training-caption');
      const meta = el.querySelector('.training-meta');
      const photo = el.querySelector('.training-photo');
      const bar = el.querySelector('.training-bar > span');
      const toggle = el.querySelector('[data-action="toggle"]');
      const total = step?.seconds || spec.defaultSeconds || 30;
      if (clock) {
        const ended = !!session.done;
        const endMessage = spec.endMessage || 'end';
        clock.textContent = ended ? endMessage : formatClock(session.remaining);
        clock.classList.toggle('is-end', ended);
        if (announce) clock.setAttribute('aria-label', ended ? endMessage : clock.textContent);
      }
      if (caption) caption.textContent = step ? step.label : 'Paste a photo to start';
      if (meta) {
        const count = steps.length ? `Step ${session.index + 1} / ${steps.length}` : 'No photos yet';
        meta.textContent = `${count} · total ${formatElapsed(session.elapsed)}${session.done ? ' · done' : ''}`;
      }
      if (photo) {
        if (step?.src) {
          photo.src = resolveMediaHref(step.src);
          photo.alt = step.label || '';
          photo.hidden = false;
        } else {
          photo.removeAttribute('src');
          photo.alt = '';
          photo.hidden = true;
        }
      }
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (session.remaining / total) * 100))}%`;
      if (toggle) toggle.textContent = session.running ? 'Pause' : 'Start';
      el.querySelectorAll('.training-step').forEach((node) => {
        node.classList.toggle('is-current', Number(node.dataset.step) === session.index);
      });
    }

    if (slot) slot.innerHTML = renderSteps(steps, session.index, !!options.onSteps);
    paint(true);

    let raf = 0;
    let lastAnnounced = Math.floor(session.remaining);
    function frame(ts) {
      if (!el.isConnected) return;
      const changed = advance(session, steps, ts);
      if (changed && (session.running || session.done)) beep();
      const whole = Math.floor(session.remaining);
      paint(whole !== lastAnnounced);
      lastAnnounced = whole;
      if (session.running && el.isConnected) raf = requestAnimationFrame(frame);
    }
    function ensureFrame() {
      cancelAnimationFrame(raf);
      session.t = performance.now();
      if (session.running) raf = requestAnimationFrame(frame);
    }
    if (session.running) raf = requestAnimationFrame(frame);

    function jump(index, mode) {
      if (!steps.length) return;
      const count = steps.length;
      const next = session.loop
        ? ((index % count) + count) % count
        : Math.max(0, Math.min(count - 1, index));
      session.index = next;
      session.remaining = steps[next].seconds;
      session.done = false;
      if (mode === 'run' || mode === 'stop') session.elapsed = 0;
      if (mode === 'run') session.running = true;
      if (mode === 'stop') session.running = false;
      ensureFrame();
      paint(true);
    }

    el.addEventListener('click', (event) => {
      if (event.target.closest('.game-fullscreen-btn, input, .training-step-time')) return;
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle') {
        if (!session.running && session.done) {
          jump(0, 'run');
          return;
        }
        session.running = !session.running;
        session.done = false;
        if (session.running && session.remaining <= 0) jump(session.loop ? session.index + 1 : session.index, false);
        ensureFrame();
        paint(true);
        return;
      }
      if (action === 'prev') {
        jump(session.index - 1, false);
        return;
      }
      if (action === 'next') {
        jump(session.index + 1, false);
        return;
      }
      if (action === 'reset') {
        jump(0, 'stop');
        return;
      }
      if (action === 'delete-step' && typeof options.onSteps === 'function') {
        const index = parseInt(event.target.closest('[data-index]')?.dataset.index || '', 10);
        if (!Number.isFinite(index)) return;
        const next = steps.filter((_, itemIndex) => itemIndex !== index);
        options.onSteps(next);
        return;
      }
      const step = event.target.closest('.training-step');
      if (step) jump(parseInt(step.dataset.step, 10) || 0, false);
      if (event.target.closest('.gallery-paste-zone')) {
        try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      }
    });

    el.addEventListener('change', (event) => {
      const input = event.target.closest('.training-step-time');
      if (!input || typeof options.onSteps !== 'function') return;
      const index = parseInt(input.dataset.index, 10);
      const seconds = parseDuration(input.value);
      if (!Number.isFinite(index) || seconds == null) {
        if (steps[index]) input.value = formatDurationToken(steps[index].seconds);
        return;
      }
      const next = steps.map((step, itemIndex) => (
        itemIndex === index ? { ...step, seconds } : step
      ));
      if (session.index === index && session.remaining > seconds) session.remaining = seconds;
      options.onSteps(next);
    });

    const pasteSeconds = () => parseDuration(el.querySelector('.training-add-time')?.value) || spec.defaultSeconds || 30;

    async function handleFiles(files) {
      const images = [...files].filter((file) => file && String(file.type || '').startsWith('image/'));
      if (!images.length || typeof options.onPasteImage !== 'function') return;
      const seconds = pasteSeconds();
      el.classList.add('training-block--uploading');
      try {
        for (const file of images) {
          await options.onPasteImage(file, seconds);
        }
      } finally {
        el.classList.remove('training-block--uploading');
      }
    }

    el.addEventListener('paste', (event) => {
      const items = [...(event.clipboardData?.items || [])];
      const files = items
        .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (files.length && typeof options.onPasteImage === 'function') {
        event.preventDefault();
        event.stopPropagation();
        void handleFiles(files);
        return;
      }
      const text = event.clipboardData?.getData('text/plain') || '';
      const url = (text.match(/https?:\/\/\S+/i) || [''])[0].replace(/[),.;]+$/g, '');
      if (url && typeof options.onPasteImageUrl === 'function' && looksLikeSrc(url)) {
        event.preventDefault();
        event.stopPropagation();
        void options.onPasteImageUrl(url, pasteSeconds());
      }
    });

    el.addEventListener('dragover', (event) => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault();
      el.classList.add('training-block--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('training-block--drop'));
    el.addEventListener('drop', (event) => {
      el.classList.remove('training-block--drop');
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void handleFiles(files);
    });

    const disconnectObs = new MutationObserver(() => {
      if (!el.isConnected) {
        cancelAnimationFrame(raf);
        advance(session, steps, performance.now());
        disconnectObs.disconnect();
      }
    });
    disconnectObs.observe(document.body, { childList: true, subtree: true });
  }

  return {
    parseFenceAttrs,
    parseDuration,
    parseSteps,
    formatBody,
    fenceMarkdown,
    normalizeStep,
    buildFenceAttrsString,
    renderBlock,
    hydrateBlock,
  };
}));
