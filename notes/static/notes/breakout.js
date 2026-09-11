/**
 * NotesPro ```breakout``` / ```arkanoid``` block — paddle, ball, bricks.
 * Free vanilla JS implementation for NotesPro (no third-party game engine).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProBreakout = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const VW = 480;
  const VH = 560;
  const COLS = 11;
  const ROWS = 8;
  const BRICK_COLORS = ['#f43f5e', '#fb7185', '#fb923c', '#fbbf24', '#4ade80', '#22d3ee', '#60a5fa', '#a78bfa'];

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

  function resolveFullscreen(cfg) {
    const raw = String(cfg.fullscreen ?? cfg.full ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'compact') return false;
    return true;
  }

  function renderFullscreenButton() {
    return window.NotesProGameFullscreen?.renderButton?.() || '';
  }

  function bindFullscreenButton(el) {
    window.NotesProGameFullscreen?.bind?.(el);
  }

  function parentIsMobile() {
    try {
      return document.body.classList.contains('mobile-layout')
        || window.matchMedia('(max-width: 768px)').matches;
    } catch (_) {
      return false;
    }
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const title = String(cfg.title || 'Breakout').trim() || 'Breakout';
    const breakoutIndex = Number.isFinite(options.breakoutIndex) ? options.breakoutIndex : 0;
    const fullscreen = resolveFullscreen(cfg);
    const themeClass = style.theme ? ` breakout-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' breakout-block--custom' : '';
    const fullClass = fullscreen ? ' breakout-block--fullscreen' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--breakout-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--breakout-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const chrome = fullscreen ? '' : [
      `<div class="breakout-block-header">`,
      `<div class="breakout-block-title">${escapeHtml(title)}</div>`,
      `<div class="breakout-block-meta">paddle · bricks · lives</div>`,
      `</div>`,
      `<p class="breakout-block-hint">← → / A D or mouse · Space launch · P pause · R restart</p>`,
    ].join('');
    return [
      `<div class="breakout-block${themeClass}${customClass}${fullClass}"${styleAttr}`
      + ` data-breakout-index="${breakoutIndex}" tabindex="0">`,
      renderFullscreenButton(),
      chrome,
      `<div class="breakout-stage">`,
      `<canvas class="breakout-canvas" width="${VW}" height="${VH}" aria-label="${escapeHtml(title)}"></canvas>`,
      `</div>`,
      `<div class="breakout-pad" aria-label="Breakout controls">`,
      `<button type="button" class="breakout-pad__btn breakout-pad__btn--left" data-act="left" tabindex="-1">◀</button>`,
      `<button type="button" class="breakout-pad__btn breakout-pad__btn--launch" data-act="launch" tabindex="-1">Launch</button>`,
      `<button type="button" class="breakout-pad__btn breakout-pad__btn--right" data-act="right" tabindex="-1">▶</button>`,
      `</div>`,
      `<div class="breakout-status" aria-live="polite">Click to play</div>`,
      `</div>`,
    ].join('');
  }

  function createGame(el) {
    const canvas = el.querySelector('.breakout-canvas');
    const status = el.querySelector('.breakout-status');
    const pad = el.querySelector('.breakout-pad');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const inset = 18;
    const gap = 3;
    const brickW = (VW - inset * 2 - gap * (COLS - 1)) / COLS;
    const brickH = 16;
    const state = {
      paddle: { x: VW / 2 - 40, y: VH - 36, w: 80, h: 12 },
      ball: { x: VW / 2, y: VH - 48, r: 5.5, vx: 0, vy: 0, stuck: true },
      bricks: [],
      score: 0,
      lives: 3,
      wave: 1,
      over: false,
      reported: false,
      paused: false,
      started: false,
      visible: true,
      raf: 0,
      running: true,
      last: 0,
      keys: { left: false, right: false },
      pointerX: null,
    };

    function setStatus(text) {
      if (status) status.textContent = text;
    }

    function reportScore() {
      if (state.reported || state.score <= 0) return;
      state.reported = true;
      const hs = window.NotesProHighscores;
      const improved = hs?.isNewRecord?.('breakout', state.score);
      hs?.submit?.('breakout', state.score, { wave: state.wave, lives: state.lives });
      const suffix = hs?.statusSuffix?.('breakout', state.score) || '';
      setStatus((improved ? 'New high score · ' : '') + `Game over · ${state.score} pts · R restart${suffix}`);
    }

    function paddleWidth() {
      return Math.max(48, 84 - (state.wave - 1) * 6);
    }

    function ballSpeed() {
      return 260 + (state.wave - 1) * 28;
    }

    function spawnBricks() {
      state.bricks = [];
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < COLS; c += 1) {
          const hits = state.wave > 1 && r < 2 ? 2 : 1;
          state.bricks.push({
            x: inset + c * (brickW + gap),
            y: 56 + r * (brickH + gap),
            w: brickW,
            h: brickH,
            row: r,
            hits,
            max: hits,
            alive: true,
            pts: (ROWS - r) * 10,
            color: BRICK_COLORS[r],
          });
        }
      }
    }

    function stickBall() {
      state.ball.stuck = true;
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.ball.x = state.paddle.x + state.paddle.w / 2;
      state.ball.y = state.paddle.y - state.ball.r - 1;
    }

    function launch() {
      if (!state.ball.stuck || state.over || state.paused) return;
      const speed = ballSpeed();
      const dir = state.keys.left ? -0.6 : (state.keys.right ? 0.6 : (Math.random() < 0.5 ? -0.45 : 0.45));
      const mag = Math.hypot(dir, -1);
      state.ball.vx = (dir / mag) * speed;
      state.ball.vy = (-1 / mag) * speed;
      state.ball.stuck = false;
    }

    function restart() {
      state.score = 0;
      state.lives = 3;
      state.wave = 1;
      state.over = false;
      state.reported = false;
      state.paused = false;
      state.started = true;
      state.paddle.w = paddleWidth();
      state.paddle.x = VW / 2 - state.paddle.w / 2;
      spawnBricks();
      stickBall();
      setStatus(`Score ${state.score} · Lives ${state.lives}${window.NotesProHighscores?.statusSuffix?.('breakout', 0) || ''}`);
    }

    function nextWave() {
      state.wave += 1;
      state.score += 200 * state.wave;
      state.paddle.w = paddleWidth();
      spawnBricks();
      stickBall();
    }

    function loseBall() {
      state.lives -= 1;
      if (state.lives <= 0) {
        state.over = true;
        reportScore();
        return;
      }
      stickBall();
    }

    function bouncePaddle() {
      const hit = (state.ball.x - state.paddle.x) / state.paddle.w;
      const angle = (hit - 0.5) * 1.15;
      const speed = Math.max(ballSpeed(), Math.hypot(state.ball.vx, state.ball.vy) * 1.02);
      const vx = Math.sin(angle) * speed;
      const vy = -Math.abs(Math.cos(angle) * speed);
      state.ball.vx = vx;
      state.ball.vy = Math.min(-180, vy);
      state.ball.y = state.paddle.y - state.ball.r - 0.5;
    }

    function collideBrick(brick) {
      const bx = state.ball.x;
      const by = state.ball.y;
      const r = state.ball.r;
      const overlapX = Math.min((bx + r) - brick.x, (brick.x + brick.w) - (bx - r));
      const overlapY = Math.min((by + r) - brick.y, (brick.y + brick.h) - (by - r));
      if (overlapX < overlapY) {
        state.ball.vx *= -1;
        state.ball.x += state.ball.vx > 0 ? overlapX : -overlapX;
      } else {
        state.ball.vy *= -1;
        state.ball.y += state.ball.vy > 0 ? overlapY : -overlapY;
      }
    }

    function draw() {
      const sx = canvas.width / VW;
      const sy = canvas.height / VH;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.fillStyle = '#071018';
      ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = '#122033';
      ctx.fillRect(8, 32, VW - 16, VH - 40);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 32, VW - 16, VH - 40);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE ${String(state.score).padStart(6, '0')}`, 14, 22);
      ctx.textAlign = 'center';
      ctx.fillText(`WAVE ${state.wave}`, VW / 2, 22);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fde047';
      ctx.fillText(window.NotesProHighscores?.hudLine?.('breakout', state.score) || 'HI 000000', VW - 14, 22);

      state.bricks.forEach((b) => {
        if (!b.alive) return;
        ctx.fillStyle = b.color;
        ctx.globalAlpha = b.hits < b.max ? 0.55 : 1;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(b.x, b.y, b.w, 3);
      });

      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(state.paddle.x + 4, state.paddle.y + 2, state.paddle.w - 8, 4);

      ctx.beginPath();
      ctx.fillStyle = '#f8fafc';
      ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(state.ball.x - 1.4, state.ball.y - 1.4, state.ball.r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#64748b';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      for (let i = 0; i < state.lives; i += 1) {
        ctx.beginPath();
        ctx.fillStyle = '#f8fafc';
        ctx.arc(18 + i * 16, VH - 14, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (state.paused && !state.over) {
        ctx.fillStyle = 'rgba(7, 16, 24, 0.55)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', VW / 2, VH / 2);
      }
      if (state.over) {
        ctx.fillStyle = 'rgba(7, 16, 24, 0.62)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', VW / 2, VH / 2 - 48);
        window.NotesProHighscores?.drawBoard?.(ctx, {
          game: 'breakout',
          x: VW / 2,
          y: VH / 2 - 16,
          currentScore: state.score,
          maxRows: 5,
          color: '#e2e8f0',
        });
      }
      if (!state.started) {
        ctx.fillStyle = 'rgba(7, 16, 24, 0.35)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK TO PLAY', VW / 2, VH / 2);
      } else if (state.ball.stuck && !state.over && !state.paused) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SPACE TO LAUNCH', VW / 2, VH - 56);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function tick(now) {
      if (!state.running) return;
      state.raf = requestAnimationFrame(tick);
      if (!state.visible) return;
      const dt = Math.min(40, now - (state.last || now));
      state.last = now;
      if (state.started && !state.paused && !state.over) {
        const speed = 380;
        if (state.pointerX != null) {
          state.paddle.x = state.pointerX - state.paddle.w / 2;
        } else {
          if (state.keys.left) state.paddle.x -= speed * dt / 1000;
          if (state.keys.right) state.paddle.x += speed * dt / 1000;
        }
        state.paddle.x = Math.max(12, Math.min(VW - 12 - state.paddle.w, state.paddle.x));

        if (state.ball.stuck) {
          stickBall();
        } else {
          state.ball.x += state.ball.vx * dt / 1000;
          state.ball.y += state.ball.vy * dt / 1000;
          const left = 12;
          const right = VW - 12;
          const top = 36;
          if (state.ball.x - state.ball.r <= left) {
            state.ball.x = left + state.ball.r;
            state.ball.vx = Math.abs(state.ball.vx);
          } else if (state.ball.x + state.ball.r >= right) {
            state.ball.x = right - state.ball.r;
            state.ball.vx = -Math.abs(state.ball.vx);
          }
          if (state.ball.y - state.ball.r <= top) {
            state.ball.y = top + state.ball.r;
            state.ball.vy = Math.abs(state.ball.vy);
          }
          if (state.ball.y - state.ball.r > state.paddle.y - 2
            && state.ball.y < state.paddle.y + state.paddle.h
            && state.ball.x >= state.paddle.x - 2
            && state.ball.x <= state.paddle.x + state.paddle.w + 2
            && state.ball.vy > 0) {
            bouncePaddle();
          }
          if (state.ball.y - state.ball.r > VH - 8) loseBall();

          for (const brick of state.bricks) {
            if (!brick.alive) continue;
            if (state.ball.x + state.ball.r < brick.x || state.ball.x - state.ball.r > brick.x + brick.w) continue;
            if (state.ball.y + state.ball.r < brick.y || state.ball.y - state.ball.r > brick.y + brick.h) continue;
            collideBrick(brick);
            brick.hits -= 1;
            if (brick.hits <= 0) {
              brick.alive = false;
              state.score += brick.pts;
            }
            break;
          }
          if (state.bricks.every((b) => !b.alive)) nextWave();
        }
        setStatus(`Score ${state.score} · Wave ${state.wave} · Lives ${state.lives}${window.NotesProHighscores?.statusSuffix?.('breakout', state.score) || ''}`);
      }
      draw();
    }

    function fitCanvas() {
      const stage = el.querySelector('.breakout-stage');
      const maxW = Math.max(280, stage?.clientWidth || VW);
      const maxH = Math.max(320, stage?.clientHeight || VH);
      const scale = Math.max(0.55, Math.min(maxW / VW, maxH / VH));
      canvas.width = Math.round(VW * scale);
      canvas.height = Math.round(VH * scale);
    }

    function canvasToWorld(event) {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * VW;
      return x;
    }

    function startIfNeeded() {
      if (!state.started) restart();
    }

    function onKeyDown(event) {
      const tag = String(event.target?.tagName || '');
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      const k = event.key;
      if (k === 'r' || k === 'R') {
        event.preventDefault();
        restart();
        return;
      }
      if (k === 'p' || k === 'P') {
        event.preventDefault();
        startIfNeeded();
        if (!state.over) state.paused = !state.paused;
        setStatus(state.paused ? 'Paused' : `Score ${state.score} · Lives ${state.lives}`);
        return;
      }
      startIfNeeded();
      if (state.over || state.paused) return;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        event.preventDefault();
        state.keys.left = true;
        state.pointerX = null;
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        event.preventDefault();
        state.keys.right = true;
        state.pointerX = null;
      } else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        event.preventDefault();
        launch();
      }
    }

    function onKeyUp(event) {
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') state.keys.left = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') state.keys.right = false;
    }

    function syncPad() {
      if (!pad) return;
      const mobile = parentIsMobile();
      el.classList.toggle('breakout-block--mobile', mobile);
      pad.classList.toggle('is-visible', mobile);
    }

    function bindPad() {
      if (!pad) return;
      pad.querySelectorAll('[data-act]').forEach((btn) => {
        const act = btn.getAttribute('data-act');
        const down = (event) => {
          event.preventDefault();
          el.focus({ preventScroll: true });
          startIfNeeded();
          try { btn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
          if (act === 'left') {
            state.keys.left = true;
            state.pointerX = null;
          } else if (act === 'right') {
            state.keys.right = true;
            state.pointerX = null;
          } else if (act === 'launch') launch();
        };
        const up = (event) => {
          event.preventDefault();
          if (act === 'left') state.keys.left = false;
          if (act === 'right') state.keys.right = false;
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', (event) => event.preventDefault());
      });
    }

    function onPointerDown(event) {
      if (event.target.closest?.('.breakout-pad')) return;
      el.focus({ preventScroll: true });
      if (!state.started || state.over) {
        restart();
        return;
      }
      state.pointerX = canvasToWorld(event);
      launch();
    }

    function onPointerMove(event) {
      if (event.buttons === 0 && event.pointerType === 'mouse' && !state.started) return;
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        if (state.started) state.pointerX = canvasToWorld(event);
        return;
      }
      state.pointerX = canvasToWorld(event);
    }

    function onPointerLeave() {
      /* keep last paddle position */
    }

    fitCanvas();
    syncPad();
    bindPad();
    draw();
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    const onResize = () => {
      fitCanvas();
      syncPad();
      draw();
    };
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver((entries) => {
      state.visible = entries.some((e) => e.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    state.raf = requestAnimationFrame(tick);

    return {
      destroy() {
        state.running = false;
        cancelAnimationFrame(state.raf);
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        window.removeEventListener('resize', onResize);
        io.disconnect();
      },
    };
  }

  function hydrateBlock(el) {
    if (!el) return;
    bindFullscreenButton(el);
    if (el._breakoutGame?.destroy) el._breakoutGame.destroy();
    el._breakoutGame = createGame(el);
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.breakout-block[data-breakout-index]').forEach(hydrateBlock);
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
