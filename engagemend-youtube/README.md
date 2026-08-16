# engagemend-youtube

Extração de comentários do YouTube (e mensagens do WhatsApp), classificação
por engajamento via Groq LLM, e export pro schema universal de eventos que
`engagemend-discord` ingere. É a metade Python do EngageMend — o motor de
pontuação (eixos, portas, histerese) mora em `engagemend-discord`; aqui só
tem extração, classificação e o `quality_score` que alimenta o motor.

Migrado de `projetos/ext` como parte da fusão num motor de engajamento
único (Discord + YouTube + WhatsApp).

## Setup

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencher YOUTUBE_API_KEY e GROQ_API_KEY (GROQ_API_KEY_2 opcional)
```

## Pipeline

```bash
python main.py <CHANNEL_ID>   # extrai -> classifica -> ChromaDB -> data/youtube_events.json
```

`data/youtube_events.json` é o arquivo que `engagemend-discord` lê via
`npx tsx src/cli/ingest-youtube.ts --file ../engagemend-youtube/data/youtube_events.json --channel-id <CHANNEL_ID> --channel-name "<nome>"`.

## O que NÃO está mais aqui

`decay_engine.py`, `build_engagement_state.py`, `app.py` (Streamlit) e
`engagement.db` do `ext` original foram aposentados — o motor de
pontuação (decaimento, eixos, níveis, histerese) agora é só o de
`engagemend-discord/src/classifier/*.ts`. Este pacote só produz o
`quality_score` por evento; quem decide nível é o motor TS.
