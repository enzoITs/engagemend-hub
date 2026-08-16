# EngageMend — entrega para desenvolvimento

Documento de handoff. Escrito em 2026-08-15.

Você recebeu **duas metades de um sistema só**: um bot que coleta engajamento no
Discord e um painel que mostra esse engajamento. Elas já se falam — mas por
arquivo, não por API. Este documento diz o que está pronto, o que está provado,
o que falta, e como rodar cada parte.

---

## 1. A tese do produto, em um parágrafo

Comunidade não se mede por like. O bot registra **quatorze tipos de ação** num
servidor de Discord (mensagem, resposta recebida, menção, solução em fórum,
convite usado, minutos em voz…), aplica decaimento no tempo, e classifica cada
membro em cinco níveis. O que distingue o modelo de um contador de mensagens são
os **quatro eixos** — consumo, produção, reciprocidade, influência — e as
**portas de eixo**: pontuação sozinha não promove. Quem manda 300 mensagens e
não recebe resposta nenhuma não vira Líder, porque a porta de influência barra.
É isso que impede spam de subir de nível.

---

## 2. O que tem em cada pasta

| Pasta | O que é | Repositório git? |
|---|---|---|
| `engagemend-discord/` | O bot: coletor Discord → Postgres → classificador | Sim |
| `interface_da_engagemend/` | O painel: um arquivo HTML, sem build | Não |

### Regra que governa as duas

> **Em qualquer conflito entre o bot e a interface, muda a interface.**

O bot tem histórico coletado e usuários reais; o painel não tem nenhum usuário.
Onde os dois discordarem, quem está errado é o painel. Isso não é preferência —
está aplicado no código: a régua do painel é um **port** de `src/classifier/`,
não uma segunda implementação.

---

## 3. O bot — `engagemend-discord/`

### Stack

TypeScript estrito, Node ≥ 20.12, pnpm, Prisma + PostgreSQL (Neon), discord.js,
Zod para validação de ambiente, Vitest, Commander nos CLIs, Pino para log.

### Subir o projeto

```bash
pnpm install
cp .env.example .env          # preencher — ver seção 6
pnpm prisma migrate dev
```

### Comandos

| Comando | O que faz |
|---|---|
| `pnpm collect` | Sobe o coletor em tempo real e fica no ar |
| `pnpm collect --list-channels` | Lista os canais do guild e encerra |
| `pnpm backfill --channel=X --limit=500` | Backfill paginado, com checkpoint em `.backfill-state.json` |
| `pnpm classify` | Calcula níveis a partir do event store |
| `pnpm classify --full-recompute` | Reaplica os pesos atuais ignorando a histerese |
| `pnpm report` | Distribuição por nível |
| `pnpm report --export=csv` | Export cego, por `memberHash` |
| `pnpm report --export=json` | Export para o painel (ver seção 5) |
| `pnpm ver` | Visão em português, com nome real, para quem não programa |
| `pnpm dod` | Definition of done: oito checagens contra banco, git e API do Discord |
| `pnpm typecheck` / `pnpm test` | `tsc --noEmit` / Vitest (131 casos) |

⚠️ **`pnpm doctor` NÃO roda o script do repo** — é subcomando embutido do pnpm.
Use `pnpm run doctor` ou `pnpm dod`.

⚠️ **Argumentos com `--` são engolidos pelo pnpm.** Para passar flags a um CLI,
chame o `tsx` direto:
`npx tsx src/cli/report.ts --export=json --reveal --out caminho.json`

### Modelo de dados

Quatro tabelas. A arquitetura inteira depende da primeira regra abaixo.

| Tabela | Papel |
|---|---|
| `member_events` | **Append-only.** Nenhum código de produção roda UPDATE ou DELETE. O classificador só lê. |
| `member_identity` | A **única** tabela que liga hash ↔ pessoa real |
| `member_profiles` | Estado derivado. Pode ser truncado e reconstruído inteiro a partir dos eventos |
| `level_transitions` | O que a M2 consome é a transição, não o nível |

`member_profiles` ser descartável é o que torna `--full-recompute` barato:
recalibrar pesos não exige migração, exige rodar de novo.

`dedupe_key` (`memberHash + eventType + refId`) garante que rodar o backfill
duas vezes não duplica evento.

### Privacidade — leia antes de mexer

- O banco guarda **que** houve mensagem e o **comprimento** dela. **Nunca o
  conteúdo.**
- `member_discord_id` é pseudonimizado por HMAC-SHA256 com `MEMBER_ID_SALT`.
- Exports usam `memberHash`. A flag `--reveal` traz o username e loga um aviso —
  é só para conferência.
- `.gitignore` cobre `.env`, `engagemend-*.csv` e `painel.json` justamente
  porque os dois últimos podem conter username.

### O classificador — `src/classifier/`

| Arquivo | Conteúdo |
|---|---|
| `weights.ts` | Pesos por tipo, limiares, portas, tetos diários, `WEIGHTS_VERSION` |
| `decay.ts` | Decaimento exponencial, meia-vida 14 dias, janela de 60 |
| `axes.ts` | Os quatro eixos, normalizados pelo p90 **da comunidade** |
| `level.ts` | Nível natural + histerese de 14 dias no rebaixamento |
| `run.ts` | Orquestra o recálculo |

