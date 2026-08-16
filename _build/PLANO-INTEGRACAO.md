# Etapa A — dado real no painel, passo a passo

Escrito em 2026-08-15. Detalha o passo 4 do `INTEGRACAO.md` ("o que eu faria
primeiro, na ordem"), agora que os passos 1–3 estão feitos.

---

## ✅ RESULTADO (2026-08-15) — Fases 0 a 3 feitas

**O port da Régua está certo.** 6 de 6 membros com nível idêntico ao do bot,
pontuação idêntica na casa decimal, e os quatro eixos idênticos:

```
ITS               painel=2 bot=2   15.2 / 15.2
Jonah             painel=2 bot=2   39.1 / 39.1
Sab               painel=2 bot=2   35.9 / 35.9
Beatriz _Siriani  painel=2 bot=2    9.8 /  9.8
tsenjbk           painel=2 bot=2   26.8 / 26.8
jao7              painel=3 bot=3   42.8 / 42.8
```

Nenhuma divergência de mapeamento nos 9 tipos de evento que existem no banco.
Os 5 que faltam (`invite_used`, `forum_solution`, `thread_started`,
`voice_minutes`, `thread_replied`) continuam sem conferência — não há dado.

**A suspeita do Passo 3.3 foi resolvida:** o campo `score30d` do bot bate
exatamente com a pontuação do painel, que usa janela de 60 dias. O nome do campo
é que está velho; a conta é a mesma.

**O que a Fase 0 achou e continua valendo como ressalva:** 172 eventos, 6
membros, 29,6 dias de cobertura, coletor parado desde 09/08, todas as transições
`initial`. A concordância acima é forte no que cobre e não cobre eixos com
volume, portas de nível 4/5, nem histerese — nada disso tem dado para exercitar.

**O que ficou pra Fase 4** (nada dela foi feito): o aviso "coletado desde", o
alternador nome/hash, e olhar as telas com dado real num navegador.

---

**Onde estamos:** o painel já tem os nomes de nível do bot, os 14 tipos de
evento e a Régua portada de `src/classifier/`. O que ele não tem é **um único
dado real** — `50-cliente.js:171` ainda diz `const ADAPTADOR_ATIVO =
MOCK.adaptador`.

**Objetivo desta etapa:** ver seus dados no painel, e — mais importante —
descobrir onde o port da Régua discorda do bot. Não é ligar backend. É
conferir mapeamento enquanto conferir ainda é barato.

---

## Fase 0 — Conferir que existe o que integrar

Antes de escrever qualquer linha. Se o banco estiver vazio, todo o resto é
teatro.

**Passo 0.1** — `pnpm doctor` (o repo tem esse comando) e confirmar que o
Postgres responde com o `DATABASE_URL` do `.env`.

**Passo 0.2** — Contar o que há: linhas em `member_events`, `member_identity`,
`member_profiles`, `level_transitions`; e a data do evento mais antigo e do mais
novo. Isso decide se dá pra conferir decaimento (precisa de mais de 14 dias de
histórico) e janela (60 dias).

**Passo 0.3** — Se `member_profiles` estiver velho ou vazio, rodar
`pnpm classify` para ter perfis frescos. Eles são o **gabarito** da Fase 3.

**Critério de saída:** você sabe quantos eventos, de quantos membros, cobrindo
quantos dias.

---

## Fase 1 — `--export=json` no bot

O trabalho é menor do que o `INTEGRACAO.md` supunha: `src/cli/report.ts` já tem
a máquina toda (`--export`, `--out`, `--reveal`, `csvCell`). Falta um formato.

**Passo 1.1** — `exportArg` passa a aceitar `'csv' | 'json'`. Hoje ele lança
`InvalidArgumentError` em qualquer coisa que não seja `csv`. Uma linha.

**Passo 1.2 — decidir o que vai no arquivo. É a decisão de projeto da fase.**

O CSV de hoje exporta **perfis** (nível e score já calculados). Para o painel
isso não basta, e aceitar isso seria perder a etapa inteira:

- o feed precisa de **eventos**, não de perfis;
- `simularRegua` — a prévia ao vivo das Configurações — precisa recalcular a
  partir dos eventos quando o usuário arrasta um peso;
- e, sobretudo, exportar só o perfil calculado **esconderia exatamente o bug que
  esta etapa existe para achar**: se o painel recebe o nível pronto, o port da
  Régua nunca é exercitado contra dado real.

Então o JSON leva as três coisas:

| bloco | de onde vem | pra que serve no painel |
|---|---|---|
| `eventos` | `member_events` | feed, e entrada da Régua |
| `membros` | `member_identity` (+ `joinedAt`) | nomes, "entrou em", drawer |
| `perfis` | `member_profiles` | **gabarito**: o que o bot concluiu |
| `transicoes` | `level_transitions` | notificações e histórico de nível |
| `meta` | `weightsVersion`, datas de corte, guild | "coletado desde", versão |

`perfis` não é para desenhar a tela — é para a Fase 3 comparar. O painel calcula
o dele e confere contra esse.

**Passo 1.3 — privacidade: manter a regra do bot, não a do painel.**

O README é explícito: o export usa `memberHash`, e `--reveal` traz o username
com aviso no log. O JSON obedece igual — sem `--reveal`, o bloco `membros` sai
só com hash e sem `username`/`displayName`.

Isso encosta na Decisão 4 do `INTEGRACAO.md` (padrão nome real, botão pra
esconder). Resolução: o **alternador do painel só liga se o arquivo tiver nome**.
Sem `--reveal`, o painel fica em modo hash e o botão aparece desabilitado com o
motivo. A regra do bot ganha, como sempre.

**Passo 1.4** — Volume. Dezenas de milhares de eventos em JSON dão poucos MB,
o navegador aguenta. Mas conferir o tamanho real na saída e, se passar de ~50 MB,
cortar por janela (`--dias=90`) em vez de inventar streaming.

**Critério de saída:** `pnpm report --export=json --out painel.json` gera um
arquivo, e `pnpm test` continua verde.

---

## Fase 2 — `ADAPTADOR_ARQUIVO` no painel

Terceira implementação da mesma superfície, no mesmo arquivo que as outras duas
(`50-cliente.js`). Nenhuma tela é tocada — se alguma precisar ser, a fronteira
está furada e §11 acusa.

**Passo 2.1** — Escrever `ADAPTADOR_ARQUIVO` com os 18 métodos. Os de leitura
consultam o JSON carregado em memória e aplicam a Régua de `60-regua.js`, que já
é o port do bot.

**Passo 2.2 — decidir o que as mutações fazem.** `conectar`, `reconectar`,
`ressincronizar`, `desconectar` não têm sentido sobre uma fotografia. Proposta:
lançar erro tipado com texto honesto ("esta é uma exportação, não uma conexão
ao vivo"), nunca devolver sucesso falso — é a mesma razão pela qual
`ADAPTADOR_HTTP` lança em vez de devolver `[]`.

`salvarConfiguracoes` é a exceção: pode gravar em `localStorage`, porque mexer
em peso e ver a prévia mudar é justamente o que se quer testar.

**Passo 2.3 — de onde vem o arquivo.** Duas opções, e a segunda é melhor: (a)
`<input type="file">` na tela de conexão; (b) `fetch("./painel.json")` ao lado
do HTML, já que o handoff manda servir por HTTP de qualquer jeito. Começar por
(b), que não exige interface nova; (a) se incomodar.

**Passo 2.4** — `mesmaSuperficie()` passa a comparar **três** adaptadores, e os
três testes de fronteira de §11 passam a valer sobre os três. O `INTEGRACAO.md`
já previa isso.

**Passo 2.5** — A pílula "novas atividades" não tem o que mostrar numa
fotografia. Ela precisa sumir ou dizer o porquê, senão parece quebrada.

**Critério de saída:** trocar uma linha em `50-cliente.js` e o painel abrir com
dado seu. Os 76 testes continuam passando com o mock ativo.

---

## Fase 3 — A prova: o painel concorda com o bot?

Esta fase é o motivo de todas as outras. Sem ela, a Etapa A não entregou nada
que a Etapa B não entregasse melhor.

**Passo 3.1** — Para cada membro, comparar o nível que o painel calcula com o
`currentLevel` do bloco `perfis`. **Qualquer divergência é bug do port**, não do
bot — a regra do Benjamin.

**Passo 3.2** — Comparar também os quatro eixos (`axisConsumption`,
`axisProduction`, `axisReciprocity`, `axisInfluence`), que é onde o erro vai
estar se estiver: eles normalizam pelo p90 **da comunidade**, e o
`INTEGRACAO.md` já anotou esse risco.

**Passo 3.3** — Conferir uma suspeita concreta: `MemberProfile` tem campo
`score30d`, e a Régua portada usa **janela de 60 dias**. Ou o nome do campo
está velho, ou as duas janelas são coisas diferentes, ou há divergência real.
Descobrir antes de confiar em qualquer comparação de score.

**Passo 3.4** — Virar cada divergência achada em caso de teste em `90-testes.js`,
com o número do bot como esperado.

**Critério de saída:** um número — "X de Y membros com nível idêntico" — e a
lista dos que não bateram, com o porquê.

---

## Fase 4 — O que só aparece quando o dado é real

Coisas que o mundo falso não tinha como revelar.

**Passo 4.1 — uma guild, várias comunidades.** O bot serve **um**
`DISCORD_GUILD_ID`; o painel é multi-comunidade e a tela de Contas foi desenhada
pra lista. O schema tem `guildId` em `member_events`, mas **não existe tabela de
comunidade** — nome, ícone e `estadoSync` não têm de onde vir. O export precisa
sintetizar esse registro. Decidir se o painel mostra uma comunidade só, e como a
tela fica com lista de um item.

**Passo 4.2 — `retroativo: false`.** `voice_minutes` e `invite_used` só existem
a partir do dia em que o coletor subiu. Num gráfico de 90 dias eles começam do
zero no meio, e sem aviso isso parece queda de engajamento. O `INTEGRACAO.md` já
mandou a tela dizer "coletado desde <data>" — o `meta` do export leva a data.

**Passo 4.3 — Decisão 4**, o alternador nome/hash, agora com a restrição do
Passo 1.3.

---

## Fase 5 — Etapa B (API), depois

Só depois que a Fase 3 fechar. O ganho de fazer nesta ordem é que a API nasce
implementando um contrato **já conferido contra dado real**, em vez de dois
erros somados. Auth, CORS e o `salvarConfiguracoes` assíncrono estão no
`INTEGRACAO.md` e não mudam.

---

## Resumo da ordem

| # | passo | onde | depende de |
|---|---|---|---|
| 0 | conferir o banco | bot | — |
| 1 | `--export=json` | bot | 0 |
| 2 | `ADAPTADOR_ARQUIVO` | painel | 1 (só do formato) |
| 3 | comparar com o gabarito | os dois | 1 e 2 |
| 4 | ajustes que o dado real revelar | painel | 3 |
| 5 | API | bot | 3 |

As fases 1 e 2 podem ser feitas em paralelo assim que o formato do JSON estiver
decidido (Passo 1.2) — o painel não precisa esperar o comando ficar pronto,
basta um arquivo de exemplo.
