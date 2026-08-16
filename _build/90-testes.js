
/* ── §11 · Testes ─────────────────────────────────────────────────────────────
   O Vitest que o briefing pede não existe aqui (ver relatório final): não há
   npm, não há processo de build, e o arquivo tem que abrir com dois cliques.
   Então o runner é escrito à mão. São umas quarenta linhas, e fazem o que
   importa: rodar, contar, e dizer qual quebrou e por quê.

   Os testes **não rodam sozinhos ao abrir**. Dois motivos: gastariam tempo
   antes da primeira pintura, e vários mexem no mundo (reconstroem com outra
   semente, forçam falha de rede). Quem dispara é o botão no painel de
   simulação. Antes de começar, o runner reconstrói o mundo pra ter sala limpa;
   ao terminar, devolve tudo como estava — semente, latência e cache — pra
   quem estava usando o painel não ver o chão sumir.
   ───────────────────────────────────────────────────────────────────────── */

const Testes = (() => {
  "use strict";

  const casos = [];
  const teste = (nome, fn) => casos.push({ nome, fn });

  /* ── Asserções ─────────────────────────────────────────────────────────
     Cada uma lança com uma mensagem que diz o que esperava e o que veio. Um
     teste que só diz "falhou" obriga a reabrir o código pra descobrir o quê. */
  class Falhou extends Error {}

  function ok(cond, msg) {
    if (!cond) throw new Falhou(msg || "esperava verdadeiro");
  }
  function igual(recebido, esperado, msg) {
    if (recebido !== esperado) {
      throw new Falhou((msg ? msg + ": " : "") + "esperava " + JSON.stringify(esperado) + ", veio " + JSON.stringify(recebido));
    }
  }
  function perto(recebido, esperado, tolerancia, msg) {
    if (Math.abs(recebido - esperado) > tolerancia) {
      throw new Falhou((msg ? msg + ": " : "") + "esperava ~" + esperado + " (±" + tolerancia + "), veio " + recebido);
    }
  }
  async function lanca(fn, Classe, msg) {
    let pegou = null;
    try { await fn(); } catch (e) { pegou = e; }
    if (!pegou) throw new Falhou((msg || "") + ": não lançou nada");
    if (Classe && !(pegou instanceof Classe)) {
      throw new Falhou((msg || "") + ": esperava " + Classe.name + ", veio " + pegou.constructor.name);
    }
    return pegou;
  }

  async function rodar() {
    /* Guarda o que vai ser mexido. */
    const latAntes = MOCK.controles.estado.latencia;
    const sementeAntes = MOCK.controles.semente();
    const tickerAntes = MOCK.controles.tickerLigado();
    /* Sem zerar a taxa de erro, rodar os testes com o sorteio em 100% ligado no
       painel reprova o arquivo inteiro e a culpa parece ser do código. */
    const taxaAntes = MOCK.controles.estado.taxaErro;

    MOCK.controles.desligarTicker();
    MOCK.controles.definirLatencia("instantanea");
    MOCK.controles.definirFalha("nenhuma", false);
    MOCK.controles.definirVazio(false);
    MOCK.controles.definirTaxaErro(0);
    MOCK.controles.reconstruir(sementeAntes);   /* sala limpa */
    Query.limpar();
    Paginado.limpar();

    const linhas = [];
    let passou = 0, falhou = 0;
    const comeco = Date.now();

    for (const caso of casos) {
      try {
        await caso.fn();
        passou++;
        linhas.push("<b>ok</b> " + esc(caso.nome));
      } catch (e) {
        falhou++;
        const porque = e instanceof Falhou ? e.message : e.constructor.name + ": " + e.message;
        linhas.push("<i>FALHOU</i> " + esc(caso.nome) + "\n     " + esc(porque));
      }
    }

    const ms = Date.now() - comeco;
    linhas.push((falhou === 0 ? "<b>" + passou + " passaram</b>" : "<i>" + falhou + " falharam</i>, " + passou + " passaram") + " · " + ms + "ms");

    /* Devolve o painel ao estado de antes. */
    MOCK.controles.definirFalha("nenhuma", false);
    MOCK.controles.definirVazio(false);
    MOCK.controles.definirTaxaErro(taxaAntes);
    MOCK.controles.definirLatencia(latAntes);
    MOCK.controles.reconstruir(sementeAntes);
    if (tickerAntes) MOCK.controles.ligarTicker();
    Query.limpar();
    Paginado.limpar();
    Render.sujar();

    const resultado = { passou, falhou, ms, linhas };
    console.log(linhas.map((l) => l.replace(/<[^>]+>/g, "")).join("\n"));
    return resultado;
  }

  return { teste, rodar, ok, igual, perto, lanca, Falhou, quantos: () => casos.length };
})();

/* Atalhos, pra os casos abaixo não virarem `Testes.ok(...)` em toda linha. */
const { teste, ok, igual, perto, lanca } = Testes;

/* ═══ §7 · Régua ═══════════════════════════════════════════════════════════
   **Estes são os testes do bot, portados.**

   `src/classifier/` do repositório `engagemend-discord` é a fonte de verdade da
   Régua; §7 deste arquivo é um port dele. Um port que ninguém confere vira
   fork em três semanas, e a divergência é silenciosa — os números só passam a
   discordar, e a descoberta acontece numa reunião.

   Então os casos de `tests/level.test.ts` e `tests/decay.test.ts` rodam aqui,
   com os mesmos números. Se o painel discordar do bot em qualquer caso que o
   bot documenta, esta suíte fica vermelha.

   Ao portar um caso novo de lá, manter o nome parecido — é o que permite achar
   o par dos dois lados. */

/** Atalho no mesmo formato do `axes()` dos testes do bot. */
const eixos = (o) => Object.assign(eixosZerados(), o || {});

const AGORA_TESTE = new Date("2026-08-08T12:00:00.000Z");
const ev = (tipo, diasAtras) => ({
  tipo,
  ocorridoEm: new Date(AGORA_TESTE.getTime() - diasAtras * DIA_MS).toISOString(),
});

/* ── Decaimento (bot: tests/decay.test.ts) ─────────────────────────────────── */

teste("decaimento: no instante do evento vale 1", () => {
  igual(fatorDecaimento(0, 14), 1);
  igual(fatorDecaimento(-5, 14), 1, "evento no futuro não ganha bônus");
});

