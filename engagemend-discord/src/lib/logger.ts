import pino from 'pino';

/**
 * Lê LOG_LEVEL direto de process.env em vez de importar `config/env` — assim
 * um módulo pode logar sem arrastar a validação inteira de ambiente junto
 * (relevante em teste e em scripts puros).
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['token', 'DISCORD_TOKEN', 'DATABASE_URL', 'MEMBER_ID_SALT', 'RESEND_API_KEY', '*.token'],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
