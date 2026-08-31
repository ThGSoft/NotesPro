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

  const BLOCK_SELECTOR = '.sudoku-block, .puzzle-block, .pinball-block, .gallery-block, .rollercoast-block, .scooter-block, .ghosttrain-block';
  const bound = new WeakSet();
  let globalListener = false;

  function getFullscreenElement() {
    return document.fullscreenElement
      || document.webkitFullscreenElement
      || document.msFullscreenElement
      || null;
  }

  function requestFs(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return Promise.reject(new Error('Fullscreen not supported'));
    return Promise.resolve(fn.call(el));
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

  function syncButton(el) {
    const btn = el.querySelector('.game-fullscreen-btn');
    if (!btn) return;
    const active = getFullscreenElement() === el;
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
  }

  function toggle(el) {
    if (getFullscreenElement() === el) return exitFs();
    return requestFs(el);
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
