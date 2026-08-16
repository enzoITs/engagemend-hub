
/* ── §8 · Camada de query ─────────────────────────────────────────────────────
   O TanStack Query que o briefing pede não existe aqui (ver relatório final),
   então este bloco escreve à mão só o que o painel de fato usa: cache por
   chave, deduplicação de chamadas em voo, stale-while-revalidate, invalidação
   por prefixo e paginação por cursor.

   O que ele deliberadamente não tem: retry automático com backoff, garbage
   collection por tempo ocioso, prefetch e persistência. Nada disso é
   necessário num painel de uma aba só, e cada um seria código não exercitado
   fingindo maturidade.

   O modelo de uso é o do React Query e é síncrono de propósito:

     const r = Query.usar(chave, buscador);
     if (r.estado === "carregando") …

   `usar` devolve o estado atual na hora e, como efeito, dispara a busca se
   faltar dado ou se ele estiver velho. Quando a busca termina, quem assinou é
   avisado e a região correspondente redesenha — e aí `usar` já encontra o dado
   pronto. Sem laço infinito: dado fresco não dispara busca nenhuma.
   ───────────────────────────────────────────────────────────────────────── */

const Query = (() => {
  "use strict";

  /** chave → { estado, dado, erro, atualizadoEm, promessa } */
  const cache = new Map();
  const ouvintes = new Set();
  const FRESCO_MS = 30000;

  /* Chave estável: as mesmas opções em ordem diferente têm que dar a mesma
     string, senão o cache erra e a mesma consulta roda duas vezes. */
  function chaveDe(nome, params) {
    if (!params) return nome;
    const ordenado = {};
    for (const k of Object.keys(params).sort()) {
      const v = params[k];
      if (v === undefined || v === null || v === "") continue;
      ordenado[k] = v;
    }
    return nome + ":" + JSON.stringify(ordenado);
  }

  function avisar() {
    for (const fn of ouvintes) fn();
  }

  function entrada(chave) {
    let e = cache.get(chave);
    if (!e) {
      e = { estado: "vazio", dado: null, erro: null, atualizadoEm: 0, promessa: null };
      cache.set(chave, e);
    }
    return e;
  }

  function buscar(chave, buscador) {
    const e = entrada(chave);
    if (e.promessa) return e.promessa;      /* já em voo: não duplica */

    e.estado = e.dado ? "revalidando" : "carregando";
    e.erro = null;

    e.promessa = Promise.resolve()
      .then(buscador)
      .then((dado) => {
        e.dado = dado;
        e.erro = null;
        e.estado = "sucesso";
        e.atualizadoEm = Date.now();
        return dado;
      })
      .catch((erro) => {
        e.erro = erro;
        /* O dado velho fica. Uma falha de rede não deve apagar da tela o que
           já estava lido — a faixa de erro aparece por cima, e o usuário
           continua vendo o último estado bom. */
        e.estado = e.dado ? "erro-com-dado" : "erro";
      })
      .then(() => {
        e.promessa = null;
        avisar();
      });

    return e.promessa;
  }

  return {
    chaveDe,

    /** Assina mudanças de qualquer query. Devolve a função de cancelar. */
    assinar(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },

    /**
     * Estado atual da consulta, buscando se precisar.
     * @param {string} chave
     * @param {() => Promise<any>} buscador
     * @param {{frescoMs?: number, ativa?: boolean}} [opcoes]
     */
    usar(chave, buscador, opcoes) {
      const o = opcoes || {};
      const e = entrada(chave);
      const ativa = o.ativa !== false;
      const velho = Date.now() - e.atualizadoEm > (o.frescoMs || FRESCO_MS);

      if (ativa && !e.promessa && (e.estado === "vazio" || (velho && e.estado === "sucesso"))) {
        buscar(chave, buscador);
      }
      return e;
    },

    /** Força nova busca ignorando frescor. É o botão "Tentar de novo". */
    recarregar(chave, buscador) {
      const e = entrada(chave);
      e.atualizadoEm = 0;
      return buscar(chave, buscador);
    },

    /**
     * Marca como velho tudo que começa com `prefixo`, e avisa. Não busca de
     * novo na hora: quem estiver na tela redesenha, chama `usar` e a busca sai
     * daí. Query que ninguém está olhando não gasta chamada.
     */
    invalidar(prefixo) {
      for (const [chave, e] of cache) {
        if (chave.startsWith(prefixo)) e.atualizadoEm = 0;
      }
      avisar();
    },

    /** Escreve direto no cache — resposta de mutação que já traz o novo estado. */
    definir(chave, dado) {
      const e = entrada(chave);
      e.dado = dado;
      e.estado = "sucesso";
      e.erro = null;
      e.atualizadoEm = Date.now();
      avisar();
    },

    /** Some com tudo. O painel de simulação usa ao reconstruir o mundo. */
    limpar() {
      cache.clear();
      avisar();
    },

    /* Só os testes de §11 olham aqui dentro. */
    _cache: cache,
  };
})();

