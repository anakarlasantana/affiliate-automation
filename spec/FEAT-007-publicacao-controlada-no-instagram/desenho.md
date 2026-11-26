# Desenho — FEAT-007

## Fluxo do CLI

```
npm run publicar -- meli-MLB3398834705 [--preco 149.90]
  └─ publicarDoAcervo({ chave, preco })
       ├─ acervo: data/midia/acervo.json → { arquivo, link, preco }   ← CA-3, CA-7
       ├─ conferirPublicacao({ registro, killSwitch, credencialOk, baseUrl, preco })  ← CA-4..CA-6
       │     └─ motivos: sem-acervo · desligado · sem-credencial · sem-base-url · sem-preco
       ├─ quota()  (content_publishing_limit) — falha aborta        ← regra de negócio
       └─ canal.publicar({ imagemUrl, legenda, preco, quota… })     ← CA-8
             └─ InstagramStory → container → media_publish
```

## Handshake do webhook

```
GET /webhooks/instagram?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
  ├─ modo/challenge ausente → 400
  ├─ token ≠ IG_VERIFY_TOKEN (ou segredo vazio) → 403        ← CA-1
  └─ confere → 200 com o challenge em text/plain             ← CA-2
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `registrarNoAcervo(midiaDir, chave, {arquivo, link, preco, titulo})` | grava e devolve o mapa |
| `buscarNoAcervo(midiaDir, chave)` / `listarChavesDoAcervo` | `registro \| null` / `string[]` |
| `conferirPublicacao(...)` | `{pronto, motivo}` — **puro**, sem rede |
| `legendaDoStory({titulo, preco})` | `"<título> — R$ …\n🔗 link na bio"` |
| `publicarDoAcervo({chave, preco, deps})` | `{publicado, motivo, mediaId?, disponiveis?, imagemUrl?, quota?}` |
| `decidirPublicacao({ temCredencial })` | `sem-credencial` **≠** `desligado` |

`deps` injeta `midiaDir`, `killSwitch`, `credencialOk`, `baseUrl`, `quota`, `canal` — é o que permite
provar as guardas sem token e sem rede.

## Arquivos

| Arquivo | Muda? | Papel |
| :--- | :--- | :--- |
| `src/midia/acervo.js` | **novo** | índice `chave → arquivo/link/preço` em `data/midia/acervo.json` |
| `src/canais/publicacao.js` | **novo** | guardas + legenda + orquestração com quota |
| `scripts/publicar-story.mjs` | **novo** | CLI `npm run publicar` |
| `src/servidor.js` | sim | handshake confere `IG_VERIFY_TOKEN` |
| `src/config.js` + `.env.example` | sim | `IG_VERIFY_TOKEN` |
| `src/canais/base.js` | sim | `MOTIVOS.SEM_CREDENCIAL` + `temCredencial` |
| `src/canais/index.js` | sim | passa `temCredencial`; deixa de confundir os motivos |
| `scripts/ensaiar-story.mjs` | sim | grava no acervo |
| `package.json` | sim | script `publicar` |

## Fronteira

As guardas e a legenda são **puras** e provadas por unit. A chamada real à Graph API continua em
`src/canais/instagram.js` (FEAT-004) e não é exercitada aqui. O handshake é provado por teste de
integração com servidor em porta efêmera.

## Riscos

1. **Publicar é irreversível** (o story fica 24h): por isso a flag é desligada por padrão e o CLI
   exige `PUBLICAR_STORIES=1`.
2. `PUBLIC_BASE_URL` local (`127.0.0.1`) **não funciona**: a Meta baixa a mídia da internet. Para
   testar local, usar túnel HTTPS (cloudflared/ngrok).
3. O hook automático no `app.js` fica **fora** desta spec: o `app.js` importa o SQLite nativo e mexe
   no caminho crítico — será ligado e validado na VPS, com `try/catch` para não bloquear o WhatsApp.
