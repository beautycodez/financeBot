import 'dotenv/config';
import { createWhatsAppClient } from './whatsapp/client.js';
import { handleMessage } from './handlers/message.js';
import { logger } from './utils/logger.js';
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
      // Ignorar status broadcast y grupos
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      // Normalizar JID — Railway puede usar @lid en vez de @s.whatsapp.net
      const senderJid = msg.key.remoteJid;
      const senderNumber = senderJid
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '');

      const textContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      logger.info(`🔍 fromMe=${msg.key.fromMe} jid=${senderJid} sender=${senderNumber} owner=${process.env.OWNER_PHONE} texto="${textContent}"`);

      // Aceptar: mensajes propios (fromMe) O del número owner
      const isOwner =
        msg.key.fromMe === true ||
        senderNumber === process.env.OWNER_PHONE;

      if (!isOwner) {
        logger.warn(`Rechazado: número no autorizado ${senderJid}`);
        continue;
      }

      // Ignorar mensajes sin texto
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
  // Limpiar sesión si se pide (solo una vez)
if (process.env.CLEAR_SESSION === 'true') {
  const { rmSync, existsSync } = await import('fs');
  if (existsSync('./auth_info')) {
    rmSync('./auth_info', { recursive: true, force: true });
    logger.info('🗑️ Sesión borrada. Quita CLEAR_SESSION=true y redeploy.');
    process.exit(0);
  }
  }
  logger.error({ err }, 'Error fatal al iniciar el bot');
  process.exit(1);
});

// ── QR Server (setup inicial) ─────────────────────────────────────────────
createServer((req, res) => {
  if (req.url === '/qr' && existsSync('./qr.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(readFileSync('./qr.png'));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot corriendo. Ve a /qr para ver el QR.');
  }
}).listen(process.env.PORT || 3000, () => {
  logger.info(`🌐 Servidor QR en puerto ${process.env.PORT || 3000}`);
});
