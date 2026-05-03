import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
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

  // Guardar credenciales cuando cambien
  sock.ev.on('creds.update', saveCreds);

  // Manejar conexión / desconexión / QR
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('📱 Escanea este QR con tu WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const isConflict = statusCode === 440;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isLoggedOut && !isConflict;

      logger.warn(`Conexión cerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      if (isConflict) {
        logger.error('La sesión fue reemplazada por otra conexión (conflict 440). Detén otras instancias o reinicia después de borrar auth_info si es necesario.');
        process.exit(1);
      }

      if (shouldReconnect) {
        logger.info('Reconectando en 5 segundos...');
        setTimeout(() => createWhatsAppClient(), 5000);
      } else {
        logger.error('Sesión cerrada (logged out). Borra la carpeta auth_info y reinicia.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      logger.info('✅ WhatsApp conectado exitosamente.');
    }
  });

  return sock;
}
