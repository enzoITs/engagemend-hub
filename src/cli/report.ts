import { writeFileSync } from 'node:fs';

import { Command, InvalidArgumentError } from 'commander';

import { levelName } from '../classifier/level.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';
import { revealUsernames } from '../store/identity.js';
import type { EngagementLevel } from '../types/scoring.js';

/**
 * `pnpm report`                        — distribuição por nível
 * `pnpm report --members --level=4`    — membros de um nível, com os 4 eixos
 * `pnpm report --export=csv`           — export para revisão da Frente D
 * `pnpm report --export=csv --reveal`  — idem, com username (só para conferência)
 * `pnpm report --export=json`          — export para o painel (ver abaixo)
 * `pnpm report --export=json --reveal` — idem, com os nomes reais
 *
 * O export usa `memberHash`, não username (§11): a classificação humana da
 * Frente D precisa ser cega, senão a concordância mede reputação e não
 * comportamento. O `--reveal` vale para os dois formatos.
 *
 * Este CLI só LÊ `member_profiles`. Quem calcula é `pnpm classify`.
 *
 * ── Sobre o `--export=json` ─────────────────────────────────────────────────
 * Destino: o painel (`engagemend-painel-v4.html`), que tem um adaptador de
 * arquivo. O formato é o contrato do painel, não o schema do banco — os nomes
 * dos campos são os de lá (`membroId`, `ocorridoEm`, `tipo`), porque quem tem
 * de mudar quando os dois discordam é a interface, não o bot.
 *
 * Leva EVENTOS CRUS de propósito. Exportar só o perfil calculado esconderia
 * justamente o que este export existe para achar: o painel tem um port do
 * `src/classifier/` e precisa recalcular por conta dele. O bloco `perfis` vai
 * junto como GABARITO — é contra ele que o painel se compara.
 * ──────────────────────────────────────────────────────────────────────────── */

const DEFAULT_EXPORT_PATH = 'engagemend-export.csv';
const DEFAULT_JSON_PATH = 'painel.json';
const LEVELS: readonly EngagementLevel[] = [1, 2, 3, 4, 5];

/** Depois disso sem evento novo, o painel mostra a comunidade como desatualizada. */
const DIAS_ATE_DESATUALIZADA = 2;

function levelArg(value: string): EngagementLevel {
  const parsed = Number.parseInt(value, 10);
  if (!LEVELS.includes(parsed as EngagementLevel)) {
    throw new InvalidArgumentError('nível precisa ser 1, 2, 3, 4 ou 5');
  }
  return parsed as EngagementLevel;
}

function exportArg(value: string): 'csv' | 'json' {
  if (value !== 'csv' && value !== 'json') {
    throw new InvalidArgumentError('formatos suportados: csv, json');
  }
  return value;
}

/** "Ana Paula" → "AP"; "benjamin" → "BE". Duas letras, que é o que o avatar cabe. */
function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '??';
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase();
}

const program = new Command()
  .name('report')
  .description('Relatório de engajamento a partir de member_profiles')
  .option('--members', 'lista membros em vez do resumo', false)
  .option('--level <n>', 'filtra por nível (usar com --members)', levelArg)
  .option('--export <formato>', 'exporta para arquivo: csv, json', exportArg)
  .option(
    '--out <caminho>',
    `destino do export (default: ${DEFAULT_EXPORT_PATH} / ${DEFAULT_JSON_PATH})`,
  )
  .option('--reveal', 'inclui username — quebra a cegueira da revisão', false)
  .parse();

const options = program.opts<{
  members: boolean;
  level?: EngagementLevel;
  export?: 'csv' | 'json';
  out?: string;
  reveal: boolean;
}>();

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

