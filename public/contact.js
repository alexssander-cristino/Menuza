// Initialize Vercel Speed Insights
import { injectSpeedInsights } from './speed-insights.js';
injectSpeedInsights();

const form = document.getElementById('privacyRequestForm');
const statusNode = document.getElementById('contactFormStatus');
if (form && statusNode) form.addEventListener('submit', async event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]'); button.disabled = true;
  statusNode.className = ''; statusNode.textContent = 'Registrando sua solicitação…';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/privacy-requests', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a solicitação.');
    form.reset(); statusNode.className = 'contact-success';
    statusNode.textContent = result.message + ' Esta página não envia e-mail automático; o operador precisa consultar o painel.';
  } catch (error) { statusNode.className = 'contact-error'; statusNode.textContent = error.message || 'Falha ao registrar. Tente novamente mais tarde.'; }
  finally { button.disabled = false; }
});