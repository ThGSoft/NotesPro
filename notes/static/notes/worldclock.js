/**
 * NotesPro time fences:
 * ```worldclock``` city clocks, ```alarm``` settable alarms,
 * ```countdowntimer``` count-up timer and countdown timers.
 */
(function (root, factory) {
  const api = factory(root);
  root.NotesProWorldclock = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const MAX_CLOCKS = 24;
  const MAX_COUNTDOWNS = 16;
  const MAX_ALARMS = 8;
  const MAX_LAPS = 30;
  const sessions = new Map();
  let audioCtx = null;

  const CITIES = {
    local: 'local',
    utc: 'UTC',
    gmt: 'UTC',
    london: 'Europe/London',
    paris: 'Europe/Paris',
    berlin: 'Europe/Berlin',
    madrid: 'Europe/Madrid',
    rome: 'Europe/Rome',
    amsterdam: 'Europe/Amsterdam',
    zurich: 'Europe/Zurich',
    vienna: 'Europe/Vienna',
    moscow: 'Europe/Moscow',
    dubai: 'Asia/Dubai',
    mumbai: 'Asia/Kolkata',
    delhi: 'Asia/Kolkata',
    bangkok: 'Asia/Bangkok',
    singapore: 'Asia/Singapore',
    'hong kong': 'Asia/Hong_Kong',
    hongkong: 'Asia/Hong_Kong',
    shanghai: 'Asia/Shanghai',
    beijing: 'Asia/Shanghai',
    tokyo: 'Asia/Tokyo',
    seoul: 'Asia/Seoul',
    sydney: 'Australia/Sydney',
    melbourne: 'Australia/Melbourne',
    auckland: 'Pacific/Auckland',
    honolulu: 'Pacific/Honolulu',
    'los angeles': 'America/Los_Angeles',
    'san francisco': 'America/Los_Angeles',
    denver: 'America/Denver',
    chicago: 'America/Chicago',
    'new york': 'America/New_York',
    nyc: 'America/New_York',
    toronto: 'America/Toronto',
    'mexico city': 'America/Mexico_City',
    'sao paulo': 'America/Sao_Paulo',
    'são paulo': 'America/Sao_Paulo',
    'buenos aires': 'America/Argentina/Buenos_Aires',
    cairo: 'Africa/Cairo',
    johannesburg: 'Africa/Johannesburg',
    lagos: 'Africa/Lagos',
    reykjavik: 'Atlantic/Reykjavik',
  };

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(n, width = 2) {
    return String(Math.max(0, n | 0)).padStart(width, '0');
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

  function clampDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(24 * 3600, Math.max(1, Math.round(seconds)));
  }

  function parseDuration(raw) {
    const text = String(raw || '').trim().toLowerCase().replace(/,/g, '.');
    if (!text) return null;
    const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (clock) {
      const h = clock[3] != null ? parseInt(clock[1], 10) : 0;
      const m = clock[3] != null ? parseInt(clock[2], 10) : parseInt(clock[1], 10);
      const s = clock[3] != null ? parseInt(clock[3], 10) : parseInt(clock[2], 10);
      if (m > 59 || s > 59) return null;
      return clampDuration(h * 3600 + m * 60 + s);
    }
    const parts = text.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/);
    if (parts && (parts[1] || parts[2] || parts[3])) {
      const total = (parseFloat(parts[1] || '0') * 3600)
        + (parseFloat(parts[2] || '0') * 60)
        + parseFloat(parts[3] || '0');
      if (total > 0) return clampDuration(total);
    }
    if (/^\d+(?:\.\d+)?$/.test(text)) return clampDuration(parseFloat(text));
    return null;
  }

  function formatMs(ms, centis) {
    const safe = Math.max(0, Number(ms) || 0);
    const total = Math.floor(safe / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const body = h > 0
      ? `${pad(h)}:${pad(m)}:${pad(s)}`
      : `${pad(m)}:${pad(s)}`;
    if (!centis) return body;
    return `${body}.${pad(Math.floor((safe % 1000) / 10))}`;
  }

  function normalizeFace(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'a' || value === 'analog' || value === 'analogue') return 'analog';
    if (value === 'd' || value === 'digital') return 'digital';
    if (value === 'both' || value === 'all') return 'both';
    return '';
  }

  function resolveZone(name) {
    const key = String(name || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (!key) return '';
    if (CITIES[key]) return CITIES[key];
    if (key === 'la') return CITIES['los angeles'];
    return '';
  }

  function cityFromZone(zone) {
    return String(zone || '').split('/').pop().replace(/_/g, ' ');
  }

  function specialZone(token) {
    const key = String(token || '').trim().toLowerCase();
    if (key === 'cet' || key === 'cest') return { zone: 'Europe/Berlin', kind: 'cet' };
    if (key === 'oesz') return { zone: 'offset:+180', kind: 'oesz' };
    return null;
  }

  function parseOffsetMinutes(zone) {
    const match = String(zone || '').match(/^offset:([+-]\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function cetLabel(offsetMin) {
    return Number(offsetMin) === 120 ? 'CEST' : 'CET';
  }

  function slug(text, index) {
    const base = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return base || `timer-${index + 1}`;
  }

  function defaultClocks() {
    return [
      { label: 'Local', zone: 'local', face: 'both' },
      { label: 'London', zone: 'Europe/London', face: 'analog' },
      { label: 'New York', zone: 'America/New_York', face: 'digital' },
      { label: 'Tokyo', zone: 'Asia/Tokyo', face: 'both' },
    ];
  }

  function defaultCountdowns() {
    return [
      { label: 'Pomodoro', seconds: 25 * 60, repeat: false },
      { label: 'Short break', seconds: 5 * 60, repeat: false },
      { label: 'Long break', seconds: 15 * 60, repeat: false },
    ];
  }

  function defaultAlarms() {
    return [{ label: 'Alarm', h: 7, m: 0, on: false, face: 'analog' }];
  }

  function assignAlarmIds(alarms) {
    const used = new Set();
    alarms.forEach((alarm, index) => {
      let id = slug(alarm.label, index);
      if (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      alarm.id = id;
    });
    return alarms;
  }

  function parseClockLine(line) {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    let label = parts[0];
    let zone = '';
    let face = 'both';
    parts.slice(1).forEach((part) => {
      const asFace = normalizeFace(part);
      if (asFace) {
        face = asFace;
        return;
      }
      if (!zone) zone = part;
    });
    const special = specialZone(zone) || (!zone ? specialZone(label) : null);
    if (special) {
      const namedCity = !!zone && !/^(cet|cest|oesz)$/i.test(label);
      if (special.kind === 'oesz') {
        return {
          label: 'OESZ',
          zone: special.zone,
          face,
          kind: 'oesz',
          autoName: true,
        };
      }
      return {
        label: namedCity ? label : 'CET',
        zone: special.zone,
        face,
        kind: 'cet',
        autoName: !namedCity,
      };
    }
    if (!zone) zone = resolveZone(label) || (/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(label) ? label : 'local');
    else if (!/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(zone) && !/^(utc|gmt|local)$/i.test(zone)) {
      zone = resolveZone(zone) || zone;
    }
    if (/^local$/i.test(zone)) zone = 'local';
    else if (/^(utc|gmt)$/i.test(zone)) zone = 'UTC';
    if (/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(label)) label = cityFromZone(label);
    return { label, zone, face, kind: '', autoName: false };
  }

  function parseCountdownLine(line) {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    let label = parts[0];
    let seconds = parts.length > 1 ? parseDuration(parts[1]) : parseDuration(parts[0]);
    if (!seconds && parts.length > 1) {
      seconds = parseDuration(parts[0]);
      if (seconds) label = parts[1];
    }
    if (!seconds) return null;
    if (parts.length === 1) label = 'Timer';
    const repeat = parts.slice(1).some((part) => /^(repeat|loop|interval)$/i.test(part));
    return { label, seconds, repeat };
  }

  function parseAlarmLine(line) {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    let label = '';
    let time = null;
    let on = false;
    let face = 'analog';
    parts.forEach((part) => {
      const hm = part.match(/^(\d{1,2}):(\d{2})$/);
      if (hm && !time) {
        const h = parseInt(hm[1], 10);
        const m = parseInt(hm[2], 10);
        if (h <= 23 && m <= 59) time = { h, m };
        return;
      }
      const asFace = normalizeFace(part);
      if (asFace) {
        face = asFace;
        return;
      }
      if (/^(on|off|yes|no|true|false)$/i.test(part)) {
        on = /^(on|yes|true)$/i.test(part);
        return;
      }
      if (!label) label = part;
    });
    if (!time) return null;
    return { label: label || 'Alarm', h: time.h, m: time.m, on, face };
  }

  function assignCountdownIds(countdowns) {
    const used = new Set(['custom']);
    countdowns.forEach((cd, index) => {
      let id = slug(cd.label, index);
      if (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      cd.id = id;
    });
    return countdowns;
  }

  function parseContent(content, cfg = {}, kind = 'clock') {
    const clocks = [];
    const countdowns = [];
    const alarms = [];
    let section = kind === 'alarm' ? 'alarm' : kind === 'countdown' ? 'countdown' : 'clocks';
    let sawCountdown = false;
    let sawAlarm = false;
    String(content || '').split(/\r?\n/).forEach((raw) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('//')) return;
      if (/^#{1,6}\s+/.test(trimmed) && !trimmed.includes('|')) {
        const head = trimmed.replace(/^#{1,6}\s+/, '').trim().toLowerCase();
        if (/^(countdown|countdowns|countdown timer|timers?)/.test(head)) {
          section = 'countdown';
          sawCountdown = true;
          return;
        }
        if (/^alarms?$/.test(head)) {
          section = 'alarm';
          sawAlarm = true;
          return;
        }
        if (/^clocks?/.test(head)) {
          section = 'clocks';
          return;
        }
        return;
      }
      if (section === 'countdown') {
        const cd = parseCountdownLine(trimmed);
        if (cd) countdowns.push(cd);
        return;
      }
      if (section === 'alarm') {
        const alarm = parseAlarmLine(trimmed);
        if (alarm) alarms.push(alarm);
        return;
      }
      const clock = parseClockLine(trimmed);
      if (clock) clocks.push(clock);
    });
    const themeRaw = String(cfg.col || cfg.theme || '').trim().toLowerCase();
    const titles = { clock: 'World clock', alarm: 'Alarm', countdown: 'Countdown' };
    const clockList = kind === 'clock' ? (clocks.length ? clocks : defaultClocks()) : [];
    const countdownList = kind === 'countdown'
      ? (countdowns.length ? countdowns : (sawCountdown ? [] : defaultCountdowns()))
      : [];
    const alarmList = kind === 'alarm'
      ? (alarms.length ? alarms : defaultAlarms())
      : [];
    return {
      title: String(cfg.title || titles[kind] || titles.clock).trim() || titles[kind] || titles.clock,
      theme: THEMES.includes(themeRaw) ? themeRaw : '',
      clocks: clockList.slice(0, MAX_CLOCKS),
      countdowns: assignCountdownIds(countdownList.slice(0, MAX_COUNTDOWNS)),
      alarms: assignAlarmIds(alarmList.slice(0, MAX_ALARMS)),
    };
  }

  function faceSvg(compact) {
    const outer = compact ? 36 : 45;
    const majorInner = compact ? 29 : 37;
    const minorInner = compact ? 32 : 41;
    const numR = compact ? 23 : 29;
    const ticks = [];
    for (let i = 0; i < 60; i += 1) {
      const major = i % 5 === 0;
      const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const r1 = major ? majorInner : minorInner;
      ticks.push(
        `<line class="${major ? 'wc-tick' : 'wc-tick-minor'}" x1="${(50 + Math.cos(angle) * r1).toFixed(2)}" y1="${(50 + Math.sin(angle) * r1).toFixed(2)}" x2="${(50 + Math.cos(angle) * outer).toFixed(2)}" y2="${(50 + Math.sin(angle) * outer).toFixed(2)}"/>`,
      );
    }
    const nums = [12, 3, 6, 9].map((n) => {
      const angle = ((n % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      const x = 50 + Math.cos(angle) * numR;
      const y = 50 + Math.sin(angle) * numR + 2.2;
      return `<text class="wc-num" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle">${n}</text>`;
    }).join('');
    const ring = compact
      ? `<circle class="wc-ring-track" cx="50" cy="50" r="46"/><circle class="wc-ring-value" cx="50" cy="50" r="46" transform="rotate(-90 50 50)"/>`
      : '';
    return `<svg class="wc-face${compact ? ' wc-face--count' : ''}" viewBox="0 0 100 100" aria-hidden="true">${ring}<circle class="wc-face-bg" cx="50" cy="50" r="${compact ? 40 : 48}"/>${ticks.join('')}${nums}<line class="wc-hand-hour" x1="50" y1="50" x2="50" y2="${compact ? 30 : 26}"/><line class="wc-hand-minute" x1="50" y1="50" x2="50" y2="${compact ? 22 : 16}"/><line class="wc-hand-second" x1="50" y1="50" x2="50" y2="${compact ? 18 : 12}"/><circle class="wc-cap" cx="50" cy="50" r="2.1"/></svg>`;
  }

  function clockCard(clock) {
    const face = clock.face === 'digital'
      ? ''
      : faceSvg(false);
    const kind = clock.kind ? ` data-kind="${escapeHtml(clock.kind)}"` : '';
    const auto = clock.autoName ? ' data-auto-name="1"' : '';
    return `<article class="wc-clock wc-clock--${clock.face}" data-zone="${escapeHtml(clock.zone)}" data-face="${clock.face}"${kind}${auto}>`
      + `<div class="wc-clock-name">${escapeHtml(clock.label)}</div>`
      + face
      + '<div class="wc-digital"><div class="wc-hms">--:--:--</div><div class="wc-date"></div><div class="wc-offset"></div></div>'
      + '</article>';
  }

  function alarmCard(alarm) {
    const face = alarm.face || 'analog';
    const on = !!alarm.on;
    return `<article class="wc-alarm wc-alarm--${face}${on ? ' is-on' : ''}" data-alarm-id="${escapeHtml(alarm.id)}" data-hour="${alarm.h}" data-minute="${alarm.m}" data-on="${on ? '1' : '0'}" data-face="${face}">`
      + `<div class="wc-clock-name">${escapeHtml(alarm.label)}</div>`
      + '<div class="wc-face-switch" role="group" aria-label="Alarm display">'
      + `<button type="button" class="wc-btn${face !== 'digital' ? ' is-active' : ''}" data-action="alarm-face" data-face="analog">Analog</button>`
      + `<button type="button" class="wc-btn${face !== 'analog' ? ' is-active' : ''}" data-action="alarm-face" data-face="digital">Digital</button>`
      + '</div>'
      + faceSvg(false)
      + `<div class="wc-digital"><div class="wc-hms">${pad(alarm.h)}:${pad(alarm.m)}</div><div class="wc-alarm-status">${on ? 'On' : 'Off'}</div></div>`
      + '<div class="wc-cd-set">'
      + `<label class="wc-unit"><span>h</span><input type="number" min="0" max="23" value="${alarm.h}" data-alarm-unit="h" aria-label="Alarm hour"></label>`
      + `<label class="wc-unit"><span>m</span><input type="number" min="0" max="59" value="${alarm.m}" data-alarm-unit="m" aria-label="Alarm minute"></label>`
      + '</div>'
      + '<div class="wc-actions">'
      + `<button type="button" class="wc-btn wc-btn--primary" data-action="alarm-toggle" aria-pressed="${on ? 'true' : 'false'}">${on ? 'On' : 'Off'}</button>`
      + '<button type="button" class="wc-btn" data-action="alarm-dismiss" hidden>Dismiss</button>'
      + '</div></article>';
  }

function countdownCard(cd, custom) {
    const seconds = custom ? 5 * 60 : cd.seconds;
    const digital = formatMs(seconds * 1000, false);
    const set = custom
      ? '<div class="wc-cd-set">'
        + '<label class="wc-unit"><span>h</span><input type="number" min="0" max="23" value="0" data-unit="h" aria-label="Hours"></label>'
        + '<label class="wc-unit"><span>m</span><input type="number" min="0" max="59" value="5" data-unit="m" aria-label="Minutes"></label>'
        + '<label class="wc-unit"><span>s</span><input type="number" min="0" max="59" value="0" data-unit="s" aria-label="Seconds"></label>'
        + '</div>'
      : '';
    const name = custom ? 'Custom' : cd.label;
    const id = custom ? 'custom' : cd.id;
    const repeat = !custom && cd.repeat ? ' data-repeat="1"' : '';
    return `<article class="wc-cd${custom ? ' wc-cd--custom' : ''}" data-cd-id="${escapeHtml(id)}" data-seconds="${seconds}"${repeat}>`
      + `<div class="wc-cd-name">${escapeHtml(name)}</div>`
      + faceSvg(true)
      + `<div class="wc-cd-digital">${digital}</div>`
      + '<div class="wc-cd-status"></div>'
      + set
      + '<div class="wc-actions">'
      + '<button type="button" class="wc-btn wc-btn--primary" data-action="cd-toggle">Start</button>'
      + '<button type="button" class="wc-btn" data-action="cd-reset">Reset</button>'
      + '</div></article>';
  }

  function stopwatchMarkup() {
    return '<section class="wc-section"><h3 class="wc-section-title">Timer</h3>'
      + '<div class="wc-stopwatch">'
      + faceSvg(false)
      + '<div class="wc-sw-body">'
      + '<div class="wc-sw-digital">00:00.00</div>'
      + '<div class="wc-actions">'
      + '<button type="button" class="wc-btn wc-btn--primary" data-action="sw-toggle">Start</button>'
      + '<button type="button" class="wc-btn" data-action="sw-lap" disabled>Lap</button>'
      + '<button type="button" class="wc-btn" data-action="sw-reset">Reset</button>'
      + '</div>'
      + '<ol class="wc-laps"></ol>'
      + '</div></div></section>';
  }

  function renderBlock(content, fenceAttrs, options = {}) {
    const kind = options.kind === 'alarm' || options.kind === 'countdown' ? options.kind : 'clock';
    const cfg = parseFenceAttrs(fenceAttrs);
    const spec = parseContent(content, cfg, kind);
    const rootClass = kind === 'alarm' ? 'alarm-block' : kind === 'countdown' ? 'countdowntimer-block' : 'worldclock-block';
    const themeClass = spec.theme ? ` ${rootClass}--${spec.theme}` : '';
    const index = Number.isFinite(options.worldclockIndex) ? options.worldclockIndex : 0;
    const meta = kind === 'alarm'
      ? 'On or off, analog or digital'
      : kind === 'countdown'
        ? 'Count-up timer and countdown'
        : 'Analog and digital clocks';
    let body = '';
    if (kind === 'alarm') {
      body = `<div class="wc-alarms">${spec.alarms.map(alarmCard).join('')}</div>`;
    } else if (kind === 'countdown') {
      const countdowns = [countdownCard(null, true)].concat(spec.countdowns.map((cd) => countdownCard(cd, false))).join('');
      body = stopwatchMarkup()
        + '<section class="wc-section"><h3 class="wc-section-title">Countdown</h3>'
        + `<div class="wc-cds">${countdowns}</div></section>`;
    } else {
      body = `<div class="wc-clocks">${spec.clocks.map(clockCard).join('')}</div>`;
    }
    return `<div class="${rootClass}${themeClass}" data-wc-kind="${kind}" data-wc-index="${index}">`
      + '<div class="wc-head">'
      + `<div class="wc-title">${escapeHtml(spec.title)}</div>`
      + `<div class="wc-meta">${meta}</div>`
      + '</div>'
      + body
      + '</div>';
  }

  function zonedWall(zone, date) {
    const offsetMin = parseOffsetMinutes(zone);
    if (offsetMin != null) {
      const shifted = new Date(date.getTime() + offsetMin * 60000);
      const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][shifted.getUTCDay()];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        h: shifted.getUTCHours(),
        m: shifted.getUTCMinutes(),
        s: shifted.getUTCSeconds(),
        ms: date.getMilliseconds(),
        dateLabel: `${weekday} ${pad(shifted.getUTCDate())} ${months[shifted.getUTCMonth()]}`,
      };
    }
    const timeZone = !zone || zone === 'local' ? undefined : zone;
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = {};
    fmt.formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    return {
      h: hour,
      m: Number(parts.minute),
      s: Number(parts.second),
      ms: date.getMilliseconds(),
      dateLabel: `${parts.weekday || ''} ${parts.day || ''} ${parts.month || ''}`.trim(),
    };
  }

  function zoneOffsetMinutes(zone, date) {
    const fixed = parseOffsetMinutes(zone);
    if (fixed != null) return fixed;
    const timeZone = !zone || zone === 'local' ? undefined : zone;
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = {};
    fmt.formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hour,
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  function offsetText(zone, date, kind) {
    const fixed = parseOffsetMinutes(zone);
    const timeZone = !zone || zone === 'local' || fixed != null ? undefined : zone;
    let gmt = '';
    if (fixed != null) {
      const sign = fixed < 0 ? '−' : '+';
      const abs = Math.abs(fixed);
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      gmt = m ? `GMT${sign}${h}:${pad(m)}` : `GMT${sign}${h}`;
    } else {
      try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset', hour: '2-digit' });
        gmt = fmt.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || '';
      } catch (err) {
        gmt = '';
      }
    }
    const abbr = kind === 'oesz' ? 'OESZ' : (kind === 'cet' ? cetLabel(fixed != null ? fixed : zoneOffsetMinutes(zone, date)) : '');
    if (!zone || zone === 'local') return gmt ? `${gmt} · local` : 'Local';
    const diff = zoneOffsetMinutes(zone, date) - (-date.getTimezoneOffset());
    let rel = 'same as local';
    if (diff) {
      const sign = diff > 0 ? '+' : '−';
      const abs = Math.abs(diff);
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      rel = m ? `${sign}${h}h ${pad(m)}m` : `${sign}${h}h`;
    }
    if (abbr) return gmt ? `${gmt} · ${abbr} · ${rel}` : `${abbr} · ${rel}`;
    return gmt ? `${gmt} · ${rel}` : rel;
  }

  function describeZone(zone, date, kind) {
    const when = date instanceof Date ? date : new Date(date);
    const wall = zonedWall(zone, when);
    const offset = zoneOffsetMinutes(zone, when);
    return {
      h: wall.h,
      m: wall.m,
      s: wall.s,
      offset,
      label: kind === 'oesz' ? 'OESZ' : (kind === 'cet' ? cetLabel(offset) : ''),
      offsetText: offsetText(zone, when, kind || ''),
    };
  }

  function placeHand(line, angleDeg, length) {
    if (!line) return;
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const tail = length * 0.16;
    line.setAttribute('x1', (50 - Math.cos(rad) * tail).toFixed(2));
    line.setAttribute('y1', (50 - Math.sin(rad) * tail).toFixed(2));
    line.setAttribute('x2', (50 + Math.cos(rad) * length).toFixed(2));
    line.setAttribute('y2', (50 + Math.sin(rad) * length).toFixed(2));
  }

  function setHands(svg, hours, minutes, seconds, millis) {
    if (!svg) return;
    const compact = svg.classList.contains('wc-face--count');
    const sec = seconds + (millis || 0) / 1000;
    const min = minutes + sec / 60;
    const hour = (hours % 12) + min / 60;
    placeHand(svg.querySelector('.wc-hand-hour'), hour * 30, compact ? 16 : 22);
    placeHand(svg.querySelector('.wc-hand-minute'), min * 6, compact ? 24 : 32);
    placeHand(svg.querySelector('.wc-hand-second'), sec * 6, compact ? 28 : 38);
  }

  function setRing(svg, ratio) {
    const ring = svg?.querySelector('.wc-ring-value');
    if (!ring) return;
    const circ = 2 * Math.PI * 46;
    if (!ring.getAttribute('stroke-dasharray')) ring.setAttribute('stroke-dasharray', circ.toFixed(3));
    const clamped = Math.max(0, Math.min(1, ratio));
    ring.setAttribute('stroke-dashoffset', (circ * (1 - clamped)).toFixed(3));
  }

  function paintClock(card, date) {
    const zone = card.dataset.zone || 'local';
    const kind = card.dataset.kind || '';
    const hms = card.querySelector('.wc-hms');
    const dateEl = card.querySelector('.wc-date');
    const offEl = card.querySelector('.wc-offset');
    const nameEl = card.querySelector('.wc-clock-name');
    try {
      const wall = zonedWall(zone, date);
      const text = `${pad(wall.h)}:${pad(wall.m)}:${pad(wall.s)}`;
      if (hms && hms.textContent !== text) hms.textContent = text;
      if (dateEl && dateEl.textContent !== wall.dateLabel) dateEl.textContent = wall.dateLabel;
      const off = offsetText(zone, date, kind);
      if (offEl && offEl.textContent !== off) offEl.textContent = off;
      if (nameEl && kind === 'cet' && card.dataset.autoName === '1') {
        const abbr = cetLabel(zoneOffsetMinutes(zone, date));
        if (nameEl.textContent !== abbr) nameEl.textContent = abbr;
      } else if (nameEl && kind === 'oesz' && card.dataset.autoName === '1' && nameEl.textContent !== 'OESZ') {
        nameEl.textContent = 'OESZ';
      }
      setHands(card.querySelector('.wc-face'), wall.h, wall.m, wall.s, wall.ms);
      card.classList.remove('is-invalid');
    } catch (err) {
      if (hms) hms.textContent = '--:--:--';
      if (dateEl) dateEl.textContent = 'Unknown timezone';
      if (offEl) offEl.textContent = zone;
      card.classList.add('is-invalid');
    }
  }

  function sessionFor(key) {
    if (!sessions.has(key)) {
      sessions.set(key, { sw: { running: false, base: 0, started: 0, laps: [] }, cds: {}, alarms: {} });
    }
    const session = sessions.get(key);
    if (!session.alarms) session.alarms = {};
    return session;
  }

  function ensureAlarm(session, card) {
    const id = card.dataset.alarmId || 'alarm';
    let alarm = session.alarms[id];
    if (!alarm) {
      alarm = {
        h: Number(card.dataset.hour) || 0,
        m: Number(card.dataset.minute) || 0,
        on: card.dataset.on === '1',
        face: card.dataset.face || 'analog',
        ringing: false,
        firedKey: '',
      };
      session.alarms[id] = alarm;
    }
    return alarm;
  }

  function readAlarmTime(card, alarm) {
    const h = Math.max(0, Math.min(23, Math.floor(Number(card.querySelector('[data-alarm-unit="h"]')?.value) || 0)));
    const m = Math.max(0, Math.min(59, Math.floor(Number(card.querySelector('[data-alarm-unit="m"]')?.value) || 0)));
    if (alarm.h !== h || alarm.m !== m) {
      alarm.h = h;
      alarm.m = m;
      alarm.ringing = false;
      alarm.firedKey = '';
      card.dataset.hour = String(h);
      card.dataset.minute = String(m);
    }
  }

  function alarmStamp(date, alarm) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${alarm.h}:${alarm.m}`;
  }

  function tickAlarm(alarm, date) {
    if (!alarm.on) {
      alarm.ringing = false;
      return false;
    }
    const match = date.getHours() === alarm.h && date.getMinutes() === alarm.m;
    const key = alarmStamp(date, alarm);
    if (match && alarm.firedKey !== key) {
      alarm.firedKey = key;
      alarm.ringing = true;
      return true;
    }
    return false;
  }

  function paintAlarm(card, alarm, date) {
    const hms = card.querySelector('.wc-hms');
    const text = `${pad(alarm.h)}:${pad(alarm.m)}`;
    if (hms && hms.textContent !== text) hms.textContent = text;
    const seconds = alarm.ringing ? date.getSeconds() : 0;
    const millis = alarm.ringing ? date.getMilliseconds() : 0;
    setHands(card.querySelector('.wc-face'), alarm.h, alarm.m, seconds, millis);
    card.dataset.on = alarm.on ? '1' : '0';
    card.dataset.face = alarm.face;
    card.classList.toggle('is-on', !!alarm.on);
    card.classList.toggle('is-ringing', !!alarm.ringing);
    card.classList.remove('wc-alarm--analog', 'wc-alarm--digital', 'wc-alarm--both');
    card.classList.add(`wc-alarm--${alarm.face}`);
    const toggle = card.querySelector('[data-action="alarm-toggle"]');
    if (toggle) {
      toggle.textContent = alarm.on ? 'On' : 'Off';
      toggle.setAttribute('aria-pressed', alarm.on ? 'true' : 'false');
    }
    const dismiss = card.querySelector('[data-action="alarm-dismiss"]');
    if (dismiss) dismiss.hidden = !alarm.ringing;
    card.querySelectorAll('[data-action="alarm-face"]').forEach((btn) => {
      const selected = alarm.face === 'both' || alarm.face === btn.dataset.face;
      btn.classList.toggle('is-active', selected);
    });
    const status = card.querySelector('.wc-alarm-status');
    if (status) {
      let label = 'Off';
      if (alarm.ringing) label = 'Ringing';
      else if (alarm.on) {
        const nowMin = date.getHours() * 60 + date.getMinutes();
        let delta = (alarm.h * 60 + alarm.m) - nowMin;
        if (delta < 0) delta += 24 * 60;
        if (delta === 0) label = 'On · now';
        else if (delta < 60) label = `On · in ${delta}m`;
        else label = `On · in ${Math.floor(delta / 60)}h ${pad(delta % 60)}m`;
      }
      if (status.textContent !== label) status.textContent = label;
    }
  }

  function ensureCd(session, id, seconds, repeat) {
    const duration = Math.max(0, Number(seconds) || 0);
    let cd = session.cds[id];
    if (!cd) {
      cd = {
        duration,
        remaining: duration * 1000,
        running: false,
        started: 0,
        alarmed: false,
        repeat: !!repeat,
      };
      session.cds[id] = cd;
      return cd;
    }
    cd.repeat = !!repeat;
    if (!cd.running && !cd.alarmed && cd.remaining === cd.duration * 1000 && cd.duration !== duration) {
      cd.duration = duration;
      cd.remaining = duration * 1000;
    }
    return cd;
  }

  function liveRemaining(cd, now) {
    if (!cd?.running) return cd?.remaining || 0;
    return Math.max(0, cd.remaining - (now - cd.started));
  }

  function swElapsed(sw, now) {
    if (!sw.running) return sw.base;
    return sw.base + (now - sw.started);
  }

  function partsFromMs(ms) {
    const safe = Math.max(0, ms);
    const total = Math.floor(safe / 1000);
    return {
      h: Math.floor(total / 3600),
      m: Math.floor(total / 60) % 60,
      s: total % 60,
      ms: safe % 1000,
    };
  }

  function tickCountdown(cd, now) {
    if (!cd?.running) return false;
    const left = cd.remaining - (now - cd.started);
    if (left > 0) return false;
    if (cd.repeat && cd.duration > 0) {
      cd.remaining = cd.duration * 1000;
      cd.started = now;
      return true;
    }
    cd.remaining = 0;
    cd.running = false;
    cd.started = 0;
    if (cd.alarmed) return false;
    cd.alarmed = true;
    return true;
  }

  function unlockAudio() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (err) {
      audioCtx = null;
    }
  }

  function beep() {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      [0, 0.16, 0.32].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.14);
      });
    } catch (err) {
      /* visual alarm still shows */
    }
  }

  function readCustomSeconds(card) {
    const h = Math.max(0, Math.min(23, Math.floor(Number(card.querySelector('[data-unit="h"]')?.value) || 0)));
    const m = Math.max(0, Math.min(59, Math.floor(Number(card.querySelector('[data-unit="m"]')?.value) || 0)));
    const s = Math.max(0, Math.min(59, Math.floor(Number(card.querySelector('[data-unit="s"]')?.value) || 0)));
    return h * 3600 + m * 60 + s;
  }

  function paintStopwatch(box, sw, now) {
    if (!box) return;
    const elapsed = swElapsed(sw, now);
    const digital = box.querySelector('.wc-sw-digital');
    const text = formatMs(elapsed, true);
    if (digital && digital.textContent !== text) digital.textContent = text;
    const parts = partsFromMs(elapsed);
    setHands(box.querySelector('.wc-face'), parts.h, parts.m, parts.s, parts.ms);
    const toggle = box.querySelector('[data-action="sw-toggle"]');
    if (toggle) toggle.textContent = sw.running ? 'Pause' : 'Start';
    const lap = box.querySelector('[data-action="sw-lap"]');
    if (lap) lap.disabled = !sw.running;
    const list = box.querySelector('.wc-laps');
    if (list && Number(list.dataset.count || '0') !== sw.laps.length) {
      list.dataset.count = String(sw.laps.length);
      list.innerHTML = sw.laps.map((item, index) => {
        const n = sw.laps.length - index;
        return `<li><span>Lap ${n}</span><span>${formatMs(item.split, true)}</span><span>${formatMs(item.total, true)}</span></li>`;
      }).join('');
    }
  }

  function paintCountdown(card, cd, now) {
    const left = liveRemaining(cd, now);
    const digital = card.querySelector('.wc-cd-digital');
    const text = formatMs(left, false);
    if (digital && digital.textContent !== text) digital.textContent = text;
    const parts = partsFromMs(left);
    const svg = card.querySelector('.wc-face');
    setHands(svg, parts.h, parts.m, parts.s, parts.ms);
    const durationMs = Math.max(0, cd.duration * 1000);
    setRing(svg, durationMs ? left / durationMs : 0);
    const toggle = card.querySelector('[data-action="cd-toggle"]');
    if (toggle) toggle.textContent = cd.running ? 'Pause' : 'Start';
    const status = card.querySelector('.wc-cd-status');
    const done = !cd.running && cd.alarmed && left <= 0;
    card.classList.toggle('is-done', done);
    card.classList.toggle('is-running', !!cd.running);
    if (status) {
      const label = done ? (cd.repeat ? 'Repeating' : "Time's up") : (cd.repeat && cd.running ? 'Repeats' : '');
      if (status.textContent !== label) status.textContent = label;
    }
    card.querySelectorAll('[data-unit]').forEach((input) => {
      input.disabled = !!cd.running;
    });
  }

  function hydrateBlock(el) {
    if (!el || el.dataset.wcReady === '1') return;
    el.dataset.wcReady = '1';
    const session = sessionFor(`${el.dataset.wcKind || 'clock'}:${el.dataset.wcIndex || '0'}`);
    const clocks = [...el.querySelectorAll('.wc-clock')];
    const alarmCards = [...el.querySelectorAll('.wc-alarm')];
    const swBox = el.querySelector('.wc-stopwatch');
    const cdCards = [...el.querySelectorAll('.wc-cd')];
    cdCards.forEach((card) => {
      ensureCd(session, card.dataset.cdId, Number(card.dataset.seconds) || 0, card.dataset.repeat === '1');
    });
    alarmCards.forEach((card) => ensureAlarm(session, card));

    function paint() {
      const date = new Date();
      const now = root.performance ? root.performance.now() : Date.now();
      clocks.forEach((card) => paintClock(card, date));
      alarmCards.forEach((card) => {
        const alarm = session.alarms[card.dataset.alarmId];
        if (!alarm) return;
        readAlarmTime(card, alarm);
        if (tickAlarm(alarm, date)) beep();
        paintAlarm(card, alarm, date);
      });
      paintStopwatch(swBox, session.sw, now);
      cdCards.forEach((card) => {
        const cd = session.cds[card.dataset.cdId];
        if (tickCountdown(cd, now)) beep();
        paintCountdown(card, cd, now);
      });
    }

    el.addEventListener('click', (event) => {
      const btn = event.target.closest?.('[data-action]');
      if (!btn || !el.contains(btn)) return;
      event.preventDefault();
      unlockAudio();
      const now = root.performance ? root.performance.now() : Date.now();
      const action = btn.dataset.action;
      const sw = session.sw;
      if (action === 'sw-toggle') {
        if (sw.running) {
          sw.base = swElapsed(sw, now);
          sw.running = false;
          sw.started = 0;
        } else {
          sw.started = now;
          sw.running = true;
        }
      } else if (action === 'sw-lap') {
        if (!sw.running) return;
        const total = swElapsed(sw, now);
        const prev = sw.laps.length ? sw.laps[0].total : 0;
        sw.laps.unshift({ total, split: total - prev });
        if (sw.laps.length > MAX_LAPS) sw.laps.length = MAX_LAPS;
      } else if (action === 'sw-reset') {
        sw.running = false;
        sw.base = 0;
        sw.started = 0;
        sw.laps = [];
      } else if (action === 'cd-toggle' || action === 'cd-reset') {
        const card = btn.closest('.wc-cd');
        const cd = card ? session.cds[card.dataset.cdId] : null;
        if (!cd) return;
        if (action === 'cd-reset') {
          if (card.classList.contains('wc-cd--custom')) {
            cd.duration = readCustomSeconds(card);
            card.dataset.seconds = String(cd.duration);
          }
          cd.running = false;
          cd.started = 0;
          cd.remaining = cd.duration * 1000;
          cd.alarmed = false;
        } else if (cd.running) {
          cd.remaining = liveRemaining(cd, now);
          cd.running = false;
          cd.started = 0;
        } else {
          if (card.classList.contains('wc-cd--custom') && (cd.remaining <= 0 || cd.remaining === cd.duration * 1000)) {
            cd.duration = readCustomSeconds(card);
            card.dataset.seconds = String(cd.duration);
            if (cd.remaining <= 0 || cd.alarmed) cd.remaining = cd.duration * 1000;
          }
          if (cd.remaining <= 0) cd.remaining = cd.duration * 1000;
          if (cd.remaining <= 0) return;
          cd.alarmed = false;
          cd.started = now;
          cd.running = true;
        }
      } else if (action === 'alarm-toggle' || action === 'alarm-face' || action === 'alarm-dismiss') {
        const card = btn.closest('.wc-alarm');
        const alarm = card ? session.alarms[card.dataset.alarmId] : null;
        if (!alarm) return;
        readAlarmTime(card, alarm);
        if (action === 'alarm-toggle') {
          alarm.on = !alarm.on;
          if (!alarm.on) alarm.ringing = false;
        } else if (action === 'alarm-face') {
          alarm.face = btn.dataset.face === 'digital' ? 'digital' : 'analog';
        } else {
          alarm.ringing = false;
        }
      }
      paint();
    });

    alarmCards.forEach((card) => {
      card.querySelectorAll('[data-alarm-unit]').forEach((input) => {
        input.addEventListener('input', () => {
          const alarm = session.alarms[card.dataset.alarmId];
          if (!alarm) return;
          readAlarmTime(card, alarm);
          paint();
        });
      });
    });

    const custom = el.querySelector('.wc-cd--custom');
    custom?.querySelectorAll('[data-unit]').forEach((input) => {
      input.addEventListener('input', () => {
        const cd = session.cds.custom;
        if (!cd || cd.running) return;
        const seconds = readCustomSeconds(custom);
        cd.duration = seconds;
        cd.remaining = seconds * 1000;
        cd.alarmed = false;
        custom.dataset.seconds = String(seconds);
        paint();
      });
    });

    paint();
    const timer = setInterval(() => {
      if (!el.isConnected) {
        clearInterval(timer);
        return;
      }
      paint();
    }, 100);
  }

  return {
    parseFenceAttrs,
    parseContent,
    parseDuration,
    describeZone,
    renderBlock,
    hydrateBlock,
  };
}));

if (typeof module !== 'undefined' && require.main === module) {
  const api = module.exports;
  const spec = api.parseContent([
    'Local | local | both',
    'Tokyo | analog',
    'New York | America/New_York | digital',
    '# Countdown',
    'Pomodoro | 25:00',
    'Tea | 3m | repeat',
  ].join('\n'), { title: 'Desk', col: 'info' });
  if (spec.clocks.length !== 3) throw new Error('clock count');
  if (spec.clocks[1].zone !== 'Asia/Tokyo' || spec.clocks[1].face !== 'analog') throw new Error('tokyo');
  if (spec.clocks[2].face !== 'digital') throw new Error('digital face');
  if (spec.countdowns.length || spec.alarms.length) throw new Error('clock fence ignores other sections');
  const countdownSpec = api.parseContent([
    'Pomodoro | 25:00',
    'Tea | 3m | repeat',
  ].join('\n'), {}, 'countdown');
  if (countdownSpec.countdowns[0].seconds !== 1500) throw new Error('pomodoro');
  if (countdownSpec.countdowns[1].seconds !== 180 || !countdownSpec.countdowns[1].repeat) throw new Error('tea');
  if (countdownSpec.clocks.length || countdownSpec.alarms.length) throw new Error('countdown fence is timers only');
  if (api.parseDuration('1:30:00') !== 5400) throw new Error('hms');
  if (api.parseDuration('90s') !== 90) throw new Error('seconds');
  const html = api.renderBlock(
    'London | Europe/London | digital',
    'title=Travel;col=success',
  );
  if (!html.includes('worldclock-block--success')) throw new Error('theme');
  if (html.includes('wc-stopwatch') || html.includes('wc-cds') || html.includes('wc-alarms')) throw new Error('clock fence is clocks only');
  const card = html.split('wc-clock--digital')[1].split('</article>')[0];
  if (card.includes('<svg')) throw new Error('digital card should not include a face');
  const analog = api.renderBlock('London | Europe/London | analog', '');
  if (!analog.includes('wc-face')) throw new Error('analog face');
  const countdownHtml = api.renderBlock('Nap | 20:00', 'title=Nap;col=info', { kind: 'countdown' });
  if (!countdownHtml.includes('countdowntimer-block--info') || !countdownHtml.includes('wc-stopwatch') || !countdownHtml.includes('wc-cds')) throw new Error('countdown sections');
  if (!countdownHtml.includes('data-seconds="1200"') || !countdownHtml.includes('Nap')) throw new Error('nap');
  if (!countdownHtml.split('wc-stopwatch')[1].includes('wc-face')) throw new Error('timer face');
  const empty = api.parseContent('', {});
  if (empty.clocks.length < 4 || empty.countdowns.length || empty.alarms.length) throw new Error('defaults');
  const emptyAlarm = api.parseContent('', {}, 'alarm');
  if (emptyAlarm.alarms.length !== 1 || emptyAlarm.alarms[0].on || emptyAlarm.alarms[0].face !== 'analog') throw new Error('default alarm');
  const emptyCountdown = api.parseContent('', {}, 'countdown');
  if (emptyCountdown.countdowns.length < 3) throw new Error('default countdowns');
  const alarmHtml = api.renderBlock('Wake | 07:30 | on | digital', 'col=warning', { kind: 'alarm' });
  if (!alarmHtml.includes('alarm-block--warning') || !alarmHtml.includes('data-action="alarm-toggle"') || !alarmHtml.includes('wc-alarms')) throw new Error('alarm ui');
  if (alarmHtml.includes('wc-clocks') || alarmHtml.includes('wc-cds')) throw new Error('alarm fence is alarms only');
  const cet = api.parseContent('cet | both', {}).clocks[0];
  if (cet.zone !== 'Europe/Berlin' || cet.kind !== 'cet' || cet.label !== 'CET' || !cet.autoName) throw new Error(`cet ${JSON.stringify(cet)}`);
  const cestToken = api.parseContent('CEST | digital', {}).clocks[0];
  if (cestToken.zone !== 'Europe/Berlin' || cestToken.kind !== 'cet') throw new Error('cest token');
  const berlin = api.parseContent('Berlin | CET | analog', {}).clocks[0];
  if (berlin.zone !== 'Europe/Berlin' || berlin.label !== 'Berlin' || berlin.autoName) throw new Error('berlin cet');
  const oesz = api.parseContent('oesz | analog', {}).clocks[0];
  if (oesz.zone !== 'offset:+180' || oesz.kind !== 'oesz' || oesz.label !== 'OESZ') throw new Error(`oesz ${JSON.stringify(oesz)}`);
  const cityOesz = api.parseContent('Helsinki | OESZ | digital', {}).clocks[0];
  if (cityOesz.label !== 'OESZ' || cityOesz.zone !== 'offset:+180') throw new Error('oesz label');
  const summer = new Date(Date.UTC(2026, 9, 17, 12, 0, 0));
  const cetSummer = api.describeZone('Europe/Berlin', summer, 'cet');
  if (cetSummer.offset !== 120 || cetSummer.label !== 'CEST' || cetSummer.h !== 14) throw new Error(`cest ${JSON.stringify(cetSummer)}`);
  if (!cetSummer.offsetText.includes('CEST') || !/GMT\+2|UTC\+2/.test(cetSummer.offsetText)) throw new Error(`cest text ${cetSummer.offsetText}`);
  const oeszNow = api.describeZone('offset:+180', summer, 'oesz');
  if (oeszNow.offset !== 180 || oeszNow.h !== 15 || oeszNow.label !== 'OESZ') throw new Error(`oesz wall ${JSON.stringify(oeszNow)}`);
  if (!oeszNow.offsetText.includes('GMT+3') || !oeszNow.offsetText.includes('OESZ')) throw new Error(`oesz text ${oeszNow.offsetText}`);
  const winter = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const cetWinter = api.describeZone('Europe/Berlin', winter, 'cet');
  if (cetWinter.offset !== 60 || cetWinter.label !== 'CET' || cetWinter.h !== 13) throw new Error(`cet winter ${JSON.stringify(cetWinter)}`);
  const alarm = api.parseContent('Wake | 07:30 | on | digital', {}, 'alarm').alarms[0];
  if (!alarm || alarm.h !== 7 || alarm.m !== 30 || !alarm.on || alarm.face !== 'digital') throw new Error(`alarm ${JSON.stringify(alarm)}`);
  console.log('worldclock self-test ok');
}
