gostaria que vc realizasse essas tarefas dentro desse arquivo # Briefing — EngageMend: interface 100% funcional, zero integração

> Cola inteiro no Claude Code, na raiz do projeto.

---

Você vai transformar o esqueleto do painel da EngageMend num **produto inteiramente funcional pela frente e inteiramente falso por trás**.

A regra que governa tudo: **nenhuma chamada de rede, nenhum OAuth, nenhuma chave de API, nenhum token real.** Ao mesmo tempo, o app precisa se comportar como se estivesse conectado — com latência, erro, paginação, dado desatualizado e reconexão. Se um usuário não consegue perceber a diferença navegando, você acertou.

O objetivo não é "protótipo bonito". É que, quando os conectores reais chegarem, **trocar o adapter falso pelo real seja mudança de um arquivo**, sem tocar em nenhum componente.

---

## 0. O que já está decidido — não redesenhe

O visual foi auditado e fechado. Preserve, e não "melhore":

- Rail de plataformas em **grade 3×2**, células `1fr` ocupando a largura interna inteira da sidebar, tile `h-12`, glifo 22px a 70% de opacidade.
- Glifo monocromático em todos os estados **menos o ativo**, que recebe a cor de marca — com variante calibrada pra fundo escuro (o preto do X vira branco).
- **Lime significa uma coisa só: ativo.** Sinal de pendência usa verde `--online`.
- **Um `<h1>` por página**, dentro do conteúdo. A topbar não tem título; ela tem o chip da comunidade à esquerda, busca e sino à direita.
- Escala tipográfica de seis tamanhos: 11 / 12 / 14 / 16 / 20 / 24. Grade de 8px. Nenhum valor fora disso.
- Níveis 1–3 exibem `"Nível N"`; 4 e 5 exibem `"N · Embaixador"` e `"N · Líder"`.

Se algo aqui conflitar com uma necessidade nova, implemente como está e me avise no relatório final.

---

## 1. A camada de dados é o coração desta entrega

Toda a interface fala com **um contrato**, nunca com dados diretamente.

```
src/lib/api/
  types.ts        → o contrato: entidades + assinatura de cada método
  client.ts       → escolhe o adapter (hoje sempre o mock)
  mock/
    seed.ts       → PRNG determinístico
    generate.ts   → gera o mundo falso a partir da seed
    adapter.ts    → implementa o contrato inteiro em memória
    latency.ts    → atraso, falha e instabilidade simulados
  http/
    adapter.ts    → arquivo com a mesma assinatura, todo método lançando
                    NotImplementedError. É o slot do backend real.
```

Regras do contrato:

- **Todo método é `async` e devolve `Promise`.** Nenhum componente lê dado síncrono. Isso é o que impede o código de assumir que o dado está sempre lá.
- Listagens são paginadas por cursor: `{ itens, proximoCursor }`. Nunca devolva array cru.
- Erros são tipados: `ErroDeRede`, `ErroDeAutenticacao`, `ErroDeLimite`, `NaoEncontrado`. A UI reage diferente a cada um — token expirado pede reconexão, rate limit pede espera.
- Mutações (conectar comunidade, salvar pesos, marcar notificação) também passam pelo contrato e também podem falhar.

Use **TanStack Query** pra consumir isso. Cache, revalidação, `isPending`/`isError`/`retry` vêm prontos e são exatamente os estados que a UI precisa mostrar.

### 1.1 O modelo de evento canônico

Este é o formato que os conectores reais vão produzir. O mock produz o mesmo formato agora, pra nada precisar mudar depois.

```ts
type Evento = {
  id: string;
  plataforma: PlataformaId;
  comunidadeId: string;
  membroId: string;
  tipo: TipoEvento;
  ocorridoEm: string;      // ISO 8601, UTC
  payload: Record<string, unknown>;  // o bruto de cada plataforma
};

type TipoEvento =
  | "mensagem" | "resposta" | "reacao"
  | "conteudo_publicado" | "convite_aceito"
  | "evento_presenca" | "mencao" | "entrou" | "saiu";
```

O texto que aparece no feed é **derivado** do evento, nunca guardado nele. Uma função `descreverEvento(evento, membro)` monta a frase em pt-BR. É isso que faz o feed continuar funcionando quando o dado vier do Discord de verdade.

### 1.2 A Régua de Engajamento é uma função pura

```ts
calcularPontuacao(eventos: Evento[], pesos: PesosRegua, agora: Date): number
nivelPorPontuacao(pontuacao: number, faixas: FaixasRegua): 1|2|3|4|5
```

Requisitos:

- **Peso por tipo de evento.** Trazer alguém de fora (`convite_aceito`) vale muito mais que uma reação. É a tese do produto: sair do teto do like.
- **Decaimento temporal.** Evento de 90 dias atrás pesa menos que o de ontem. Meia-vida configurável, padrão 30 dias. Sem isso, quem foi ativo uma vez fica Líder pra sempre.
- **Nunca persista o nível como verdade.** Guarde os eventos, calcule o nível por cima. Quando os pesos mudarem, o histórico inteiro recalcula — e isso vai acontecer muitas vezes.
- Função pura, sem `Date.now()` por dentro: `agora` entra como parâmetro. Assim dá pra testar e pra simular "como estaria a régua daqui a 30 dias".

