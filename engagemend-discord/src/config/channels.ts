/**
 * Mapa `channel_id` → categoria semântica (§7).
 *
 * Canais `ignored` não geram evento nenhum — nem para quem escreve, nem para
 * quem reage, nem para quem é mencionado.
 */

export type ChannelCategory =
  | 'general'
  | 'gameplay'
  | 'support'
  | 'announcements'
  | 'offtopic'
  | 'ignored';

/**
 * Canal não mapeado cai aqui. `general` e não `ignored` de propósito: um canal
 * novo criado no servidor deve continuar gerando evento até alguém decidir o
 * contrário — dado não coletado não volta.
 */
export const DEFAULT_CHANNEL_CATEGORY: ChannelCategory = 'general';

/**
 * Canais mapeados. O que não estiver aqui cai em DEFAULT_CHANNEL_CATEGORY.
 *
 * TODO: ainda faltam os canais de `gameplay` — sem pelo menos um, nenhum vídeo
 * vira `media_posted` com `kind: 'gameplay_clip'` (§7).
 */
export const CHANNEL_CATEGORIES: Readonly<Record<string, ChannelCategory>> = {
  '1525100097623556178': 'general', // geral
  '1533125455895466214': 'ignored', // musicas-dos-bot-amigo
};

/**
 * Nome legível de cada canal, só para saída humana (`pnpm ver`).
 *
 * O event store guarda `contextId` (o id do canal) e nada mais — nome de canal
 * é dado mutável e não tem por que virar histórico. Este mapa é a tradução na
 * hora de mostrar, e sai desatualizado se alguém renomear um canal.
 * Atualizar com `pnpm collect --list-channels`.
 */
export const CHANNEL_NAMES: Readonly<Record<string, string>> = {
  '1525100097623556178': 'geral',
  '1533125455895466214': 'musicas-dos-bot-amigo',
  '1528004748710776933': 'normal',
  '1530557706480652328': 'outra call',
  '1527643393952448512': 'trabalhando...🖥️',
};

export function resolveChannelName(channelId: string | null | undefined): string | null {
  if (!channelId) return null;
  return CHANNEL_NAMES[channelId] ?? null;
}

export function resolveChannelCategory(
  channelId: string,
  map: Readonly<Record<string, ChannelCategory>> = CHANNEL_CATEGORIES,
): ChannelCategory {
  return map[channelId] ?? DEFAULT_CHANNEL_CATEGORY;
}
