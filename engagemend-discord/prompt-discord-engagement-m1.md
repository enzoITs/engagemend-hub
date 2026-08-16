# EngageMend — Discord Engagement Collector & Classifier (M1)

> **Prompt de execução para Claude Code (terminal).**
> Ler o documento inteiro antes de escrever qualquer linha.
> Executar **seção por seção**, na ordem. Ao final de cada seção: rodar o build check daquela seção, mostrar o `git diff`, **parar e aguardar aprovação**. Não commitar sem aprovação explícita.

---

## 0. Escopo e não-escopo

### O que este sistema faz
Observa um servidor Discord, registra o que cada membro fez (histórico + tempo real), e classifica cada membro em um dos cinco níveis de engajamento.

### O que este sistema **NÃO** faz nesta etapa
- ❌ Não sugere gatilhos, ações ou playbooks
- ❌ Não envia mensagem, DM ou notificação para ninguém
- ❌ Não tem front-end, dashboard ou API HTTP pública
- ❌ Não armazena conteúdo de mensagem (ver §3)
- ❌ Não usa `GUILD_PRESENCES` (dado de presença de jogo é volátil, sem histórico e intent pesada)

Se em qualquer ponto surgir a tentação de implementar algo da lista acima: **não implemente**. Deixe um `// TODO: M3` e siga.

### Níveis
```
1 = Observador
2 = Participante
3 = Contribuinte
4 = Líder
5 = Embaixador
```

---

## 1. Princípio arquitetural inegociável

Três camadas **separadas**, com dependência unidirecional:

```
COLETOR  ──escreve──▶  EVENT STORE  ──lê──▶  CLASSIFICADOR
(bot + backfill)       (append-only)         (job puro)
```

Regras que derivam disso e não podem ser violadas:

1. O **classificador nunca chama a API do Discord**. Ele lê exclusivamente da tabela `member_events`.
2. O **coletor nunca calcula nível**. Ele só normaliza e grava eventos.
3. `member_events` é **append-only**. Nada de `UPDATE` ou `DELETE` nessa tabela em código de produção.
4. Recalcular todo o histórico com pesos novos deve ser **um comando** (`pnpm classify --full-recompute`). Isso vai acontecer várias vezes quando a calibração da Frente D devolver os ajustes.

**Motivo:** os pesos estão errados agora e vão mudar. Se o cálculo destruir o dado bruto, cada mudança de peso custa uma nova coleta.

---

## 2. Stack

| Camada | Escolha |
|---|---|
| Runtime | Node 20 + TypeScript strict |
| Discord | `discord.js` v14 |
| ORM | Prisma |
| Banco | PostgreSQL (Neon) |
| Testes | Vitest |
| CLI | `tsx` + `commander` |
| Log | `pino` |

Sem framework web. Sem Next. Isso é um worker + CLI.

---

## 3. Decisão de privacidade (afeta o schema, não é opcional)

**Não armazenar o texto das mensagens.** Guardar apenas:
- `message_id` (referência)
- atributos derivados: comprimento em caracteres, tem anexo, tipo do anexo, é resposta, ID de quem foi respondido, quantidade de menções

Isso reduz o banco em ordens de grandeza e torna o acordo de uso de dados da Frente C trivial de assinar — "coletamos metadados de interação, não conteúdo".

**Pseudonimização:** `member_discord_id` é armazenado como hash HMAC-SHA256 usando `MEMBER_ID_SALT` do `.env`. Uma tabela `member_identity` separada guarda o mapeamento hash → ID real + username, e é a única que precisa de tratamento especial em export. Todo o resto do sistema opera sobre o hash.

---

## 4. Mapeamento de arquivos

