# EngageMend

Produto de análise de engajamento de comunidade multiplataforma (Discord + YouTube, WhatsApp de carona). Mede engajamento de verdade — não likes: 14+ tipos de ação, decaimento no tempo, 4 eixos (consumo/produção/reciprocidade/influência), 5 níveis com **portas de eixo** (pontuação sozinha não promove — quem manda 300 mensagens sem receber resposta nenhuma não vira "Líder", porque a porta de influência barra).

Este é o repositório guarda-chuva: reúne os três projetos como **git submodules**, cada um com histórico próprio. Ele existe pra dar um checkpoint único do estado atual e um ponto de entrada pra quem for continuar o trabalho.

## Checkpoint atual (2026-08-16)

Acabou de sair da Fase 1 (motor único de eixos/portas, YouTube+Discord fundidos, validado 6/6 membros contra conferência manual) pra Fase 2 (hub multiusuário: cadastro por magic link, cada pessoa conecta suas próprias comunidades, API HTTP real, um `docker compose up`). A Fase 2 foi implementada por um agente (Codex) seguindo o plano em `projetos/ext/docs/superpowers/plans/2026-08-16-engagemend-hub-multiusuario.md`, task por task, TDD.

**Estado da Fase 2 neste checkpoint:**
- Schema multiusuário (`User`/`Session`/`MagicLinkToken`/`Job`), autenticação por magic link (Resend), fila de job serializada em Postgres, worker (YouTube subprocess + Discord backfill in-process), coletor Discord multi-guild, API HTTP completa (`ADAPTADOR_HTTP` dos 18 métodos do painel implementado), Dockerfile + docker-compose de imagem única — tudo commitado em `engagemend-discord/` e `interface_da_engagemend/`.
- `pnpm typecheck` limpo.
- `pnpm test` tem **3 falhas conhecidas, ainda não corrigidas**: `tests/http-comunidades.test.ts` (timeout de 5s no setup), `tests/http-conexoes.test.ts::duplicado devolve 409` (ordem de `DELETE` no `beforeEach` viola FK RESTRICT `communities_ownerId_fkey` — precisa deletar `community` antes de `user`, ou o teste roda em paralelo com outro e colide), `tests/worker-youtube-sync.test.ts::sucesso ingere, classifica e conclui`. Isso é o próximo trabalho, não o fim da tarefa.
- Verificação ponta a ponta manual (Task 16 do plano — magic link real, canal YouTube real, servidor Discord real, isolamento entre dois usuários) **ainda não foi feita**.

Leia o plano inteiro antes de mexer em qualquer coisa da Fase 2 — cada task documenta a decisão de design por trás (por que sem Redis, por que `syncState` usa os valores do front e não `"ok"`, por que `PUT /configuracoes` não existe ainda, etc.).

## Estrutura

| Pasta | O que é | Stack |
|---|---|---|
| `engagemend-discord/` | Motor (eixos/portas/histerese), coletor Discord multi-guild, worker de jobs, API HTTP, entrypoint Docker | TypeScript, Prisma/Postgres, discord.js, Fastify |
| `engagemend-youtube/` | Extração de comentários (YouTube Data API) + classificação de qualidade (Groq) + export pro schema universal de evento | Python |
| `engagemend-whatsapp/` | Pipeline de coleta e anonimização de exports `.txt` de grupo de WhatsApp → dataset pseudonimizado (contrato `v1.0.0`), sem conteúdo de mensagem, só metadado | Python, pydantic, Streamlit |
| `interface_da_engagemend/` | Painel — um HTML só, montado por concatenação de partes em `_build/` | HTML/CSS/JS vanilla, sem build tool |

Repositório único — cada pasta acima carrega o histórico de commits do projeto original que a originou (mergeado via `git read-tree --prefix`), mas a partir daqui vivem num só `.git`, sem submodules.

`engagemend-discord/src/ingest/youtube.ts` é o elo entre os dois motores: lê o `data/youtube_events.json` que o pipeline Python exporta e grava no mesmo Postgres/schema Prisma que o coletor Discord usa — depois disso os dois são indistinguíveis pro classificador (`src/classifier/*.ts`), que roda uma vez só sobre tudo.

`engagemend-discord/src/ingest/whatsapp.ts` faz o mesmo elo pro WhatsApp: lê o `output.json` que `engagemend-whatsapp/src/cli.py` produz (mensagem por mensagem, já pseudonimizada por HMAC própria do pipeline) e mapeia pro `MemberEvent` universal — `message_sent`/`message_substantial`/`media_posted`/`mention_received`, mesmos tipos e pesos que Discord e YouTube já usam em `src/classifier/weights.ts`. Diferença de fonte: WhatsApp não tem API, então não existe coletor nem backfill automático — o usuário sobe o `.txt` exportado manualmente via `POST /conexoes/whatsapp` (multipart), o worker roda o pipeline Python num job (`whatsapp_sync`) e apaga o `.txt` do disco assim que termina, dando certo ou errado. Sem metadado de resposta citada na fonte (lacuna documentada no README do pipeline), não existem `reply_given`/`reply_received` para eventos de WhatsApp.

## Como rodar

### Tudo junto (produção/demo, Fase 2)

```bash
cd engagemend-discord
cp .env.example .env   # preencher secrets — ver tabela abaixo
docker compose up --build
```

Sobe Postgres + o app (HTTP na porta 3000, gateway Discord multi-guild, worker de jobs) num container só.

### Cada peça isolada (desenvolvimento)

