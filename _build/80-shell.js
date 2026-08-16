
/* ── §10a · Shell ─────────────────────────────────────────────────────────────
   O esqueleto: barra lateral, rail de plataformas, topbar, seletor de
   comunidade, estados de dados e a delegação de eventos. Tudo o que as quatro
   telas de §10b assumem que já existe.

   O visual vem inteiro do v3.1 e não foi reinventado — o que mudou é de onde
   vêm os dados. Onde o protótipo lia uma constante (`COMUNIDADES`,
   `PENDENCIAS`) e fingia carregamento com `setTimeout`, aqui passa por
   `CLIENTE` e pelo cache de §8, com skeleton e erro de verdade.

   Uma regra vale pro arquivo inteiro, e §11 verifica: **nada aqui menciona
   `MOCK`**. Nem pra assinar evento novo. O feed descobre que chegou coisa nova
   revalidando e comparando ids — que é o que ele teria de fazer com um backend
   real, onde ninguém oferece callback de mudança. O ticker do mock só faz o
   dado mudar entre uma leitura e a seguinte.
   ───────────────────────────────────────────────────────────────────────── */

/* Estado de interface. Aqui mora só o que **não** merece estar na URL: nada
   disto sobrevive a um F5 de propósito. O que merece — comunidade, aba,
   filtros, membro aberto — está em `Rota`. */
const ui = {
  menuAberto: false,
  seletor: null,          /* plataformaId com o diálogo aberto */
  buscaSeletor: "",
  popover: null,          /* "busca" | "sino" | null */
  buscaTopo: "",
  toasts: [],
  offline: false,
};

const CHAVE_COMUNIDADES = "comunidades";
const buscarComunidades = () => CLIENTE.listarComunidades();
const usarComunidades = () => Query.usar(CHAVE_COMUNIDADES, buscarComunidades);

/* ── Toasts ──────────────────────────────────────────────────────────────── */
let seqToast = 0;

/** Aviso passageiro. `acao` é opcional: { rotulo, comando }. */
function mostrarToast(t) {
  const id = "t" + ++seqToast;
  ui.toasts.push({
    id,
    titulo: t.titulo,
    texto: t.texto || "",
    tipo: t.tipo || "ok",
    acao: t.acao || null,
  });
  Render.sujar("toasts");
  /* Erro fica mais tempo: quem errou precisa de mais que 4s pra ler. */
  setTimeout(() => fecharToast(id), t.tipo === "erro" ? 8000 : 4500);
  return id;
}

function fecharToast(id) {
  const i = ui.toasts.findIndex((t) => t.id === id);
  if (i < 0) return;
  ui.toasts.splice(i, 1);
  Render.sujar("toasts");
}

function renderToasts() {
  return ui.toasts
    .map(
      (t) => `
      <div class="toast" data-tipo="${t.tipo}" role="status">
        ${svg(t.tipo === "erro" ? "alerta-circ" : "check-circ")}
        <div class="toast-corpo">
          <p class="toast-titulo">${esc(t.titulo)}</p>
          ${t.texto ? `<p class="toast-texto">${esc(t.texto)}</p>` : ""}
        </div>
        ${t.acao ? `<button class="toast-acao" data-comando="${esc(t.acao.comando)}">${esc(t.acao.rotulo)}</button>` : ""}
        <button class="toast-acao" data-fechar-toast="${t.id}" aria-label="Dispensar aviso">${svg("close")}</button>
      </div>`
    )
    .join("");
}

/* ── Átomos de estado de dados ───────────────────────────────────────────────
   Três estados, sempre os mesmos três, em toda tela. O erro nunca mostra
   código nem "Oops": `explicarErro` de §3 traduz o erro tipado em título,
   texto e a ação que faz sentido pra aquele erro. */

function estadoVazio(o) {
  return `
    <div class="estado-bloco">
      ${svg(o.icone || "caixa-vazia")}
      <strong>${esc(o.titulo)}</strong>
      <p>${esc(o.texto)}</p>
      ${o.acoes ? `<div class="acoes">${o.acoes}</div>` : ""}
    </div>`;
}

