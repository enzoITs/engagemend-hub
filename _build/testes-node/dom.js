/* DOM de mentira, o bastante pra carregar o painel e rodar §11 fora do
   navegador. Não desenha nada: só responde o que o código pergunta. */

const ouvintesJanela = {};
let hashAtual = "#/";

function elemento(seletor) {
  const el = {
    seletor,
    dataset: {},
    style: {},
    value: "",
    scrollTop: 0,
    clientHeight: 480,
    offsetParent: {},
    disabled: false,
    textContent: "",
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    focus() { global.document.activeElement = el; },
    blur() {},
    click() {},
    remove() {},
    contains() { return false; },
    scrollTo() {},
    scrollIntoView() {},
    setSelectionRange() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector(s) { return elemento(s); },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches() { return false; },
    getAttribute() { return null; },
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  return el;
}

global.document = {
  hidden: false,
  activeElement: null,
  body: elemento("body"),
  documentElement: elemento("html"),
  getElementById: (id) => elemento("#" + id),
  querySelector: (s) => elemento(s),
  querySelectorAll: () => [],
  createElement: (t) => elemento(t),
  addEventListener() {},
  removeEventListener() {},
  contains() { return false; },
};

global.window = {
  addEventListener(tipo, fn) { (ouvintesJanela[tipo] = ouvintesJanela[tipo] || []).push(fn); },
  removeEventListener() {},
  dispatch(tipo) { for (const fn of ouvintesJanela[tipo] || []) fn({ type: tipo }); },
};

global.location = {
  get hash() { return hashAtual; },
  set hash(v) {
    hashAtual = String(v).startsWith("#") ? String(v) : "#" + v;
    global.window.dispatch("hashchange");
  },
  replace(v) { this.hash = v; },
};

global.navigator = { onLine: true };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

global.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

global.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
global.MutationObserver = class {
  observe() {} disconnect() {}
};
global.URL = global.URL || {};
global.URL.createObjectURL = () => "blob:falso";
global.URL.revokeObjectURL = () => {};
global.Blob = global.Blob || class { constructor() {} };