/* ── Paginação por cursor ─────────────────────────────────────────────────────
   Fica fora do cache principal porque a unidade acumulada é diferente: não é
   "a resposta da chamada", é "todas as páginas lidas até agora". Colocar isso
   no `Query` obrigaria o cache a saber concatenar, e ele não deve saber. */
const Paginado = (() => {
  const listas = new Map();  /* chave → { itens, cursor, fim, carregando, erro, total } */

  function entrada(chave) {
    let l = listas.get(chave);
    if (!l) {
      l = { itens: [], cursor: null, fim: false, carregando: false, erro: null, total: null, iniciada: false };
      listas.set(chave, l);
    }
    return l;
  }

  return {
    usar(chave) { return entrada(chave); },

    /** Primeira página. Chamar de novo com os mesmos filtros não refaz. */
    async iniciar(chave, buscador) {
      const l = entrada(chave);
      if (l.iniciada || l.carregando) return l;
      l.iniciada = true;
      l.carregando = true;
      try {
        const p = await buscador(null);
        l.itens = p.itens;
        l.cursor = p.proximoCursor;
        l.fim = !p.proximoCursor;
        if (typeof p.total === "number") l.total = p.total;
        l.erro = null;
      } catch (e) {
        l.erro = e;
        l.iniciada = false;
      }
      l.carregando = false;
      return l;
    },

    async carregarMais(chave, buscador) {
      const l = entrada(chave);
      if (l.carregando || l.fim) return l;
      l.carregando = true;
      try {
        const p = await buscador(l.cursor);
        l.itens = l.itens.concat(p.itens);
        l.cursor = p.proximoCursor;
        l.fim = !p.proximoCursor;
        l.erro = null;
      } catch (e) {
        l.erro = e;
      }
      l.carregando = false;
      return l;
    },

    /** Filtro mudou: a lista acumulada não vale mais. */
    resetar(prefixo) {
      for (const chave of Array.from(listas.keys())) {
        if (chave.startsWith(prefixo)) listas.delete(chave);
      }
    },

    limpar() { listas.clear(); },
  };
})();

/* ── Renderização por regiões ─────────────────────────────────────────────────
   Redesenhar `#app` inteiro a cada mudança de estado seria simples e estaria
   errado: o `innerHTML` novo destrói o elemento focado, e quem estivesse
   digitando na paleta de comandos ou na busca perderia o cursor no meio da
   palavra — a cada tecla, porque cada tecla muda o estado.

   Então a tela é dividida em regiões que redesenham sozinhas, e o foco é
   restaurado por `data-foco` (um id estável que sobrevive à troca do nó, ao
   contrário da referência do elemento). Posição do cursor e rolagem vão
   junto — sem isso o texto salta pro fim a cada tecla.
   ───────────────────────────────────────────────────────────────────────── */

