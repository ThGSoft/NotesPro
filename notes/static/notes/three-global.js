/**
 * Load Three.js as an ES module and expose a global for IIFE game engines.
 * Dispatches `notespro-three-ready` so hydrators can wait if they race the module.
 */
try {
  const THREE = await import('three');
  window.THREE = THREE;
} catch (err) {
  console.error('NotesPro: failed to load Three.js', err);
} finally {
  window.dispatchEvent(new Event('notespro-three-ready'));
}