teste("decaimento: uma meia-vida corta pela metade", () => {
  perto(fatorDecaimento(14, 14), 0.5, 1e-9);
  perto(fatorDecaimento(28, 14), 0.25, 1e-9, "duas meias-vidas");
  perto(fatorDecaimento(7, 14), Math.SQRT1_2, 1e-9, "meia meia-vida");
});

teste("decaimento: sempre decrescente e dentro de [0,1]", () => {
  let anterior = Infinity;
  for (let d = 0; d <= 200; d += 7) {
    const f = fatorDecaimento(d, MEIA_VIDA_PADRAO);
    ok(f <= anterior, "subiu em d=" + d);
    ok(f >= 0 && f <= 1, "saiu de [0,1] em d=" + d);
    anterior = f;
  }
});

teste("janela: 60 dias entra, 61 não", () => {
  ok(dentroDaJanela(60, JANELA_PONTUACAO_DIAS), "o limite pertence à janela");
  ok(!dentroDaJanela(60.1, JANELA_PONTUACAO_DIAS));
  ok(dentroDaJanela(0, JANELA_PONTUACAO_DIAS));
});

teste("tetos diários cortam o excesso, por tipo e por dia UTC", () => {
  /* 40 reações no mesmo dia: o teto é 15. */
  const muitas = [];
  for (let i = 0; i < 40; i++) muitas.push(ev("reaction_given", 3));
  igual(aplicarTetosDiarios(muitas).length, 15);

  /* Dias diferentes têm tetos independentes. */
  const doisDias = [];
  for (let i = 0; i < 40; i++) { doisDias.push(ev("reaction_given", 3)); doisDias.push(ev("reaction_given", 4)); }
  igual(aplicarTetosDiarios(doisDias).length, 30);

  /* Tipo sem teto passa inteiro. */
  const semTeto = [];
  for (let i = 0; i < 40; i++) semTeto.push(ev("forum_solution", 3));
  igual(aplicarTetosDiarios(semTeto).length, 40, "forum_solution não tem teto");
});

teste("tetos diários são determinísticos: mesma entrada, mesmo corte", () => {
  const lista = [];
  for (let i = 0; i < 30; i++) lista.push(ev("message_sent", 2));
  const a = aplicarTetosDiarios(lista).length;
  const b = aplicarTetosDiarios(lista.slice().reverse()).length;
  igual(a, b, "a ordem de entrada mudou o resultado");
});

/* ── Pontuação e eixos (bot: aggregateMember) ──────────────────────────────── */

teste("pontuação é produto escalar dos pesos pelas somas", () => {
  const somas = { message_sent: 2, reply_given: 3, reaction_given: 10 };
  const pesos = { message_sent: 2, reply_given: 5, reaction_given: 1 };
  /* 2·2 + 3·5 + 10·1 = 29 */
  igual(pontuacaoDe(somas, pesos), 29);
  igual(pontuacaoDe(null, pesos), 0, "sem somas, zero");
});

teste("peso zero anula o tipo inteiro", () => {
  igual(pontuacaoDe({ message_sent: 500 }, { message_sent: 0 }), 0);
});

teste("eixos: separa os pesos nos eixos certos", () => {
  /* Espelha o caso homônimo de tests/level.test.ts: um evento de cada,
     sem decaimento (soma 1), com os pesos de fábrica. */
  const somas = { message_sent: 1, reply_given: 1, reaction_received: 1, reaction_given: 1 };
  const e = eixosDe(somas, PESOS_PADRAO);
  perto(e.production, 2, 1e-9);
  perto(e.reciprocity, 4, 1e-9);
  perto(e.influence, 3, 1e-9);
  perto(e.consumption, 1, 1e-9);
});

