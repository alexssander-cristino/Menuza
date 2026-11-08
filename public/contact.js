// Formulário de contato e privacidade.
// Valida os campos no navegador, envia a solicitação para a API e apresenta o resultado
// sem recarregar a página. Não armazena dados sensíveis no frontend.
// Initialize Vercel Speed Insights
import { injectSpeedInsights } from './speed-insights.js';
injectSpeedInsights();

const form = document.getElementById('privacyRequestForm');
const statusNode = document.getElementById('contactFormStatus');
if (form && statusNode) form.addEventListener('submit', async event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]'); const originalButtonText = button.innerHTML; button.disabled = true; button.innerHTML = '<span>Enviando…</span><span aria-hidden="true">…</span>';
  statusNode.className = ''; statusNode.textContent = 'Registrando sua solicitação…';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/privacy-requests', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a solicitação.');
    form.reset(); statusNode.className = 'contact-success';
    statusNode.textContent = (result.message || 'Sua solicitação foi registrada com sucesso.') + (result.protocol ? ' Protocolo: ' + result.protocol + '.' : '') + ' O responsável consultará o painel para dar andamento ao pedido.';
  } catch (error) { statusNode.className = 'contact-error'; statusNode.textContent = error.message || 'Falha ao registrar. Tente novamente mais tarde.'; }
  finally { button.disabled = false; button.innerHTML = originalButtonText; }
});