Detalhes que não são óbvios:

- **Normalização é relativa à comunidade.** Os eixos de uma pessoa mudam quando
  outra pessoa fica mais ativa. É p90, não máximo — um outlier achataria todos.
- **Promoção é imediata; rebaixamento exige 14 dias consecutivos abaixo.** Sem
  isso o membro oscila toda semana.
- **Tetos diários por membro/tipo/dia UTC** (15 reações, 30 mensagens, 25
  respostas). Sem eles, spam de reação vira Embaixador.
- **Mudar peso exige subir `WEIGHTS_VERSION` e rodar `--full-recompute`.**

---

## 4. O painel — `interface_da_engagemend/`

### O que é, e o que não é

Um **arquivo HTML único**, vanilla JS, sem npm, sem build, sem framework. Abre
com dois cliques (com uma ressalva na seção 5). Isso diverge do briefing
original, que pedia Next.js + TypeScript + TanStack Query + Vitest — divergência
deliberada, registrada em `_build/RELATORIO.md`.

O contrato é declarado em JSDoc; a camada de query (cache, SWR, paginação) e o
runner de teste são escritos à mão.

### Como é construído

O HTML final é a concatenação de **13 partes** em `_build/`, montada por:

```sh
sh _build/montar.sh
```

Saem dois arquivos das mesmas partes:

| Arquivo | Fonte de dados |
|---|---|
| `engagemend-painel-v4.html` | Mundo falso determinístico (padrão) |
| `engagemend-painel-v4-real.html` | `painel.json`, o export do bot |

⚠️ **Concatenar byte a byte, nunca por texto.** `00-head.part` carrega as fontes
Geist em base64; reescrever a codificação corrompe o arquivo. E `00-meta.part`
tem de vir **primeiro** — sem `<meta charset="utf-8">` o navegador decodifica
como Latin-1 e a página abre em branco.

### Testes

77 casos, runner próprio. Fora do navegador:

```sh
sh _build/testes-node/rodar.sh
```

No navegador: `await Testes.rodar()` no console, ou o botão no painel de
simulação (**Ctrl+Shift+D**).

**Testar no navegador não é opcional.** Duas falhas reais passaram por 75 testes
verdes e só apareceram lá: o `<meta charset>` ausente (página em branco) e a
prévia das Configurações presa em "Calculando…".

### A fronteira — o ponto que importa para você

Uma constante decide de onde vem todo o dado, em `_build/50-cliente.js`:

```js
const FONTE_DE_DADOS = "mock";   // "mock" | "arquivo" | "http"
```

Três adaptadores implementam **a mesma superfície de 18 métodos**:

| Adaptador | Estado |
|---|---|
| `MOCK.adaptador` | Mundo falso. Fechado numa IIFE — nenhuma tela o alcança |
| `ADAPTADOR_ARQUIVO` | Lê `painel.json`. Funciona |
| `ADAPTADOR_HTTP` | **Vaga.** Todo método lança `NotImplementedError`, e cada um tem a rota que deve chamar anotada em comentário |

`ADAPTADOR_HTTP` lançar em vez de devolver `[]` é deliberado: um método que
devolvesse lista vazia calado faria a tela mostrar "nenhum membro ainda" e
ninguém descobriria que a integração nunca foi escrita.

Quatro testes de §11 guardam essa fronteira, incluindo um verificado por
mutação (injetei uma referência a `MOCK` numa função de tela e o caso falhou
como devia).

**Escrever `ADAPTADOR_HTTP` é provavelmente a sua primeira tarefa.** As 18 rotas
já estão especificadas em comentário no próprio arquivo.

---

## 5. A integração, hoje

### O que está provado

O painel recalcula níveis por conta própria, a partir dos eventos crus, e
**concorda com o bot em 6 de 6 membros** — nível idêntico, pontuação idêntica na
casa decimal, e os quatro eixos idênticos. O port do classificador está correto
contra dado real.

O ciclo completo, hoje, é manual:

```
pnpm collect        →  escuta o Discord (fica no ar)
pnpm classify       →  calcula níveis
--export=json       →  escreve painel.json
recarregar a página →  o painel lê o arquivo
```

### Ressalvas honestas sobre o dado

| | |
|---|---|
| Eventos no banco | 172 |
| Membros | 6 |
| Cobertura | 29,6 dias (10/07 → 09/08) |
| Coletor | **Parado desde 09/08** |
| Transições | 6, **todas `initial`** |
| Pesos | `v0.1.0-uncalibrated` |

Consequências que você deve saber antes de confiar em qualquer número:

- **Só 9 dos 14 tipos de evento apareceram.** Faltam `invite_used`,
  `forum_solution`, `thread_started`, `voice_minutes` e `thread_replied` — e
  `invite_used` é o de peso 20 que sustenta a porta do nível 5. O mapeamento
  desses cinco nunca foi exercitado.