**`engagemend-discord/`** (motor + coletor + API):
```bash
pnpm install
cp .env.example .env
pnpm prisma migrate dev
pnpm test          # Vitest — bate em Postgres real, não mocka Prisma
pnpm typecheck
pnpm start          # entrypoint de produção (src/server.ts)
# ou, fora do fluxo do site:
pnpm collect        # coletor Discord ao vivo
pnpm backfill --guild <id>
pnpm classify
pnpm report --export=json
```

**`engagemend-youtube/`** (pipeline Python, zero mudança de código na Fase 2):
```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp env.example .env   # YOUTUBE_API_KEY, GROQ_API_KEY
python main.py <CHANNEL_ID>
pytest test_scoring_engine.py -v
```

**`engagemend-whatsapp/`** (pipeline Python — coleta e anonimização):
```bash
python -m venv venv && source venv/bin/activate
pip install -e .
cp .env.example .env   # ANON_HMAC_KEY, MAPPING_ENCRYPTION_KEY (gerar, nunca reaproveitar)
python -m src.cli export.txt --grupo "Nome do Grupo" --saida ./output --formato json
pytest
```
Rodar isolado só gera o `output.json` pseudonimizado (contrato `v1.0.0`, ver `schema/v1.0.0.json`). Pra entrar no motor de pontuação, o caminho é via HUB (`POST /conexoes/whatsapp`, ver abaixo) — o job `whatsapp_sync` chama esse mesmo CLI e ingere o resultado.

**`interface_da_engagemend/`** (painel):
```bash
sh _build/montar.sh   # concatena as partes — gera as 3 variantes (mock, arquivo, http)
```
Concatenação é **byte a byte**, nunca por texto — `00-head.part` carrega fontes em base64.

## Variáveis de ambiente (visão geral)

Cada submodule tem seu `.env.example`. As que a Fase 2 acrescentou em `engagemend-discord/`:

| Variável | Pra quê |
|---|---|
| `DISCORD_CLIENT_ID` | Monta a URL de convite OAuth do bot (escopo `bot`, não login) |
| `RESEND_API_KEY` | Envio do magic link |
| `PUBLIC_URL` | Base dos links de confirmação/callback |
| `YOUTUBE_API_KEY` | Servidor usa pra `channels.list` (nome/thumbnail) antes de enfileirar o job — pipeline Python usa a própria via seu `.env` |
| `DISCORD_GUILD_ID` | Virou **opcional** — só default de `--guild` nos CLIs; guild real é dado de runtime por evento/job |
| `WHATSAPP_PIPELINE_DIR` | Onde `spawnWhatsappPipeline` roda `python -m src.cli` — default resolve `../../../engagemend-whatsapp/` a partir do próprio arquivo (funciona local); em Docker é `/app/engagemend-whatsapp` (setado no `docker-compose.yml`) |
| `WHATSAPP_JOB_DATA_ROOT` | Onde o `.txt` de upload e o `output.json` do job ficam até o worker consumir e apagar — default `./data/whatsapp-jobs` |
| `ANON_HMAC_KEY` / `MAPPING_ENCRYPTION_KEY` | Do `engagemend-whatsapp/`, não do hub — mas em Docker precisam vir como variável de ambiente do container `app` (o `.env` do pipeline é gitignored e não entra na imagem) |

`MEMBER_ID_SALT` continua irreversível na prática — trocar reescreve o espaço de hashes e órfã o histórico já coletado. Nunca versionar `.env`.

## O que falta (nesta ordem)

1. Corrigir as 3 falhas de teste listadas acima.
2. Rodar a Task 16 do plano (verificação ponta a ponta manual): magic link real, canal YouTube real, servidor Discord real via OAuth, confirmar isolamento entre dois usuários.
3. `engagemend-whatsapp/` acabou de entrar (`git read-tree --prefix`, mesmo padrão dos outros dois) e o backend do hub já ingere (`src/ingest/whatsapp.ts`, job `whatsapp_sync`, rota `POST /conexoes/whatsapp`) — falta:
   - `pnpm install` em `engagemend-discord/` (adicionei `@fastify/multipart` ao `package.json`, o lockfile não foi regenerado nesta sessão — sem rede/pnpm no ambiente).
   - Tela de upload no painel: `ADAPTADOR_HTTP` continua **vago** (LEIA-ME §4) — a rota de WhatsApp já existe no backend, mas nenhuma tela chama ela ainda. Escrever `ADAPTADOR_HTTP` inteiro (as 18 rotas + esta nova) segue sendo o maior buraco do painel.
   - Rodar contra um export `.txt` real pra validar a detecção de dialeto/locale — o pipeline nunca viu dado de produção, só fixtures sintéticas.
4. Fora de escopo da Fase 2 (documentado no design, não é esquecimento): edição de régua pela UI (`PUT /configuracoes`), retry automático de job, TLS/domínio, login "com Discord", E2E automatizado.
5. Publicar os repos num remoto (GitHub ou outro) e atualizar `.gitmodules` — hoje só existem localmente.

## Documentação de referência

- Spec da Fase 2 (design aprovado): `../projetos/ext/docs/superpowers/specs/2026-08-16-engagemend-hub-multiusuario-design.md`
- Plano de implementação da Fase 2 (16 tasks, TDD, zero placeholder): `../projetos/ext/docs/superpowers/plans/2026-08-16-engagemend-hub-multiusuario.md`
- `LEIA-ME.md` neste diretório é o handoff **anterior à Fase 2** (pré-fusão dos motores) — histórico, não reflete o estado atual. Mantido só como referência do raciocínio original do motor de eixos/portas.
- `engagemend-discord/README.md` — arquitetura do motor, privacidade, Definition of Done.
- `interface_da_engagemend/_build/HANDOFF.md` — estado e armadilhas do painel.
