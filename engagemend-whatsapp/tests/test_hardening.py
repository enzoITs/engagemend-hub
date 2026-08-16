"""Fase 7 — Endurecimento: os 7 casos de borda obrigatórios do documento.

1. arquivo vazio
2. arquivo truncado no meio de uma mensagem
3. encoding Latin-1
4. export de conversa individual (não grupo)
5. arquivo de 200 MB
6. arquivo com apenas mensagens de sistema
7. arquivo com um único autor
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from src.cli import CliError, read_export_file, run
from src.detect import DetectionError
from src.export import build_records
from src.normalize import parse_export
from src.report import build_author_report

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")
    monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())


def load_lines(name: str) -> list[str]:
    return FIXTURES.joinpath(name).read_text(encoding="utf-8").splitlines()


# ---------------------------------------------------------------------------
# 1. Arquivo vazio
# ---------------------------------------------------------------------------


class TestEmptyFile:
    def test_parse_export_raises_detection_error_not_crash(self):
        with pytest.raises(DetectionError):
            parse_export([])

    def test_cli_returns_error_exit_code_not_traceback(self, tmp_path: Path):
        empty_file = tmp_path / "vazio.txt"
        empty_file.write_text("", encoding="utf-8")
        exit_code = run(
            [
                str(empty_file),
                "--grupo",
                "Comunidade",
                "--saida",
                str(tmp_path / "output"),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ]
        )
        assert exit_code == 1

    def test_read_export_file_empty_returns_empty_list(self, tmp_path: Path):
        empty_file = tmp_path / "vazio.txt"
        empty_file.write_text("", encoding="utf-8")
        assert read_export_file(empty_file) == []


# ---------------------------------------------------------------------------
# 2. Arquivo truncado no meio de uma mensagem
# ---------------------------------------------------------------------------


class TestTruncatedFile:
    def test_truncated_mid_continuation_text_no_crash_no_full_loss(self):
        # corta a fixture Android bem no meio da linha de continuação
        # "Ainda não tive retorno, pode me confirmar?"
        raw = FIXTURES.joinpath("android_pt_br.txt").read_text(encoding="utf-8")
        cut_point = raw.index("Ainda não tive ret") + len("Ainda não tive ret")
        truncated = raw[:cut_point]
        lines = truncated.splitlines()

        parsed = parse_export(lines)  # não deve lançar
        assert len(parsed.result.messages) >= 5
        assert parsed.result.rejected == []
        # a última mensagem parseada contém o fragmento truncado, não é perdida
        last_message = parsed.result.messages[-1]
        assert "Ainda não tive ret" in (last_message.raw_text or "")

    def test_truncated_mid_header_line_does_not_crash(self):
        # corta uma linha de cabeçalho pela metade -- não deve dar exceção;
        # como não casa com o header regex completo, vira continuação da
        # mensagem anterior (armadilha #2) ou rejeitada se for a 1ª linha.
        lines = [
            "08/03/2026 09:00 - João Silva: mensagem completa",
            "13/03/2026 10:1",  # cabeçalho cortado no meio
        ]
        parser_result = parse_export(lines + load_lines("android_pt_br.txt")[:5])
        assert parser_result  # não lançou exceção

    def test_truncated_file_still_exports_successfully(self, tmp_path: Path):
        raw = FIXTURES.joinpath("android_pt_br.txt").read_text(encoding="utf-8")
        truncated = raw[: len(raw) // 2]
        truncated_file = tmp_path / "truncado.txt"
        truncated_file.write_text(truncated, encoding="utf-8")

        exit_code = run(
            [
                str(truncated_file),
                "--grupo",
                "Comunidade",
                "--saida",
                str(tmp_path / "output"),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ]
        )
        assert exit_code == 0
        assert (tmp_path / "output" / "output.json").exists()


# ---------------------------------------------------------------------------
# 3. Encoding Latin-1
# ---------------------------------------------------------------------------


class TestLatin1Encoding:
    def test_full_pipeline_over_latin1_fixture(self, tmp_path: Path):
        content = (
            "08/03/2026 09:00 - As mensagens e as ligações são protegidas com "
            "criptografia de ponta a ponta.\n"
            "13/03/2026 10:15 - João Silva: café da manhã, açaí e pão de queijo\n"
            "14/03/2026 08:00 - Maria Costa: até mais tarde, combinado então\n"
            "15/03/2026 11:30 - João Silva: última atualização do projeto\n"
        )
        latin1_file = tmp_path / "latin1.txt"
        latin1_file.write_bytes(content.encode("latin-1"))

        lines = read_export_file(latin1_file)
        parsed = parse_export(lines)
        records = build_records(parsed.result, "Comunidade", parsed.platform)
        assert len(records) == 4
        # o texto acentuado sobreviveu à decodificação (não virou lixo)
        assert any(m.raw_text and "café" in m.raw_text for m in parsed.result.messages)


# ---------------------------------------------------------------------------
# 4. Export de conversa individual (não grupo)
# ---------------------------------------------------------------------------


class TestIndividualChat:
    def test_individual_chat_parses_like_a_group(self):
        lines = load_lines("individual_chat_android.txt")
        parsed = parse_export(lines)
        assert parsed.result.rejected == []
        assert len(parsed.result.messages) == 8

    def test_individual_chat_has_exactly_two_authors(self):
        lines = load_lines("individual_chat_android.txt")
        parsed = parse_export(lines)
        authors = {m.author for m in parsed.result.messages if m.author is not None}
        assert authors == {"João Silva", "Maria Costa"}

    def test_individual_chat_exports_successfully(self):
        lines = load_lines("individual_chat_android.txt")
        parsed = parse_export(lines)
        records = build_records(parsed.result, "João Silva", parsed.platform)
        assert len(records) == 8
        assert any(r.message_type == "deleted" for r in records)
        assert any(r.message_type == "media_image" for r in records)


# ---------------------------------------------------------------------------
# 5. Arquivo de 200 MB
# ---------------------------------------------------------------------------

_TARGET_SIZE_BYTES = 200 * 1024 * 1024


def _generate_large_android_file(path: Path, target_bytes: int) -> int:
    """Gera um arquivo `.txt` sintético em formato Android até atingir
    `target_bytes`. Retorna o número de mensagens escritas."""
    authors = ["João Silva", "Maria Costa", "Pedro Santos", "+55 14 99999-9999"]
    template = "{day:02d}/03/2026 {hour:02d}:{minute:02d} - {author}: mensagem número {n} com algum texto de exemplo\n"

    written = 0
    n = 0
    with path.open("w", encoding="utf-8") as f:
        while written < target_bytes:
            n += 1
            line = template.format(
                day=(n % 28) + 1,
                hour=(n % 24),
                minute=(n % 60),
                author=authors[n % len(authors)],
                n=n,
            )
            f.write(line)
            written += len(line)
    return n


@pytest.mark.slow
class TestTwoHundredMegabyteFile:
    def test_processes_200mb_file_without_crashing(self, tmp_path: Path):
        big_file = tmp_path / "grande.txt"
        message_count = _generate_large_android_file(big_file, _TARGET_SIZE_BYTES)
        assert big_file.stat().st_size >= _TARGET_SIZE_BYTES

        start = time.monotonic()
        lines = read_export_file(big_file)
        parsed = parse_export(lines)
        elapsed = time.monotonic() - start

        assert parsed.result.rejected == []
        assert len(parsed.result.messages) == message_count
        # não é um limite rígido de SLA, só uma garantia de que não travou
        assert elapsed < 300, f"processamento de 200MB levou {elapsed:.1f}s"


# ---------------------------------------------------------------------------
# 6. Arquivo com apenas mensagens de sistema
# ---------------------------------------------------------------------------


class TestSystemOnlyFile:
    def test_all_messages_classified_as_system(self):
        lines = load_lines("system_only_android.txt")
        parsed = parse_export(lines)
        assert parsed.result.rejected == []
        assert all(m.message_type == "system" for m in parsed.result.messages)
        assert all(m.author is None for m in parsed.result.messages)

    def test_author_report_is_empty(self):
        lines = load_lines("system_only_android.txt")
        parsed = parse_export(lines)
        report = build_author_report(parsed.result.messages)
        assert report == []

    def test_exports_successfully_with_all_null_author_hash(self):
        lines = load_lines("system_only_android.txt")
        parsed = parse_export(lines)
        records = build_records(parsed.result, "Comunidade", parsed.platform)
        assert len(records) > 0
        assert all(r.author_hash is None for r in records)
        assert len({r.group_hash for r in records}) == 1


# ---------------------------------------------------------------------------
# 7. Arquivo com um único autor
# ---------------------------------------------------------------------------


class TestSingleAuthorFile:
    def test_all_non_system_messages_share_one_author(self):
        lines = load_lines("single_author_android.txt")
        parsed = parse_export(lines)
        authors = {m.author for m in parsed.result.messages if m.author is not None}
        assert authors == {"João Silva"}

    def test_author_report_has_exactly_one_entry(self):
        lines = load_lines("single_author_android.txt")
        parsed = parse_export(lines)
        report = build_author_report(parsed.result.messages)
        assert len(report) == 1
        assert report[0].raw_identifier == "João Silva"
        assert report[0].message_count == 6  # todas as não-sistema

    def test_all_author_hashes_identical(self):
        lines = load_lines("single_author_android.txt")
        parsed = parse_export(lines)
        records = build_records(parsed.result, "Comunidade", parsed.platform)
        author_hashes = {r.author_hash for r in records if r.author_hash is not None}
        assert len(author_hashes) == 1
