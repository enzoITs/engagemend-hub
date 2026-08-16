# Pipeline de Coleta e Anonimização de Conversas de WhatsApp

Ingestão do `.txt` exportado manualmente de um grupo de WhatsApp → dataset
estruturado, **pseudonimizado**, contendo apenas metadados de mensagens.
É o primeiro de três componentes de um sistema de medição de engajamento de
comunidades; este repositório entrega **apenas** a coleta e anonimização —
o motor de pontuação e o dashboard são consumidores externos deste dataset.

**Status: todas as 8 fases concluídas** (Fase 0: schema, esqueleto, modelos
pydantic, dataset de exemplo. Fase 1: detecção de plataforma/locale. Fase 2:
parsers de dialeto Android/iOS. Fase 3: enriquecimento, anonimização e
relatório de autores. Fase 4: exportação CSV/JSON + manifest.json. Fase 5:
CLI. Fase 6: interface Streamlit. Fase 7: endurecimento). O pipeline roda
ponta a ponta tanto pela **linha de comando** (seção "CLI") quanto por
**upload no navegador** (seção "Interface Streamlit"), com CI configurado
(seção "Endurecimento").

Isso fecha o escopo do documento original — mas **não significa pronto para
dados reais**: as lacunas abaixo (suposições sobre o formato, nunca
confirmadas contra um export de verdade) continuam abertas, e são
precisamente o tipo de coisa que só um export real pode resolver.

⚠️ **Lacunas abertas, aguardando confirmação com exports reais** (ver seção
"Armadilhas" e as seções específicas de cada uma):
- o marcador exato de mensagem editada (`is_edited`) — o schema tem o campo,
  mas o documento original não especifica o texto que o WhatsApp anexa a
  uma mensagem editada, e chutar o texto errado corrompe o campo em
  silêncio. Hoje `is_edited` é sempre `False` (não implementado).
- o marcador genérico `<Mídia oculta>` (sem indicar subtipo) é mapeado para
  `media_image` por ser o caso mais comum observado publicamente, mas isso
  é uma suposição, não uma certeza — vale validar contra exports reais.
- formato de menção (`@fulano`) assumido como `@<telefone-sem-formatação>`
  (ex.: `@5511987654321`) — se o export real usar `@NomeExibido`, a
  detecção de `has_mention`/`mentioned_hashes` fica subestimada (ver seção
  "Enriquecimento").
- número de telefone sem código de país (10-11 dígitos) é assumido como
  Brasil e recebe `+55` — quebra para membros de outros países (ver seção
  "Anonimização").
- **timezone dos timestamps**: o export não tem timezone nenhuma; assumimos
  `America/Sao_Paulo` para todo o arquivo (configurável via `tz_name` em
  `export.build_records`) — errado se um grupo tiver membros em fusos
  diferentes simultaneamente (ver seção "Exportação").

## ⚠️ Aviso legal: isto é pseudonimização, não anonimização

A organização **retém a chave de hashing** (`ANON_HMAC_KEY`) — precisa
retê-la, para poder re-identificar um membro na hora de promovê-lo a
embaixador. Isso torna o processo, por definição, **pseudonimização**, não
anonimização. A LGPD continua se aplicando **integralmente** a este dataset:
ele é dado pessoal, ainda que hasheado.

Nunca descreva a saída deste pipeline como "dados anonimizados" em
documentação, contratos ou avisos de privacidade voltados a titulares ou
reguladores. O termo correto é "dados pseudonimizados".

Base legal para o tratamento (consentimento dos membros / legítimo
interesse) já está definida pela organização, conforme confirmado antes do
início deste projeto — mantenha essa decisão documentada e acessível para
auditoria.

## ⚠️ Lacuna conhecida: resposta citada não está disponível

O export `.txt` do WhatsApp **não contém metadado de resposta citada**.
Quando um membro responde a uma mensagem específica, o arquivo exportado
registra apenas o texto da resposta, sem qualquer referência à mensagem
original — a informação simplesmente não existe na fonte.