function estadoErro(erro, comando) {
  const e = explicarErro(erro);
  const rotulo = { reconectar: "Reconectar", esperar: "Tentar de novo", voltar: "Voltar", tentar: "Tentar de novo" }[e.acao];
  return `
    <div class="estado-bloco estado-erro">
      ${svg(e.acao === "reconectar" ? "escudo" : e.acao === "esperar" ? "relogio" : "alerta-circ")}
      <strong>${esc(e.titulo)}</strong>
      <p>${esc(e.texto)}</p>
      <div class="acoes">
        <button class="btn-primario" data-comando="${esc(comando || "recarregar")}">${svg("recarregar")}${rotulo}</button>
      </div>
    </div>`;
}

/** Faixa de aviso no topo do conteúdo. Não substitui o dado — avisa por cima. */
function faixa(o) {
  const classe = o.tipo === "erro" ? "faixa faixa-erro" : o.tipo === "neutra" ? "faixa faixa-neutra" : "faixa";
  return `
    <div class="${classe}" role="${o.tipo === "erro" ? "alert" : "status"}">
      ${svg(o.icone || "alerta")}
      <div class="faixa-corpo">
        <strong>${esc(o.titulo)}</strong>
        ${o.texto ? `<p>${esc(o.texto)}</p>` : ""}
      </div>
      ${o.acao ? `<button class="btn-primario" data-comando="${esc(o.acao.comando)}">${esc(o.acao.rotulo)}</button>` : ""}
    </div>`;
}

/** Skeleton com a forma do conteúdo real, não um retângulo genérico. */
function skeletonFeed(n) {
  return `
    <ul class="skel-feed" aria-busy="true" aria-live="polite">
      <li class="sr-only">Carregando atividade</li>
      ${Array.from({ length: n || 6 })
        .map(
          () => `
        <li aria-hidden="true">
          <span class="skel-bloco skel-av"></span>
          <span class="skel-col">
            <span class="skel-bloco skel-h"></span>
            <span class="skel-bloco skel-t"></span>
            <span class="skel-bloco skel-t2"></span>
          </span>
          <span class="skel-bloco skel-quando"></span>
        </li>`
        )
        .join("")}
    </ul>`;
}

/* ── Ajudantes de domínio ────────────────────────────────────────────────── */
const comunidadesDaPlataforma = (cs, p) => (cs || []).filter((c) => c.plataforma === p);

function comunidadeAtiva(cs) {
  const id = Rota.atual().comunidadeId;
  return (cs || []).find((c) => c.id === id) || null;
}

/** Uma plataforma acende o ponto se alguma comunidade dela pede atenção. */
function plataformaPendente(cs, p) {
  return comunidadesDaPlataforma(cs, p).filter((c) => SYNC_PENDENTE.has(c.estadoSync)).length;
}

const pontoSync = (estado) =>
  `<span class="ponto-sync" data-e="${estado}" aria-hidden="true"></span>`;

function linhaSync(c, agora) {
  const e = ESTADOS_SYNC[c.estadoSync];
  const quando = c.sincronizadaEm ? relativo(c.sincronizadaEm, agora) : "nunca";
  return `<span class="linha-sync">${pontoSync(c.estadoSync)}${esc(e.rotulo)}${
    c.estadoSync === "conectada" ? " · " + esc(quando) : ""
  }</span>`;
}

/* Leva a rota pra uma comunidade que existe. Sem isto, abrir o arquivo sem
   hash mostraria tela vazia, e um link antigo pra comunidade removida ficaria
   preso num "não encontrado" que o usuário não causou. */
function garantirComunidadeNaRota() {
  const e = Query.usar(CHAVE_COMUNIDADES, buscarComunidades);
  if (e.estado !== "sucesso" || !e.dado || !e.dado.length) return;
  const r = Rota.atual();
  if (r.tela === "configuracoes") return;
  if (r.tela === "comunidade" && r.comunidadeId && e.dado.some((c) => c.id === r.comunidadeId)) return;

  const preferida = e.dado.find((c) => c.estadoSync === "conectada") || e.dado[0];
  Rota.ir({ tela: "comunidade", comunidadeId: preferida.id, aba: r.aba || "atividade", query: {} }, true);
}

