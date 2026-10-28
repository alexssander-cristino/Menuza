(() => {
  'use strict';

  const STORAGE_KEY = 'menuza-rate-limit-until';
  const params = new URLSearchParams(window.location.search);
  const parsedWait = Number.parseInt(params.get('wait') || '', 10);
  const requestedWait = Number.isFinite(parsedWait)
    ? Math.max(1, Math.min(3600, parsedWait))
    : 900;

  let until = Date.now() + requestedWait * 1000;

  try {
    const savedUntil = Number.parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (Number.isFinite(savedUntil) && savedUntil > Date.now()) {
      until = Math.max(until, savedUntil);
    }
    localStorage.setItem(STORAGE_KEY, String(until));
  } catch {
    // O cronômetro continua funcionando mesmo sem acesso ao armazenamento local.
  }

  const getRemaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));

  function trapBack() {
    if (getRemaining() > 0) {
      history.pushState({ menuzaBlocked: true }, '', window.location.href);
    }
  }

  function renderCountdown() {
    const countdown = document.getElementById('countdown');
    const message = document.getElementById('message');
    const returnButton = document.getElementById('return');
    if (!countdown || !message || !returnButton) return;

    const seconds = getRemaining();
    countdown.textContent = seconds > 0
      ? String(Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0')
      : 'liberado';

    if (seconds === 0) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // O bloqueio visual pode terminar mesmo sem armazenamento local.
      }
      message.textContent = 'O período de espera terminou. Você já pode voltar ao cardápio.';
      returnButton.hidden = false;
      window.removeEventListener('popstate', trapBack);
      if (window.menuzaCountdownInterval) {
        window.clearInterval(window.menuzaCountdownInterval);
        window.menuzaCountdownInterval = null;
      }
    }
  }

  function initialize() {
    history.replaceState({ menuzaBlocked: true }, '', window.location.href);
    history.pushState({ menuzaBlocked: true }, '', window.location.href);
    window.addEventListener('popstate', trapBack);

    renderCountdown();
    if (getRemaining() > 0) {
      window.menuzaCountdownInterval = window.setInterval(renderCountdown, 1000);
    }

    const returnButton = document.getElementById('return');
    if (returnButton) {
      returnButton.addEventListener('click', () => {
        if (getRemaining() > 0) return;
        window.location.replace('/');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  window.addEventListener('pageshow', renderCountdown);
})();
