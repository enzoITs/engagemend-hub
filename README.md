# EngageMend — Coletor e Classificador de Engajamento (Discord, M1)

Mede engajamento de membros de um servidor do Discord e classifica cada pessoa
em cinco níveis, a partir de eventos observados — nunca de conteúdo de mensagem.

A especificação completa está em [`prompt-discord-engagement-m1.md`](prompt-discord-engagement-m1.md).
Este README é o operacional; as seções citadas (§1, §3, §9…) são de lá.

## Princípio: coletor primeiro, algoritmo depois

Voz e convites **não são retroativos**. O Discord não guarda log de
`voiceStateUpdate`, e "quem convidou quem" só existe se um bot estiver cacheando
`invite.uses` no momento do `guildMemberAdd`. Cada dia sem o coletor no ar é um
dia desse dado perdido para sempre.

O algoritmo se refina a qualquer momento a partir do event store; o dado perdido
não volta. Por isso o coletor tem prioridade sobre qualquer refinamento de score.

## Setup

```bash
pnpm install
cp .env.example .env      # preencher DATABASE_URL, DISCORD_TOKEN, MEMBER_ID_SALT…
pnpm prisma migrate dev
```

`MEMBER_ID_SALT` precisa de 32+ caracteres. **Trocar esse valor invalida todo o
histórico já coletado** — os hashes mudam e o event store órfã.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm collect` | Sobe o coletor em tempo real e fica no ar |
| `pnpm collect --list-channels` | Lista os canais do guild e encerra |
| `pnpm backfill --channel=X --limit=500` | Backfill paginado, com checkpoint em `.backfill-state.json` |
| `pnpm classify` | Calcula níveis a partir do event store |
| `pnpm classify --full-recompute` | Reaplica os pesos atuais ignorando a histerese |
| `pnpm report` | Distribuição por nível (§11) |
| `pnpm report --export=csv` | Export cego, por `memberHash`, para revisão da Frente D |
| `pnpm ver` | Visão em português, com nome real, para quem não programa |
| `pnpm dod` | Roda a Definition of done do §12 inteira |

`pnpm classify` não roda sozinho. Com o coletor no ar, os eventos entram
continuamente e os perfis ficam para trás até o próximo `classify`.

## Definition of done — `pnpm dod`

O §12 era uma lista conferida na mão, e conferência manual envelhece mal: o cargo
do bot muda no Discord, uma migration adiciona coluna, e a lista continua
marcada. `pnpm dod` mede os oito itens contra o estado real — banco, git e API do
Discord — e sai com código 1 se algum falhar. `--fast` pula `tsc` e `vitest`.

O nome é `dod` porque `doctor` é subcomando embutido do pnpm: `pnpm doctor` roda
o diagnóstico do próprio pnpm e nunca chega no script. `pnpm run doctor` também
funciona.

Dois itens merecem nota, porque não são todos igualmente fortes:

- **Item 4** (`--full-recompute` não toca `member_events`) é checagem de código,
  não de banco: varre `src/classifier/*.ts` procurando escrita na tabela. Rodar o
  recompute de verdade para comparar contagens escreveria em `member_profiles`, e
  um comando de diagnóstico não deveria ter efeito colateral.
- **Item 3** (dedupe) checa duas coisas. O índice `@@unique([memberHash,
  eventType, refId])` só protege quando `refId` existe: no Postgres NULL ≠ NULL,
  então duas linhas com `refId` nulo passam pelo índice. Eventos de voz caem
  nesse caso, e o check os conta à parte.

## Permissões do bot

O bot precisa de exatamente três permissões (§10), bitfield `66592`:

- `View Channels`
- `Read Message History`
- `Manage Server` — só para ler a lista de convites

**Nenhuma permissão de escrita**, e o cargo do bot não deve ser nenhum cargo
administrativo do servidor. Permissão no Discord é *união* de todos os cargos:
um bot em um cargo com `Administrator` tem tudo, por mais limpo que esteja o
cargo próprio dele.

Não remova o cargo dedicado do bot achando que é limpeza: ele é a única fonte de
`Manage Server`, e sem isso o invite tracker para — o dado de convite não é
retroativo.

### Herança do `@everyone` — decisão registrada

O `@everyone` do servidor concede `Send Messages` e outras permissões de escrita
a todo mundo, e **todo membro herda o `@everyone`, bot inclusive**. Não existe
como um bot ter menos que o `@everyone` no nível do servidor.

Essa herança foi **aceita**. `pnpm dod` reporta o item 6 como **AVISO**, não
falha, quando toda a escrita restante vem do `@everyone` e nenhuma vem de cargo
próprio do bot.

O motivo: a alternativa seria negar `Send Messages` para o cargo do bot canal a
canal, e isso é config que envelhece — canal novo nasce sem o deny e ninguém
percebe. O coletor não tem caminho de escrita nenhum no código (só handlers
`.on()`, nenhuma chamada de envio), então o risco real é a permissão existir no
papel, não o bot escrever.

O `dod` continua falhando de verdade se qualquer escrita voltar por cargo do bot,
que é o caso que importa e o que de fato aconteceu uma vez.

## Privacidade

O banco guarda **que** houve mensagem e o **comprimento** dela, nunca o conteúdo
(§3). `member_discord_id` é pseudonimizado por HMAC-SHA256 com `MEMBER_ID_SALT`;
`member_identity` é a única tabela que liga hash a identidade real.

O export do `pnpm report --export=csv` usa `memberHash`, não username — a
classificação humana da Frente D precisa ser cega, senão mede reputação e não
comportamento. O flag `--reveal` traz o username e loga um aviso; é só para
conferência posterior.

`member_events` é append-only. Nenhum código de produção roda UPDATE ou DELETE
nessa tabela, e o classificador só lê — é isso que torna `--full-recompute`
barato.
