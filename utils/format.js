export function formatSoles(num) {
  const n = parseFloat(num) || 0;
  return `S/. ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(num) {
  return `${(parseFloat(num) * 100).toFixed(1)}%`;
}

export function emoji(tipo) {
  if (tipo === 'INGRESO') return '💰';
  if (tipo === 'GASTO') return '💸';
  if (tipo === 'TRANSFERENCIA') return '🔄';
  return '📝';
}
