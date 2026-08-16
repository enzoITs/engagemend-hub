# Integração painel ↔ bot do Discord — decisões e plano

Escrito em 2026-08-14, depois de ler `Documents\engagemend-discord` inteiro.

Contexto: o painel (`engagemend-painel-v4.html`) foi construído com dados falsos
e uma fronteira única de troca. O bot é o backend real: coletor Discord →
Postgres append-only → classificador. Este documento decide como os dois se
encontram.

**A conclusão que governa tudo o resto:** o bot pensa melhor que o painel. Ele
tem eixos, portas e histerese; o painel tem limiar puro. Então a integração não
é ligar um no outro — é o painel aprender o modelo do bot. Onde os dois
discordarem, **o bot ganha**, porque ele tem histórico coletado e o painel não
tem usuário.

---

## Decisão 1 — Nomenclatura dos níveis: o bot manda

| nível | passa a ser | era no painel |
|---|---|---|
| 1 | Observador | Observador |
| 2 | Participante | Participante |
| 3 | Contribuinte | Contribui**dor** |
| 4 | **Líder** | Embaixador |
| 5 | **Embaixador** | Líder |

**Por quê.** Três razões, em ordem de peso:

1. `level_transitions` já tem linhas gravadas com essa numeração. Trocar no bot
   reescreveria o significado de dado passado — uma promoção registrada como
   "toLevel: 5" passaria a querer dizer outra coisa. O painel não tem um único
   usuário; o custo de mudar é seis linhas.
2. A ordem do bot é internamente coerente: `invite_used` tem peso 20 e é o
   evento mais valioso do sistema, no eixo de influência, que é justamente a
   porta do nível 5. Quem traz gente de fora chega ao topo. "Embaixador" é o
   nome certo pra isso — e é a tese do produto ("sair do teto do like").
3. O §0 do briefing congelou os rótulos do painel, mas o §0 é sobre **layout
   auditado**, não sobre taxonomia de produto. Está no relatório final como
   conflito resolvido a favor do briefing; este vira o segundo conflito, agora
   resolvido a favor do dado real.

**Custo:** `NIVEIS` em `30-fundacao.js`. Seis linhas, mais o registro no
relatório.

---

## Decisão 2 — Tipos de evento: o painel aprende os 14

Não espremer 14 em 9. Expandir o painel.

**Por quê.** Os cinco tipos que o painel não tem (`reaction_received`,
`reply_received`, `mention_received`, `forum_solution`, e a separação
`message_substantial`) são exatamente o eixo de **influência**. É ele que
distingue "mandei 300 mensagens" de "300 pessoas me responderam". Colapsar os
tipos apaga essa distinção, e com ela some a única coisa que impede spam de
virar Líder.

Como o painel guarda os tipos numa lista de tokens (`TIPOS_EVENTO`), acrescentar
cinco é contido: rótulo, ícone, peso e eixo.

### Tabela de mapeamento

| tipo (bot) | rótulo no painel | eixo | peso | ícone | retroativo |
|---|---|---|---|---|---|
| `invite_used` | Convite usado | influência | 20 | `convite` | **não** |
| `forum_solution` | Solução no fórum | influência | 12 | `estrela` | sim |
| `newcomer_welcomed` | Boas-vindas | reciprocidade | 8 | `pessoas` | sim |
| `thread_started` | Tópico aberto | produção | 6 | `documento` | sim |
| `media_posted` | Mídia publicada | produção | 5 | `documento` | sim |
| `reply_received` | Resposta recebida | influência | 5 | `resposta` | sim |
| `voice_minutes` | Minutos em voz | consumo | 5 | `presenca` | **não** |
| `mention_received` | Menção recebida | influência | 4 | `arroba` | sim |
| `reply_given` | Resposta dada | reciprocidade | 4 | `resposta` | sim |
| `thread_replied` | Resposta em tópico | reciprocidade | 4 | `resposta` | sim |
| `reaction_received` | Reação recebida | influência | 3 | `coracao` | sim |
| `message_substantial` | Mensagem longa | produção | 3 | `balao` | sim |
| `message_sent` | Mensagem | produção | 2 | `balao` | sim |
| `reaction_given` | Reação dada | consumo | 1 | `coracao` | sim |

**Dado × recebido precisa ser distinguível a olho.** Mesmo ícone com rótulo
diferente não basta num chip de 28px. Proposta: seta de entrada nos recebidos
(`seta-baixo` sobreposta) ou prefixo `↙` no rótulo curto. Decidir ao implementar,
olhando na tela.

**O que morre:** `entrou` e `saiu`. O bot não emite esses tipos — a data de
entrada vive em `member_identity.joinedAt`. O painel usa isso no drawer
("Entrou na comunidade em …") e some com os dois chips de filtro.

**`retroativo: false` precisa aparecer na interface.** `voice_minutes` e
`invite_used` só existem a partir do dia em que o coletor subiu. Um gráfico de 90
dias vai mostrar esses dois começando do zero no meio, e sem aviso isso parece
bug ou queda de engajamento. A tela tem que dizer "coletado desde <data>".

---

## Decisão 3 — A Régua do painel vira um port do classificador do bot

Esta é a decisão grande, e a que resolve o problema mais sério.

Hoje `60-regua.js` é uma invenção paralela: limiar puro sobre pontuação. O
resultado é que a **prévia ao vivo das Configurações mentiria** — ela diz "12
pessoas subiriam" olhando só pontos, e o bot não promoveria essas 12, porque
elas não passariam na porta de influência.

Uma prévia que mente é pior que prévia nenhuma: ela é o argumento de venda da
tela, e seria falso.

