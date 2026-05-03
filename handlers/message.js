import NodeCache from 'node-cache';
import { parseMessage, confirmMovimiento } from '../agents/parser.js';
import {
  appendMovimiento,
  getLastMovimientos,
  getSaldosCuentas,
  getResumenMes,
  getAlertasPresupuesto,
} from '../sheets/client.js';
import { formatSoles, formatPct, emoji } from '../utils/format.js';
import { logger } from '../utils/logger.js';

// Cache de estado de conversación (TTL: 5 minutos)
const sessionCache = new NodeCache({ stdTTL: 300 });

// Estado por JID: { step: 'confirming', payload: {...} }
function getSession(jid) { return sessionCache.get(jid) || { step: 'idle' }; }
function setSession(jid, data) { sessionCache.set(jid, data); }
function clearSession(jid) { sessionCache.del(jid); }

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

export async function handleMessage(sock, msg) {
  const jid  = msg.key.remoteJid;
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!text) return;

  logger.info({ jid, text }, 'Mensaje recibido');
  const session = getSession(jid);

  // ── Flujo de confirmación pendiente ───────────────────────────────────────
  if (session.step === 'confirming') {
    await handleConfirmation(sock, jid, text, session);
    return;
  }

  // ── Comandos explícitos ───────────────────────────────────────────────────
  const lower = text.toLowerCase();

  if (lower === 'ayuda' || lower === '!ayuda' || lower === 'help') {
    await sendHelp(sock, jid);
    return;
  }
  if (lower === 'saldo' || lower === 'saldos' || lower === '!saldo') {
    await sendSaldos(sock, jid);
    return;
  }
  if (lower === 'resumen' || lower === '!resumen') {
    await sendResumen(sock, jid);
    return;
  }
  if (lower === 'presupuesto' || lower === '!presupuesto' || lower === 'presup') {
    await sendPresupuesto(sock, jid);
    return;
  }
  if (lower.startsWith('últimos') || lower.startsWith('ultimos') || lower === '!ultimos') {
    const n = parseInt(text.split(' ')[1]) || 5;
    await sendUltimos(sock, jid, Math.min(n, 10));
    return;
  }

  // ── Lenguaje natural → Claude ─────────────────────────────────────────────
  await sock.sendMessage(jid, { text: '⏳ Procesando...' });

  const parsed = await parseMessage(text);

  switch (parsed.intent) {
    case 'movimiento':
      await handleMovimiento(sock, jid, parsed);
      break;
    case 'consulta':
      await handleConsulta(sock, jid, parsed);
      break;
    default:
      await sock.sendMessage(jid, {
        text:
          '🤔 No entendí ese mensaje.\n\n' +
          'Ejemplos válidos:\n' +
          '• _"gasté 45 en gasolina"_\n' +
          '• _"cobré mi sueldo 3500"_\n' +
          '• _"saldo"_, _"resumen"_, _"presupuesto"_\n\n' +
          'Escribe *ayuda* para ver todos los comandos.',
      });
  }
}

// ── HANDLERS INTERNOS ─────────────────────────────────────────────────────────

async function handleMovimiento(sock, jid, parsed) {
  // Si la confianza es baja → confirmar antes de guardar
  if (parsed.confianza === 'baja') {
    setSession(jid, { step: 'confirming', payload: parsed });
    await confirmMovimiento(sock, jid, parsed);
    return;
  }

  // Alta/media confianza → guardar directo
  await guardarMovimiento(sock, jid, parsed);
}

async function handleConfirmation(sock, jid, text, session) {
  const lower = text.toLowerCase();

  if (['sí','si','yes','s','confirmar','ok','dale'].includes(lower)) {
    clearSession(jid);
    await guardarMovimiento(sock, jid, session.payload);
  } else if (['no','cancelar','cancel','n'].includes(lower)) {
    clearSession(jid);
    await sock.sendMessage(jid, { text: '❌ Movimiento cancelado.' });
  } else {
    await sock.sendMessage(jid, { text: 'Responde *sí* para confirmar o *no* para cancelar.' });
  }
}

