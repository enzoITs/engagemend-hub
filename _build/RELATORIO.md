# Relatório final — EngageMend v4

Respondendo às três perguntas do §7 do briefing.

Arquivo entregue: `engagemend-painel-v4.html` (363 KB, um arquivo, abre com dois
cliques). Fonte em partes numeradas em `_build/`, ordem de concatenação no
`HANDOFF.md`. **45 casos de teste passando**, incluindo três guardas de
fronteira conferidas por mutação.

---

## 1. O que ficou pronto, e o que ficou stub de propósito

### Pronto e funcional

| área | estado |
|---|---|
| Contrato + tipos (JSDoc) + erros tipados | completo |
| Gerador determinístico do mundo | 6 plataformas, 300–900 membros/comunidade, 8–20 mil eventos em 180 dias |
| Régua de Engajamento (funções puras) | peso por tipo, decaimento exponencial, faixas, progresso |
| Camada de query | cache, dedupe, SWR, invalidação por prefixo, paginação por cursor |
| Roteador | hash, filtros e drawer na URL |
| Shell | sidebar, rail 3×2, topbar, seletor, foco/a11y |
| **Painel** | fitas, filtros na URL, rolagem infinita, pílula de novidades |
| **Contas** | tabela ordenável, filtros, busca, seleção, CSV, virtualização |
| **Relatórios** | 4 gráficos em SVG à mão, seletor de período, CSV |
| **Configurações** | editor da Régua com prévia ao vivo e debounce |
| Drawer do membro | progressão, composição, histórico paginado, deep link |
| Paleta de comandos | Ctrl/Cmd+K, navegável só por teclado |
| Busca da topbar | resultados agrupados, setas, Enter |
| Fluxo de conexão | 4 passos, terminando em falso |
| Painel de simulação | Ctrl+Shift+D |
| Estados obrigatórios | carregando, carregando-mais, vazio, vazio-por-filtro, erro, offline |

### Stub de propósito

**`ADAPTADOR_HTTP` (§5).** Todos os 17 métodos lançam `NotImplementedError`, com
a rota HTTP correspondente escrita em comentário. É deliberado: um método que
devolvesse `[]` calado faria a tela dizer "nenhum membro ainda" e ninguém
descobriria que a integração nunca foi escrita.

### Não implementado, e por quê

**Nenhuma persistência real além de `localStorage`.** Config e comunidade ativa
sobrevivem ao F5; o resto do mundo é regenerado da semente. É o que o briefing
pede — mundo determinístico.

---

## 2. Qual arquivo muda quando o backend real chegar

**Um só: `_build/50-cliente.js`.** Uma linha decide:

```js
const ADAPTADOR_ATIVO = MOCK.adaptador;   /* ← trocar por ADAPTADOR_HTTP */
```

Trocar essa linha faz o painel inteiro passar a falar com o backend. Nenhuma
tela, nenhum componente e nenhuma query menciona `MOCK` — o resto do trabalho é
preencher os corpos dos métodos do mesmo arquivo, cujas assinaturas e rotas já
estão escritas.

**Isso é verificado, não prometido.** Três testes guardam a fronteira:

1. `mesmaSuperficie()` compara os dois adaptadores método a método.
2. Todo método do HTTP tem de lançar `NotImplementedError` — nenhum devolve
   vazio em silêncio.
3. Uma varredura lê o **código-fonte** de 23 funções de tela atrás da palavra
   `MOCK` e reprova se achar.

O único bloco que fala com o mock é o painel de simulação, que não é tela: é o
console do mundo falso, e com adaptador HTTP ele deixa de existir sozinho.

**Conferido por mutação:** injetei `MOCK` dentro de `telaMembros` e a guarda
reprovou; tirei o tratamento de payload ausente de `descreverEvento` e o teste
correspondente reprovou; fiz `faixaDoEstado` devolver vazio e o teste de estados
de sync reprovou. Guarda que nunca falhou não prova nada.

---

## 3. Onde discordei do briefing

### 3.1 A divergência grande: arquivo único, não projeto Next.js

O briefing pede TypeScript sem `any`, TanStack Query, Vitest e `npm run build`
passando. **Nada disso existe aqui.** Foi instrução sua, e é a divergência que
governa todas as outras:

| pedido | entregue | por quê |
|---|---|---|
| TypeScript, sem `any` | contrato em JSDoc | sem build, não há como compilar tipos |
| TanStack Query | ~150 linhas escritas à mão | cache, dedupe, SWR e cursor — só o que o painel usa |
| Vitest | runner de ~40 linhas | roda no botão do painel de simulação |
| `npm run build` / `npm run test` | nenhum dos dois | não há npm |
| `src/lib/api/*.ts` (7 arquivos) | 11 partes concatenadas | mesma separação, outra embalagem |

A camada de query escrita à mão **não tem** retry com backoff, garbage
collection por ociosidade, prefetch nem persistência. Nada disso é necessário
num painel de uma aba só, e cada um seria código não exercitado fingindo
maturidade.

### 3.2 Rail 3×2 contra a fileira única do v3.1

O §0 manda grade 3×2; o protótipo tinha fileira única de 6. Resolvido a favor do
briefing, com CSS aditivo — o bloco de estilo original não foi tocado.

### 3.3 Estendi o contrato em três pontos

O briefing descreve as telas mas não os métodos que elas exigem. Faltavam três,
e a alternativa a cada um seria falsear no cliente:

- **`listarEventos({ nivel, config })`** — o §2.1 pede filtro do feed por nível.
  Nível é do membro, não do evento; filtrar no cliente quebraria a paginação por
  cursor (a página 1 poderia voltar vazia com 500 resultados adiante).
- **`listarRanking({ atividade, ordem: "promocao" })`** — o §2.2 pede filtro por
  faixa de última atividade e abertura ordenada por quem subiu de nível.
- **`simularRegua({ comunidadeId, config })`** — a prévia ao vivo do §2.4.
  Precisa do histórico inteiro; trazer 20 mil eventos pro navegador só pra somar
  de novo seria o oposto do que o contrato existe pra evitar.

Os três foram acrescentados **aos dois adaptadores**, então a fronteira continua
íntegra e o teste de superfície continua passando.

### 3.4 Onde o dado não alcança o que o texto pede

Três lugares onde entreguei o mais próximo honesto em vez de fingir:

- **"Quantos subiram de nível na semana"** (fita do §2.1) → são **30 dias**. A
  comparação de nível sai de somas memoizadas numa janela fixa de 30 dias;
  uma janela de 7 exigiria uma segunda tabela de somas. As outras três fitas
  ("ativos em 7 dias", "eventos hoje", distribuição) são exatas.
- **"Movimento entre níveis nos últimos 30/90 dias"** (§2.3) → sempre 30, pelo
  mesmo motivo. **A tela avisa isso em texto** quando o período escolhido é
  outro, em vez de deixar o número parecer que acompanha o seletor.
- **Latências do painel** (§3) → o briefing pede 0/300ms/2s/8s; o mock tem
  faixas de 0 / ~100ms / ~400ms / ~2s. Rotuladas pelo valor real.

### 3.5 Divergências menores

- **Deep link do membro:** `/contas/[membroId]` virou
  `#/c/<comunidade>/membros?membro=<id>`. O arquivo abre por `file://`, onde
  `pushState` não funciona — a URL mudaria e o F5 devolveria "arquivo não
  encontrado".
- **`NODE_ENV !== "production"`** virou `usandoMock()`. Sem build não há
  `NODE_ENV`, e a condição honesta é a mesma: o painel de simulação só existe
  quando existe mundo pra simular.
- **"Zerar dados da comunidade ativa"** esvazia todas, não só a ativa. Rotulado
  como "comunidade vazia" no painel, sem prometer o recorte.
- **Ticker a cada 8–20s** virou intervalo fixo de 9s. O painel de simulação tem
  "chegar 3 atividades agora" pra quem não quiser esperar.
- **A linha da tabela** virou `div[role=row]` em vez de `<button>`: a caixa de
  seleção mora dentro dela, e botão dentro de botão é HTML inválido — quem usa
  teclado ficaria sem como selecionar. O clique na linha inteira continua
  abrindo a gaveta.

---

## O que eu olharia primeiro, se fosse continuar

1. **A tabela virtualizada** só recalcula a janela no evento de rolagem. Com
   rolagem por teclado em lista muito longa pode piscar. Vale medir.
2. **O contador de novidades** relê a primeira página a cada 9 s. Com backend
   real isso é uma chamada por usuário por 9 s — provavelmente vira WebSocket ou
   long-poll, e o lugar de decidir isso é o adaptador, não a tela.
3. **`localStorage` guarda a config e a devolve ao servidor no arranque.** Se um
   dia houver conta de verdade, quem manda passa a ser o servidor e essa
   devolução tem de sair.