try {
  const profiles = await prisma.memberProfile.findMany({
    orderBy: [{ currentLevel: 'desc' }, { score30d: 'desc' }],
  });

  if (profiles.length === 0) {
    process.stdout.write('\nNenhum perfil. Rode `pnpm classify` primeiro.\n\n');
    process.exitCode = 1;
  } else if (options.export === 'csv') {
    if (options.reveal) {
      logger.warn(
        'export com --reveal: o CSV vai conter username. A classificação da Frente D ' +
          'precisa ser cega — use só para conferência posterior.',
      );
    }

    const names = options.reveal
      ? await revealUsernames(profiles.map((profile) => profile.memberHash))
      : new Map<string, string>();

    const header = [
      'member_hash',
      ...(options.reveal ? ['username'] : []),
      'level',
      'level_name',
      'score_30d',
      'score_lifetime',
      'axis_consumption',
      'axis_production',
      'axis_reciprocity',
      'axis_influence',
      'first_activity_at',
      'last_activity_at',
      'level_since',
      'computed_at',
      'weights_version',
    ];

    const lines = [header.join(',')];
    for (const profile of profiles) {
      lines.push(
        [
          profile.memberHash,
          ...(options.reveal ? [names.get(profile.memberHash) ?? ''] : []),
          profile.currentLevel,
          levelName(profile.currentLevel as EngagementLevel),
          profile.score30d.toFixed(4),
          profile.scoreLifetime.toFixed(4),
          profile.axisConsumption.toFixed(2),
          profile.axisProduction.toFixed(2),
          profile.axisReciprocity.toFixed(2),
          profile.axisInfluence.toFixed(2),
          profile.firstActivityAt?.toISOString() ?? '',
          profile.lastActivityAt?.toISOString() ?? '',
          profile.levelSince.toISOString(),
          profile.computedAt.toISOString(),
          profile.weightsVersion,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    const target = options.out ?? DEFAULT_EXPORT_PATH;
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
    process.stdout.write(
      `\n${profiles.length} membros exportados para ${target}` +
        `${options.reveal ? ' (COM username)' : ' (cego, só hash)'}\n\n`,
    );
  } else if (options.export === 'json') {
    if (options.reveal) {
      logger.warn(
        'export com --reveal: o JSON vai conter os nomes reais dos membros. ' +
          'É um arquivo em disco — trate como dado pessoal.',
      );
    }

    const [events, identities, transitions, communities] = await Promise.all([
      prisma.memberEvent.findMany({ orderBy: { occurredAt: 'asc' } }),
      prisma.memberIdentity.findMany(),
      prisma.levelTransition.findMany({ orderBy: { occurredAt: 'asc' } }),
      prisma.community.findMany(),
    ]);

    const primeiro = events[0]?.occurredAt ?? null;
    const ultimo = events[events.length - 1]?.occurredAt ?? null;

    /* `event.source` é o nome da plataforma ('discord'/'youtube'/...) e
       `event.guildId` é o id externo dentro dela (guild id ou channel id) —
       juntos resolvem a `Community` sem depender de `communityId` estar
       preenchido em toda linha (o coletor ao vivo do Discord ainda não passa
       esse FK; só o backfill da migração e a ingestão do YouTube passam). */
    const comunidadePorChave = new Map(
      communities.map((community) => [`${community.platform}:${community.externalId}`, community]),
    );
    const resolverComunidade = (event: (typeof events)[number]) =>
      comunidadePorChave.get(`${event.source}:${event.guildId}`);
    const idComunidadeDefault = `discord:${env.DISCORD_GUILD_ID!}`;

    const comunidadeIdPorMembro = new Map<string, string>();
    const eventosPorComunidade = new Map<string, { ultimo: Date; total: number }>();
    for (const event of events) {
      const id = resolverComunidade(event)?.id ?? idComunidadeDefault;
      if (!comunidadeIdPorMembro.has(event.memberHash)) comunidadeIdPorMembro.set(event.memberHash, id);

      const atual = eventosPorComunidade.get(id);
      if (!atual) eventosPorComunidade.set(id, { ultimo: event.occurredAt, total: 1 });
      else {
        if (event.occurredAt > atual.ultimo) atual.ultimo = event.occurredAt;
        atual.total += 1;
      }
    }

    const membrosPorComunidade = new Map<string, number>();
    for (const id of comunidadeIdPorMembro.values()) {
      membrosPorComunidade.set(id, (membrosPorComunidade.get(id) ?? 0) + 1);
    }

    /* Banco vazio (antes da primeira coleta): sintetiza a comunidade Discord
       default, senão o export não teria comunidade nenhuma pra desenhar. */
    const comunidadesBase =
      communities.length > 0
        ? communities
        : [
            {
              id: idComunidadeDefault,
              platform: 'discord',
              externalId: env.DISCORD_GUILD_ID!,
              name: 'Discord',
            },
          ];

    const comunidades = comunidadesBase.map((community) => {
      const stats = eventosPorComunidade.get(community.id) ?? null;
      const diasSemEvento = stats ? (Date.now() - stats.ultimo.getTime()) / 86_400_000 : Infinity;

      return {
        id: community.id,
        plataforma: community.platform as 'discord' | 'youtube',
        nome: community.name,
        iniciais: iniciaisDe(community.name),
        membros: membrosPorComunidade.get(community.id) ?? 0,
        online: 0, // uma fotografia não sabe quem está online
        estadoSync:
          diasSemEvento <= DIAS_ATE_DESATUALIZADA ? ('conectada' as const) : ('desatualizada' as const),
        sincronizadaEm: stats?.ultimo.toISOString() ?? null,
      };
    });

    const membros = identities.map((identity) => {
      /* Sem `--reveal` o painel recebe o hash no lugar do nome. O alternador
         nome/hash da tela não tem o que alternar, e é assim mesmo: a regra de
         cegueira é do bot (§3 do README), não do painel. */
      const nome = options.reveal
        ? (identity.displayName ?? identity.username)
        : identity.memberHash.slice(0, 8);

      return {
        id: identity.memberHash,
        comunidadeId: comunidadeIdPorMembro.get(identity.memberHash) ?? idComunidadeDefault,
        plataforma: identity.platform as 'discord' | 'youtube',
        nome,
        arroba: options.reveal ? `@${identity.username}` : '',
        iniciais: iniciaisDe(nome),
        entrouEm: (identity.joinedAt ?? identity.firstSeenAt).toISOString(),
      };
    });

    const dump = {
      meta: {
        versao: 2,
        geradoEm: new Date().toISOString(),
        origem: 'engagemend-discord',
        nomesRevelados: options.reveal,
        weightsVersion: profiles[0]?.weightsVersion ?? null,
        classificadoEm: profiles[0]?.computedAt?.toISOString() ?? null,
        /* O painel usa isto pro aviso "coletado desde" — `voice_minutes` e
           `invite_used` não são retroativos e começam do zero no meio de
           qualquer gráfico que olhe pra trás demais. */
        coletadoDesde: primeiro?.toISOString() ?? null,
        coletadoAte: ultimo?.toISOString() ?? null,
      },

      comunidades,

      membros,

      eventos: events.map((event) => ({
        id: String(event.id),
        plataforma: event.source as 'discord' | 'youtube',
        comunidadeId: resolverComunidade(event)?.id ?? idComunidadeDefault,
        membroId: event.memberHash,
        tipo: event.eventType,
        ocorridoEm: event.occurredAt.toISOString(),
        payload: {
          ...(event.metadata as Record<string, unknown>),
          ...(event.contextId ? { canalId: event.contextId } : {}),
          ...(event.refId ? { refId: event.refId } : {}),
        },
      })),

      /* GABARITO. Não é pra desenhar — é pra comparar. O painel calcula o dele
         a partir de `eventos` e confere contra isto. Divergência é bug do port
         da Régua, porque o bot é a fonte de verdade. */
      perfis: profiles.map((profile) => ({
        membroId: profile.memberHash,
        nivel: profile.currentLevel,
        nivelNome: levelName(profile.currentLevel as EngagementLevel),
        score30d: profile.score30d,
        scoreLifetime: profile.scoreLifetime,
        eixos: {
          consumption: profile.axisConsumption,
          production: profile.axisProduction,
          reciprocity: profile.axisReciprocity,
          influence: profile.axisInfluence,
        },
        nivelDesde: profile.levelSince.toISOString(),
        primeiraAtividade: profile.firstActivityAt?.toISOString() ?? null,
        ultimaAtividade: profile.lastActivityAt?.toISOString() ?? null,
        calculadoEm: profile.computedAt.toISOString(),
        weightsVersion: profile.weightsVersion,
      })),

      transicoes: transitions.map((transition) => ({
        id: String(transition.id),
        membroId: transition.memberHash,
        de: transition.fromLevel,
        para: transition.toLevel,
        scoreEm: transition.scoreAt,
        motivo: transition.reason,
        ocorridoEm: transition.occurredAt.toISOString(),
      })),
    };

    const target = options.out ?? DEFAULT_JSON_PATH;
    writeFileSync(target, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');

    const kb = (Buffer.byteLength(JSON.stringify(dump)) / 1024).toFixed(0);
    process.stdout.write(
      `\n${target} — ${dump.comunidades.length} comunidade(s), ${dump.eventos.length} eventos, ` +
        `${membros.length} membros, ${dump.perfis.length} perfis, ${dump.transicoes.length} transições (~${kb} KB)\n` +
        `${options.reveal ? 'COM nomes reais' : 'cego, só hash'} · ` +
        `coletado de ${dump.meta.coletadoDesde?.slice(0, 10) ?? '—'} ` +
        `a ${dump.meta.coletadoAte?.slice(0, 10) ?? '—'}\n\n`,
    );
  } else if (options.members) {
    const rows = options.level
      ? profiles.filter((profile) => profile.currentLevel === options.level)
      : profiles;

    if (rows.length === 0) {
      process.stdout.write(`\nNenhum membro no nível ${options.level}.\n\n`);
    } else {
      const names = options.reveal
        ? await revealUsernames(rows.map((profile) => profile.memberHash))
        : new Map<string, string>();
      if (options.reveal) logger.warn('--reveal: mostrando username');

      const idWidth = options.reveal ? 24 : 18;
      process.stdout.write(
        `\n${pad(options.reveal ? 'MEMBRO' : 'HASH', idWidth)}LVL  SCORE   CONS  PROD  RECIP  INFL  ÚLTIMA ATIVIDADE\n`,
      );
      for (const profile of rows) {
        const label = options.reveal
          ? (names.get(profile.memberHash) ?? profile.memberHash.slice(0, 12))
          : profile.memberHash.slice(0, 16);
        process.stdout.write(
          pad(label, idWidth) +
            pad(profile.currentLevel, 5) +
            pad(profile.score30d.toFixed(1), 8) +
            pad(profile.axisConsumption.toFixed(0), 6) +
            pad(profile.axisProduction.toFixed(0), 6) +
            pad(profile.axisReciprocity.toFixed(0), 7) +
            pad(profile.axisInfluence.toFixed(0), 6) +
            (profile.lastActivityAt?.toISOString().slice(0, 10) ?? '—') +
            '\n',
        );
      }
      process.stdout.write(`\n${rows.length} membro(s)\n\n`);
    }
  } else {
    const total = profiles.length;
    const computedAt = profiles[0]?.computedAt;
    const weightsVersion = profiles[0]?.weightsVersion ?? '—';

    process.stdout.write(
      `\npesos ${weightsVersion} | calculado em ${computedAt?.toISOString() ?? '—'} | ${total} membros\n\n`,
    );
    process.stdout.write('LEVEL  NOME          MEMBROS  %       SCORE MÉDIO  CONS  PROD  RECIP  INFL\n');

    for (const level of LEVELS) {
      const rows = profiles.filter((profile) => profile.currentLevel === level);
      if (rows.length === 0) continue;

      const mean = (pick: (row: (typeof rows)[number]) => number): number =>
        rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;

      process.stdout.write(
        pad(level, 7) +
          pad(levelName(level), 14) +
          pad(rows.length, 9) +
          pad(`${((rows.length / total) * 100).toFixed(1)}%`, 8) +
          pad(mean((row) => row.score30d).toFixed(1), 13) +
          pad(mean((row) => row.axisConsumption).toFixed(0), 6) +
          pad(mean((row) => row.axisProduction).toFixed(0), 6) +
          pad(mean((row) => row.axisReciprocity).toFixed(0), 7) +
          mean((row) => row.axisInfluence).toFixed(0) +
          '\n',
      );
    }

    const transitions = await prisma.levelTransition.groupBy({
      by: ['reason'],
      _count: { _all: true },
    });
    if (transitions.length > 0) {
      process.stdout.write(
        `\ntransições: ${transitions.map((row) => `${row.reason}=${row._count._all}`).join('  ')}\n`,
      );
    }
    process.stdout.write('\n');
  }
} catch (error) {
  logger.error({ err: error }, 'report falhou');
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