**Solução:** substituir `60-regua.js` por um port de `src/classifier/*` do bot —
`decay.ts`, `axes.ts`, `level.ts`, `weights.ts`. Não reescrever: portar, com os
mesmos números e os mesmos comentários explicando os porquês.

O que vem junto:

- **Meia-vida 14 dias** (era 30) e **janela de 60 dias** (não existia).
- **Quatro eixos** normalizados pelo p90 da comunidade — consumo, produção,
  reciprocidade, influência.
- **Portas de eixo:** nível 5 exige `influence ≥ 60`; nível 4, `≥ 35`; nível 3,
  `reciprocity ≥ 20`.
- **Histerese de 14 dias** no rebaixamento.
- **Tetos diários** (`DAILY_CAPS`): 15 reações, 30 mensagens, 25 respostas.

**Impacto na tela de Configurações.** Ela deixa de ser "arraste os pesos" e passa
a ter três seções: pesos por tipo, portas de eixo por nível, e decaimento. A
prévia passa a mostrar o que de fato aconteceria — inclusive "3 pessoas têm
pontuação de nível 4 mas não passam na porta de influência", que é informação
melhor que o número sozinho.

**Impacto no gerador falso.** `40-mock.js` calcula `pontuar()` com o modelo
antigo. Precisa passar a produzir os 14 tipos e calcular os quatro eixos, senão
o mundo falso deixa de ser um ensaio honesto do real.

**Risco anotado:** `AXIS_NORMALIZATION_PERCENTILE` normaliza pelo p90 **da
comunidade**. Isso significa que os eixos de uma pessoa mudam quando outra
pessoa fica mais ativa. A prévia ao vivo tem que recalcular o p90 junto, senão
erra por baixo em comunidade que cresce.

---

## Decisão 4 — Identidade: nome real, com botão de esconder

Padrão é nome real; um botão na tela de Contas troca tudo para `memberHash`.

**Por quê.** As duas políticas são certas, em momentos diferentes. A tela de
Contas só tem valor pra quem coordena se mostrar quem é a pessoa — é o "motivo
de alguém pagar", nas palavras do briefing. E a calibragem cega da Frente D é uma
prática real que o README defende com um argumento bom (medir comportamento, não
reputação).

Um alternador atende os dois e custa pouco: a API devolve os dois campos, a tela
escolhe qual pinta. O estado do alternador **não** vai pra URL — link
compartilhado não deve revelar identidade por acidente.

---

## Decisão 5 — Caminho: export JSON antes de API

Duas etapas, nesta ordem.

### Etapa A — `pnpm export --json` + adaptador de arquivo

Um comando novo no bot que despeja o event store no formato do contrato, e um
terceiro adaptador no painel que lê esse arquivo.

**Por quê antes da API.** O mapeamento das Decisões 2 e 3 é a parte que pode
estar errada, e é barata de corrigir agora e cara depois. Validar contra dado
real **antes** de existir servidor significa que, quando a API for escrita, ela
implementa um contrato já conferido. Além disso:

- Sem CORS, sem auth, sem hospedagem, sem processo no ar.
- Reversível: é um arquivo, apaga e acabou.
- Você vê seus dados reais no painel no mesmo dia.

**Limite honesto:** é uma fotografia. Não atualiza sozinho, e a pílula de "novas
atividades" não terá o que mostrar. Para conferir o mapeamento, não importa.

O adaptador de arquivo é a terceira implementação da mesma superfície — e as três
continuam guardadas pelo teste `mesmaSuperficie()`, que passa a comparar três em
vez de dois.

### Etapa B — API HTTP

Serviço no repo do bot, implementando as 18 rotas que `ADAPTADOR_HTTP` já declara
em comentário. Recomendo **Hono**: roda em Node, é minúsculo, e não arrasta o
peso de um framework para 18 rotas de leitura.

Pendências a decidir só nesta etapa (não antes):

- **Auth.** Nem que seja um token no header, mas tem que existir antes de sair
  do localhost — o banco tem identidade de pessoas reais.
- **CORS.** O painel em `file://` manda `Origin: null`. A saída é servir o painel
  pela mesma origem da API, e aí o problema some. Recomendo isso em vez de
  liberar `null` no CORS.
- **`salvarConfiguracoes` deixa de ser síncrono.** No bot, mudar peso é editar
  `weights.ts`, subir `WEIGHTS_VERSION` e rodar `--full-recompute`. Vira
  `202 Accepted` + um job, e a tela precisa de estado "recalculando". O painel já
  trata a mutação como falível; o que muda é a semântica do sucesso.

---

## O que eu faria primeiro, na ordem

1. **Níveis** (Decisão 1) — 6 linhas, destrava tudo, zero risco.
2. **Os 14 tipos** (Decisão 2) — `TIPOS_EVENTO` + ícones + o gerador falso.
3. **Port do classificador** (Decisão 3) — é o item grande; refazer
   `60-regua.js`, `pontuar()` do mock, e a tela de Configurações.
4. **`pnpm export --json`** no bot + `ADAPTADOR_ARQUIVO` no painel (Etapa A).
5. Rodar contra o dado real e **corrigir o mapeamento** onde ele errar.
6. Só então a API (Etapa B).

Os passos 1–3 são no painel e não dependem do bot estar rodando. O passo 4 exige
o banco acessível (`DATABASE_URL` preenchido).

## O que continua verdadeiro

A promessa do relatório final não muda: **um arquivo muda quando o backend
chega** — `50-cliente.js`. A Decisão 5 acrescenta um terceiro adaptador ao mesmo
arquivo, e as três guardas de fronteira de §11 continuam valendo, agora sobre
três implementações.
