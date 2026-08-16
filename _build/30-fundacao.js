"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   EngageMend — painel v4
   Interface inteiramente funcional, dados inteiramente falsos.

   Não existe fetch, XHR, WebSocket, OAuth, chave, token ou URL de API neste
   arquivo. A única fonte de dados é o adaptador mock, e ele é trocável num
   ponto só: a constante ADAPTADOR_ATIVO, no bloco §6 (CLIENTE).

   Mapa do arquivo:
     §1  Ícones e átomos visuais
     §2  Tokens de domínio (plataformas, níveis, tipos de evento)
     §3  Contrato: tipos (JSDoc) e erros tipados
     §4  Mock: PRNG, gerador do mundo, latência, adaptador
     §5  Adaptador HTTP (slot do backend real — todo método lança)
     §6  CLIENTE — escolhe o adaptador  ← o único ponto que muda
     §7  Régua de Engajamento (funções puras)
     §8  Camada de query (cache, estados, cursor, invalidação)
     §9  Roteador e URL
     §10 Componentes e telas
     §11 Testes
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── §1 · Ícones ─────────────────────────────────────────────────────────── */
/* O pack acima é o original. Estes são os que as telas novas pedem. */
Object.assign(ICONES, {
  "trend-up":     { vb: "0 0 24 24", inner: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>', fill: false },
  "trend-down":   { vb: "0 0 24 24", inner: '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>', fill: false },
  "estavel":      { vb: "0 0 24 24", inner: '<path d="M5 12h14"/>', fill: false },
  "download":     { vb: "0 0 24 24", inner: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>', fill: false },
  "filtro":       { vb: "0 0 24 24", inner: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>', fill: false },
  "ordenar":      { vb: "0 0 24 24", inner: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>', fill: false },
  "seta-cima":    { vb: "0 0 24 24", inner: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', fill: false },
  "seta-baixo":   { vb: "0 0 24 24", inner: '<path d="m19 12-7 7-7-7"/><path d="M12 5v14"/>', fill: false },
  "seta-dir":     { vb: "0 0 24 24", inner: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', fill: false },
  "recarregar":   { vb: "0 0 24 24", inner: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>', fill: false },
  "alerta":       { vb: "0 0 24 24", inner: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', fill: false },
  "alerta-circ":  { vb: "0 0 24 24", inner: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>', fill: false },
  "sem-rede":     { vb: "0 0 24 24", inner: '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M2 8.8a16 16 0 0 1 6-3.6"/><path d="M16 5.2a16 16 0 0 1 6 3.6"/><path d="m2 2 20 20"/>', fill: false },
  "sliders":      { vb: "0 0 24 24", inner: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>', fill: false },
  "escudo":       { vb: "0 0 24 24", inner: '<path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.6a1 1 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>', fill: false },
  "olho-off":     { vb: "0 0 24 24", inner: '<path d="M10.7 5.1A9 9 0 0 1 12 5c5 0 9 5 9 7a12 12 0 0 1-2.2 2.9"/><path d="M6.6 6.6A13 13 0 0 0 3 12c0 2 4 7 9 7a9 9 0 0 0 4.6-1.3"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', fill: false },
  "relogio":      { vb: "0 0 24 24", inner: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', fill: false },
  "calendario":   { vb: "0 0 24 24", inner: '<rect width="18" height="17" x="3" y="4" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>', fill: false },
  "raio":         { vb: "0 0 24 24", inner: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', fill: false },
  "balao":        { vb: "0 0 24 24", inner: '<path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/>', fill: false },
  "resposta":     { vb: "0 0 24 24", inner: '<path d="m9 14-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>', fill: false },
  "coracao":      { vb: "0 0 24 24", inner: '<path d="M19 5.7a5 5 0 0 0-7 0l-.9.9-1-.9a5 5 0 0 0-7 7l8 8 8-8a5 5 0 0 0 0-7z"/>', fill: false },
  "documento":    { vb: "0 0 24 24", inner: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>', fill: false },
  "convite":      { vb: "0 0 24 24", inner: '<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>', fill: false },
  "presenca":     { vb: "0 0 24 24", inner: '<rect width="18" height="17" x="3" y="4" rx="2"/><path d="M3 9h18"/><path d="m9 15 2 2 4-4"/>', fill: false },
  "arroba":       { vb: "0 0 24 24", inner: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>', fill: false },
  "entrar":       { vb: "0 0 24 24", inner: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>', fill: false },
  "sair":         { vb: "0 0 24 24", inner: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>', fill: false },
  "caixa-vazia":  { vb: "0 0 24 24", inner: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>', fill: false },
  "check-circ":   { vb: "0 0 24 24", inner: '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>', fill: false },
  "x-circ":       { vb: "0 0 24 24", inner: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', fill: false },
  "comando":      { vb: "0 0 24 24", inner: '<path d="M15 6a3 3 0 1 1 3 3H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3z"/>', fill: false },
  "terminal":     { vb: "0 0 24 24", inner: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', fill: false },
  "link":         { vb: "0 0 24 24", inner: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>', fill: false },
  "pessoas":      { vb: "0 0 24 24", inner: '<path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="8" r="4"/>', fill: false },
  "estrela":      { vb: "0 0 24 24", inner: '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/>', fill: false },
});

function svg(nome, cls) {
  const i = ICONES[nome];
  if (!i) return "";
  const pintura = i.fill
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="${i.vb}" ${pintura} aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${i.inner}</svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Avatar: tom derivado do nome — mesma função de hash do componente React,
   pra a mesma pessoa manter a mesma cor entre as duas implementações. */
const TONS = [
  { bg: "#FBEFD3", texto: "#7A5312" },
  { bg: "#DCE9FB", texto: "#1B4A93" },
  { bg: "#EBE2F8", texto: "#563189" },
  { bg: "#D9F0E4", texto: "#14603D" },
  { bg: "#FBE2E4", texto: "#8E2733" },
  { bg: "#DDEEF0", texto: "#14595F" },
];
function tomDe(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TONS[hash % TONS.length];
}
function avatar(iniciais, seed, tamanho) {
  const t = tomDe(seed || iniciais);
  return `<span class="avatar avatar-${tamanho}" aria-hidden="true" style="background:${t.bg};color:${t.texto}">${esc(iniciais)}</span>`;
}

function formatarMembros(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k % 1 === 0 ? k : k.toFixed(1).replace(".", ",")}k`;
}

/* ── §2 · Tokens de domínio ──────────────────────────────────────────────── */
/* A cor de marca aparece em dois lugares só, sempre um glifo por vez: no tile
   ATIVO do rail e no cabeçalho do seletor. `cor` é calibrada pro fundo claro;
   `corEscura` existe onde o valor oficial some ou vibra sobre o verde da nav
   (o preto do X é o caso extremo — vira branco). */
const PLATAFORMAS = [
  { id: "youtube",   nome: "YouTube",   cor: "#FF0033", termo: "canal",     termoPlural: "canais" },
  { id: "instagram", nome: "Instagram", cor: "#E4405F", corEscura: "#F1698A", termo: "perfil",    termoPlural: "perfis" },
  { id: "discord",   nome: "Discord",   cor: "#5865F2", corEscura: "#8B95FF", termo: "servidor",  termoPlural: "servidores" },
  { id: "whatsapp",  nome: "WhatsApp",  cor: "#1DA851", corEscura: "#25D366", termo: "grupo",     termoPlural: "grupos" },
  { id: "reddit",    nome: "Reddit",    cor: "#FF4500", corEscura: "#FF6A33", termo: "subreddit", termoPlural: "subreddits" },
  { id: "x",         nome: "X",         cor: "#0F1419", corEscura: "#FFFFFF", termo: "perfil",    termoPlural: "perfis" },
];
const getPlataforma = (id) => PLATAFORMAS.find((p) => p.id === id);
const corDaMarca = (p, superficie) => (superficie === "escura" ? p.corEscura || p.cor : p.cor);

/* ── Níveis ───────────────────────────────────────────────────────────────────
   A numeração é a do bot (`LEVEL_NAMES` em `src/classifier/weights.ts`), e não
   a do §0 do briefing, que tinha 4 e 5 invertidos.

   O bot ganhou porque `level_transitions` já tem promoções gravadas com esta
   numeração: mudar lá reescreveria o significado de dado passado. E a ordem
   dele é coerente com a tese do produto — `invite_used` é o evento mais valioso
   do sistema (peso 20), fica no eixo de influência, e influência é a porta do
   nível 5. Quem traz gente de fora chega ao topo, e o nome disso é Embaixador.

   Níveis 1–3 exibem "Nível N"; 4 e 5 exibem o nome, porque são os que alguém
   diz em voz alta numa reunião. */
const NIVEIS = {
  1: { nome: "Observador",   rotulo: "Nível 1",         bg: "#EFF2F0", texto: "#48574F", borda: "#DDE3DF" },
  2: { nome: "Participante", rotulo: "Nível 2",         bg: "#E7F0FD", texto: "#1B4FA8", borda: "#CEE0F8" },
  3: { nome: "Contribuinte", rotulo: "Nível 3",         bg: "#DCF3E6", texto: "#14663F", borda: "#C2E8D2" },
  4: { nome: "Líder",        rotulo: "4 · Líder",       bg: "#FDF0DA", texto: "#8A5214", borda: "#F5DEB4" },
  5: { nome: "Embaixador",   rotulo: "5 · Embaixador",  bg: "#12402F", texto: "#CDEDDB", borda: "#12402F" },
};

/** Crachá de nível — o mesmo em toda superfície. */
function crachaNivel(nivel) {
  const n = NIVEIS[nivel];
  return `<span class="nivel" title="Régua de Engajamento · ${n.nome}"
    style="background:${n.bg};color:${n.texto};border-color:${n.borda}">${n.rotulo}</span>`;
}

/* PLATAFORMAS já existe acima. Aqui vai só o que o v4 acrescenta: por que uma
   plataforma pode não estar disponível. Texto honesto, sem prometer data. */
const INDISPONIVEIS = {
  x: {
    titulo: "X ainda não está disponível",
    texto:
      "O acesso à API do X custa, hoje, mais do que a EngageMend consegue repassar. " +
      "Enquanto isso não mudar, os perfis do X aparecem aqui em modo leitura, sem dados novos. " +
      "Não temos data para prometer.",
    curto: "API sem viabilidade de custo",
  },
  whatsapp: {
    titulo: "WhatsApp ainda não está disponível",
    texto:
      "A API de grupos do WhatsApp exige aprovação caso a caso pela Meta e ainda não " +
      "libera histórico de mensagens de grupo. Sem histórico, a Régua não teria o que ler. " +
      "Não temos data para prometer.",
    curto: "Sem acesso a histórico de grupo",
  },
};

/* Cor de barra por nível — a família do crachá, saturada pra sobreviver a 8px. */
const COR_NIVEL = { 1: "var(--n1)", 2: "var(--n2)", 3: "var(--n3)", 4: "var(--n4)", 5: "var(--n5)" };

/* ── A calibragem, espelhada do bot ───────────────────────────────────────────
   Tudo daqui até o fim do bloco é cópia fiel de `src/classifier/weights.ts` do
   repositório `engagemend-discord`. **Não é invenção do painel e não deve
   divergir.** Se os dois discordarem, o painel promete um número e o backend
   entrega outro — a falha mais cara possível, porque é silenciosa.

   Duas defesas contra isso, ambas em §11:
     · os testes do bot (`tests/level.test.ts`) rodam aqui dentro;
     · `VERSAO_PESOS` é conferida — recalibrar o bot sem atualizar o painel
       deixa a suíte vermelha.

   Os identificadores ficam **em inglês, iguais aos do bot** (`influence`, não
   `influencia`). Camada de tradução é onde erro de mapeamento se esconde; com a
   mesma palavra dos dois lados, um `grep` acha a divergência. Traduzido é só o
   rótulo que aparece na tela. */

const VERSAO_PESOS = "v0.1.0-uncalibrated";   /* = WEIGHTS_VERSION do bot */

const EIXOS = [
  { id: "consumption",  rotulo: "Consumo",       descricao: "esteve presente, leu, reagiu" },
  { id: "production",   rotulo: "Produção",      descricao: "trouxe conteúdo novo" },
  { id: "reciprocity",  rotulo: "Reciprocidade", descricao: "respondeu e acolheu os outros" },
  { id: "influence",    rotulo: "Influência",    descricao: "os outros reagiram, responderam, vieram por ela" },
];
const EIXOS_IDS = EIXOS.map((e) => e.id);
const getEixo = (id) => EIXOS.find((e) => e.id === id);

/**
 * Os 14 tipos que o coletor produz. `peso` e `eixo` vêm de `WEIGHTS` do bot;
 * `peso` é o padrão de fábrica e pode ser reescrito nas configurações.
 *
 * `retroativo: false` significa que o evento **só existe a partir do dia em que
 * o coletor subiu** — o Discord não guarda log de voz nem de quem convidou
 * quem. Num gráfico de 90 dias esses dois começam do zero no meio, e a tela
 * precisa dizer isso, senão parece queda de engajamento.
 *
 * `recebido: true` marca o que aconteceu *com* a pessoa, não o que ela fez. É a
 * distinção que o painel antigo não tinha, e é a que separa "mandei 300
 * mensagens" de "300 pessoas me responderam".
 *
 * A ordem é a dos chips de filtro e das barras de composição: do mais valioso
 * pro mais barato.
 */
const TIPOS_EVENTO = [
  { id: "invite_used",         rotulo: "Convite usado",      curto: "Convite",    icone: "convite",   peso: 20, eixo: "influence",    retroativo: false, recebido: true  },
  { id: "forum_solution",      rotulo: "Solução no fórum",   curto: "Solução",    icone: "estrela",   peso: 12, eixo: "influence",    retroativo: true,  recebido: true  },
  { id: "newcomer_welcomed",   rotulo: "Boas-vindas",        curto: "Acolheu",    icone: "pessoas",   peso: 8,  eixo: "reciprocity",  retroativo: true,  recebido: false },
  { id: "thread_started",      rotulo: "Tópico aberto",      curto: "Tópico",     icone: "documento", peso: 6,  eixo: "production",   retroativo: true,  recebido: false },
  { id: "media_posted",        rotulo: "Mídia publicada",    curto: "Mídia",      icone: "documento", peso: 5,  eixo: "production",   retroativo: true,  recebido: false },
  { id: "reply_received",      rotulo: "Resposta recebida",  curto: "Respondida", icone: "resposta",  peso: 5,  eixo: "influence",    retroativo: true,  recebido: true  },
  { id: "voice_minutes",       rotulo: "Minutos em voz",     curto: "Voz",        icone: "presenca",  peso: 5,  eixo: "consumption",  retroativo: false, recebido: false },
  { id: "mention_received",    rotulo: "Menção recebida",    curto: "Mencionada", icone: "arroba",    peso: 4,  eixo: "influence",    retroativo: true,  recebido: true  },
  { id: "reply_given",         rotulo: "Resposta dada",      curto: "Respondeu",  icone: "resposta",  peso: 4,  eixo: "reciprocity",  retroativo: true,  recebido: false },
  { id: "thread_replied",      rotulo: "Resposta em tópico", curto: "Em tópico",  icone: "resposta",  peso: 4,  eixo: "reciprocity",  retroativo: true,  recebido: false },
  { id: "reaction_received",   rotulo: "Reação recebida",    curto: "Reagiram",   icone: "coracao",   peso: 3,  eixo: "influence",    retroativo: true,  recebido: true  },
  { id: "message_substantial", rotulo: "Mensagem longa",     curto: "Msg longa",  icone: "balao",     peso: 3,  eixo: "production",   retroativo: true,  recebido: false },
  { id: "message_sent",        rotulo: "Mensagem",           curto: "Mensagem",   icone: "balao",     peso: 2,  eixo: "production",   retroativo: true,  recebido: false },
  { id: "reaction_given",      rotulo: "Reação dada",        curto: "Reagiu",     icone: "coracao",   peso: 1,  eixo: "consumption",  retroativo: true,  recebido: false },
  { id: "comment_reply_received", rotulo: "Comentário respondido", curto: "Respondido", icone: "resposta", peso: 5, eixo: "influence",   retroativo: true,  recebido: true  },
  { id: "comment_substantial", rotulo: "Comentário relevante", curto: "Comentário+", icone: "balao",     peso: 3,  eixo: "production",   retroativo: true,  recebido: false },
  { id: "comment_sent",        rotulo: "Comentário",         curto: "Comentário", icone: "balao",     peso: 2,  eixo: "production",   retroativo: true,  recebido: false },
];
const TIPOS_IDS = TIPOS_EVENTO.map((t) => t.id);
const getTipo = (id) => TIPOS_EVENTO.find((t) => t.id === id);

const PESOS_PADRAO = Object.freeze(
  TIPOS_EVENTO.reduce((acc, t) => { acc[t.id] = t.peso; return acc; }, {})
);

/**
 * Limiares, avaliados de cima para baixo — o primeiro que casar vence.
 *
 * `porta` é o que impede pontuação sozinha de promover. Nas palavras do bot:
 * quem manda 300 mensagens e ninguém responde não é Contribuinte, é ruído.
 */
const LIMIARES_PADRAO = Object.freeze([
  { nivel: 5, minScore: 80, porta: { eixo: "influence",   min: 60 } },
  { nivel: 4, minScore: 55, porta: { eixo: "influence",   min: 35 } },
  { nivel: 3, minScore: 30, porta: { eixo: "reciprocity", min: 20 } },
  { nivel: 2, minScore: 8,  porta: null },
  { nivel: 1, minScore: -Infinity, porta: null },
]);

/** Sem tetos, spam de reação vira Embaixador. */
const TETOS_DIARIOS = Object.freeze({
  reaction_given: 15,
  message_sent: 30,
  reply_given: 25,
});

const MEIA_VIDA_PADRAO = 14;          /* HALF_LIFE_DAYS */
const JANELA_PONTUACAO_DIAS = 60;     /* SCORE_WINDOW_DAYS — o §8 chama de "30
                                         dias", mas 60 é o número operante */
const HISTERESE_DIAS = 14;            /* dias abaixo do corte antes de rebaixar */
const PERCENTIL_EIXO = 0.9;           /* AXIS_NORMALIZATION_PERCENTILE */

const ESTADOS_SYNC = {
  conectada:      { rotulo: "Sincronizada",   curto: "ok" },
  sincronizando:  { rotulo: "Sincronizando",  curto: "sincronizando" },
  desatualizada:  { rotulo: "Desatualizada",  curto: "atrasada" },
  token_expirado: { rotulo: "Conexão expirada", curto: "expirada" },
  erro:           { rotulo: "Erro na sincronização", curto: "erro" },
  indisponivel:   { rotulo: "Indisponível",   curto: "indisponível" },
};
/* Estados que acendem o ponto de pendência no rail. */
const SYNC_PENDENTE = new Set(["desatualizada", "token_expirado", "erro"]);

/* ── §3 · Contrato ───────────────────────────────────────────────────────── */
/**
 * Tipos do contrato. Sem TypeScript neste arquivo (ver relatório final), então
 * o contrato é declarado em JSDoc e checado pelo editor. Nenhum `any` — todo
 * campo tem tipo, e `payload` é `Record<string, unknown>` de propósito: é o
 * bruto de cada plataforma, e ninguém deve ler dele sem saber o que procura.
 *
 * @typedef {"youtube"|"instagram"|"discord"|"whatsapp"|"reddit"|"x"} PlataformaId
 * @typedef {"reaction_given"|"message_sent"|"message_substantial"|"media_posted"|"reply_given"|"thread_started"|"thread_replied"|"reaction_received"|"reply_received"|"mention_received"|"forum_solution"|"voice_minutes"|"newcomer_welcomed"|"invite_used"} TipoEvento
 * @typedef {"consumption"|"production"|"reciprocity"|"influence"} Eixo
 * @typedef {"conectada"|"sincronizando"|"desatualizada"|"token_expirado"|"erro"|"indisponivel"} EstadoSync
 * @typedef {1|2|3|4|5} Nivel
 *
 * @typedef {Object} Evento
 * @property {string} id
 * @property {PlataformaId} plataforma
 * @property {string} comunidadeId
 * @property {string} membroId
 * @property {TipoEvento} tipo
 * @property {string} ocorridoEm            ISO 8601, UTC
 * @property {Record<string, unknown>} payload
 *
 * @typedef {Object} Membro
 * @property {string} id
 * @property {string} comunidadeId
 * @property {PlataformaId} plataforma
 * @property {string} nome
 * @property {string} arroba
 * @property {string} iniciais
 * @property {string} entrouEm              ISO 8601
 *
 * @typedef {Object} Comunidade
 * @property {string} id
 * @property {PlataformaId} plataforma
 * @property {string} nome
 * @property {string} iniciais
 * @property {number} membros
 * @property {number} online
 * @property {EstadoSync} estadoSync
 * @property {string|null} sincronizadaEm   ISO 8601, ou null se nunca sincronizou
 *
 * @typedef {Object} PesosRegua
 * @property {Record<TipoEvento, number>} pesos
 * @property {number} meiaVidaDias
 * @property {Record<"2"|"3"|"4"|"5", number>} faixas
 *
 * @typedef {Object} MembroComPontuacao
 * @property {Membro} membro
 * @property {number} pontuacao
 * @property {Nivel} nivel
 * @property {number} totalEventos
 * @property {string|null} ultimaAtividade
 * @property {"subiu"|"desceu"|"estavel"} tendencia
 * @property {number} deltaPontuacao        variação de pontuação em 30 dias
 * @property {Nivel|null} nivelAnterior
 *
 * @typedef {Object} Notificacao
 * @property {string} id
 * @property {string} comunidadeId
 * @property {string} membroId
 * @property {"subiu_nivel"|"desceu_nivel"|"marco"} tipo
 * @property {string} texto
 * @property {string} criadaEm
 * @property {boolean} lida
 *
 * @template T
 * @typedef {Object} Pagina
 * @property {T[]} itens
 * @property {string|null} proximoCursor
 */

/* Erros tipados. A UI reage diferente a cada um: token expirado pede
   reconexão, limite pede espera, rede oferece nova tentativa. */
class ErroDaApi extends Error {
  /** @param {string} mensagem @param {string} codigo */
  constructor(mensagem, codigo) {
    super(mensagem);
    this.name = this.constructor.name;
    this.codigo = codigo;
  }
}
class ErroDeRede extends ErroDaApi {
  constructor(mensagem) {
    super(mensagem || "Não foi possível falar com o servidor.", "rede");
    this.recuperavel = true;
  }
}
class ErroDeAutenticacao extends ErroDaApi {
  /** @param {string} mensagem @param {PlataformaId|null} plataforma */
  constructor(mensagem, plataforma) {
    super(mensagem || "A conexão com a plataforma expirou.", "auth");
    this.plataforma = plataforma || null;
    this.recuperavel = false;
  }
}
class ErroDeLimite extends ErroDaApi {
  /** @param {string} mensagem @param {number} esperarSegundos */
  constructor(mensagem, esperarSegundos) {
    super(mensagem || "A plataforma pediu para esperarmos antes de buscar de novo.", "limite");
    this.esperarSegundos = esperarSegundos || 30;
    this.recuperavel = true;
  }
}
class NaoEncontrado extends ErroDaApi {
  constructor(mensagem) {
    super(mensagem || "Esse item não existe mais.", "nao_encontrado");
    this.recuperavel = false;
  }
}
class NotImplementedError extends ErroDaApi {
  constructor(metodo) {
    super("O adaptador HTTP ainda não implementa " + metodo + "().", "nao_implementado");
    this.recuperavel = false;
  }
}

/** Texto que o usuário lê. Nunca "Oops", nunca "Erro 500". */
function explicarErro(erro) {
  if (erro instanceof ErroDeAutenticacao) {
    const p = erro.plataforma ? getPlataforma(erro.plataforma) : null;
    return {
      titulo: "A conexão expirou",
      texto: p
        ? "A EngageMend perdeu a autorização de leitura no " + p.nome + ". Reconecte para voltar a receber atividade."
        : "A EngageMend perdeu a autorização de leitura nesta comunidade. Reconecte para voltar a receber atividade.",
      acao: "reconectar",
    };
  }
  if (erro instanceof ErroDeLimite) {
    return {
      titulo: "A plataforma pediu uma pausa",
      texto:
        "Passamos do limite de consultas permitido e a plataforma bloqueou por " +
        erro.esperarSegundos + " segundos. Os dados na tela são os últimos que conseguimos ler.",
      acao: "esperar",
    };
  }
  if (erro instanceof NaoEncontrado) {
    return {
      titulo: "Não encontramos esse item",
      texto: "Ele pode ter sido apagado na plataforma de origem ou você pode ter seguido um link antigo.",
      acao: "voltar",
    };
  }
  if (erro instanceof ErroDeRede) {
    return {
      titulo: "Não conseguimos carregar",
      texto: "A conexão falhou no meio do caminho. Nada foi perdido — é só tentar de novo.",
      acao: "tentar",
    };
  }
  return {
    titulo: "Não conseguimos carregar",
    texto: erro && erro.message ? erro.message : "A leitura foi interrompida antes de terminar.",
    acao: "tentar",
  };
}

/* ── Formatadores ────────────────────────────────────────────────────────── */
const fmtNum = new Intl.NumberFormat("pt-BR");
const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtMesCurto = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

const numero = (n) => fmtNum.format(Math.round(n));
const data = (iso) => fmtData.format(new Date(iso));
const dataHora = (iso) => fmtDataHora.format(new Date(iso));

const DIA_MS = 86400000;

/** "há 4 min", "há 3 h", "ontem", "há 12 d". Sempre relativo a `agora`. */
function relativo(iso, agora) {
  if (!iso) return "nunca";
  const ms = agora.getTime() - new Date(iso).getTime();
  if (ms < 0) return "agora";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return "há " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return "há " + h + " h";
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return "há " + d + " d";
  const m = Math.floor(d / 30);
  if (m < 12) return "há " + m + (m === 1 ? " mês" : " meses");
  const a = Math.floor(d / 365);
  return "há " + a + (a === 1 ? " ano" : " anos");
}

const plural = (n, um, muitos) => n + " " + (n === 1 ? um : muitos);
const pct = (parte, total) => (total === 0 ? 0 : Math.round((parte / total) * 100));

/** Iniciais a partir do nome, tolerando @arroba e nome de uma palavra só. */
function iniciaisDe(nome) {
  const limpo = String(nome).replace(/^[@u/]+/, "").trim();
  const partes = limpo.split(/[\s_.-]+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
