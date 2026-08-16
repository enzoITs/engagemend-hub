
/* ── §7 · Régua de Engajamento ────────────────────────────────────────────────
   **Port de `src/classifier/` do repositório `engagemend-discord`.**

   Este arquivo não tem opinião própria. Cada função abaixo tem uma equivalente
   no bot, anotada no comentário, e existe para dar o mesmo resultado. Quando os
   dois discordarem, quem está errado é este arquivo.

   O motivo de portar em vez de reinventar: duas implementações da mesma regra
   de negócio divergem — não hoje, mas no dia em que alguém recalibrar um peso
   de um lado só. E a divergência é silenciosa: nada quebra, os números só
   passam a discordar, e a descoberta acontece numa reunião. §11 roda os testes
   do próprio bot em cima daqui para que isso quebre alto e cedo.

   O modelo tem cinco peças:

     decaimento  cada evento vale `peso` no dia em que acontece e metade disso a
                 cada `meiaVidaDias` (14). Exponencial, não degrau.
     janela      evento com mais de 60 dias sai da pontuação. Continua no
                 histórico e no vitalício, mas não pontua.
     tetos       por membro, por tipo, por dia UTC. Sem isso, spam de reação
                 vira Embaixador.
     eixos       quatro somas paralelas (consumo, produção, reciprocidade,
                 influência), normalizadas 0–100 pelo p90 da comunidade.
     limiares    pontuação **e** porta de eixo. Pontuação sozinha não promove.

   Tudo puro: `agora` entra por parâmetro, nunca `Date.now()` por dentro. É o
   que torna o recálculo reproduzível e a prévia ao vivo testável.
   ───────────────────────────────────────────────────────────────────────── */

/** bot: `ageInDays` */
function idadeEmDias(ocorridoEm, agora) {
  return (agora.getTime() - new Date(ocorridoEm).getTime()) / DIA_MS;
}

/**
 * bot: `effectiveWeight` — `peso * 0.5 ^ (dias / meia-vida)`.
 * Evento no futuro não ganha bônus: idade negativa vira zero.
 * @param {number} dias
 * @param {number} meiaVidaDias
 * @returns {number} fator entre 0 e 1
 */
function fatorDecaimento(dias, meiaVidaDias) {
  if (!(meiaVidaDias > 0)) return 0;
  const idade = Math.max(0, dias);
  return Math.pow(0.5, idade / meiaVidaDias);
}

/** bot: `isWithinScoreWindow` */
function dentroDaJanela(dias, janelaDias) {
  return dias <= (janelaDias === undefined ? JANELA_PONTUACAO_DIAS : janelaDias);
}

/**
 * bot: `qualityMultiplierOf`. Multiplicador de qualidade (0–1, ex:
 * `quality_score` do Groq no YouTube) — ausente/inválido cai pro default 1.0,
 * então evento Discord não muda em nada. Comentário `spam_irrelevante` entra
 * com 0: fica no histórico (append-only) mas não pontua.
 */
function qualidadeDe(ev) {
  const bruto = ev && ev.metadata && ev.metadata.qualityMultiplier;
  return typeof bruto === "number" && isFinite(bruto) ? bruto : 1;
}