const Render = (() => {
  const renderizadores = new Map();   /* nome da região → () => string */
  const sujas = new Set();
  let agendado = false;

  function noDaRegiao(nome) {
    return document.querySelector('[data-regiao="' + nome + '"]');
  }

  function guardarFoco() {
    const el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.foco) return null;
    const g = { id: el.dataset.foco, rolagem: null, inicio: null, fim: null };
    if (typeof el.selectionStart === "number") {
      g.inicio = el.selectionStart;
      g.fim = el.selectionEnd;
    }
    return g;
  }

  function restaurarFoco(g) {
    if (!g) return;
    const el = document.querySelector('[data-foco="' + g.id + '"]');
    if (!el) return;
    el.focus();
    if (g.inicio !== null && typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(g.inicio, g.fim); } catch (_) { /* input sem seleção */ }
    }
  }

  function desenhar() {
    agendado = false;
    const foco = guardarFoco();
    const rolagens = new Map();

    for (const nome of sujas) {
      const no = noDaRegiao(nome);
      const fn = renderizadores.get(nome);
      if (!no || !fn) continue;
      /* Rolagem interna morre junto com o innerHTML: guardar e repor, senão o
         feed volta pro topo sozinho toda vez que chega dado novo. */
      const roladores = no.querySelectorAll("[data-rolagem]");
      for (const r of roladores) rolagens.set(r.dataset.rolagem, r.scrollTop);

      no.innerHTML = fn();

      for (const r of no.querySelectorAll("[data-rolagem]")) {
        if (rolagens.has(r.dataset.rolagem)) r.scrollTop = rolagens.get(r.dataset.rolagem);
      }
    }
    sujas.clear();
    restaurarFoco(foco);
  }

  return {
    registrar(nome, fn) { renderizadores.set(nome, fn); },

    /** Marca região(ões) pra redesenhar no próximo quadro. */
    sujar(...nomes) {
      for (const n of nomes.length ? nomes : renderizadores.keys()) sujas.add(n);
      if (!agendado) {
        agendado = true;
        requestAnimationFrame(desenhar);
      }
    },

    /** Redesenha já, sem esperar quadro. Usado logo após montar o esqueleto. */
    agora(...nomes) {
      for (const n of nomes.length ? nomes : renderizadores.keys()) sujas.add(n);
      desenhar();
    },
  };
})();

/* ── §9 · Roteador ────────────────────────────────────────────────────────────
   Hash, não History API. O painel é um arquivo que abre por `file://` e
   `pushState` não funciona nesse protocolo — a URL mudaria e o F5 devolveria
   "arquivo não encontrado". Com hash, recarregar cai exatamente na mesma tela,
   e o link é colável.

   Formato:  #/c/<comunidadeId>/<aba>?chave=valor
             #/configuracoes

   O estado que merece estar na URL é o que alguém colaria pra outra pessoa:
   comunidade, aba, filtros da tabela, e qual membro está aberto no drawer.
   O que não merece: se a paleta de comandos está aberta.
   ───────────────────────────────────────────────────────────────────────── */

const ABAS = ["atividade", "membros", "relatorios"];

const Rota = (() => {
  const ouvintes = new Set();
  let atual = analisar();

  function analisar() {
    const bruto = String(location.hash || "").replace(/^#/, "");
    const [caminho, consulta] = bruto.split("?");
    const partes = caminho.split("/").filter(Boolean);
    const params = new URLSearchParams(consulta || "");

    const query = {};
    for (const [k, v] of params) query[k] = v;

    if (partes[0] === "configuracoes") {
      return { tela: "configuracoes", comunidadeId: null, aba: null, query };
    }
    if (partes[0] === "c" && partes[1]) {
      const aba = ABAS.includes(partes[2]) ? partes[2] : "atividade";
      return { tela: "comunidade", comunidadeId: partes[1], aba, query };
    }
    return { tela: "inicio", comunidadeId: null, aba: null, query };
  }

  function montar(r) {
    let caminho;
    if (r.tela === "configuracoes") caminho = "/configuracoes";
    else if (r.tela === "comunidade") caminho = "/c/" + r.comunidadeId + "/" + (r.aba || "atividade");
    else caminho = "/";

    const params = new URLSearchParams();
    for (const k of Object.keys(r.query || {})) {
      const v = r.query[k];
      if (v !== undefined && v !== null && v !== "") params.set(k, v);
    }
    const q = params.toString();
    return "#" + caminho + (q ? "?" + q : "");
  }

  window.addEventListener("hashchange", () => {
    atual = analisar();
    for (const fn of ouvintes) fn(atual);
  });

  return {
    atual: () => atual,
    montar,

    assinar(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },

    /** Navega. `substituir` troca a entrada do histórico em vez de empilhar —
        é o certo pra mudança de filtro, que não é "lugar" pra voltar. */
    ir(parcial, substituir) {
      const proxima = Object.assign({}, atual, parcial);
      if (parcial && parcial.query !== undefined) {
        proxima.query = Object.assign({}, atual.query, parcial.query);
        for (const k of Object.keys(proxima.query)) {
          if (proxima.query[k] === null) delete proxima.query[k];
        }
      }
      const url = montar(proxima);
      if (substituir) location.replace(url);
      else location.hash = url;
    },

    /** Só mexe na query, preservando tela e aba. */
    filtrar(mudancas, substituir) {
      this.ir({ query: mudancas }, substituir !== false);
    },
  };
})();
