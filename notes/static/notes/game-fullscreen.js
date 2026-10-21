/**
 * Native monitor fullscreen toggle for game blocks (sudoku, puzzle, pinball).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProGameFullscreen = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BLOCK_SELECTOR = '.infoboard-block, .mathcad-block, .sudoku-block, .puzzle-block, .pinball-block, .pacman-block, .mario-block, .lemmings-block, .tictactoe-block, .chess-block, .connect4-block, .reversi-block, .muhle-block, .backgammon-block, .tetris-block, .sokoban-block, .invaders-block, .breakout-block, .carambole-block, .carrom-block, .dart-block, .draw-block, .drawio-block, .snake-block, .marbleblast-block, .gallery-block, .training-block, .photocube-block, .photobook-block, .carousel-block, .rollercoast-block, .scooter-block, .ghosttrain-block, .labyrinth-block, .jukebox-block, .hp15c-block, .hp12c-block, .hp42s-block, .ti30-block';
  const bound = new WeakSet();
  let globalListener = false;
  let pseudoEl = null;
  let lockedScrollY = 0;

  function getFullscreenElement() {
    return document.fullscreenElement
      || document.webkitFullscreenElement
      || document.msFullscreenElement
      || null;
  }

  function requestFs(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return Promise.reject(new Error('Fullscreen not supported'));
    let result;
    try {
      result = fn.call(el);
    } catch (err) {
      return Promise.reject(err);
    }
    if (result && typeof result.then === 'function') return result;
    return new Promise((resolve, reject) => {
      window.requestAnimationFrame(() => {
        if (getFullscreenElement() === el) resolve();
        else reject(new Error('Fullscreen not supported'));
      });
    });
  }

  function exitFs() {
    if (!getFullscreenElement()) return Promise.resolve();
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!fn) return Promise.reject(new Error('Fullscreen not supported'));
    return Promise.resolve(fn.call(document));
  }

  function renderButton() {
    return [
      '<button type="button" class="game-fullscreen-btn" data-action="monitor-fullscreen"',
      ' title="Fullscreen" aria-label="Enter fullscreen" aria-pressed="false">',
      '<i class="fa fa-expand game-fullscreen-btn__icon game-fullscreen-btn__icon--enter" aria-hidden="true"></i>',
      '<i class="fa fa-compress game-fullscreen-btn__icon game-fullscreen-btn__icon--exit" aria-hidden="true"></i>',
      '</button>',
    ].join('');
  }

  function isActive(el) {
    return getFullscreenElement() === el || pseudoEl === el;
  }

  function lockPage() {
    lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('notespro-pseudo-fullscreen');
    document.body.style.top = `-${lockedScrollY}px`;
  }

  function unlockPage() {
    document.documentElement.classList.remove('notespro-pseudo-fullscreen');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }

  function enterPseudo(el) {
    const previous = pseudoEl;
    pseudoEl = el;
    if (previous && previous !== el) syncButton(previous);
    lockPage();
    syncButton(el);
  }

  function leavePseudo(el) {
    if (pseudoEl === el) pseudoEl = null;
    unlockPage();
    syncButton(el);
  }

  function syncButton(el) {
    const btn = el.querySelector('.game-fullscreen-btn');
    if (!btn) return;
    const active = isActive(el);
    el.classList.toggle('game-block--monitor-fullscreen', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    btn.title = active ? 'Exit fullscreen (Esc)' : 'Fullscreen';
    el.dispatchEvent(new CustomEvent('notespro:monitor-fullscreen', {
      bubbles: false,
      detail: { active },
    }));
  }

  function syncAllBlocks() {
    document.querySelectorAll(BLOCK_SELECTOR).forEach(syncButton);
  }

  function ensureGlobalListener() {
    if (globalListener) return;
    globalListener = true;
    ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach((evt) => {
      document.addEventListener(evt, syncAllBlocks);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && pseudoEl) leavePseudo(pseudoEl);
    });
  }

  function toggle(el) {
    if (pseudoEl === el) {
      leavePseudo(el);
      return Promise.resolve();
    }
    if (getFullscreenElement() === el) return exitFs();
    return requestFs(el).catch(() => {
      enterPseudo(el);
    });
  }

  function bind(el) {
    if (!el || bound.has(el)) return;
    const btn = el.querySelector('[data-action="monitor-fullscreen"]');
    if (!btn) return;
    bound.add(el);
    ensureGlobalListener();

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle(el).catch(() => {});
    });

    syncButton(el);
  }

  return {
    renderButton,
    bind,
    toggle,
  };
}));