/* ── Região: barra lateral ───────────────────────────────────────────────── */
const ROTAS_NAV = [
  { id: "atividade", rotulo: "Painel", icone: "painel" },
  { id: "membros", rotulo: "Contas", icone: "contas" },
  { id: "relatorios", rotulo: "Relatórios", icone: "relatorios" },
];

const USUARIO = { nome: "Marina Alves", cargo: "Coordenação", iniciais: "MA" };

function renderSidebar() {
  const e = usarComunidades();
  const cs = e.dado || [];
  const r = Rota.atual();
  const ativa = comunidadeAtiva(cs);
  const plataformaAtiva = ativa ? ativa.plataforma : null;

  return `
    <button class="fechar-drawer" data-fechar-menu aria-label="Fechar menu">${svg("close")}</button>

    <a class="logo-link" href="#/" aria-label="EngageMend — ir para o painel">
      <img class="logo-img" src="${LOGO_ENGAGEMEND}" alt="" width="200" height="69">
    </a>

    <nav class="nav" aria-label="Navegação principal">
      <ul>
        ${ROTAS_NAV.map(
          (rt) => `
          <li>
            <button class="nav-item" data-aba="${rt.id}"
              ${r.tela === "comunidade" && r.aba === rt.id ? 'aria-current="page"' : ""}>
              ${svg(rt.icone)}${rt.rotulo}
            </button>
          </li>`
        ).join("")}
      </ul>
    </nav>

    <section class="plataformas" aria-labelledby="titulo-plataformas">
      <h2 id="titulo-plataformas">Plataformas</h2>
      <ul class="rail">
        ${PLATAFORMAS.map((p) => {
          const indisponivel = Boolean(INDISPONIVEIS[p.id]);
          const pend = plataformaPendente(cs, p.id);
          const quantas = comunidadesDaPlataforma(cs, p.id).length;
          /* A contagem exata vai pro aria-label; no rail aparece só o ponto. */
          const rotulo = indisponivel
            ? `${p.nome} — ${INDISPONIVEIS[p.id].curto}`
            : pend > 0
            ? `${p.nome} — ${plural(pend, "conta pedindo atenção", "contas pedindo atenção")}`
            : `${p.nome} — ${plural(quantas, "conta", "contas")}`;
          return `
            <li class="rail-cel">
              <button class="plat-btn" data-plataforma="${p.id}"
                style="--marca:${corDaMarca(p, "escura")}"
                data-indisponivel="${indisponivel}"
                aria-label="${esc(rotulo)}" aria-haspopup="dialog"
                aria-expanded="${ui.seletor === p.id}"
                ${p.id === plataformaAtiva ? 'aria-current="true"' : ""}>
                ${svg(p.id)}
                <span class="tooltip" role="tooltip">${esc(p.nome)}</span>
              </button>
              ${pend > 0 ? `<span class="pendencia" aria-hidden="true"></span>` : ""}
            </li>`;
        }).join("")}
      </ul>
    </section>

    <div class="rodape">
      <button class="nav-item" data-ir-configuracoes
        ${r.tela === "configuracoes" ? 'aria-current="page"' : ""}>
        ${svg("config")}Configurações
      </button>
      <div class="usuario">
        ${avatar(USUARIO.iniciais, USUARIO.nome, "sm")}
        <div style="min-width:0">
          <p class="usuario-nome">${esc(USUARIO.nome)}</p>
          <p class="usuario-cargo">${esc(USUARIO.cargo)}</p>
        </div>
      </div>
      <p class="marca-proto">Protótipo · dados fictícios</p>
    </div>`;
}

