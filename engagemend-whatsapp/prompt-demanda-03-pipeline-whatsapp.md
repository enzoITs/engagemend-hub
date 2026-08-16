# Prompt: Pipeline de Coleta e Anonimização de Conversas de WhatsApp

> **Como usar:** cole o conteúdo abaixo (da linha `---` em diante) como mensagem inicial para a IA desenvolvedora. Os blocos marcados com `⚠️ PREENCHER` devem ser ajustados antes do envio.

---

## Papel

Você é um engenheiro de dados sênior especializado em pipelines ETL, parsing de formatos semi-estruturados e privacidade de dados sob a LGPD. Você vai construir, do zero até produção, um sistema completo de ingestão e anonimização de conversas de WhatsApp.

Trabalhe de forma incremental e verificável: entregue código executável e testado a cada etapa, não um esboço monolítico no final. Ao terminar cada fase, pare, apresente o que foi feito e aguarde validação antes de seguir.

## Contexto do negócio

A empresa opera comunidades digitais (grupos de WhatsApp, principalmente) e quer medir o engajamento dos membros de forma objetiva, classificando cada pessoa em 5 níveis: Espectador, Reativo, Participante, Colaborador Ativo e Evangelista/Líder.

Esse sistema completo tem três componentes independentes. **Você vai construir apenas o primeiro:**

1. **Pipeline de coleta e anonimização** ← seu escopo
2. Motor de pontuação e classificação (outro time, consome sua saída)
3. Dashboard de visualização (outro time, consome a saída do motor)

A API oficial do WhatsApp Business não permite leitura de grupos privados. A única fonte de dados disponível é o arquivo `.txt` que o usuário exporta manualmente pelo aplicativo. Seu sistema recebe esse arquivo e produz um dataset estruturado, pseudonimizado e pronto para análise.

**Consequência prática:** o schema de saída é um contrato com outro time. Ele não pode mudar sem versionamento explícito. Trate-o com o mesmo rigor de uma API pública.

## Restrições inegociáveis

Estas regras não são preferências. Violá-las invalida a entrega.

1. **O número de telefone original nunca é persistido.** Não em arquivo de saída, não em log, não em arquivo temporário, não em mensagem de exceção, não em stack trace. Isso exige revisar explicitamente o tratamento de erros — uma exceção que imprime a linha crua vaza PII.
2. **Hash puro de telefone é proibido.** O espaço de números de telefone brasileiros é de ~10⁹ combinações; um SHA-256 sem chave é revertido por força bruta em segundos. Use HMAC-SHA256 com chave secreta ou Argon2id.
3. **A chave de hashing vive fora do código e fora do dataset.** Variável de ambiente ou cofre de segredos. Nunca commitada, nunca em arquivo de configuração versionado.
4. **Nenhuma linha é descartada em silêncio.** Toda linha que o parser não conseguir interpretar vai para um log de rejeitados, com número da linha e conteúdo redigido. Perda silenciosa de dado é o pior modo de falha possível aqui.
5. **O conteúdo textual das mensagens não é exportado.** Veja a seção "Decisão de arquitetura" abaixo.

## Decisão de arquitetura já tomada: metadados apenas

O motor de pontuação precisa saber *quem* agiu, *quando*, *que tipo* de ação e *qual o volume*. Ele não precisa do texto.

Descartar o conteúdo elimina de uma vez: PII incidental (membros compartilhando CPF, endereço ou telefone de terceiros dentro da conversa), o impacto real de um eventual vazamento, e a maior parte da superfície de discussão com o jurídico.

O texto é usado apenas em memória, durante o parsing, para derivar `char_count`, `word_count`, `has_mention` e `has_url`. Depois disso é descartado. **Não crie nenhum caminho de código que escreva o conteúdo da mensagem em disco**, nem mesmo atrás de uma flag de debug.

## Limitação conhecida da fonte de dados

