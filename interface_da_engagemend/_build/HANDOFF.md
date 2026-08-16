# EngageMend painel v4 — estado da construção

Última atualização: 2026-08-15

## ✅ O painel está lendo dado real do bot (2026-08-15)

A Etapa A da integração está feita. **A Régua portada concorda com o bot em
6 de 6 membros** — nível idêntico, pontuação idêntica na casa decimal e os
quatro eixos idênticos. Detalhes em `PLANO-INTEGRACAO.md`.

Duas saídas, das mesmas 13 partes, montadas por `sh _build/montar.sh`:

| arquivo | fonte |
|---|---|
| `engagemend-painel-v4.html` | mundo falso de §4 (padrão; é o que §11 exercita) |
| `engagemend-painel-v4-real.html` | `painel.json`, o export do bot |

A troca é a constante `FONTE_DE_DADOS`, no topo do §6 de `50-cliente.js` —
`"mock"` \| `"arquivo"` \| `"http"`. É a mesma linha que o relatório prometia.

Para gerar/atualizar o export, no repo do bot:

```sh
npx tsx src/cli/report.ts --export=json --reveal \
  --out "C:/Users/KABUM/Desktop/interface_da_engagemend/painel.json"
```

`--reveal` traz os nomes reais; sem ele o painel abre em modo hash. (Via `pnpm`
os argumentos não passam — `pnpm run report -- --export=json` é engolido pelo
próprio pnpm. Chamar o `tsx` direto.)

**A conferência contra o gabarito é um método fora do contrato:**
`await CLIENTE.compararComOBot()` no console, com a build `-real`.

## ✅ A remontagem pendente foi feita (2026-08-15)

O arquivo final estava atrás das partes; foi remontado e está em dia.
`engagemend-painel-v4.html` — **459.647 bytes**, igual à soma das 13 partes,
`<meta charset="utf-8">` nos primeiros bytes e `</script>` no fim.

**76 casos passando, 0 falhando** (1,5 s) — os 75 mais "a prévia das
Configurações calcula sozinha ao abrir a tela". Rodado no node, com o stub de
DOM; ver "Como testar sem navegador".

⚠ **Ainda não foi conferido no navegador.** A extensão do Chrome não estava
conectada nesta sessão. Vale o aviso da seção "Como testar NO navegador": node
prova lógica e não prova tela. Das duas falhas que já escaparam por lá, o
`<meta charset>` está conferido por inspeção de bytes e a prévia presa em
"Calculando…" agora tem teste de regressão — mas o olho no navegador continua
faltando.

## ⚠ PRIMEIRA COISA AO RETOMAR

1. Abrir as **duas** builds no navegador. Nenhuma das duas foi vista por olho
   humano ainda — a extensão do Chrome não conectou nas sessões de 15/08, e a
   seção "Como testar NO navegador" continua valendo: node prova lógica e não
   prova tela.
   - `engagemend-painel-v4.html` → `await Testes.rodar()`, **77 esperados**
   - `engagemend-painel-v4-real.html` → `await CLIENTE.compararComOBot()`,
     **6 de 6 esperados**
2. Fase 4 do `PLANO-INTEGRACAO.md`: o que o dado real revelar na tela.
3. Decisão 4 do `INTEGRACAO.md` (alternador nome/hash) continua aberta.

### Estado da integração com o bot

A sessão de 2026-08-14 fez as decisões 1, 2 e 3 do `INTEGRACAO.md`:
níveis renomeados (4 = Líder, 5 = Embaixador), os catorze tipos de evento do
bot, e a Régua substituída por um **port de `src/classifier/` do
`engagemend-discord`** — decaimento 14 dias, janela 60, tetos diários, quatro
eixos normalizados pelo p90 e portas de eixo por nível.

**Falta:** decisão 4 (identidade com alternância nome/hash) e decisão 5
(`pnpm export --json` no bot + `ADAPTADOR_ARQUIVO` no painel).

Regra que o Benjamin deu e que governa tudo: **em qualquer conflito entre o bot
e a interface, muda a interface.** O bot é a fonte de verdade.

## Onde parei

