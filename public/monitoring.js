// Menuza — monitoramento opcional de erros com Sentry.
// O DSN é público por natureza; a chave é lida no servidor e nunca embutida no bundle.
(async function initMenuzaMonitoring(){
  try {
    const response = await fetch('/api/public/integrations', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.sentryDsn) return;

    const script = document.createElement('script');
    script.src = 'https://browser.sentry-cdn.com/8.47.0/bundle.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = function(){
      if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
      window.Sentry.init({
        dsn: config.sentryDsn,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend(event) {
          if (event.request) {
            if (event.request.url) {
              try {
                const url = new URL(event.request.url, location.origin);
                url.search = '';
                url.hash = '';
                event.request.url = url.toString();
              } catch {}
            }
            delete event.request.cookies;
            delete event.request.data;
          }
          event.user = undefined;
          return event;
        }
      });
    };
    document.head.appendChild(script);
  } catch {
    // Monitoramento é complementar: falhas na integração nunca podem bloquear o cardápio.
  }
})();