/* ── Região: topbar ──────────────────────────────────────────────────────── */
function renderTopbar() {
  const e = usarComunidades();
  const cs = e.dado || [];
  const c = comunidadeAtiva(cs);

  const naoLidas = (() => {
    const n = Query.usar("notificacoes", () => CLIENTE.listarNotificacoes());
    return (n.dado || []).filter((x) => !x.lida).length;
  })();

  const chip = c
    ? `<button class="chip" data-plataforma="${c.plataforma}" aria-haspopup="dialog"
         aria-expanded="${ui.seletor === c.plataforma}"
         aria-label="Comunidade ativa: ${esc(c.nome)}. Trocar de comunidade.">
         ${svg(c.plataforma, "logo-plat")}
         <span class="chip-nome">${esc(c.nome)}</span>
         ${pontoSync(c.estadoSync)}
         ${svg("chevron", "chevron")}
       </button>`
    : `<span class="chip" aria-hidden="true"><span class="chip-nome">—</span></span>`;

  return `
    <button class="hamburguer" data-abrir-menu aria-label="Abrir menu">${svg("menu")}</button>
    ${chip}
    <div class="topbar-acoes">
      <div class="campo-busca campo-busca-topo">
        ${svg("search")}
        <input type="search" data-foco="busca-topo" data-busca-topo
          value="${esc(ui.buscaTopo)}"
          placeholder="Buscar conta ou pessoa" aria-label="Buscar conta ou pessoa">
      </div>
      <button class="sino" data-popover="sino"
        aria-haspopup="dialog" aria-expanded="${ui.popover === "sino"}"
        aria-label="Notificações — ${naoLidas} não lidas">
        ${svg("bell")}
        ${naoLidas > 0 ? `<span class="sino-badge" aria-hidden="true">${naoLidas}</span>` : ""}
      </button>
    </div>`;
}

/* ── Região: conteúdo ────────────────────────────────────────────────────────
   O shell não sabe desenhar tela nenhuma. Ele resolve comunidade, trata os
   estados compartilhados (carregando / erro / sem conta conectada) e entrega o
   resto pra §10b. `telaDaAba` é declaração de função no bloco seguinte, então
   já está içada quando isto roda — e se §10b não estiver no arquivo, o shell
   diz isso em vez de quebrar. */
function renderConteudo() {
  const e = usarComunidades();

  if (e.estado === "carregando") return skeletonFeed(6);
  if (e.estado === "erro") return estadoErro(e.erro, "recarregar-comunidades");

  const cs = e.dado || [];
  if (!cs.length) {
    return estadoVazio({
      icone: "link",
      titulo: "Nenhuma conta conectada",
      texto: "Conecte uma comunidade pra a EngageMend começar a ler a atividade dela.",
      acoes: `<button class="btn-primario" data-comando="conectar">${svg("plus")}Conectar comunidade</button>`,
    });
  }

  const r = Rota.atual();
  if (r.tela === "configuracoes") {
    return typeof telaConfiguracoes === "function" ? telaConfiguracoes() : emConstrucao("Configurações");
  }

  const c = comunidadeAtiva(cs);
  if (!c) return skeletonFeed(4);   /* `garantirComunidadeNaRota` já vai corrigir */

  if (typeof telaDaAba === "function") return telaDaAba(r.aba, c);
  return emConstrucao(ROTAS_NAV.find((x) => x.id === r.aba)?.rotulo || r.aba);
}

/** Só aparece se §10b não estiver montado — é andaime, não tela. */
function emConstrucao(nome) {
  return `
    <div class="pagina-cabecalho"><div><h1>${esc(nome)}</h1>
      <p>Esta tela ainda não foi escrita neste arquivo.</p></div></div>
    ${faixa({
      tipo: "neutra",
      icone: "terminal",
      titulo: "§10b ausente",
      texto: "O shell está montado e funcionando. As telas entram em 85-telas.js.",
    })}`;
}

/* ── Seletor de comunidade ───────────────────────────────────────────────── */

