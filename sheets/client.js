import { google } from 'googleapis';
import { logger } from '../utils/logger.js';

const SHEET_MOV  = process.env.SHEET_MOVIMIENTOS || '📋 Movimientos';
const SHEET_PRES = process.env.SHEET_PRESUPUESTO  || '💼 Presupuesto';
const SHEET_EST  = process.env.SHEET_ESTADO       || '📊 Estado Financiero';
const SHEET_ID   = process.env.GOOGLE_SHEET_ID;

// Columnas de la pestaña Movimientos (índice 0)
// B=tipo, C=fecha, D=descripción, E=categoría, F=cuenta_origen, G=monto, H=cuenta_destino, I=notas
const MOV_COLS = {
  tipo:          1,  // col B
  fecha:         2,  // col C
  descripcion:   3,  // col D
  categoria:     4,  // col E
  cuenta_origen: 5,  // col F
  monto:         6,  // col G
  cuenta_dest:   7,  // col H
  notas:         8,  // col I
};

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// ── LEER ──────────────────────────────────────────────────────────────────────

export async function getLastMovimientos(n = 5) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_MOV}'!B7:I506`,
  });

  const rows = (res.data.values || []).filter(r => r[1]); // filas con fecha
  const last = rows.slice(-n);

  return last.map(r => ({
    tipo:        r[0] || '',
    fecha:       r[1] || '',
    descripcion: r[2] || '',
    categoria:   r[3] || '',
    cuenta:      r[4] || '',
    monto:       parseFloat(r[5]) || 0,
    destino:     r[6] || '',
    notas:       r[7] || '',
  }));
}

export async function getSaldosCuentas() {
  const sheets = await getClient();
  // Estado Financiero: cuentas en A10:G14
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_EST}'!A10:G14`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values || [];
  return rows.map(r => ({
    cuenta:       r[0] || '',
    saldoInicial: parseFloat(r[1]) || 0,
    ingresos:     parseFloat(r[2]) || 0,
    gastos:       parseFloat(r[3]) || 0,
    transfSal:    parseFloat(r[4]) || 0,
    transfEnt:    parseFloat(r[5]) || 0,
    saldoActual:  parseFloat(r[6]) || 0,
  }));
}

export async function getResumenMes() {
  const sheets = await getClient();

  // Patrimonio neto D4:D6
  const resNW = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_EST}'!D4:D6`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const nwVals = resNW.data.values || [];

  // Presupuesto: resumen proyección B27:C38
  const resPres = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_PRES}'!A27:C38`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const presVals = resPres.data.values || [];

  const presMap = {};
  for (const row of presVals) {
    if (row[0]) presMap[row[0]] = parseFloat(row[1]) || 0;
  }

  return {
    totalActivos:          parseFloat(nwVals[0]?.[0]) || 0,
    totalPasivos:          parseFloat(nwVals[1]?.[0]) || 0,
    patrimoniaNeto:        parseFloat(nwVals[2]?.[0]) || 0,
    ingresosEsperados:     presMap['Ingresos esperados del mes'] || 0,
    gastoPresupuestado:    presMap['Gastos presupuestados totales'] || 0,
    ingresosReales:        presMap['Ingresos reales a la fecha'] || 0,
    gastosReales:          presMap['Gastos reales a la fecha'] || 0,
    saldoReal:             presMap['Saldo real a la fecha'] || 0,
    proyeccionGastos:      presMap['Proyección de gastos al fin del mes'] || 0,
    superavitProyectado:   presMap['Superávit/Déficit proyectado'] || 0,
    diasRestantes:         presMap['Días restantes del mes'] || 0,
    presupuestoDiario:     presMap['Presupuesto diario disponible (restante)'] || 0,
  };
}

export async function getAlertasPresupuesto() {
  const sheets = await getClient();
  // Categorías del presupuesto A14:G23
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_PRES}'!A14:G23`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values || [];
  return rows.map(r => ({
    categoria:    r[0] || '',
    presupuesto:  parseFloat(r[1]) || 0,
    gastado:      parseFloat(r[2]) || 0,
    disponible:   parseFloat(r[3]) || 0,
    pctUsado:     parseFloat(r[4]) || 0,
    proyeccion:   parseFloat(r[5]) || 0,
    alcanza:      r[6] || '',
  }));
}

// ── ESCRIBIR ───────────────────────────────────────────────────────────────────

export async function appendMovimiento({ tipo, fecha, descripcion, categoria, cuenta_origen, monto, cuenta_destino = '', notas = '' }) {
  const sheets = await getClient();

  // Buscar la primera fila vacía (col C = fecha está vacía)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_MOV}'!C7:C506`,
  });

  const rows = res.data.values || [];
  const firstEmpty = 7 + rows.filter(r => r[0]).length; // fila 1-indexed en Sheets

  // Formatear fecha DD/MM/YYYY
  const fechaFmt = formatDate(fecha);

  // La fila va de col B(2) a I(9)
  const rowValues = [
    tipo.toUpperCase(),
    fechaFmt,
    descripcion,
    categoria,
    cuenta_origen,
    monto,
    cuenta_destino,
    notas,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_MOV}'!B${firstEmpty}:I${firstEmpty}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });

  logger.info({ firstEmpty, tipo, monto }, 'Movimiento registrado');
  return firstEmpty;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  // Acepta Date, "YYYY-MM-DD", "DD/MM/YYYY" o "hoy"
  if (!dateStr || dateStr === 'hoy') {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  if (dateStr instanceof Date) {
    return `${String(dateStr.getDate()).padStart(2,'0')}/${String(dateStr.getMonth()+1).padStart(2,'0')}/${dateStr.getFullYear()}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y,m,d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr; // Ya está en DD/MM/YYYY
}

export const CUENTAS_VALIDAS = ['Efectivo','Cuenta Bancaria','Tarjeta Crédito','Ahorros','Inversiones'];
export const CATEGORIAS_VALIDAS = [
  'Alimentación','Transporte','Vivienda','Salud','Entretenimiento',
  'Educación','Ropa y Calzado','Servicios Básicos','Deudas/Créditos','Otros gastos',
  'Salario','Freelance / Consultoría','Dividendos','Alquiler','Bono','Otros ingresos',
];
