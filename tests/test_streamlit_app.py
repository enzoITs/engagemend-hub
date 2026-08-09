"""Testes da Fase 6: app Streamlit — upload em memória, preview pseudonimizado, download."""

from __future__ import annotations

from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from streamlit.testing.v1 import AppTest

APP_PATH = Path(__file__).resolve().parent.parent / "app" / "streamlit_app.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")
    monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())


def android_bytes() -> bytes:
    return (FIXTURES / "android_pt_br.txt").read_bytes()


def run_with_upload(
    group_name: str = "Comunidade Fixture",
    tz: str = "America/Sao_Paulo",
    filename: str = "android_pt_br.txt",
    content: bytes | None = None,
) -> AppTest:
    at = AppTest.from_file(str(APP_PATH))
    at.run()
    at.text_input[0].set_value(group_name)
    at.text_input[1].set_value(tz)
    at.file_uploader[0].set_value((filename, content if content is not None else android_bytes(), "text/plain"))
    at.run()
    return at


class TestNoFileUploaded:
    def test_shows_info_prompt(self):
        at = AppTest.from_file(str(APP_PATH)).run()
        assert not at.exception
        assert any("Envie um arquivo" in msg.value for msg in at.info)

    def test_no_download_buttons_without_upload(self):
        at = AppTest.from_file(str(APP_PATH)).run()
        assert len(at.download_button) == 0


class TestPseudonymizationNotice:
    def test_warning_always_shown(self):
        at = AppTest.from_file(str(APP_PATH)).run()
        assert any("pseudonimizados" in w.value for w in at.warning)


class TestValidUploadFlow:
    def test_no_exception(self):
        at = run_with_upload()
        assert not at.exception

    def test_success_message_shows_platform_and_counts(self):
        at = run_with_upload()
        assert any("android" in s.value and "20 mensagens" in s.value for s in at.success)

    def test_preview_dataframe_shown(self):
        at = run_with_upload()
        assert len(at.dataframe) == 1

    def test_download_buttons_present(self):
        at = run_with_upload()
        labels = {b.label for b in at.download_button}
        assert labels == {"Baixar JSON", "Baixar CSV"}

    def test_preview_contains_no_raw_identifiers(self):
        at = run_with_upload()
        rendered = "\n".join(str(el.value) for el in at.dataframe)
        assert "João Silva" not in rendered
        assert "Maria Costa" not in rendered

    def test_warnings_expander_lists_parse_warnings(self):
        at = run_with_upload()
        expander_labels = [e.label for e in at.expander]
        assert any("Avisos" in label for label in expander_labels)

    def test_no_rejected_expander_when_zero_rejected(self):
        # a fixture android não tem linhas rejeitadas
        at = run_with_upload()
        expander_labels = [e.label for e in at.expander]
        assert not any("Linhas rejeitadas" in label for label in expander_labels)


class TestMissingGroupName:
    def test_prompts_for_group_name_before_processing(self):
        at = AppTest.from_file(str(APP_PATH))
        at.run()
        at.file_uploader[0].set_value(("android_pt_br.txt", android_bytes(), "text/plain"))
        at.run()
        assert any("nome do grupo" in msg.value.lower() for msg in at.info)
        assert len(at.download_button) == 0


class TestEncodingFallback:
    def test_latin1_file_decoded_with_warning(self):
        content = "08/03/2026 14:32 - João Silva: café\n13/03/2026 09:05 - Maria Costa: açúcar\n14/03/2026 10:00 - João Silva: pão\n15/03/2026 11:00 - Maria Costa: maçã".encode(
            "latin-1"
        )
        at = run_with_upload(filename="latin1.txt", content=content)
        assert not at.exception
        assert any("latin-1" in w.value for w in at.warning)


class TestAmbiguousFileShowsError:
    def test_undetectable_file_shows_error_not_crash(self):
        content = b"isso nao e um export valido\noutra linha qualquer\n"
        at = run_with_upload(filename="ruim.txt", content=content)
        assert not at.exception
        assert any("detectar" in e.value.lower() for e in at.error)
        assert len(at.download_button) == 0


class TestFileTooLarge:
    def test_oversized_file_rejected(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MAX_UPLOAD_SIZE_MB", "0")
        at = run_with_upload()
        assert any("acima do limite" in e.value for e in at.error)
        assert len(at.download_button) == 0