O export `.txt` **não contém metadado de resposta citada**. Quando alguém responde a uma mensagem específica, o arquivo exportado registra apenas o texto puro, sem qualquer referência à mensagem original.

Isso não é limitação de parser — é ausência de dado na fonte. Não tente inferir citação por proximidade temporal: a precisão é baixa e o ruído contamina a pontuação a jusante.

**O campo de resposta citada está fora do escopo.** Documente essa lacuna de forma destacada no README, para que o time do motor de pontuação redistribua o peso desse sinal na tabela de ponderação.

## Schema de saída (contrato — versionado como `v1.0.0`)

```json
{
  "message_id": "uuid4 gerado deterministicamente a partir de (group_hash + seq_in_group)",
  "group_hash": "HMAC-SHA256 do nome do grupo, 32 chars",
  "author_hash": "HMAC-SHA256 do identificador normalizado do autor, 32 chars",
  "timestamp": "ISO 8601 com timezone, ex: 2026-03-08T14:32:45-03:00",
  "message_type": "text | media_image | media_video | media_audio | media_sticker | media_document | media_gif | location | contact_card | poll | system | deleted",
  "char_count": 42,
  "word_count": 8,
  "has_mention": true,
  "mentioned_hashes": ["hash1", "hash2"],
  "has_url": false,
  "is_edited": false,
  "source_platform": "android | ios",
  "seq_in_group": 1043,
  "parser_version": "1.0.0"
}
```

**Campos críticos para a lógica anti-manipulação a jusante:** `char_count` e `seq_in_group`. O motor de pontuação usa esses dois para detectar flood — rajadas de mensagens curtas enviadas apenas para inflar pontuação. Sem eles a restrição anti-manipulação é impossível de implementar. São obrigatórios e nunca nulos.

**`seq_in_group`** é a posição ordinal da mensagem dentro do arquivo processado, começando em 1. Deve ser estável entre execuções sobre o mesmo arquivo.

## Formatos de entrada a suportar

O formato do export varia por plataforma e por locale. Trate cada variação como um dialeto com seu próprio parser.

**Android, pt-BR:**
```
08/03/2026 14:32 - João Silva: mensagem aqui
08/03/2026 14:33 - +55 14 99999-9999: outra mensagem
```

**iOS, pt-BR:**
```
[08/03/2026, 14:32:45] João Silva: mensagem aqui
```

**Variações de locale** mudam a ordem dia/mês, o separador e o formato de hora (12h com AM/PM vs 24h). Detecte, não assuma.

## Armadilhas conhecidas do formato

Trate cada item abaixo como um caso de teste obrigatório. Todos aparecem em exports reais.

1. **Caracteres invisíveis do iOS.** O iOS insere `U+200E` (left-to-right mark) antes do timestamp e antes de marcadores de mídia. Sem `strip` desses caracteres, os regex falham silenciosamente. Normalize antes de qualquer match.

2. **Mensagens multilinha.** A partir da segunda linha, uma mensagem longa não repete o cabeçalho de timestamp. **Regra:** linha que não casa com o padrão de cabeçalho é continuação da mensagem anterior. Essa lógica precisa vir antes de qualquer outra.

3. **Mensagens de sistema não têm autor.** Exemplos: "Você criou o grupo", "Fulano entrou usando o link de convite deste grupo", "As mensagens são protegidas com criptografia de ponta a ponta", "Fulano saiu", "Fulano mudou o assunto do grupo para...". Elas casam parcialmente com o padrão de cabeçalho e viram autores fantasmas se não forem filtradas. Classifique como `message_type: "system"` com `author_hash: null`.

4. **Nome de exibição pode conter dois-pontos.** Um contato salvo como `"João: Vendas"` quebra qualquer `split(":")` ingênuo. Use regex com âncora no padrão de timestamp, nunca split simples.

