
/* ── §10b · As telas ──────────────────────────────────────────────────────────
   Painel, Contas, Relatórios e Configurações, mais o que atravessa todas:
   drawer do membro, paleta de comandos, busca da topbar, fluxo de conexão e
   painel de simulação.

   Duas regras valem pro arquivo inteiro:

     1. Nada aqui menciona `MOCK` — exceto o painel de simulação, que existe
        justamente pra controlar o mundo falso e não é uma tela. §11 varre o
        código-fonte destas funções atrás da palavra e reprova se achar.
     2. Toda leitura passa por `CLIENTE`, e todo estado que alguém colaria pra
        outra pessoa (comunidade, aba, filtros, ordenação, membro aberto,
        período) mora na URL, não aqui.
   ───────────────────────────────────────────────────────────────────────── */

/* ── O texto do feed é derivado, nunca guardado ───────────────────────────────
   `Evento` carrega `membroId` e `payload` bruto — não carrega frase. Quem monta
   a frase é isto, e é o que faz o feed continuar funcionando quando o dado vier
   do Discord de verdade: muda o produtor do evento, não a tela.

   Todo caso tem saída de emergência. Um conector real vai mandar payload
   incompleto algum dia, e "Marina mandou uma mensagem em #undefined" é pior que
   uma frase genérica. */
function predicadoDoEvento(evento) {
  const p = (evento && evento.payload) || {};
  const canal = p.canal ? " em #" + p.canal : "";

  switch (evento && evento.tipo) {
    /* ── Produção ─────────────────────────────────────────────────────────── */
    case "message_sent":
      return "mandou uma mensagem" + canal + ".";
    case "message_substantial":
      return p.caracteres
        ? "escreveu uma mensagem longa" + canal + " (" + numero(p.caracteres) + " caracteres)."
        : "escreveu uma mensagem longa" + canal + ".";
    case "media_posted":
      return p.midia ? "publicou " + (p.midia === "imagem" ? "uma imagem" : p.midia === "vídeo" ? "um vídeo" : "um anexo") + canal + "."
                     : "publicou uma mídia" + canal + ".";
    case "thread_started":
      return p.titulo ? "abriu o tópico “" + p.titulo + "”" + canal + "." : "abriu um tópico" + canal + ".";

    /* ── Reciprocidade ────────────────────────────────────────────────────── */
    case "reply_given":
      return p.respondeuA ? "respondeu " + p.respondeuA + canal + "." : "respondeu alguém" + canal + ".";
    case "thread_replied":
      return p.titulo ? "respondeu no tópico “" + p.titulo + "”." : "respondeu num tópico" + canal + ".";
    case "newcomer_welcomed":
      return p.novato ? "deu as boas-vindas a " + p.novato + canal + "." : "deu as boas-vindas a alguém novo" + canal + ".";

    /* ── Consumo ──────────────────────────────────────────────────────────── */
    case "reaction_given":
      return p.emoji ? "reagiu com " + p.emoji + canal + "." : "reagiu a uma mensagem" + canal + ".";
    case "voice_minutes":
      return p.minutos
        ? "passou " + p.minutos + " min em " + (p.canal || "voz") + "."
        : "entrou numa sala de voz.";

    /* ── Influência: aconteceu *com* a pessoa ─────────────────────────────────
       A frase continua tendo o membro como sujeito ("recebeu…"), e não quem
       agiu. Duas razões: o feed lista a linha do tempo *daquela pessoa*, e
       inverter o sujeito quebraria o nome que o painel desenha à parte, num
       botão. E a forma é neutra de propósito — "foi respondida" flexiona
       gênero de gente cujo gênero o Discord não informa. */
    case "reaction_received":
      return "recebeu uma reação" + (p.emoji ? " " + p.emoji : "") +
        (p.de ? " de " + p.de : "") + canal + ".";
    case "reply_received":
      return "recebeu uma resposta" + (p.de ? " de " + p.de : "") + canal + ".";
    case "mention_received":
      return "recebeu uma menção" + (p.de ? " de " + p.de : "") + canal + ".";
    case "forum_solution":
      return p.titulo
        ? "teve a resposta marcada como solução em “" + p.titulo + "”."
        : "teve uma resposta marcada como solução.";
    case "invite_used":
      return p.convidado ? "trouxe " + p.convidado + " para a comunidade." : "trouxe alguém de fora para a comunidade.";

    default:
      return "teve atividade registrada.";
  }
}

/**
 * A frase inteira, com sujeito. É esta a assinatura que o briefing pede e a
 * que §11 testa.
 *
 * O feed desenha o nome à parte, num botão que abre o membro — por isso o
 * predicado é uma função separada, e não um `replace` em cima da frase pronta.
 * Cortar o sujeito de uma string já montada quebraria em todo nome que
 * aparecesse duas vezes ("Ana respondeu Ana").
 */
function descreverEvento(evento, membro) {
  const quem = (membro && membro.nome) || "Alguém";
  return quem + " " + predicadoDoEvento(evento);
}

/* ── Estado de interface das telas ────────────────────────────────────────────
   Como o `ui` do shell: aqui mora só o que **não** merece sobreviver a um F5.
   Filtro, ordenação, período e membro aberto não estão aqui — estão na URL. */
const telaUi = {
  /* Feed */
  topoConhecido: null,   /* id do evento mais novo já incorporado à lista */
  novas: 0,              /* quantos chegaram desde então, ainda não mostrados */
  destacados: new Set(), /* ids recém-revelados, pra a animação de destaque */

  /* Tabela de contas. `buscaMembros` é o rascunho do campo enquanto o debounce
     não levou o termo pra URL; `null` significa "o que vale é a URL". */
  selecao: new Set(),
  buscaMembros: null,

  /* Sobreposições */
  paleta: null,          /* { termo, indice } */
  conexao: null,         /* { passo, plataforma, nome, erro } */
  buscaAberta: false,
  buscaIndice: 0,

  /* Configurações: rascunho em edição, separado do que está salvo. */
  rascunho: null,
  previa: null,
  previaPendente: false,

  /* Painel de simulação */
  sim: { aberto: false, rodando: false, resultado: null },
};

/* ── Config da Régua ──────────────────────────────────────────────────────────
   Toda leitura pontuada (ranking, resumo, relatório, membro) precisa da mesma
   config, senão a tela mostra um número e a prévia mostra outro.

   A config entra na chave de cache por assinatura, não por valor: colar o
   objeto inteiro na chave funcionaria, mas produz chaves de centenas de bytes
   comparadas a cada leitura. A assinatura é curta e muda sempre que qualquer
   peso, faixa ou meia-vida muda — que é o único momento em que o cache
   precisa mesmo virar. */
const CHAVE_CONFIG = "config";
const buscarConfig = () => CLIENTE.obterConfiguracoes();
const usarConfig = () => Query.usar(CHAVE_CONFIG, buscarConfig);

function assinaturaConfig(cfg) {
  if (!cfg) return "0";
  const partes = [cfg.meiaVidaDias, cfg.janelaDias];
  for (const t of TIPOS_IDS) partes.push(cfg.pesos[t]);
  for (const l of cfg.limiares || []) {
    partes.push(l.nivel + ">" + l.minScore + (l.porta ? "@" + l.porta.eixo + ":" + l.porta.min : ""));
  }
  return partes.join(".");
}

/* Chave de armazenamento local. O briefing pede persistência em localStorage
   para a config e para a comunidade ativa; o resto continua na URL. */
const GUARDA_CONFIG = "engagemend:config";
const GUARDA_COMUNIDADE = "engagemend:comunidade";

function guardar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) { /* modo privativo */ }
}
function ler(chave) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : null;
  } catch (_) { return null; }
}

/* ── Ajudantes visuais ───────────────────────────────────────────────────── */

/** Barra empilhada da Régua: as cinco faixas, proporcionais, numa linha de 8px. */
function barraRegua(distribuicao, total) {
  if (!total) return "";
  const segmentos = [1, 2, 3, 4, 5]
    .map((n) => {
      const v = distribuicao[n] || 0;
      if (!v) return "";
      const largura = (v / total) * 100;
      return `<span style="width:${largura.toFixed(2)}%;background:${COR_NIVEL[n]}"
        title="${esc(NIVEIS[n].rotulo)}: ${plural(v, "pessoa", "pessoas")}"></span>`;
    })
    .join("");
  return `<div class="barra-regua" role="img"
    aria-label="Distribuição pela Régua: ${[1, 2, 3, 4, 5]
      .map((n) => NIVEIS[n].rotulo + ", " + (distribuicao[n] || 0))
      .join("; ")}">${segmentos}</div>`;
}

function legendaRegua(distribuicao) {
  return `<ul class="barra-legenda">${[1, 2, 3, 4, 5]
    .map(
      (n) => `<li><i style="background:${COR_NIVEL[n]}"></i>${esc(NIVEIS[n].nome)} · ${numero(
        distribuicao[n] || 0
      )}</li>`
    )
    .join("")}</ul>`;
}

/* Sparkline em SVG à mão — o briefing pede sem biblioteca, e para uma série de
   uma dimensão a biblioteca custaria mais que o desenho.

   `viewBox` fixo com `preserveAspectRatio="none"` deixaria a linha esticar e a
   espessura do traço deformar junto. Então o SVG desenha em coordenadas de
   viewBox e o CSS só define a altura; a largura acompanha o contêiner. */