**Terminado.** As 13 partes estão escritas e montadas em
`../engagemend-painel-v4.html` (449 KB, um arquivo, abre com dois cliques).
76 casos de §11 passando, três guardas conferidas por mutação.

O relatório que o §7 do briefing pede está em `RELATORIO.md`.

`engagemend-painel-v3_1.html` **continua intocado**, e a decisão mudou de
propósito: o plano antigo era sobrescrevê-lo quando §10b entrasse, mas o v4
merece nome próprio. O v3.1 fica como estava até o Benjamin comparar os dois e
decidir. Cópia de segurança em `../engagemend-painel-v3_1.original.html`.

`previa-shell.html` está **obsoleto** — era a prévia sem §10b. Pode apagar.

## ✅ O briefing foi recuperado (2026-08-14)

Estava na transcrição da sessão de 2026-08-12, que o Claude Code guarda em
disco: `~/.claude/projects/C--Users-KABUM/92b9bf99-7401-4f3f-959b-2d3f642ac3b2.jsonl`,
linha 37 (mensagem do usuário, 13.780 caracteres). Extraído e salvo **na
íntegra** em `_build/BRIEFING.md`.

Com isso caem os dois bloqueios que estavam anotados aqui: a cópia das telas
(§2 do briefing) e o relatório final (§7). As 9 tarefas do §6 também voltaram.

Atenção à numeração — são duas, não confundir: os `§N` da tabela de montagem
abaixo são numeração **interna desta build**; os `§N do briefing` citados nas
decisões são do documento, que vai de §0 a §7.

## Como o arquivo final é montado

Concatenar, nesta ordem, os arquivos desta pasta:

| ordem | arquivo | o que é | estado |
|---|---|---|---|
| 1 | `00-head.part` | linhas 1–397 do original: `<title>`, fontes Geist em base64, CSS auditado. **Verbatim, não reescrever.** | pronto |
| 2 | `10-css.part` | CSS aditivo do v4 + `<div id="app">` + abertura do `<script>` | pronto |
| 3 | `20-icones.part` | a constante `ICONES` do original. **Verbatim** (8,6 KB numa linha só). | pronto |
| 3b | `25-logo.part` | `LOGO_ENGAGEMEND`: a logo real em base64, gerada de `public/logo.png` do site e reduzida a 400px de largura. **Verbatim** (41 KB numa linha só). | pronto |
| 4 | `30-fundacao.js` | §1 ícones novos, átomos visuais, §2 tokens de domínio, §3 contrato + erros tipados, formatadores | pronto |
| 5 | `40-mock.js` | §4 PRNG, gerador do mundo, latência, adaptador mock | pronto |
| 6 | `50-cliente.js` | §5 adaptador HTTP (tudo lança) + §6 CLIENTE | pronto |
| 7 | `60-regua.js` | §7 régua pura | pronto |
| 8 | `70-query.js` | §8 camada de query (cache/SWR/paginação) + render por regiões + §9 roteador | pronto |
| 9 | `80-shell.js` | §10a shell: sidebar, rail 3×2, topbar, seletor, delegação, foco/a11y, estados de dados | pronto |
| 10 | `85-telas.js` | §10b as 4 telas + drawer, paleta, busca, fluxo de conexão, painel de simulação — cobre §2.1–§2.7 e §3 do briefing | pronto |
| 11 | `90-testes.js` | §11 runner + 35 casos + `iniciar()` + fechamento `</script>` | pronto |

`80-telas.js` virou dois arquivos (`80-shell.js` e `85-telas.js`) pra o shell —
que o briefing não muda — poder ser escrito sem esperar o texto.

## Como remontar o arquivo final

```sh
cd _build
cat 00-meta.part 00-head.part 10-css.part 20-icones.part 25-logo.part \
    30-fundacao.js 40-mock.js 50-cliente.js 60-regua.js 70-query.js \
    80-shell.js 85-telas.js 90-testes.js > ../engagemend-painel-v4.html
```

`00-meta.part` tem de vir **primeiro** e não é decoração: sem
`<meta charset="utf-8">` o navegador decodifica o arquivo como Latin-1, os
acentos viram bytes soltos e o JavaScript morre com `SyntaxError` na primeira
string acentuada — **página em branco**. O v3.1 já era assim; só apareceu quando
o painel foi aberto por HTTP pela primeira vez. O `viewport` do mesmo bloco é o
que faz os pontos de quebra do CSS valerem no celular.