### 1.3 O mundo falso precisa ter tamanho real

Dado mockado pequeno esconde todo problema de escala. Gere, a partir de uma seed fixa:

- 6 plataformas, 2–4 comunidades cada — **exceto WhatsApp, que fica sem nenhuma** (é o empty state) e **X, que fica com estado `indisponivel`** (custo de API inviável hoje; a UI precisa saber comunicar isso).
- 300 a 900 membros por comunidade, com nomes brasileiros plausíveis.
- 8.000 a 20.000 eventos por comunidade, distribuídos nos últimos 180 dias, com curva realista: muita gente com pouquíssimo evento, pouca gente com muito. Distribuição uniforme produz um produto que mente.
- Alguns membros com trajetória clara de subida na Régua — são eles que provam a tese na demo.

Determinístico: recarregar a página dá o mesmo mundo. Mudar a seed dá outro mundo inteiro.

---

## 2. As telas

### 2.1 Painel

Além do feed que já existe:

- **Scroll infinito** de verdade, consumindo o cursor. Sentinela com IntersectionObserver, skeleton no fim da lista enquanto carrega a próxima página.
- **Filtro por tipo de evento** e **por nível**, em chips acima do feed. Estado do filtro vai pra URL (`?tipo=convite&nivel=4`) — link compartilhável, botão voltar funciona.
- **Novos eventos chegando ao vivo:** o adapter mock emite um evento novo a cada 8–20s na comunidade ativa. Não injete no topo empurrando a leitura de quem está lendo; mostre uma pílula fixa **"3 novas atividades"** que rola pro topo ao clicar. Respeitar a leitura de quem está no meio da lista é o comportamento certo.
- Quatro fitas de resumo no topo: membros ativos em 7 dias, eventos hoje, quantos subiram de nível na semana, e a distribuição da Régua em barra horizontal empilhada com as cinco cores.

### 2.2 Contas — onde a Régua vira produto

Tabela de membros. Esta tela é o motivo de alguém pagar pela EngageMend.

- Colunas: membro (avatar + nome + @), nível, pontuação, tendência (subiu/desceu/estável nos últimos 30 dias), última atividade, total de eventos.
- **Ordenação** por qualquer coluna, **filtro** por nível e por faixa de última atividade, **busca** por nome. Tudo na URL.
- Paginação por cursor com controle de "carregar mais".
- Seleção múltipla com barra de ação flutuante ("Exportar CSV" — este funciona de verdade, é dado local).
- **Ordenação padrão: quem subiu de nível recentemente.** A tela abre no que exige ação, não em ordem alfabética.

**Drawer de detalhe do membro** ao clicar numa linha:

- Cabeçalho com avatar, nome, plataforma de origem, nível atual.
- **Linha do tempo da progressão** na Régua: quando entrou em cada nível.
- Composição da pontuação: quanto veio de cada tipo de evento, em barras.
- Histórico de eventos do membro, paginado.
- Deep link próprio (`/contas/[membroId]`), pra abrir direto e compartilhar.

### 2.3 Relatórios

Sem biblioteca de gráfico. SVG feito à mão dá conta e fica melhor:

- **Distribuição pela Régua**, barras horizontais, com número absoluto e percentual.
- **Movimento entre níveis** nos últimos 30/90 dias: quantos subiram, quantos desceram, quantos ficaram.
- **Atividade ao longo do tempo**: sparkline por semana, com seletor de período.
- **Top 10 contribuintes** por pontuação no período.
- Seletor de período (7 / 30 / 90 dias) na URL.
- Botão "Exportar CSV" funcional.

### 2.4 Configurações — o editor da Régua

Esta tela é a que mais depende do cálculo ser função pura:

- Slider ou campo numérico pro peso de cada tipo de evento.
- Campo pra meia-vida do decaimento.
- Limiares de pontuação de cada um dos cinco níveis.
- **Prévia ao vivo:** ao mexer num peso, um painel ao lado mostra imediatamente como a distribuição da comunidade mudaria — "12 pessoas subiriam de nível, 4 desceriam". Recalcula em cima do mundo falso inteiro, com debounce.
- "Restaurar padrão" e "Salvar". Salvar persiste em `localStorage` e passa pelo contrato (`api.salvarPesos`), que pode falhar.

### 2.5 Estado de conexão — isto não é detalhe

Toda comunidade tem `estadoSync`: `conectada` · `sincronizando` · `desatualizada` · `token_expirado` · `erro` · `indisponivel`.

