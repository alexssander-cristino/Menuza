/* Converte glifos usados como ícones em SVGs Lucide e aplica microanimações.
   Mantém o Menuza sem React/Motion, pois o frontend público é JavaScript nativo. */
(() => {
  const paths = {
    '×':'<path d="m18 6-12 12M6 6l12 12"/>',
    '✕':'<path d="m18 6-12 12M6 6l12 12"/>',
    '↗':'<path d="M7 17 17 7M7 7h10v10"/>',
    '＋':'<path d="M12 5v14M5 12h14"/>',
    '+':'<path d="M12 5v14M5 12h14"/>',
    '−':'<path d="M5 12h14"/>',
    '◷':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    '♡':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l7.8-7.5a5.5 5.5 0 0 0 1-7.9Z"/>',
    '♥':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l7.8-7.5a5.5 5.5 0 0 0 1-7.9Z"/>',
    '✳':'<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
    '✦':'<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/>',
    '▦':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    '⌑':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    '◈':'<path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2-3Z"/><circle cx="12" cy="13" r="3"/>',
    '◌':'<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
    '◉':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    '☰':'<path d="M4 6h16M4 12h16M4 18h16"/>',
    '⌕':'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    '↶':'<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 2.6-6.4L3 9"/>',
    '↷':'<path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-2.6-6.4L21 9"/>',
    '↑':'<path d="M12 19V5M5 12l7-7 7 7"/>',
    '←':'<path d="M19 12H5M12 19l-7-7 7-7"/>',
    '→':'<path d="M5 12h14M12 5l7 7-7 7"/>',
    '✓':'<path d="m5 12 4 4L19 6"/>',
    '●':'<circle cx="12" cy="12" r="5"/>'
  };
  const convert = root => {
    if (!root || root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (paths[node.nodeValue.trim()] && node.parentElement && !node.parentElement.closest('svg,script,style,textarea,input,option,code,pre')) nodes.push(node);
    }
    nodes.forEach(node => {
      const glyph = node.nodeValue.trim();
      const span = document.createElement('span');
      span.className = 'ui-icon ui-icon--animated-glyph';
      span.setAttribute('aria-hidden','true');
      span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">'+paths[glyph]+'</svg>';
      node.replaceWith(span);
    });
  };
  const start = () => {
    convert(document.body);
    const observer = new MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === 1) convert(node);
        else if (node.nodeType === 3 && paths[node.nodeValue.trim()] && node.parentElement) convert(node.parentElement);
      });
    }));
    observer.observe(document.body,{childList:true,subtree:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();

/* Anima o ícone do carrinho também ao tocar/clicar, não apenas no hover. */
(() => {
  const animateCart = button => {
    const icon = button?.querySelector('.cart-icon svg');
    if (!icon || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    button.classList.remove('is-cart-animating');
    void icon.getBoundingClientRect();
    button.classList.add('is-cart-animating');
    icon.addEventListener('animationend', () => button.classList.remove('is-cart-animating'), {once:true});
  };
  document.addEventListener('pointerenter', event => {
    const button = event.target.closest?.('.cart-button');
    if (button) animateCart(button);
  }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest?.('.cart-button');
    if (button) animateCart(button);
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest?.('.cart-button');
    if (button) animateCart(button);
  });
})();


/* Reproduz as microanimações dos ícones ao toque/clique, inclusive em telas touch. */
(() => {
  const replay = (element, selector) => {
    const icon = element?.querySelector(selector);
    if (!icon || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    icon.style.animation = 'none';
    void icon.getBoundingClientRect();
    icon.style.animation = '';
  };
  document.addEventListener('pointerenter', event => {
    const favorite = event.target.closest?.('.favorite-toggle');
    const share = event.target.closest?.('.share-product-button,.share-menu-button');
    if (favorite) replay(favorite, '.favorite-heart-icon svg');
    if (share) replay(share, 'svg.share-icon-svg');
  }, true);
  document.addEventListener('click', event => {
    const share = event.target.closest?.('.share-product-button,.share-menu-button');
    if (share) replay(share, 'svg.share-icon-svg');
  });
})();
