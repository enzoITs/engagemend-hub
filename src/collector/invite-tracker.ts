import type { Guild, Invite } from 'discord.js';

import { logger } from '../lib/logger.js';

/**
 * Cache de usos de convite.
 *
 * O Discord não conta a ninguém quem convidou quem. A única forma de saber é
 * guardar `invite.uses` de todos os convites e, quando alguém entra, procurar
 * qual contador subiu. Isso significa que o dado só existe se o bot estava no
 * ar naquele segundo — não é retroativo, não tem backfill, não volta (§9).
 *
 * Requer a permissão `Manage Server`. Sem ela, o tracker se desliga e loga:
 * é melhor perder `invite_used` do que derrubar o coletor inteiro.
 */

export interface ResolvedInvite {
  code: string;
  inviterId: string | null;
}

interface CachedInvite {
  uses: number;
  inviterId: string | null;
}

export class InviteTracker {
  #cache = new Map<string, CachedInvite>();
  #enabled = false;

  get enabled(): boolean {
    return this.#enabled;
  }

  get size(): number {
    return this.#cache.size;
  }

  /** Chamar no `ready`. Falha silenciosa e desliga o tracker se faltar permissão. */
  async prime(guild: Guild): Promise<boolean> {
    try {
      const invites = await guild.invites.fetch();
      this.#cache.clear();
      for (const invite of invites.values()) this.#remember(invite);
      this.#enabled = true;
      logger.info({ invites: this.#cache.size }, 'invite tracker pronto');
      return true;
    } catch (error) {
      this.#enabled = false;
      logger.warn(
        { err: error },
        'não consegui ler os convites do guild — invite_used fica desligado. ' +
          'Confira a permissão Manage Server.',
      );
      return false;
    }
  }

  onCreate(invite: Invite): void {
    if (!this.#enabled) return;
    this.#remember(invite);
  }

  onDelete(invite: Invite): void {
    if (!this.#enabled) return;
    this.#cache.delete(invite.code);
  }

  /**
   * Chamar no `guildMemberAdd`. Compara o estado atual com o cache e devolve o
   * convite cujo contador subiu.
   *
   * Devolve `null` quando não dá para decidir: convite já expirado/apagado ao
   * atingir o limite, entrada por vanity URL, ou dois usos entre dois fetches.
   * Chutar aqui creditaria 20 pontos de influência à pessoa errada.
   */
  async resolveUsedInvite(guild: Guild): Promise<ResolvedInvite | null> {
    if (!this.#enabled) return null;

    let current;
    try {
      current = await guild.invites.fetch();
    } catch (error) {
      logger.warn({ err: error }, 'falha ao reler convites no guildMemberAdd');
      return null;
    }

    const candidates: ResolvedInvite[] = [];

    for (const invite of current.values()) {
      const previous = this.#cache.get(invite.code);
      const uses = invite.uses ?? 0;

      if (previous && uses > previous.uses) {
        candidates.push({ code: invite.code, inviterId: invite.inviterId ?? previous.inviterId });
      } else if (!previous && uses > 0) {
        // Convite criado enquanto o bot estava fora: não dá para saber se este
        // uso é o da pessoa que acabou de entrar.
        logger.debug({ code: invite.code }, 'convite novo com usos — ignorado nesta rodada');
      }
    }

    // Reconstrói o cache com o estado atual, inclusive convites sumidos.
    this.#cache.clear();
    for (const invite of current.values()) this.#remember(invite);

    if (candidates.length !== 1) {
      logger.debug(
        { candidates: candidates.length },
        candidates.length === 0
          ? 'nenhum convite teve uso incrementado — entrada por vanity ou convite esgotado'
          : 'mais de um convite mudou entre fetches — ambíguo, não credito ninguém',
      );
      return null;
    }

    return candidates[0] ?? null;
  }

  #remember(invite: Invite): void {
    this.#cache.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? null,
    });
  }
}
