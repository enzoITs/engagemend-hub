"""Interface de upload (Streamlit, Fase 6).

O arquivo original enviado nunca é gravado em disco — nem no upload, nem em
nenhum artefato temporário. Todo o processamento acontece em memória, sobre
`bytes`/`str` mantidos apenas durante o ciclo desta requisição; as
referências ao conteúdo bruto são soltas assim que o parsing termina, para
que fiquem elegíveis a coleta de lixo o quanto antes (não há como forçar
liberação imediata de memória em Python — isso é melhor esforço, não uma
garantia criptográfica).

O preview mostrado antes do download já é o resultado pseudonimizado —
nenhum identificador em claro chega a aparecer na tela.

⚠️ **Limite de tamanho de upload**: `MAX_UPLOAD_SIZE_MB` (env var, ver
`.env.example`) só controla a checagem *dentro* deste app. O Streamlit tem
seu próprio limite de servidor (`server.maxUploadSize`, default 200 MB),
que rejeita uploads maiores *antes* deste código rodar. Para grupos grandes
(exports > 200 MB), ajuste também `.streamlit/config.toml` — mudar só a env
var daqui não é suficiente.
"""

from __future__ import annotations

import json
import os

import streamlit as st
from dotenv import load_dotenv

from src.detect import DetectionError
from src.export import DEFAULT_TIMEZONE, build_records, records_to_csv_string, records_to_json_string
from src.normalize import parse_export

load_dotenv()

MAX_UPLOAD_SIZE_MB = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "200"))
PREVIEW_ROWS = 20

st.set_page_config(page_title="Pipeline WhatsApp", page_icon="📊")
st.title("Pipeline de Coleta e Anonimização de Conversas de WhatsApp")

st.warning(
    "Este processo produz dados **pseudonimizados**, não anonimizados — a "
    "organização retém a chave de hash para poder re-identificar um membro "
    "quando necessário. A LGPD continua se aplicando integralmente a este "
    "dataset."
)

group_name = st.text_input("Nome do grupo", help="Usado para derivar group_hash — não é gravado em claro na saída.")
tz_name = st.text_input("Timezone (IANA)", value=DEFAULT_TIMEZONE)
uploaded_file = st.file_uploader(
    "Exportação do WhatsApp (.txt)",
    type=["txt"],
    help=f"Tamanho máximo: {MAX_UPLOAD_SIZE_MB} MB. O arquivo nunca é salvo em disco.",
)

if uploaded_file is None:
    st.info("Envie um arquivo .txt exportado do WhatsApp para começar.")
    st.stop()

size_mb = uploaded_file.size / (1024 * 1024)
if size_mb > MAX_UPLOAD_SIZE_MB:
    st.error(f"Arquivo tem {size_mb:.1f} MB, acima do limite configurado de {MAX_UPLOAD_SIZE_MB} MB.")
    st.stop()

if not group_name:
    st.info("Informe o nome do grupo para continuar.")
    st.stop()

raw_bytes = uploaded_file.getvalue()  # em memória; nunca gravado em disco
text: str | None = None
used_encoding = None
for encoding in ("utf-8", "latin-1"):
    try:
        text = raw_bytes.decode(encoding)
        used_encoding = encoding
        break
    except UnicodeDecodeError:
        continue
del raw_bytes

if text is None:
    st.error("Não foi possível decodificar o arquivo (tentado UTF-8 e Latin-1).")
    st.stop()

if used_encoding != "utf-8":
    st.warning(f"Arquivo decodificado como {used_encoding}, não UTF-8 (esperado para exports antigos).")

lines = text.splitlines()
del text

try:
    parsed = parse_export(lines)
except DetectionError as exc:
    st.error(f"Não foi possível detectar plataforma/locale com confiança: {exc}")
    st.stop()
finally:
    del lines

try:
    records = build_records(parsed.result, group_name, parsed.platform, tz_name=tz_name)
except KeyError as exc:
    st.error(f"Variável de ambiente ausente: {exc}. Configure ANON_HMAC_KEY (ver .env.example).")
    st.stop()

st.success(
    f"Plataforma detectada: **{parsed.platform}** (confiança "
    f"{parsed.detection_confidence:.0%}) — {len(records)} mensagens processadas, "
    f"{len(parsed.result.rejected)} rejeitadas, {len(parsed.result.warnings)} avisos."
)

st.subheader(f"Preview — pseudonimizado (primeiras {PREVIEW_ROWS} de {len(records)} linhas)")
preview_rows = [json.loads(r.model_dump_json()) for r in records[:PREVIEW_ROWS]]
st.dataframe(preview_rows, width="stretch")

json_string = records_to_json_string(records)
csv_string = records_to_csv_string(records)

col1, col2 = st.columns(2)
with col1:
    st.download_button(
        "Baixar JSON",
        data=json_string,
        file_name="output.json",
        mime="application/json",
    )
with col2:
    st.download_button(
        "Baixar CSV",
        data=csv_string,
        file_name="output.csv",
        mime="text/csv",
    )

if parsed.result.rejected:
    with st.expander(f"Linhas rejeitadas ({len(parsed.result.rejected)})"):
        for r in parsed.result.rejected:
            st.text(f"linha {r.line_number}: {r.reason} — preview: {r.redacted_preview!r}")

if parsed.result.warnings:
    with st.expander(f"Avisos ({len(parsed.result.warnings)})"):
        for w in parsed.result.warnings:
            st.text(f"linha {w.line_number}: {w.message}")

st.caption(
    "O relatório de autores e o mapping.json (re-identificação controlada) "
    "não são gerados por esta interface — use o CLI (`python -m src.cli`) "
    "quando precisar deles; eles vivem num cofre cifrado fora desta sessão."
)
