"""Parser do dialeto Android: "08/03/2026 14:32 - Autor: mensagem"."""

from __future__ import annotations

from src.detect import ANDROID_HEADER_RE
from src.dialects.base import BaseDialectParser


class AndroidDialectParser(BaseDialectParser):
    platform = "android"
    header_re = ANDROID_HEADER_RE