/** Só a lista: redesenhada isolada a cada tecla, pra o campo não perder o foco. */
function corpoSeletor(p, cs, e) {
  if (e.estado === "carregando") {
    return `
      <div class="skeleton" aria-live="polite" aria-busy="true">
        <span class="sr-only">Carregando comunidades</span>
        <ul>${[0, 1, 2]
          .map(
            () => `
          <li>
            <span class="skel-bloco skel-avatar"></span>
            <span style="flex:1">
              <span class="skel-bloco skel-linha1"></span>
              <span class="skel-bloco skel-linha2"></span>
            </span>
          </li>`
          )
          .join("")}</ul>
      </div>`;
  }

  const indisponivel = INDISPONIVEIS[p.id];
  if (indisponivel) {
    return estadoVazio({
      icone: "olho-off",
      titulo: indisponivel.titulo,
      texto: indisponivel.texto,
    });
  }

  const todas = comunidadesDaPlataforma(cs, p.id);
  const termo = ui.buscaSeletor.trim().toLowerCase();
  const filtradas = termo ? todas.filter((c) => c.nome.toLowerCase().includes(termo)) : todas;
  const atual = comunidadeAtiva(cs);
  const agora = new Date();

  if (todas.length === 0) {
    return `
      <div class="seletor-vazio">
        <strong>Nenhuma comunidade conectada</strong>
        <p>Conecte um ${esc(p.termo)} do ${esc(p.nome)} pra ver a atividade dele aqui.</p>
        <button class="btn-secundario" data-comando="conectar">${svg("plus")}Conectar comunidade</button>
      </div>`;
  }
  if (filtradas.length === 0) {
    return `
      <div class="sem-resultado">
        <p>Nenhum resultado para “${esc(ui.buscaSeletor.trim())}”.</p>
        <button class="limpar-busca" data-limpar-busca>Limpar busca</button>
      </div>`;
  }
  return `<ul>${filtradas
    .map((c) => {
      const sel = atual && c.id === atual.id;
      return `
        <li>
          <button class="linha" data-comunidade="${c.id}" ${sel ? 'aria-current="true"' : ""}>
            ${avatar(c.iniciais, c.nome, "md")}
            <span class="linha-corpo">
              <span class="linha-nome">${esc(c.nome)}</span>
              <span class="linha-metrica">${formatarMembros(c.membros)} membros · ${linhaSync(c, agora)}</span>
            </span>
            ${sel ? `${svg("check", "check")}<span class="sr-only">Selecionada</span>` : ""}
          </button>
        </li>`;
    })
    .join("")}</ul>`;
}

function seletor() {
  const p = getPlataforma(ui.seletor);
  if (!p) return "";
  const e = usarComunidades();
  const cs = e.dado || [];
  const todas = comunidadesDaPlataforma(cs, p.id);
  const indisponivel = Boolean(INDISPONIVEIS[p.id]);

  return `
    <div class="overlay" data-fechar-seletor></div>
    <div class="seletor" role="dialog" aria-modal="true" aria-labelledby="seletor-titulo">
      <header class="seletor-cabecalho">
        <span class="seletor-logo" style="color:${corDaMarca(p, "clara")}">${svg(p.id)}</span>
        <div class="seletor-titulo">
          <h2 id="seletor-titulo">${esc(p.nome)}</h2>
          <p>${
            indisponivel
              ? esc(INDISPONIVEIS[p.id].curto)
              : todas.length + " " + (todas.length === 1 ? esc(p.termo) : esc(p.termoPlural))
          }</p>
        </div>
        <button class="icone-btn" data-fechar-seletor aria-label="Fechar seletor de comunidade">${svg("close")}</button>
      </header>

      ${
        e.estado !== "carregando" && todas.length > 0 && !indisponivel
          ? `<div class="seletor-busca">
              <div class="campo-busca">
                ${svg("search")}
                <input type="text" data-foco="busca-seletor" data-busca-seletor
                  value="${esc(ui.buscaSeletor)}"
                  placeholder="Buscar ${esc(p.termo)}" aria-label="Buscar ${esc(p.termo)} no ${esc(p.nome)}">
              </div>
            </div>`
          : ""
      }

      <div class="seletor-lista">${corpoSeletor(p, cs, e)}</div>
    </div>`;
}

/* ── Popover do sino ─────────────────────────────────────────────────────── */
function popoverSino() {
  const e = Query.usar("notificacoes", () => CLIENTE.listarNotificacoes());
  const ns = e.dado || [];
  const agora = new Date();
  const naoLidas = ns.filter((n) => !n.lida).length;

  return `
    <div class="overlay" data-fechar-popover></div>
    <div class="popover" style="right:24px" role="dialog" aria-modal="true" aria-labelledby="pop-sino-titulo">
      <header class="popover-cabecalho">
        <h2 id="pop-sino-titulo">Notificações</h2>
        ${naoLidas > 0 ? `<button class="btn-texto" data-comando="marcar-todas">Marcar todas como lidas</button>` : ""}
      </header>
      <div class="popover-lista" data-rolagem="pop-sino">
        ${
          e.estado === "carregando"
            ? skeletonFeed(3)
            : ns.length === 0
            ? estadoVazio({ icone: "bell", titulo: "Nada por aqui", texto: "Quando alguém mudar de nível, você vê aqui." })
            : ns
                .map(
                  (n) => `
          <button class="notificacao" data-notificacao="${n.id}" data-membro="${n.membroId}"
            data-comunidade-alvo="${n.comunidadeId}" data-lida="${n.lida}">
            ${n.lida ? "" : `<span class="notificacao-ponto" aria-hidden="true"></span>`}
            <span class="notificacao-corpo">
              <span class="notificacao-texto">${esc(n.texto)}</span>
              <span class="notificacao-quando">${esc(relativo(n.criadaEm, agora))}</span>
            </span>
          </button>`
                )
                .join("")
        }
      </div>
    </div>`;
}