No Windows, remontar com PowerShell:

```powershell
$b = "C:\Users\KABUM\Desktop\interface_da_engagemend\_build"
$partes = @("00-meta.part","00-head.part","10-css.part","20-icones.part",
  "25-logo.part","30-fundacao.js","40-mock.js","50-cliente.js","60-regua.js",
  "70-query.js","80-shell.js","85-telas.js","90-testes.js")
$destino = "C:\Users\KABUM\Desktop\interface_da_engagemend\engagemend-painel-v4.html"
$f = [System.IO.File]::Create($destino)
foreach ($p in $partes) { $x = [System.IO.File]::ReadAllBytes((Join-Path $b $p)); $f.Write($x, 0, $x.Length) }
$f.Close()
```

No Windows, concatenar **byte a byte** (`[System.IO.File]::ReadAllBytes`) e não
por texto: `00-head.part` carrega as fontes Geist em base64 e reescrever a
codificação estraga o arquivo.

Os testes não rodam sozinhos ao abrir — o botão fica no painel de simulação
(Ctrl+Shift+D), ou `Testes.rodar()` no console.

## Decisões já tomadas

- Vanilla JS num arquivo só: sem TypeScript, sem npm, sem TanStack Query, sem
  Vitest. O contrato é declarado em JSDoc; o query client e o runner de teste
  são escritos à mão. Isso diverge do §5/§6 do briefing e **entra no relatório
  final**.
- O mundo falso fica fechado dentro de uma IIFE. A UI não alcança `MUNDO` —
  só `CLIENTE.*`. É o que torna a troca de adaptador verificável.
- Pontuação usa somas de decaimento pré-computadas por (membro, tipo), então
  mexer num peso é produto escalar: prévia ao vivo instantânea.
- Rail passa a 3×2 (§0 do briefing) — o v3.1 tinha fileira única de 6. Conflito
  resolvido a favor do briefing, e anotado pro relatório.

## Armadilhas que já morderam (não repetir)

- **Ordem de avaliação.** §4 é avaliado antes de §7, mas chama a régua. Só
  funciona porque `function` sobe e o mundo é construído sob demanda
  (`garantirMundo`), nunca no corpo da IIFE. Não mover essa construção pra
  cima.
- **Notificações reentravam na construção do mundo.** Elas derivam de
  pontuação, que chama `garantirMundo()`. Geradas de dentro de
  `construirMundo`, viam `mundo` ainda nulo e recursavam infinito. Agora são
  fase 2, depois do mundo publicado.
- **`recencia` estava invertida.** `diasAtras = janela · u^k` com
  `k = recencia/(1−recencia)`: k grande = recente. Antes, o perfil `sumido`
  gerava a atividade *mais* recente e ninguém nunca ficava inativo.
- **Pular o relógio tem de ser deslocamento, não escrita.** `pularDias` soma em
  `deslocamentoMs` e o ticker usa `Date.now() + deslocamentoMs`. Escrever direto
  em `agoraMs` funcionaria até o próximo evento nascer: `nascerEvento` reescreve
  `agoraMs` com o relógio real e desfaria o pulo sozinho.
- **Calibragem dos perfis é acoplada a `FAIXAS_PADRAO`.** Volume alto demais
  estoura o piso do nível 5 (320), o nível 4 esvazia e a pirâmide vira
  ampulheta. Conferir a distribuição depois de mexer em `PERFIS`.

## Como testar NO navegador (e por que é obrigatório)

O node com DOM de mentira prova lógica e não prova tela. Duas falhas reais
passaram por 75 testes verdes e só apareceram no navegador:

- **o `<meta charset>` ausente** — página em branco;
- **a prévia das Configurações presa em "Calculando…"** — o teste de fumaça só
  conferia que a função devolvia string, e aquela string era válida.

A extensão do Chrome **não abre `file://`**. Servir por HTTP, preso ao loopback
(sem `--bind`, o Python escuta em `0.0.0.0`, e o Windows pede liberação de
firewall para a rede inteira — negar e religar preso):