teste("percentil: p90 de dez valores é o nono", () => {
  igual(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

teste("percentil não se deixa levar por um outlier", () => {
  igual(percentil([1, 1, 1, 1, 1, 1, 1, 1, 1, 9999], 0.9), 1);
});

teste("percentil ordena antes de cortar, e lista vazia é zero", () => {
  igual(percentil([10, 1, 5, 3, 8], 0.9), 10);
  igual(percentil([], 0.9), 0);
});

teste("normalizarEixos: p90 vale 100, acima satura, abaixo é linear", () => {
  igual(normalizarEixos(eixos({ influence: 50 }), eixos({ influence: 50 })).influence, 100);
  igual(normalizarEixos(eixos({ influence: 500 }), eixos({ influence: 50 })).influence, 100, "não passa de 100");
  igual(normalizarEixos(eixos({ production: 25 }), eixos({ production: 50 })).production, 50);
  igual(normalizarEixos(eixos({ reciprocity: 10 }), eixosZerados()).reciprocity, 0, "referência zero não divide por zero");
});

teste("referências de eixo incluem quem tem zero — são parte da comunidade", () => {
  const ref = referenciasDeEixo([eixos({ influence: 3 }), eixos(), eixos()]);
  perto(ref.influence, 3, 1e-9);
});

/* ── Nível natural (bot: naturalLevel) ─────────────────────────────────────── */

teste("nível: sem atividade é Observador", () => {
  igual(nivelNatural(0, eixos()), 1);
  igual(nivelNatural(-10, eixos()), 1, "pontuação negativa ainda é nível 1");
});

teste("nível: score 8 promove a Participante; 7.9 não", () => {
  igual(nivelNatural(8, eixos()), 2);
  igual(nivelNatural(7.9, eixos()), 1);
});

teste("nível: Contribuinte exige score 30 E reciprocidade 20", () => {
  igual(nivelNatural(30, eixos({ reciprocity: 20 })), 3);
  igual(nivelNatural(30, eixos({ reciprocity: 19.9 })), 2);
  igual(nivelNatural(29.9, eixos({ reciprocity: 100 })), 2);
});

teste("nível: Líder exige score 55 E influência 35", () => {
  igual(nivelNatural(55, eixos({ influence: 35, reciprocity: 100 })), 4);
  igual(nivelNatural(55, eixos({ influence: 34.9, reciprocity: 100 })), 3);
});

teste("nível: Embaixador exige score 80 E influência 60", () => {
  igual(nivelNatural(80, eixos({ influence: 60, reciprocity: 100 })), 5);
  igual(nivelNatural(80, eixos({ influence: 59.9, reciprocity: 100 })), 4);
});

teste("nível: volume sem sinal recebido não promove — quem grita sozinho é ruído", () => {
  igual(nivelNatural(600, eixos({ production: 100 })), 2);
});

teste("nível: a porta derruba para o primeiro nível que ele alcança", () => {
  igual(nivelNatural(120, eixos({ influence: 40, reciprocity: 90 })), 4);
  igual(nivelNatural(120, eixos({ influence: 0, reciprocity: 90 })), 3);
});

teste("nível: os nomes são os do bot, não os do §0 do briefing", () => {
  igual([1, 2, 3, 4, 5].map(nomeDoNivel).join("|"),
    "Observador|Participante|Contribuinte|Líder|Embaixador");
});

teste("nível: monotônico quando os eixos não barram", () => {
  const abertos = eixos({ influence: 100, reciprocity: 100, production: 100, consumption: 100 });
  let anterior = 0;
  for (let p = 0; p < 200; p += 2) {
    const n = nivelNatural(p, abertos);
    ok(n >= anterior, "nível caiu quando a pontuação subiu, em p=" + p);
    anterior = n;
  }
});

/* ── Histerese (bot: decideLevel) ──────────────────────────────────────────── */

const abaixo = (nivel, dias) => Array.from({ length: dias === undefined ? HISTERESE_DIAS : dias }, () => nivel);

teste("histerese: primeira classificação é initial", () => {
  const d = decidirNivel({ natural: 3, atual: null, recentes: [3] });
  igual(d.nivel, 3);
  igual(d.motivo, "initial");
  igual(d.mudou, true);
});

teste("histerese: promoção é imediata, sem esperar 14 dias", () => {
  const d = decidirNivel({ natural: 4, atual: 2, recentes: [2, 2, 4] });
  igual(d.nivel, 4);
  igual(d.motivo, "promotion");
});

teste("histerese: nível igual não gera transição", () => {
  const d = decidirNivel({ natural: 3, atual: 3, recentes: abaixo(3) });
  igual(d.mudou, false);
  igual(d.motivo, null);
});

teste("histerese: rebaixamento exige 14 dias consecutivos abaixo", () => {
  const d = decidirNivel({ natural: 2, atual: 3, recentes: abaixo(2) });
  igual(d.nivel, 2);
  igual(d.motivo, "demotion");
});

teste("histerese: 13 dias abaixo ainda seguram o nível", () => {
  const d = decidirNivel({ natural: 2, atual: 3, recentes: abaixo(2, HISTERESE_DIAS - 1) });
  igual(d.nivel, 3);
  igual(d.mudou, false);
  igual(d.rebaixamentoSegurado, true);
});

teste("histerese: um único dia de volta zera a contagem", () => {
  const serie = abaixo(2);
  serie[5] = 3;
  const d = decidirNivel({ natural: 2, atual: 3, recentes: serie });
  igual(d.nivel, 3);
  igual(d.rebaixamentoSegurado, true);
});

teste("histerese: membro novo demais para ter série não é rebaixado", () => {
  const d = decidirNivel({ natural: 1, atual: 3, recentes: [1, 1, 1] });
  igual(d.nivel, 3);
  igual(d.rebaixamentoSegurado, true);
});

teste("histerese: recomputo total aplica a matemática nova direto", () => {
  const d = decidirNivel({ natural: 1, atual: 5, recentes: [5, 5, 5], recomputoTotal: true });
  igual(d.nivel, 1);
  igual(d.motivo, "recompute");
});

teste("histerese: recomputo total não inventa transição sem mudança", () => {
  const d = decidirNivel({ natural: 3, atual: 3, recentes: [], recomputoTotal: true });
  igual(d.mudou, false);
});

/* ── Config e progresso (só do painel) ─────────────────────────────────────── */

teste("a calibragem do painel é a mesma versão do bot", () => {
  /* Alarme para o caso que mais preocupa: alguém recalibra `weights.ts` no bot,
     sobe WEIGHTS_VERSION, e ninguém atualiza o painel. Ao trocar a versão aqui,
     conferir peso a peso contra o bot antes de dar como pronto. */
  igual(VERSAO_PESOS, "v0.1.0-uncalibrated");
  igual(MEIA_VIDA_PADRAO, 14, "HALF_LIFE_DAYS");
  igual(JANELA_PONTUACAO_DIAS, 60, "SCORE_WINDOW_DAYS");
  igual(HISTERESE_DIAS, 14, "HYSTERESIS_DAYS");
  igual(PERCENTIL_EIXO, 0.9, "AXIS_NORMALIZATION_PERCENTILE");
  igual(TIPOS_IDS.length, 17, "o bot tem catorze tipos de evento do Discord + três do YouTube");
  igual(PESOS_PADRAO.invite_used, 20);
  igual(PESOS_PADRAO.forum_solution, 12);
  igual(PESOS_PADRAO.reaction_given, 1);
  igual(TETOS_DIARIOS.reaction_given, 15);
  igual(TETOS_DIARIOS.message_sent, 30);
  igual(TETOS_DIARIOS.reply_given, 25);
});

teste("todo tipo tem eixo válido, e todo eixo é usado", () => {
  const vistos = new Set();
  for (const t of TIPOS_EVENTO) {
    ok(EIXOS_IDS.includes(t.eixo), t.id + " tem eixo desconhecido: " + t.eixo);
    ok(ICONES[t.icone], t.id + " aponta pra ícone inexistente: " + t.icone);
    vistos.add(t.eixo);
  }
  igual(vistos.size, EIXOS_IDS.length, "algum eixo ficou sem nenhum tipo de evento");
});

teste("normalizarLimiares conserta ordem invertida", () => {
  const l = normalizarLimiares([
    { nivel: 5, minScore: 10, porta: null },
    { nivel: 4, minScore: 50, porta: null },
    { nivel: 3, minScore: 90, porta: null },
    { nivel: 2, minScore: 200, porta: null },
    { nivel: 1, minScore: -Infinity, porta: null },
  ]);
  const por = (n) => l.find((x) => x.nivel === n).minScore;
  ok(por(5) > por(4) && por(4) > por(3) && por(3) > por(2),
    "não ficou decrescente de 5 para 2: " + JSON.stringify(l.map((x) => x.minScore)));
});

teste("normalizarPesos rejeita lixo", () => {
  const p = normalizarPesos({ message_sent: -5, reply_given: "abc", reaction_given: 3.7 });
  igual(p.message_sent, 0, "negativo vira zero");
  igual(p.reply_given, 0, "texto vira zero");
  igual(p.reaction_given, 4, "arredonda");
  for (const t of TIPOS_IDS) ok(typeof p[t] === "number", "faltou o tipo " + t);
});

teste("progressoDeNivel: no topo não existe próximo", () => {
  const r = progressoDeNivel(10000, eixos({ influence: 100, reciprocity: 100 }));
  igual(r.nivel, 5);
  igual(r.proximo, null);
  igual(r.progresso, 1);
});

teste("progressoDeNivel: aponta a porta quando é ela que barra", () => {
  /* Pontuação de sobra pro nível 4, influência de ninguém. */
  const r = progressoDeNivel(60, eixos({ reciprocity: 100, influence: 0 }));
  igual(r.nivel, 3, "com reciprocidade cheia e score 60, o nível natural é 3");
  igual(r.proximo, 4);
  igual(r.faltaPontos, 0, "pontuação já dá");
  ok(r.faltaEixo, "não apontou o eixo que barra");
  igual(r.faltaEixo.eixo, "influence");
  igual(r.faltaEixo.min, 35);
});

teste("configIgual reconhece o padrão de fábrica", () => {
  ok(configIgual(configPadrao(), configPadrao()));
  const mexida = configPadrao();
  mexida.pesos.reaction_given = 99;
  ok(!configIgual(configPadrao(), mexida), "devia acusar diferença de peso");

  const outraPorta = configPadrao();
  outraPorta.limiares.find((l) => l.nivel === 5).porta.min = 10;
  ok(!configIgual(configPadrao(), outraPorta), "devia acusar diferença de porta");
});

teste("horizonte de esquecimento cresce com a meia-vida", () => {
  ok(horizonteDeEsquecimento(60) > horizonteDeEsquecimento(14));
  igual(horizonteDeEsquecimento(0), 0);
});

/* ═══ §8 · Camada de query ═════════════════════════════════════════════════ */

teste("chave de cache não depende da ordem das opções", () => {
  igual(Query.chaveDe("r", { b: 1, a: 2 }), Query.chaveDe("r", { a: 2, b: 1 }));
  igual(Query.chaveDe("r", { a: 1, b: null }), Query.chaveDe("r", { a: 1 }), "vazio não entra na chave");
});

teste("chamadas simultâneas viram uma busca só", async () => {
  let n = 0;
  const buscador = async () => { n++; return CLIENTE.listarComunidades(); };
  Query.usar("t-dedupe", buscador);
  Query.usar("t-dedupe", buscador);
  Query.usar("t-dedupe", buscador);
  await new Promise((r) => setTimeout(r, 40));
  igual(n, 1, "buscou mais de uma vez");
  igual(Query.usar("t-dedupe", buscador).estado, "sucesso");
});

teste("erro não apaga o que já estava lido", async () => {
  const buscador = () => CLIENTE.listarComunidades();
  Query.usar("t-erro", buscador);
  await new Promise((r) => setTimeout(r, 40));
  const antes = Query.usar("t-erro", buscador, { ativa: false }).dado;
  ok(antes && antes.length > 0, "não carregou na primeira");

  MOCK.controles.definirFalha("rede", false);
  Query.invalidar("t-erro");
  Query.usar("t-erro", buscador);
  await new Promise((r) => setTimeout(r, 40));
  MOCK.controles.definirFalha("nenhuma", false);

  const depois = Query.usar("t-erro", buscador, { ativa: false });
  igual(depois.estado, "erro-com-dado");
  ok(depois.dado && depois.dado.length === antes.length, "o dado antigo sumiu junto com o erro");
  ok(depois.erro instanceof ErroDeRede, "o erro não veio tipado");
});

teste("paginação acumula e mantém a posição global", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const bp = (cursor) => CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 10, cursor });

  await Paginado.iniciar("t-pg", bp);
  await Paginado.carregarMais("t-pg", bp);
  const l = Paginado.usar("t-pg");
  igual(l.itens.length, 20);
  ok(l.itens.every((x, i) => x.posicao === i + 1), "as posições não ficaram contíguas");
  ok(l.total > 20, "total não veio");
});

