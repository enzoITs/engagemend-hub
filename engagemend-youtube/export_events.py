"""
Converte comentarios ja classificados (data/comentarios_classificados.json)
para o schema universal de eventos que o motor TypeScript em
engagemend-discord (src/ingest/youtube.ts) sabe ler.

Schema universal (um evento por comentario):
    event_id, platform, author_id, author_display_name, content_id,
    published_at, quality_score, categorias

quality_score vem do CategoryWeightedScorer, que reaproveita a
classificacao Groq ja feita (categorias + score_engajamento) sem gastar
token novo nenhum.
"""

import json

import pandas as pd

from scoring_engine import CategoryWeightedScorer

UNIVERSAL_EVENTS_PATH = "./data/youtube_events.json"


def comments_to_universal_events(classified: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(classified)
    scorer = CategoryWeightedScorer()
    comentarios = [
        {"categorias": cats, "score_engajamento": score}
        for cats, score in zip(
            df.get("categorias", [[]] * len(df)),
            df.get("score_engajamento", [None] * len(df)),
        )
    ]
    df["quality_score"] = scorer.score_batch(comentarios)

    categorias = df["categorias"].apply(lambda c: ",".join(c) if isinstance(c, list) else (c or ""))

    events = pd.DataFrame(
        {
            "event_id": df["comment_id"],
            "platform": "youtube",
            "author_id": df["author"],
            "author_display_name": df["author"],
            "content_id": df["video_id"],
            "published_at": df["published_at"],
            "quality_score": df["quality_score"],
            "categorias": categorias,
        }
    )
    # comentarios duplicados/reextraidos (mesmo event_id) so entram uma vez.
    return events.drop_duplicates("event_id")


def export_universal_events(classified: list[dict], output_path: str = UNIVERSAL_EVENTS_PATH) -> None:
    events = comments_to_universal_events(classified)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(events.to_dict(orient="records"), f, ensure_ascii=False, indent=2)
    print(f"Eventos no schema universal salvos em: {output_path} ({len(events)} eventos)")
