export function formatOrderStatusTime(history, status, locale = 'pt-BR') {
  if (!Array.isArray(history) || typeof status !== 'string') return '';
  const event = [...history].reverse().find(item => item?.status === status);
  if (!event?.changedAt) return '';
  const date = new Date(event.changedAt);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
