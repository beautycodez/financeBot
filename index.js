import 'dotenv/config';
import { createWhatsAppClient } from './whatsapp/client.js';
import { handleMessage } from './handlers/message.js';
import { logger } from './utils/logger.js';
import { createServer } from 'http';
import { readFileSync, existsSync, rmSync } from 'fs';

// ── Limpiar sesión si se pide (antes de todo) ─────────────────────────────
if (process.env.CLEAR_SESSION === 'true') {
  if (existsSync('./auth_info')) {
    rmSync('./auth_info', { recursive: true, force: true });
    logger.info('🗑️ Sesión borrada. Quita CLEAR_SESSION=true y redeploy.');
  } else { 
    logger.info('ℹ️ No había sesión que borrar.');
  }
  process.exit(0);
}

// ── QR Server arranca PRIMERO para pasar el health check de Railway ────────
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  if (req.url === '/qr' && existsSync('./qr.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(readFileSync('./qr.png'));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot corriendo. Ve a /qr para ver el QR.');
  }
}).listen(PORT, '0.0.0.0', () => {
  logger.info(`🌐 Servidor HTTP listo en puerto ${PORT}`);
});

async function main() {
  logger.info('🚀 Iniciando Finanzas Bot...');

  const sock = await createWhatsAppClient();

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    logger.info(`📨 messages.upsert tipo="${type}" cantidad=${messages.length}`);

    for (const m of messages) {
      logger.info({
        remoteJid: m.key.remoteJid,
        fromMe: m.key.fromMe,
        text: m.message?.conversation || m.message?.extendedTextMessage?.text || '(sin texto)',
      }, '📨 mensaje raw');
    }

    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const senderJid = msg.key.remoteJid;
      const senderNumber = senderJid
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '');

      const textContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      logger.info(`🔍 fromMe=${msg.key.fromMe} jid=${senderJid} sender=${senderNumber} owner=${process.env.OWNER_PHONE} texto="${textContent}"`);

      const isOwner =
        msg.key.fromMe === true ||
        senderNumber === process.env.OWNER_PHONE;

      if (!isOwner) {
        logger.warn(`Rechazado: número no autorizado ${senderJid}`);
        continue;
      }

      if (!textContent) continue;

      try {
        await handleMessage(sock, msg);
      } catch (err) {
        logger.error({ err }, 'Error procesando mensaje');
        await sock.sendMessage(msg.key.remoteJid, {
          text: '❌ Ocurrió un error interno. Intenta de nuevo.',
        });
      }
    }
  });

  logger.info('✅ Bot listo y escuchando mensajes.');
}

main().catch((err) => {
  logger.error({ err }, 'Error fatal al iniciar el bot');
  process.exit(1);
});