async function guardarMovimiento(sock, jid, parsed) {
  try {
    const row = await appendMovimiento({
      tipo:            parsed.tipo,
      fecha:           parsed.fecha || 'hoy',
      descripcion:     parsed.descripcion,
      categoria:       parsed.categoria,
      cuenta_origen:   parsed.cuenta_origen,
      monto:           parsed.monto,
      cuenta_destino:  parsed.cuenta_destino || '',
      notas:           parsed.notas || '',
    });

    const emojiTipo = parsed.tipo === 'INGRESO' ? '💰' : parsed.tipo === 'GASTO' ? '💸' : '🔄';
    const dest = parsed.cuenta_destino ? ` → ${parsed.cuenta_destino}` : '';

    const reply =
      `${emojiTipo} *¡Registrado!* (fila ${row})\n\n` +
      `• ${parsed.tipo}: *${formatSoles(parsed.monto)}*\n` +
      `• ${parsed.descripcion}\n` +
      `• 📂 ${parsed.categoria}\n` +
      `• 💳 ${parsed.cuenta_origen}${dest}\n\n` +
      `_Escribe "saldo" para ver tus cuentas._`;

    await sock.sendMessage(jid, { text: reply });
  } catch (err) {
    logger.error({ err }, 'Error guardando movimiento');
    await sock.sendMessage(jid, {
      text: '❌ No pude guardar el movimiento. Verifica tu conexión con Google Sheets.',
    });
  }
}

async function handleConsulta(sock, jid, parsed) {
  switch (parsed.tipo) {
    case 'saldo':    return sendSaldos(sock, jid);
    case 'resumen':  return sendResumen(sock, jid);
    case 'presupuesto': return sendPresupuesto(sock, jid);
    case 'ultimos':  return sendUltimos(sock, jid, 5);
    case 'ayuda':    return sendHelp(sock, jid);
    default:         return sendHelp(sock, jid);
  }
}

// ── RESPUESTAS ────────────────────────────────────────────────────────────────

async function sendSaldos(sock, jid) {
  const cuentas = await getSaldosCuentas();
  const total   = cuentas.reduce((s, c) => s + c.saldoActual, 0);

  let msg = '💳 *SALDOS ACTUALES*\n\n';
  for (const c of cuentas) {
    const bar = barVisual(c.saldoActual, total);
    msg += `*${c.cuenta}*\n`;
    msg += `  ${formatSoles(c.saldoActual)} ${bar}\n\n`;
  }
  msg += `─────────────────\n`;
  msg += `💰 *Total: ${formatSoles(total)}*`;

  await sock.sendMessage(jid, { text: msg });
}

async function sendResumen(sock, jid) {
  const r = await getResumenMes();
  const balance = r.ingresosReales - r.gastosReales;
  const tasaAhorro = r.ingresosReales > 0
    ? ((r.ingresosReales - r.gastosReales) / r.ingresosReales * 100).toFixed(1)
    : '0.0';

  const diag = r.superavitProyectado >= 0
    ? `✅ Proyectas *ahorrar ${formatSoles(r.superavitProyectado)}* este mes`
    : `🔴 Proyectas un *déficit de ${formatSoles(Math.abs(r.superavitProyectado))}*`;

  const msg =
    `📊 *RESUMEN DEL MES*\n\n` +
    `💰 Ingresos reales: *${formatSoles(r.ingresosReales)}*\n` +
    `💸 Gastos reales: *${formatSoles(r.gastosReales)}*\n` +
    `📈 Balance: *${formatSoles(balance)}*\n` +
    `💾 Tasa de ahorro: *${tasaAhorro}%*\n\n` +
    `─────────────────\n` +
    `🎯 *PROYECCIÓN*\n` +
    `Gastos estimados fin de mes: ${formatSoles(r.proyeccionGastos)}\n` +
    `Días restantes: ${r.diasRestantes}\n` +
    `Presupuesto diario disponible: *${formatSoles(r.presupuestoDiario)}*\n\n` +
    `${diag}\n\n` +
    `🏦 Patrimonio neto: *${formatSoles(r.patrimoniaNeto)}*`;

  await sock.sendMessage(jid, { text: msg });
}