/** bot: `utcDayKey`. UTC, não fuso local — fuso do servidor não pode mudar o resultado. */
function chaveDoDiaUTC(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * bot: `applyDailyCaps`. Por membro, por tipo, por dia UTC, sobram os N
 * primeiros em ordem cronológica. Determinístico: mesma entrada, mesmo corte.
 *
 * Vale para a janela curta e para o vitalício — um teto que só protege 60 dias
 * deixa o histórico inflado pelo mesmo spam.
 */
function aplicarTetosDiarios(eventos, tetos) {
  const limites = tetos || TETOS_DIARIOS;
  const ordenados = eventos.slice().sort((a, b) =>
    new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime());
  const usados = new Map();
  const mantidos = [];

  for (const ev of ordenados) {
    const teto = limites[ev.tipo];
    if (teto === undefined) { mantidos.push(ev); continue; }

    const chave = ev.tipo + ":" + chaveDoDiaUTC(ev.ocorridoEm);
    const usado = usados.get(chave) || 0;
    if (usado >= teto) continue;

    usados.set(chave, usado + 1);
    mantidos.push(ev);
  }
  return mantidos;
}

/* ── Eixos ────────────────────────────────────────────────────────────────── */

/** bot: `emptyAxes` */
function eixosZerados() {
  const z = {};
  for (const id of EIXOS_IDS) z[id] = 0;
  return z;
}

/**
 * Produto escalar entre as somas decaídas e os pesos. É o `score30d` do bot.
 *
 * Escrito assim de propósito: a soma de dentro (o decaimento acumulado por
 * tipo) não depende de peso nenhum. §4 pré-computa essas somas por (membro,
 * tipo), então mexer num peso custa catorze multiplicações por membro, não uma
 * varredura de vinte mil eventos. É o que torna a prévia ao vivo instantânea —
 * e continua valendo com os eixos, porque eixo também é produto escalar sobre
 * as mesmas somas.
 */
function pontuacaoDe(somas, pesos) {
  if (!somas) return 0;
  let total = 0;
  for (const tipo of TIPOS_IDS) {
    const s = somas[tipo];
    const p = pesos[tipo];
    if (s && p) total += s * p;
  }
  return total;
}

/** As quatro somas cruas por eixo, do mesmo pré-computado. bot: `aggregateMember`. */
function eixosDe(somas, pesos) {
  const eixos = eixosZerados();
  if (!somas) return eixos;
  for (const t of TIPOS_EVENTO) {
    const s = somas[t.id];
    const p = pesos[t.id];
    if (s && p) eixos[t.eixo] += s * p;
  }
  return eixos;
}

/**
 * bot: `percentile`. Rank mais próximo sobre a lista ordenada —
 * `percentil([1..10], 0.9)` devolve 9.
 */
function percentil(valores, fracao) {
  if (!valores.length) return 0;
  const ordenado = valores.slice().sort((a, b) => a - b);
  const rank = Math.ceil(fracao * ordenado.length);
  const i = Math.min(ordenado.length - 1, Math.max(0, rank - 1));
  return ordenado[i] || 0;
}

/**
 * bot: `axisReferences`. O p90 de cada eixo na comunidade.
 *
 * Quem tem zero num eixo entra na conta — é parte da comunidade, e tirá-lo
 * inflaria a régua. E é p90, não máximo: um outlier achataria todo mundo atrás
 * dele.
 */
function referenciasDeEixo(listaDeEixos, fracao) {
  const ref = eixosZerados();
  const f = fracao === undefined ? PERCENTIL_EIXO : fracao;
  for (const eixo of EIXOS_IDS) {
    ref[eixo] = percentil(listaDeEixos.map((e) => e[eixo] || 0), f);
  }
  return ref;
}

/** bot: `normalizeAxes`. 0–100, saturando em 100 acima do p90. */
function normalizarEixos(cru, referencia) {
  const saida = eixosZerados();
  for (const eixo of EIXOS_IDS) {
    const ref = referencia[eixo];
    saida[eixo] = ref > 0 ? Math.min(100, (cru[eixo] / ref) * 100) : 0;
  }
  return saida;
}

/* ── Nível ────────────────────────────────────────────────────────────────── */

/**
 * bot: `naturalLevel`. O nível que pontuação e eixos implicam hoje, ignorando
 * histerese. Avaliado de cima para baixo; o primeiro que casar vence.
 *
 * @param {number} pontuacao
 * @param {Record<string, number>} eixos  já normalizados 0–100
 * @param {Array} limiares
 * @returns {1|2|3|4|5}
 */
function nivelNatural(pontuacao, eixos, limiares) {
  const ls = limiares || LIMIARES_PADRAO;
  const e = eixos || eixosZerados();
  for (const l of ls) {
    if (pontuacao < l.minScore) continue;
    if (l.porta && (e[l.porta.eixo] || 0) < l.porta.min) continue;
    return l.nivel;
  }
  return 1;
}

/**
 * bot: `decideLevel`. A histerese.
 *
 * Promoção é imediata — subir é sinal, não ruído. Rebaixar exige o nível
 * natural abaixo do atual por `HISTERESE_DIAS` dias seguidos; sem isso o membro
 * oscila toda semana e a série vira serrilhado inútil.
 */
function decidirNivel(entrada) {
  const natural = entrada.natural;
  const atual = entrada.atual;
  const recentes = entrada.recentes || [];
  const recomputoTotal = Boolean(entrada.recomputoTotal);

  if (atual === null || atual === undefined) {
    return { nivel: natural, mudou: true, motivo: "initial", rebaixamentoSegurado: false };
  }
  if (natural === atual) {
    return { nivel: atual, mudou: false, motivo: null, rebaixamentoSegurado: false };
  }
  /* Pesos mudaram: o nível anterior não é base de comparação válida. */
  if (recomputoTotal) {
    return { nivel: natural, mudou: true, motivo: "recompute", rebaixamentoSegurado: false };
  }
  if (natural > atual) {
    return { nivel: natural, mudou: true, motivo: "promotion", rebaixamentoSegurado: false };
  }

  const historicoSuficiente = recentes.length >= HISTERESE_DIAS;
  const abaixoOTempoTodo = recentes.every((n) => n < atual);

  if (historicoSuficiente && abaixoOTempoTodo) {
    return { nivel: natural, mudou: true, motivo: "demotion", rebaixamentoSegurado: false };
  }
  return { nivel: atual, mudou: false, motivo: null, rebaixamentoSegurado: true };
}

const nomeDoNivel = (n) => NIVEIS[n].nome;

/**
 * O que falta para o próximo nível — em pontos **e** em eixo.
 *
 * O painel antigo só sabia responder "faltam 40 pontos", e com porta de eixo
 * essa resposta vira meia-verdade: dá pra ter pontuação de sobra e não subir.
 * A gaveta do membro mostra as duas coisas, e é a diferença entre "continue
 * assim" e "você precisa que os outros respondam".
 */
function progressoDeNivel(pontuacao, eixos, limiares) {
  const ls = limiares || LIMIARES_PADRAO;
  const e = eixos || eixosZerados();
  const nivel = nivelNatural(pontuacao, e, ls);
  if (nivel === 5) {
    return { nivel, proximo: null, faltaPontos: 0, faltaEixo: null, progresso: 1 };
  }

  const alvo = ls.find((l) => l.nivel === nivel + 1);
  if (!alvo) return { nivel, proximo: null, faltaPontos: 0, faltaEixo: null, progresso: 1 };

  const piso = (ls.find((l) => l.nivel === nivel) || { minScore: 0 }).minScore;
  const pisoReal = Number.isFinite(piso) ? piso : 0;
  const vao = alvo.minScore - pisoReal;
  const progresso = vao > 0 ? Math.min(1, Math.max(0, (pontuacao - pisoReal) / vao)) : 0;

  let faltaEixo = null;
  if (alvo.porta) {
    const tem = e[alvo.porta.eixo] || 0;
    if (tem < alvo.porta.min) {
      faltaEixo = {
        eixo: alvo.porta.eixo,
        rotulo: (getEixo(alvo.porta.eixo) || {}).rotulo || alvo.porta.eixo,
        tem: Math.round(tem * 10) / 10,
        min: alvo.porta.min,
      };
    }
  }

  return {
    nivel,
    proximo: nivel + 1,
    faltaPontos: Math.max(0, Math.round((alvo.minScore - pontuacao) * 10) / 10),
    faltaEixo,
    progresso,
  };
}

/* ── Normalização da config ───────────────────────────────────────────────── */

/** Pesos: inteiros, não negativos, e só dos catorze tipos que o bot conhece. */
function normalizarPesos(pesos) {
  const saida = {};
  for (const tipo of TIPOS_IDS) {
    const v = Number(pesos && pesos[tipo]);
    saida[tipo] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }
  return saida;
}

/**
 * Limiares precisam ser estritamente decrescentes em pontuação, de 5 para 1: um
 * nível 4 que começasse acima do 5 tornaria `nivelNatural` indefinido. A tela
 * deixa arrastar livremente e passa o resultado por aqui, então o empurrão é
 * sempre pra baixo e o usuário nunca vê estado inválido.
 */
function normalizarLimiares(limiares) {
  const base = (limiares && limiares.length ? limiares : LIMIARES_PADRAO)
    .slice()
    .sort((a, b) => b.nivel - a.nivel);

  const saida = [];
  let teto = Infinity;
  for (const l of base) {
    if (l.nivel === 1) { saida.push({ nivel: 1, minScore: -Infinity, porta: null }); continue; }
    const v = Math.min(teto - 1, Math.max(0, Math.round(Number(l.minScore) || 0)));
    let porta = null;
    if (l.porta && EIXOS_IDS.includes(l.porta.eixo)) {
      porta = {
        eixo: l.porta.eixo,
        min: Math.min(100, Math.max(0, Math.round(Number(l.porta.min) || 0))),
      };
    }
    saida.push({ nivel: l.nivel, minScore: v, porta });
    teto = v;
  }
  return saida;
}

/** Config inteira validada de uma vez. É o que a tela salva. */
function normalizarConfig(config) {
  const meia = Number(config && config.meiaVidaDias);
  const janela = Number(config && config.janelaDias);
  return {
    versaoPesos: (config && config.versaoPesos) || VERSAO_PESOS,
    pesos: normalizarPesos(config && config.pesos),
    meiaVidaDias: Number.isFinite(meia) ? Math.min(365, Math.max(1, Math.round(meia))) : MEIA_VIDA_PADRAO,
    janelaDias: Number.isFinite(janela) ? Math.min(730, Math.max(1, Math.round(janela))) : JANELA_PONTUACAO_DIAS,
    limiares: normalizarLimiares(config && config.limiares),
  };
}

const configPadrao = () => normalizarConfig({
  versaoPesos: VERSAO_PESOS,
  pesos: PESOS_PADRAO,
  meiaVidaDias: MEIA_VIDA_PADRAO,
  janelaDias: JANELA_PONTUACAO_DIAS,
  limiares: LIMIARES_PADRAO,
});

/** Duas configs são a mesma? Habilita/desabilita "Restaurar padrão" e "Salvar". */
function configIgual(a, b) {
  if (!a || !b) return false;
  if (a.meiaVidaDias !== b.meiaVidaDias) return false;
  if (a.janelaDias !== b.janelaDias) return false;
  for (const t of TIPOS_IDS) if (a.pesos[t] !== b.pesos[t]) return false;

  const la = normalizarLimiares(a.limiares);
  const lb = normalizarLimiares(b.limiares);
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) {
    if (la[i].nivel !== lb[i].nivel) return false;
    if (la[i].minScore !== lb[i].minScore) return false;
    const pa = la[i].porta, pb = lb[i].porta;
    if (Boolean(pa) !== Boolean(pb)) return false;
    if (pa && (pa.eixo !== pb.eixo || pa.min !== pb.min)) return false;
  }
  return true;
}

/**
 * Quantos dias até um evento isolado deixar de importar — "importar" definido
 * como valer menos de 1% do original. Fica ao lado do campo de meia-vida
 * porque "14 dias de meia-vida" não diz nada a quem nunca pensou em decaimento
 * exponencial, mas "some em ~93 dias" diz.
 *
 * Na prática a janela de 60 dias corta antes; a tela mostra os dois números
 * justamente para essa comparação ficar visível.
 */
function horizonteDeEsquecimento(meiaVidaDias) {
  if (!(meiaVidaDias > 0)) return 0;
  return Math.round(meiaVidaDias * Math.log2(100));
}
