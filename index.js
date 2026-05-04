import 'dotenv/config';
import { createWhatsAppClient } from './whatsapp/client.js';
import { handleMessage } from './handlers/message.js';
import { logger } from './utils/logger.js';
// ── QR Server (solo para setup inicial) ──────────────────────────────────
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';

async function main() {
  logger.info('🚀 Iniciando Finanzas Bot...');

  const sock = await createWhatsAppClient();

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // DEBUG — muestra TODO lo que llega
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
      // Ignorar status broadcast
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const senderNumber = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      logger.info(`🔍 fromMe=${msg.key.fromMe} sender=${senderNumber} owner=${process.env.OWNER_PHONE} texto="${textContent}"`);

      // Aceptar mensajes propios (de ti a ti mismo) O del owner
      if (!msg.key.fromMe && senderNumber !== process.env.OWNER_PHONE) {
        logger.warn(`Mensaje rechazado de número no autorizado: ${senderNumber}`);
        continue;
      }

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

createServer((req, res) => {
  if (req.url === '/qr' && existsSync('./qr.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(readFileSync('./qr.png'));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot corriendo. Ve a /qr para ver el código QR.');
  }
}).listen(process.env.PORT || 3000, () => {
  logger.info(`🌐 Servidor QR en puerto ${process.env.PORT || 3000} → visita /qr`);
});