/* ═══ §9 · Roteador ════════════════════════════════════════════════════════ */

teste("URL sobrevive à ida e volta", () => {
  const url = Rota.montar({ tela: "comunidade", comunidadeId: "x1", aba: "relatorios", query: { dias: "90" } });
  igual(url, "#/c/x1/relatorios?dias=90");
});

teste("aba desconhecida cai em atividade", () => {
  const hashAntes = location.hash;
  location.hash = "#/c/abc/nao-existe";
  igual(Rota.atual().aba, "atividade");
  location.hash = hashAntes || "#/";
});

/* ═══ §4 · Contrato do adaptador ═══════════════════════════════════════════ */

teste("comunidades trazem os campos do contrato", async () => {
  const cs = await CLIENTE.listarComunidades();
  ok(cs.length > 0, "veio vazio");
  for (const c of cs) {
    ok(typeof c.id === "string" && c.id, "id");
    ok(PLATAFORMAS.some((p) => p.id === c.plataforma), "plataforma desconhecida: " + c.plataforma);
    ok(typeof c.nome === "string" && c.nome, "nome");
    ok(Number.isFinite(c.membros), "membros");
    ok(ESTADOS_SYNC[c.estadoSync], "estado de sync desconhecido: " + c.estadoSync);
    ok(c.sincronizadaEm === null || !isNaN(Date.parse(c.sincronizadaEm)), "data inválida");
  }
});

teste("ranking vem ordenado e numerado do topo", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const p = await CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 15 });
  igual(p.itens.length, 15);
  igual(p.itens[0].posicao, 1);
  ok(p.itens.every((l, i, a) => i === 0 || a[i - 1].pontuacao >= l.pontuacao), "fora de ordem");
  ok(p.itens.every((l) => l.nivel >= 1 && l.nivel <= 5), "nível fora de 1–5");
  ok(p.itens.every((l) => ["subiu", "desceu", "estavel"].includes(l.tendencia)), "tendência inválida");
});

teste("a composição do membro soma a própria pontuação", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const p = await CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 1 });
  const d = await CLIENTE.obterMembro({ comunidadeId: viva.id, membroId: p.itens[0].membro.id, config: cfg });
  const soma = d.composicao.reduce((a, c) => a + c.contribuicao, 0);
  perto(soma, d.pontuacao, 0.5, "a explicação não bate com o número exibido");
});

