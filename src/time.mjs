const RESTAURANT_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Returns the ISO calendar date observed by the restaurant, not the server's
 * UTC date. Order timestamps remain UTC; this prefix is only for day grouping.
 */
export function restaurantLocalDatePrefix(date = new Date(), timeZone = RESTAURANT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}
