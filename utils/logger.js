import { createRequire } from 'module';
import pino from 'pino';

const require = createRequire(import.meta.url);
const pinoPrettyTarget = require.resolve('pino-pretty');

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: pinoPrettyTarget, options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