Isso não é uma limitação de parser que pode ser corrigida depois: é ausência
de dado na origem. Inferência por proximidade temporal foi deliberadamente
descartada (precisão baixa, ruído contamina a pontuação a jusante).

**Consequência para o time do motor de pontuação:** o schema v1.0.0 não tem
e não terá um campo de resposta citada. Qualquer peso que a tabela de
ponderação do motor atribua a esse sinal precisa ser redistribuído para
outros sinais disponíveis (`has_mention`, `char_count`, `seq_in_group`, etc).

## Decisão de arquitetura: metadados apenas, nunca o texto

O conteúdo textual das mensagens **não é exportado**. Ele existe apenas em
memória durante o parsing, usado para derivar `char_count`, `word_count`,
`has_mention` e `has_url`, e é descartado em seguida. Nenhum caminho de
código deste projeto escreve o conteúdo de uma mensagem em disco — nem em
arquivo de saída, nem em log, nem atrás de flag de debug.

Isso elimina de uma vez: PII incidental (CPF, endereço ou telefone de
terceiros compartilhados dentro da conversa), o impacto de um eventual
vazamento, e a maior parte da superfície de discussão com o jurídico.

## Restrições inegociáveis

1. **Número de telefone original nunca é persistido** — nem em saída, nem em
   log, nem em temporário, nem em mensagem de exceção/stack trace.
2. **Hash puro de telefone é proibido.** O espaço de números BR é pequeno
   (~10⁹) e reversível por força bruta em segundos com SHA-256 simples. Toda
   pseudonimização usa **HMAC-SHA256 com chave secreta**.
3. **A chave HMAC vive fora do código e fora do dataset** — variável de
   ambiente local (`ANON_HMAC_KEY`, ver `.env.example`), nunca commitada.
4. **Nenhuma linha é descartada em silêncio** — toda linha não interpretável
   vai para `unparsed.log` com número da linha e conteúdo redigido.
5. **O texto das mensagens não é exportado** (ver seção acima).

## Contrato de saída (`schema/v1.0.0.json`)

Ver [`schema/v1.0.0.json`](schema/v1.0.0.json) para o JSON Schema formal e
[`src/models.py`](src/models.py) para o modelo pydantic equivalente. Os
dois precisam permanecer sincronizados — `tests/test_schema.py` verifica
isso.

Um dataset de exemplo com 50 registros sintéticos válidos está em
[`examples/sample_v1.0.0.json`](examples/sample_v1.0.0.json), gerado por
`examples/generate_sample.py`, para o time do motor de pontuação já começar
a trabalhar contra o contrato.

Campos críticos para a lógica anti-manipulação a jusante (detecção de
flood): `char_count` e `seq_in_group`. São obrigatórios e nunca nulos.

Mudanças no schema exigem versionamento explícito (`v1.1.0`, `v2.0.0`, ...).

## Detecção de plataforma e locale (`src/detect.py`, Fase 1)

`sniff(lines: list[str]) -> DetectionResult` recebe as primeiras N linhas do
export e retorna plataforma (`android`/`ios`), formato de data (ordem
dia/mês, separador, `24h`/`12h`, presença de segundos) e um nível de
confiança agregado (0.0–1.0).

Levanta `DetectionError` — em vez de adivinhar — quando:

- nenhuma linha casa com um cabeçalho Android ou iOS conhecido;
- poucas linhas foram reconhecidas (amostra pequena demais para confiar,
  mesmo com 100% de acerto proporcional);
- Android e iOS têm contagens de match próximas (arquivo de formato misto
  ou amostra não representativa);
- **a ordem dia/mês não pôde ser confirmada pelos próprios dados** —
  nenhuma data da amostra tem um componente > 12. Não presumimos DMY por
  convenção pt-BR sem evidência: isso seria exatamente o tipo de
  adivinhação que este módulo existe para evitar. Nesse caso, o chamador
  precisa fornecer mais linhas ou confirmar o locale manualmente.