teste("mexer num peso move a pontuação", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const alvo = (await CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 1 })).itens[0];

  const dobro = JSON.parse(JSON.stringify(cfg));
  dobro.pesos.reaction_given = (cfg.pesos.reaction_given || 1) * 4;

  /* Comparar **a mesma pessoa**, não o topo dos dois rankings: mexer num peso
     reordena a tabela, e `itens[0]` depois pode ser outra pessoa. Foi
     exatamente esse o erro que este teste tinha. */
  const depois = await CLIENTE.obterMembro({
    comunidadeId: viva.id, membroId: alvo.membro.id, config: dobro,
  });
  ok(depois.pontuacao > alvo.pontuacao,
    "aumentar peso não aumentou a pontuação de " + alvo.membro.nome +
    ": " + alvo.pontuacao + " → " + depois.pontuacao);
});

teste("distribuição de níveis cobre todos os membros lidos", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const r = await CLIENTE.resumoDaComunidade({ comunidadeId: viva.id, config: cfg });
  const soma = [1, 2, 3, 4, 5].reduce((a, n) => a + r.distribuicao[n], 0);
  igual(soma, r.membrosLidos, "sobrou ou faltou gente na distribuição");
});

teste("o mundo falso tem tamanho e forma de comunidade real", async () => {
  /* Guarda de calibragem. O §1.3 do briefing pede 300–900 membros por
     comunidade, e dado mockado pequeno esconde todo problema de escala.

     A forma importa tanto quanto o tamanho: tem de ser pirâmide. Se o nível 5
     ficar maior que o 4, virou ampulheta — foi o que aconteceu quando os
     limiares do bot entraram sem recalibrar os volumes do gerador, e sem este
     teste ninguém veria. */
  const cs = await CLIENTE.listarComunidades();
  const cfg = await CLIENTE.obterConfiguracoes();
  const vivas = cs.filter((c) => c.estadoSync === "conectada" || c.estadoSync === "desatualizada");
  ok(vivas.length >= 2, "poucas comunidades vivas pra conferir");

  for (const c of vivas) {
    const r = await CLIENTE.resumoDaComunidade({ comunidadeId: c.id, config: cfg });
    ok(r.membrosLidos >= 300 && r.membrosLidos <= 900,
      c.nome + " tem " + r.membrosLidos + " membros; o §1.3 pede 300–900");

    const d = r.distribuicao;
    const total = [1, 2, 3, 4, 5].reduce((a, n) => a + d[n], 0);
    const pct = (n) => (d[n] / total) * 100;

    ok(pct(1) > pct(2), c.nome + ": nível 1 devia ser o mais numeroso");
    ok(pct(2) > pct(3), c.nome + ": nível 2 devia superar o 3");
    ok(pct(5) <= 8, c.nome + ": nível 5 com " + pct(5).toFixed(1) + "% — alto demais para ser topo");
    ok(pct(3) + pct(4) + pct(5) < pct(1) + pct(2),
      c.nome + ": a metade de cima da régua ficou maior que a de baixo");
    ok(d[4] > 0, c.nome + ": nível 4 vazio — os limiares e o volume do gerador não conversam");

    /* A guarda que de fato pega descalibragem, e que as de porcentagem não
       pegam: **quanto o topo fica acima do limiar**.
       Inflar o volume do gerador mantém os percentuais quase iguais (o perfil
       `lider` é 4% da população de qualquer jeito) mas manda a pontuação do
       topo pra dez vezes a régua. Numa comunidade real o melhor membro não
       está 10× acima da barra — se está, a barra ou o gerador estão errados, e
       quem manda é a barra, que vem do bot. */
    const topo = (await CLIENTE.listarRanking({
      comunidadeId: c.id, config: cfg, limite: 1, ordem: "pontuacao",
    })).itens[0];
    const limiar5 = cfg.limiares.find((l) => l.nivel === 5).minScore;
    ok(topo.pontuacao <= limiar5 * 8,
      c.nome + ": maior pontuação é " + topo.pontuacao + ", " +
      (topo.pontuacao / limiar5).toFixed(1) + "× o limiar do nível 5 (" + limiar5 + "). " +
      "O gerador saiu da faixa dos limiares do bot.");
    ok(topo.pontuacao >= limiar5,
      c.nome + ": ninguém alcança o limiar do nível 5 — o gerador ficou fraco demais");
  }
});

teste("feed vem do mais novo pro mais velho, e filtra por tipo", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const p = await CLIENTE.listarEventos({ comunidadeId: viva.id, limite: 20 });
  ok(p.itens.every((e, i, a) => i === 0 || a[i - 1].ocorridoEm >= e.ocorridoEm), "fora de ordem");
  const f = await CLIENTE.listarEventos({ comunidadeId: viva.id, tipos: ["media_posted"], limite: 10 });
  ok(f.itens.every((e) => e.tipo === "media_posted"), "o filtro deixou passar outro tipo");
});

teste("nenhum evento nasce no futuro", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  MOCK.controles.rajada(5);
  const p = await CLIENTE.listarEventos({ comunidadeId: viva.id, limite: 40 });
  const agora = Date.now() + 1000;
  ok(p.itens.every((e) => Date.parse(e.ocorridoEm) <= agora), "evento com data no futuro deixaria o decaimento passar de 1");
});

/* ═══ §3 · Erros tipados ═══════════════════════════════════════════════════ */

teste("falha de rede vira ErroDeRede recuperável", async () => {
  MOCK.controles.definirFalha("rede", false);
  const e = await lanca(() => CLIENTE.listarComunidades(), ErroDeRede, "rede");
  ok(e.recuperavel, "erro de rede devia ser recuperável");
  MOCK.controles.definirFalha("nenhuma", false);
});

teste("limite de taxa diz quanto esperar", async () => {
  MOCK.controles.definirFalha("limite", false);
  const e = await lanca(() => CLIENTE.listarComunidades(), ErroDeLimite, "limite");
  ok(e.esperarSegundos > 0, "não disse por quanto tempo");
  MOCK.controles.definirFalha("nenhuma", false);
});

teste("id inexistente vira NaoEncontrado", async () => {
  await lanca(() => CLIENTE.obterComunidade("c_nao_existe_mesmo"), NaoEncontrado, "inexistente");
});

teste("plataforma indisponível recusa leitura", async () => {
  const cs = await CLIENTE.listarComunidades();
  const ind = cs.find((c) => c.estadoSync === "indisponivel");
  ok(ind, "o mundo devia ter ao menos uma indisponível");
  const e = await lanca(() => CLIENTE.listarEventos({ comunidadeId: ind.id }), null, "indisponível");
  igual(e.codigo, "indisponivel");
});

