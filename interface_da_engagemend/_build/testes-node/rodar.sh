#!/bin/sh
# Roda §11 fora do navegador. Prova lógica; NÃO prova tela — ver a seção
# "Como testar NO navegador" do HANDOFF.md, que continua obrigatória.
#
#   sh _build/testes-node/rodar.sh
#
# Monta uma cópia só-JS das partes (sem 00-meta/00-head/10-css, que são HTML),
# com ICONES e LOGO_ENGAGEMEND vazios no lugar das duas partes verbatim, e com
# o </script> final de 90-testes.js cortado.

set -e
AQUI=$(cd "$(dirname "$0")" && pwd)
B=$(cd "$AQUI/.." && pwd)
SAIDA="${TMPDIR:-/tmp}/engagemend-suite.js"

{
  printf 'const ICONES = {};\nconst LOGO_ENGAGEMEND = "";\n'
  cat "$AQUI/dom.js"
  cat "$B/30-fundacao.js" "$B/40-mock.js" "$B/50-cliente.js" "$B/60-regua.js" \
      "$B/70-query.js" "$B/80-shell.js" "$B/85-telas.js"
  sed 's|</script>||' "$B/90-testes.js"
  cat "$AQUI/driver.js"
} > "$SAIDA"

exec node "$SAIDA"