O limiar de confiança (`CONFIDENCE_THRESHOLD = 0.7`) e o mínimo absoluto de
linhas reconhecidas (`MIN_ABSOLUTE_MATCHES = 3`) são constantes do módulo.

## Parsers de dialeto (`src/dialects/`, Fase 2)

`src/dialects/base.py` concentra o motor de parsing compartilhado por
Android (`android.py`) e iOS (`ios.py`) — as duas subclasses só declaram o
regex de cabeçalho; toda a lógica de negócio (armadilhas do formato) vive
uma única vez na classe base, para os dois dialetos não divergirem.

`src/normalize.py` liga tudo: `parse_export(lines)` roda `detect.sniff()`
numa amostra, escolhe o dialeto certo e parseia o arquivo inteiro,
retornando um `ParseResult` com três listas:

- `messages: list[RawMessage]` — mensagens delimitadas e classificadas
  (ainda não anonimizadas nem enriquecidas — isso é Fase 3).
- `rejected: list[RejectedLine]` — toda linha que não pôde ser interpretada,
  com número da linha e um preview **redigido** (dígitos de 4+ mascarados,
  texto truncado). Nunca fica vazio silenciosamente: uma linha só passa a
  não constar aqui se ela virou mensagem ou é uma linha em branco legítima.
- `warnings: list[ParseWarning]` — casos de melhor esforço que merecem
  revisão humana, sem chegar a rejeitar a linha (ex.: nome de exibição com
  `:` embutido, marcador de mídia desconhecido).

Ordem de classificação de cada mensagem (nessa ordem — importa):

