/**
 * Workspace high scores for arcade blocks (Pac-Man, Tetris, Lemmings, Mario).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProHighscores = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GAMES = ['pacman', 'tetris', 'lemmings', 'mario'];
  const listeners = [];
  let cache = { me: {}, boards: {} };

  function boot() {
    return (typeof window !== 'undefined' && window.APP_BOOT) ? window.APP_BOOT : {};
  }

  function username() {
    return String(boot().username || '').trim();
  }

  function workspaceId() {
    const id = boot().workspaceId;
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function appBase() {
    if (typeof window === 'undefined') return '';
    return String(window.APP_BASE || '').replace(/\/$/, '');
  }

  function apiUrl(path) {
    const rel = String(path || '').replace(/^\/+/, '');
    const base = appBase();
    return (base ? `${base}/` : '/') + rel;
  }

  function csrfToken() {
    if (typeof document === 'undefined') return '';
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function cloneCache(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      me: src.me && typeof src.me === 'object' ? { ...src.me } : {},
      boards: src.boards && typeof src.boards === 'object' ? { ...src.boards } : {},
    };
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(cache); } catch (_) { /* ignore */ }
    });
  }

  function applyPayload(payload) {
    if (!payload || typeof payload !== 'object') return cache;
    cache = cloneCache(payload);
    const b = boot();
    if (b) b.gameHighscores = cache;
    emit();
    return cache;
  }

  function loadFromBoot() {
    applyPayload(boot().gameHighscores);
  }

  function normalizeGame(game) {
    const key = String(game || '').trim().toLowerCase();
    return GAMES.includes(key) ? key : '';
  }

  function board(game) {
    const key = normalizeGame(game);
    const list = key ? cache.boards[key] : null;
    return Array.isArray(list) ? list : [];
  }

  function mine(game) {
    const key = normalizeGame(game);
    return key ? (cache.me[key] || null) : null;
  }

  function best(game, currentScore) {
    const rows = board(game);
    const personal = mine(game);
    let top = rows[0] || personal || null;
    const current = Math.max(0, Math.floor(Number(currentScore) || 0));
    if (current > (top?.score || 0)) {
      return {
        score: current,
        user: username() || 'you',
        live: true,
      };
    }
    if (!top) return { score: 0, user: username() || '', live: false };
    return { score: top.score, user: top.user || '', live: false };
  }

  function padScore(score, width) {
    const n = Math.max(0, Math.floor(Number(score) || 0));
    return String(n).padStart(width || 6, '0');
  }

  function hudLine(game, currentScore) {
    const entry = best(game, currentScore);
    if (!entry || !entry.score) {
      const me = username();
      return me ? `HI 000000 ${me}` : 'HI 000000';
    }
    const who = entry.user ? ` ${entry.user}` : '';
    return `HI ${padScore(entry.score)}${who}`;
  }

  function statusSuffix(game, currentScore) {
    const entry = best(game, currentScore);
    if (!entry || !entry.score) return '';
    const who = entry.user ? ` ${entry.user}` : '';
    return ` · HI ${entry.score}${who}`;
  }

  function isNewRecord(game, score) {
    const rows = board(game);
    const personal = mine(game);
    const top = Math.max(rows[0]?.score || 0, personal?.score || 0);
    return Math.max(0, Math.floor(Number(score) || 0)) > top;
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function reload(wsId) {
    const id = Number(wsId || workspaceId());
    if (!id) return cache;
    try {
      const data = await fetchJson(apiUrl(`api/workspaces/${id}/game-highscores/`), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      return applyPayload(data);
    } catch (_) {
      return cache;
    }
  }

  async function submit(game, score, extra) {
    const key = normalizeGame(game);
    const id = workspaceId();
    const value = Math.max(0, Math.floor(Number(score) || 0));
    if (!key || !id || value <= 0) return { improved: false };
    const personal = mine(key);
    if (personal && value <= personal.score) {
      return { improved: false, mine: personal };
    }
    const user = username();
    const optimistic = {
      game: key,
      score: value,
      user,
      user_id: boot().userId || null,
      at: new Date().toISOString(),
      extra: extra && typeof extra === 'object' ? extra : {},
    };
    cache.me[key] = optimistic;
    const rows = board(key).filter((row) => row.user !== user);
    rows.push(optimistic);
    rows.sort((a, b) => b.score - a.score);
    cache.boards[key] = rows.slice(0, 10);
    emit();
    try {
      const data = await fetchJson(apiUrl(`api/workspaces/${id}/game-highscores/`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRFToken': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ game: key, score: value, extra: extra || {} }),
      });
      applyPayload(data);
      return data;
    } catch (_) {
      return { improved: !personal || value > personal.score, mine: optimistic };
    }
  }

  function drawBoard(ctx, opts) {
    if (!ctx) return 0;
    const game = opts?.game;
    const x = opts?.x ?? 0;
    const y = opts?.y ?? 0;
    const current = opts?.currentScore ?? 0;
    const maxRows = Math.min(5, opts?.maxRows ?? 5);
    const color = opts?.color || '#d6e4ff';
    const title = opts?.title || 'HIGH SCORES';
    const rows = board(game).slice();
    const user = username();
    if (current > 0 && (!rows[0] || current > rows[0].score || !rows.some((r) => r.user === user && r.score >= current))) {
      rows.unshift({ score: current, user: user || 'you', live: true });
      rows.sort((a, b) => b.score - a.score);
    }
    const unique = [];
    const seen = new Set();
    rows.forEach((row) => {
      const who = row.user || '';
      if (seen.has(who)) return;
      seen.add(who);
      unique.push(row);
    });
    const list = unique.slice(0, maxRows);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = opts?.titleFont || 'bold 11px ui-monospace, Consolas, sans-serif';
    ctx.fillText(title, x, y);
    list.forEach((row, i) => {
      ctx.fillStyle = row.live ? '#ffe500' : color;
      ctx.font = opts?.rowFont || '10px ui-monospace, Consolas, sans-serif';
      const who = String(row.user || '').slice(0, 12);
      ctx.fillText(`${i + 1}. ${who}  ${padScore(row.score)}`, x, y + 16 + i * 14);
    });
    return 16 + list.length * 14;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadFromBoot, { once: true });
    } else {
      loadFromBoot();
    }
  }

  return {
    GAMES,
    loadFromBoot,
    reload,
    submit,
    board,
    mine,
    best,
    hudLine,
    statusSuffix,
    isNewRecord,
    padScore,
    drawBoard,
    onChange,
  };
}));
