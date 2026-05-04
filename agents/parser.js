import Anthropic from "@anthropic-ai/sdk";
import { CUENTAS_VALIDAS, CATEGORIAS_VALIDAS } from "../sheets/client.js";
import { logger } from "../utils/logger.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres el asistente financiero personal de un usuario peruano. 
Tu tarea es interpretar mensajes en lenguaje natural y extraer información de movimientos financieros.

CUENTAS VÁLIDAS: ${CUENTAS_VALIDAS.join(", ")}
CATEGORÍAS VÁLIDAS: ${CATEGORIAS_VALIDAS.join(", ")}

TIPOS DE MOVIMIENTO:
- INGRESO: cuando el usuario recibe dinero (salario, cobro, etc.)
- GASTO: cuando el usuario gasta dinero
- TRANSFERENCIA: cuando mueve dinero entre sus propias cuentas

REGLAS DE INFERENCIA:
- Si no se menciona cuenta, para GASTOS pequeños (<200) usa "Efectivo", para montos mayores "Cuenta Bancaria"
- Si no se menciona categoría, infiere por la descripción
- "super", "mercado", "wong", "tottus", "plaza vea" → Alimentación
- "gasolina", "uber", "taxi", "bus", "micro", "combi" → Transporte
- "alquiler", "dpto", "departamento", "luz", "agua", "internet" → Vivienda / Servicios Básicos
- "doctor", "clínica", "farmacia", "medicamento" → Salud
- "restaurante", "cine", "netflix", "spotify", "juego" → Entretenimiento
- "colegio", "universidad", "curso", "libro" → Educación
- "sueldo", "salario", "quincena" → Salario
- "transferir a ahorros", "ahorrar" → TRANSFERENCIA a cuenta Ahorros
- Si el usuario dice "ayer" usa la fecha de ayer, "antier" antes de ayer, etc.
- La moneda es Soles peruanos (S/.)

RESPONDE SIEMPRE EN JSON PURO, sin texto adicional, sin markdown, sin backticks.

Si el mensaje es un movimiento financiero, responde:
{
  "intent": "movimiento",
  "tipo": "INGRESO|GASTO|TRANSFERENCIA",
  "monto": 123.45,
  "descripcion": "descripción corta",
  "categoria": "categoría exacta de la lista",
  "cuenta_origen": "cuenta exacta de la lista",
  "cuenta_destino": "cuenta exacta o vacío",
  "notas": "notas adicionales o vacío",
  "fecha": "hoy|ayer|DD/MM/YYYY",
  "confianza": "alta|media|baja"
}

Si el mensaje es una consulta, responde:
{
  "intent": "consulta",
  "tipo": "saldo|resumen|presupuesto|ultimos|ayuda"
}

Si no se puede interpretar:
{
  "intent": "desconocido",
  "mensaje": "razón breve"
}`;

export async function parseMessage(text) {
  const today = new Date().toLocaleDateString("es-PE", {
    timeZone: process.env.TZ || "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Fecha de hoy: ${today}\nMensaje del usuario: "${text}"`,
        },
      ],
    });

    const raw = response.content[0].text.trim();

    // 🔧 limpiar markdown si existe
    const clean = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(clean);
    logger.debug({ parsed }, "Mensaje interpretado");
    return parsed;
  } catch (err) {
    logger.error({ err }, "Error en parseMessage");
    return {
      intent: "desconocido",
      mensaje: "Error al interpretar el mensaje.",
    };
  }
}

// Confirmación de movimiento ambiguo
export async function confirmMovimiento(sock, jid, parsed) {
  const emoji =
    parsed.tipo === "INGRESO" ? "💰" : parsed.tipo === "GASTO" ? "💸" : "🔄";
  const dest = parsed.cuenta_destino ? ` → ${parsed.cuenta_destino}` : "";

  const msg =
    `${emoji} *¿Confirmas este movimiento?*\n\n` +
    `• Tipo: ${parsed.tipo}\n` +
    `• Monto: S/. ${Number(parsed.monto).toFixed(2)}\n` +
    `• Descripción: ${parsed.descripcion}\n` +
    `• Categoría: ${parsed.categoria}\n` +
    `• Cuenta: ${parsed.cuenta_origen}${dest}\n` +
    `• Fecha: ${parsed.fecha === "hoy" ? "Hoy" : parsed.fecha}\n\n` +
    `Responde *sí* para confirmar o *no* para cancelar.`;

  await sock.sendMessage(jid, { text: msg });
}