/* ── Região: sobreposições ───────────────────────────────────────────────── */
function renderSobreposicoes() {
  let saida = "";
  if (ui.menuAberto) saida += `<div class="overlay-menu" data-fechar-menu></div>`;
  if (ui.seletor) saida += seletor();
  if (ui.popover === "sino") saida += popoverSino();
  /* §10b acrescenta drawer, paleta, modal de conexão e painel de simulação. */
  if (typeof sobreposicoesDasTelas === "function") saida += sobreposicoesDasTelas();
  return saida;
}

/* ── Foco: prisão, Esc e devolução ───────────────────────────────────────────
   Portado do v3.1. Um diálogo que não prende o foco deixa o Tab passear pela
   página atrás dele — quem navega por teclado ou leitor de tela fica perdido
   sem nunca saber por quê. */
const FOCAVEIS = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
let focoAnterior = null;

const temDialogo = () => Boolean(ui.seletor || ui.popover || (typeof dialogoDasTelasAberto === "function" && dialogoDasTelasAberto()));

function noDoDialogo() {
  /* A ordem importa quando há dois abertos: a paleta e o modal se sobrepõem ao
     drawer, e quem prende o foco tem de ser o de cima. */
  return document.querySelector(".paleta") || document.querySelector(".modal") ||
    document.querySelector(".seletor") || document.querySelector(".popover") ||
    document.querySelector(".drawer");
}

function abrirSeletor(plataformaId) {
  if (ui.seletor !== plataformaId) ui.buscaSeletor = "";
  focoAnterior = document.activeElement;
  ui.popover = null;
  ui.seletor = plataformaId;
  Render.agora("sidebar", "topbar", "sobreposicoes");
  const campo = document.querySelector("[data-busca-seletor]");
  if (campo) {
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
  } else {
    document.querySelector(".seletor .icone-btn")?.focus();
  }
}

function fecharSeletor() {
  if (!ui.seletor) return;
  const alvo = focoAnterior?.dataset?.plataforma;
  ui.seletor = null;
  ui.buscaSeletor = "";
  Render.agora("sidebar", "topbar", "sobreposicoes");
  /* Devolve o foco pra quem abriu, igual ao componente React. */
  if (alvo) document.querySelector(`[data-plataforma="${alvo}"]`)?.focus();
  focoAnterior = null;
}

function fecharPopover() {
  if (!ui.popover) return;
  ui.popover = null;
  Render.agora("topbar", "sobreposicoes");
  document.querySelector("[data-popover]")?.focus();
}

/* ── Delegação de eventos ────────────────────────────────────────────────────
   Um `click` e um `keydown` no documento, como no v3.1. Com regiões
   redesenhando o tempo todo, ouvinte preso a nó individual morre junto com o
   `innerHTML` — delegação é o que sobrevive. */

