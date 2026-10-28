/* Menuza motion layer: native Web Animations API + scroll-linked 3D accents.
   The food configurator already owns the project's WebGL scene; this layer avoids a second renderer. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 760px)').matches;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const animate = (element, keyframes, options = {}) => {
    if (!element?.animate) return null;
    try { return element.animate(keyframes, { fill: 'both', ...options }); } catch { return null; }
  };

  function addScrollProgress() {
    const bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:fixed;z-index:1000;top:0;left:0;width:100%;height:3px;pointer-events:none;transform:scaleX(0);transform-origin:left center;background:linear-gradient(90deg,#5b3be0,#c9b6ff 58%,#e3a15b);box-shadow:0 1px 10px #7965d833';
    document.body.appendChild(bar);
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      bar.style.transform = 'scaleX(' + clamp(scrollY / max, 0, 1) + ')';
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    update();
  }

  function initEntranceAndGestures() {
    if (reduced) return;
    document.querySelectorAll('.hero-steps li').forEach((el, index) => {
      animate(el, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 560, delay: index * 75, easing: 'cubic-bezier(.16,1,.3,1)' });
    });
    const stamp = document.querySelector('.hero-stamp');
    if (stamp && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        animate(stamp, [{ opacity: .55, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 460, easing: 'ease-out' });
        observer.disconnect();
      }), { threshold: .2 });
      observer.observe(stamp);
    }
    document.addEventListener('pointerover', event => {
      const el = event.target.closest('.button,.cart-button,.favorite-toggle,.add-button');
      if (el && !el.contains(event.relatedTarget)) animate(el, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.07)' }], { duration: 160, easing: 'ease-out' });
    }, { passive: true });
    document.addEventListener('pointerout', event => {
      const el = event.target.closest('.button,.cart-button,.favorite-toggle,.add-button');
      if (el && !el.contains(event.relatedTarget)) animate(el, [{ filter: 'brightness(1.07)' }, { filter: 'brightness(1)' }], { duration: 180, easing: 'ease-out' });
    }, { passive: true });

    const categoryList = document.getElementById('categoryList');
    if (categoryList && 'MutationObserver' in window) {
      let previous = '';
      const observer = new MutationObserver(() => {
        const chips = [...categoryList.querySelectorAll('.category-chip')];
        const signature = chips.map(chip => chip.textContent).join('|');
        if (!chips.length || signature === previous) return;
        previous = signature;
        chips.forEach((chip, index) => animate(chip, [{ opacity: .72, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, delay: index * 28, easing: 'cubic-bezier(.16,1,.3,1)' }));
      });
      observer.observe(categoryList, { childList: true });
    }
  }

  function initHeroDepth() {
    if (reduced || mobile) return;
    const host = document.querySelector('.hero-art-wrap');
    if (!host) return;
    const colors = [
      ['#d9ceff', '#7965d8'], ['#ffe4bd', '#e3a15b'], ['#e2edce', '#6d8d58'],
      ['#ffd8d0', '#d77b66'], ['#e5ddff', '#9b86e8'], ['#f5e5cd', '#b78d5b']
    ];
    const points = [[8,25,12],[88,22,15],[6,68,10],[91,70,12],[19,86,8],[78,88,9]];
    const animations = [];
    points.forEach((point, index) => {
      const orb = document.createElement('span');
      orb.setAttribute('aria-hidden', 'true');
      orb.style.cssText = 'position:absolute;z-index:3;left:'+point[0]+'%;top:'+point[1]+'%;width:'+point[2]+'px;height:'+point[2]+'px;border-radius:50%;pointer-events:none;background:radial-gradient(circle at 30% 25%,'+colors[index][0]+','+colors[index][1]+' 72%);box-shadow:inset -2px -3px 5px #211a3525,0 8px 18px #211a3515;transform:translate3d(0,0,0);';
      host.appendChild(orb);
      const animation = animate(orb, [
        { transform: 'translate3d(0,0,0) rotateX(0deg) rotateY(0deg)' },
        { transform: 'translate3d('+(index%2?'-7px':'8px')+','+(index%3?'-11px':'10px')+',18px) rotateX(22deg) rotateY(-25deg)' },
        { transform: 'translate3d(0,0,0) rotateX(0deg) rotateY(0deg)' }
      ], { duration: 4800 + index * 370, iterations: Infinity, easing: 'ease-in-out', delay: index * -260 });
      if (animation) animations.push(animation);
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries[0]?.isIntersecting) animations.forEach(animation => animation.play());
        else animations.forEach(animation => animation.pause());
      }, { threshold: .01 });
      observer.observe(host);
    }
  }

  function initScrollScrub() {
    const section = document.getElementById('sobre');
    const circle = section?.querySelector('.craft-circle');
    const note = section?.querySelector('.craft-copy-card');
    if (!section || (!circle && !note)) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const progress = clamp((innerHeight - rect.top) / (innerHeight + rect.height), 0, 1);
      if (circle) circle.style.transform = 'rotate(' + (reduced ? 0 : progress * 28) + 'deg)';
      if (note) note.style.transform = 'translateY(' + (reduced ? 0 : (1 - progress) * 12) + 'px) rotate(' + (reduced ? -5 : -9 + progress * 4) + 'deg)';
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    update();
  }

  addScrollProgress();
  initEntranceAndGestures();
  initHeroDepth();
  initScrollScrub();
})();
