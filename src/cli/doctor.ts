import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';

/**
 * `pnpm dod`         — roda a Definition of done do §12 inteira
 * `pnpm dod --fast`  — pula `tsc` e `vitest` (os dois itens lentos)
 *
 * O nome é `dod` porque `doctor` é subcomando embutido do pnpm: `pnpm doctor`
 * roda o diagnóstico do próprio pnpm e nunca chega aqui. `pnpm run doctor`
 * também funciona, para quem digitar por hábito.
 *
 * O §12 era uma lista de caixinhas conferidas na mão, e conferência manual
 * envelhece mal: o cargo do bot muda no Discord, alguém adiciona uma coluna de
 * texto, e a lista continua marcada. Aqui cada item vira uma medição do estado
 * real — banco, git e API do Discord — com código de saída 1 se algo falhar.
 *
 * Só lê. Nenhum check escreve no banco nem no servidor.
 */

type Status = 'ok' | 'falha' | 'aviso' | 'pulado';

interface Check {
  /** Numeração do item no §12, para a saída bater com o documento. */
  item: number;
  nome: string;
  status: Status;
  detalhe: string[];
}

const program = new Command()
  .name('doctor')
  .description('Verifica a Definition of done do §12 contra o estado real')
  .option('--fast', 'pula tsc e vitest', false)
  // `pnpm run doctor -- --fast` repassa o `--` literal; commander o trataria
  // como operando e abortaria. Ninguém deveria precisar saber disso.
  .parse(process.argv.filter((arg) => arg !== '--'));

const { fast } = program.opts<{ fast: boolean }>();

// ---------------------------------------------------------------- utilitários

