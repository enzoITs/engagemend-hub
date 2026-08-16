
Testes.rodar().then((r) => {
  console.log(">>> RESULTADO: " + r.passou + " passaram, " + r.falhou + " falharam, " + r.ms + "ms");
  process.exit(r.falhou === 0 ? 0 : 1);
}).catch((e) => {
  console.error("EXPLODIU:", e);
  process.exit(2);
});
