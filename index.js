import 'dotenv/config';
import { createWhatsAppClient } from './whatsapp/client.js';
import { handleMessage } from './handlers/message.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('🚀 Iniciando Finanzas Bot...');

  const sock = await createWhatsAppClient();

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes propios, de grupos y de status
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      // Solo procesar mensajes del dueño configurado
      const senderNumber = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      if (senderNumber !== process.env.OWNER_PHONE) {
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