```
discord-collector/
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── types/
│   │   └── scoring.ts              # ← ESPELHO do contrato compartilhado. Ver §5.
│   ├── config/
│   │   ├── env.ts                  # validação de env com zod, falha no boot
│   │   └── channels.ts             # mapa channel_id → categoria semântica
│   ├── collector/
│   │   ├── bot.ts                  # gateway, tempo real
│   │   ├── backfill.ts             # varredura histórica paginada
│   │   ├── invite-tracker.ts       # cache de usos de convite
│   │   └── normalize.ts            # payload Discord → MemberEvent (PURA, testável)
│   ├── store/
│   │   ├── events.ts               # insert em lote, idempotente
│   │   └── identity.ts             # hash/lookup de membro
│   ├── classifier/
│   │   ├── weights.ts              # tabela de pesos — ARQUIVO ÚNICO de calibração
│   │   ├── decay.ts                # janela móvel + decaimento
│   │   ├── axes.ts                 # agregação nos 4 eixos
│   │   ├── level.ts                # score + eixos → nível
│   │   └── run.ts                  # orquestra: lê eventos → grava perfis
│   ├── cli/
│   │   ├── collect.ts
│   │   ├── backfill.ts
│   │   ├── classify.ts
│   │   └── report.ts
│   └── lib/logger.ts
└── tests/
    ├── normalize.test.ts
    ├── decay.test.ts
    ├── level.test.ts
    └── fixtures/
```

---

## 5. Contrato compartilhado

`src/types/scoring.ts` é **espelho** de `/lib/types/scoring.ts` do monorepo principal. Os tipos `EngagementLevel`, `EventType` e `MemberEvent` devem ser **idênticos** ao contrato principal — mesmos nomes, mesmos valores de enum.

Se algo faltar no contrato principal, **não invente aqui**. Pare, liste o que falta, e me avise. Divergência entre os dois arquivos quebra a ingestão por CSV da Frente C.

```ts
export type EngagementLevel = 1 | 2 | 3 | 4 | 5;

export type EventSource = 'discord' | 'csv' | 'manual';

export interface MemberEvent {
  memberHash: string;
  source: EventSource;
  eventType: EventType;
  occurredAt: Date;
  contextId?: string;      // channel_id
  refId?: string;          // message_id
  metadata: Record<string, unknown>;
}
```

---

## 6. Schema Prisma

```prisma
model MemberIdentity {
  memberHash      String   @id
  discordId       String   @unique
  username        String
  displayName     String?
  isBot           Boolean  @default(false)
  joinedAt        DateTime?
  firstSeenAt     DateTime @default(now())
  @@map("member_identity")
}

model MemberEvent {
  id            BigInt   @id @default(autoincrement())
  memberHash    String
  guildId       String
  source        String   @default("discord")
  eventType     String
  contextId     String?
  refId         String?
  metadata      Json     @default("{}")
  occurredAt    DateTime
  ingestedAt    DateTime @default(now())

  @@unique([memberHash, eventType, refId], name: "dedupe_key")
  @@index([memberHash, occurredAt])
  @@index([occurredAt])
  @@map("member_events")
}

model MemberProfile {
  memberHash        String   @id
  currentLevel      Int
  score30d          Float
  scoreLifetime     Float
  levelSince        DateTime
  firstActivityAt   DateTime?
  lastActivityAt    DateTime?

  axisConsumption   Float    @default(0)
  axisProduction    Float    @default(0)
  axisReciprocity   Float    @default(0)
  axisInfluence     Float    @default(0)

  computedAt        DateTime
  weightsVersion    String
  @@map("member_profiles")
}

model LevelTransition {
  id           BigInt   @id @default(autoincrement())
  memberHash   String
  fromLevel    Int?
  toLevel      Int
  scoreAt      Float
  reason       String   // "promotion" | "demotion" | "initial" | "recompute"
  occurredAt   DateTime @default(now())
  @@index([memberHash, occurredAt])
  @@map("level_transitions")
}
```

**Nota sobre `dedupe_key`:** garante que rodar o backfill duas vezes não duplica evento. Use `createMany({ skipDuplicates: true })`.

**Nota sobre `LevelTransition`:** o dado que a M2 vai consumir é a *transição*, não o nível. Grave desde já, mesmo sem ninguém olhando ainda.

---

## 7. Dicionário de eventos e pesos

`src/classifier/weights.ts` — arquivo único, exportando um objeto versionado.