function run(cmd: string, args: string[]): { code: number; out: string } {
  // `shell: true` é necessário no Windows (pnpm é .cmd), e passar o array de
  // argumentos junto dispara DEP0190. Comando montado como string única: todos
  // os argumentos aqui são literais deste arquivo, nada vem de fora.
  const result = spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', shell: true });
  return {
    code: result.status ?? 1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/** Últimas linhas de uma saída longa — o suficiente para diagnosticar sem poluir. */
function tail(text: string, lines = 6): string[] {
  return text.split('\n').filter(Boolean).slice(-lines);
}

// ------------------------------------------------- §12.1 e §12.2 — build check

function checkTypecheck(): Check {
  if (fast) {
    return { item: 1, nome: 'tsc --noEmit limpo, strict', status: 'pulado', detalhe: ['--fast'] };
  }
  const { code, out } = run('pnpm', ['typecheck']);
  return {
    item: 1,
    nome: 'tsc --noEmit limpo, strict',
    status: code === 0 ? 'ok' : 'falha',
    detalhe: code === 0 ? [] : tail(out),
  };
}

function checkTests(): Check {
  if (fast) {
    return { item: 2, nome: 'vitest run verde', status: 'pulado', detalhe: ['--fast'] };
  }
  const { code, out } = run('pnpm', ['test']);
  return {
    item: 2,
    nome: 'vitest run verde',
    status: code === 0 ? 'ok' : 'falha',
    detalhe: tail(out, code === 0 ? 2 : 8),
  };
}

// ------------------------------------------------------------ §12.3 — dedupe

/**
 * O `@@unique([memberHash, eventType, refId])` protege o backfill de duplicar,
 * mas só quando `refId` existe: no Postgres, NULL é distinto de NULL, então
 * duas linhas com `refId` nulo passam pelo índice. Voz e sessões agregadas caem
 * nesse caso — daí a segunda contagem.
 */
async function checkDedupe(): Promise<Check> {
  const detalhe: string[] = [];
  let status: Status = 'ok';

  const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'member_events'
  `;
  const temUnique = indexes.some((row) => row.indexname.includes('refId'));
  if (!temUnique) {
    status = 'falha';
    detalhe.push('índice único dedupe_key ausente em member_events');
  }

  const [comRef] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM member_events WHERE "refId" IS NOT NULL
      GROUP BY "memberHash", "eventType", "refId" HAVING COUNT(*) > 1
    ) t
  `;
  if ((comRef?.n ?? 0) > 0) {
    status = 'falha';
    detalhe.push(`${comRef?.n} grupo(s) duplicado(s) com refId preenchido`);
  }

  const [semRef] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM member_events WHERE "refId" IS NULL
      GROUP BY "memberHash", "eventType", "occurredAt", "contextId" HAVING COUNT(*) > 1
    ) t
  `;
  if ((semRef?.n ?? 0) > 0) {
    if (status === 'ok') status = 'aviso';
    detalhe.push(
      `${semRef?.n} grupo(s) com refId NULL e mesmo (membro, tipo, instante) — ` +
        'o índice único não cobre NULL',
    );
  }

  if (status === 'ok') detalhe.push('índice presente, nenhuma duplicata');
  return { item: 3, nome: 'backfill não duplica evento', status, detalhe };
}

// ------------------------------------------------- §12.4 — full-recompute puro

/**
 * O §1.3 diz que o classificador nunca escreve em `member_events`. Isso é
 * invariante de código, não estado de banco: em vez de rodar o recompute e
 * comparar contagens (que escreveria em profiles), lê a fonte e procura
 * qualquer escrita na tabela.
 */
function checkFullRecompute(): Check {
  const detalhe: string[] = [];
  let status: Status = 'ok';

  const dir = join(process.cwd(), 'src', 'classifier');
  const escrita = /memberEvent\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/;

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    if (escrita.test(source)) {
      status = 'falha';
      detalhe.push(`src/classifier/${file} escreve em member_events`);
    }
  }

  const cli = readFileSync(join(process.cwd(), 'src', 'cli', 'classify.ts'), 'utf8');
  if (!cli.includes('--full-recompute')) {
    status = 'falha';
    detalhe.push('flag --full-recompute ausente em src/cli/classify.ts');
  }

  if (status === 'ok') detalhe.push('flag presente; nenhuma escrita em member_events');
  return { item: 4, nome: '--full-recompute não toca member_events', status, detalhe };
}

// --------------------------------------------- §12.5 — nenhum texto no banco

/**
 * §3: o banco guarda que houve mensagem e o comprimento dela, nunca o conteúdo.
 * Checa o schema real (não o schema.prisma) porque drift de migration é
 * exatamente o caso que a conferência manual não pega.
 */
async function checkSemTexto(): Promise<Check> {
  const detalhe: string[] = [];
  let status: Status = 'ok';

  const suspeito = /content|texto|conteudo|body|message|raw/i;

  /**
   * `contentLength` e `messageId` casam com o padrão e são exatamente o que o
   * §3 manda guardar: a medida e a referência, nunca o texto. O sufixo é o que
   * separa métrica de conteúdo.
   */
  const metrica = /(Length|Count|Size|Id|Hash)$/;
  const cheiroDeTexto = (nome: string): boolean => suspeito.test(nome) && !metrica.test(nome);

  const colunas = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('member_events', 'member_profiles', 'level_transitions')
  `;
  for (const coluna of colunas) {
    if (cheiroDeTexto(coluna.column_name)) {
      status = 'falha';
      detalhe.push(`coluna suspeita: ${coluna.table_name}.${coluna.column_name}`);
    }
  }

  const chaves = await prisma.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT jsonb_object_keys(metadata::jsonb) AS key FROM member_events
  `;
  for (const { key } of chaves) {
    if (cheiroDeTexto(key)) {
      status = 'falha';
      detalhe.push(`chave suspeita em member_events.metadata: ${key}`);
    }
  }

  /**
   * O nome da chave é palpite; o tamanho do valor é prova. Nada que o coletor
   * grava passa de ~64 caracteres (hash) — string longa em metadata só pode ser
   * texto de mensagem que vazou para dentro do event store.
   */
  const [longos] = await prisma.$queryRaw<{ n: number; exemplo: string | null }[]>`
    SELECT COUNT(*)::int AS n, MIN(kv.key) AS exemplo
    FROM member_events e, jsonb_each_text(e.metadata::jsonb) kv
    WHERE length(kv.value) > 100
  `;
  if ((longos?.n ?? 0) > 0) {
    status = 'falha';
    detalhe.push(`${longos?.n} valor(es) de metadata com +100 caracteres (ex.: ${longos?.exemplo})`);
  }

  if (status === 'ok') {
    detalhe.push(
      `${colunas.length} colunas e ${chaves.length} chaves limpas, nenhum valor com +100 caracteres`,
    );
  }
  return { item: 5, nome: 'nenhum texto de mensagem no banco', status, detalhe };
}

// ------------------------------------------- §12.6 — bot sem escrita no Discord

const BITS: Readonly<Record<string, bigint>> = {
  CREATE_INSTANT_INVITE: 0n, KICK_MEMBERS: 1n, BAN_MEMBERS: 2n, ADMINISTRATOR: 3n,
  MANAGE_CHANNELS: 4n, MANAGE_GUILD: 5n, ADD_REACTIONS: 6n, VIEW_AUDIT_LOG: 7n,
  PRIORITY_SPEAKER: 8n, STREAM: 9n, VIEW_CHANNEL: 10n, SEND_MESSAGES: 11n,
  SEND_TTS_MESSAGES: 12n, MANAGE_MESSAGES: 13n, EMBED_LINKS: 14n, ATTACH_FILES: 15n,
  READ_MESSAGE_HISTORY: 16n, MENTION_EVERYONE: 17n, CONNECT: 20n, SPEAK: 21n,
  MUTE_MEMBERS: 22n, DEAFEN_MEMBERS: 23n, MOVE_MEMBERS: 24n, MANAGE_NICKNAMES: 27n,
  MANAGE_ROLES: 28n, MANAGE_WEBHOOKS: 29n, MANAGE_GUILD_EXPRESSIONS: 30n,
  MANAGE_EVENTS: 33n, MANAGE_THREADS: 34n, CREATE_PUBLIC_THREADS: 35n,
  CREATE_PRIVATE_THREADS: 36n, SEND_MESSAGES_IN_THREADS: 38n, MODERATE_MEMBERS: 40n,
  CREATE_GUILD_EXPRESSIONS: 43n, CREATE_EVENTS: 44n, SEND_VOICE_MESSAGES: 46n,
  SEND_POLLS: 49n,
};

/** Tudo que altera o servidor. §10: "Nenhuma permissão de escrita." */
const ESCRITA = Object.keys(BITS).filter(
  (nome) => !['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'MANAGE_GUILD', 'CONNECT'].includes(nome),
);

const REQUERIDAS = ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'MANAGE_GUILD'];

function has(perms: bigint, nome: string): boolean {
  const bit = BITS[nome];
  return bit !== undefined && (perms & (1n << bit)) !== 0n;
}

async function discord<T>(path: string): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface Role {
  id: string;
  name: string;
  permissions: string;
}

/**
 * Permissão no Discord é união de cargos, e `@everyone` entra na conta de todo
 * mundo — inclusive de bot. Por isso o resultado separa o que vem dos cargos
 * próprios do bot (falha: dá para remover) do que vem de `@everyone` (aviso:
 * só sai com override por canal ou mexendo no servidor inteiro).
 */
async function checkPermissoes(): Promise<Check> {
  const detalhe: string[] = [];
  let status: Status = 'ok';

  const guildId = env.DISCORD_GUILD_ID;
  const me = await discord<{ id: string }>('/users/@me');
  const guild = await discord<{ owner_id: string }>(`/guilds/${guildId}`);
  const member = await discord<{ roles: string[] }>(`/guilds/${guildId}/members/${me.id}`);
  const roles = await discord<Role[]>(`/guilds/${guildId}/roles`);

  const porId = new Map(roles.map((role) => [role.id, role]));
  const everyone = BigInt(porId.get(guildId)?.permissions ?? '0');

  let proprios = 0n;
  for (const id of member.roles) {
    const role = porId.get(id);
    if (role) proprios |= BigInt(role.permissions);
  }

  if (guild.owner_id === me.id) {
    status = 'falha';
    detalhe.push('o bot é DONO do servidor — tem tudo, e isso não se remove por cargo');
  }

  for (const nome of REQUERIDAS) {
    if (!has(proprios | everyone, nome)) {
      status = 'falha';
      detalhe.push(`FALTA permissão requerida pelo §10: ${nome}`);
    }
  }

  const admin = member.roles
    .map((id) => porId.get(id))
    .filter((role): role is Role => role !== undefined && has(BigInt(role.permissions), 'ADMINISTRATOR'));

  if (admin.length > 0) {
    status = 'falha';
    detalhe.push(`ADMINISTRATOR via cargo: ${admin.map((role) => role.name).join(', ')}`);
  }

  const deCargo = ESCRITA.filter((nome) => has(proprios, nome));
  if (deCargo.length > 0) {
    status = 'falha';
    for (const nome of deCargo) {
      const origem = member.roles
        .map((id) => porId.get(id))
        .filter((role): role is Role => role !== undefined && has(BigInt(role.permissions), nome))
        .map((role) => role.name);
      detalhe.push(`escrita ${nome} ← cargo ${origem.join(', ')}`);
    }
  }

  const deEveryone = ESCRITA.filter((nome) => has(everyone, nome) && !has(proprios, nome));
  if (deEveryone.length > 0) {
    if (status === 'ok') status = 'aviso';
    detalhe.push(`herdado de @everyone: ${deEveryone.join(', ')}`);
  }

  if (status === 'ok') detalhe.push('somente View Channels, Read Message History e Manage Server');
  return { item: 6, nome: 'bot sem permissão de escrita', status, detalhe };
}

// ------------------------------------------------ §12.7 — LevelTransition

async function checkTransitions(): Promise<Check> {
  const total = await prisma.levelTransition.count();
  return {
    item: 7,
    nome: 'LevelTransition populado',
    status: total > 0 ? 'ok' : 'falha',
    detalhe: [total > 0 ? `${total} transição(ões)` : 'tabela vazia — rode `pnpm classify`'],
  };
}

// ----------------------------------------------------- §12.8 — .env e git

function checkEnv(): Check {
  const detalhe: string[] = [];
  let status: Status = 'ok';

  if (run('git', ['check-ignore', '-q', '.env']).code !== 0) {
    status = 'falha';
    detalhe.push('.env não está coberto pelo .gitignore');
  }
  if (run('git', ['ls-files', '--error-unmatch', '.env.example']).code !== 0) {
    status = 'falha';
    detalhe.push('.env.example não está versionado');
  }
  if (run('git', ['ls-files', '--error-unmatch', '.env']).code === 0) {
    status = 'falha';
    detalhe.push('.env está RASTREADO pelo git — o segredo já vazou para o histórico');
  }

  if (status === 'ok') detalhe.push('.env ignorado e nunca rastreado; .env.example versionado');
  return { item: 8, nome: '.env no .gitignore, .env.example commitado', status, detalhe };
}

// ------------------------------------------------------------------- saída

const SIGLA: Readonly<Record<Status, string>> = {
  ok: '  OK  ',
  falha: ' FALHA',
  aviso: ' AVISO',
  pulado: 'PULADO',
};

const out = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

try {
  const checks: Check[] = [
    checkTypecheck(),
    checkTests(),
    await checkDedupe(),
    checkFullRecompute(),
    await checkSemTexto(),
    await checkPermissoes(),
    await checkTransitions(),
    checkEnv(),
  ];

  out('\nDefinition of done — §12\n');
  for (const check of checks) {
    out(`[${SIGLA[check.status]}] ${check.item}. ${check.nome}`);
    for (const linha of check.detalhe) out(`           ${linha}`);
  }

  const falhas = checks.filter((check) => check.status === 'falha');
  const avisos = checks.filter((check) => check.status === 'aviso');

  out();
  out(
    `${checks.filter((c) => c.status === 'ok').length}/${checks.length} ok · ` +
      `${falhas.length} falha(s) · ${avisos.length} aviso(s)`,
  );
  out();

  if (falhas.length > 0) process.exitCode = 1;
} catch (error) {
  logger.error({ err: error }, 'doctor falhou');
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