document.addEventListener("click", (e) => {
  const alvo = (s) => e.target.closest(s);

  const fechaToast = alvo("[data-fechar-toast]");
  if (fechaToast) { fecharToast(fechaToast.dataset.fecharToast); return; }

  if (alvo("[data-fechar-seletor]")) { fecharSeletor(); return; }
  if (alvo("[data-fechar-popover]")) { fecharPopover(); return; }

  if (alvo("[data-limpar-busca]")) {
    ui.buscaSeletor = "";
    Render.agora("sobreposicoes");
    document.querySelector("[data-busca-seletor]")?.focus();
    return;
  }

  const plat = alvo("[data-plataforma]");
  if (plat) { e.preventDefault(); abrirSeletor(plat.dataset.plataforma); return; }

  const linha = alvo("[data-comunidade]");
  if (linha) {
    Rota.ir({ tela: "comunidade", comunidadeId: linha.dataset.comunidade, query: {} });
    fecharSeletor();
    return;
  }

  const pop = alvo("[data-popover]");
  if (pop) {
    e.preventDefault();
    focoAnterior = document.activeElement;
    ui.popover = ui.popover === pop.dataset.popover ? null : pop.dataset.popover;
    ui.seletor = null;
    Render.agora("topbar", "sobreposicoes");
    return;
  }

  const notificacao = alvo("[data-notificacao]");
  if (notificacao) {
    const { notificacao: id, comunidadeAlvo, membro } = notificacao.dataset;
    CLIENTE.marcarNotificacaoLida(id)
      .then(() => Query.invalidar("notificacoes"))
      .catch(() => {});
    fecharPopover();
    Rota.ir({ tela: "comunidade", comunidadeId: comunidadeAlvo, aba: "membros", query: { membro } });
    return;
  }

  const aba = alvo("[data-aba]");
  if (aba) {
    e.preventDefault();
    ui.menuAberto = false;
    Rota.ir({ tela: "comunidade", aba: aba.dataset.aba, query: {} });
    return;
  }

  if (alvo("[data-ir-configuracoes]")) {
    e.preventDefault();
    ui.menuAberto = false;
    Rota.ir({ tela: "configuracoes", query: {} });
    return;
  }

  const comando = alvo("[data-comando]");
  if (comando) { e.preventDefault(); executarComando(comando.dataset.comando, comando.dataset); return; }

  if (alvo("[data-abrir-menu]")) { ui.menuAberto = true; aplicarEstadoShell(); Render.sujar("sobreposicoes"); return; }
  if (alvo("[data-fechar-menu]")) { ui.menuAberto = false; aplicarEstadoShell(); Render.sujar("sobreposicoes"); }
});

document.addEventListener("input", (e) => {
  if (e.target.matches("[data-busca-seletor]")) {
    ui.buscaSeletor = e.target.value;
    /* Só a lista, não o diálogo inteiro: o campo é o elemento focado. */
    const lista = document.querySelector(".seletor-lista");
    const p = getPlataforma(ui.seletor);
    const q = usarComunidades();
    if (lista && p) lista.innerHTML = corpoSeletor(p, q.dado || [], q);
    return;
  }
  if (e.target.matches("[data-busca-topo]")) {
    ui.buscaTopo = e.target.value;
    if (typeof aoBuscarNoTopo === "function") aoBuscarNoTopo(ui.buscaTopo);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (ui.seletor) { e.preventDefault(); fecharSeletor(); return; }
    if (ui.popover) { e.preventDefault(); fecharPopover(); return; }
    if (typeof aoEscaparNasTelas === "function" && aoEscaparNasTelas(e)) return;
    if (ui.menuAberto) { ui.menuAberto = false; aplicarEstadoShell(); Render.sujar("sobreposicoes"); }
    return;
  }

  if (e.key !== "Tab" || !temDialogo()) return;

  const dialogo = noDoDialogo();
  if (!dialogo) return;
  const focaveis = [...dialogo.querySelectorAll(FOCAVEIS)].filter((el) => el.offsetParent !== null);
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const atual = document.activeElement;

  if (e.shiftKey && (atual === primeiro || !dialogo.contains(atual))) {
    e.preventDefault(); ultimo.focus();
  } else if (!e.shiftKey && atual === ultimo) {
    e.preventDefault(); primeiro.focus();
  }
});

/* ── Comandos ────────────────────────────────────────────────────────────────
   Um nome por ação, pra que botão, paleta de comandos e atalho de teclado
   disparem exatamente o mesmo caminho — e não três implementações que
   divergem na terceira semana. §10b registra os dele em `COMANDOS`. */