```ts
export const WEIGHTS_VERSION = 'v0.1.0-uncalibrated';
```

| `eventType` | Peso | Eixo | Retroativo? |
|---|---|---|---|
| `reaction_given` | 1 | consumption | ✅ |
| `message_sent` | 2 | production | ✅ |
| `message_substantial` (>120 chars) | 3 | production | ✅ |
| `media_posted` (anexo img/vídeo) | 5 | production | ✅ |
| `reply_given` | 4 | reciprocity | ✅ |
| `thread_started` | 6 | production | ✅ |
| `thread_replied` | 4 | reciprocity | ✅ |
| `reaction_received` | 3 | influence | ✅ |
| `reply_received` | 5 | influence | ✅ |
| `mention_received` | 4 | influence | ✅ |
| `forum_solution` | 12 | influence | ✅ |
| `voice_minutes` (por 10min) | 5 | consumption | ❌ |
| `newcomer_welcomed` | 8 | reciprocity | ✅ |
| `invite_used` | 20 | influence | ❌ |

⚠️ **Estes pesos são chute calibrável, não verdade.** Existem para serem corrigidos contra a classificação cega da Frente D. Se a concordância vier abaixo de 80%, o problema está quase sempre aqui — não na engine. Por isso ficam num arquivo só, versionado, e por isso o recompute total precisa ser barato.

### Regras anti-ruído (obrigatórias)
- Descartar mensagem com < 20 caracteres **e** sem anexo
- Descartar mensagem só-emoji
- Ignorar reação na própria mensagem
- Ignorar auto-resposta (responder a si mesmo)
- Agrupar mensagens consecutivas do mesmo autor, mesmo canal, dentro de 60s → conta como **uma**
- Ignorar todos os bots (`isBot = true`)

### Tetos diários (obrigatórios)
```ts
export const DAILY_CAPS: Partial<Record<EventType, number>> = {
  reaction_given: 15,
  message_sent: 30,
  reply_given: 25,
};
```
Sem isso, spam de reação vira Líder.

### Categorias de canal
`src/config/channels.ts` mapeia `channel_id` → `'general' | 'gameplay' | 'support' | 'announcements' | 'offtopic' | 'ignored'`.
Canais `ignored` não geram evento nenhum. Anexo de vídeo em canal `gameplay` gera `media_posted` com `metadata.kind = 'gameplay_clip'` — deriva do histórico de mensagens, e portanto é **retroativo**, ao contrário de presença de jogo.

---

## 8. Cálculo

### Decay
Janela móvel de 30 dias com decaimento exponencial, meia-vida de 14 dias:

```
peso_efetivo = peso_base * 0.5 ^ (dias_desde_evento / 14)
```

Eventos com mais de 60 dias não entram no `score30d` (mas continuam no `scoreLifetime` e no event store).

**Motivo:** score acumulado cresce para sempre e trava o membro num nível que ele já não ocupa. Sem decay, a engine não consegue rebaixar ninguém — e rebaixamento é metade do sinal.

### Eixos
Cada eixo é a soma dos pesos efetivos dos eventos daquele eixo, normalizada 0–100 pelo percentil 90 da comunidade (não pelo máximo — um outlier achata todo mundo).

### Nível
Cortes por score **e** por porta de eixo. Score sozinho não promove:

```ts
// Limiares iniciais — recalibrar contra Frente D
Nível 5 (Embaixador):  score >= 80  && axisInfluence   >= 60
Nível 4 (Líder):       score >= 55  && axisInfluence   >= 35
Nível 3 (Contribuinte):score >= 30  && axisReciprocity >= 20
Nível 2 (Participante):score >= 8
Nível 1 (Observador):  resto
```

**Motivo da porta de eixo:** quem manda 300 mensagens e ninguém responde não é Contribuinte — é ruído. A separação entre níveis vem de sinal *recebido* e sinal *direcionado a outros*, não de volume emitido.