- O **chip da topbar** mostra o estado por um ponto colorido e "sincronizado há 2 min" no hover.
- A **linha no seletor** mostra o estado.
- O **tile no rail** ganha o ponto de pendência quando há problema.
- Comunidade com `token_expirado` mostra faixa no topo do conteúdo: "A conexão com o Discord expirou. Reconectar." O botão roda um fluxo falso de 2s e volta pra `conectada`.
- `indisponivel` (o X) mostra estado próprio no seletor explicando que a plataforma ainda não está disponível — sem prometer data.

### 2.6 Conectar comunidade

O fluxo inteiro desenhado e navegável, terminando em falso:

1. Escolher plataforma (WhatsApp e X aparecem desabilitados, com o motivo).
2. Tela explicando quais permissões serão pedidas e **quais dados a EngageMend vai ler** — escreva isso de forma honesta e específica, é o momento de maior desconfiança do usuário.
3. Botão "Autorizar no Discord" → tela de espera de 2s simulando o redirect.
4. Sucesso: a comunidade aparece na lista, entra em `sincronizando`, e depois de ~6s vira `conectada` com dados gerados na hora.

Nenhum `window.open`, nenhuma URL de OAuth real.

### 2.7 Transversais

- **Paleta de comandos** com `Cmd/Ctrl+K`: trocar de comunidade, ir pra uma tela, buscar membro. Navegável só pelo teclado.
- **Busca da topbar** funcionando de verdade sobre membros e comunidades, com resultados agrupados e navegação por setas.
- **Sino** com lista de notificações derivadas de eventos reais do mock ("Marina Coelho chegou ao nível 4"), marcar como lida, contador.
- **Toasts** pra sucesso e erro de mutação, com ação de desfazer onde fizer sentido.
- Comunidade ativa persistida em `localStorage` e refletida na URL.

---

## 3. Painel de simulação (dev)

Um painel escondido — atalho `Ctrl+Shift+D`, só em `NODE_ENV !== "production"` — pra forçar qualquer estado sem mexer no código:

- Latência artificial: 0 / 300ms / 2s / 8s
- Taxa de erro: 0% / 10% / 100%
- Forçar erro específico: rede, token expirado, rate limit
- Modo offline
- Zerar dados da comunidade ativa (ver empty state)
- Trocar a seed do gerador
- Pular o relógio 30 dias à frente (ver o decaimento agindo)

Este painel é o que torna toda tabela de estados deste briefing verificável. Sem ele, metade dos estados fica inalcançável e apodrece.

---

## 4. Estados obrigatórios

Nenhuma lista, tabela ou painel entrega só o caso feliz. Para **cada** superfície de dados:

| estado | como aparece |
|---|---|
| carregando (1ª vez) | skeleton com a forma do conteúdo real, nunca spinner centralizado |
| carregando (mais) | skeleton no fim da lista, conteúdo existente intocado |
| vazio | título, uma frase dizendo o que vai aparecer ali, e a ação que resolve |
| vazio por filtro | "Nenhum resultado para X" + limpar filtro. Diferente do vazio real |
| erro | o que falhou, em português comum, e botão "Tentar de novo" |
| offline | faixa persistente, dado em cache exibido e marcado como possivelmente desatualizado |

Nunca escreva "Oops", "Algo deu errado" ou "Erro 500". Diga o que aconteceu e o que fazer.

---

## 5. Piso técnico

- Sem `any`. O contrato inteiro tipado, e os componentes derivam os tipos dele.
- `<button>` pra ação, `<Link>` pra navegação. Foco visível em tudo. Drawer e modal com foco preso, `Esc` fecha, foco volta pra origem.
- Lista de membros virtualizada se passar de 200 linhas renderizadas.
- Testes com Vitest em três lugares que não podem quebrar em silêncio: `calcularPontuacao`, `nivelPorPontuacao` e `descreverEvento`. Casos de borda: membro sem evento, evento no futuro, peso zero, empate na fronteira de nível.
- `npm run build` e `npm run test` passando.
- Nenhum `fetch`, nenhum `axios`, nenhuma variável de ambiente com credencial. Se você escrever uma URL de API neste projeto, está errado.

---

## 6. Ordem de execução

Faça nesta ordem e me mostre ao fim de cada bloco:

1. Contrato + tipos + gerador determinístico + adapter mock com latência
2. `calcularPontuacao` / `nivelPorPontuacao` + testes
3. TanStack Query e substituição do mock atual em todos os componentes existentes
4. Estados de conexão + painel de simulação
5. Painel com scroll infinito, filtros na URL e eventos ao vivo
6. Contas + drawer de membro
7. Relatórios
8. Configurações com prévia ao vivo
9. Conectar comunidade, paleta de comandos, busca, notificações

## 7. Relatório final

Ao terminar, me diga:

1. o que ficou pronto, e o que ficou stub de propósito;
2. **qual é exatamente o arquivo que muda quando o backend real chegar** — se for mais de um, o contrato vazou e precisa ser consertado;
3. onde você discordou deste briefing e por quê.
