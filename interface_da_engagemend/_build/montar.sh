#!/bin/sh
# Monta os dois HTMLs a partir das mesmas 13 partes.
#
#   sh _build/montar.sh
#
#   engagemend-painel-v4.html        FONTE_DE_DADOS = "mock"     (dados falsos)
#   engagemend-painel-v4-real.html   FONTE_DE_DADOS = "arquivo"  (export do bot)
#
# A segunda saída é a MESMA build com uma linha trocada — é a prova de que a
# fronteira do §6 é de uma linha só, e não uma promessa.
#
# Concatenação byte a byte: `00-head.part` carrega as fontes Geist em base64 e
# reescrever a codificação estraga o arquivo. `00-meta.part` vem primeiro, senão
# o navegador decodifica como Latin-1 e a página abre em branco.

set -e
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)

PARTES="00-meta.part 00-head.part 10-css.part 20-icones.part 25-logo.part
        30-fundacao.js 40-mock.js 50-cliente.js 60-regua.js 70-query.js
        80-shell.js 85-telas.js 90-testes.js"

montar() {
  destino="$1"
  fonte="$2"
  : > "$destino"
  for p in $PARTES; do
    if [ "$p" = "50-cliente.js" ] && [ "$fonte" != "mock" ]; then
      sed "s/^const FONTE_DE_DADOS = \"mock\";/const FONTE_DE_DADOS = \"$fonte\";/" \
        "$AQUI/$p" >> "$destino"
    else
      cat "$AQUI/$p" >> "$destino"
    fi
  done
  printf '%s — %s bytes (FONTE_DE_DADOS=%s)\n' \
    "$(basename "$destino")" "$(wc -c < "$destino" | tr -d ' ')" "$fonte"
}

montar "$RAIZ/engagemend-painel-v4.html" mock
montar "$RAIZ/engagemend-painel-v4-real.html" arquivo
montar "$RAIZ/engagemend-painel-v4-http.html" http
