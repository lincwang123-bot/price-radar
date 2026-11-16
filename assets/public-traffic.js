(() => {
  'use strict';
  const root = document.documentElement;
  if (root.hasAttribute('data-traffic-flip-ready')) return;
  root.setAttribute('data-traffic-flip-ready', '');
  if (typeof matchMedia !== 'function' || typeof IntersectionObserver !== 'function') return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return;
  const counters = [...document.querySelectorAll('[data-traffic-flip]')];
  const pending = new Set(counters);
  if (!pending.size) return;
  const replay = document.querySelector('[data-traffic-replay]');
  const timers = new Map();
  let disposed = false;
  const removeMotionListener = () => {
    if (typeof motion.removeEventListener === 'function') motion.removeEventListener('change', onMotionChange);
    else if (typeof motion.removeListener === 'function') motion.removeListener(onMotionChange);
  };
  const updateReplay = () => {
    if (!replay) return;
    replay.hidden = disposed || motion.matches;
    replay.disabled = disposed || motion.matches || timers.size > 0;
  };
  const stopAnimation = () => {
    observer.disconnect();
    pending.clear();
    for (const [counter, timer] of timers) {
      clearTimeout(timer);
      counter.classList.remove('is-flipping');
    }
    timers.clear();
    updateReplay();
  };
  const animate = counter => {
    counter.classList.add('is-flipping');
    timers.set(counter, setTimeout(() => {
      counter.classList.remove('is-flipping');
      timers.delete(counter);
      if (!pending.size && !timers.size) observer.disconnect();
      updateReplay();
    }, 1200));
    updateReplay();
  };
  function onReplay() {
    if (disposed || motion.matches || timers.size) return;
    pending.clear();
    observer.disconnect();
    for (const counter of counters) animate(counter);
  }
  function dispose() {
    disposed = true;
    stopAnimation();
    removeMotionListener();
    if (replay) replay.removeEventListener('click', onReplay);
    removeEventListener('pagehide', dispose);
  }
  function onMotionChange(event) {
    if (event.matches) stopAnimation();
    updateReplay();
  }
  const observer = new IntersectionObserver(entries => {
    if (disposed) return;
    if (motion.matches) { stopAnimation(); return; }
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35 || !pending.has(entry.target)) continue;
      const counter = entry.target;
      pending.delete(counter);
      observer.unobserve(counter);
      animate(counter);
    }
  }, {threshold: 0.35});
  if (typeof motion.addEventListener === 'function') motion.addEventListener('change', onMotionChange);
  else if (typeof motion.addListener === 'function') motion.addListener(onMotionChange);
  if (replay) replay.addEventListener('click', onReplay);
  addEventListener('pagehide', dispose, {once: true});
  updateReplay();
  for (const counter of pending) observer.observe(counter);
})();