### Histerese (obrigatória)
Para **rebaixar**, o score precisa ficar abaixo do limiar do nível por **14 dias consecutivos**. Sem isso o membro oscila entre níveis toda semana e o dado da M2 vira serrilhado inútil.

---

## 9. Ordem de execução — **crítica**

> **Voz e convites não são retroativos.** O Discord não guarda log de `voiceStateUpdate`, e "quem convidou quem" só existe se um bot estiver cacheando `invite.uses` no momento do `guildMemberAdd`. Cada dia sem o coletor no ar é um dia desse dado perdido para sempre.
>
> Por isso: **coletor primeiro, algoritmo depois.** O algoritmo se refina a qualquer momento; o dado perdido não volta.

Seções na ordem:

| # | Seção | Build check |
|---|---|---|
| A | Setup, env, Prisma, migration, contrato de tipos | `pnpm prisma migrate dev && pnpm tsc --noEmit` |
| B | `normalize.ts` puro + testes Vitest com fixtures | `pnpm vitest run tests/normalize.test.ts` |
| C | Bot em tempo real + invite tracker + `store/events.ts` | `pnpm collect` conecta e grava evento real |
| D | Backfill paginado | `pnpm backfill --channel=X --limit=500` |
| E | Classificador (decay, eixos, level) + testes | `pnpm vitest run` |
| F | CLI de relatório | `pnpm report` |

---

## 10. Intents do Discord

Habilitar no Developer Portal (as três primeiras são **privilegiadas**):
- `MESSAGE_CONTENT` — necessário para medir comprimento e detectar anexo
- `GUILD_MEMBERS` — entradas/saídas
- `GUILD_VOICE_STATES` — voz
- `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, `GUILD_INVITES`

Permissões do bot: `View Channels`, `Read Message History`, `Manage Server` (só para ler convites). **Nenhuma permissão de escrita.** Se o token tiver `Send Messages`, remova.

### Rate limit no backfill
`GET /channels/{id}/messages` → 100 por request, paginar por `before`. Respeitar `X-RateLimit-Remaining` e `Retry-After`. Backoff exponencial. Checkpoint em disco (`.backfill-state.json`) para retomar de onde parou sem refazer.

---

## 11. Saída do CLI de relatório

`pnpm report` imprime tabela:

```
LEVEL  MEMBROS  %      SCORE MÉDIO   CONS  PROD  RECIP  INFL
1      412      68.2%  3.1           12    2     0      0
2      118      19.5%  16.4          38    24    6      2
3      52       8.6%   41.2          55    61    34     11
4      18       3.0%   62.8          61    58    52     44
5      4        0.7%   88.1          70    66    71     82
```

`pnpm report --members --level=4` lista membros do nível com os quatro eixos.

`pnpm report --export=csv` exporta para revisão da Frente D. **O export usa `memberHash`, não username** — a classificação humana precisa ser cega. Um flag separado `--reveal` (que loga um aviso) traz o username, só para conferência posterior.

---

## 12. Definition of done

- [ ] `pnpm tsc --noEmit` limpo, strict
- [ ] `pnpm vitest run` verde, cobertura de `normalize`, `decay`, `level`
- [ ] Backfill roda duas vezes seguidas sem duplicar evento (dedupe)
- [ ] `--full-recompute` reprocessa tudo sem tocar em `member_events`
- [ ] Nenhum texto de mensagem no banco
- [ ] Bot sem permissão de escrita
- [ ] `LevelTransition` populado
- [ ] `.env` no `.gitignore`; `.env.example` commitado

---

## 13. Regras de execução

1. Uma seção por vez. Build check ao fim de cada uma.
2. **Mostrar `git diff` e aguardar aprovação antes de qualquer commit.** Não commitar por iniciativa própria.
3. Não instalar dependência fora da lista do §2 sem perguntar.
4. Não alterar `weights.ts` nem os limiares do §8 sem eu pedir — são superfície de calibração, não detalhe de implementação.
5. Se algo neste documento estiver ambíguo ou parecer errado: **pare e pergunte**. Não escolha sozinho.
6. Não implemente nada do §0 "não-escopo".

**Comece pela Seção A.**
