(() => {
  'use strict';

  const STORAGE_KEY = 'menuza-rate-limit-until';
  const BUILD_KEY = 'menuza-app-build';
  const CURRENT_BUILD = '54';
  const now = Date.now();

  // Uma versão nova corrige falsos positivos do honeypot. Remove apenas o
  // bloqueio visual antigo; o servidor continua aplicando o rate limit real.
  try {
    if (localStorage.getItem(BUILD_KEY) !== CURRENT_BUILD) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.replace('/#conta');
      return;
    }
  } catch {}

  const params = new URLSearchParams(window.location.search);
  const parsedWait = Number.parseInt(params.get('wait') || '', 10);
  const requestedWait = Number.isFinite(parsedWait)
    ? Math.max(1, Math.min(3600, parsedWait))
    : 900;

  let until = now + requestedWait * 1000;

  try {
    const storedValue = localStorage.getItem(STORAGE_KEY);

    // Se já existe um prazo salvo, nunca reinicia a contagem ao atualizar.
    if (storedValue !== null) {
      const savedUntil = Number.parseInt(storedValue, 10);

      // Prazo encerrado: qualquer nova visita à página 429 segue para o login.
      if (!Number.isFinite(savedUntil) || savedUntil <= now) {
        window.location.replace('/#conta');
        return;
      }

      until = savedUntil;
    } else {
      localStorage.setItem(STORAGE_KEY, String(until));
    }
  } catch {
    // Sem armazenamento local, o cronômetro funciona apenas durante esta visita.
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
      // Mantém um marcador de expiração para que F5 não inicie outro bloqueio.
      try {
        localStorage.setItem(STORAGE_KEY, '0');
      } catch {
        // O redirecionamento automático continua funcionando nesta visita.
      }
      window.removeEventListener('popstate', trapBack);
      if (window.menuzaCountdownInterval) {
        window.clearInterval(window.menuzaCountdownInterval);
        window.menuzaCountdownInterval = null;
      }
      message.textContent = 'Tempo encerrado. Redirecionando para o login…';
      returnButton.hidden = true;
      window.location.replace('/#conta');
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
