
/* ── §4 · Mock: PRNG, mundo, latência, adaptador ──────────────────────────────
   Tudo o que é falso mora aqui dentro. A IIFE devolve dois objetos: `adaptador`
   — o que o CLIENTE (§6) consome — e `sim`, que só o painel de simulação toca.
   O `mundo` em si nunca sai daqui. Nenhuma tela consegue alcançá-lo, e é
   exatamente isso que torna a troca por um backend real uma mudança de uma
   linha em vez de uma caçada.

   Ordem de avaliação: este bloco roda antes de §7 (régua) no arquivo montado.
   Declarações `function` sobem, `const` não. Por isso o mundo é construído sob
   demanda (`garantirMundo`), no primeiro método chamado — nunca no corpo da
   IIFE. Quando o primeiro método roda, o arquivo inteiro já foi avaliado e a
   régua existe.

   Deste bloco, §7 precisa fornecer (chamadas sempre tardias):
     fatorDecaimento(dias, meiaVidaDias) → number
     pontuacaoDe(somasPorTipo, pesos)    → number
     nivelNatural(pontuacao, eixos, ls)  → 1..5
   ───────────────────────────────────────────────────────────────────────── */

const MOCK = (() => {
  "use strict";

  /* ── PRNG ──────────────────────────────────────────────────────────────
     mulberry32: determinístico, rápido, e bom o bastante para dado falso.
     Mesma semente, mesmo mundo — é o que deixa um bug reproduzível e o
     campo de semente do painel de simulação valer alguma coisa. */
  function prngDe(semente) {
    let a = semente >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sementeDe(texto) {
    let h = 2166136261 >>> 0;
    const s = String(texto);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* Açúcar sobre o gerador. `r` é sempre o prng corrente. */
  const inteiro = (r, min, max) => min + Math.floor(r() * (max - min + 1));
  const entre = (r, min, max) => min + r() * (max - min);
  const escolher = (r, lista) => lista[Math.floor(r() * lista.length)];
  const chance = (r, p) => r() < p;
  function pesado(r, pares) {
    /* pares: [[valor, peso], …] — sorteio proporcional ao peso. */
    let total = 0;
    for (const [, p] of pares) total += p;
    let n = r() * total;
    for (const [v, p] of pares) {
      n -= p;
      if (n <= 0) return v;
    }
    return pares[pares.length - 1][0];
  }

  /* ── Vocabulário ───────────────────────────────────────────────────────
     Nomes brasileiros porque o produto é brasileiro e nome falso em inglês
     denuncia protótipo na hora. */
  const PRIMEIROS = [
    "Ana", "Beatriz", "Bruno", "Camila", "Carla", "Daniel", "Diego", "Eduardo",
    "Fernanda", "Felipe", "Gabriel", "Gustavo", "Helena", "Igor", "Isabela",
    "João", "Juliana", "Larissa", "Leonardo", "Lucas", "Mariana", "Matheus",
    "Nathalia", "Otávio", "Paula", "Pedro", "Rafael", "Renata", "Rodrigo",
    "Sofia", "Thiago", "Vanessa", "Vinícius", "Yuri", "Clara", "Murilo",
    "Letícia", "Caio", "Bianca", "Henrique", "Aline", "Douglas", "Priscila",
  ];
  const ULTIMOS = [
    "Almeida", "Barbosa", "Cardoso", "Carvalho", "Costa", "Dias", "Duarte",
    "Ferreira", "Fernandes", "Gomes", "Lima", "Lopes", "Machado", "Martins",
    "Melo", "Mendes", "Moraes", "Nunes", "Oliveira", "Pereira", "Pinto",
    "Ramos", "Ribeiro", "Rocha", "Rodrigues", "Santos", "Silva", "Souza",
    "Teixeira", "Vieira", "Azevedo", "Cavalcanti", "Moreira", "Freitas",
  ];

  /* Comunidades por plataforma. `x` e `whatsapp` entram como indisponíveis:
     existem na conta, aparecem na lista, mas nunca recebem evento novo. */
  const SEMENTES_COMUNIDADE = [
    { plataforma: "youtube",   nome: "Canal Marcenaria Fina",     membros: 18400 },
    { plataforma: "youtube",   nome: "Oficina do Código",          membros: 7250 },
    { plataforma: "discord",   nome: "Servidor da Comunidade",     membros: 3120 },
    { plataforma: "discord",   nome: "Suporte & Bugs",             membros: 860 },
    { plataforma: "instagram", nome: "@marcenariafina",            membros: 12800 },
    { plataforma: "reddit",    nome: "r/marcenariabrasil",         membros: 5400 },
    { plataforma: "whatsapp",  nome: "Alunos — Turma 12",          membros: 210 },
    { plataforma: "x",         nome: "@engagemend",                membros: 1940 },
  ];

  const CANAIS = ["geral", "dúvidas", "projetos", "mostre-seu-trampo", "off-topic", "anúncios"];
  const TITULOS = [
    "Como afiar formão sem pedra d'água",
    "Rabo de andorinha em 12 minutos",
    "Escolhendo madeira no depósito",
    "Bancada dobrável pra apartamento",
    "Erros que todo iniciante comete",
    "Acabamento com goma-laca",
    "Montando um cavalete de serra",
    "Guia de brocas: o que comprar primeiro",
  ];

  /* Perfis de atividade. É daqui que sai a variedade da tabela: sem isso todo
     mundo pontua igual e a Régua não mostra nada. `recencia` inclina os
     eventos para o presente (1) ou para o passado (0) — é o que fabrica quem
     está subindo e quem sumiu.

     Os volumes são calibrados contra `LIMIARES_PADRAO` do bot: meia-vida de 14
     dias, janela de 60, piso do nível 5 em 80 pontos. A conta de guardanapo é
     `pontuação ≈ eventos/dia × meiaVida/ln2 × peso médio` — para um `lider`,
     ≈ 1,9 × 20,2 × 4 ≈ 150, bem acima de 80.

     Mas pontuação sozinha não promove mais: acima do nível 3 existe porta de
     eixo, e o eixo de influência só enche com evento **recebido**. Por isso a
     mistura abaixo dá recebidos a quem deve subir e quase nenhum a quem não
     deve — sem isso todo mundo trava no nível 2 e a pirâmide some.

     Depois de mexer aqui, conferir a distribuição: ela tem de ficar em
     pirâmide, com o nível 5 na casa de 3–6%. */
  const PERFIS = [
    { id: "lider",    porDia: 0.60, recencia: 0.64, peso: 4 },
    { id: "ativo",    porDia: 0.25, recencia: 0.58, peso: 12 },
    { id: "regular",  porDia: 0.08, recencia: 0.52, peso: 26 },
    { id: "ocasional",porDia: 0.02, recencia: 0.48, peso: 30 },
    { id: "novato",   porDia: 0.10, recencia: 0.78, peso: 12 },
    { id: "sumido",   porDia: 0.05, recencia: 0.16, peso: 16 },
  ];

  /* Mistura dos catorze tipos por perfil.
     Quem lidera produz **e recebe**; quem é ocasional reage e ninguém repara. */
  const MISTURA = {
    lider: [
      ["message_sent", 20], ["reply_given", 14], ["reaction_given", 9],
      ["reaction_received", 13], ["reply_received", 8], ["mention_received", 5],
      ["thread_replied", 6], ["message_substantial", 5], ["thread_started", 4],
      ["media_posted", 4], ["newcomer_welcomed", 4], ["voice_minutes", 4],
      ["forum_solution", 2], ["invite_used", 2],
    ],
    ativo: [
      ["message_sent", 26], ["reaction_given", 16], ["reply_given", 12],
      ["reaction_received", 10], ["reply_received", 5], ["mention_received", 4],
      ["thread_replied", 6], ["message_substantial", 5], ["thread_started", 3],
      ["media_posted", 3], ["newcomer_welcomed", 3], ["voice_minutes", 5],
      ["forum_solution", 1], ["invite_used", 1],
    ],
    regular: [
      ["reaction_given", 32], ["message_sent", 28], ["reply_given", 10],
      ["voice_minutes", 8], ["reaction_received", 6], ["thread_replied", 5],
      ["message_substantial", 3], ["reply_received", 3], ["mention_received", 3],
      ["media_posted", 2],
    ],
    ocasional: [
      ["reaction_given", 58], ["message_sent", 22], ["voice_minutes", 9],
      ["reply_given", 5], ["reaction_received", 3], ["mention_received", 3],
    ],
    novato: [
      ["reaction_given", 38], ["message_sent", 28], ["reply_given", 10],
      ["voice_minutes", 10], ["reaction_received", 7], ["mention_received", 4],
      ["reply_received", 3],
    ],
    sumido: [
      ["reaction_given", 42], ["message_sent", 32], ["reply_given", 12],
      ["voice_minutes", 6], ["reaction_received", 5], ["mention_received", 3],
    ],
  };

  const JANELA_DIAS = 180;   /* fundo de histórico que o mundo carrega */
  const JANELA_TENDENCIA = 30; /* comparação "agora" × "30 dias atrás" */

  /* ── Estado do mundo ───────────────────────────────────────────────────── */
  let mundo = null;
  let sementeAtual = "engagemend";

  /* Init em duas fases, e a ordem importa: `gerarNotificacoes` pontua membros,
     pontuar chama `somasDe`, e `somasDe` chama `garantirMundo`. Se as
     notificações nascessem dentro de `construirMundo`, essa chamada veria
     `mundo` ainda nulo e reentraria na construção — recursão infinita no
     primeiro carregamento. Publicar o mundo antes de derivar delas resolve. */
  function garantirMundo() {
    if (!mundo) {
      mundo = construirMundo(sementeAtual);
      mundo.notificacoes = gerarNotificacoes(prngDe(sementeDe(mundo.semente + ":notif")), mundo);
    }
    return mundo;
  }

  function construirMundo(semente) {
    const r = prngDe(sementeDe(semente));
    /* `agora` congela no build. Um relógio vivo faria "há 3 min" virar
       "há 4 min" no meio de um teste e quebrar a comparação. */
    const agora = new Date();
    agora.setSeconds(0, 0);
    const agoraMs = agora.getTime();
    const tetoHistorico = agoraMs - 60000;   /* ver `criarEvento` */

    const comunidades = [];
    const membros = [];
    const eventos = [];
    const notificacoes = [];

    for (const sc of SEMENTES_COMUNIDADE) {
      const indisponivel = Boolean(INDISPONIVEIS[sc.plataforma]);
      const id = "c_" + sc.plataforma + "_" + comunidades.length;
      const estadoSync = indisponivel
        ? "indisponivel"
        : pesado(r, [["conectada", 70], ["sincronizando", 8], ["desatualizada", 12], ["token_expirado", 6], ["erro", 4]]);

      const comunidade = {
        id,
        plataforma: sc.plataforma,
        nome: sc.nome,
        iniciais: iniciaisDe(sc.nome),
        membros: sc.membros,
        online: indisponivel ? 0 : Math.round(sc.membros * entre(r, 0.008, 0.045)),
        estadoSync,
        sincronizadaEm: indisponivel
          ? null
          : new Date(agoraMs - inteiro(r, 2, estadoSync === "desatualizada" ? 4200 : 90) * 60000).toISOString(),
      };
      comunidades.push(comunidade);

      /* Quantos membros a comunidade materializa. Não é o total real: é a
         amostra que a EngageMend conseguiu ler. A tabela diz isso na cara. */
      const quantos = indisponivel ? 0 : Math.min(700, Math.max(420, Math.round(sc.membros * 0.06)));

      for (let i = 0; i < quantos; i++) {
        const primeiro = escolher(r, PRIMEIROS);
        const ultimo = escolher(r, ULTIMOS);
        const nome = primeiro + " " + ultimo;
        const perfil = pesado(r, PERFIS.map((p) => [p, p.peso]));

        const diasDesdeEntrada = perfil.id === "novato"
          ? inteiro(r, 3, 45)
          : inteiro(r, 46, JANELA_DIAS + 400);
        const entrouEmMs = agoraMs - diasDesdeEntrada * DIA_MS;

        const membro = {
          id: id + "_m" + i,
          comunidadeId: id,
          plataforma: sc.plataforma,
          nome,
          arroba: "@" + primeiro.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") +
                  ultimo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3) +
                  (chance(r, 0.35) ? String(inteiro(r, 2, 99)) : ""),
          iniciais: iniciaisDe(nome),
          entrouEm: new Date(entrouEmMs).toISOString(),
        };
        membros.push(membro);

        /* Eventos. A janela efetiva é o menor entre o histórico do mundo e o
           tempo de casa do membro — ninguém tem evento antes de entrar. */
        const janela = Math.min(JANELA_DIAS, diasDesdeEntrada);
        /* Dispersão **multiplicativa**, não aditiva: e^U(−1.1, 1.1) espalha de
           ×0,33 a ×3,0 em torno da taxa do perfil.

           O ±45% uniforme que estava aqui não atravessava o vão entre perfis
           (0,60 → 0,25 → 0,08), e o resultado era uma distribuição em degraus:
           todo `lider` caía no mesmo nível, e o nível 4 ficava vazio entre dois
           montes. Atividade humana é log-normal, não uniforme — com a dispersão
           certa os perfis se sobrepõem e a pirâmide aparece sozinha. */
        const dispersao = Math.exp(entre(r, -1.1, 1.1));
        const quantosEventos = Math.max(1, Math.round(janela * perfil.porDia * dispersao));
        const mistura = MISTURA[perfil.id];

        /* O evento de entrada é real e conta: é o que dá o "Entrou" no feed. */
        if (diasDesdeEntrada <= JANELA_DIAS) {
          /* O coletor não emite evento de entrada: a data de entrada vive em
             `member_identity.joinedAt`, e é de lá que a gaveta a lê. */
        }
        if (perfil.id !== "novato" && chance(r, 0.06)) {
          /* Convite usado só existe pra quem trouxe alguém de fora. */
          eventos.push(criarEvento(r, membro, "invite_used", entrouEmMs + inteiro(r, 0, 2) * DIA_MS, tetoHistorico));
        }

        /* Inclinação da distribuição no tempo. `diasAtras = janela · u^k` com u
           uniforme: k > 1 amontoa perto de 0 (eventos recentes), k < 1 amontoa
           perto da janela (eventos velhos), k = 1 é uniforme.

           k = recencia/(1−recencia) dá essa monotonicidade numa expressão só —
           recencia 0,5 → k=1, 0,88 → k≈7,3 (novato, quase tudo recente),
           0,12 → k≈0,14 (sumido, quase tudo velho). */
        const k = perfil.recencia >= 0.99 ? 99 : perfil.recencia / (1 - perfil.recencia);

        for (let e = 0; e < quantosEventos; e++) {
          /* Piso de idade: `r()^k` com k > 1 amontoa muita coisa em ~zero, e o
             corte por `tetoHistorico` empilhava tudo isso no mesmo instante —
             o topo do feed virava uma coluna de "há 1 min" repetido, que é a
             cara de dado falso. O piso sorteado entre 10 e 29 minutos espalha
             a ponta recente sem mexer no resto da distribuição. */
          const diasAtras = Math.max(Math.pow(r(), k) * janela, entre(r, 0.007, 0.02));
          const quando = agoraMs - diasAtras * DIA_MS;
          if (quando < entrouEmMs) continue;
          eventos.push(criarEvento(r, membro, pesado(r, mistura), quando, tetoHistorico));
        }

        /* O coletor do Discord não emite evento de saída — quem sai some do
           `guildMemberAdd` e pronto. O painel antigo tinha `entrou`/`saiu` e o
           bot não tem; quem manda é o bot. A queda de nível de quem sumiu passa
           a ser explicada pelo decaimento, que é como acontece de verdade. */
      }
    }

    eventos.sort((a, b) => (a.ocorridoEm < b.ocorridoEm ? 1 : a.ocorridoEm > b.ocorridoEm ? -1 : 0));

    /* Índices. Sem eles, cada rolagem do feed varre 20 mil eventos. */
    const eventosPorComunidade = new Map();
    const eventosPorMembro = new Map();
    for (const ev of eventos) {
      if (!eventosPorComunidade.has(ev.comunidadeId)) eventosPorComunidade.set(ev.comunidadeId, []);
      eventosPorComunidade.get(ev.comunidadeId).push(ev);
      if (!eventosPorMembro.has(ev.membroId)) eventosPorMembro.set(ev.membroId, []);
      eventosPorMembro.get(ev.membroId).push(ev);
    }
    const membrosPorComunidade = new Map();
    for (const m of membros) {
      if (!membrosPorComunidade.has(m.comunidadeId)) membrosPorComunidade.set(m.comunidadeId, []);
      membrosPorComunidade.get(m.comunidadeId).push(m);
    }
    /* Dois mapas, não um. Comunidade e membro compartilhavam índice numa
       versão anterior e "isto é comunidade?" virava adivinhação por formato
       do objeto. Separado, `acharComunidade` não pode devolver um membro. */
    const comunidadesPorId = new Map();
    for (const c of comunidades) comunidadesPorId.set(c.id, c);
    const membrosPorId = new Map();
    for (const mb of membros) membrosPorId.set(mb.id, mb);

    const m = {
      semente, agora, agoraMs,
      comunidades, membros, eventos, notificacoes,
      eventosPorComunidade, eventosPorMembro, membrosPorComunidade,
      comunidadesPorId, membrosPorId,
      cacheSomas: new Map(),
      /* Memoização separada, e não um campo dentro de `cacheSomas`: a referência
         de eixo depende dos **pesos** além da meia-vida, e as somas não. Juntar
         os dois faria toda mudança de peso jogar fora a parte cara. */
      cacheRefs: new Map(),
      config: configPadrao(),
    };

    /* Notificações derivam de pontuação, que precisa do mundo publicado.
       Quem as gera é `garantirMundo`, depois desta função retornar. */
    return m;
  }

  /* `tetoMs` é o instante mais recente que este evento pode ter. Na construção
     do mundo ele é `agora − 1min`, pra nenhum evento histórico nascer dizendo
     "agora" no feed; no ticker é o próprio `agora`, porque aí é justamente
     isso que se quer. */
  function criarEvento(r, membro, tipo, quandoMs, tetoMs) {
    const quando = Math.min(quandoMs, tetoMs);
    return {
      id: "e_" + membro.id + "_" + Math.floor(quando) + "_" + Math.floor(r() * 1e6).toString(36),
      plataforma: membro.plataforma,
      comunidadeId: membro.comunidadeId,
      membroId: membro.id,
      tipo,
      ocorridoEm: new Date(quando).toISOString(),
      payload: payloadDe(r, tipo, membro),
    };
  }

  /* O payload é o bruto de cada plataforma. Ninguém lê dele sem saber o que
     procura — as telas passam por um formatador, nunca por acesso direto. */
  const EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "😄"];
  const CANAIS_VOZ = ["Sala de estudo", "Bancada aberta", "Live de quinta", "Mutirão de dúvidas"];

  function payloadDe(r, tipo, membro) {
    switch (tipo) {
      /* Produção */
      case "message_sent":
        return { canal: escolher(r, CANAIS), caracteres: inteiro(r, 12, 180) };
      case "message_substantial":
        return { canal: escolher(r, CANAIS), caracteres: inteiro(r, 320, 1400) };
      case "media_posted":
        return { canal: escolher(r, CANAIS), midia: escolher(r, ["imagem", "vídeo", "anexo"]) };
      case "thread_started":
        return { canal: escolher(r, CANAIS), titulo: escolher(r, TITULOS) };

      /* Reciprocidade */
      case "reply_given":
        return { canal: escolher(r, CANAIS), respondeuA: escolher(r, PRIMEIROS), caracteres: inteiro(r, 20, 320) };
      case "thread_replied":
        return { canal: escolher(r, CANAIS), titulo: escolher(r, TITULOS) };
      case "newcomer_welcomed":
        return { canal: escolher(r, CANAIS), novato: escolher(r, PRIMEIROS) };

      /* Consumo */
      case "reaction_given":
        return { canal: escolher(r, CANAIS), emoji: escolher(r, EMOJIS) };
      case "voice_minutes":
        return { canal: escolher(r, CANAIS_VOZ), minutos: inteiro(r, 8, 95) };

      /* Influência — o que aconteceu *com* a pessoa. `de` é quem fez. */
      case "reaction_received":
        return { canal: escolher(r, CANAIS), emoji: escolher(r, EMOJIS), de: escolher(r, PRIMEIROS) };
      case "reply_received":
        return { canal: escolher(r, CANAIS), de: escolher(r, PRIMEIROS) };
      case "mention_received":
        return { canal: escolher(r, CANAIS), de: escolher(r, PRIMEIROS) };
      case "forum_solution":
        return { canal: "dúvidas", titulo: escolher(r, TITULOS) };
      case "invite_used":
        return { convidado: escolher(r, PRIMEIROS) };

      default:
        return {};
    }
  }

  /* ── Somas de decaimento ───────────────────────────────────────────────
     O truque que faz a prévia ao vivo das configurações ser instantânea.

     Pontuação é Σ_tipo peso[tipo] · (Σ_evento do tipo fator_de_decaimento).
     A parte de dentro não depende dos pesos — só da meia-vida. Então ela é
     pré-computada por (membro, tipo) e mexer num peso vira produto escalar
     sobre nove números, não uma varredura de 20 mil eventos.

     Memoizado por meia-vida: mudar o slider de meia-vida é a única coisa que
     obriga a recalcular, e mesmo assim uma vez só por valor.

     `antes` é a mesma soma avaliada 30 dias atrás, ignorando o que ainda não
     tinha acontecido. É de onde saem tendência, delta e nível anterior. */
  function somasDe(meiaVidaDias, janelaDias) {
    const m = garantirMundo();
    const janela = janelaDias || JANELA_PONTUACAO_DIAS;
    const chave = meiaVidaDias + ":" + janela;
    const cache = m.cacheSomas.get(chave);
    if (cache) return cache;

    const corte = m.agoraMs - JANELA_TENDENCIA * DIA_MS;
    const tabela = new Map();

    for (const membro of m.membros) {
      const agora = {};
      const antes = {};
      for (const t of TIPOS_IDS) { agora[t] = 0; antes[t] = 0; }

      const brutos = m.eventosPorMembro.get(membro.id) || [];
      /* Tetos antes de somar, como no bot: sem isso, quinze reações num dia
         valem quinze e spam vira Embaixador. O corte é determinístico —
         cronológico, os N primeiros do dia UTC. */
      const eventos = aplicarTetosDiarios(brutos);

      for (const ev of eventos) {
        const ms = new Date(ev.ocorridoEm).getTime();
        const idade = (m.agoraMs - ms) / DIA_MS;
        if (dentroDaJanela(idade, janela)) {
          agora[ev.tipo] += fatorDecaimento(idade, meiaVidaDias) * qualidadeDe(ev);
        }
        const idadeAntes = (corte - ms) / DIA_MS;
        if (ms <= corte && dentroDaJanela(idadeAntes, janela)) {
          antes[ev.tipo] += fatorDecaimento(idadeAntes, meiaVidaDias) * qualidadeDe(ev);
        }
      }
      /* `total` conta os eventos brutos, não os que sobraram do teto: a coluna
         "eventos" da tabela é quantos aconteceram, não quantos pontuaram. */
      tabela.set(membro.id, { agora, antes, total: brutos.length });
    }

    m.cacheSomas.set(chave, tabela);
    return tabela;
  }

  /* ── Referências de eixo, por comunidade ───────────────────────────────
     Os eixos são normalizados pelo p90 **da comunidade**, então o nível de uma
     pessoa depende de quem mais está no servidor. Isso é do bot, e é
     deliberado: influência é uma medida relativa.

     Consequência prática pra prévia ao vivo: mexer num peso muda o p90 junto,
     e recalcular só o numerador daria número errado. Por isso a referência
     entra na mesma memoização e é refeita a cada config nova. */
  function referenciasDe(comunidadeId, config) {
    const m = garantirMundo();
    const chave = comunidadeId + "|" + config.meiaVidaDias + ":" + config.janelaDias +
      "|" + TIPOS_IDS.map((t) => config.pesos[t]).join(",");
    const cache = m.cacheRefs.get(chave);
    if (cache) return cache;

    const somas = somasDe(config.meiaVidaDias, config.janelaDias);
    const lista = (m.membrosPorComunidade.get(comunidadeId) || []).map((mb) => {
      const s = somas.get(mb.id);
      return eixosDe(s ? s.agora : null, config.pesos);
    });

    const ref = referenciasDeEixo(lista);
    m.cacheRefs.set(chave, ref);
    return ref;
  }

  /** Membro + pontuação, no formato do contrato. Puro em relação ao mundo. */
  function pontuar(membro, config) {
    const m = garantirMundo();
    const somas = somasDe(config.meiaVidaDias, config.janelaDias).get(membro.id);
    const referencia = referenciasDe(membro.comunidadeId, config);

    const pontuacao = pontuacaoDe(somas.agora, config.pesos);
    const eixosCru = eixosDe(somas.agora, config.pesos);
    const eixos = normalizarEixos(eixosCru, referencia);
    const nivel = nivelNatural(pontuacao, eixos, config.limiares);

    /* O "antes" usa a referência de hoje, não a de 30 dias atrás. É aproximação
       consciente: reconstruir o p90 da comunidade naquela data exigiria uma
       segunda tabela de somas por janela, e a tendência serve pra apontar
       direção, não pra ser auditada. O bot, que tem o histórico de verdade,
       usa `level_transitions` — quando a API entrar, a tendência vem de lá. */
    const pontuacaoAntes = pontuacaoDe(somas.antes, config.pesos);
    const eixosAntes = normalizarEixos(eixosDe(somas.antes, config.pesos), referencia);
    const nivelAnterior = nivelNatural(pontuacaoAntes, eixosAntes, config.limiares);

    const eventos = m.eventosPorMembro.get(membro.id) || [];
    const delta = pontuacao - pontuacaoAntes;
    /* Faixa morta de 2 pontos: sem ela, ruído de arredondamento vira seta. */
    const tendencia = delta > 2 ? "subiu" : delta < -2 ? "desceu" : "estavel";

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
      tendencia,
      deltaPontuacao: Math.round(delta * 10) / 10,
      nivelAnterior: nivelAnterior === nivel ? null : nivelAnterior,
    };
  }

  function gerarNotificacoes(r, m) {
    const saida = [];
    const config = m.config;
    /* Só materializa quem de fato cruzou faixa — notificação inventada seria
       a única mentira que a UI não consegue justificar. */
    const candidatos = m.membros.slice(0, 400);
    for (const membro of candidatos) {
      const p = pontuar(membro, config);
      if (p.nivelAnterior === null) continue;
      const subiu = p.nivel > p.nivelAnterior;
      saida.push({
        id: "n_" + membro.id,
        comunidadeId: membro.comunidadeId,
        membroId: membro.id,
        tipo: subiu ? "subiu_nivel" : "desceu_nivel",
        texto: membro.nome + (subiu ? " subiu para " : " caiu para ") + NIVEIS[p.nivel].rotulo + ".",
        criadaEm: new Date(m.agoraMs - inteiro(r, 5, 60 * 24 * 9) * 60000).toISOString(),
        lida: chance(r, 0.55),
      });
    }
    saida.sort((a, b) => (a.criadaEm < b.criadaEm ? 1 : -1));
    return saida.slice(0, 24);
  }

  /* ── Latência e falhas ─────────────────────────────────────────────────
     O painel de simulação escreve aqui. É o que permite ver skeleton, erro de
     rede e limite de taxa sem desligar a internet nem esperar dar sorte. */
  const sim = {
    latencia: "realista",
    falha: "nenhuma",
    falharUmaVez: false,
    vazio: false,
    /* Falha por sorteio, independente da falha forçada. É o que revela o bug
       que só aparece quando *uma* das chamadas da tela falha e as outras não —
       a falha forçada derruba todas de uma vez e esconde exatamente esse caso. */
    taxaErro: 0,
  };

  const LATENCIAS = {
    instantanea: [0, 0],
    rapida: [60, 140],
    realista: [220, 640],
    lenta: [1200, 2600],
  };

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function responder(fn) {
    const [min, max] = LATENCIAS[sim.latencia] || LATENCIAS.realista;
    if (max > 0) await esperar(min + Math.random() * (max - min));

    const falha = sim.falha;
    if (falha !== "nenhuma") {
      if (sim.falharUmaVez) sim.falha = "nenhuma";
      lancar(falha);
    }
    /* Sorteio depois da falha forçada: quem pediu um erro específico recebe
       aquele erro, não um aleatório por cima. */
    if (sim.taxaErro > 0 && Math.random() < sim.taxaErro) lancar("rede");
    return fn();
  }

  function lancar(codigo) {
    switch (codigo) {
      case "rede": throw new ErroDeRede();
      case "limite": throw new ErroDeLimite(null, 45);
      case "auth": throw new ErroDeAutenticacao(null, "discord");
      case "nao_encontrado": throw new NaoEncontrado();
      default: throw new ErroDaApi("Falha simulada: " + codigo, "simulada");
    }
  }

  /* ── Paginação ─────────────────────────────────────────────────────────
     Cursor opaco de propósito. Se a UI conseguir ler "índice 40" de dentro
     dele, alguém vai acabar fazendo conta com isso e o backend real quebra. */
  const abrirCursor = (c) => {
    if (!c) return 0;
    const n = parseInt(atob(String(c)).replace(/^p:/, ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const fecharCursor = (i, total) => (i >= total ? null : btoa("p:" + i));

  function paginar(itens, cursor, limite) {
    const inicio = abrirCursor(cursor);
    const fim = Math.min(inicio + limite, itens.length);
    return { itens: itens.slice(inicio, fim), proximoCursor: fecharCursor(fim, itens.length) };
  }

  function acharComunidade(id) {
    const c = garantirMundo().comunidadesPorId.get(id);
    if (!c) throw new NaoEncontrado("Comunidade não encontrada.");
    return c;
  }

  /* Uma comunidade em estado ruim não devolve dado: devolve o erro que a tela
     precisa para explicar o que houve. É aqui que o estado de sync vira
     comportamento em vez de enfeite. */
  function checarSaude(comunidade) {
    if (comunidade.estadoSync === "token_expirado") {
      throw new ErroDeAutenticacao(null, comunidade.plataforma);
    }
    if (comunidade.estadoSync === "indisponivel") {
      const motivo = INDISPONIVEIS[comunidade.plataforma];
      throw new ErroDaApi(motivo ? motivo.curto : "Plataforma indisponível.", "indisponivel");
    }
  }

  /* ── Adaptador ─────────────────────────────────────────────────────────
     Toda a superfície que a UI enxerga. Assinaturas iguais às do adaptador
     HTTP de §5 — é o que faz a troca ser de uma linha. */
  const adaptador = {
    nome: "mock",

    async listarComunidades() {
      return responder(() => garantirMundo().comunidades.map((c) => Object.assign({}, c)));
    },

    async obterComunidade(id) {
      return responder(() => Object.assign({}, acharComunidade(id)));
    },

    async listarEventos({ comunidadeId, tipos, nivel, membroId, config, cursor, limite } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);
        if (sim.vazio) return { itens: [], proximoCursor: null };

        let lista = membroId
          ? (m.eventosPorMembro.get(membroId) || [])
          : (m.eventosPorComunidade.get(comunidadeId) || []);
        if (tipos && tipos.length) {
          const set = new Set(tipos);
          lista = lista.filter((e) => set.has(e.tipo));
        }
        /* Filtrar por nível é filtrar por *quem*, não por evento: o nível é do
           membro e muda quando os pesos mudam. Resolver os ids uma vez e depois
           testar pertinência evita pontuar de novo a cada um dos 20 mil
           eventos — e é o que o servidor real faria com um join. */
        if (nivel) {
          const cfg = config || m.config;
          const alvo = new Set(
            (m.membrosPorComunidade.get(comunidadeId) || [])
              .filter((mb) => pontuar(mb, cfg).nivel === Number(nivel))
              .map((mb) => mb.id)
          );
          lista = lista.filter((e) => alvo.has(e.membroId));
        }
        const pagina = paginar(lista, cursor, limite || 25);

        /* O feed precisa escrever "Fulano mandou mensagem", mas `Evento` só
           carrega `membroId` — e assim deve ser, senão cada evento repetiria o
           nome da pessoa dezenas de milhares de vezes. A saída é a de sempre
           em API: mandar junto, uma vez só, quem aparece nesta página. */
        const membros = {};
        for (const ev of pagina.itens) {
          if (membros[ev.membroId]) continue;
          const mb = m.membrosPorId.get(ev.membroId);
          if (mb) membros[ev.membroId] = { id: mb.id, nome: mb.nome, arroba: mb.arroba, iniciais: mb.iniciais };
        }
        pagina.membros = membros;
        return pagina;
      });
    },

    async listarRanking({ comunidadeId, config, ordem, direcao, nivel, atividade, busca, cursor, limite } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);
        if (sim.vazio) return { itens: [], proximoCursor: null, total: 0 };

        const cfg = config || m.config;
        let linhas = (m.membrosPorComunidade.get(comunidadeId) || []).map((mb) => pontuar(mb, cfg));

        if (nivel) linhas = linhas.filter((l) => l.nivel === nivel);
        /* Faixa de última atividade. "inativo" é o complemento de 90 dias, e
           não uma faixa a mais: é a pergunta que a tela de retenção faz. */
        if (atividade) {
          const dias = atividade === "inativo" ? 90 : Number(atividade);
          const corte = m.agoraMs - dias * DIA_MS;
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

        /* O padrão do adaptador é pontuação — ordem estável e previsível, que é
           o que se espera de uma API. Abrir em "promocao" é escolha da tela de
           Contas, e ela pede explicitamente. */
        const chave = ordem || "pontuacao";
        const sinal = direcao === "asc" ? 1 : -1;
        linhas.sort((a, b) => {
          let x, y;
          if (chave === "nome") { x = a.membro.nome; y = b.membro.nome; return x.localeCompare(y, "pt-BR") * sinal; }
          /* Ordenação de abertura: quem cruzou faixa primeiro, e entre eles
             quem se moveu mais. É o que põe na primeira tela o que exige ação,
             em vez de ordem alfabética ou do topo do ranking — que muda pouco
             de um dia pro outro e por isso não informa nada. */
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
        const pagina = paginar(linhas, cursor, limite || 25);
        /* `posicao` é do ranking inteiro, não da página — senão a segunda
           página recomeça em 1 e a tabela mente. */
        const inicio = abrirCursor(cursor);
        pagina.itens = pagina.itens.map((l, i) => Object.assign({ posicao: inicio + i + 1 }, l));
        pagina.total = total;
        return pagina;
      });
    },

    async obterMembro({ comunidadeId, membroId, config } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);
        const membro = m.membrosPorId.get(membroId);
        if (!membro || membro.comunidadeId !== comunidadeId) throw new NaoEncontrado("Membro não encontrado.");

        const cfg = config || m.config;
        const base = pontuar(membro, cfg);
        const somas = somasDe(cfg.meiaVidaDias).get(membroId);
        const eventos = m.eventosPorMembro.get(membroId) || [];

        /* Composição: quanto de cada tipo compõe a pontuação de hoje. É a
           resposta a "por que essa pessoa está no nível 4". */
        const composicao = TIPOS_EVENTO.map((t) => ({
          tipo: t.id,
          contribuicao: Math.round(somas.agora[t.id] * cfg.pesos[t.id] * 10) / 10,
          eventos: eventos.filter((e) => e.tipo === t.id).length,
        })).filter((c) => c.eventos > 0);

        return Object.assign({}, base, {
          comunidade: Object.assign({}, comunidade),
          composicao,
          serie: serieDoMembro(membro, cfg, 30),
        });
      });
    },

    async resumoDaComunidade({ comunidadeId, config } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);
        const cfg = config || m.config;

        const linhas = (m.membrosPorComunidade.get(comunidadeId) || []).map((mb) => pontuar(mb, cfg));
        const eventos = m.eventosPorComunidade.get(comunidadeId) || [];
        const corte = m.agoraMs - JANELA_TENDENCIA * DIA_MS;
        const corteAnterior = corte - JANELA_TENDENCIA * DIA_MS;

        let recentes = 0, anteriores = 0;
        for (const e of eventos) {
          const ms = new Date(e.ocorridoEm).getTime();
          if (ms >= corte) recentes++;
          else if (ms >= corteAnterior) anteriores++;
        }

        const ativos = linhas.filter((l) => l.ultimaAtividade && new Date(l.ultimaAtividade).getTime() >= corte).length;
        const distribuicao = {};
        for (const n of [1, 2, 3, 4, 5]) distribuicao[n] = linhas.filter((l) => l.nivel === n).length;

        /* As fitas do topo do Painel pedem janelas mais curtas que a de
           tendência: "ativos em 7 dias" e "eventos hoje". Contadas aqui, junto
           com o resto, pra a tela não ter de pedir a mesma lista de novo. */
        const corte7 = m.agoraMs - 7 * DIA_MS;
        const inicioHoje = new Date(m.agoraMs);
        inicioHoje.setHours(0, 0, 0, 0);
        const msHoje = inicioHoje.getTime();
        let eventosHoje = 0;
        for (const e of eventos) {
          if (new Date(e.ocorridoEm).getTime() >= msHoje) eventosHoje++;
        }
        const ativos7d = linhas.filter(
          (l) => l.ultimaAtividade && new Date(l.ultimaAtividade).getTime() >= corte7
        ).length;

        return {
          comunidade: Object.assign({}, comunidade),
          membrosLidos: linhas.length,
          ativos7d,
          eventosHoje,
          ativos30d: ativos,
          eventos30d: recentes,
          variacaoEventos: anteriores === 0 ? null : Math.round(((recentes - anteriores) / anteriores) * 100),
          subiramNivel: linhas.filter((l) => l.nivelAnterior !== null && l.nivel > l.nivelAnterior).length,
          desceramNivel: linhas.filter((l) => l.nivelAnterior !== null && l.nivel < l.nivelAnterior).length,
          distribuicao,
        };
      });
    },

    async relatorio({ comunidadeId, config, dias } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);
        const cfg = config || m.config;
        const janela = dias || 30;

        const eventos = m.eventosPorComunidade.get(comunidadeId) || [];
        const inicio = m.agoraMs - janela * DIA_MS;

        /* Série diária de eventos. */
        const balde = new Map();
        for (let d = 0; d < janela; d++) {
          const dia = new Date(m.agoraMs - (janela - 1 - d) * DIA_MS);
          dia.setHours(0, 0, 0, 0);
          balde.set(dia.getTime(), 0);
        }
        const porTipo = {};
        for (const t of TIPOS_IDS) porTipo[t] = 0;

        for (const e of eventos) {
          const ms = new Date(e.ocorridoEm).getTime();
          if (ms < inicio) continue;
          const dia = new Date(ms);
          dia.setHours(0, 0, 0, 0);
          const k = dia.getTime();
          if (balde.has(k)) balde.set(k, balde.get(k) + 1);
          porTipo[e.tipo]++;
        }

        const linhas = (m.membrosPorComunidade.get(comunidadeId) || []).map((mb) => pontuar(mb, cfg));
        const distribuicao = {};
        for (const n of [1, 2, 3, 4, 5]) distribuicao[n] = linhas.filter((l) => l.nivel === n).length;

        const movimento = linhas
          .filter((l) => l.nivelAnterior !== null)
          .sort((a, b) => Math.abs(b.deltaPontuacao) - Math.abs(a.deltaPontuacao))
          .slice(0, 12);

        /* Contagem do movimento, que é diferente da amostra acima: o cartão de
           Relatórios precisa de "quantos", não de "quais".

           A janela é a da tendência (30 dias) e não a do `dias` pedido —
           `nivelAnterior` sai de `somasDe`, que é memoizado nessa janela fixa.
           Comparar 90 dias exigiria uma segunda tabela de somas para cada
           janela pedida, e a tela diz isso em vez de fingir que o número
           acompanha o seletor de período. */
        const movimentoResumo = {
          janelaDias: JANELA_TENDENCIA,
          subiram: linhas.filter((l) => l.nivelAnterior !== null && l.nivel > l.nivelAnterior).length,
          desceram: linhas.filter((l) => l.nivelAnterior !== null && l.nivel < l.nivelAnterior).length,
          estaveis: linhas.filter((l) => l.nivelAnterior === null).length,
        };

        return {
          comunidade: Object.assign({}, comunidade),
          dias: janela,
          serie: Array.from(balde, ([ms, n]) => ({ dia: new Date(ms).toISOString(), eventos: n })),
          composicao: TIPOS_EVENTO
            .map((t) => ({ tipo: t.id, eventos: porTipo[t.id] }))
            .filter((c) => c.eventos > 0),
          distribuicao,
          movimento,
          movimentoResumo,
          topo: linhas.sort((a, b) => b.pontuacao - a.pontuacao).slice(0, 10),
        };
      });
    },

    async listarNotificacoes() {
      return responder(() => garantirMundo().notificacoes.map((n) => Object.assign({}, n)));
    },

    async marcarNotificacaoLida(id) {
      return responder(() => {
        const n = garantirMundo().notificacoes.find((x) => x.id === id);
        if (!n) throw new NaoEncontrado("Notificação não encontrada.");
        n.lida = true;
        return Object.assign({}, n);
      });
    },

    async marcarTodasLidas() {
      return responder(() => {
        for (const n of garantirMundo().notificacoes) n.lida = true;
        return { lidas: garantirMundo().notificacoes.length };
      });
    },

    async buscar(termo) {
      return responder(() => {
        const m = garantirMundo();
        const q = String(termo || "").trim().toLowerCase();
        if (q.length < 2) return { comunidades: [], membros: [] };
        return {
          comunidades: m.comunidades
            .filter((c) => c.nome.toLowerCase().includes(q))
            .slice(0, 5)
            .map((c) => Object.assign({}, c)),
          membros: m.membros
            .filter((mb) => mb.nome.toLowerCase().includes(q) || mb.arroba.toLowerCase().includes(q))
            .slice(0, 8)
            .map((mb) => Object.assign({}, mb)),
        };
      });
    },

    async obterConfiguracoes() {
      return responder(() => JSON.parse(JSON.stringify(garantirMundo().config)));
    },

    /* Prévia da tela de Configurações: como ficaria a comunidade se estes
       pesos valessem. Não grava nada.

       É método do contrato, e não conta feita na tela, porque a resposta
       depende do histórico inteiro — trazer 20 mil eventos pro navegador só
       pra somar de novo seria o oposto do que o contrato existe pra evitar.
       Barato aqui pelo mesmo motivo que a régua é produto escalar: as somas
       decaídas já estão memoizadas por meia-vida. */
    async simularRegua({ comunidadeId, config } = {}) {
      return responder(() => {
        const m = garantirMundo();
        const comunidade = acharComunidade(comunidadeId);
        checarSaude(comunidade);

        const atual = m.config;
        const proposta = config || m.config;
        const membros = m.membrosPorComunidade.get(comunidadeId) || [];

        let sobem = 0, descem = 0, iguais = 0, travados = 0;
        const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        /* Limiares sem porta: serve só pra descobrir quem *teria* pontuação
           para subir e é barrado pelo eixo. É a resposta que a tela precisa dar
           e que o número de promoções sozinho esconde. */
        const semPorta = proposta.limiares.map((l) => ({ nivel: l.nivel, minScore: l.minScore, porta: null }));

        for (const mb of membros) {
          const antes = pontuar(mb, atual).nivel;
          const p = pontuar(mb, proposta);
          distribuicao[p.nivel]++;
          if (p.nivel > antes) sobem++;
          else if (p.nivel < antes) descem++;
          else iguais++;

          if (nivelNatural(p.pontuacao, null, semPorta) > p.nivel) travados++;
        }
        return { comunidadeId, membros: membros.length, sobem, descem, iguais, travados, distribuicao };
      });
    },

    async salvarConfiguracoes(config) {
      return responder(() => {
        const m = garantirMundo();
        /* Normaliza antes de guardar: limiar fora de ordem gravado seria estado
           inválido no servidor, e aí toda leitura seguinte herdaria o erro. */
        m.config = normalizarConfig(config);
        /* As somas dependem só de meia-vida e janela, então o cache caro
           sobrevive a quase toda gravação. As referências de eixo dependem dos
           pesos, mas são chaveadas por eles — a entrada velha fica órfã, não
           errada. */
        return JSON.parse(JSON.stringify(m.config));
      });
    },

    /* Fluxo de conexão. Não existe OAuth: existe a coreografia de OAuth, que
       é o que a tela precisa exercitar. */
    async conectar({ plataforma, nome } = {}) {
      return responder(() => {
        const m = garantirMundo();
        if (INDISPONIVEIS[plataforma]) {
          throw new ErroDaApi(INDISPONIVEIS[plataforma].curto, "indisponivel");
        }
        const r = prngDe(sementeDe(String(plataforma) + m.comunidades.length));
        const id = "c_" + plataforma + "_" + m.comunidades.length;
        const comunidade = {
          id,
          plataforma,
          nome: nome || "Comunidade conectada",
          iniciais: iniciaisDe(nome || "Comunidade conectada"),
          membros: inteiro(r, 120, 4200),
          online: inteiro(r, 3, 90),
          estadoSync: "sincronizando",
          sincronizadaEm: new Date(m.agoraMs).toISOString(),
        };
        m.comunidades.push(comunidade);
        m.comunidadesPorId.set(id, comunidade);
        m.membrosPorComunidade.set(id, []);
        m.eventosPorComunidade.set(id, []);
        /* Sai de "sincronizando" sozinha, como sairia de verdade. */
        setTimeout(() => { comunidade.estadoSync = "conectada"; }, 3200);
        return Object.assign({}, comunidade);
      });
    },

    async obterUrlConviteDiscord() { return { url: "#" }; },

    async reconectar(comunidadeId) {
      return responder(() => {
        const c = acharComunidade(comunidadeId);
        if (c.estadoSync === "indisponivel") {
          throw new ErroDaApi("Plataforma indisponível.", "indisponivel");
        }
        c.estadoSync = "conectada";
        c.sincronizadaEm = new Date(garantirMundo().agoraMs).toISOString();
        return Object.assign({}, c);
      });
    },

    async ressincronizar(comunidadeId) {
      return responder(() => {
        const c = acharComunidade(comunidadeId);
        checarSaude(c);
        c.estadoSync = "sincronizando";
        setTimeout(() => {
          c.estadoSync = "conectada";
          c.sincronizadaEm = new Date(Date.now()).toISOString();
        }, 2400);
        return Object.assign({}, c);
      });
    },

    async desconectar(comunidadeId) {
      return responder(() => {
        const m = garantirMundo();
        const i = m.comunidades.findIndex((c) => c.id === comunidadeId);
        if (i < 0) throw new NaoEncontrado("Comunidade não encontrada.");
        const [c] = m.comunidades.splice(i, 1);
        m.comunidadesPorId.delete(c.id);
        return { id: c.id };
      });
    },
  };

  /**
   * Série dos últimos N dias — o gráfico e a linha do tempo da gaveta.
   *
   * Devolve pontuação **e nível** por dia. O nível tem de vir daqui e não ser
   * recalculado na tela, porque nível agora depende de eixo, e eixo depende do
   * p90 da comunidade — a tela não tem como saber isso.
   *
   * A referência de eixo usada é a de hoje, para todos os dias. Mesma
   * aproximação de `pontuar`, e pelo mesmo motivo: o histórico honesto de
   * transições é `level_transitions` no bot, e é de lá que isto vem quando a
   * API entrar.
   */
  function serieDoMembro(membro, config, dias) {
    const m = garantirMundo();
    const eventos = aplicarTetosDiarios(m.eventosPorMembro.get(membro.id) || []);
    const referencia = referenciasDe(membro.comunidadeId, config);
    const saida = [];

    for (let d = dias - 1; d >= 0; d--) {
      const ref = m.agoraMs - d * DIA_MS;
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

  /* ── Ticker: o mundo continua acontecendo ──────────────────────────────
     Sem isto, `.pilula-novas` e `.atividade-nova` do CSS nunca teriam o que
     mostrar, e o stale-while-revalidate de §8 seria decoração.

     Duas coisas precisam andar junto com o evento novo, e esquecer qualquer
     uma delas dá bug silencioso:

       1. `agoraMs` é congelado na construção do mundo. Um evento nascendo em
          `Date.now()` fica no futuro em relação a esse congelamento, e
          `fatorDecaimento` receberia idade negativa — o evento valeria *mais*
          que 100%. Por isso o relógio do mundo avança junto.

       2. `cacheSomas` guarda as somas de decaimento memoizadas por meia-vida.
          Elas são relativas a `agoraMs`. Mexeu no relógio ou entrou evento,
          o cache inteiro está velho: sem limpar, o feed anda e a pontuação
          fica parada.

     Limpar o cache inteiro é O(eventos) na próxima leitura que precisar de
     pontuação — alguns milissegundos. Como o feed não pede soma nenhuma, a
     maioria dos ticks não custa nada. */

  let ticker = null;
  const aoChegar = new Set();

  /* Quanto o relógio do mundo já foi empurrado pra frente pelo painel de
     simulação. Precisa ser um deslocamento, e não uma escrita direta em
     `agoraMs`: o ticker reescreve `agoraMs` com `Date.now()` a cada evento
     novo, e desfaria o pulo no primeiro tick — o decaimento voltaria ao que
     era e o efeito que se queria ver sumiria sozinho. */
  let deslocamentoMs = 0;

  /* Ao vivo, a conversa é tagarela: quase tudo é mensagem, reação e resposta.
     Convite e publicação são raros o bastante pra chamarem atenção quando
     aparecem no feed, que é o efeito que se quer. */
  const MISTURA_AO_VIVO = [
    ["message_sent", 30], ["reaction_given", 24], ["reply_given", 14],
    ["reaction_received", 10], ["mention_received", 5], ["reply_received", 5],
    ["message_substantial", 4], ["thread_replied", 3], ["media_posted", 2],
    ["voice_minutes", 2], ["invite_used", 1],
  ];

  function nascerEvento() {
    const m = garantirMundo();
    const agora = Date.now() + deslocamentoMs;

    /* Comunidade parada não produz. É o que faz "indisponível" e "expirada"
       significarem alguma coisa: o feed delas fica realmente parado. */
    const vivas = m.comunidades.filter(
      (c) => c.estadoSync === "conectada" || c.estadoSync === "sincronizando"
    );
    if (!vivas.length) return null;

    const r = prngDe(sementeDe("vivo:" + agora + ":" + m.eventos.length));
    const comunidade = escolher(r, vivas);
    const candidatos = m.membrosPorComunidade.get(comunidade.id) || [];
    if (!candidatos.length) return null;

    const membro = escolher(r, candidatos);
    const ev = criarEvento(r, membro, pesado(r, MISTURA_AO_VIVO), agora, agora);

    /* `eventos` e os índices são ordenados do mais novo pro mais velho, então
       o lugar do evento novo é a frente de cada lista. */
    m.eventos.unshift(ev);
    if (!m.eventosPorComunidade.has(ev.comunidadeId)) m.eventosPorComunidade.set(ev.comunidadeId, []);
    m.eventosPorComunidade.get(ev.comunidadeId).unshift(ev);
    if (!m.eventosPorMembro.has(ev.membroId)) m.eventosPorMembro.set(ev.membroId, []);
    m.eventosPorMembro.get(ev.membroId).unshift(ev);

    m.agoraMs = agora;                 /* (1) relógio anda */
    m.agora = new Date(agora);
    m.cacheSomas.clear();              /* (2) somas ficaram velhas */
    m.cacheRefs.clear();               /*     e as referências saem delas */

    comunidade.sincronizadaEm = new Date(agora).toISOString();
    return ev;
  }

  function anunciar(eventos) {
    if (!eventos.length) return;
    /* O mock não conhece a camada de query nem as telas — quem quiser saber
       que chegou coisa nova assina. É o que impede §4 de citar §8. */
    for (const fn of aoChegar) fn(eventos);
  }

  /* ── Controles do painel de simulação ──────────────────────────────────
     Só o painel usa isto. Nenhuma tela chama — se chamasse, a fronteira que
     o mock existe pra provar estaria furada. */
  const controles = {
    estado: sim,
    latencias: Object.keys(LATENCIAS),

    definirLatencia(v) { sim.latencia = v; },
    definirFalha(v, umaVez) { sim.falha = v; sim.falharUmaVez = Boolean(umaVez); },
    definirVazio(v) { sim.vazio = Boolean(v); },
    definirTaxaErro(v) { sim.taxaErro = Math.min(1, Math.max(0, Number(v) || 0)); },

    semente() { return sementeAtual; },
    reconstruir(semente) {
      sementeAtual = semente || sementeAtual;
      mundo = null;
      deslocamentoMs = 0;      /* mundo novo, relógio no lugar */
      return garantirMundo().semente;
    },

    /* Empurra o relógio do mundo pra frente sem inventar evento nenhum. Todo
       histórico envelhece de uma vez, e é a única forma de ver o decaimento
       agindo sem esperar 30 dias: as pontuações caem, gente desce de nível e
       a tendência vira. `agoraMs` anda; os eventos ficam onde estavam. */
    pularDias(n) {
      const m = garantirMundo();
      const delta = (Number(n) || 30) * DIA_MS;
      deslocamentoMs += delta;
      m.agoraMs += delta;
      m.agora = new Date(m.agoraMs);
      m.cacheSomas.clear();    /* as somas eram relativas ao relógio antigo */
      m.cacheRefs.clear();
      return m.agora.toISOString();
    },
    diasPulados() { return Math.round(deslocamentoMs / DIA_MS); },

    /* Ticker. `aoChegarEvento` devolve a função de cancelar, no mesmo padrão
       de `Query.assinar`. */
    aoChegarEvento(fn) {
      aoChegar.add(fn);
      return () => aoChegar.delete(fn);
    },
    tickerLigado() { return ticker !== null; },
    ligarTicker(ms) {
      this.desligarTicker();
      const intervalo = Math.max(500, ms || 4000);
      ticker = setInterval(() => {
        const ev = nascerEvento();
        if (ev) anunciar([ev]);
      }, intervalo);
      return intervalo;
    },
    desligarTicker() {
      if (ticker !== null) { clearInterval(ticker); ticker = null; }
    },
    /* Rajada: várias de uma vez, pra ver a pílula contar mais de um sem
       precisar esperar o intervalo N vezes. */
    rajada(n) {
      const saida = [];
      for (let i = 0; i < (n || 3); i++) {
        const ev = nascerEvento();
        if (ev) saida.push(ev);
      }
      anunciar(saida);
      return saida.length;
    },

    /* Mexe no estado de uma comunidade pra a tela poder ser vista naquele
       estado sem esperar o sorteio cair certo. */
    forcarEstadoSync(comunidadeId, estado) {
      const c = garantirMundo().comunidadesPorId.get(comunidadeId);
      if (c) c.estadoSync = estado;
    },
    expirarPrimeiraConexao() {
      const c = garantirMundo().comunidades.find((x) => x.estadoSync === "conectada");
      if (c) c.estadoSync = "token_expirado";
      return c ? c.id : null;
    },
    chegarNotificacao() {
      const m = garantirMundo();
      const membro = m.membros[Math.floor(Math.random() * m.membros.length)];
      const nova = {
        id: "n_sim_" + Date.now(),
        comunidadeId: membro.comunidadeId,
        membroId: membro.id,
        tipo: "subiu_nivel",
        texto: membro.nome + " subiu para " + NIVEIS[Math.min(5, inteiro(Math.random, 2, 5))].rotulo + ".",
        criadaEm: new Date().toISOString(),
        lida: false,
      };
      m.notificacoes.unshift(nova);
      return nova;
    },

    /* Só os testes de §11 precisam disso. A UI, nunca. */
    _mundo() { return garantirMundo(); },
  };

  return { adaptador, controles };
})();