5. **Marcadores de mídia variam por plataforma, locale e modo de exportação.** Já observados: `<Mídia oculta>`, `imagem ocultada`, `‎áudio ocultado`, `vídeo omitido`, `figurinha omitida`, `documento omitido`, `<anexado: IMG-20260308-WA0001.jpg>`. Mapeie todos os encontrados nas fixtures e **emita warning explícito** para padrões desconhecidos em vez de classificar como texto.

6. **O mesmo autor pode aparecer com dois identificadores diferentes no mesmo arquivo.** Número puro enquanto não estava na agenda, nome salvo depois que foi adicionado. Se a pessoa foi salva no meio do histórico, ela vira duas entidades distintas no dataset. Gere um **relatório de autores** ao final de cada execução, listando todos os identificadores encontrados com contagem de mensagens e faixa de datas, para revisão humana e reconciliação manual.

7. **Mensagens apagadas** aparecem como "Esta mensagem foi apagada" / "Você apagou esta mensagem". Classifique como `deleted`, não como texto.

8. **Encoding.** O arquivo deve ser UTF-8, mas exports antigos ou processados por ferramentas intermediárias podem vir em Latin-1. Detecte e trate; falhe com mensagem clara se não conseguir decodificar.

## Arquitetura sugerida

```
whatsapp_pipeline/
├── pyproject.toml
├── README.md
├── .env.example
├── schema/
│   └── v1.0.0.json              # JSON Schema formal do contrato
├── src/
│   ├── detect.py                # sniff de plataforma e locale
│   ├── dialects/
│   │   ├── base.py              # interface comum
│   │   ├── android.py
│   │   └── ios.py
│   ├── normalize.py             # dialeto → objeto Message unificado
│   ├── enrich.py                # char_count, word_count, has_url, has_mention
│   ├── anonymize.py             # HMAC, normalização de identificador
│   ├── export.py                # CSV, JSON, manifest
│   ├── report.py                # relatório de autores, log de rejeitados
│   └── cli.py
├── app/
│   └── streamlit_app.py         # interface de upload
└── tests/
    ├── fixtures/                # exports reais anonimizados
    └── test_*.py
```

Stack: Python 3.11+, `pytest` para testes, `pydantic` para validação do schema, `streamlit` para a interface. Sem dependências pesadas desnecessárias.

## Especificação da anonimização

```python
import hmac, hashlib, os

def hash_identifier(raw: str) -> str:
    key = os.environ["ANON_HMAC_KEY"].encode()
    normalized = normalize_identifier(raw)
    return hmac.new(key, normalized.encode(), hashlib.sha256).hexdigest()[:32]
```

Requisitos:

- **A chave é estável por projeto.** Gerar chave nova a cada execução faz o mesmo membro virar pessoas diferentes entre arquivos, destruindo qualquer análise longitudinal. Documente isso de forma enfática.
- **Normalize antes de hashear.** `+55 14 99999-9999` e `+5514999999999` precisam produzir o mesmo hash. Converta números para E.164; para nomes, aplique trim, colapso de espaços internos e casefold.
- **Hasheie o nome de exibição também.** Proteger o telefone e deixar "Maria Silva" em claro no CSV não anonimiza nada.
- **Hasheie os identificadores mencionados** (`@fulano` dentro do texto) com a mesma função, para que `mentioned_hashes` seja correlacionável com `author_hash`.
- Mantenha um `mapping.json` **cifrado e fora do diretório de saída**, permitindo re-identificação controlada. Acesso restrito.

⚠️ **Aviso jurídico a incluir no README:** se a organização retém a chave de hashing — e ela precisa reter, para saber quem é o membro a ser promovido a embaixador — o resultado é **pseudonimização**, não anonimização. A LGPD continua se aplicando integralmente ao dataset. Não descreva a saída como "dados anonimizados" em documentação, contratos ou avisos de privacidade.

## Fases de entrega

Pare ao final de cada fase e aguarde validação.

**Fase 0 — Schema e esqueleto.** JSON Schema formal em `schema/v1.0.0.json`, modelos pydantic correspondentes, estrutura de diretórios, `pyproject.toml`, `.env.example`. Gere um arquivo de exemplo com 50 registros sintéticos válidos, para que o time do motor de pontuação já comece a trabalhar contra o contrato.

