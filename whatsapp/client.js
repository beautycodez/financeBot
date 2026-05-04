import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import { logger } from '../utils/logger.js';

export async function createWhatsAppClient() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  logger.info(`Usando Baileys v${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger: logger.child({ level: 'silent' }),
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Guardar como imagen PNG en disco (descargable desde Railway Volume)
      await QRCode.toFile('./qr.png', qr, { width: 400 });
      logger.info('╔══════════════════════════════════════╗');
      logger.info('║  QR guardado en: ./qr.png            ║');
      logger.info('║  Descárgalo y escanéalo con WhatsApp ║');
      logger.info('╚══════════════════════════════════════╝');

      // Imprimir también en terminal línea a línea
      const qrText = await QRCode.toString(qr, { type: 'terminal', small: true });
      for (const line of qrText.split('\n')) process.stdout.write(line + '\n');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Conexión cerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        logger.info('Reconectando en 5 segundos...');
        setTimeout(() => createWhatsAppClient(), 5000);
      } else {
        logger.error('Sesión cerrada (logged out). Borra auth_info y reinicia.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      logger.info('✅ WhatsApp conectado exitosamente.');
    }
  });

  return sock;
}