- **Os eixos com 6 membros dizem pouco.** O p90 de seis pessoas é quase "o maior
  dos seis".
- **Histerese não foi testada com dado real.** Ninguém nunca subiu nem desceu.
- **A janela de 60 dias nunca encheu.**

### Próximo passo recomendado (Etapa B)

Serviço HTTP no repo do bot implementando as 18 rotas. Recomendação registrada:
**Hono** — roda em Node, é minúsculo, e não arrasta framework para 18 rotas de
leitura. Três pendências que só existem nesta etapa:

- **Auth.** Nem que seja um token no header. O banco tem identidade de pessoas
  reais.
- **CORS.** Painel em `file://` manda `Origin: null`. A saída é servir o painel
  pela mesma origem da API, não liberar `null`.
- **`salvarConfiguracoes` deixa de ser síncrono.** Mudar peso no bot é editar
  `weights.ts`, subir `WEIGHTS_VERSION` e rodar `--full-recompute`. Vira
  `202 Accepted` + job, e a tela precisa do estado "recalculando".

### Decisão em aberto

Identidade: o padrão é nome real, com um botão na tela de Contas que troca tudo
para `memberHash`. O estado desse botão **não** vai para a URL — link
compartilhado não deve revelar identidade por acidente. Ainda não implementado.

---

## 6. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. A validação é Zod e **falha no
boot**, não em runtime — um `MEMBER_ID_SALT` ausente descoberto no meio de um
backfill significaria hashes inconsistentes num event store append-only.

| Variável | Obrigatória | O que é / como obter |
|---|---|---|
| `DATABASE_URL` | sim | Postgres via **pooler**. O projeto usa Neon. Formato: `postgresql://user:senha@ep-xxxx-pooler.regiao.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | não | Conexão **direta**, sem pooler. Só o Prisma Migrate usa — migration não funciona através do PgBouncer |
| `DISCORD_TOKEN` | sim | Token do bot, em discord.com/developers → sua aplicação → Bot → Reset Token. **Não deve ter permissão de escrita** |
| `DISCORD_GUILD_ID` | sim | Snowflake de 17–20 dígitos. No Discord: Modo Desenvolvedor ligado → botão direito no servidor → Copiar ID |
| `MEMBER_ID_SALT` | sim | Mínimo 32 caracteres. Gere com:<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LOG_LEVEL` | não | `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`. Padrão `info` |
| `NODE_ENV` | não | `development`\|`test`\|`production`. Padrão `development` |

### Três avisos sobre essas variáveis

1. **`MEMBER_ID_SALT` é irreversível na prática.** Trocar o valor reescreve todo
   o espaço de hashes e órfã o histórico coletado — os hashes novos não batem
   com nenhuma linha de `member_events`. Se for gerar um sal novo, gere sabendo
   que está começando do zero.

2. **O sal é a chave de reidentificação.** Sal + um export por hash permite
   voltar aos IDs do Discord. Ele merece o mesmo tratamento da senha do banco.

3. **Editor no Windows salva `.env` com BOM UTF-8 com facilidade**, e o parser
   nativo do Node não o remove — a primeira chave vira `﻿DATABASE_URL` e some da
   validação. `src/config/env.ts` já contorna isso, mas se aparecer erro de
   variável "ausente" que claramente está lá, é esse o motivo.

### Como os valores chegam até você

Os valores **não acompanham este pacote**, e não devem trafegar por Drive, chat
ou e-mail — um link é encaminhável e fica no histórico da organização. Peça ao
Benjamin por um gerenciador de segredos, um cofre compartilhado, ou gere os
seus próprios:

- `DISCORD_TOKEN` e `DISCORD_GUILD_ID`: você pode criar uma aplicação de teste
  própria e um servidor de teste, e trabalhar sem tocar no ambiente real.
- `MEMBER_ID_SALT`: gere o seu com o comando da tabela. Em ambiente de
  desenvolvimento não há motivo para compartilhar o sal de produção — e há um
  bom motivo para não fazer isso.
- `DATABASE_URL`: para desenvolvimento, um Postgres local com
  `pnpm prisma migrate dev` resolve. O banco de produção tem dados de pessoas
  reais.

---

## 7. Documentos que vieram junto

No painel, dentro de `interface_da_engagemend/_build/`:

| Arquivo | Conteúdo |
|---|---|
| `BRIEFING.md` | O briefing original, na íntegra |
| `HANDOFF.md` | Ordem de montagem, armadilhas que já morderam, como testar |
| `RELATORIO.md` | As respostas que o §7 do briefing pede, incluindo as divergências assumidas |
| `INTEGRACAO.md` | As cinco decisões da integração com o bot, com os porquês |
| `PLANO-INTEGRACAO.md` | O passo a passo da Etapa A e o resultado da conferência |

No bot, `README.md` cobre arquitetura, privacidade e a Definition of done.

**Comece pelo `HANDOFF.md` do painel** — ele abre com o estado atual e com as
armadilhas, que é o que economiza tempo de verdade.
