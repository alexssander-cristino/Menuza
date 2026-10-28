/* Menuza scroll experience: accessible anchors, dynamic reveal, and back-to-top. */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = () => document.querySelector('.site-header');
  const scrollTopButton = document.createElement('button');
  scrollTopButton.type = 'button';
  scrollTopButton.className = 'mz-back-to-top';
  scrollTopButton.setAttribute('aria-label', 'Voltar ao topo');
  scrollTopButton.setAttribute('title', 'Voltar ao topo');
  scrollTopButton.innerHTML = '<span aria-hidden="true">↑</span>';
  document.body.appendChild(scrollTopButton);
  const goTop = () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  scrollTopButton.addEventListener('click', goTop);

  const scrollToTarget = target => {
    if (!target) return;
    const stickyHeader = header();
    const offset = stickyHeader ? stickyHeader.getBoundingClientRect().height + 14 : 14;
    window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link) {
      const hash = link.getAttribute('href');
      if (!hash || hash === '#') { event.preventDefault(); goTop(); return; }
      let target;
      try { target = document.querySelector(hash); } catch { return; }
      if (target) {
        event.preventDefault();
        if (location.hash !== hash) history.pushState(null, '', hash);
        scrollToTarget(target);
      }
      return;
    }
    const control = event.target.closest('[data-scroll]');
    if (control) {
      let target;
      try { target = document.querySelector(control.getAttribute('data-scroll')); } catch { return; }
      if (target) { event.preventDefault(); scrollToTarget(target); }
    }
  });

  let buttonFrame = 0;
  const updateButton = () => {
    buttonFrame = 0;
    scrollTopButton.classList.toggle('is-visible', window.scrollY > Math.max(420, window.innerHeight * .65));
  };
  window.addEventListener('scroll', () => {
    if (buttonFrame) return;
    buttonFrame = requestAnimationFrame(updateButton);
  }, { passive: true });
  window.addEventListener('resize', updateButton, { passive: true });
  updateButton();

  const revealSelector = [
    '.hero-copy', '.hero-art-wrap', '.ticker', '.section-heading', '.featured-grid .product-card',
    '.menu-heading', '.menu-grid .product-card', '.recent-products-section', '.recent-products-grid .product-card', '.craft-art', '.craft-text', '.site-footer',
    '#trackingView > *', '#adminView > *', '#builderRoot > *', '#cartRoot > *', '#checkoutRoot > *'
  ].join(',');
  const pending = new Set();
  let observer = null;
  const reveal = element => {
    if (!(element instanceof Element) || element.matches('.mz-back-to-top,.mz-scroll-progress')) return;
    if (element.matches(revealSelector)) pending.add(element);
    element.querySelectorAll?.(revealSelector).forEach(child => pending.add(child));
    pending.forEach(item => {
      if (item.dataset.mzRevealBound) { pending.delete(item); return; }
      item.dataset.mzRevealBound = 'true';
      if (observer) observer.observe(item);
      else item.classList.add('mz-scroll-visible');
      item.classList.add('mz-scroll-reveal');
      pending.delete(item);
    });
  };
  if (!reduceMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('mz-scroll-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08, rootMargin: '0px 0px -3% 0px' });
  }
  const scan = scope => {
    if (scope instanceof Element) reveal(scope);
    scope.querySelectorAll?.(revealSelector).forEach(reveal);
  };
  scan(document);
  if ('MutationObserver' in window) {
    const mutationObserver = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) scan(node);
    })));
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
