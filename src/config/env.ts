import { z } from 'zod';

/**
 * Validação de ambiente. Falha no boot, não em runtime — um `MEMBER_ID_SALT`
 * ausente descoberto no meio de um backfill significa hashes inconsistentes
 * no event store, e o event store é append-only.
 */

// Node ≥20.12 lê o .env sem dependência externa. Em produção (Railway, Docker,
// CI) o arquivo não existe e as variáveis já vêm do processo — daí o try/catch.
try {
  process.loadEnvFile();
} catch {
  // sem .env local: segue com o que estiver em process.env
}

/**
 * Editor no Windows salva .env com BOM UTF-8 com muita facilidade, e o parser
 * nativo do Node não o remove — a primeira chave do arquivo vira
 * `﻿DATABASE_URL` e some da validação. Falha confusa demais para valer a
 * pena diagnosticar duas vezes.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('﻿')) {
    process.env[key.slice(1)] ??= process.env[key];
  }
}

const SNOWFLAKE = /^\d{17,20}$/;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  /** Conexão direta (sem pooler). Só o Prisma Migrate usa. */
  DIRECT_URL: z.string().min(1).optional(),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN é obrigatório'),

  /** Permite subir o painel/API localmente sem autenticar o bot Discord. */
  DISCORD_ENABLED: z.preprocess(
    (value) => (value === undefined || value === '' ? true : value === 'true'),
    z.boolean(),
  ).default(true),

  LOCAL_AUTH_BYPASS: z.preprocess(
    (value) => (value === undefined || value === '' ? false : value === 'true'),
    z.boolean(),
  ).default(false),

  DISCORD_GUILD_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(SNOWFLAKE, 'DISCORD_GUILD_ID deve ser um snowflake (17–20 dígitos)').optional(),
  ),

  DISCORD_CLIENT_ID: z
    .string()
    .regex(SNOWFLAKE, 'DISCORD_CLIENT_ID deve ser um snowflake (17–20 dígitos)'),

  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY é obrigatória'),

  YOUTUBE_API_KEY: z.string().min(1, 'YOUTUBE_API_KEY é obrigatória'),

  PUBLIC_URL: z.string().url('PUBLIC_URL precisa ser uma URL válida'),

  /**
   * Sal do HMAC que pseudonimiza o discord_id (§3). Trocar este valor
   * reescreve todo o espaço de hashes e órfã o histórico já coletado.
   */
  MEMBER_ID_SALT: z
    .string()
    .min(32, 'MEMBER_ID_SALT precisa de pelo menos 32 caracteres'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    // Sem logger aqui de propósito: isto roda antes de qualquer coisa existir.
    console.error(`Configuração de ambiente inválida:\n${problems}\n`);
    console.error('Copie .env.example para .env e preencha os valores.');
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();
