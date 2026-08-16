"""Interface de linha de comando (Fase 5).

Uso:
    python -m src.cli entrada.txt --grupo "Nome do Grupo" --saida ./output

Responsável pela camada de leitura de arquivo que as fases anteriores
deliberadamente não tocam: decodificação com fallback UTF-8 → Latin-1
(armadilha #8) e carregamento de `.env`. Todo o resto é delegado aos
módulos das fases anteriores — este arquivo só orquestra.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from src.anonymize import write_mapping
from src.detect import DetectionError
from src.export import DEFAULT_TIMEZONE, build_manifest, build_records, hash_file, write_csv, write_json, write_manifest
from src.normalize import parse_export
from src.report import build_author_report, write_author_report, write_unparsed_log
from src.secure_store import read_encrypted_json

logger = logging.getLogger("whatsapp_pipeline")

DEFAULT_MAPPING_STORE_DIR = Path("./secure/mapping")


class CliError(Exception):
    """Erro operacional acionável pelo usuário — não é um bug do parser."""


def read_export_file(path: Path, encodings: tuple[str, ...] = ("utf-8", "latin-1")) -> list[str]:
    """Lê o `.txt` exportado, tentando cada encoding em `encodings` em ordem
    (armadilha #8: exports antigos/reprocessados podem não ser UTF-8).
    Falha com mensagem clara se nenhum decodificar.

    Nota: Latin-1 (ISO-8859-1) mapeia todo byte 0x00-0xFF para um caractere
    válido, então na prática nunca falha — o fallback real acontece contra
    UTF-8 quebrado. O parâmetro `encodings` existe para permitir testar o
    caminho de falha explicitamente, sem depender de um encoding hipotético
    que não existe no mundo real.
    """
    try:
        raw_bytes = path.read_bytes()
    except FileNotFoundError as exc:
        raise CliError(f"arquivo não encontrado: {path}") from exc

    for encoding in encodings:
        try:
            text = raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
        if encoding != "utf-8":
            logger.warning("%s decodificado como %s, não UTF-8 (esperado para exports antigos)", path, encoding)
        return text.splitlines()

    raise CliError(f"não foi possível decodificar {path} com nenhum dos encodings tentados: {', '.join(encodings)}")


def _update_mapping_store(raw_identifiers: set[str], mapping_path: Path) -> None:
    """Lê o mapping.json existente (se houver), soma os identificadores desta
    execução e regrava — acumulativo entre execuções, nunca perde entradas
    antigas. Recalcular o hash de identificadores já conhecidos é um no-op
    (mesma chave HMAC estável do projeto produz o mesmo hash de novo)."""
    existing: dict[str, str] = {}
    if mapping_path.exists():
        try:
            existing = read_encrypted_json(mapping_path)
        except Exception:
            logger.warning("não foi possível ler mapping.json existente em %s; será recriado do zero", mapping_path)

    all_identifiers = set(existing.keys()) | raw_identifiers
    write_mapping(all_identifiers, mapping_path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Constrói o parser de argumentos.

    O default de `--mapping-dir` lê `MAPPING_STORE_DIR` do ambiente (já
    carregado de `.env` por `run()` antes de chamar esta função), caindo
    para `DEFAULT_MAPPING_STORE_DIR` se a variável não estiver definida —
    assim o `.env.example` e o CLI não divergem sobre onde o cofre mora.
    """
    parser = argparse.ArgumentParser(
        prog="whatsapp-pipeline",
        description="Pipeline de coleta e anonimização de conversas de WhatsApp.",
    )
    parser.add_argument("input_file", type=Path, help="Arquivo .txt exportado do WhatsApp")
    parser.add_argument("--grupo", required=True, help="Nome do grupo (usado para derivar group_hash)")
    parser.add_argument("--saida", type=Path, default=Path("./output"), help="Diretório de saída (default: ./output)")
    parser.add_argument(
        "--formato", choices=["csv", "json", "ambos"], default="ambos", help="Formato de exportação (default: ambos)"
    )
    parser.add_argument(
        "--tz", default=DEFAULT_TIMEZONE, help=f"Timezone IANA para os timestamps (default: {DEFAULT_TIMEZONE})"
    )
    parser.add_argument(
        "--mapping-dir",
        type=Path,
        default=Path(os.environ.get("MAPPING_STORE_DIR", str(DEFAULT_MAPPING_STORE_DIR))),
        help=f"Diretório do cofre cifrado (mapping.json e relatório de autores) "
        f"(default: $MAPPING_STORE_DIR ou {DEFAULT_MAPPING_STORE_DIR})",
    )
    parser.add_argument(
        "--log-level", choices=["DEBUG", "INFO", "WARNING", "ERROR"], default="INFO", help="Nível de log (default: INFO)"
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    load_dotenv()  # antes de parse_args(): --mapping-dir lê MAPPING_STORE_DIR do ambiente
    args = parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(levelname)s %(name)s: %(message)s")

    try:
        lines = read_export_file(args.input_file)
    except CliError as exc:
        logger.error(str(exc))
        return 1

    try:
        parsed = parse_export(lines)
    except DetectionError as exc:
        logger.error("falha na detecção de plataforma/locale: %s", exc)
        return 1

    args.saida.mkdir(parents=True, exist_ok=True)

    try:
        records = build_records(parsed.result, args.grupo, parsed.platform, tz_name=args.tz)
    except KeyError as exc:
        logger.error(
            "variável de ambiente ausente (%s) — configure ANON_HMAC_KEY e "
            "MAPPING_ENCRYPTION_KEY (ver .env.example)",
            exc,
        )
        return 1

    if args.formato in ("json", "ambos"):
        write_json(records, args.saida / "output.json")
    if args.formato in ("csv", "ambos"):
        write_csv(records, args.saida / "output.csv")

    write_unparsed_log(parsed.result.rejected, args.saida / "unparsed.log")

    manifest = build_manifest(parsed.result, hash_file(args.input_file), parsed.platform)
    write_manifest(manifest, args.saida / "manifest.json")

    args.mapping_dir.mkdir(parents=True, exist_ok=True)
    raw_identifiers = {args.grupo} | {m.author for m in parsed.result.messages if m.author is not None}
    _update_mapping_store(raw_identifiers, args.mapping_dir / "mapping.json")

    author_report = build_author_report(parsed.result.messages)
    write_author_report(author_report, args.mapping_dir / "author_report.json")

    logger.info(
        "processado: %d mensagens, %d rejeitadas, %d warnings -> %s",
        len(parsed.result.messages),
        len(parsed.result.rejected),
        len(parsed.result.warnings),
        args.saida,
    )
    for warning in parsed.result.warnings:
        logger.warning("linha %d: %s", warning.line_number, warning.message)

    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
