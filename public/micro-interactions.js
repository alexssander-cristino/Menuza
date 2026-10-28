/* Lightweight pointer spotlight for product cards; no dependency or layout mutation. */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduceMotion || !finePointer) return;
  document.addEventListener('pointermove', event => {
    const card = event.target.closest('.product-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--pointer-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
    card.style.setProperty('--pointer-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
  }, { passive: true });
})();