```powershell
python -m http.server 8731 --bind 127.0.0.1 --directory "C:\Users\KABUM\Desktop\interface_da_engagemend"
```

Depois, `http://127.0.0.1:8731/engagemend-painel-v4.html`, e no console
`await Testes.rodar()`.

Duas armadilhas do ambiente de automação, que **não são bugs do painel** e já
custaram meia hora de investigação:

- a aba fica em segundo plano (`document.hidden`), e aí `requestAnimationFrame`
  não dispara: `Render.sujar()` marca sujo e nunca pinta. A tela parece
  congelada numa rota antiga. Forçar com `Render.agora()` antes de medir.
- a extensão sintetiza um clique ao focar a aba, e às vezes ele cai num tile do
  rail: o seletor de comunidade aparece aberto "sozinho". Conferir `ui.seletor`
  antes de sair caçando bug.

## Como testar sem navegador

Um comando, e a montagem é feita sozinha:

```sh
sh _build/testes-node/rodar.sh
```

Sai `>>> RESULTADO: 76 passaram, 0 falharam` e o processo devolve 0 (1 se algum
caso falhar, 2 se o arquivo explodir ao carregar).

O script concatena as partes JS pulando `00-meta`/`00-head`/`10-css` (que são
HTML), põe `const ICONES = {};` e `const LOGO_ENGAGEMEND = "";` no lugar das
duas partes verbatim, e corta o `</script>` do fim de `90-testes.js`.

Estado atual: **76 casos de §11 passando** — régua pura, camada de query,
roteador, contrato do adaptador, erros tipados, fronteira, e mais dez de §10b:
`descreverEvento`, desenho das quatro telas frio e com dado, todos os estados de
sync, todas as sobreposições passo a passo, a prévia da Régua, o pulo de
relógio e o filtro por nível.

O stub de DOM que faz isso rodar no node **saiu do scratchpad** (2026-08-15) e
mora em `_build/testes-node/dom.js`, junto do driver e do `rodar.sh`. O
essencial dele é: `document.querySelector` devolvendo sempre um
elemento de mentira (nunca `null`), `location.hash` como setter que dispara
`hashchange` — sem isso o teste do roteador falha — e `localStorage`,
`IntersectionObserver`, `MutationObserver`, `Blob` e `URL` como cascas vazias.

`90-testes.js` termina em `</script>`, então precisa ser cortado antes do
`--check` ou do `node` — o `rodar.sh` já faz isso.

**Teste-guarda conferido por mutação:** injetei uma referência a `MOCK` dentro
de `renderToasts` e o caso "nenhuma tela alcança o mock" falhou como devia.
Guarda que nunca falhou não prova nada — se mexer nele, refazer essa checagem.

Distribuição de níveis conferida — pirâmide 52/36/27/19/6 na comunidade maior,
nível 5 em ~4%, tendências 76 sobe / 53 desce / 11 estável.

## Tarefas

As 9 da ordem de execução (§6 do briefing), com o estado de cada uma:

| # | tarefa do §6 | estado |
|---|---|---|
| 1 | contrato + tipos + gerador determinístico + adapter mock com latência | pronto (`30`/`40`) |
| 2 | `calcularPontuacao` / `nivelPorPontuacao` + testes | pronto (`60`/`90`) |
| 3 | camada de query substituindo o mock nos componentes | pronto (`70`) |
| 4 | estados de conexão + painel de simulação | conexão pronta (`80`); painel falta |
| 5 | Painel: scroll infinito, filtros na URL, eventos ao vivo | pronto (`85`) |
| 6 | Contas + drawer de membro | pronto (`85`) |
| 7 | Relatórios | pronto (`85`) |
| 8 | Configurações com prévia ao vivo | pronto (`85`) |
| 9 | conectar comunidade, paleta, busca, notificações | pronto (`85`) |

As nove entregues, o arquivo montado e o relatório do §7 escrito
(`RELATORIO.md`). O que sobrou pro Benjamin decidir: se o v4 substitui o v3.1 no
disco, e as três coisas listadas no fim do relatório ("o que eu olharia
primeiro").
