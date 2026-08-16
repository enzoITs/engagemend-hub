
/* ── §5 · Adaptador HTTP (slot do backend real) ───────────────────────────────
   Este bloco é uma vaga, não uma implementação. Todo método lança
   `NotImplementedError`, e isso é de propósito: enquanto não existe backend,
   um método que devolvesse `[]` calado seria pior que um que grita — a tela
   mostraria "nenhum membro ainda" e ninguém descobriria que a integração nunca
   foi escrita.

   Não há `fetch`, `XMLHttpRequest`, `WebSocket`, URL de API, chave nem token
   aqui. O que há é a assinatura de cada método e, em comentário, a rota que ele
   deve chamar quando alguém for implementá-lo. É documentação executável do
   contrato: quem for ligar o backend preenche os corpos e não precisa
   adivinhar nem o nome nem o formato de nada.

   As assinaturas são idênticas às do adaptador mock. `mesmaSuperficie()`, no
   fim do bloco, verifica isso em tempo de carregamento — se alguém adicionar um
   método num adaptador e esquecer do outro, o painel de simulação acusa.
   ───────────────────────────────────────────────────────────────────────── */

async function http(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, { credentials: "include", ...opcoes });
  if (resposta.status === 401) {
    if (typeof window !== "undefined" && !caminho.startsWith("/api/auth/")) {
      window.dispatchEvent(new CustomEvent("engagemend-auth-required"));
    }
    throw new ErroDaApi("sessão expirada", "nao_autenticado");
  }
  if (resposta.status === 404) throw new ErroDaApi("não encontrado", "nao_encontrado");
  if (resposta.status === 409) throw new ErroDaApi("já conectado", "conflito");
  if (!resposta.ok) throw new ErroDaApi(`erro ${resposta.status}`, "erro_rede");
  if (resposta.status === 204) return null;
  return resposta.json();
}
function query(params) { const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""); return entries.length ? "?" + new URLSearchParams(entries).toString() : ""; }
const ADAPTADOR_HTTP = {
  nome: "http",

  async solicitarMagicLink(email) {
    return http("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },

  /* GET /comunidades → Comunidade[] */
  async listarComunidades() { return http("/comunidades"); },

  /* GET /comunidades/:id → Comunidade */
  async obterComunidade(id) { return http(`/comunidades/${id}`); },

  /* GET /comunidades/:id/eventos?tipos=&nivel=&membroId=&cursor=&limite=
     → Pagina<Evento> + { membros }

     `membros` é o dicionário id→{nome, arroba, iniciais} de quem aparece
     nesta página: o feed precisa escrever o nome e o evento só carrega o id.
     Mandar junto, uma vez por página, é mais barato que N chamadas ou que
     repetir o nome em cada um dos vinte mil eventos.

     `nivel` filtra por *membro*, não por evento — o nível é do membro e sai da
     Régua, então o servidor precisa da mesma config que a tela está usando. */
  async listarEventos(params) { const { comunidadeId, ...rest } = params || {}; return http(`/comunidades/${comunidadeId}/eventos${query(rest)}`); },

  /* GET /comunidades/:id/ranking?ordem=&direcao=&nivel=&atividade=&busca=&cursor=&limite=
     → Pagina<MembroComPontuacao> + { total, itens[].posicao }

     `ordem` ∈ pontuacao | nome | eventos | atividade | promocao.
     `atividade` ∈ 7 | 30 | 90 | inativo — faixa de última atividade, com
     "inativo" sendo o complemento de 90 dias.

     A pontuação é responsabilidade do servidor: mandar 40 mil eventos pro
     navegador somar seria absurdo. O servidor aplica a mesma Régua de §7 —
     é o mesmo modelo, do outro lado do fio. A config vai no corpo ou fica
     guardada por conta; o que não pode é a UI e o servidor discordarem sobre
     os pesos, senão a prévia mente. */
  async listarRanking(params) { const { comunidadeId, ...rest } = params || {}; return http(`/comunidades/${comunidadeId}/ranking${query(rest)}`); },

  /* GET /comunidades/:id/membros/:membroId → MembroComPontuacao
     + { comunidade, composicao, serie } */
  async obterMembro(params) { return http(`/comunidades/${params.comunidadeId}/membros/${params.membroId}`); },

  /* GET /comunidades/:id/resumo → fitas do topo da tela */
  async resumoDaComunidade(params) { return http(`/comunidades/${params.comunidadeId}/resumo`); },

  /* GET /comunidades/:id/relatorio?dias= → série, composição, distribuição */
  async relatorio(params) { const { comunidadeId, ...rest } = params || {}; return http(`/comunidades/${comunidadeId}/relatorio${query(rest)}`); },

  /* GET /notificacoes → Notificacao[] */
  async listarNotificacoes() { return http("/notificacoes"); },

  /* POST /notificacoes/:id/lida → Notificacao */
  async marcarNotificacaoLida(id) { return http(`/notificacoes/${id}/lida`, { method: "POST" }); },

  /* POST /notificacoes/lidas → { lidas: number } */
  async marcarTodasLidas() { return http("/notificacoes/lidas", { method: "POST" }); },

  /* GET /busca?q= → { comunidades, membros } */
  async buscar(termo) { return http(`/busca${query({ q: termo })}`); },

  /* GET /configuracoes → PesosRegua */
  async obterConfiguracoes() { return http("/configuracoes"); },

  /* POST /comunidades/:id/regua/simular → { sobem, descem, iguais, distribuicao }

     Prévia da tela de Configurações: o efeito de uma config sem gravá-la.
     Precisa ser do servidor pelo mesmo motivo que o ranking: quem tem o
     histórico é ele. Pode ser cacheado por (comunidade, config) — a resposta é
     função pura das duas coisas. */
  async simularRegua(params) { const { comunidadeId, ...body } = params; return http(`/comunidades/${comunidadeId}/regua/simular`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); },

  /* PUT /configuracoes → PesosRegua
     Gravar reprocessa a pontuação de todo mundo do lado do servidor. É a
     operação mais cara da API inteira e a tela precisa tratá-la como tal. */
  async salvarConfiguracoes(_config) {
    throw new NotImplementedError("salvarConfiguracoes");
  },

  /* POST /conexoes → Comunidade
     Aqui mora o OAuth de verdade: redirect, callback, troca de código por
     token, token guardado no servidor e nunca no navegador. A tela de §10 já
     executa a coreografia inteira; o que falta é o outro lado. */
  async conectar(params) { return http("/conexoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }); },

  /* POST /comunidades/:id/reconectar → Comunidade */
  async obterUrlConviteDiscord() { return http("/api/discord/invite-url"); },
  async reconectar(id) { return http(`/comunidades/${id}/reconectar`, { method: "POST" }); },

  /* POST /comunidades/:id/sincronizar → Comunidade */
  async ressincronizar(id) { return http(`/comunidades/${id}/sincronizar`, { method: "POST" }); },

  /* DELETE /comunidades/:id → { id } */
  async desconectar(id) { return http(`/comunidades/${id}`, { method: "DELETE" }); },
};

/* ── §5b · Adaptador de arquivo (export do bot) ───────────────────────────────
   Terceira implementação da mesma superfície. Lê o JSON que
   `pnpm report --export=json` despeja do `engagemend-discord` e responde a
   partir dele.

   O que este adaptador **não** faz é tão importante quanto o que faz: ele não
   recebe nível pronto. O export traz os eventos crus, e a pontuação e o nível
   saem daqui, da Régua de §7 — que é port do `src/classifier/` do bot. É esse
   recálculo que dá sentido à etapa: se o painel e o bot chegarem a níveis
   diferentes para a mesma pessoa, o port está errado. O bloco `perfis` do
   arquivo é o gabarito dessa comparação, e não alimenta tela nenhuma.

   **O relógio é o do arquivo, não o de hoje.** `agora` é o instante em que o
   bot classificou (`meta.classificadoEm`). Usar `Date.now()` faria todo evento
   decair mais um tanto desde a exportação e o painel discordaria do gabarito
   por construção — a comparação mediria a idade do arquivo, não o port.
   ───────────────────────────────────────────────────────────────────────── */

const CAMINHO_DO_EXPORT = "./painel.json";

const ADAPTADOR_ARQUIVO = (() => {
  let dados = null;
  let indice = null;
  let configAtual = null;
  const lidas = new Set();      /* notificações marcadas nesta sessão */

  const CHAVE_CONFIG = "engagemend:config:arquivo";

  /* O mock fecha os dele dentro da própria IIFE — e faz certo: fossem
     compartilhados, uma tela poderia alcançar o mundo falso por eles. O preço
     é esta repetição, que é barata. O formato do cursor é o mesmo de propósito:
     opaco, pra ninguém fazer conta com o índice. */
  const JANELA_TENDENCIA = 30;

  const abrirCursor = (c) => {
    if (!c) return 0;
    const n = parseInt(atob(String(c)).replace(/^p:/, ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const fecharCursor = (i, total) => (i >= total ? null : btoa("p:" + i));

  async function carregar() {
    if (indice) return indice;

    let resp;
    try {
      resp = await fetch(CAMINHO_DO_EXPORT, { cache: "no-store" });
    } catch (e) {
      throw new ErroDeRede(
        "Não consegui ler " + CAMINHO_DO_EXPORT + ". O painel precisa ser servido por " +
        "HTTP — abrir o arquivo direto do disco não deixa o navegador buscar o export."
      );
    }
    if (!resp.ok) {
      throw new NaoEncontrado(
        CAMINHO_DO_EXPORT + " não encontrado (" + resp.status + "). Gere com " +
        "`pnpm report --export=json` no repositório do bot."
      );
    }

    dados = await resp.json();
    if (!dados || !dados.meta || !Array.isArray(dados.eventos)) {
      throw new ErroDaApi("O arquivo existe mas não tem o formato do export.", "formato");
    }

    indice = montarIndice(dados);
    return indice;
  }

  function montarIndice(d) {
    const comunidadesPorId = new Map();
    for (const c of (d.comunidades || [])) comunidadesPorId.set(c.id, c);

    const membrosPorId = new Map();
    for (const mb of d.membros) membrosPorId.set(mb.id, mb);

    /* Do mais novo pro mais velho, que é a ordem que o feed espera e a que faz
       `eventos[0]` ser a última atividade. */
    const eventos = d.eventos.slice().sort((a, b) =>
      new Date(b.ocorridoEm).getTime() - new Date(a.ocorridoEm).getTime());

    const porMembro = new Map();
    for (const ev of eventos) {
      let lista = porMembro.get(ev.membroId);
      if (!lista) { lista = []; porMembro.set(ev.membroId, lista); }
      lista.push(ev);
    }

    /* Membro que aparece em evento mas não em `membros` não deveria existir —
       mas se existir, some da tela em silêncio, e some com os eventos dele. É
       melhor inventar um registro mínimo e deixar visível que falta nome. A
       comunidade vem do próprio evento, já que o arquivo agora tem mais de
       uma. */
    for (const [id, lista] of porMembro) {
      if (membrosPorId.has(id)) continue;
      const comunidade = comunidadesPorId.get(lista[0].comunidadeId);
      membrosPorId.set(id, {
        id, comunidadeId: lista[0].comunidadeId,
        plataforma: comunidade ? comunidade.plataforma : "discord",
        nome: id.slice(0, 8), arroba: "", iniciais: "??",
        entrouEm: d.meta.coletadoDesde,
      });
    }

    const agora = new Date(d.meta.classificadoEm || d.meta.coletadoAte || Date.now());

    const gabarito = new Map();
    for (const p of d.perfis || []) gabarito.set(p.membroId, p);

    /* Cada comunidade enxerga só os próprios membros — é o que faz a régua
       normalizar contra os pares certos (p90 do Discord não deve influenciar
       o nível de alguém do YouTube, e vice-versa). */
    const membrosDaComunidade = new Map();
    for (const mb of membrosPorId.values()) {
      let lista = membrosDaComunidade.get(mb.comunidadeId);
      if (!lista) { lista = []; membrosDaComunidade.set(mb.comunidadeId, lista); }
      lista.push(mb);
    }

    const porComunidade = new Map();
    for (const comunidade of comunidadesPorId.values()) {
      porComunidade.set(comunidade.id, {
        comunidade,
        membros: membrosDaComunidade.get(comunidade.id) || [],
      });
    }

    return {
      comunidades: Array.from(comunidadesPorId.values()),
      porComunidade,
      membrosPorId,
      eventos,
      porMembro,
      agora,
      agoraMs: agora.getTime(),
      gabarito,
      transicoes: d.transicoes || [],
      meta: d.meta,
      /* Memo das somas decaídas por (meia-vida, janela). Mesmo motivo do mock:
         mexer num peso não pode revarrer os eventos. */
      somas: new Map(),
      referencias: new Map(),
    };
  }

  /* ── Régua aplicada ao arquivo ─────────────────────────────────────────── */

  function somasDe(meiaVidaDias, janelaDias) {
    const chave = meiaVidaDias + ":" + janelaDias;
    const memo = indice.somas.get(chave);
    if (memo) return memo;

    const tabela = new Map();
    const antesMs = indice.agoraMs - JANELA_TENDENCIA * DIA_MS;

    for (const [membroId, lista] of indice.porMembro) {
      const zerado = () => { const s = {}; for (const t of TIPOS_IDS) s[t] = 0; return s; };
      const agora = zerado();
      const antes = zerado();

      for (const ev of aplicarTetosDiarios(lista)) {
        const ms = new Date(ev.ocorridoEm).getTime();

        const idade = (indice.agoraMs - ms) / DIA_MS;
        if (idade >= 0 && dentroDaJanela(idade, janelaDias)) {
          agora[ev.tipo] += fatorDecaimento(idade, meiaVidaDias) * qualidadeDe(ev);
        }
        if (ms <= antesMs) {
          const idadeAntes = (antesMs - ms) / DIA_MS;
          if (dentroDaJanela(idadeAntes, janelaDias)) {
            antes[ev.tipo] += fatorDecaimento(idadeAntes, meiaVidaDias) * qualidadeDe(ev);
          }
        }
      }
      tabela.set(membroId, { agora, antes });
    }

    indice.somas.set(chave, tabela);
    return tabela;
  }

  /** p90 de cada eixo dentro da comunidade — inclui quem tem zero, como no bot. */
  function referenciasDe(config, comunidadeId) {
    const chave = comunidadeId + ":" + JSON.stringify(config.pesos) + ":" + config.meiaVidaDias + ":" + config.janelaDias;
    const memo = indice.referencias.get(chave);
    if (memo) return memo;

    const tabela = somasDe(config.meiaVidaDias, config.janelaDias);
    const ci = exigirComunidadeIndice(comunidadeId);
    const lista = ci.membros.map((mb) => {
      const s = tabela.get(mb.id);
      return eixosDe(s ? s.agora : null, config.pesos);
    });

    const ref = referenciasDeEixo(lista);
    indice.referencias.set(chave, ref);
    return ref;
  }

  function pontuar(membro, config) {
    const tabela = somasDe(config.meiaVidaDias, config.janelaDias);
    const somas = tabela.get(membro.id) || { agora: null, antes: null };
    const referencia = referenciasDe(config, membro.comunidadeId);

    const pontuacao = pontuacaoDe(somas.agora, config.pesos);
    const eixos = normalizarEixos(eixosDe(somas.agora, config.pesos), referencia);
    const nivel = nivelNatural(pontuacao, eixos, config.limiares);

    const pontuacaoAntes = pontuacaoDe(somas.antes, config.pesos);
    const eixosAntes = normalizarEixos(eixosDe(somas.antes, config.pesos), referencia);
    const nivelAnterior = nivelNatural(pontuacaoAntes, eixosAntes, config.limiares);

    const eventos = indice.porMembro.get(membro.id) || [];
    const delta = pontuacao - pontuacaoAntes;

    const arredondarEixos = (e) => {
      const s = {};
      for (const id of EIXOS_IDS) s[id] = Math.round(e[id] * 10) / 10;
      return s;
    };

    return {
      membro,
      pontuacao: Math.round(pontuacao * 10) / 10,
      nivel,
      eixos: arredondarEixos(eixos),
      totalEventos: eventos.length,
      ultimaAtividade: eventos.length ? eventos[0].ocorridoEm : null,
      tendencia: delta > 2 ? "subiu" : delta < -2 ? "desceu" : "estavel",
      deltaPontuacao: Math.round(delta * 10) / 10,
      nivelAnterior: nivelAnterior === nivel ? null : nivelAnterior,
    };
  }

  function configDaSessao() {
    if (configAtual) return configAtual;
    try {
      const bruto = localStorage.getItem(CHAVE_CONFIG);
      configAtual = bruto ? normalizarConfig(JSON.parse(bruto)) : configPadrao();
    } catch (e) {
      configAtual = configPadrao();
    }
    return configAtual;
  }

  function paginarLista(lista, cursor, limite) {
    const inicio = abrirCursor(cursor);
    const fim = Math.min(inicio + limite, lista.length);
    return { itens: lista.slice(inicio, fim), proximoCursor: fecharCursor(fim, lista.length) };
  }

  function exigirComunidadeIndice(id) {
    const alvo = id || (indice.comunidades[0] && indice.comunidades[0].id);
    const ci = alvo && indice.porComunidade.get(alvo);
    if (!ci) throw new NaoEncontrado("Comunidade não encontrada neste export.");
    return ci;
  }

  function exigirComunidade(id) {
    return exigirComunidadeIndice(id).comunidade;
  }

  /** Uma fotografia não conecta, não reconecta e não desconecta nada. */
  function recusarMutacao(oQue) {
    throw new ErroDaApi(
      oQue + " não existe num export: este painel está lendo uma fotografia do banco, " +
      "não uma conexão ao vivo. Rode `pnpm report --export=json` de novo para atualizar.",
      "somente_leitura"
    );
  }

  return {
    nome: "arquivo",
    async solicitarMagicLink() { return { ok: true }; },

    async listarComunidades() {
      await carregar();
      return indice.comunidades.map((c) => Object.assign({}, c));
    },

    async obterComunidade(id) {
      await carregar();
      return Object.assign({}, exigirComunidade(id));
    },

    async listarEventos({ comunidadeId, tipos, nivel, membroId, config, cursor, limite } = {}) {
      await carregar();
      const ci = exigirComunidadeIndice(comunidadeId);
      const cfg = config || configDaSessao();

      let lista = membroId
        ? (indice.porMembro.get(membroId) || [])
        : indice.eventos.filter((e) => e.comunidadeId === ci.comunidade.id);
      if (tipos && tipos.length) {
        const set = new Set(tipos);
        lista = lista.filter((e) => set.has(e.tipo));
      }
      if (nivel) {
        const alvo = new Set(
          ci.membros.filter((mb) => pontuar(mb, cfg).nivel === Number(nivel)).map((mb) => mb.id)
        );
        lista = lista.filter((e) => alvo.has(e.membroId));
      }

      const pagina = paginarLista(lista, cursor, limite || 25);
      const membros = {};
      for (const ev of pagina.itens) {
        if (membros[ev.membroId]) continue;
        const mb = indice.membrosPorId.get(ev.membroId);
        if (mb) membros[ev.membroId] = { id: mb.id, nome: mb.nome, arroba: mb.arroba, iniciais: mb.iniciais };
      }
      pagina.membros = membros;
      return pagina;
    },

    async listarRanking({ comunidadeId, config, ordem, direcao, nivel, atividade, busca, cursor, limite } = {}) {
      await carregar();
      const ci = exigirComunidadeIndice(comunidadeId);
      const cfg = config || configDaSessao();

      let linhas = ci.membros.map((mb) => pontuar(mb, cfg));
      if (nivel) linhas = linhas.filter((l) => l.nivel === nivel);
      if (atividade) {
        const dias = atividade === "inativo" ? 90 : Number(atividade);
        const corte = indice.agoraMs - dias * DIA_MS;
        linhas = linhas.filter((l) => {
          const ms = l.ultimaAtividade ? new Date(l.ultimaAtividade).getTime() : 0;
          return atividade === "inativo" ? ms < corte : ms >= corte;
        });
      }
      if (busca && busca.trim()) {
        const q = busca.trim().toLowerCase();
        linhas = linhas.filter((l) =>
          l.membro.nome.toLowerCase().includes(q) || l.membro.arroba.toLowerCase().includes(q));
      }

      const chave = ordem || "pontuacao";
      const sinal = direcao === "asc" ? 1 : -1;
      linhas.sort((a, b) => {
        let x, y;
        if (chave === "nome") return a.membro.nome.localeCompare(b.membro.nome, "pt-BR") * sinal;
        if (chave === "promocao") {
          const grau = (l) => (l.nivelAnterior === null ? 0 : l.nivel > l.nivelAnterior ? 2 : 1);
          const ga = grau(a), gb = grau(b);
          if (ga !== gb) return (ga < gb ? -1 : 1) * sinal;
          x = Math.abs(a.deltaPontuacao); y = Math.abs(b.deltaPontuacao);
        }
        else if (chave === "eventos") { x = a.totalEventos; y = b.totalEventos; }
        else if (chave === "atividade") {
          x = a.ultimaAtividade ? new Date(a.ultimaAtividade).getTime() : 0;
          y = b.ultimaAtividade ? new Date(b.ultimaAtividade).getTime() : 0;
        } else { x = a.pontuacao; y = b.pontuacao; }
        return (x < y ? -1 : x > y ? 1 : 0) * sinal;
      });

      const total = linhas.length;
      const pagina = paginarLista(linhas, cursor, limite || 25);
      const inicio = abrirCursor(cursor);
      pagina.itens = pagina.itens.map((l, i) => Object.assign({ posicao: inicio + i + 1 }, l));
      pagina.total = total;
      return pagina;
    },

    async obterMembro({ comunidadeId, membroId, config } = {}) {
      await carregar();
      const comunidade = exigirComunidade(comunidadeId);
      const membro = indice.membrosPorId.get(membroId);
      if (!membro) throw new NaoEncontrado("Membro não encontrado.");

      const cfg = config || configDaSessao();
      const base = pontuar(membro, cfg);
      const somas = somasDe(cfg.meiaVidaDias, cfg.janelaDias).get(membroId);
      const eventos = indice.porMembro.get(membroId) || [];

      const composicao = TIPOS_EVENTO.map((t) => ({
        tipo: t.id,
        contribuicao: Math.round((somas ? somas.agora[t.id] : 0) * cfg.pesos[t.id] * 10) / 10,
        eventos: eventos.filter((e) => e.tipo === t.id).length,
      })).filter((c) => c.eventos > 0);

      return Object.assign({}, base, {
        comunidade: Object.assign({}, comunidade),
        composicao,
        serie: serieDoMembroArquivo(membro, cfg, 30),
      });
    },

    async resumoDaComunidade({ comunidadeId, config } = {}) {
      await carregar();
      const ci = exigirComunidadeIndice(comunidadeId);
      const comunidade = ci.comunidade;
      const cfg = config || configDaSessao();
      const eventosComunidade = indice.eventos.filter((e) => e.comunidadeId === comunidade.id);

      const linhas = ci.membros.map((mb) => pontuar(mb, cfg));
      const corte = indice.agoraMs - JANELA_TENDENCIA * DIA_MS;
      const corteAnterior = corte - JANELA_TENDENCIA * DIA_MS;

      let recentes = 0, anteriores = 0;
      for (const e of eventosComunidade) {
        const ms = new Date(e.ocorridoEm).getTime();
        if (ms >= corte) recentes++;
        else if (ms >= corteAnterior) anteriores++;
      }

      const corte7 = indice.agoraMs - 7 * DIA_MS;
      const inicioHoje = new Date(indice.agoraMs);
      inicioHoje.setHours(0, 0, 0, 0);
      const msHoje = inicioHoje.getTime();
      let eventosHoje = 0;
      for (const e of eventosComunidade) {
        if (new Date(e.ocorridoEm).getTime() >= msHoje) eventosHoje++;
      }

      const distribuicao = {};
      for (const n of [1, 2, 3, 4, 5]) distribuicao[n] = linhas.filter((l) => l.nivel === n).length;

      return {
        comunidade: Object.assign({}, comunidade),
        membrosLidos: linhas.length,
        ativos7d: linhas.filter((l) => l.ultimaAtividade && new Date(l.ultimaAtividade).getTime() >= corte7).length,
        eventosHoje,
        ativos30d: linhas.filter((l) => l.ultimaAtividade && new Date(l.ultimaAtividade).getTime() >= corte).length,
        eventos30d: recentes,
        variacaoEventos: anteriores === 0 ? null : Math.round(((recentes - anteriores) / anteriores) * 100),
        subiramNivel: linhas.filter((l) => l.nivelAnterior !== null && l.nivel > l.nivelAnterior).length,
        desceramNivel: linhas.filter((l) => l.nivelAnterior !== null && l.nivel < l.nivelAnterior).length,
        distribuicao,
      };
    },

    async relatorio({ comunidadeId, config, dias } = {}) {
      await carregar();
      const ci = exigirComunidadeIndice(comunidadeId);
      const comunidade = ci.comunidade;
      const cfg = config || configDaSessao();
      const janela = dias || 30;
      const inicio = indice.agoraMs - janela * DIA_MS;
      const eventosComunidade = indice.eventos.filter((e) => e.comunidadeId === comunidade.id);

      const balde = new Map();
      for (let d = 0; d < janela; d++) {
        const dia = new Date(indice.agoraMs - (janela - 1 - d) * DIA_MS);
        dia.setHours(0, 0, 0, 0);
        balde.set(dia.getTime(), 0);
      }
      const porTipo = {};
      for (const t of TIPOS_IDS) porTipo[t] = 0;

      for (const e of eventosComunidade) {
        const ms = new Date(e.ocorridoEm).getTime();
        if (ms < inicio) continue;
        const dia = new Date(ms);
        dia.setHours(0, 0, 0, 0);
        const k = dia.getTime();
        if (balde.has(k)) balde.set(k, balde.get(k) + 1);
        porTipo[e.tipo]++;
      }

      const linhas = ci.membros.map((mb) => pontuar(mb, cfg));
      const distribuicao = {};
      for (const n of [1, 2, 3, 4, 5]) distribuicao[n] = linhas.filter((l) => l.nivel === n).length;

      return {
        comunidade: Object.assign({}, comunidade),
        dias: janela,
        serie: Array.from(balde, ([ms, n]) => ({ dia: new Date(ms).toISOString(), eventos: n })),
        composicao: TIPOS_EVENTO
          .map((t) => ({ tipo: t.id, eventos: porTipo[t.id] }))
          .filter((c) => c.eventos > 0),
        distribuicao,
        movimento: linhas
          .filter((l) => l.nivelAnterior !== null)
          .sort((a, b) => Math.abs(b.deltaPontuacao) - Math.abs(a.deltaPontuacao))
          .slice(0, 12),
        movimentoResumo: {
          janelaDias: JANELA_TENDENCIA,
          subiram: linhas.filter((l) => l.nivelAnterior !== null && l.nivel > l.nivelAnterior).length,
          desceram: linhas.filter((l) => l.nivelAnterior !== null && l.nivel < l.nivelAnterior).length,
          estaveis: linhas.filter((l) => l.nivelAnterior === null).length,
        },
        topo: linhas.slice().sort((a, b) => b.pontuacao - a.pontuacao).slice(0, 10),
      };
    },

    /* As notificações do painel são as transições de nível do bot — é
       literalmente a mesma informação, e `level_transitions` é o que a M2
       consome. "lida" só existe nesta sessão: o arquivo é somente leitura. */
    async listarNotificacoes() {
      await carregar();
      return indice.transicoes
        .slice()
        .sort((a, b) => new Date(b.ocorridoEm).getTime() - new Date(a.ocorridoEm).getTime())
        .map((t) => {
          const mb = indice.membrosPorId.get(t.membroId);
          const nome = mb ? mb.nome : t.membroId.slice(0, 8);
          const subiu = t.de === null || t.para > t.de;
          return {
            id: "t" + t.id,
            comunidadeId: mb ? mb.comunidadeId : null,
            membroId: t.membroId,
            tipo: t.de === null ? "marco" : subiu ? "subiu_nivel" : "desceu_nivel",
            texto: t.de === null
              ? nome + " entrou como " + nomeDoNivel(t.para)
              : nome + (subiu ? " subiu para " : " desceu para ") + nomeDoNivel(t.para),
            criadaEm: t.ocorridoEm,
            lida: lidas.has("t" + t.id),
          };
        });
    },

    async marcarNotificacaoLida(id) {
      await carregar();
      lidas.add(id);
      const todas = await this.listarNotificacoes();
      const n = todas.find((x) => x.id === id);
      if (!n) throw new NaoEncontrado("Notificação não encontrada.");
      return n;
    },

    async marcarTodasLidas() {
      await carregar();
      for (const t of indice.transicoes) lidas.add("t" + t.id);
      return { lidas: indice.transicoes.length };
    },

    async buscar(termo) {
      await carregar();
      const q = String(termo || "").trim().toLowerCase();
      if (q.length < 2) return { comunidades: [], membros: [] };
      return {
        comunidades: indice.comunidades
          .filter((c) => c.nome.toLowerCase().includes(q))
          .map((c) => Object.assign({}, c)),
        membros: Array.from(indice.membrosPorId.values())
          .filter((mb) => mb.nome.toLowerCase().includes(q) || mb.arroba.toLowerCase().includes(q))
          .slice(0, 8)
          .map((mb) => Object.assign({}, mb)),
      };
    },

    async obterConfiguracoes() {
      await carregar();
      return JSON.parse(JSON.stringify(configDaSessao()));
    },

    async simularRegua({ comunidadeId, config } = {}) {
      await carregar();
      const ci = exigirComunidadeIndice(comunidadeId);
      const atual = configDaSessao();
      const proposta = config || atual;

      let sobem = 0, descem = 0, iguais = 0, travados = 0;
      const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const semPorta = proposta.limiares.map((l) => ({ nivel: l.nivel, minScore: l.minScore, porta: null }));

      for (const mb of ci.membros) {
        const antes = pontuar(mb, atual).nivel;
        const p = pontuar(mb, proposta);
        distribuicao[p.nivel]++;
        if (p.nivel > antes) sobem++;
        else if (p.nivel < antes) descem++;
        else iguais++;
        if (nivelNatural(p.pontuacao, null, semPorta) > p.nivel) travados++;
      }
      return { comunidadeId: ci.comunidade.id, membros: ci.membros.length, sobem, descem, iguais, travados, distribuicao };
    },

    /* A única mutação que sobrevive à fotografia. Grava local, não no bot: no
       bot, mudar peso é editar `weights.ts`, subir `WEIGHTS_VERSION` e rodar
       `--full-recompute`. Aqui serve pra ver a prévia mexer, que é o que se
       quer testar contra dado real. */
    async salvarConfiguracoes(config) {
      await carregar();
      configAtual = normalizarConfig(config);
      try {
        localStorage.setItem(CHAVE_CONFIG, JSON.stringify(configAtual));
      } catch (e) { /* sem localStorage: vale só nesta sessão */ }
      return JSON.parse(JSON.stringify(configAtual));
    },

    async conectar() { recusarMutacao("Conectar comunidade"); },
    async obterUrlConviteDiscord() { return { url: "#" }; },
    async reconectar() { recusarMutacao("Reconectar"); },
    async ressincronizar() { recusarMutacao("Ressincronizar"); },
    async desconectar() { recusarMutacao("Desconectar"); },

    /* ── Fora do contrato: a comparação com o gabarito ──────────────────────
       Não é método do adaptador — é a ferramenta da Fase 3. Fica aqui porque
       só este adaptador tem gabarito. Chamar no console:
       `await CLIENTE.compararComOBot()`. */
    async compararComOBot(config) {
      await carregar();
      const cfg = config || configDaSessao();
      const linhas = [];
      let iguais = 0;

      for (const mb of indice.membrosPorId.values()) {
        const meu = pontuar(mb, cfg);
        const dele = indice.gabarito.get(mb.id);
        if (!dele) continue;
        const bate = meu.nivel === dele.nivel;
        if (bate) iguais++;
        linhas.push({
          membro: mb.nome,
          nivelPainel: meu.nivel,
          nivelBot: dele.nivel,
          bate,
          pontuacaoPainel: meu.pontuacao,
          score30dBot: Math.round(dele.score30d * 10) / 10,
          eixosPainel: meu.eixos,
          eixosBot: {
            consumption: Math.round(dele.eixos.consumption * 10) / 10,
            production: Math.round(dele.eixos.production * 10) / 10,
            reciprocity: Math.round(dele.eixos.reciprocity * 10) / 10,
            influence: Math.round(dele.eixos.influence * 10) / 10,
          },
        });
      }

      const resumo = iguais + " de " + linhas.length + " com nível idêntico";
      console.log(resumo);
      console.table(linhas.map((l) => ({
        membro: l.membro, painel: l.nivelPainel, bot: l.nivelBot, bate: l.bate,
        pontPainel: l.pontuacaoPainel, scoreBot: l.score30dBot,
      })));
      return { iguais, total: linhas.length, resumo, linhas };
    },
  };

  function serieDoMembroArquivo(membro, config, dias) {
    const eventos = aplicarTetosDiarios(indice.porMembro.get(membro.id) || []);
    const referencia = referenciasDe(config);
    const saida = [];

    for (let d = dias - 1; d >= 0; d--) {
      const ref = indice.agoraMs - d * DIA_MS;
      const somas = {};
      for (const t of TIPOS_IDS) somas[t] = 0;

      for (const e of eventos) {
        const ms = new Date(e.ocorridoEm).getTime();
        if (ms > ref) continue;
        const idade = (ref - ms) / DIA_MS;
        if (!dentroDaJanela(idade, config.janelaDias)) continue;
        somas[e.tipo] += fatorDecaimento(idade, config.meiaVidaDias) * qualidadeDe(e);
      }

      const pontuacao = pontuacaoDe(somas, config.pesos);
      const eixos = normalizarEixos(eixosDe(somas, config.pesos), referencia);
      saida.push({
        dia: new Date(ref).toISOString(),
        pontuacao: Math.round(pontuacao * 10) / 10,
        nivel: nivelNatural(pontuacao, eixos, config.limiares),
      });
    }
    return saida;
  }
})();

/**
 * Os adaptadores implementam exatamente os mesmos métodos?
 *
 * `compararComOBot` é ferramenta de conferência, não contrato — fica de fora
 * da comparação de propósito, senão a guarda acusaria diferença que não é.
 */
function mesmaSuperficie(a, b) {
  const FORA_DO_CONTRATO = new Set(["compararComOBot"]);
  const metodos = (o) => Object.keys(o)
    .filter((k) => typeof o[k] === "function" && !FORA_DO_CONTRATO.has(k))
    .sort();
  const ma = metodos(a);
  const mb = metodos(b);
  return {
    igual: ma.length === mb.length && ma.every((k, i) => k === mb[i]),
    soEmA: ma.filter((k) => !mb.includes(k)),
    soEmB: mb.filter((k) => !ma.includes(k)),
  };
}

/* ── §6 · CLIENTE ─────────────────────────────────────────────────────────────
   O ponto de troca. Uma linha.

   Trocar `MOCK.adaptador` por `ADAPTADOR_HTTP` aqui embaixo é a única edição
   necessária para o painel inteiro passar a falar com um backend real. Nenhuma
   tela, nenhum componente e nenhuma query mencionam `MOCK` — todos passam por
   `CLIENTE`. Se alguma tela precisasse ser editada junto, a fronteira estaria
   furada, e §11 tem um teste que verifica justamente isso.

   É por isso que o mundo falso vive fechado dentro da IIFE de §4: não é
   disciplina, é impossibilidade. Uma tela não *consegue* alcançar o gerador
   nem que queira.
   ───────────────────────────────────────────────────────────────────────── */

/* ← A LINHA. Trocar o valor daqui é a única edição necessária pra o painel
   inteiro mudar de fonte de dados.

     "mock"     o mundo falso de §4. É o padrão, e é o que §11 exercita.
     "arquivo"  o export do bot (`painel.json` ao lado do HTML). Fotografia:
                lê de verdade, não escreve nada. Exige servir por HTTP.
     "http"     a API, quando existir. Hoje todo método lança. */
const FONTE_DE_DADOS = "mock";

const ADAPTADOR_ATIVO =
  FONTE_DE_DADOS === "arquivo" ? ADAPTADOR_ARQUIVO :
  FONTE_DE_DADOS === "http" ? ADAPTADOR_HTTP :
  MOCK.adaptador;

const CLIENTE = ADAPTADOR_ATIVO;

/** O painel de simulação só existe quando o adaptador é o mock. */
const usandoMock = () => CLIENTE.nome === "mock";