teste("todo erro tem texto pronto pro usuário", () => {
  const erros = [new ErroDeRede(), new ErroDeLimite(null, 30), new ErroDeAutenticacao(null, "discord"), new NaoEncontrado()];
  for (const erro of erros) {
    const x = explicarErro(erro);
    ok(x.titulo && x.texto && x.acao, "faltou texto pra " + erro.constructor.name);
    ok(!/erro \d|oops|undefined|null/i.test(x.titulo + x.texto), "texto técnico vazando: " + x.titulo);
  }
});

/* ═══ A fronteira ══════════════════════════════════════════════════════════
   O ponto do exercício inteiro. Se estes três caírem, a promessa de "trocar o
   backend é mudar uma linha" virou conversa. */

teste("FRONTEIRA · os três adaptadores têm a mesma superfície", () => {
  const r = mesmaSuperficie(MOCK.adaptador, ADAPTADOR_HTTP);
  ok(r.igual, "só no mock: [" + r.soEmA + "] · só no http: [" + r.soEmB + "]");

  /* O de arquivo entrou com a Etapa A da integração e passa a valer aqui: são
     três implementações da mesma superfície, e esquecer um método em qualquer
     uma delas tem de quebrar neste caso, não na tela. */
  const rf = mesmaSuperficie(MOCK.adaptador, ADAPTADOR_ARQUIVO);
  ok(rf.igual, "só no mock: [" + rf.soEmA + "] · só no arquivo: [" + rf.soEmB + "]");
});