1. **Multilinha** (armadilha #2): linha sem cabeçalho reconhecido é
   continuação da mensagem anterior. Decidido antes de qualquer outra regra.
2. **Sistema** (armadilha #3): `rest` sem `"Autor: texto"` → sem autor
   (`author_hash` será `null`).
3. **Apagada** (armadilha #7): texto bate com um padrão conhecido de
   "apagada".
4. **Mídia** (armadilha #5): texto bate com um marcador mapeado; se parece
   um marcador (`<...>`) mas é desconhecido, emite warning e classifica
   como `media_document` — nunca como texto.
5. Caso contrário: texto normal.

**Nome de exibição com `:` (armadilha #4)** — ex. `"João: Vendas"` — não tem
solução determinística sem uma lista de contatos conhecida: o parser faz o
split no primeiro `": "` (melhor esforço) e emite um `ParseWarning` sempre
que houver mais de um `": "` na linha, para revisão manual via relatório de
autores (Fase 3).

Sobre as fixtures (`tests/fixtures/{android,ios}_pt_br.txt`, cobrindo todas
as 8 armadilhas): 100% das linhas classificadas, zero linhas rejeitadas,
zero perda silenciosa — acima da meta de aceitação de ≥99%.

## Anonimização (`src/anonymize.py`, Fase 3)

- `hash_identifier(raw)` — HMAC-SHA256 com `ANON_HMAC_KEY` (variável de
  ambiente, ver `.env.example`), truncado para 32 caracteres hex.
- **A chave é estável por projeto.** Trocá-la faz o mesmo membro virar uma
  pessoa "diferente" a cada reprocessamento, destruindo qualquer análise
  longitudinal de engajamento.
- `normalize_identifier(raw)` roda antes do hash: telefones (strings só com
  dígitos/pontuação de telefone) são convertidos para E.164; qualquer outra
  coisa é tratada como nome (trim + colapso de espaços + casefold) —
  garantindo que `+55 14 99999-9999` e `+5514999999999` produzam o mesmo
  hash, e que variações de capitalização não fragmentem o mesmo autor.
  - ⚠️ Números sem código de país (10-11 dígitos) são assumidos como Brasil
    (`+55`) — suposição documentada, não confirmada contra exports reais de
    grupos com membros internacionais.
- Nome de exibição também é hasheado (proteger só o telefone não anonimiza
  nada) — mesma função, `normalize_identifier` decide o tratamento certo.
- Menções (`@fulano`) usam a mesma função de hash (chamada por
  `src/enrich.py`), para que `mentioned_hashes` seja correlacionável com
  `author_hash`.
- `build_mapping()` / `write_mapping()` — `mapping.json` cifrado (Fernet, ver
  seção "Cofre cifrado" abaixo), fora do diretório de saída, acesso
  restrito, permite re-identificação controlada.

## Enriquecimento (`src/enrich.py`, Fase 3)

`enrich_message(message: RawMessage) -> EnrichedFields` deriva
`char_count`, `word_count`, `has_url` e `has_mention`/`mentioned_hashes` —
só para `message_type == "text"`. Para `system`/`deleted`/mídia, todos os
campos são zerados: o `raw_text` desses tipos é um marcador do export
(`"<Mídia oculta>"`, `"Esta mensagem foi apagada"`, ...), não conteúdo
digitado pelo usuário — contá-lo infla artificialmente as métricas
anti-flood a jusante.

⚠️ Menção (`@fulano`) é detectada assumindo o formato
`@<telefone-sem-formatação>` (ex.: `@5511987654321`), historicamente o
comportamento do export do WhatsApp. Não confirmado contra exports reais —
se o app passar a exportar `@NomeExibido`, a detecção fica subestimada.

## Relatório de autores (`src/report.py`, Fase 3) — armadilha #6

`build_author_report(messages)` agrupa por **identificador bruto**, não por
hash (agrupar por hash esconderia justamente o problema: dois identificadores
diferentes para a mesma pessoa humana geram hashes diferentes). Cada entrada
tem identificador bruto, hash, contagem de mensagens e faixa de datas —
dados para um humano decidir se duas entradas são a mesma pessoa.

**Conflito identificado e resolvido com o usuário:** listar identificadores
brutos para reconciliação humana está em tensão direta com a restrição #1
("telefone original nunca é persistido... não em log"). Hashes não servem
para esse relatório — um humano não consegue reconhecer que
`+5514999999999` e `João Silva` são a mesma pessoa olhando dois hashes
aleatórios. Decisão confirmada: o relatório é persistido, mas **cifrado**,
no mesmo cofre restrito do `mapping.json` — nunca em texto claro em disco,
nunca no diretório de saída regular. `write_author_report()` grava via
`secure_store.write_encrypted_json`.

## Cofre cifrado (`src/secure_store.py`, Fase 3)

`mapping.json` e o relatório de autores compartilham o mesmo mecanismo:
Fernet (AES simétrico + HMAC de integridade), chave em
`MAPPING_ENCRYPTION_KEY` (ver `.env.example`) — **distinta** de
`ANON_HMAC_KEY`: uma é reversível (permite decifrar para re-identificação
controlada), a outra precisa ser irreversível (protege o hash contra força
bruta). Nunca reaproveitar uma chave para as duas finalidades.

`write_encrypted_json(data, path)` / `read_encrypted_json(path)` — o
arquivo em disco nunca contém o JSON em texto claro (verificado em teste:
`tests/test_secure_store.py::test_file_on_disk_is_not_plaintext`).

## Exportação (`src/export.py`, Fase 4)

`build_records(parse_result, group_name, source_platform, tz_name=...)`
monta o `WhatsAppMessage` final (contrato v1.0.0) para cada mensagem: chama
`enrich_message` (Fase 3) para os campos calculados, `hash_identifier`
(Fase 3) para `group_hash`/`author_hash`/`mentioned_hashes`, e
`make_message_id(group_hash, seq_in_group)` para um UUID4 **determinístico**
(mesmo par sempre produz o mesmo id — necessário para que reprocessar o
mesmo arquivo produza saída idêntica).

- `write_json(records, path)` / `write_csv(records, path)` — ambos chamam
  `validate_records_against_schema` antes de gravar (defesa em profundidade
  além da validação pydantic que já ocorre na construção de cada
  `WhatsAppMessage`). CSV serializa `mentioned_hashes` como lista
  separada por `;`.
- `build_manifest(parse_result, input_file_sha256, detected_platform)` /
  `write_manifest(...)` — grava `manifest.json` com versão do parser, hash
  SHA-256 do arquivo de entrada (`hash_file`), contagem de linhas
  processadas/rejeitadas, timestamp de execução e plataforma detectada.
  Rastreabilidade: se o motor de pontuação acusar um número estranho daqui
  a seis meses, o manifest permite reconstruir exatamente qual execução
  gerou aquele dado, contra qual arquivo de entrada.

**Timezone dos timestamps** — o export `.txt` não contém timezone alguma,
só data/hora local do aparelho. `build_records` recebe `tz_name` (IANA,
default `"America/Sao_Paulo"`) e aplica esse fuso a **todos** os timestamps
do arquivo. ⚠️ Isso assume que o grupo inteiro opera num único fuso —
razoável para o caso de uso declarado (comunidades brasileiras), mas
incorreto se um grupo tiver membros ativos em fusos diferentes
simultaneamente (a fonte não distingue: cada linha tem a hora local de quem
*exportou* o arquivo, não do remetente da mensagem). Não há como corrigir
isso sem informação que o export não tem — documentado, não resolvido.

Testado ponta a ponta em `tests/test_integration_e2e.py`, usando as
fixtures reais da Fase 2: gera CSV/JSON/manifest a partir do `.txt`, valida
100% dos registros contra o schema formal, confirma ausência de padrão de
telefone em todo o diretório de saída, confirma que reprocessar o mesmo
arquivo produz hashes idênticos, e confirma que Android e iOS do mesmo
grupo produzem `author_hash` idênticos para o mesmo membro.

## CLI (`src/cli.py`, Fase 5)

```bash
python -m src.cli entrada.txt --grupo "Nome do Grupo" --saida ./output
```

Argumentos: arquivo de entrada (posicional), `--grupo` (obrigatório, usado
para `group_hash`), `--saida` (default `./output`), `--formato`
(`csv`/`json`/`ambos`, default `ambos`), `--tz` (default `America/Sao_Paulo`),
`--mapping-dir` (default: variável de ambiente `MAPPING_STORE_DIR`, ou
`./secure/mapping` se ela não estiver definida), `--log-level` (default `INFO`).
Carrega `.env` automaticamente (`python-dotenv`) — não precisa exportar as
variáveis manualmente no shell antes de rodar.

Uma execução produz, em `--saida`: `output.json`, `output.csv`,
`manifest.json`, `unparsed.log`; e em `--mapping-dir` (cofre cifrado, fora
do diretório de saída): `mapping.json` e `author_report.json`.

**`mapping.json` é acumulativo entre execuções**, não sobrescrito: cada
execução lê o mapping existente (se houver), soma os identificadores vistos
neste arquivo e regrava — reprocessar arquivos diferentes do mesmo grupo ao
longo do tempo nunca perde uma entrada anterior. Se o arquivo cifrado
existente não puder ser lido (corrompido, chave errada), o CLI avisa e
recria do zero em vez de travar — a única perda possível nesse caso é a de
identificadores só vistos em execuções passadas, nunca dos da execução atual.

**Encoding (armadilha #8)**: `read_export_file` tenta UTF-8 e cai para
Latin-1, com warning explícito quando usa o fallback. ⚠️ Limitação
conhecida: Latin-1 mapeia todo byte para um caractere válido, então nunca
falha ao decodificar — um arquivo com **um único byte UTF-8 inválido** no
meio de um arquivo majoritariamente UTF-8 é silenciosamente reinterpretado
inteiro como Latin-1 (não falha, mas pode produzir texto incorreto/mojibake
ao longo do arquivo todo). Não há como distinguir isso de um arquivo
genuinamente Latin-1 sem heurística adicional (ex. `chardet`) — fora do
escopo desta fase, documentado como limitação conhecida.

**Códigos de saída**: `0` sucesso; `1` para arquivo não encontrado, falha de
decodificação, amostra ambígua demais para detectar plataforma/locale
(`DetectionError` — nunca "adivinha"), ou variável de ambiente de chave
ausente. Erros são logados com mensagem acionável, nunca com stack trace
cru (que poderia vazar conteúdo de linha em uma mensagem de exceção,
violando a restrição #1).

O CLI não tem essa limitação de "nunca falha ao decodificar" resolvida —
ela é do Latin-1 em si, não vai desaparecer nesta fase.

## Interface Streamlit (`app/streamlit_app.py`, Fase 6)

```bash
streamlit run app/streamlit_app.py
```

Upload de `.txt`, nome do grupo e timezone via formulário; preview das
primeiras 20 linhas **já pseudonimizadas** antes do download (JSON e CSV,
ambos gerados em memória via `export.records_to_json_string`/
`records_to_csv_string` — nunca escritos em disco pelo app). Reaproveita o
mesmo `normalize.parse_export` + `export.build_records` do CLI — nenhuma
lógica de negócio duplicada, só a camada de interface muda.

**O arquivo original enviado nunca é gravado em disco.** `uploaded_file.getvalue()`
mantém os bytes em memória; a referência é solta (`del`) assim que o texto é
decodificado, e a referência ao texto decodificado é solta assim que o
parsing termina — melhor esforço para reduzir a janela em que o conteúdo
bruto fica acessível, não uma garantia criptográfica (Python não expõe
"apagar memória agora").

⚠️ **Duas ressalvas sobre o limite de tamanho** (`MAX_UPLOAD_SIZE_MB`, ver
`.env.example`, default 200 MB — exports de grupos grandes passam de 50 MB):
1. O Streamlit tem seu **próprio** limite de servidor
   (`server.maxUploadSize`, configurado em `.streamlit/config.toml`), que
   rejeita o upload *antes* do código deste app rodar. Mudar só a env var
   não é suficiente — os dois precisam ficar sincronizados manualmente.
2. Esta interface **não gera** `mapping.json` nem relatório de autores
   (ficariam presos à sessão do navegador, sem sentido para um cofre
   persistente entre execuções) — para isso, use o CLI.

Testado com `streamlit.testing.v1.AppTest` (`tests/test_streamlit_app.py`,
14 testes): fluxo sem arquivo, upload válido, preview sem identificador em
claro, nome de grupo obrigatório, fallback de encoding, arquivo ambíguo
(erro, não crash), arquivo acima do limite.

## Endurecimento (`tests/test_hardening.py`, Fase 7)

CI configurado em `.github/workflows/tests.yml` — roda a suíte rápida em
todo push/PR (Python 3.11, 3.12, 3.13) e a suíte `slow` só na branch
principal (evita bloquear PRs com um teste de dezenas de segundos).

Os 7 casos de borda obrigatórios do documento, todos testados:

1. **Arquivo vazio** — `parse_export([])` levanta `DetectionError`
   explicitamente; o CLI sai com código 1 e mensagem clara, não traceback.
2. **Arquivo truncado no meio de uma mensagem** — truncar no meio de uma
   continuação multilinha não derruba o parser nem perde o fragmento (fica
   no `raw_text` da última mensagem); truncar no meio de uma linha de
   cabeçalho faz a linha parcial cair no fallback de continuação/rejeição
   (armadilha #2), sem exceção.
3. **Encoding Latin-1** — pipeline completo (`.txt` → registros) sobre um
   arquivo Latin-1 com acentuação, confirmando que o texto não vira lixo
   depois da decodificação.
4. **Export de conversa individual** — `tests/fixtures/individual_chat_android.txt`:
   nada no parser assume "grupo"; uma conversa 1:1 processa igual.
5. **Arquivo de 200 MB** — gerado sinteticamente
   (`tests/fixtures` não versiona isso, é gerado em `tmp_path` no teste),
   processado ponta a ponta em ~30s neste ambiente. Marcado `@pytest.mark.slow`
   (excluído da suíte padrão via `-m "not slow"`, rodado à parte).
6. **Arquivo com apenas mensagens de sistema** —
   `tests/fixtures/system_only_android.txt`: todo `author_hash` nulo,
   relatório de autores vazio, exportação não quebra com zero autores.
7. **Arquivo com um único autor** — `tests/fixtures/single_author_android.txt`:
   relatório de autores com exatamente 1 entrada, todos os `author_hash`
   idênticos.

## Armadilhas conhecidas do formato de export

1. ✅ Caractere invisível `U+200E` (LRM) do iOS antes de timestamps/mídia —
   `detect.strip_invisible`, aplicado a cada linha antes de qualquer match.
2. ✅ Mensagens multilinha (linha sem cabeçalho = continuação da anterior) —
   `dialects/base.py`.
3. ✅ Mensagens de sistema sem autor (`message_type: "system"`,
   `author_hash: null`) — `dialects/base.py`.
4. ✅ Nome de exibição pode conter `:` — sem `split(":")` ingênuo; melhor
   esforço + `ParseWarning` explícito (ver seção "Parsers de dialeto").
5. ✅ Marcadores de mídia variam por plataforma/locale/modo de exportação;
   padrão desconhecido gera warning explícito e cai em `media_document`,
   nunca vira "texto" por omissão.
6. ✅ Mesmo autor pode aparecer com dois identificadores no arquivo (número
   puro → nome salvo). Relatório de autores ao final de cada execução para
   reconciliação manual — `src/report.py::build_author_report`, cifrado no
   cofre restrito (ver seção "Relatório de autores").
7. ✅ Mensagens apagadas → `message_type: "deleted"`, nunca texto.
8. ✅ Encoding: UTF-8 esperado, mas exports antigos podem vir em Latin-1;
   detectado e tratado em `src/cli.py::read_export_file` (camada de leitura
   de arquivo — os parsers de dialeto recebem `list[str]` já decodificado).
   Falha com mensagem clara se nenhum encoding decodificar (ver seção "CLI"
   para a limitação conhecida: Latin-1 nunca falha ao decodificar).

## Estrutura do projeto

```
whatsapp_pipeline/
├── pyproject.toml
├── README.md
├── .env.example
├── .streamlit/config.toml       # server.maxUploadSize (Fase 6)
├── .github/workflows/tests.yml  # CI (Fase 7)
├── schema/v1.0.0.json          # contrato formal (JSON Schema)
├── examples/
│   ├── generate_sample.py
│   └── sample_v1.0.0.json      # 50 registros sintéticos válidos
├── src/
│   ├── models.py               # modelo pydantic do contrato (Fase 0)
│   ├── detect.py                # sniff de plataforma/locale (Fase 1, pronto)
│   ├── dialects/
│   │   ├── base.py              # motor de parsing compartilhado (Fase 2, pronto)
│   │   ├── android.py           # Fase 2, pronto
│   │   └── ios.py               # Fase 2, pronto
│   ├── normalize.py             # detect + dialeto → ParsedExport (Fase 2, pronto)
│   ├── enrich.py                # char_count/word_count/has_url/has_mention (Fase 3, pronto)
│   ├── anonymize.py             # HMAC, normalização, mapping.json (Fase 3, pronto)
│   ├── secure_store.py          # cofre cifrado (Fernet) compartilhado (Fase 3, pronto)
│   ├── export.py                # registros, CSV/JSON (arquivo e memória), manifest.json (Fase 4, pronto)
│   ├── report.py                # log de rejeitados (Fase 2) + relatório de autores (Fase 3, prontos)
│   └── cli.py                   # entrypoint, encoding, orquestração (Fase 5, pronto)
├── app/streamlit_app.py         # interface de upload (Fase 6, pronto)
└── tests/
    ├── fixtures/                # {android,ios}_pt_br.txt (8 armadilhas) +
    │                            # individual_chat/system_only/single_author_android.txt (Fase 7)
    └── test_*.py                # inclui test_integration_e2e.py, test_cli.py,
                                  # test_streamlit_app.py, test_hardening.py
```

## Rodando os testes

```bash
python3 -m pip install -e ".[dev]"
python3 -m pytest tests/ -v --cov=src -m "not slow"   # suíte rápida (padrão em CI para PRs)
python3 -m pytest tests/ -v -m "slow"                  # só os casos caros (ex.: 200 MB)
```

Estado atual: 205 testes (204 rápidos + 1 `slow`) — 21 cobrindo o contrato
(Fase 0), 17 cobrindo o detector de plataforma/locale (Fase 1), 37 cobrindo
os parsers de dialeto, o orquestrador e o log de rejeitados (Fase 2), 45
cobrindo anonimização, enriquecimento, cofre cifrado e relatório de autores
(Fase 3), 34 cobrindo exportação e o pipeline ponta a ponta (Fase 4), 18
cobrindo o CLI (Fase 5), 14 cobrindo a interface Streamlit (Fase 6, via
`AppTest`), e 17 cobrindo os 7 casos de borda obrigatórios de endurecimento
(Fase 7). Cobertura de `src/`: 99% (100% em todos os módulos com lógica
implementada, exceto a linha de entrypoint `if __name__ == "__main__"` do
CLI).

## Setup

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_hex(32))"  # gerar ANON_HMAC_KEY
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # gerar MAPPING_ENCRYPTION_KEY
# cole os dois valores gerados em .env — nunca commite o .env real
python3 -m pip install -e .

# rodar sobre um export real via CLI:
python3 -m src.cli caminho/para/export.txt --grupo "Nome do Grupo"

# ou via navegador:
streamlit run app/streamlit_app.py
```

## Roadmap (todas as fases)

| Fase | Escopo |
|---|---|
| ~~0~~ | ~~Schema e esqueleto~~ ✅ |
| ~~1~~ | ~~Detecção de plataforma/locale/formato de data com nível de confiança~~ ✅ |
| ~~2~~ | ~~Parsers Android e iOS, ≥99% das linhas classificadas, zero perda silenciosa~~ ✅ |
| ~~3~~ | ~~Enriquecimento, HMAC, normalização de identificadores, relatório de autores~~ ✅ |
| ~~4~~ | ~~Exportação CSV/JSON validada contra o schema + `manifest.json` por execução~~ ✅ |
| ~~5~~ | ~~CLI~~ ✅ |
| ~~6~~ | ~~Interface de upload Streamlit (processamento em memória, arquivo original nunca persistido)~~ ✅ |
| ~~7~~ | ~~Endurecimento: suíte de testes em CI, casos de borda~~ ✅ |

## Critérios de aceitação do documento original

- [x] Sobre o conjunto de fixtures, ≥99% das linhas são classificadas corretamente (100% nas fixtures atuais)
- [x] Zero linhas descartadas em silêncio; todas as rejeições aparecem em `unparsed.log`
- [x] Nenhum número de telefone ou nome em claro em qualquer arquivo de saída, log ou temporário
- [x] Busca por regex de padrão de telefone em todo o diretório de saída retorna vazio (`tests/test_integration_e2e.py`)
- [x] O mesmo arquivo processado duas vezes produz hashes idênticos
- [x] Todo registro exportado valida contra `schema/v1.0.0.json`
- [x] Um export do Android e um do iOS do mesmo grupo produzem `author_hash` idênticos para o mesmo membro
- [x] Cobertura de testes ≥80% nos módulos de parsing e anonimização (100% em ambos)
- [x] README documenta a lacuna de resposta citada e o status de pseudonimização

Todos os critérios do documento original estão satisfeitos **contra as
fixtures sintéticas** deste repositório. Isso não é o mesmo que "validado
contra dados reais" — ver as suposições documentadas no topo deste README
(marcador de edição, `<Mídia oculta>`, formato de menção, DDI padrão,
timezone) e a limitação do fallback Latin-1 (seção "CLI"), nenhuma delas
confirmável sem um export real de um grupo de verdade.

Cada fase parou para validação humana antes de avançar para a próxima.