**Fase 1 — Detecção de formato.** Módulo que recebe as primeiras N linhas e retorna plataforma + locale + formato de data com nível de confiança. Deve falhar explicitamente em vez de adivinhar quando a confiança for baixa.

**Fase 2 — Parsers de dialeto.** Android e iOS. Tratamento de multilinha, mensagens de sistema, marcadores de mídia, mensagens apagadas. Meta: sobre as fixtures, ≥99% das linhas classificadas e zero perda silenciosa.

**Fase 3 — Enriquecimento e anonimização.** Derivação dos campos calculados, HMAC, normalização de identificadores, relatório de autores.

**Fase 4 — Exportação.** CSV e JSON validados contra o schema. `manifest.json` por execução contendo: versão do parser, hash SHA-256 do arquivo de entrada, contagem de linhas processadas e rejeitadas, timestamp da execução, plataforma detectada. Rastreabilidade é o que salva a investigação quando o motor de pontuação acusar um número estranho daqui a seis meses.

**Fase 5 — CLI.** Interface de linha de comando com argumentos para arquivo de entrada, diretório de saída, formato e nível de log.

**Fase 6 — Interface de upload.** Streamlit. Arquivo processado em memória e removido imediatamente após o processamento; limite de tamanho configurável (exports de grupos grandes ultrapassam 50 MB); preview do resultado já pseudonimizado antes do download; o arquivo original nunca é persistido.

**Fase 7 — Endurecimento.** Suíte de testes rodando em CI. Casos obrigatórios: arquivo vazio, arquivo truncado no meio de uma mensagem, encoding Latin-1, export de conversa individual em vez de grupo, arquivo de 200 MB, arquivo com apenas mensagens de sistema, arquivo com um único autor.

## Critérios de aceitação

- [ ] Sobre o conjunto de fixtures, ≥99% das linhas são classificadas corretamente
- [ ] Zero linhas descartadas em silêncio; todas as rejeições aparecem em `unparsed.log`
- [ ] Nenhum número de telefone ou nome em claro em qualquer arquivo de saída, log ou temporário
- [ ] Busca por regex de padrão de telefone em todo o diretório de saída retorna vazio
- [ ] O mesmo arquivo processado duas vezes produz hashes idênticos
- [ ] Todo registro exportado valida contra `schema/v1.0.0.json`
- [ ] Um export do Android e um do iOS do mesmo grupo produzem `author_hash` idênticos para o mesmo membro
- [ ] Cobertura de testes ≥80% nos módulos de parsing e anonimização
- [ ] README documenta a lacuna de resposta citada e o status de pseudonimização

## Como trabalhar comigo

- Comece pela Fase 0 e pare para validação. Não avance sem confirmação.
- Quando encontrar ambiguidade no formato, **pergunte em vez de assumir** — eu tenho acesso a exports reais e posso verificar.
- Escreva os testes junto com o código da fase, não depois.
- Se você identificar um risco de privacidade que eu não listei, levante-o imediatamente, mesmo que atrase a entrega.
- Código e comentários em português; nomes de variáveis, funções e campos do schema em inglês.

## Informações a preencher antes de começar

⚠️ **PREENCHER:** volume esperado — quantos grupos, quantos membros por grupo, qual a periodicidade de reprocessamento.

⚠️ **PREENCHER:** ambiente de destino — execução local, servidor interno ou nuvem. Isso define onde a chave HMAC vai morar.

⚠️ **PREENCHER:** quem opera a ferramenta — apenas equipe técnica ou gestores de comunidade sem formação técnica. Isso define quanto esforço vai para a interface.

⚠️ **PREENCHER:** já existe base legal definida para o tratamento desses dados (consentimento dos membros, legítimo interesse)? Se ainda não, sinalize que isso precisa ser resolvido antes do primeiro processamento de dados reais.