teste("FRONTEIRA · o adaptador HTTP chama a API e preserva o slot não implementado", async () => {
  const fetchOriginal = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return { status: 200, ok: true, json: async () => [] };
  };
  try {
    await ADAPTADOR_HTTP.listarComunidades();
    await ADAPTADOR_HTTP.obterUrlConviteDiscord();
    ok(chamadas.length === 2, "a API não foi chamada pelas duas operações");
    ok(chamadas[0].url === "/comunidades", "rota inesperada: " + chamadas[0].url);
    ok(chamadas[0].opcoes.credentials === "include", "cookie não foi enviado");
    await lanca(() => ADAPTADOR_HTTP.salvarConfiguracoes({}), NotImplementedError, "salvarConfiguracoes");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

teste("FRONTEIRA · nenhuma tela alcança o mock", () => {
  /* Se uma tela citasse `MOCK`, trocar o adaptador não bastaria: ela
     continuaria falando com o mundo falso pelas costas do CLIENTE. Dá pra
     conferir de dentro do próprio navegador, lendo o código-fonte da função.

     As referências são diretas, não `globalThis[nome]`: em `const` de topo o
     nome não vira propriedade do global, e a varredura acharia zero funções e
     passaria vazia — um teste que não testa nada é pior que nenhum. Por isso
     também o piso de quantidade lá embaixo.

     `typeof x === "function"` antes de cada uma de §10b é o que permite este
     arquivo rodar enquanto 85-telas.js ainda não existe: `typeof` sobre nome
     não declarado é seguro, referência direta seria ReferenceError. */
  const candidatas = [
    ["renderSidebar", renderSidebar], ["renderTopbar", renderTopbar],
    ["renderConteudo", renderConteudo], ["renderSobreposicoes", renderSobreposicoes],
    ["renderToasts", renderToasts], ["seletor", seletor], ["corpoSeletor", corpoSeletor],
    ["popoverSino", popoverSino], ["estadoErro", estadoErro], ["estadoVazio", estadoVazio],
    ["faixa", faixa], ["skeletonFeed", skeletonFeed], ["linhaSync", linhaSync],
    ["executarComando", executarComando],
    ["telaDaAba", typeof telaDaAba === "function" ? telaDaAba : null],
    ["telaConfiguracoes", typeof telaConfiguracoes === "function" ? telaConfiguracoes : null],
    ["telaAtividade", typeof telaAtividade === "function" ? telaAtividade : null],
    ["telaMembros", typeof telaMembros === "function" ? telaMembros : null],
    ["telaRelatorios", typeof telaRelatorios === "function" ? telaRelatorios : null],
    ["drawerMembro", typeof drawerMembro === "function" ? drawerMembro : null],
    ["paletaComandos", typeof paletaComandos === "function" ? paletaComandos : null],
    ["modalConexao", typeof modalConexao === "function" ? modalConexao : null],
    ["sobreposicoesDasTelas", typeof sobreposicoesDasTelas === "function" ? sobreposicoesDasTelas : null],
  ];

  const conferidas = candidatas.filter(([, fn]) => typeof fn === "function");
  ok(conferidas.length >= 12, "a varredura só achou " + conferidas.length + " funções — ela quebrou, não passou");

  const culpadas = conferidas.filter(([, fn]) => /\bMOCK\b/.test(String(fn))).map(([nome]) => nome);
  igual(culpadas.length, 0, "telas falando direto com o mock: " + culpadas.join(", "));
});

teste("FRONTEIRA · o painel usa CLIENTE, não o mock, pra ler", () => {
  /* O contrário do teste acima: garante que `CLIENTE` é de fato o caminho, e
     que ele aponta pra um adaptador de verdade. */
  ok(CLIENTE && typeof CLIENTE.listarComunidades === "function", "CLIENTE não é um adaptador");
  ok(CLIENTE === ADAPTADOR_ATIVO, "CLIENTE divergiu de ADAPTADOR_ATIVO");
  ok(["mock", "http", "arquivo"].includes(CLIENTE.nome), "adaptador sem nome reconhecido");
});

teste("FRONTEIRA · o adaptador de arquivo não devolve sucesso falso em mutação", async () => {
  /* Uma fotografia não conecta nem ressincroniza nada. O perigo aqui não é
     lançar — é devolver `{ ok: true }` e a tela mostrar "conectado" sobre um
     arquivo estático. Mesma razão pela qual o HTTP lança em vez de devolver
     lista vazia. */
  for (const m of ["conectar", "reconectar", "ressincronizar", "desconectar"]) {
    const erro = await lanca(() => ADAPTADOR_ARQUIVO[m]({}), ErroDaApi, "método " + m);
    igual(erro.codigo, "somente_leitura", m + " lançou erro do tipo errado");
  }
});

/* ═══ §10b · Telas ═════════════════════════════════════════════════════════
   O briefing nomeia `descreverEvento` como uma das três coisas que não podem
   quebrar em silêncio, junto com as duas da Régua. É o que faz o feed
   continuar funcionando quando o produtor do evento mudar. */

teste("descreverEvento monta frase para todo tipo canônico", () => {
  const membro = { nome: "Marina Coelho" };
  for (const t of TIPOS_IDS) {
    const frase = descreverEvento({ tipo: t, payload: {} }, membro);
    ok(frase.indexOf("Marina Coelho ") === 0, "frase sem sujeito em " + t + ": " + frase);
    ok(/\.$/.test(frase), "frase sem ponto final em " + t + ": " + frase);
    ok(!/undefined|null|\[object/.test(frase), "payload vazando em " + t + ": " + frase);
  }
});

teste("descreverEvento usa o payload quando ele vem completo", () => {
  const m = { nome: "Ana" };
  igual(descreverEvento({ tipo: "message_sent", payload: { canal: "geral" } }, m), "Ana mandou uma mensagem em #geral.");
  igual(descreverEvento({ tipo: "invite_used", payload: { convidado: "Bruno" } }, m), "Ana trouxe Bruno para a comunidade.");
  igual(descreverEvento({ tipo: "reply_received", payload: { canal: "geral", de: "Bruno" } }, m), "Ana recebeu uma resposta de Bruno em #geral.");
});

teste("descreverEvento não flexiona gênero de ninguém", () => {
  /* O Discord não informa gênero, e o painel não deve inventar. Os eventos
     recebidos são a tentação — "foi respondida" — e por isso viraram
     "recebeu uma resposta". */
  const m = { nome: "Alex" };
  for (const t of TIPOS_IDS) {
    const frase = descreverEvento({ tipo: t, payload: { canal: "geral", de: "Bruno", novato: "Carla" } }, m);
    ok(!/\b(dela|dele|respondida|mencionada|convidada|convidado)\b/i.test(frase),
      "flexionou gênero em " + t + ": " + frase);
  }
});

teste("descreverEvento aguenta membro e payload faltando", () => {
  /* Um conector real vai mandar payload incompleto algum dia. "Marina mandou
     uma mensagem em #undefined" seria pior que uma frase genérica. */
  ok(descreverEvento({ tipo: "message_sent" }, null).indexOf("Alguém ") === 0);
  ok(!/undefined|null/.test(descreverEvento({}, null)), "tipo desconhecido vazou");
  ok(!/#/.test(descreverEvento({ tipo: "message_sent", payload: {} }, null)), "canal inexistente virou #");
});

teste("membro sem evento nenhum: pontuação zero, nível 1", () => {
  igual(pontuacaoDe({}, PESOS_PADRAO), 0);
  igual(nivelNatural(pontuacaoDe({}, PESOS_PADRAO), eixosZerados()), 1);
  igual(progressoDeNivel(0, eixosZerados()).nivel, 1);
  const e = eixosDe({}, PESOS_PADRAO);
  for (const id of EIXOS_IDS) igual(e[id], 0, "eixo " + id + " não zerou");
});

teste("as quatro telas desenham, vazias e com dado", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const hashAntes = location.hash;
  location.hash = "#/c/" + viva.id + "/atividade";

  /* Primeiro desenho: cache frio. Nenhuma tela pode quebrar por ainda não ter
     dado — é o estado que o usuário vê no primeiro décimo de segundo. */
  for (const aba of ABAS) {
    ok(typeof telaDaAba(aba, viva) === "string", "aba " + aba + " não devolveu string");
  }
  ok(telaConfiguracoes().length > 0, "configurações não desenhou frio");

  /* Segundo desenho: agora com o que as buscas do primeiro trouxeram. É o que
     exercita as ramificações de verdade — tabela, gráficos, prévia. */
  await new Promise((r) => setTimeout(r, 200));
  for (const aba of ABAS) {
    const html = telaDaAba(aba, viva);
    ok(html.length > 200, "aba " + aba + " veio curta demais: " + html.length);
    ok(!/undefined|NaN|\[object Object\]/.test(html), "lixo vazando na aba " + aba);
  }
  const config = telaConfiguracoes();
  ok(!/undefined|NaN|\[object Object\]/.test(config), "lixo vazando em configurações");

  telaUi.rascunho = null;
  location.hash = hashAntes || "#/";
});

teste("a prévia das Configurações calcula sozinha ao abrir a tela", async () => {
  /* Regressão encontrada no navegador, não no node: a tela devolvia string
     válida ("Calculando…") e passava no teste de fumaça, mas quem abrisse e não
     mexesse em nada nunca via número. Só o `input` de um slider disparava o
     cálculo.

     Conferir o texto, e não só que desenhou, é o que separa "não quebrou" de
     "funciona". */
  telaUi.previa = null;
  telaUi.previaPendente = false;
  telaUi.rascunho = null;

  const primeiro = telaConfiguracoes();
  ok(/Calculando/.test(primeiro), "a primeira pintura devia dizer que está calculando");

  await new Promise((r) => setTimeout(r, 400));
  const segundo = telaConfiguracoes();
  ok(!/Calculando…<\/p>\s*$/.test(segundo), "a prévia não saiu do estado de cálculo");
  ok(/pessoas em/.test(segundo), "a prévia não trouxe a contagem da comunidade");
  ok(telaUi.previa && typeof telaUi.previa.membros === "number",
    "a prévia não chegou a existir: " + JSON.stringify(telaUi.previa));

  telaUi.rascunho = null;
});

teste("cada estado de sync produz a faixa que explica aquele estado", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  for (const estado of Object.keys(ESTADOS_SYNC)) {
    const html = telaAtividade(Object.assign({}, viva, { estadoSync: estado }));
    ok(typeof html === "string" && html.length > 0, "estado " + estado + " não desenhou");
    if (estado !== "conectada") {
      ok(/faixa/.test(html), "estado " + estado + " não avisou nada ao usuário");
    }
    ok(!/undefined|\[object Object\]/.test(html), "lixo vazando no estado " + estado);
  }
});

teste("as sobreposições desenham em todos os passos", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const p = await CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 1 });
  const hashAntes = location.hash;

  /* Drawer, por deep link — que é como ele abre de verdade. */
  location.hash = "#/c/" + viva.id + "/membros?membro=" + p.itens[0].membro.id;
  await new Promise((r) => setTimeout(r, 200));
  const comDrawer = sobreposicoesDasTelas();
  ok(/class="drawer"/.test(comDrawer), "o drawer não abriu pelo link");
  ok(!/undefined|NaN|\[object Object\]/.test(comDrawer), "lixo vazando no drawer");
  location.hash = "#/c/" + viva.id + "/membros";

  /* Paleta. */
  telaUi.paleta = { termo: "", indice: 0 };
  ok(/class="paleta"/.test(paletaComandos()), "a paleta não desenhou");
  telaUi.paleta = { termo: "zzzznadaexiste", indice: 0 };
  ok(paletaComandos().length > 0, "a paleta quebrou sem resultados");
  telaUi.paleta = null;

  /* Fluxo de conexão, passo a passo. */
  for (const passo of PASSOS_CONEXAO) {
    telaUi.conexao = { passo, plataforma: "discord", nome: "Servidor de teste", erro: null };
    const html = modalConexao();
    ok(/class="modal"/.test(html), "passo " + passo + " não desenhou o modal");
    ok(!/undefined|\[object Object\]/.test(html), "lixo vazando no passo " + passo);
  }
  telaUi.conexao = { passo: "pronto", plataforma: "discord", nome: "X", erro: new ErroDeRede() };
  ok(modalConexao().length > 0, "o passo final quebrou com erro");
  telaUi.conexao = null;

  /* Painel de simulação. */
  telaUi.sim.aberto = true;
  const sim = painelSimulacao();
  ok(/class="sim"/.test(sim), "o painel de simulação não desenhou");
  ok(!/undefined|\[object Object\]/.test(sim), "lixo vazando no painel de simulação");
  telaUi.sim.aberto = false;

  location.hash = hashAntes || "#/";
});