async function sendPresupuesto(sock, jid) {
  const items = await getAlertasPresupuesto();

  let msg = '🚦 *SEMÁFORO DE PRESUPUESTO*\n\n';
  for (const item of items) {
    if (!item.categoria) continue;
    const pct = (item.pctUsado * 100).toFixed(0);
    const icono = item.alcanza === '🔴 No' ? '🔴' : pct >= 80 ? '🟡' : '🟢';
    msg += `${icono} *${item.categoria}*\n`;
    msg += `   Gastado: ${formatSoles(item.gastado)} / ${formatSoles(item.presupuesto)} (${pct}%)\n`;
    if (item.alcanza === '🔴 No') {
      msg += `   ⚠️ Excede presupuesto por ${formatSoles(Math.abs(item.disponible))}\n`;
    } else {
      msg += `   ✅ Disponible: ${formatSoles(item.disponible)}\n`;
    }
    msg += '\n';
  }

  const excedidas = items.filter(i => i.alcanza === '🔴 No').length;
  if (excedidas > 0) {
    msg += `─────────────────\n🔴 *${excedidas} categoría(s) excediendo presupuesto*`;
  } else {
    msg += `─────────────────\n✅ *Todas las categorías dentro del presupuesto*`;
  }

  await sock.sendMessage(jid, { text: msg });
}

async function sendUltimos(sock, jid, n = 5) {
  const movs = await getLastMovimientos(n);

  if (movs.length === 0) {
    await sock.sendMessage(jid, { text: '📋 No hay movimientos registrados aún.' });
    return;
  }

  let msg = `📋 *ÚLTIMOS ${movs.length} MOVIMIENTOS*\n\n`;
  for (const m of movs) {
    const emojiTipo = m.tipo === 'INGRESO' ? '💰' : m.tipo === 'GASTO' ? '💸' : '🔄';
    msg += `${emojiTipo} *${formatSoles(m.monto)}* — ${m.descripcion}\n`;
    msg += `   📂 ${m.categoria} | 💳 ${m.cuenta} | 📅 ${m.fecha}\n\n`;
  }

  await sock.sendMessage(jid, { text: msg });
}

async function sendHelp(sock, jid) {
  const msg =
    `🤖 *FINANZAS BOT — COMANDOS*\n\n` +
    `*📝 REGISTRAR MOVIMIENTOS*\n` +
    `Solo escríbeme en lenguaje natural:\n` +
    `• _"gasté 120 en el super Wong"_\n` +
    `• _"cobré mi sueldo 3500 soles"_\n` +
    `• _"transferí 500 a ahorros"_\n` +
    `• _"pagué 800 de alquiler ayer"_\n` +
    `• _"ingresó freelance 250"_\n\n` +
    `*📊 CONSULTAS*\n` +
    `• *saldo* — Ver saldos de todas las cuentas\n` +
    `• *resumen* — Balance del mes actual\n` +
    `• *presupuesto* — Semáforo de categorías\n` +
    `• *ultimos 5* — Últimos N movimientos\n\n` +
    `*💡 TIPS*\n` +
    `• Puedo entender "ayer", "antier", fechas\n` +
    `• Si no estoy seguro, te pediré confirmación\n` +
    `• La moneda siempre es Soles (S/.)`;

  await sock.sendMessage(jid, { text: msg });
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function barVisual(val, total) {
  if (!total) return '';
  const pct = Math.max(0, Math.min(1, val / total));
  const filled = Math.round(pct * 8);
  return '█'.repeat(filled) + '░'.repeat(8 - filled) + ` ${(pct * 100).toFixed(0)}%`;
}
