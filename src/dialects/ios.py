"""Parser do dialeto iOS: "[08/03/2026, 14:32:45] Autor: mensagem"."""

from __future__ import annotations

from src.detect import IOS_HEADER_RE
from src.dialects.base import BaseDialectParser


class IOSDialectParser(BaseDialectParser):
    platform = "ios"
    header_re = IOS_HEADER_RE