teste("a prévia da Régua responde a mudança de peso", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();

  const igualzinho = await CLIENTE.simularRegua({ comunidadeId: viva.id, config: cfg });
  igual(igualzinho.sobem, 0, "sem mudar nada, ninguém devia subir");
  igual(igualzinho.descem, 0, "sem mudar nada, ninguém devia descer");
  igual(igualzinho.iguais, igualzinho.membros, "todo mundo devia ficar onde está");

  /* Multiplicar **todos** os pesos pelo mesmo fator é a única mexida que tem
     monotonicidade garantida, e vale a pena entender por quê: os eixos são
     normalizados pelo p90 da comunidade, então numerador e referência escalam
     juntos e as portas ficam exatamente onde estavam. Só a pontuação sobe — e
     os limiares de pontuação são absolutos. Logo, ninguém pode cair. */
  const escalada = JSON.parse(JSON.stringify(cfg));
  for (const t of TIPOS_IDS) escalada.pesos[t] = (cfg.pesos[t] || 0) * 4;
  const depois = await CLIENTE.simularRegua({ comunidadeId: viva.id, config: escalada });
  ok(depois.sobem > 0, "quadruplicar todos os pesos não promoveu ninguém");
  igual(depois.descem, 0, "escalar todos os pesos junto não pode rebaixar ninguém");
  igual(depois.sobem + depois.descem + depois.iguais, depois.membros, "a conta não fecha");
});

teste("SURPRESA · somar um valor a todos os pesos PODE rebaixar gente", async () => {
  /* Contraintuitivo e importante o bastante pra virar teste.
     Somar +20 a cada peso não é a mesma coisa que multiplicar: a composição
     relativa muda, os tipos baratos ganham proporcionalmente mais, o p90 de
     cada eixo passa a cair em outra pessoa, e quem estava logo acima de uma
     porta pode ficar logo abaixo.

     Ou seja: **"aumentei todos os pesos" não garante que ninguém desce.** Quem
     mexer na tela de Configurações precisa saber disso, e é por isso que a
     prévia mostra os dois números em vez de só o de promoções. */
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();

  const somada = JSON.parse(JSON.stringify(cfg));
  for (const t of TIPOS_IDS) somada.pesos[t] = (cfg.pesos[t] || 0) + 20;
  const r = await CLIENTE.simularRegua({ comunidadeId: viva.id, config: somada });

  igual(r.sobem + r.descem + r.iguais, r.membros, "a conta não fecha");
  ok(r.sobem > 0, "somar 20 a tudo devia promover alguém");
  /* Não afirmamos que `descem > 0` — depende do mundo sorteado. Afirmamos que o
     resultado é coerente, e o comentário acima registra o porquê de não dar
     para garantir zero. */
});

teste("pular o relógio faz a pontuação cair sem inventar evento", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();
  const antes = (await CLIENTE.listarRanking({ comunidadeId: viva.id, config: cfg, limite: 1 })).itens[0];

  MOCK.controles.pularDias(60);
  /* Pela mesma razão do teste dos pesos: pular o relógio reordena o ranking, e
     `itens[0]` depois é outra pessoa. Segue-se a mesma pessoa pelo id. */
  const depois = await CLIENTE.obterMembro({
    comunidadeId: viva.id, membroId: antes.membro.id, config: cfg,
  });

  ok(depois.pontuacao < antes.pontuacao, "o decaimento não agiu: " + antes.pontuacao + " → " + depois.pontuacao);
  igual(depois.totalEventos, antes.totalEventos, "pular o relógio não pode criar nem apagar evento");
  MOCK.controles.reconstruir(MOCK.controles.semente());
});

teste("filtro por nível no feed só deixa passar quem é daquele nível", async () => {
  const cs = await CLIENTE.listarComunidades();
  const viva = cs.find((c) => c.estadoSync === "conectada");
  const cfg = await CLIENTE.obterConfiguracoes();

  const p = await CLIENTE.listarEventos({ comunidadeId: viva.id, nivel: 5, config: cfg, limite: 30 });
  if (!p.itens.length) return;   /* comunidade sem nível 5: nada a conferir */

  const donos = new Set(p.itens.map((e) => e.membroId));
  for (const id of donos) {
    const d = await CLIENTE.obterMembro({ comunidadeId: viva.id, membroId: id, config: cfg });
    igual(d.nivel, 5, "evento de quem não é nível 5 passou pelo filtro");
  }
});

/* ── Arranque ─────────────────────────────────────────────────────────────────
   Última linha do arquivo, e tem que ser aqui: `iniciar()` toca funções de
   §10a e §10b, e só neste ponto o arquivo inteiro já foi avaliado — nenhuma
   constante ainda na zona morta. */
iniciar();
</script>
