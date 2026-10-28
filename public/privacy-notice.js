(function () {
  const notice = document.getElementById('privacyNotice');
  if (!notice) return;
  const key = 'menuza-privacy-notice-dismissed-v1';
  const show = () => { notice.hidden = false; };
  const hide = () => {
    notice.hidden = true;
    try { localStorage.setItem(key, '1'); } catch {}
  };
  try { if (localStorage.getItem(key) !== '1') show(); } catch { show(); }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-privacy-dismiss]')) hide();
    if (event.target.closest('[data-privacy-open]')) { event.preventDefault(); show(); }
  });
})();