function sparkline(serie, opcoes) {
  const o = opcoes || {};
  const chave = o.chave || "eventos";
  const pontos = serie || [];
  if (pontos.length < 2) {
    return `<p class="fita-nota">Ainda não há dias suficientes para desenhar a curva.</p>`;
  }

  const L = 640, A = 128, m = { t: 8, d: 8, b: 20, e: 8 };
  const larg = L - m.e - m.d;
  const alt = A - m.t - m.b;
  const valores = pontos.map((p) => Number(p[chave]) || 0);
  const teto = Math.max(1, ...valores);

  const x = (i) => m.e + (pontos.length === 1 ? larg / 2 : (i / (pontos.length - 1)) * larg);
  const y = (v) => m.t + alt - (v / teto) * alt;

  const linha = valores.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${linha} L${x(valores.length - 1).toFixed(1)},${(m.t + alt).toFixed(1)} L${x(0).toFixed(1)},${(m.t + alt).toFixed(1)} Z`;

  /* Um alvo invisível por ponto, largo o bastante pra pegar o mouse e o
     teclado. É o que dá tooltip sem biblioteca e sem listener por ponto. */
  const alvos = pontos
    .map((p, i) => {
      const cx = x(i), cy = y(valores[i]);
      const rotulo = fmtMesCurto.format(new Date(p.dia)) + " · " + numero(valores[i]) + (o.sufixo || "");
      return `<g>
        <rect class="spark-alvo" x="${(cx - larg / pontos.length / 2).toFixed(1)}" y="${m.t}"
          width="${(larg / pontos.length).toFixed(1)}" height="${alt}"
          tabindex="0" role="img" aria-label="${esc(rotulo)}"><title>${esc(rotulo)}</title></rect>
        <g class="spark-realce">
          <line x1="${cx.toFixed(1)}" y1="${m.t}" x2="${cx.toFixed(1)}" y2="${(m.t + alt).toFixed(1)}" class="spark-grade"/>
          <circle class="spark-ponto" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3"/>
        </g>
      </g>`;
    })
    .join("");

  const primeiro = fmtMesCurto.format(new Date(pontos[0].dia));
  const ultimo = fmtMesCurto.format(new Date(pontos[pontos.length - 1].dia));

  return `
    <svg class="spark" viewBox="0 0 ${L} ${A}" role="group" aria-label="${esc(o.titulo || "Série temporal")}">
      <line class="spark-grade" x1="${m.e}" y1="${(m.t + alt).toFixed(1)}" x2="${L - m.d}" y2="${(m.t + alt).toFixed(1)}"/>
      <path class="spark-area" d="${area}"/>
      <path class="spark-linha" d="${linha}"/>
      ${alvos}
      <text class="spark-eixo" x="${m.e}" y="${A - 4}">${esc(primeiro)}</text>
      <text class="spark-eixo" x="${L - m.d}" y="${A - 4}" text-anchor="end">${esc(ultimo)}</text>
      <text class="spark-eixo" x="${m.e}" y="${m.t + 8}">${esc(numero(teto))}</text>
    </svg>`;
}

/* ── CSV ──────────────────────────────────────────────────────────────────────
   Exporta de verdade: o dado já está no navegador, e um botão que promete
   arquivo e entrega nada seria a única mentira desta interface.

   `;` como separador e BOM na frente porque o destino real é o Excel em
   português, que abre CSV com vírgula tudo numa coluna só. */
function paraCSV(cabecalhos, linhas) {
  const celula = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cabecalhos.map(celula).join(";")]
    .concat(linhas.map((l) => l.map(celula).join(";")))
    .join("\r\n");
}

function baixarCSV(nome, texto) {
  try {
    const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    mostrarToast({ titulo: "Arquivo gerado", texto: nome });
  } catch (erro) {
    mostrarToast({
      tipo: "erro",
      titulo: "Não conseguimos gerar o arquivo",
      texto: "O navegador bloqueou a gravação. Tente de novo ou use outro navegador.",
    });
  }
}

/* ── Estados compartilhados pelas telas ──────────────────────────────────────
   Uma comunidade em estado ruim não é caso de erro genérico: o §2.5 do briefing
   pede faixa própria, com a ação que resolve aquele estado específico. */
function faixaDoEstado(c) {
  if (c.estadoSync === "token_expirado") {
    const p = getPlataforma(c.plataforma);
    return faixa({
      tipo: "erro",
      icone: "escudo",
      titulo: "A conexão com o " + p.nome + " expirou.",
      texto: "Enquanto isso, a EngageMend não recebe atividade nova desta comunidade. Os números abaixo são os últimos que conseguimos ler.",
      acao: { rotulo: "Reconectar", comando: "reconectar" },
    });
  }
  if (c.estadoSync === "erro") {
    return faixa({
      tipo: "erro",
      titulo: "A última sincronização falhou.",
      texto: "Tentamos ler a atividade desta comunidade e a plataforma recusou. Nada foi perdido — é seguro tentar de novo.",
      acao: { rotulo: "Sincronizar agora", comando: "ressincronizar" },
    });
  }
  if (c.estadoSync === "desatualizada") {
    return faixa({
      titulo: "Esta leitura está atrasada.",
      texto: "A última sincronização foi " + relativo(c.sincronizadaEm, new Date()) +
        ". O que está na tela continua válido, mas pode não incluir o que aconteceu depois disso.",
      acao: { rotulo: "Sincronizar agora", comando: "ressincronizar" },
    });
  }
  if (c.estadoSync === "sincronizando") {
    return faixa({
      tipo: "neutra",
      icone: "recarregar",
      titulo: "Lendo a atividade desta comunidade…",
      texto: "Os números vão se completando conforme a leitura avança.",
    });
  }
  if (c.estadoSync === "indisponivel") {
    const motivo = INDISPONIVEIS[c.plataforma];
    return faixa({
      tipo: "neutra",
      icone: "olho-off",
      titulo: motivo ? motivo.titulo : "Plataforma indisponível",
      texto: motivo ? motivo.texto : "Esta plataforma ainda não está disponível na EngageMend.",
    });
  }
  return "";
}

/** Cabeçalho de página. Um `<h1>` por tela, dentro do conteúdo — §0. */
function cabecalho(titulo, subtitulo, acoes) {
  return `
    <div class="pagina-cabecalho">
      <div>
        <h1>${esc(titulo)}</h1>
        ${subtitulo ? `<p>${esc(subtitulo)}</p>` : ""}
      </div>
      ${acoes ? `<div class="pagina-acoes">${acoes}</div>` : ""}
    </div>`;
}

/* O dado exibido é o último bom, mas está velho? Diz isso — sem apagar nada. */
function marcaDesatualizado(entrada) {
  if (!entrada || entrada.estado !== "erro-com-dado") return "";
  return `<span class="desatualizado">${svg("alerta")}Não conseguimos atualizar agora — mostrando a última leitura.</span>`;
}

/* ── Despacho ───────────────────────────────────────────────────────────────
   O shell resolveu comunidade e estados globais; daqui pra baixo é tela. */
function telaDaAba(aba, comunidade) {
  if (aba === "membros") return telaMembros(comunidade);
  if (aba === "relatorios") return telaRelatorios(comunidade);
  return telaAtividade(comunidade);
}

/* ═══ §2.1 · Painel ═══════════════════════════════════════════════════════════
   Fitas de resumo, filtros na URL, feed com rolagem infinita e a pílula de
   novidades que não empurra a leitura de quem está lendo. */

/* Catorze chips não cabem numa fileira legível. Os do eixo de influência
   ganham fileira própria, porque são conceitualmente outra coisa: não é o que
   a pessoa fez, é o que fizeram com ela. */
const TIPOS_FILTRO = TIPOS_EVENTO.filter((t) => !t.recebido);
const TIPOS_FILTRO_RECEBIDOS = TIPOS_EVENTO.filter((t) => t.recebido);

/** Filtros da URL, normalizados. Lixo na query vira filtro vazio, não erro. */
function filtrosDoFeed() {
  const q = Rota.atual().query;
  const tipos = String(q.tipo || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => TIPOS_IDS.includes(s));
  const nivel = [1, 2, 3, 4, 5].includes(Number(q.nivel)) ? Number(q.nivel) : null;
  return { tipos, nivel };
}

function chaveDoFeed(comunidadeId, filtros, assinatura) {
  /* A assinatura da config só entra quando há filtro por nível: sem ele, mexer
     num peso não muda um único evento do feed, e recarregar tudo à toa faria a
     lista acumulada voltar ao começo debaixo do dedo de quem está lendo. */
  return "feed:" + comunidadeId + ":" + filtros.tipos.slice().sort().join(",") +
    ":" + (filtros.nivel || "") + ":" + (filtros.nivel ? assinatura : "");
}

/* ── O dicionário de membros do feed ─────────────────────────────────────────
   `listarEventos` devolve, junto com a página, quem aparece nela — o evento só
   carrega `membroId`. `Paginado` acumula os itens e nada mais, e é assim que
   deve ser: ele não pode saber que existe um campo `membros` a fundir.

   Então quem funde é o buscador, aqui, uma vez por página lida. Guardado por
   chave de lista, some junto com ela quando o filtro muda. */
const membrosDoFeed = new Map();

function buscadorDoFeed(chave, params) {
  return async (cursor) => {
    const pagina = await CLIENTE.listarEventos(Object.assign({ cursor, limite: 25 }, params));
    const dicionario = membrosDoFeed.get(chave) || {};
    Object.assign(dicionario, pagina.membros || {});
    membrosDoFeed.set(chave, dicionario);
    return pagina;
  };
}

function fitasDoResumo(comunidade, cfg, assinatura) {
  const chave = Query.chaveDe("resumo", { c: comunidade.id, cfg: assinatura });
  const e = Query.usar(chave, () =>
    CLIENTE.resumoDaComunidade({ comunidadeId: comunidade.id, config: cfg })
  );

  if (e.estado === "carregando") {
    return `<div class="fitas">${[0, 1, 2, 3]
      .map(() => `<span class="skel-bloco skel-fita" aria-hidden="true"></span>`)
      .join("")}</div>`;
  }
  if (!e.dado) return "";

  const d = e.dado;
  const total = [1, 2, 3, 4, 5].reduce((a, n) => a + (d.distribuicao[n] || 0), 0);
  const variacao = d.variacaoEventos;

  return `
    <div class="fitas">
      <div class="fita">
        <p class="fita-rotulo">Ativos em 7 dias</p>
        <p class="fita-valor">${numero(d.ativos7d)}</p>
        <p class="fita-nota">de ${numero(d.membrosLidos)} pessoas lidas · ${pct(d.ativos7d, d.membrosLidos)}%</p>
      </div>
      <div class="fita">
        <p class="fita-rotulo">Eventos hoje</p>
        <p class="fita-valor">${numero(d.eventosHoje)}</p>
        <p class="fita-nota"${variacao === null ? "" : ` data-sinal="${variacao >= 0 ? "alta" : "baixa"}"`}>${
          variacao === null
            ? "sem período anterior para comparar"
            : (variacao >= 0 ? "+" : "") + variacao + "% em 30 dias, contra os 30 anteriores"
        }</p>
      </div>
      <div class="fita">
        <p class="fita-rotulo">Subiram de nível</p>
        <p class="fita-valor">${numero(d.subiramNivel)}</p>
        <p class="fita-nota"${d.desceramNivel > 0 ? ' data-sinal="baixa"' : ""}>${
          d.desceramNivel > 0 ? plural(d.desceramNivel, "pessoa desceu", "pessoas desceram") : "ninguém desceu"
        } · últimos 30 dias</p>
      </div>
      <div class="fita">
        <p class="fita-rotulo">Régua de Engajamento</p>
        ${barraRegua(d.distribuicao, total)}
        ${legendaRegua(d.distribuicao)}
      </div>
    </div>`;
}

function chipsDeFiltro(filtros) {
  const chipTipo = (t) => {
    const ativo = filtros.tipos.includes(t.id);
    return `<button class="chip-filtro" data-filtro-tipo="${t.id}" aria-pressed="${ativo}">
      ${svg(t.icone)}${esc(t.curto)}
    </button>`;
  };
  const chipNivel = (n) => {
    const ativo = filtros.nivel === n;
    return `<button class="chip-filtro" data-filtro-nivel="${n}" aria-pressed="${ativo}">
      ${esc(NIVEIS[n].rotulo)}
    </button>`;
  };
  const algum = filtros.tipos.length > 0 || filtros.nivel !== null;

  return `
    <div class="filtros">
      <span class="filtros-rotulo">Fez</span>
      ${TIPOS_FILTRO.map(chipTipo).join("")}
    </div>
    <div class="filtros">
      <span class="filtros-rotulo">Recebeu</span>
      ${TIPOS_FILTRO_RECEBIDOS.map(chipTipo).join("")}
    </div>
    <div class="filtros">
      <span class="filtros-rotulo">Nível</span>
      ${[1, 2, 3, 4, 5].map(chipNivel).join("")}
      ${algum ? `<button class="chip-filtro chip-filtro-limpar" data-comando="limpar-filtros">${svg("close")}Limpar filtros</button>` : ""}
    </div>`;
}

/* A forma da linha vem do v3.1 e não foi reinventada: avatar, corpo com topo e
   texto, e o "quando" à direita. O que muda é que o nome virou botão — clicar
   na pessoa abre a pessoa. */
function linhaDeEvento(ev, membros, agora, novo) {
  const membro = membros[ev.membroId];
  const t = getTipo(ev.tipo);
  const nome = (membro && membro.nome) || "Membro";
  return `
    <li class="atividade${novo ? " atividade-nova" : ""}">
      ${avatar((membro && membro.iniciais) || "?", nome, "lg")}
      <div class="atividade-corpo">
        <div class="atividade-topo">
          <button class="atividade-nome" data-abrir-membro="${esc(ev.membroId)}"
            aria-label="Abrir detalhe de ${esc(nome)}">${esc(nome)}</button>
          <span class="atividade-tipo">${svg(t ? t.icone : "balao")}${esc(t ? t.rotulo : ev.tipo)}</span>
        </div>
        <p class="atividade-texto">${esc(predicadoDoEvento(ev))}</p>
      </div>
      <span class="atividade-quando">${esc(relativo(ev.ocorridoEm, agora))}</span>
    </li>`;
}

function telaAtividade(c) {
  const cfgE = usarConfig();
  const cfg = cfgE.dado;
  const assinatura = assinaturaConfig(cfg);
  const filtros = filtrosDoFeed();
  const agora = new Date();

  const acoes = `
    <button class="btn-secundario" data-comando="conectar">${svg("plus")}Conectar comunidade</button>`;

  const topo =
    cabecalho(
      "Painel",
      formatarMembros(c.membros) + " membros · " + ESTADOS_SYNC[c.estadoSync].rotulo +
        (c.sincronizadaEm ? " " + relativo(c.sincronizadaEm, agora) : ""),
      acoes
    ) + faixaDoEstado(c);

  /* Comunidade que não entrega dado não tem feed pra mostrar: a faixa acima já
     explicou o porquê, e um skeleton eterno embaixo dela seria mentira. */
  if (c.estadoSync === "token_expirado" || c.estadoSync === "indisponivel") {
    return topo;
  }
  if (!cfg) {
    if (cfgE.estado === "erro") return topo + estadoErro(cfgE.erro, "recarregar-config");
    return topo + skeletonFeed(6);
  }

  const chave = chaveDoFeed(c.id, filtros, assinatura);
  const lista = Paginado.usar(chave);
  const buscador = buscadorDoFeed(chave, {
    comunidadeId: c.id,
    tipos: filtros.tipos,
    nivel: filtros.nivel,
    config: cfg,
  });

  if (!lista.iniciada && !lista.carregando && !lista.erro) {
    Paginado.iniciar(chave, buscador).then((l) => {
      /* O topo conhecido é a âncora do contador de novidades: tudo que chegar
         acima deste id, daqui pra frente, é novo pra quem está lendo. */
      if (l.itens.length && telaUi.topoConhecido === null) telaUi.topoConhecido = l.itens[0].id;
      Render.sujar("conteudo");
    });
  }

  const corpo = (() => {
    if (lista.erro && !lista.itens.length) return estadoErro(lista.erro, "recarregar-feed");
    if (!lista.iniciada && !lista.itens.length) return skeletonFeed(6);

    if (!lista.itens.length) {
      const filtrando = filtros.tipos.length > 0 || filtros.nivel !== null;
      return filtrando
        ? estadoVazio({
            icone: "filtro",
            titulo: "Nenhuma atividade com esses filtros",
            texto: "Nada nesta comunidade se encaixa na combinação escolhida. O histórico continua lá — é o recorte que está vazio.",
            acoes: `<button class="btn-secundario" data-comando="limpar-filtros">${svg("close")}Limpar filtros</button>`,
          })
        : estadoVazio({
            icone: "caixa-vazia",
            titulo: "Nenhuma atividade lida ainda",
            texto: "Assim que a EngageMend terminar de ler esta comunidade, cada mensagem, reação e convite aparece aqui.",
            acoes: `<button class="btn-primario" data-comando="ressincronizar">${svg("recarregar")}Sincronizar agora</button>`,
          });
    }

    const dicionario = membrosDoFeed.get(chave) || {};

    return `
      <div class="feed-lista">
        ${telaUi.novas > 0
          ? `<button class="pilula-novas" data-comando="mostrar-novas">
              ${svg("seta-cima")}${plural(telaUi.novas, "nova atividade", "novas atividades")}
            </button>`
          : ""}
        <ul class="atividades">
          ${lista.itens
            .map((ev) => linhaDeEvento(ev, dicionario, agora, telaUi.destacados.has(ev.id)))
            .join("")}
        </ul>
        ${lista.fim
          ? `<p class="fita-nota" style="text-align:center;padding:24px 0">Você chegou ao fim do histórico lido.</p>`
          : lista.carregando
          ? skeletonFeed(3)
          : `<div class="sentinela" data-sentinela aria-hidden="true"></div>`}
        ${lista.erro && lista.itens.length
          ? faixa({
              tipo: "erro",
              titulo: "Não conseguimos carregar mais",
              texto: explicarErro(lista.erro).texto,
              acao: { rotulo: "Tentar de novo", comando: "carregar-mais" },
            })
          : ""}
      </div>`;
  })();

  return topo + fitasDoResumo(c, cfg, assinatura) + chipsDeFiltro(filtros) + corpo;
}

/* ═══ §2.2 · Contas ═══════════════════════════════════════════════════════════
   A tabela. Esta é a tela que o briefing chama de "o motivo de alguém pagar
   pela EngageMend", e a que mais depende de a Régua ser calculada e não
   guardada: mexer num peso reordena tudo aqui.

   Ordenação, filtros, busca e o membro aberto vivem na URL. O que fica em
   memória é só a seleção — que não é lugar pra voltar nem link pra mandar. */

const COLUNAS = [
  { id: "nome",      rotulo: "Membro",    ordenavel: true,  classe: "" },
  { id: "nivel",     rotulo: "Nível",     ordenavel: false, classe: "" },
  { id: "pontuacao", rotulo: "Pontuação", ordenavel: true,  classe: "col-num" },
  { id: "tendencia", rotulo: "Tendência", ordenavel: false, classe: "col-esconde-sm" },
  { id: "atividade", rotulo: "Atividade", ordenavel: true,  classe: "col-esconde-md" },
  { id: "eventos",   rotulo: "Eventos",   ordenavel: true,  classe: "col-num col-esconde-md" },
];

const FAIXAS_ATIVIDADE = [
  { id: "7",       rotulo: "7 dias" },
  { id: "30",      rotulo: "30 dias" },
  { id: "90",      rotulo: "90 dias" },
  { id: "inativo", rotulo: "Inativos" },
];

const ORDENS_VALIDAS = ["promocao", "pontuacao", "nome", "atividade", "eventos"];

function filtrosDaTabela() {
  const q = Rota.atual().query;
  return {
    /* O padrão é "quem se mexeu", não ordem alfabética nem o topo do ranking:
       a tela abre no que exige ação. */
    ordem: ORDENS_VALIDAS.includes(q.ordem) ? q.ordem : "promocao",
    direcao: q.dir === "asc" ? "asc" : "desc",
    nivel: [1, 2, 3, 4, 5].includes(Number(q.nivel)) ? Number(q.nivel) : null,
    atividade: FAIXAS_ATIVIDADE.some((f) => f.id === q.atividade) ? q.atividade : null,
    busca: typeof q.q === "string" ? q.q : "",
  };
}

/** O que o campo de busca mostra: o rascunho se existe, senão o que está na URL. */
function textoDaBusca(filtros) {
  return telaUi.buscaMembros === null || telaUi.buscaMembros === undefined
    ? filtros.busca
    : telaUi.buscaMembros;
}

function chaveDaTabela(comunidadeId, f, assinatura) {
  return "ranking:" + comunidadeId + ":" + f.ordem + ":" + f.direcao + ":" +
    (f.nivel || "") + ":" + (f.atividade || "") + ":" + f.busca.trim().toLowerCase() +
    ":" + assinatura;
}

function cabecalhoDaTabela(f) {
  const celula = (col) => {
    if (!col.ordenavel) {
      return `<span class="${col.classe}">${esc(col.rotulo)}</span>`;
    }
    const ativa = f.ordem === col.id;
    const proxima = ativa && f.direcao === "desc" ? "asc" : "desc";
    return `<button class="${col.classe}" data-ordenar="${col.id}" data-dir="${proxima}"
      ${ativa ? `aria-sort="${f.direcao === "asc" ? "ascending" : "descending"}"` : ""}
      aria-label="Ordenar por ${esc(col.rotulo)}${ativa ? ", agora " + (f.direcao === "asc" ? "crescente" : "decrescente") : ""}">
      ${esc(col.rotulo)}${svg(f.direcao === "asc" ? "seta-cima" : "seta-baixo", "dir")}
    </button>`;
  };
  return `
    <div class="tab-cab">
      <span aria-hidden="true"></span>
      ${COLUNAS.map(celula).join("")}
    </div>`;
}

/* A linha é um `div[role=row]`, não um `<button>`, porque a caixa de seleção
   mora dentro dela: botão dentro de botão é HTML inválido, e a caixa com
   `tabindex="-1"` deixaria quem usa teclado sem como selecionar.

   O clique na linha inteira continua abrindo a gaveta (é o que o §2.2 pede);
   quem navega por teclado chega pelo botão do nome, que faz o mesmo. */
function linhaDaTabela(l, agora, selecionada, estilo) {
  const m = l.membro;
  const icone = l.tendencia === "subiu" ? "trend-up" : l.tendencia === "desceu" ? "trend-down" : "estavel";
  const rotuloTendencia =
    l.tendencia === "subiu" ? "subindo" : l.tendencia === "desceu" ? "caindo" : "estável";

  return `
    <div class="tab-linha" role="row" aria-selected="${selecionada}"
      data-abrir-membro="${esc(m.id)}" style="cursor:pointer${estilo ? ";" + estilo : ""}">
      <button class="caixa" data-selecionar="${esc(m.id)}" role="checkbox"
        aria-checked="${selecionada}"
        aria-label="Selecionar ${esc(m.nome)}">${selecionada ? svg("check") : ""}</button>
      <button class="tab-membro" data-abrir-membro="${esc(m.id)}"
        aria-label="Abrir detalhe de ${esc(m.nome)}">
        ${avatar(m.iniciais, m.nome, "sm")}
        <span style="min-width:0">
          <span class="tab-membro-nome">${esc(m.nome)}</span>
          <span class="tab-membro-arroba">${esc(m.arroba)}</span>
        </span>
      </button>
      <span>${crachaNivel(l.nivel)}</span>
      <span class="tab-num">${numero(l.pontuacao)}</span>
      <span class="tendencia col-esconde-sm" data-t="${l.tendencia}"
        aria-label="Tendência: ${rotuloTendencia}">
        ${svg(icone)}${l.tendencia === "estavel" ? "—" : (l.deltaPontuacao > 0 ? "+" : "") + numero(l.deltaPontuacao)}
      </span>
      <span class="tab-fraco col-esconde-md">${esc(relativo(l.ultimaAtividade, agora))}</span>
      <span class="tab-num col-esconde-md">${numero(l.totalEventos)}</span>
    </div>`;
}

/* ── Virtualização ────────────────────────────────────────────────────────────
   O briefing manda virtualizar acima de 200 linhas renderizadas. Abaixo disso o
   navegador dá conta e a complexidade não se paga.

   A posição de rolagem é lida do DOM em vez de guardada no estado: `Render`
   preserva `scrollTop` dos nós com `data-rolagem`, então o valor no DOM é
   sempre o verdadeiro — e um espelho em memória seria mais uma coisa pra
   dessincronizar. */
const LIMITE_VIRTUAL = 200;
const ALTURA_LINHA = 56;

function corpoDaTabela(itens, agora) {
  if (itens.length <= LIMITE_VIRTUAL) {
    return itens
      .map((l) => linhaDaTabela(l, agora, telaUi.selecao.has(l.membro.id)))
      .join("");
  }

  const no = document.querySelector('[data-rolagem="tabela"]');
  const topo = no ? no.scrollTop : 0;
  const altura = no ? no.clientHeight : 480;
  const folga = 5;   /* linhas extras acima e abaixo, pra a rolagem não piscar */

  const inicio = Math.max(0, Math.floor(topo / ALTURA_LINHA) - folga);
  const fim = Math.min(itens.length, Math.ceil((topo + altura) / ALTURA_LINHA) + folga);

  const visiveis = itens
    .slice(inicio, fim)
    .map((l, i) =>
      linhaDaTabela(l, agora, telaUi.selecao.has(l.membro.id), "top:" + (inicio + i) * ALTURA_LINHA + "px")
    )
    .join("");

  return `<div class="tab-virtual" style="height:${itens.length * ALTURA_LINHA}px">${visiveis}</div>`;
}

function telaMembros(c) {
  const cfgE = usarConfig();
  const cfg = cfgE.dado;
  const assinatura = assinaturaConfig(cfg);
  const f = filtrosDaTabela();
  const agora = new Date();

  const topo =
    cabecalho(
      "Contas",
      "Cada pessoa da comunidade, com a posição dela na Régua de Engajamento.",
      `<button class="btn-secundario" data-comando="exportar-tabela">${svg("download")}Exportar CSV</button>`
    ) + faixaDoEstado(c);

  if (c.estadoSync === "token_expirado" || c.estadoSync === "indisponivel") return topo;
  if (!cfg) {
    if (cfgE.estado === "erro") return topo + estadoErro(cfgE.erro, "recarregar-config");
    return topo + skeletonFeed(6);
  }

  const chave = chaveDaTabela(c.id, f, assinatura);
  const lista = Paginado.usar(chave);
  const buscador = (cursor) =>
    CLIENTE.listarRanking({
      comunidadeId: c.id,
      config: cfg,
      ordem: f.ordem,
      direcao: f.direcao,
      nivel: f.nivel,
      atividade: f.atividade,
      busca: f.busca,
      cursor,
      limite: 50,
    });

  if (!lista.iniciada && !lista.carregando && !lista.erro) {
    Paginado.iniciar(chave, buscador).then(() => Render.sujar("conteudo"));
  }

  const filtrando = Boolean(f.nivel || f.atividade || f.busca.trim());

  const controles = `
    <div class="filtros">
      <span class="filtros-rotulo">Nível</span>
      ${[1, 2, 3, 4, 5]
        .map(
          (n) => `<button class="chip-filtro" data-filtro-nivel="${n}"
            aria-pressed="${f.nivel === n}">${esc(NIVEIS[n].rotulo)}</button>`
        )
        .join("")}
      <span class="filtros-rotulo" style="margin-left:16px">Ativos em</span>
      ${FAIXAS_ATIVIDADE.map(
        (fa) => `<button class="chip-filtro" data-filtro-atividade="${fa.id}"
          aria-pressed="${f.atividade === fa.id}">${esc(fa.rotulo)}</button>`
      ).join("")}
      ${filtrando ? `<button class="chip-filtro chip-filtro-limpar" data-comando="limpar-filtros">${svg("close")}Limpar</button>` : ""}
    </div>`;

  const corpo = (() => {
    if (lista.erro && !lista.itens.length) return estadoErro(lista.erro, "recarregar-tabela");
    if (!lista.iniciada && !lista.itens.length) {
      return `<div class="pilha-8">${[0, 1, 2, 3, 4, 5]
        .map(() => `<span class="skel-bloco skel-linha-tab" aria-hidden="true"></span>`)
        .join("")}</div>`;
    }
    if (!lista.itens.length) {
      return filtrando
        ? estadoVazio({
            icone: "filtro",
            titulo: "Nenhum resultado para esse recorte",
            texto: f.busca.trim()
              ? "Ninguém com “" + f.busca.trim() + "” no nome ou no @ se encaixa nos filtros ativos."
              : "Ninguém desta comunidade se encaixa na combinação de filtros escolhida.",
            acoes: `<button class="btn-secundario" data-comando="limpar-filtros">${svg("close")}Limpar filtros</button>`,
          })
        : estadoVazio({
            icone: "pessoas",
            titulo: "Nenhuma pessoa lida ainda",
            texto: "Assim que a leitura desta comunidade terminar, cada membro aparece aqui com a pontuação dele.",
          });
    }

    return `
      ${cabecalhoDaTabela(f)}
      <div class="tab-corpo" data-rolagem="tabela" data-tabela role="rowgroup">
        ${corpoDaTabela(lista.itens, agora)}
      </div>
      <div class="tabela-topo" style="border-top:1px solid var(--line);border-bottom:0">
        ${
          lista.fim
            ? `<span class="tab-fraco">Todos os ${numero(lista.total || lista.itens.length)} carregados.</span>`
            : `<button class="btn-secundario" data-comando="carregar-mais-tabela" ${lista.carregando ? "disabled" : ""}>
                 ${lista.carregando ? "Carregando…" : "Carregar mais"}
               </button>`
        }
        <span class="tabela-contagem">${numero(lista.itens.length)} de ${numero(lista.total || lista.itens.length)}</span>
      </div>`;
  })();

  const selecionados = telaUi.selecao.size;

  return (
    topo +
    controles +
    `<div class="tabela-quadro">
      <div class="tabela-topo">
        <div class="campo-busca">
          ${svg("search")}
          <input type="search" data-foco="busca-membros" data-busca-membros
            value="${esc(textoDaBusca(f))}"
            placeholder="Buscar por nome ou @" aria-label="Buscar pessoa nesta comunidade">
        </div>
        <span class="tabela-contagem">${
          lista.total !== null && lista.total !== undefined
            ? plural(lista.total, "pessoa", "pessoas")
            : ""
        }</span>
      </div>
      ${corpo}
      ${
        selecionados > 0
          ? `<div class="barra-selecao" role="status">
              <p>${plural(selecionados, "selecionada", "selecionadas")}</p>
              <button class="btn-secundario" data-comando="exportar-selecao">${svg("download")}Exportar CSV</button>
              <button class="btn-secundario" data-comando="limpar-selecao">${svg("close")}Limpar</button>
            </div>`
          : ""
      }
    </div>`
  );
}

/* ═══ Drawer do membro ════════════════════════════════════════════════════════
   Abre por `?membro=<id>`, então é link colável e o botão voltar fecha — que é
   o comportamento que alguém espera de uma gaveta aberta por clique numa
   linha. */

/**
 * Onde a pessoa cruzou faixa dentro da série.
 *
 * O nível de cada dia vem pronto do contrato, e não é recalculado aqui: com
 * porta de eixo, o nível depende do p90 da comunidade naquele dia, e a tela não
 * tem — nem deve ter — como saber isso. Quando a API entrar, isto passa a ler
 * `level_transitions`, que é o registro de verdade.
 */
function progressaoDaSerie(serie) {
  const marcos = [];
  let anterior = null;
  for (const ponto of serie || []) {
    const n = ponto.nivel;
    if (anterior !== null && n !== anterior) marcos.push({ dia: ponto.dia, de: anterior, para: n });
    anterior = n;
  }
  return marcos.reverse();
}

function drawerMembro() {
  const membroId = Rota.atual().query.membro;
  if (!membroId) return "";

  const comunidadeId = Rota.atual().comunidadeId;
  const cfgE = usarConfig();
  const cfg = cfgE.dado;

  const fechar = `<button class="icone-btn" data-fechar-membro aria-label="Fechar detalhe">${svg("close")}</button>`;
  const moldura = (corpo, titulo) => `
    <div class="overlay" data-fechar-membro></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-titulo">
      ${titulo || `<header class="drawer-cabecalho"><div class="drawer-titulo"><h2 id="drawer-titulo">Membro</h2></div>${fechar}</header>`}
      <div class="drawer-corpo" data-rolagem="drawer">${corpo}</div>
    </aside>`;

  if (!cfg) return moldura(skeletonFeed(4));

  const chave = Query.chaveDe("membro", { c: comunidadeId, m: membroId, cfg: assinaturaConfig(cfg) });
  const e = Query.usar(chave, () =>
    CLIENTE.obterMembro({ comunidadeId, membroId, config: cfg })
  );

  if (e.estado === "carregando") return moldura(skeletonFeed(4));
  if (!e.dado) return moldura(estadoErro(e.erro, "recarregar-membro"));

  const d = e.dado;
  const m = d.membro;
  const p = getPlataforma(m.plataforma);
  const agora = new Date();
  const prog = progressoDeNivel(d.pontuacao, d.eixos, cfg.limiares);
  const marcos = progressaoDaSerie(d.serie);
  const maiorContribuicao = Math.max(1, ...d.composicao.map((x) => x.contribuicao));

  const cabecalhoDrawer = `
    <header class="drawer-cabecalho">
      ${avatar(m.iniciais, m.nome, "lg")}
      <div class="drawer-titulo">
        <h2 id="drawer-titulo">${esc(m.nome)}</h2>
        <div class="drawer-sub">
          ${svg(m.plataforma)}${esc(p ? p.nome : m.plataforma)} · ${esc(m.arroba)}
        </div>
        <div class="drawer-sub">${crachaNivel(d.nivel)}</div>
      </div>
      ${fechar}
    </header>`;

  /* Histórico do membro: paginado por cursor, igual ao feed — a pessoa pode ter
     milhares de eventos e mandar todos de uma vez travaria a gaveta. */
  const chaveHist = "hist:" + membroId;
  const hist = Paginado.usar(chaveHist);
  if (!hist.iniciada && !hist.carregando && !hist.erro) {
    Paginado.iniciar(chaveHist, (cursor) =>
      CLIENTE.listarEventos({ comunidadeId, membroId, cursor, limite: 15 })
    ).then(() => Render.sujar("sobreposicoes"));
  }

  const corpo = `
    <section class="drawer-secao">
      <h3>Agora</h3>
      <dl class="drawer-metricas">
        <div><dt>Pontuação</dt><dd>${numero(d.pontuacao)}</dd></div>
        <div><dt>Eventos</dt><dd>${numero(d.totalEventos)}</dd></div>
        <div><dt>Última atividade</dt><dd style="font-size:14px">${esc(relativo(d.ultimaAtividade, agora))}</dd></div>
      </dl>
      <p class="fita-nota" style="margin-top:12px">
        ${
          !prog.proximo
            ? "Está no topo da Régua."
            : prog.faltaPontos > 0
            ? "Faltam " + numero(prog.faltaPontos) + " pontos para o " + esc(NIVEIS[prog.proximo].rotulo) + "."
            : "Já tem pontuação de " + esc(NIVEIS[prog.proximo].rotulo) + "."
        }
        ${
          d.tendencia === "estavel"
            ? " A pontuação está estável nos últimos 30 dias."
            : " " + (d.tendencia === "subiu" ? "Subiu" : "Caiu") + " " + numero(Math.abs(d.deltaPontuacao)) + " pontos em 30 dias."
        }
      </p>
      ${
        /* A informação que só existe depois da porta de eixo: dá pra ter
           pontuação de sobra e não subir. Dizer só "faltam 0 pontos" seria
           meia-verdade, e é exatamente o caso que mais confunde. */
        prog.faltaEixo
          ? faixa({
              tipo: "neutra",
              icone: "escudo",
              titulo: "Pontuação já dá, mas falta " + esc(prog.faltaEixo.rotulo.toLowerCase()) + ".",
              texto: "Para chegar ao " + NIVEIS[prog.proximo].rotulo + " são necessários " +
                prog.faltaEixo.min + " de " + prog.faltaEixo.rotulo.toLowerCase() +
                "; hoje tem " + numero(prog.faltaEixo.tem) + ". " +
                (prog.faltaEixo.eixo === "influence"
                  ? "Isso não se produz sozinho — depende de os outros responderem, reagirem e virem por indicação dela."
                  : "Isso vem de responder e acolher os outros, não de publicar mais."),
            })
          : ""
      }
    </section>

    <section class="drawer-secao">
      <h3>Os quatro eixos</h3>
      <ul class="composicao">
        ${EIXOS.map((eixo) => {
          const v = (d.eixos && d.eixos[eixo.id]) || 0;
          return `<li>
            <span class="composicao-rotulo" title="${esc(eixo.descricao)}">${esc(eixo.rotulo)}</span>
            <span class="composicao-trilho">
              <span class="composicao-preenchido" style="width:${Math.min(100, v).toFixed(1)}%"></span>
            </span>
            <span class="composicao-valor">${numero(v)}</span>
          </li>`;
        }).join("")}
      </ul>
      <p class="fita-nota" style="margin-top:8px">
        0 a 100, comparado com o percentil 90 desta comunidade — 100 significa
        "entre os 10% que mais têm", não "o máximo possível".
      </p>
    </section>

    <section class="drawer-secao">
      <h3>Progressão na Régua</h3>
      ${
        marcos.length
          ? `<ul class="trilha">${marcos
              .map(
                (mk) => `<li>
                  <span class="trilha-ponto" style="background:${COR_NIVEL[mk.para]}"></span>
                  <p class="trilha-nivel">${mk.para > mk.de ? "Subiu para" : "Caiu para"} ${esc(NIVEIS[mk.para].rotulo)}</p>
                  <p class="trilha-quando">${esc(data(mk.dia))}</p>
                </li>`
              )
              .join("")}
              <li>
                <span class="trilha-ponto" style="background:var(--line-strong)"></span>
                <p class="trilha-nivel">Entrou na comunidade</p>
                <p class="trilha-quando">${esc(data(m.entrouEm))}</p>
              </li>
            </ul>`
          : `<p class="fita-nota">Sem mudança de nível nos últimos 30 dias. Entrou na comunidade em ${esc(data(m.entrouEm))}.</p>`
      }
    </section>

    <section class="drawer-secao">
      <h3>De onde vem a pontuação</h3>
      ${
        d.composicao.length
          ? `<ul class="composicao">${d.composicao
              .map((x) => {
                const t = getTipo(x.tipo);
                return `<li>
                  <span class="composicao-rotulo">${esc(t ? t.rotulo : x.tipo)}</span>
                  <span class="composicao-trilho">
                    <span class="composicao-preenchido" style="width:${((x.contribuicao / maiorContribuicao) * 100).toFixed(1)}%"></span>
                  </span>
                  <span class="composicao-valor">${numero(x.contribuicao)}</span>
                </li>`;
              })
              .join("")}</ul>
            <p class="fita-nota" style="margin-top:8px">
              ${plural(d.composicao.reduce((a, x) => a + x.eventos, 0), "evento contado", "eventos contados")},
              já com o decaimento de ${cfg.meiaVidaDias} dias aplicado.
            </p>`
          : `<p class="fita-nota">Sem eventos registrados para esta pessoa.</p>`
      }
    </section>

    <section class="drawer-secao">
      <h3>Histórico</h3>
      ${
        hist.erro && !hist.itens.length
          ? estadoErro(hist.erro, "recarregar-historico")
          : !hist.iniciada && !hist.itens.length
          ? skeletonFeed(3)
          : !hist.itens.length
          ? `<p class="fita-nota">Nenhum evento registrado.</p>`
          : `<div>${hist.itens
              .map(
                (ev) => `<div class="evento-linha">
                  <span class="evento-ponto"></span>
                  <span class="evento-texto">${esc(predicadoDoEvento(ev))}</span>
                  <span class="evento-quando">${esc(relativo(ev.ocorridoEm, agora))}</span>
                </div>`
              )
              .join("")}
            ${
              hist.fim
                ? ""
                : `<button class="btn-secundario" style="margin-top:16px;width:100%"
                     data-comando="carregar-mais-historico" ${hist.carregando ? "disabled" : ""}>
                     ${hist.carregando ? "Carregando…" : "Carregar mais"}
                   </button>`
            }</div>`
      }
    </section>`;

  return moldura(corpo, cabecalhoDrawer);
}

/* ═══ §2.3 · Relatórios ═══════════════════════════════════════════════════════
   Sem biblioteca de gráfico: SVG à mão. Para uma série de uma dimensão e cinco
   barras horizontais, a biblioteca custaria mais peso que o desenho inteiro —
   e não sobreviveria ao "arquivo único que abre com dois cliques". */

const PERIODOS = [
  { id: "7", rotulo: "7 dias" },
  { id: "30", rotulo: "30 dias" },
  { id: "90", rotulo: "90 dias" },
];

function periodoDaRota() {
  const q = Rota.atual().query;
  return PERIODOS.some((p) => p.id === q.dias) ? Number(q.dias) : 30;
}

/* Acima de 30 dias a série diária vira ruído: 90 pontos em 640px de largura dão
   sete pixels por dia e nenhuma leitura. Agrupar por semana é o que o briefing
   pede e o que a densidade permite. */
function agruparPorSemana(serie) {
  const saida = [];
  for (let i = 0; i < serie.length; i += 7) {
    const bloco = serie.slice(i, i + 7);
    saida.push({
      dia: bloco[0].dia,
      eventos: bloco.reduce((a, p) => a + p.eventos, 0),
    });
  }
  return saida;
}

function telaRelatorios(c) {
  const cfgE = usarConfig();
  const cfg = cfgE.dado;
  const dias = periodoDaRota();

  const seletor = `
    <div class="segmentado" role="group" aria-label="Período do relatório">
      ${PERIODOS.map(
        (p) => `<button data-periodo="${p.id}" aria-pressed="${Number(p.id) === dias}">${esc(p.rotulo)}</button>`
      ).join("")}
    </div>
    <button class="btn-secundario" data-comando="exportar-relatorio">${svg("download")}Exportar CSV</button>`;

  const topo =
    cabecalho("Relatórios", "Como a comunidade se moveu na Régua no período escolhido.", seletor) +
    faixaDoEstado(c);

  if (c.estadoSync === "token_expirado" || c.estadoSync === "indisponivel") return topo;
  if (!cfg) {
    if (cfgE.estado === "erro") return topo + estadoErro(cfgE.erro, "recarregar-config");
    return topo + skeletonFeed(6);
  }

  const chave = Query.chaveDe("relatorio", { c: c.id, dias, cfg: assinaturaConfig(cfg) });
  const e = Query.usar(chave, () => CLIENTE.relatorio({ comunidadeId: c.id, config: cfg, dias }));

  if (e.estado === "carregando") {
    return topo + `<div class="pilha-24">${[0, 1]
      .map(() => `<div class="cartao"><span class="skel-bloco skel-fita" style="display:block"></span></div>`)
      .join("")}</div>`;
  }
  if (!e.dado) return topo + estadoErro(e.erro, "recarregar-relatorio");

  const d = e.dado;
  const totalMembros = [1, 2, 3, 4, 5].reduce((a, n) => a + (d.distribuicao[n] || 0), 0);
  const totalEventos = d.serie.reduce((a, p) => a + p.eventos, 0);
  const serie = dias > 30 ? agruparPorSemana(d.serie) : d.serie;
  const mv = d.movimentoResumo;

  /* Sem evento nenhum no período o relatório não tem o que contar. É estado
     vazio de recorte, não de comunidade: o histórico existe, este pedaço é que
     está sem nada. */
  if (totalEventos === 0) {
    return (
      topo +
      estadoVazio({
        icone: "calendario",
        titulo: "Nenhuma atividade nestes " + dias + " dias",
        texto: "A comunidade não registrou eventos no período escolhido. Experimente um período mais largo.",
        acoes: `<button class="btn-secundario" data-periodo="90">Ver 90 dias</button>`,
      })
    );
  }

  return (
    topo +
    `${marcaDesatualizado(e)}
    <div class="cartao">
      <div class="cartao-cabecalho">
        <div>
          <h2>Atividade ao longo do tempo</h2>
          <p>${numero(totalEventos)} eventos em ${dias} dias${dias > 30 ? ", agrupados por semana" : ""}.</p>
        </div>
      </div>
      ${sparkline(serie, { titulo: "Eventos por " + (dias > 30 ? "semana" : "dia"), sufixo: " eventos" })}
    </div>

    <div class="grade-2">
      <div class="cartao">
        <div class="cartao-cabecalho">
          <div>
            <h2>Distribuição pela Régua</h2>
            <p>${plural(totalMembros, "pessoa lida", "pessoas lidas")} nesta comunidade.</p>
          </div>
        </div>
        <ul class="barras-h">
          ${[5, 4, 3, 2, 1]
            .map((n) => {
              const v = d.distribuicao[n] || 0;
              const largura = totalMembros ? (v / totalMembros) * 100 : 0;
              return `<li>
                <span class="barras-h-rotulo"><i style="background:${COR_NIVEL[n]}"></i>${esc(NIVEIS[n].rotulo)}</span>
                <span class="barras-h-trilho">
                  <span class="barras-h-preenchido" style="width:${largura.toFixed(1)}%;background:${COR_NIVEL[n]}"></span>
                </span>
                <span class="barras-h-valor">${numero(v)} · ${pct(v, totalMembros)}%</span>
              </li>`;
            })
            .join("")}
        </ul>
      </div>

      <div class="cartao">
        <div class="cartao-cabecalho">
          <div>
            <h2>Movimento entre níveis</h2>
            <p>Comparação com ${mv.janelaDias} dias atrás.</p>
          </div>
        </div>
        <dl class="movimento">
          <div data-d="subiu"><dt>Subiram</dt><dd>${numero(mv.subiram)}</dd></div>
          <div data-d="desceu"><dt>Desceram</dt><dd>${numero(mv.desceram)}</dd></div>
          <div data-d="estavel"><dt>Ficaram</dt><dd>${numero(mv.estaveis)}</dd></div>
        </dl>
        ${
          dias !== mv.janelaDias
            ? `<p class="fita-nota" style="margin-top:16px">
                 Este bloco compara sempre ${mv.janelaDias} dias, independente do período
                 escolhido acima — a comparação de nível é calculada nessa janela fixa.
               </p>`
            : ""
        }
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-cabecalho">
        <div>
          <h2>Top 10 contribuintes</h2>
          <p>Por pontuação atual na Régua.</p>
        </div>
      </div>
      <ul class="top10">
        ${d.topo
          .map(
            (l, i) => `<li>
              <span class="top10-pos">${i + 1}</span>
              <button class="top10-membro" data-abrir-membro="${esc(l.membro.id)}">
                ${avatar(l.membro.iniciais, l.membro.nome, "sm")}
                <span style="min-width:0">
                  <span class="top10-nome">${esc(l.membro.nome)}</span>
                </span>
                ${crachaNivel(l.nivel)}
              </button>
              <span class="barras-h-valor">${numero(l.pontuacao)}</span>
            </li>`
          )
          .join("")}
      </ul>
    </div>

    <div class="cartao">
      <div class="cartao-cabecalho">
        <div>
          <h2>Composição da atividade</h2>
          <p>Que tipo de evento a comunidade produz.</p>
        </div>
      </div>
      <ul class="barras-h">
        ${d.composicao
          .slice()
          .sort((a, b) => b.eventos - a.eventos)
          .map((x) => {
            const t = getTipo(x.tipo);
            const largura = totalEventos ? (x.eventos / totalEventos) * 100 : 0;
            return `<li>
              <span class="barras-h-rotulo">${svg(t ? t.icone : "balao")}${esc(t ? t.rotulo : x.tipo)}</span>
              <span class="barras-h-trilho">
                <span class="barras-h-preenchido" style="width:${largura.toFixed(1)}%;background:var(--brand)"></span>
              </span>
              <span class="barras-h-valor">${numero(x.eventos)} · ${pct(x.eventos, totalEventos)}%</span>
            </li>`;
          })
          .join("")}
      </ul>
    </div>`
  );
}

/* ═══ §2.4 · Configurações — o editor da Régua ════════════════════════════════
   A tela que só é possível porque `calcularPontuacao` é função pura: mexer num
   peso não grava nada, não recarrega nada e mesmo assim mostra na hora quantas
   pessoas mudariam de nível.

   O rascunho é separado do que está salvo de propósito. Sem essa separação não
   existe "descartar", e cada arrastão de slider seria uma gravação. */

function comunidadeParaPrevia() {
  const e = usarComunidades();
  const cs = e.dado || [];
  if (!cs.length) return null;
  const guardada = ler(GUARDA_COMUNIDADE);
  return (
    cs.find((c) => c.id === guardada && c.estadoSync === "conectada") ||
    cs.find((c) => c.estadoSync === "conectada") ||
    null
  );
}

function rascunhoAtual(salva) {
  if (!telaUi.rascunho) telaUi.rascunho = normalizarConfig(JSON.parse(JSON.stringify(salva)));
  return telaUi.rascunho;
}

function corpoDaPrevia(comunidade) {
  if (!comunidade) {
    return `<p class="fita-nota">Conecte uma comunidade para ver o efeito destes pesos sobre gente de verdade.</p>`;
  }
  const p = telaUi.previa;
  if (!p) {
    return `<p class="previa-calculando">Calculando…</p>`;
  }
  if (p.erro) {
    return `<p class="fita-nota">Não conseguimos calcular a prévia agora. ${esc(explicarErro(p.erro).texto)}</p>`;
  }

  const total = [1, 2, 3, 4, 5].reduce((a, n) => a + (p.distribuicao[n] || 0), 0);
  const semMudanca = p.sobem === 0 && p.descem === 0;

  return `
    <p class="previa-numero">${numero(p.membros)}</p>
    <p class="fita-nota">pessoas em ${esc(comunidade.nome)}</p>
    <div style="margin-top:16px">
      ${
        semMudanca
          ? `<p class="previa-mudanca" data-d="igual">${svg("estavel")}Ninguém mudaria de nível.</p>`
          : `<p class="previa-mudanca" data-d="subiu">${svg("trend-up")}${plural(p.sobem, "pessoa subiria", "pessoas subiriam")}</p>
             <p class="previa-mudanca" data-d="desceu">${svg("trend-down")}${plural(p.descem, "pessoa desceria", "pessoas desceriam")}</p>
             <p class="previa-mudanca" data-d="igual">${svg("estavel")}${plural(p.iguais, "ficaria onde está", "ficariam onde estão")}</p>`
      }
    </div>
    ${
      /* O número que só a porta de eixo produz, e o que mais confunde sem
         explicação: gente com pontuação de sobra que não sobe. */
      p.travados > 0
        ? `<p class="fita-nota" style="margin-top:12px">
            ${plural(p.travados, "pessoa tem", "pessoas têm")} pontuação de um nível acima,
            mas ${p.travados === 1 ? "não passa" : "não passam"} na porta de eixo.
          </p>`
        : ""
    }
    <div style="margin-top:16px">
      ${barraRegua(p.distribuicao, total)}
      ${legendaRegua(p.distribuicao)}
    </div>
    ${telaUi.previaPendente ? `<p class="previa-calculando" style="margin-top:8px">Recalculando…</p>` : ""}`;
}

function telaConfiguracoes() {
  const e = usarConfig();

  const topo = cabecalho(
    "Configurações",
    "A Régua de Engajamento: quanto vale cada coisa, e quanto tempo cada coisa continua valendo."
  );

  if (e.estado === "carregando") return topo + skeletonFeed(5);
  if (!e.dado) return topo + estadoErro(e.erro, "recarregar-config");

  const salva = e.dado;
  const r = rascunhoAtual(salva);
  const comunidade = comunidadeParaPrevia();
  const sujo = !configIgual(r, salva);
  const ehPadrao = configIgual(r, configPadrao());

  /* Primeiro cálculo da prévia. Sem isto, quem abre a tela e não encosta em
     nada fica olhando "Calculando…" para sempre — o cálculo só era disparado
     pelo `input` de um slider.

     Mesmo padrão de efeito-durante-render que `Paginado.iniciar` usa no feed, e
     pela mesma razão: quem sabe que o dado falta é quem está desenhando. A
     guarda de `previaPendente` impede laço. */
  if (comunidade && !telaUi.previa && !telaUi.previaPendente) {
    telaUi.previaPendente = true;
    setTimeout(calcularPrevia, 0);
  }

  const campoPeso = (t) => {
    const eixo = getEixo(t.eixo);
    return `
    <div class="campo">
      <label class="campo-rotulo" for="peso-${t.id}">
        ${esc(t.rotulo)}
        <span class="campo-dica">${esc(eixo ? eixo.rotulo : t.eixo)}${
          t.retroativo ? "" : " · só a partir da subida do coletor"
        }</span>
      </label>
      <input type="range" id="peso-${t.id}" data-foco="peso-${t.id}" data-peso="${t.id}"
        min="0" max="50" step="1" value="${r.pesos[t.id]}"
        aria-label="Peso de ${esc(t.rotulo)}">
      <input type="number" data-foco="num-${t.id}" data-peso-num="${t.id}"
        min="0" max="50" step="1" value="${r.pesos[t.id]}"
        aria-label="Peso de ${esc(t.rotulo)}, em número">
    </div>`;
  };

  /* Limiar e porta ficam juntos, no mesmo bloco do nível: são a mesma decisão
     em duas metades ("quanto" e "de quê"), e separá-los em cartões diferentes
     faria parecer que dá pra mexer num sem pensar no outro. */
  const campoLimiar = (l) => {
    const n = l.nivel;
    return `
    <div class="campo">
      <label class="campo-rotulo" for="limiar-${n}">
        ${esc(NIVEIS[n].rotulo)}
        <span class="campo-dica">pontuação mínima</span>
      </label>
      <input type="range" id="limiar-${n}" data-foco="limiar-${n}" data-limiar="${n}"
        min="1" max="400" step="1" value="${l.minScore}"
        aria-label="Pontuação mínima do ${esc(NIVEIS[n].rotulo)}">
      <input type="number" data-foco="limiar-num-${n}" data-limiar-num="${n}"
        min="1" max="400" step="1" value="${l.minScore}"
        aria-label="Pontuação mínima do ${esc(NIVEIS[n].rotulo)}, em número">
    </div>
    ${
      l.porta
        ? `<div class="campo">
            <label class="campo-rotulo" for="porta-${n}">
              ↳ porta de ${esc((getEixo(l.porta.eixo) || {}).rotulo || l.porta.eixo)}
              <span class="campo-dica">pontuação sozinha não promove a este nível</span>
            </label>
            <input type="range" id="porta-${n}" data-foco="porta-${n}" data-porta="${n}"
              min="0" max="100" step="1" value="${l.porta.min}"
              aria-label="Porta de eixo do ${esc(NIVEIS[n].rotulo)}">
            <input type="number" data-foco="porta-num-${n}" data-porta-num="${n}"
              min="0" max="100" step="1" value="${l.porta.min}"
              aria-label="Porta de eixo do ${esc(NIVEIS[n].rotulo)}, em número">
          </div>`
        : ""
    }`;
  };

  return (
    topo +
    `<div class="config-grade">
      <div>
        <div class="cartao">
          <div class="cartao-cabecalho">
            <div>
              <h2>Peso de cada tipo de evento</h2>
              <p>Quanto cada coisa vale no dia em que acontece. Trazer alguém de fora deveria valer mais que uma reação — é a tese do produto.</p>
            </div>
          </div>
          ${TIPOS_EVENTO.map(campoPeso).join("")}
        </div>

        <div class="cartao">
          <div class="cartao-cabecalho">
            <div>
              <h2>Decaimento</h2>
              <p>Em quantos dias um evento passa a valer metade. Sem isso, quem foi ativo uma vez fica no topo para sempre.</p>
            </div>
          </div>
          <div class="campo">
            <label class="campo-rotulo" for="meia-vida">
              Meia-vida
              <span class="campo-dica">um evento some (vale menos de 1%) em ~${horizonteDeEsquecimento(r.meiaVidaDias)} dias</span>
            </label>
            <input type="range" id="meia-vida" data-foco="meia-vida" data-meia-vida
              min="1" max="365" step="1" value="${r.meiaVidaDias}"
              aria-label="Meia-vida do decaimento, em dias">
            <input type="number" data-foco="meia-vida-num" data-meia-vida-num
              min="1" max="365" step="1" value="${r.meiaVidaDias}"
              aria-label="Meia-vida em dias, em número">
          </div>
        </div>

        <div class="cartao">
          <div class="cartao-cabecalho">
            <div>
              <h2>Limiares e portas</h2>
              <p>Cada nível tem dois requisitos: pontuação e, do 3 para cima, um eixo mínimo.
                 A porta existe porque quem manda 300 mensagens e ninguém responde não é
                 Contribuinte — é ruído. Arraste à vontade: limiares fora de ordem são
                 empurrados para baixo ao salvar.</p>
            </div>
          </div>
          ${r.limiares.filter((l) => l.nivel > 1).map(campoLimiar).join("")}
        </div>

        <div class="config-rodape">
          ${sujo
            ? `<span class="aviso-sujo">Alterações não salvas — a prévia ao lado já mostra o efeito delas.</span>`
            : `<span class="aviso-sujo" style="color:var(--ink-subtle)">Tudo salvo.</span>`}
          <button class="btn-secundario" data-comando="restaurar-padrao" ${ehPadrao ? "disabled" : ""}>
            ${svg("recarregar")}Restaurar padrão
          </button>
          <button class="btn-secundario" data-comando="descartar-config" ${sujo ? "" : "disabled"}>
            Descartar
          </button>
          <button class="btn-primario" data-comando="salvar-config" ${sujo ? "" : "disabled"}>
            ${svg("check")}Salvar
          </button>
        </div>
      </div>

      <div class="cartao previa">
        <div class="cartao-cabecalho">
          <div>
            <h2>Prévia ao vivo</h2>
            <p>O efeito destes pesos, calculado sobre a comunidade inteira.</p>
          </div>
        </div>
        <div data-previa>${corpoDaPrevia(comunidade)}</div>
      </div>
    </div>`
  );
}

/* ═══ §2.7 · Busca da topbar ══════════════════════════════════════════════════
   Busca de verdade sobre membros e comunidades, agrupada, navegável por setas.
   Abre sozinha a partir de dois caracteres — abaixo disso o contrato devolve
   vazio de propósito, e um popover vazio piscando a cada tecla seria ruído. */

function resultadosDaBusca(termo) {
  const t = termo.trim();
  if (t.length < 2) return { itens: [], estado: "curto" };

  const e = Query.usar(Query.chaveDe("busca", { q: t.toLowerCase() }), () => CLIENTE.buscar(t), {
    frescoMs: 15000,
  });
  if (!e.dado) return { itens: [], estado: e.estado };

  const itens = []
    .concat(
      (e.dado.comunidades || []).map((c) => ({
        grupo: "Comunidades",
        id: "c:" + c.id,
        nome: c.nome,
        sub: (getPlataforma(c.plataforma) || {}).nome + " · " + formatarMembros(c.membros) + " membros",
        icone: c.plataforma,
        rota: { tela: "comunidade", comunidadeId: c.id, aba: "atividade", query: {} },
      }))
    )
    .concat(
      (e.dado.membros || []).map((m) => ({
        grupo: "Pessoas",
        id: "m:" + m.id,
        nome: m.nome,
        sub: m.arroba,
        icone: "pessoas",
        rota: { tela: "comunidade", comunidadeId: m.comunidadeId, aba: "membros", query: { membro: m.id } },
      }))
    );

  return { itens, estado: e.estado };
}

/** Lista agrupada com um item marcado. Serve à busca e à paleta. */
function listaNavegavel(itens, indice, prefixo) {
  let grupoAtual = null;
  return itens
    .map((it, i) => {
      const cabecalhoGrupo = it.grupo !== grupoAtual ? `<p class="paleta-grupo">${esc(it.grupo)}</p>` : "";
      grupoAtual = it.grupo;
      return (
        cabecalhoGrupo +
        `<button class="paleta-item" data-${prefixo}="${i}" data-ativo="${i === indice}"
          ${i === indice ? 'aria-current="true"' : ""}>
          ${svg(it.icone || "seta-dir")}
          <span class="paleta-item-corpo">
            <span class="paleta-item-nome">${esc(it.nome)}</span>
            ${it.sub ? `<span class="paleta-item-sub">${esc(it.sub)}</span>` : ""}
          </span>
          ${it.atalho ? `<span class="tecla">${esc(it.atalho)}</span>` : ""}
        </button>`
      );
    })
    .join("");
}

/* Guardado fora do render pra o clique e o Enter resolverem exatamente o mesmo
   item que estava desenhado — recomputar a lista no handler abriria espaço pra
   ela ter mudado entre o desenho e o clique. */
let itensDaBusca = [];

function popoverBusca() {
  const termo = ui.buscaTopo || "";
  const r = resultadosDaBusca(termo);
  itensDaBusca = r.itens;

  const corpo = (() => {
    if (r.estado === "curto") {
      return `<p class="fita-nota" style="padding:16px">Digite pelo menos dois caracteres.</p>`;
    }
    if (r.estado === "carregando" && !r.itens.length) return skeletonFeed(2);
    if (!r.itens.length) {
      return `<div style="padding:8px">${estadoVazio({
        icone: "search",
        titulo: "Nada encontrado",
        texto: "Nenhuma comunidade ou pessoa com “" + termo.trim() + "”.",
      })}</div>`;
    }
    return listaNavegavel(r.itens, telaUi.buscaIndice, "busca-item");
  })();

  return `
    <div class="overlay" data-fechar-popover></div>
    <div class="popover" style="right:24px" role="dialog" aria-label="Resultados da busca">
      <div class="popover-lista" data-rolagem="pop-busca">${corpo}</div>
      <div class="paleta-rodape">
        <span><span class="tecla">↑</span><span class="tecla">↓</span> navegar</span>
        <span><span class="tecla">↵</span> abrir</span>
        <span><span class="tecla">esc</span> fechar</span>
      </div>
    </div>`;
}

function aoBuscarNoTopo(termo) {
  telaUi.buscaIndice = 0;
  const abrir = String(termo || "").trim().length >= 1;
  if (abrir) {
    ui.popover = "busca";
    ui.seletor = null;
  } else if (ui.popover === "busca") {
    ui.popover = null;
  }
  Render.sujar("sobreposicoes", "topbar");
}

/* ═══ §2.7 · Paleta de comandos ═══════════════════════════════════════════════
   Ctrl/Cmd+K. Tudo que a paleta faz, um botão em algum lugar também faz — ela
   é atalho, não caminho exclusivo. Por isso as ações apontam pros mesmos
   comandos de `COMANDOS`, e não pra implementações paralelas. */

let itensDaPaleta = [];

function montarItensDaPaleta() {
  const cs = (usarComunidades().dado || []);
  const r = Rota.atual();
  const itens = [];

  for (const nav of ROTAS_NAV) {
    itens.push({
      grupo: "Ir para",
      nome: nav.rotulo,
      sub: null,
      icone: nav.icone,
      executar: () => Rota.ir({ tela: "comunidade", aba: nav.id, query: {} }),
    });
  }
  itens.push({
    grupo: "Ir para",
    nome: "Configurações",
    icone: "config",
    executar: () => Rota.ir({ tela: "configuracoes", query: {} }),
  });

  for (const c of cs) {
    itens.push({
      grupo: "Trocar de comunidade",
      nome: c.nome,
      sub: (getPlataforma(c.plataforma) || {}).nome + " · " + ESTADOS_SYNC[c.estadoSync].rotulo,
      icone: c.plataforma,
      executar: () => Rota.ir({ tela: "comunidade", comunidadeId: c.id, query: {} }),
    });
  }

  itens.push(
    {
      grupo: "Ações",
      nome: "Conectar comunidade",
      icone: "plus",
      executar: () => executarComando("conectar", {}),
    },
    {
      grupo: "Ações",
      nome: "Sincronizar esta comunidade",
      icone: "recarregar",
      executar: () => executarComando("ressincronizar", {}),
    },
    {
      grupo: "Ações",
      nome: "Recarregar tudo",
      icone: "recarregar",
      executar: () => executarComando("recarregar", {}),
    }
  );

  /* Busca de pessoas entra na paleta a partir de dois caracteres, no mesmo
     contrato que a busca da topbar usa. */
  const termo = (telaUi.paleta && telaUi.paleta.termo) || "";
  if (termo.trim().length >= 2) {
    for (const it of resultadosDaBusca(termo).itens) {
      itens.push({
        grupo: it.grupo,
        nome: it.nome,
        sub: it.sub,
        icone: it.icone,
        executar: () => Rota.ir(it.rota),
      });
    }
  }

  if (!termo.trim()) return itens;
  const q = termo.trim().toLowerCase();
  return itens.filter((it) => (it.nome + " " + (it.sub || "")).toLowerCase().includes(q));
}

function paletaComandos() {
  if (!telaUi.paleta) return "";
  const itens = montarItensDaPaleta();
  itensDaPaleta = itens;
  const indice = Math.min(telaUi.paleta.indice, Math.max(0, itens.length - 1));

  return `
    <div class="overlay" data-fechar-paleta></div>
    <div class="paleta" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
      <div class="paleta-campo">
        ${svg("comando")}
        <input type="text" data-foco="paleta" data-paleta-campo
          value="${esc(telaUi.paleta.termo)}"
          placeholder="Buscar comando, comunidade ou pessoa"
          aria-label="Buscar comando, comunidade ou pessoa"
          aria-controls="paleta-lista">
      </div>
      <div class="paleta-lista" id="paleta-lista" data-rolagem="paleta">
        ${
          itens.length
            ? listaNavegavel(itens, indice, "paleta-item")
            : `<p class="fita-nota" style="padding:16px">Nada corresponde a “${esc(telaUi.paleta.termo)}”.</p>`
        }
      </div>
      <div class="paleta-rodape">
        <span><span class="tecla">↑</span><span class="tecla">↓</span> navegar</span>
        <span><span class="tecla">↵</span> executar</span>
        <span><span class="tecla">esc</span> fechar</span>
      </div>
    </div>`;
}

/* ═══ §2.6 · Conectar comunidade ══════════════════════════════════════════════
   A coreografia inteira do OAuth, terminando em falso. Nenhum `window.open`,
   nenhuma URL de autorização: o que a tela precisa exercitar é a sequência de
   telas e os estados que ela produz, e isso não depende de existir servidor.

   O passo 2 é o mais importante e o mais fácil de escrever mal. É o momento em
   que a pessoa decide se confia, e a resposta honesta inclui o que a
   EngageMend **não** vai ler. */

const PASSOS_CONEXAO = ["plataforma", "permissoes", "autorizando", "pronto"];

const PERMISSOES_LIDAS = [
  { icone: "balao", titulo: "Mensagens públicas dos canais", texto: "Autor, canal, horário e tamanho. O conteúdo do texto não é armazenado." },
  { icone: "coracao", titulo: "Reações e respostas", texto: "Quem reagiu ou respondeu a quê, e quando." },
  { icone: "convite", titulo: "Entradas e convites", texto: "Quem entrou na comunidade e por indicação de quem." },
  { icone: "presenca", titulo: "Presença em eventos", texto: "Quem participou de lives e encontros, e por quanto tempo." },
];

const PERMISSOES_NEGADAS = [
  { icone: "olho-off", titulo: "Mensagens diretas", texto: "Nunca. A EngageMend não pede e não recebe acesso a conversas privadas." },
  { icone: "olho-off", titulo: "Conteúdo de canais privados", texto: "Só canais que qualquer membro da comunidade já pode ler." },
  { icone: "olho-off", titulo: "E-mails e telefones", texto: "Nenhum dado de contato é lido, guardado ou exportado." },
];

function modalConexao() {
  if (!telaUi.conexao) return "";
  const st = telaUi.conexao;
  const indice = PASSOS_CONEXAO.indexOf(st.passo);
  const p = st.plataforma ? getPlataforma(st.plataforma) : null;

  const passos = `
    <div class="passos" aria-hidden="true">
      ${PASSOS_CONEXAO.map((_, i) => `<span data-feito="${i <= indice}"></span>`).join("")}
    </div>`;

  const fechar = `<button class="icone-btn" data-fechar-conexao aria-label="Fechar">${svg("close")}</button>`;

  let cabecalhoModal = "";
  let corpo = "";
  let rodape = "";

  if (st.passo === "plataforma") {
    cabecalhoModal = `<h2>Conectar comunidade</h2><p>De onde a EngageMend vai ler a atividade?</p>`;
    corpo = `
      <div class="grade-plataformas">
        ${PLATAFORMAS.map((pl) => {
          const ind = INDISPONIVEIS[pl.id];
          return `<button class="card-plataforma" data-escolher-plataforma="${pl.id}"
            style="--marca:${corDaMarca(pl, "clara")}" ${ind ? "disabled" : ""}>
            ${svg(pl.id)}
            ${esc(pl.nome)}
            ${ind ? `<span class="card-motivo">${esc(ind.curto)}</span>` : ""}
          </button>`;
        }).join("")}
      </div>
      <p class="fita-nota" style="margin-top:16px">
        WhatsApp e X aparecem desabilitados porque hoje não há como ler a atividade
        deles — o motivo de cada um está escrito no próprio botão.
      </p>`;
    rodape = `<button class="btn-secundario" data-fechar-conexao>Cancelar</button>`;
  }

  if (st.passo === "permissoes") {
    cabecalhoModal = `<h2>O que a EngageMend vai ler no ${esc(p.nome)}</h2>
      <p>Antes de autorizar, veja exatamente o que sai daí e o que nunca é tocado.</p>`;
    corpo = `
      <ul class="permissoes">
        ${PERMISSOES_LIDAS.map(
          (x) => `<li>${svg(x.icone)}<div><strong>${esc(x.titulo)}</strong><p>${esc(x.texto)}</p></div></li>`
        ).join("")}
      </ul>
      <h3 style="margin:24px 0 0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-subtle)">
        O que não é lido
      </h3>
      <ul class="permissoes permissoes-nao">
        ${PERMISSOES_NEGADAS.map(
          (x) => `<li>${svg(x.icone)}<div><strong>${esc(x.titulo)}</strong><p>${esc(x.texto)}</p></div></li>`
        ).join("")}
      </ul>
      ${p.id === "youtube" ? `<div class="campo" style="grid-template-columns:1fr;margin-top:16px">
        <label class="campo-rotulo" for="id-canal">ID do canal do YouTube <span class="campo-dica">começa com "UC"</span></label>
        <input type="text" id="id-canal" data-foco="id-canal" data-identificador-conexao placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" value="${esc(st.identificador || "")}" style="height:32px;padding:0 8px;border:1px solid var(--line-strong);border-radius:6px;font-size:14px;width:100%">
      </div>` : `<div class="campo" style="grid-template-columns:1fr;margin-top:16px">
        <label class="campo-rotulo" for="nome-comunidade">
          Como chamar esta comunidade
          <span class="campo-dica">só para você identificar aqui dentro</span>
        </label>
        <input type="text" id="nome-comunidade" data-foco="nome-conexao" data-nome-conexao
          value="${esc(st.nome)}" style="height:32px;padding:0 8px;border:1px solid var(--line-strong);border-radius:6px;font-size:14px;width:100%">
      </div>`}
    `;
    rodape = `
      <button class="btn-secundario esq" data-voltar-conexao>Voltar</button>
      <button class="btn-primario" data-autorizar-conexao ${(st.plataforma === "youtube" ? (st.identificador || "").trim() : st.nome.trim()) ? "" : "disabled"}>
        ${svg(p.id)}Autorizar no ${esc(p.nome)}
      </button>`;
  }

  if (st.passo === "autorizando") {
    cabecalhoModal = `<h2>Esperando o ${esc(p.nome)}</h2><p>Isto abriria a tela de autorização da plataforma.</p>`;
    corpo = `
      <div class="espera">
        <div class="espera-anel" aria-hidden="true"></div>
        <p class="fita-nota">Nenhuma janela foi aberta e nenhum token existe: este protótipo simula o
        retorno da autorização, sem falar com o ${esc(p.nome)}.</p>
      </div>`;
    rodape = `<button class="btn-secundario" data-fechar-conexao>Cancelar</button>`;
  }

  if (st.passo === "pronto") {
    cabecalhoModal = `<h2>${esc(st.nome)} conectada</h2>
      <p>A leitura começou. Em alguns segundos os primeiros números aparecem.</p>`;
    corpo = st.erro
      ? estadoErro(st.erro, "fechar-conexao")
      : `<div class="espera">
          ${svg("check-circ")}
          <p class="fita-nota" style="margin-top:16px">
            A comunidade entra como <strong>sincronizando</strong> e vira <strong>sincronizada</strong>
            sozinha assim que a primeira leitura termina.
          </p>
        </div>`;
    rodape = `<button class="btn-primario" data-fechar-conexao>Ver a comunidade</button>`;
  }

  return `
    <div class="modal-fundo" data-fechar-conexao></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="conexao-titulo">
      <div class="modal-cabecalho">
        <div id="conexao-titulo">${cabecalhoModal}</div>
        ${st.passo === "autorizando" ? "" : fechar}
      </div>
      ${passos}
      <div class="modal-corpo">${corpo}</div>
      <div class="modal-rodape">${rodape}</div>
    </div>`;
}

/* ═══ §3 · Painel de simulação ════════════════════════════════════════════════
   Ctrl+Shift+D. Este é o único bloco do arquivo que fala com `MOCK` — e fala
   de propósito: ele não é uma tela, é o console do mundo falso. Com adaptador
   HTTP ele simplesmente não existe (`usandoMock()` devolve falso), que é o
   equivalente honesto de `NODE_ENV !== "production"` num arquivo sem build.

   Sem ele, metade dos estados descritos no briefing seria inalcançável: erro de
   rede, limite de taxa, token expirado, lista vazia e decaimento agindo não
   acontecem sob demanda. */

const LATENCIAS_ROTULO = {
  instantanea: "0 ms",
  rapida: "~100 ms",
  realista: "~400 ms",
  lenta: "~2 s",
};

const ERROS_FORCAVEIS = [
  { id: "nenhuma", rotulo: "nenhum" },
  { id: "rede", rotulo: "rede" },
  { id: "auth", rotulo: "token expirado" },
  { id: "limite", rotulo: "limite de taxa" },
  { id: "nao_encontrado", rotulo: "não encontrado" },
];

function painelSimulacao() {
  if (!usandoMock()) return "";

  if (!telaUi.sim.aberto) {
    return `<p class="sim-aberto-dica">
      <span class="tecla">Ctrl</span>+<span class="tecla">Shift</span>+<span class="tecla">D</span> simulação
    </p>`;
  }

  const st = MOCK.controles.estado;
  const ligado = MOCK.controles.tickerLigado();
  const pulados = MOCK.controles.diasPulados();
  const r = telaUi.sim.resultado;

  const opcoes = (nome, itens, atual, atributo) => `
    <div class="sim-grupo">
      <h3>${esc(nome)}</h3>
      <div class="sim-opcoes">
        ${itens
          .map(
            (it) => `<button data-${atributo}="${esc(it.id)}" aria-pressed="${it.id === atual}">${esc(it.rotulo)}</button>`
          )
          .join("")}
      </div>
    </div>`;

  return `
    <section class="sim" role="region" aria-label="Painel de simulação">
      <header class="sim-cabecalho">
        ${svg("terminal")}
        <h2>Simulação</h2>
        <button class="icone-btn" data-fechar-sim aria-label="Fechar painel de simulação">${svg("close")}</button>
      </header>
      <div class="sim-corpo" data-rolagem="sim">
        ${opcoes(
          "Latência",
          MOCK.controles.latencias.map((l) => ({ id: l, rotulo: LATENCIAS_ROTULO[l] || l })),
          st.latencia,
          "sim-latencia"
        )}
        ${opcoes(
          "Taxa de erro",
          [{ id: "0", rotulo: "0%" }, { id: "0.1", rotulo: "10%" }, { id: "1", rotulo: "100%" }],
          String(st.taxaErro),
          "sim-taxa"
        )}
        ${opcoes("Forçar erro", ERROS_FORCAVEIS, st.falha, "sim-erro")}

        <div class="sim-grupo">
          <h3>Estado do mundo</h3>
          <div class="sim-opcoes">
            <button data-sim-offline aria-pressed="${ui.offline}">modo offline</button>
            <button data-sim-vazio aria-pressed="${st.vazio}">comunidade vazia</button>
            <button data-sim-ticker aria-pressed="${ligado}">atividade ao vivo</button>
          </div>
          <div class="sim-acoes" style="margin-top:8px">
            <button data-sim-rajada>Chegar 3 atividades agora</button>
            <button data-sim-notificacao>Chegar uma notificação</button>
            <button data-sim-expirar>Expirar a conexão de uma comunidade</button>
            <button data-sim-pular>Pular 30 dias (ver o decaimento agindo)</button>
          </div>
          ${pulados > 0 ? `<p class="sim-nota">Relógio ${plural(pulados, "dia", "dias")} à frente do real.</p>` : ""}
        </div>

        <div class="sim-grupo">
          <h3>Semente</h3>
          <div class="sim-semente">
            <input type="text" data-foco="sim-semente" data-sim-semente
              value="${esc(MOCK.controles.semente())}" aria-label="Semente do gerador">
            <button data-sim-reconstruir>Gerar</button>
          </div>
          <p class="sim-nota">A mesma semente devolve o mesmo mundo. Trocar reconstrói tudo.</p>
        </div>

        <div class="sim-grupo">
          <h3>Testes (§11)</h3>
          <div class="sim-acoes">
            <button data-sim-testes ${telaUi.sim.rodando ? "disabled" : ""}>
              ${telaUi.sim.rodando ? "Rodando…" : "Rodar os " + Testes.quantos() + " casos"}
            </button>
          </div>
          ${r ? `<p class="sim-testes" style="margin-top:8px">${r.linhas.join("\n")}</p>` : ""}
        </div>
      </div>
    </section>`;
}

/* ── Todas as sobreposições de §10b ──────────────────────────────────────────
   Ordem = empilhamento. O drawer fica embaixo; paleta e modal por cima; o
   painel de simulação acima de tudo, porque ele precisa continuar alcançável
   justamente quando algo está travado na frente. */
function sobreposicoesDasTelas() {
  return (
    drawerMembro() +
    (ui.popover === "busca" ? popoverBusca() : "") +
    modalConexao() +
    paletaComandos() +
    painelSimulacao()
  );
}

/** O shell pergunta isto pra saber se tem de prender o foco e tratar o Esc. */
function dialogoDasTelasAberto() {
  return Boolean(telaUi.paleta || telaUi.conexao || Rota.atual().query.membro);
}

/* Esc fecha uma camada por vez, da mais recente pra mais antiga. Fechar tudo de
   uma vez faria um Esc distraído jogar a pessoa três telas pra trás. */
function aoEscaparNasTelas() {
  if (telaUi.paleta) { fecharPaleta(); return true; }
  if (telaUi.conexao) {
    if (telaUi.conexao.passo === "autorizando") return true;  /* no meio do fluxo, Esc não cancela */
    fecharConexao();
    return true;
  }
  if (Rota.atual().query.membro) { fecharMembro(); return true; }
  if (telaUi.sim.aberto) { telaUi.sim.aberto = false; Render.sujar("sobreposicoes"); return true; }
  return false;
}

/* ── Abrir e fechar, com o foco voltando pra origem ─────────────────────────── */
let focoAntesDaCamada = null;

function abrirPaleta() {
  focoAntesDaCamada = document.activeElement;
  telaUi.paleta = { termo: "", indice: 0 };
  ui.popover = null;
  ui.seletor = null;
  Render.agora("sobreposicoes");
  document.querySelector("[data-paleta-campo]")?.focus();
}

function fecharPaleta() {
  if (!telaUi.paleta) return;
  telaUi.paleta = null;
  Render.agora("sobreposicoes");
  if (focoAntesDaCamada && document.contains(focoAntesDaCamada)) focoAntesDaCamada.focus();
  focoAntesDaCamada = null;
}

function abrirMembro(membroId) {
  focoAntesDaCamada = document.activeElement;
  Rota.filtrar({ membro: membroId }, false);
}

function fecharMembro() {
  Paginado.resetar("hist:");
  Rota.filtrar({ membro: null }, false);
  /* O foco volta pra linha que abriu a gaveta — se ela ainda existir na tela. */
  requestAnimationFrame(() => {
    if (focoAntesDaCamada && document.contains(focoAntesDaCamada)) focoAntesDaCamada.focus();
    focoAntesDaCamada = null;
  });
}

function abrirConexao() {
  focoAntesDaCamada = document.activeElement;
  telaUi.conexao = { passo: "plataforma", plataforma: null, nome: "", identificador: "", erro: null };
  Render.agora("sobreposicoes");
  document.querySelector(".modal [data-escolher-plataforma]:not([disabled])")?.focus();
}

function fecharConexao() {
  if (!telaUi.conexao) return;
  telaUi.conexao = null;
  Render.agora("sobreposicoes");
  if (focoAntesDaCamada && document.contains(focoAntesDaCamada)) focoAntesDaCamada.focus();
  focoAntesDaCamada = null;
}

/* ── A prévia das configurações ───────────────────────────────────────────────
   Debounce de verdade: arrastar um slider dispara `input` a cada pixel, e sem
   isso seriam dezenas de recálculos do mundo inteiro por segundo.

   Enquanto o debounce corre, a prévia antiga continua na tela com o aviso de
   "recalculando" — apagar e mostrar vazio faria o painel piscar a cada
   movimento do dedo. */
let temporizadorPrevia = null;

function agendarPrevia() {
  telaUi.previaPendente = true;
  atualizarPreviaNoDom();
  clearTimeout(temporizadorPrevia);
  temporizadorPrevia = setTimeout(calcularPrevia, 260);
}

function calcularPrevia() {
  const comunidade = comunidadeParaPrevia();
  if (!comunidade || !telaUi.rascunho) {
    telaUi.previaPendente = false;
    atualizarPreviaNoDom();
    return;
  }
  const proposta = normalizarConfig(telaUi.rascunho);
  CLIENTE.simularRegua({ comunidadeId: comunidade.id, config: proposta })
    .then((r) => { telaUi.previa = r; })
    .catch((erro) => { telaUi.previa = { erro }; })
    .then(() => {
      telaUi.previaPendente = false;
      atualizarPreviaNoDom();
    });
}

/* Escreve só o miolo da prévia, sem passar por `Render`. É o mesmo motivo pelo
   qual o shell redesenha a lista do seletor à mão: redesenhar a região inteira
   trocaria o `<input type=range>` sob o dedo e interromperia o arrasto. */
function atualizarPreviaNoDom() {
  const no = document.querySelector("[data-previa]");
  if (no) no.innerHTML = corpoDaPrevia(comunidadeParaPrevia());
}

/* ═══ Comandos ════════════════════════════════════════════════════════════════
   Registrados no mesmo `COMANDOS` do shell, então botão, paleta e atalho de
   teclado disparam o mesmo caminho. */

function feedAtual() {
  const r = Rota.atual();
  const cfg = usarConfig().dado;
  const filtros = filtrosDoFeed();
  const chave = chaveDoFeed(r.comunidadeId, filtros, assinaturaConfig(cfg));
  return {
    chave,
    lista: Paginado.usar(chave),
    buscador: buscadorDoFeed(chave, {
      comunidadeId: r.comunidadeId,
      tipos: filtros.tipos,
      nivel: filtros.nivel,
      config: cfg,
    }),
  };
}

function tabelaAtual() {
  const r = Rota.atual();
  const cfg = usarConfig().dado;
  const f = filtrosDaTabela();
  const chave = chaveDaTabela(r.comunidadeId, f, assinaturaConfig(cfg));
  return {
    chave,
    lista: Paginado.usar(chave),
    buscador: (cursor) =>
      CLIENTE.listarRanking({
        comunidadeId: r.comunidadeId,
        config: cfg,
        ordem: f.ordem,
        direcao: f.direcao,
        nivel: f.nivel,
        atividade: f.atividade,
        busca: f.busca,
        cursor,
        limite: 50,
      }),
  };
}

function linhasParaCSV(linhas) {
  const agora = new Date();
  return linhas.map((l) => [
    l.membro.nome,
    l.membro.arroba,
    l.nivel,
    NIVEIS[l.nivel].nome,
    String(l.pontuacao).replace(".", ","),
    l.tendencia,
    String(l.deltaPontuacao).replace(".", ","),
    l.totalEventos,
    l.ultimaAtividade ? dataHora(l.ultimaAtividade) : "sem atividade",
  ]);
}

const CABECALHO_CSV = [
  "Nome", "Arroba", "Nível", "Faixa", "Pontuação", "Tendência", "Variação 30d", "Eventos", "Última atividade",
];

Object.assign(COMANDOS, {
  conectar() { abrirConexao(); },
  paleta() { abrirPaleta(); },

  "limpar-filtros"() {
    Rota.filtrar({ tipo: null, nivel: null, atividade: null, q: null });
    telaUi.buscaMembros = null;
  },

  "mostrar-novas"() {
    /* A pílula não injeta nada por conta própria: ela recomeça a lista, que é o
       que traz o topo de verdade. Depois rola pro topo — nunca antes, senão a
       pessoa vê o salto e só então o conteúdo trocar. */
    const { chave, buscador } = feedAtual();
    Paginado.resetar(chave);
    membrosDoFeed.delete(chave);
    telaUi.novas = 0;
    Paginado.iniciar(chave, buscador).then((l) => {
      const antigo = telaUi.topoConhecido;
      const posicao = l.itens.findIndex((x) => x.id === antigo);
      /* Não achou o topo antigo: chegou mais coisa do que cabe numa página, e
         então a página inteira é nova. `slice(0, -1)` cortaria justamente o
         caso em que há mais a destacar, não menos. */
      const corte = posicao < 0 ? l.itens.length : posicao;
      telaUi.destacados = new Set(l.itens.slice(0, corte).map((x) => x.id));
      if (l.itens.length) telaUi.topoConhecido = l.itens[0].id;
      Render.sujar("conteudo");
      const principal = document.querySelector('[data-rolagem="principal"]');
      if (principal) principal.scrollTo({ top: 0, behavior: "smooth" });
      /* O destaque é passageiro: some sozinho depois da animação. */
      setTimeout(() => { telaUi.destacados = new Set(); Render.sujar("conteudo"); }, 2000);
    });
  },

  "carregar-mais"() {
    const { chave, buscador } = feedAtual();
    Paginado.carregarMais(chave, buscador).then(() => Render.sujar("conteudo"));
  },

  "carregar-mais-tabela"() {
    const { chave, buscador } = tabelaAtual();
    Paginado.carregarMais(chave, buscador).then(() => Render.sujar("conteudo"));
    Render.sujar("conteudo");
  },

  "carregar-mais-historico"() {
    const r = Rota.atual();
    const chave = "hist:" + r.query.membro;
    Paginado.carregarMais(chave, (cursor) =>
      CLIENTE.listarEventos({ comunidadeId: r.comunidadeId, membroId: r.query.membro, cursor, limite: 15 })
    ).then(() => Render.sujar("sobreposicoes"));
    Render.sujar("sobreposicoes");
  },

  "recarregar-config"() { Query.recarregar(CHAVE_CONFIG, buscarConfig); },
  "recarregar-relatorio"() { Query.invalidar("relatorio"); Render.sujar("conteudo"); },
  "recarregar-membro"() { Query.invalidar("membro"); Render.sujar("sobreposicoes"); },

  "recarregar-feed"() {
    const { chave, buscador } = feedAtual();
    Paginado.resetar(chave);
    membrosDoFeed.delete(chave);
    Paginado.iniciar(chave, buscador).then(() => Render.sujar("conteudo"));
    Render.sujar("conteudo");
  },

  "recarregar-tabela"() {
    const { chave, buscador } = tabelaAtual();
    Paginado.resetar(chave);
    Paginado.iniciar(chave, buscador).then(() => Render.sujar("conteudo"));
    Render.sujar("conteudo");
  },

  "recarregar-historico"() {
    const r = Rota.atual();
    Paginado.resetar("hist:" + r.query.membro);
    Render.sujar("sobreposicoes");
  },

  "limpar-selecao"() { telaUi.selecao.clear(); Render.sujar("conteudo"); },

  "exportar-tabela"() {
    const { lista } = tabelaAtual();
    if (!lista.itens.length) {
      mostrarToast({ tipo: "erro", titulo: "Nada para exportar", texto: "Esta tabela está vazia com os filtros atuais." });
      return;
    }
    baixarCSV("engagemend-contas.csv", paraCSV(CABECALHO_CSV, linhasParaCSV(lista.itens)));
  },

  "exportar-selecao"() {
    const { lista } = tabelaAtual();
    const escolhidas = lista.itens.filter((l) => telaUi.selecao.has(l.membro.id));
    if (!escolhidas.length) return;
    baixarCSV("engagemend-selecao.csv", paraCSV(CABECALHO_CSV, linhasParaCSV(escolhidas)));
  },

  "exportar-relatorio"() {
    const r = Rota.atual();
    const cfg = usarConfig().dado;
    const dias = periodoDaRota();
    const e = Query.usar(
      Query.chaveDe("relatorio", { c: r.comunidadeId, dias, cfg: assinaturaConfig(cfg) }),
      () => CLIENTE.relatorio({ comunidadeId: r.comunidadeId, config: cfg, dias }),
      { ativa: false }
    );
    if (!e.dado) {
      mostrarToast({ tipo: "erro", titulo: "Relatório ainda carregando", texto: "Espere o gráfico aparecer e tente de novo." });
      return;
    }
    const linhas = e.dado.serie.map((p) => [data(p.dia), p.eventos]);
    baixarCSV("engagemend-atividade-" + dias + "d.csv", paraCSV(["Dia", "Eventos"], linhas));
  },

  "restaurar-padrao"() {
    telaUi.rascunho = configPadrao();
    agendarPrevia();
    Render.sujar("conteudo");
  },

  "descartar-config"() {
    telaUi.rascunho = null;
    telaUi.previa = null;
    agendarPrevia();
    Render.sujar("conteudo");
  },

  "salvar-config"() {
    const proposta = normalizarConfig(telaUi.rascunho || configPadrao());
    CLIENTE.salvarConfiguracoes(proposta)
      .then((salva) => {
        /* Grava local só depois de o contrato aceitar. Gravar antes deixaria o
           navegador com uma config que o servidor recusou. */
        guardar(GUARDA_CONFIG, salva);
        Query.definir(CHAVE_CONFIG, salva);
        telaUi.rascunho = null;
        /* A pontuação de todo mundo mudou: nada que dependa dela continua
           válido. É a invalidação mais larga do painel, e é honesta. */
        Query.invalidar("ranking");
        Query.invalidar("resumo");
        Query.invalidar("relatorio");
        Query.invalidar("membro");
        Paginado.limpar();
        membrosDoFeed.clear();
        mostrarToast({ titulo: "Régua salva", texto: "Todo o histórico foi repontuado com os novos pesos." });
        Render.sujar();
      })
      .catch((erro) => {
        mostrarToast({ tipo: "erro", titulo: "Não conseguimos salvar", texto: explicarErro(erro).texto });
      });
  },

  "fechar-conexao"() { fecharConexao(); },
});

/* ═══ Delegação ═══════════════════════════════════════════════════════════════
   Um segundo par de ouvintes no documento, ao lado dos do shell. Não substitui
   os dele: os dois rodam, cada um trata o que conhece, e nenhum precisa saber
   dos seletores do outro. */

document.addEventListener("click", (e) => {
  const alvo = (s) => e.target.closest(s);

  /* A caixa de seleção fica dentro do botão da linha. Ela vem primeiro aqui,
     senão clicar na caixa abriria a gaveta junto. */
  const caixa = alvo("[data-selecionar]");
  if (caixa) {
    e.preventDefault();
    e.stopPropagation();
    const id = caixa.dataset.selecionar;
    if (telaUi.selecao.has(id)) telaUi.selecao.delete(id);
    else telaUi.selecao.add(id);
    Render.sujar("conteudo");
    return;
  }

  const abrir = alvo("[data-abrir-membro]");
  if (abrir) { e.preventDefault(); abrirMembro(abrir.dataset.abrirMembro); return; }
  if (alvo("[data-fechar-membro]")) { e.preventDefault(); fecharMembro(); return; }

  const tipo = alvo("[data-filtro-tipo]");
  if (tipo) {
    e.preventDefault();
    const atual = filtrosDoFeed().tipos;
    const id = tipo.dataset.filtroTipo;
    const proximos = atual.includes(id) ? atual.filter((x) => x !== id) : atual.concat(id);
    Paginado.resetar("feed:");
    membrosDoFeed.clear();
    Rota.filtrar({ tipo: proximos.join(",") || null });
    return;
  }

  const nivel = alvo("[data-filtro-nivel]");
  if (nivel) {
    e.preventDefault();
    const n = nivel.dataset.filtroNivel;
    const atual = Rota.atual().query.nivel;
    Paginado.resetar("feed:");
    Paginado.resetar("ranking:");
    membrosDoFeed.clear();
    Rota.filtrar({ nivel: String(atual) === n ? null : n });
    return;
  }

  const ativ = alvo("[data-filtro-atividade]");
  if (ativ) {
    e.preventDefault();
    const id = ativ.dataset.filtroAtividade;
    Paginado.resetar("ranking:");
    Rota.filtrar({ atividade: Rota.atual().query.atividade === id ? null : id });
    return;
  }

  const ordenar = alvo("[data-ordenar]");
  if (ordenar) {
    e.preventDefault();
    Paginado.resetar("ranking:");
    Rota.filtrar({ ordem: ordenar.dataset.ordenar, dir: ordenar.dataset.dir });
    return;
  }

  const periodo = alvo("[data-periodo]");
  if (periodo) { e.preventDefault(); Rota.filtrar({ dias: periodo.dataset.periodo }); return; }

  /* ── Paleta e busca ─────────────────────────────────────────────────────── */
  if (alvo("[data-fechar-paleta]")) { fecharPaleta(); return; }

  const itemPaleta = alvo("[data-paleta-item]");
  if (itemPaleta) {
    e.preventDefault();
    const it = itensDaPaleta[Number(itemPaleta.dataset.paletaItem)];
    fecharPaleta();
    if (it) it.executar();
    return;
  }

  const itemBusca = alvo("[data-busca-item]");
  if (itemBusca) {
    e.preventDefault();
    const it = itensDaBusca[Number(itemBusca.dataset.buscaItem)];
    ui.popover = null;
    ui.buscaTopo = "";
    if (it) Rota.ir(it.rota);
    Render.sujar();
    return;
  }

  /* ── Fluxo de conexão ───────────────────────────────────────────────────── */
  if (alvo("[data-fechar-conexao]")) { e.preventDefault(); fecharConexao(); return; }
  if (alvo("[data-voltar-conexao]")) {
    e.preventDefault();
    telaUi.conexao.passo = "plataforma";
    Render.agora("sobreposicoes");
    return;
  }

  const escolher = alvo("[data-escolher-plataforma]");
  if (escolher) {
    e.preventDefault();
    const p = getPlataforma(escolher.dataset.escolherPlataforma);
    telaUi.conexao.plataforma = p.id;
    telaUi.conexao.nome = "";
    telaUi.conexao.identificador = "";
    telaUi.conexao.passo = "permissoes";
    Render.agora("sobreposicoes");
    document.querySelector(p.id === "youtube" ? "[data-identificador-conexao]" : "[data-nome-conexao]")?.focus();
    return;
  }

  if (alvo("[data-autorizar-conexao]")) {
    e.preventDefault();
    const st = telaUi.conexao;
    if (st.plataforma === "discord") { CLIENTE.obterUrlConviteDiscord().then(({ url }) => { window.location.href = url; }); return; }
    st.passo = "autorizando";
    Render.agora("sobreposicoes");

    /* Os 2 s são a espera do redirect que não existe. Sem eles a tela de
       autorização passaria em branco e ninguém veria o estado. */
    setTimeout(() => {
      CLIENTE.conectar({ plataforma: st.plataforma, identificador: st.identificador.trim() })
        .then((comunidade) => {
          st.passo = "pronto";
          st.erro = null;
          st.comunidadeId = comunidade.id;
          Query.invalidar(CHAVE_COMUNIDADES);
          Render.sujar();
        })
        .catch((erro) => {
          st.passo = "pronto";
          st.erro = erro;
          Render.sujar("sobreposicoes");
        });
    }, 2000);
    return;
  }

  /* ── Painel de simulação ────────────────────────────────────────────────── */
  const sim = alvo("[data-sim-latencia],[data-sim-taxa],[data-sim-erro]," +
    "[data-sim-offline],[data-sim-vazio],[data-sim-ticker],[data-sim-rajada]," +
    "[data-sim-notificacao],[data-sim-expirar],[data-sim-pular]," +
    "[data-sim-reconstruir],[data-sim-testes],[data-fechar-sim]");
  if (sim) { e.preventDefault(); acaoDeSimulacao(sim); }
});

document.addEventListener("input", (e) => {
  /* ── Configurações ──────────────────────────────────────────────────────── */
  const peso = e.target.dataset.peso || e.target.dataset.pesoNum;
  const limiar = e.target.dataset.limiar || e.target.dataset.limiarNum;
  const porta = e.target.dataset.porta || e.target.dataset.portaNum;
  const meia = "meiaVida" in e.target.dataset || "meiaVidaNum" in e.target.dataset;

  if (peso || limiar || porta || meia) {
    const salva = usarConfig().dado;
    if (!salva) return;
    const r = rascunhoAtual(salva);
    const v = Number(e.target.value);
    const achar = (n) => r.limiares.find((l) => l.nivel === Number(n));

    if (peso) r.pesos[peso] = Math.max(0, Math.round(Number.isFinite(v) ? v : 0));
    if (limiar) {
      const l = achar(limiar);
      if (l) l.minScore = Math.max(1, Math.round(Number.isFinite(v) ? v : 1));
    }
    if (porta) {
      const l = achar(porta);
      if (l && l.porta) l.porta.min = Math.min(100, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
    }
    if (meia) r.meiaVidaDias = Math.min(365, Math.max(1, Math.round(Number.isFinite(v) ? v : MEIA_VIDA_PADRAO)));

    /* O par slider/número anda junto sem redesenhar a região: trocar o nó
       debaixo do dedo interromperia o arrasto no primeiro pixel. */
    espelharCampo(e.target, peso, limiar, porta, meia);
    agendarPrevia();
    return;
  }

  /* ── Busca da tabela ────────────────────────────────────────────────────── */
  if (e.target.matches("[data-busca-membros]")) {
    telaUi.buscaMembros = e.target.value;
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(() => {
      Paginado.resetar("ranking:");
      Rota.filtrar({ q: telaUi.buscaMembros.trim() || null });
      telaUi.buscaMembros = null;
    }, 320);
    return;
  }

  /* ── Paleta ─────────────────────────────────────────────────────────────── */
  if (e.target.matches("[data-paleta-campo]")) {
    telaUi.paleta.termo = e.target.value;
    telaUi.paleta.indice = 0;
    Render.sujar("sobreposicoes");
    return;
  }

  if (e.target.matches("[data-nome-conexao]")) {
    telaUi.conexao.nome = e.target.value;
    /* Só o botão muda de estado; redesenhar o modal tiraria o foco do campo. */
    const botao = document.querySelector("[data-autorizar-conexao]");
    if (botao) botao.disabled = !e.target.value.trim();
    return;
  }
  if (e.target.matches("[data-identificador-conexao]")) {
    telaUi.conexao.identificador = e.target.value;
    const botao = document.querySelector("[data-autorizar-conexao]");
    if (botao) botao.disabled = !e.target.value.trim();
    return;
  }
});

let temporizadorBusca = null;

/** Mantém slider e campo numérico do mesmo controle com o mesmo valor. */
function espelharCampo(origem, peso, limiar, porta, meia) {
  const par = peso
    ? `[data-peso="${peso}"],[data-peso-num="${peso}"]`
    : limiar
    ? `[data-limiar="${limiar}"],[data-limiar-num="${limiar}"]`
    : porta
    ? `[data-porta="${porta}"],[data-porta-num="${porta}"]`
    : "[data-meia-vida],[data-meia-vida-num]";
  for (const el of document.querySelectorAll(par)) {
    if (el !== origem) el.value = origem.value;
  }
  /* A dica do horizonte de esquecimento fica ao lado do slider de meia-vida e
     depende do valor — atualizada aqui pelo mesmo motivo. */
  if (meia) {
    const dica = document.querySelector('label[for="meia-vida"] .campo-dica');
    if (dica) {
      dica.textContent = "um evento some (vale menos de 1%) em ~" +
        horizonteDeEsquecimento(Number(origem.value)) + " dias";
    }
  }
}

document.addEventListener("keydown", (e) => {
  const cmd = e.ctrlKey || e.metaKey;

  if (cmd && !e.shiftKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    if (telaUi.paleta) fecharPaleta();
    else abrirPaleta();
    return;
  }

  if (cmd && e.shiftKey && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    if (!usandoMock()) return;
    telaUi.sim.aberto = !telaUi.sim.aberto;
    Render.sujar("sobreposicoes");
    return;
  }

  /* Navegação por setas: a mesma lógica serve à paleta e à busca da topbar,
     porque as duas são a mesma lista com fontes diferentes. */
  const naPaleta = Boolean(telaUi.paleta);
  const naBusca = ui.popover === "busca";
  if (!naPaleta && !naBusca) return;
  if (!["ArrowDown", "ArrowUp", "Enter", "Home", "End"].includes(e.key)) return;

  const itens = naPaleta ? itensDaPaleta : itensDaBusca;
  if (!itens.length) return;
  const indiceAtual = naPaleta ? telaUi.paleta.indice : telaUi.buscaIndice;

  let proximo = indiceAtual;
  if (e.key === "ArrowDown") proximo = (indiceAtual + 1) % itens.length;
  if (e.key === "ArrowUp") proximo = (indiceAtual - 1 + itens.length) % itens.length;
  if (e.key === "Home") proximo = 0;
  if (e.key === "End") proximo = itens.length - 1;

  if (e.key === "Enter") {
    e.preventDefault();
    const it = itens[indiceAtual];
    if (naPaleta) {
      fecharPaleta();
      if (it) it.executar();
    } else {
      ui.popover = null;
      ui.buscaTopo = "";
      if (it) Rota.ir(it.rota);
      Render.sujar();
    }
    return;
  }

  e.preventDefault();
  if (naPaleta) telaUi.paleta.indice = proximo;
  else telaUi.buscaIndice = proximo;
  Render.sujar("sobreposicoes");

  /* Rolar o item marcado pra dentro da vista — sem isto a seta desce e o
     destaque some abaixo da borda. */
  requestAnimationFrame(() => {
    document.querySelector('.paleta-item[data-ativo="true"]')?.scrollIntoView({ block: "nearest" });
  });
});

/* ── Ações do painel de simulação ────────────────────────────────────────────
   Separadas da delegação porque é o único ponto do arquivo que fala com o
   mundo falso, e concentrar isso num lugar deixa a fronteira visível a olho. */
function acaoDeSimulacao(botao) {
  const d = botao.dataset;
  const c = MOCK.controles;

  if ("fecharSim" in d) { telaUi.sim.aberto = false; Render.sujar("sobreposicoes"); return; }
  if (d.simLatencia) { c.definirLatencia(d.simLatencia); Render.sujar("sobreposicoes"); return; }
  if (d.simTaxa !== undefined && d.simTaxa !== "") { c.definirTaxaErro(Number(d.simTaxa)); Render.sujar("sobreposicoes"); return; }
  if (d.simErro) { c.definirFalha(d.simErro, false); Render.sujar("sobreposicoes"); return; }

  if ("simOffline" in d) {
    ui.offline = !ui.offline;
    Render.sujar("faixa-offline", "sobreposicoes");
    return;
  }
  if ("simVazio" in d) {
    c.definirVazio(!c.estado.vazio);
    Query.invalidar("");
    Paginado.limpar();
    membrosDoFeed.clear();
    Render.sujar();
    return;
  }
  if ("simTicker" in d) {
    if (c.tickerLigado()) c.desligarTicker();
    else c.ligarTicker(9000);
    Render.sujar("sobreposicoes");
    return;
  }
  if ("simRajada" in d) { c.rajada(3); Render.sujar("sobreposicoes"); return; }
  if ("simNotificacao" in d) {
    c.chegarNotificacao();
    Query.invalidar("notificacoes");
    return;
  }
  if ("simExpirar" in d) {
    const id = c.expirarPrimeiraConexao();
    Query.invalidar("");
    Paginado.limpar();
    membrosDoFeed.clear();
    Render.sujar();
    mostrarToast({ tipo: "erro", titulo: "Conexão expirada", texto: id ? "A comunidade " + id + " perdeu a autorização." : "Nenhuma comunidade conectada." });
    return;
  }
  if ("simPular" in d) {
    c.pularDias(30);
    Query.invalidar("");
    Paginado.limpar();
    membrosDoFeed.clear();
    telaUi.previa = null;
    Render.sujar();
    mostrarToast({ titulo: "Relógio 30 dias à frente", texto: "As pontuações caíram pelo decaimento. Ninguém ganhou evento novo." });
    return;
  }
  if ("simReconstruir" in d) {
    const campo = document.querySelector("[data-sim-semente]");
    c.reconstruir(campo ? campo.value.trim() : undefined);
    Query.limpar();
    Paginado.limpar();
    membrosDoFeed.clear();
    telaUi.selecao.clear();
    telaUi.topoConhecido = null;
    telaUi.novas = 0;
    telaUi.previa = null;
    Render.sujar();
    return;
  }
  if ("simTestes" in d) {
    telaUi.sim.rodando = true;
    Render.sujar("sobreposicoes");
    Testes.rodar().then((r) => {
      telaUi.sim.rodando = false;
      telaUi.sim.resultado = r;
      telaUi.topoConhecido = null;
      Render.sujar();
    });
  }
}

/* ═══ Arranque das telas ══════════════════════════════════════════════════════ */

/* Rolagem infinita. O sentinela é substituído a cada redesenho da região, então
   observar uma vez não bastaria: o observador é reapontado sempre que o
   conteúdo muda. É o preço de renderizar por `innerHTML`, e é barato. */
let observador = null;
let sentinelaAtual = null;

function observarSentinela() {
  const s = document.querySelector("[data-sentinela]");
  if (s === sentinelaAtual) return;
  if (observador) observador.disconnect();
  sentinelaAtual = s;
  if (!s || !observador) return;
  observador.observe(s);
}

/* O contador de novidades não assina evento do mock: ele relê a primeira página
   e compara ids com o topo que já estava na tela. É exatamente o que teria de
   fazer contra um backend real, onde ninguém oferece callback de mudança. */
function verificarNovidades() {
  const r = Rota.atual();
  if (r.tela !== "comunidade" || r.aba !== "atividade" || !r.comunidadeId) return;
  if (telaUi.topoConhecido === null) return;
  if (document.hidden) return;

  const cfg = usarConfig().dado;
  if (!cfg) return;
  const filtros = filtrosDoFeed();

  CLIENTE.listarEventos({
    comunidadeId: r.comunidadeId,
    tipos: filtros.tipos,
    nivel: filtros.nivel,
    config: cfg,
    limite: 25,
  })
    .then((p) => {
      const posicao = p.itens.findIndex((x) => x.id === telaUi.topoConhecido);
      /* Não achou o topo conhecido na primeira página: chegou mais coisa do que
         cabe nela. "25+" é honesto; um número inventado não seria. */
      const novas = posicao < 0 ? p.itens.length : posicao;
      if (novas !== telaUi.novas) {
        telaUi.novas = novas;
        Render.sujar("conteudo");
      }
    })
    .catch(() => { /* falhou a checagem de novidades: silêncio é o certo aqui */ });
}

function iniciarTelas() {
  /* Config guardada no navegador volta pro servidor, não pra tela: quem manda
     na pontuação é o contrato, e uma config que só existisse aqui faria a
     tabela e a prévia discordarem. */
  const guardada = ler(GUARDA_CONFIG);
  if (guardada) {
    CLIENTE.salvarConfiguracoes(normalizarConfig(guardada))
      .then((salva) => Query.definir(CHAVE_CONFIG, salva))
      .catch(() => { /* servidor recusou: fica valendo a config dele */ });
  }

  /* Comunidade ativa persistida. */
  Rota.assinar((r) => {
    if (r.comunidadeId) guardar(GUARDA_COMUNIDADE, r.comunidadeId);
    telaUi.selecao.clear();
    telaUi.novas = 0;
    telaUi.topoConhecido = null;
  });

  const principal = document.querySelector('[data-rolagem="principal"]');
  if (typeof IntersectionObserver === "function") {
    observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((x) => x.isIntersecting)) return;
        const { chave, lista, buscador } = feedAtual();
        if (lista.carregando || lista.fim) return;
        Paginado.carregarMais(chave, buscador).then(() => Render.sujar("conteudo"));
      },
      { root: principal, rootMargin: "240px" }
    );
  }

  /* Reapontar o sentinela e reagir à rolagem da tabela virtualizada, sempre
     depois de o conteúdo mudar. */
  const regiao = document.querySelector('[data-regiao="conteudo"]');
  if (regiao && typeof MutationObserver === "function") {
    new MutationObserver(() => observarSentinela()).observe(regiao, { childList: true, subtree: true });
  }

  document.addEventListener(
    "scroll",
    (e) => {
      const alvo = e.target;
      if (alvo && alvo.dataset && alvo.dataset.rolagem === "tabela") {
        const { lista } = tabelaAtual();
        if (lista.itens.length > LIMITE_VIRTUAL) Render.sujar("conteudo");
      }
    },
    true
  );

  setInterval(verificarNovidades, 9000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarNovidades(); });

  iniciarMundoVivo();
}

/* O mundo do mock continua acontecendo sozinho — é o que dá o que mostrar à
   pílula de novidades e ao stale-while-revalidate. Com backend real quem produz
   evento é o backend, e esta função simplesmente não faz nada. */
function iniciarMundoVivo() {
  if (!usandoMock()) return;
  MOCK.controles.ligarTicker(9000);
}
