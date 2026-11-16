(() => {
  for (const panel of document.querySelectorAll('[data-quote-history]')) {
    const target = panel.querySelector('[data-history-chart]');
    const caption = panel.querySelector('[data-history-caption]');
    const url = new URL(panel.dataset.quoteHistory, location.href);
    if (!target || url.origin !== location.origin || url.pathname !== '/api/quote-history') continue;
    let stopped = false, timer, controller, attempts = 0;
    const stop = () => { stopped = true; clearTimeout(timer); controller?.abort(); };
    addEventListener('pagehide', stop, { once: true });
    const finish = () => { stop(); removeEventListener('pagehide', stop); };
    const poll = async () => {
      if (stopped || !panel.isConnected) return finish();
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      attempts++;
      try {
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (stopped) return;
        if (response.status === 200 && result.status === 'ready' && typeof result.html === 'string') {
          // Only the same-origin endpoint's escaped chart markup is inserted.
          target.innerHTML = result.html;
          if (caption) caption.textContent = '最近 ' + result.count + ' 次记录 · 不含结算手续费';
          panel.removeAttribute('data-quote-history');
          return finish();
        }
        if ([400, 404, 405].includes(response.status)) attempts = 15;
      } catch { /* A transient fetch failure does not affect current quotes. */ }
      finally { clearTimeout(deadline); }
      if (stopped) return;
      if (attempts >= 15) {
        target.textContent = '历史走势暂时不可用，请稍后刷新重试。当前报价仍可正常查看。';
        return finish();
      }
      timer = setTimeout(poll, Math.min(5000, 1000 + attempts * 250));
    };
    timer = setTimeout(poll, 1000);
  }
})();