const COMANDOS = {
  recarregar() {
    Query.invalidar("");
    Paginado.limpar();
    Render.sujar();
  },
  "recarregar-comunidades"() {
    Query.recarregar(CHAVE_COMUNIDADES, buscarComunidades);
  },
  "marcar-todas"() {
    CLIENTE.marcarTodasLidas()
      .then(() => Query.invalidar("notificacoes"))
      .catch((erro) => mostrarToast({ tipo: "erro", titulo: "Não conseguimos marcar", texto: explicarErro(erro).texto }));
  },
  ressincronizar(dados) {
    const id = dados.alvo || Rota.atual().comunidadeId;
    CLIENTE.ressincronizar(id)
      .then(() => {
        Query.invalidar(CHAVE_COMUNIDADES);
        mostrarToast({ titulo: "Sincronizando", texto: "A leitura recomeçou. Isso leva alguns segundos." });
      })
      .catch((erro) => mostrarToast({ tipo: "erro", titulo: "Não deu pra sincronizar", texto: explicarErro(erro).texto }));
  },
  reconectar(dados) {
    const id = dados.alvo || Rota.atual().comunidadeId;
    CLIENTE.reconectar(id)
      .then(() => {
        Query.invalidar("");
        mostrarToast({ titulo: "Conexão restabelecida", texto: "Voltamos a ler a atividade desta comunidade." });
      })
      .catch((erro) => mostrarToast({ tipo: "erro", titulo: "Não deu pra reconectar", texto: explicarErro(erro).texto }));
  },
};

function executarComando(nome, dados) {
  const fn = COMANDOS[nome];
  if (!fn) { mostrarToast({ tipo: "erro", titulo: "Comando desconhecido", texto: nome }); return; }
  fn(dados || {});
}

/* ── Montagem ────────────────────────────────────────────────────────────── */

/* Atributos do próprio nó da região não sobrevivem à troca de `innerHTML` —
   quem os aplica é isto, não o renderizador. */
function aplicarEstadoShell() {
  const lateral = document.querySelector(".sidebar");
  if (lateral) lateral.dataset.aberta = String(ui.menuAberto);
}

function montarShell() {
  document.getElementById("app").innerHTML = `
    <div class="shell">
      <aside class="sidebar" data-regiao="sidebar" data-aberta="false"></aside>
      <div class="conteudo">
        <div data-regiao="faixa-offline"></div>
        <header class="topbar" data-regiao="topbar"></header>
        <main data-rolagem="principal"><div class="pagina" data-regiao="conteudo"></div></main>
      </div>
    </div>
    <div data-regiao="sobreposicoes"></div>
    <div class="toasts" data-regiao="toasts"></div>`;

  Render.registrar("sidebar", renderSidebar);
  Render.registrar("topbar", renderTopbar);
  Render.registrar("conteudo", renderConteudo);
  Render.registrar("sobreposicoes", renderSobreposicoes);
  Render.registrar("toasts", renderToasts);
  Render.registrar("faixa-offline", () =>
    ui.offline
      ? `<div class="faixa-offline">${svg("sem-rede")}Sem conexão — mostrando o que já tínhamos lido.</div>`
      : ""
  );
}

/* Quem chama `iniciar()` é o fim de §11, e tem que ser lá mesmo: esta função
   toca `iniciarTelas` e `telaDaAba` de §10b. Declaração de função sobe, mas
   qualquer `const` de módulo que elas usem ainda estaria na zona morta se o
   arranque acontecesse aqui. No fim do script, o arquivo inteiro já avaliou. */
function iniciar() {
  montarShell();

  /* Qualquer mudança de dado ou de rota redesenha tudo. Parece grosseiro, mas
     com regiões custa pouco: cada uma é uma string e uma troca de innerHTML, e
     foco e rolagem são preservados por `Render`. */
  Query.assinar(() => { garantirComunidadeNaRota(); Render.sujar(); });
  Rota.assinar(() => { ui.menuAberto = false; aplicarEstadoShell(); Render.sujar(); });

  window.addEventListener("online", () => { ui.offline = false; Render.sujar("faixa-offline"); COMANDOS.recarregar(); });
  window.addEventListener("offline", () => { ui.offline = true; Render.sujar("faixa-offline"); });
  ui.offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (typeof iniciarTelas === "function") iniciarTelas();

  garantirComunidadeNaRota();
  Render.agora();
}
