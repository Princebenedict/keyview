// Custom cursor: follows the pointer with a 0.2 lerp, grows 2.5x over links and buttons.
(() => {
  if (matchMedia('(hover: none)').matches) return; // touch devices keep their normal pointer
  const c = document.getElementById('cursor');
  if (!c) return;
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, big = false, seen = false;
  addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (!seen) { seen = true; x = tx; y = ty; c.classList.add('on'); }
    big = !!(e.target.closest && e.target.closest('a, button, summary, [role="button"]'));
  }, { passive: true });
  document.addEventListener('pointerleave', () => c.classList.remove('on'));
  document.addEventListener('pointerenter', () => { if (seen) c.classList.add('on'); });
  let s = 1;
  const loop = () => {
    x += (tx - x) * 0.2; y += (ty - y) * 0.2;
    s += ((big ? 2.5 : 1) - s) * 0.2;
    c.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    requestAnimationFrame(loop);
  };
  loop();
})();
