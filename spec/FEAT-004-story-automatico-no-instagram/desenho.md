# Desenho — FEAT-004

## Fluxo

```
oferta aprovada
  ├─ decidirPublicacao({ killSwitch, preco, quota, jaPublicado })   ← CA-1..CA-4
  │     └─ motivo ∈ { desligado, sem-preco, quota-esgotada, ja-publicado }
  └─ publicarStory({ igUserId, token, imagemUrl, legenda })
        ├─ POST /<IG_ID>/media  (media_type=STORIES, image_url)      ← CA-6
        ├─ GET  /<CONTAINER_ID>?fields=status_code (até FINISHED)
        └─ POST /<IG_ID>/media_publish
              └─ falha aqui NÃO propaga para o WhatsApp              ← CA-5
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `decidirPublicacao(ctx)` | `{ publicar: boolean, motivo?: string }` — puro, sem rede |
| `publicarStory(cliente, dados)` | `{ ok, mediaId?, erro? }` |
| `quotaLivre(cliente)` | `{ usada, total, livre }` via `content_publishing_limit` |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/canais/base.js` | **novo** | contrato `CanalPublisher` + `decidirPublicacao` (puro) |
| `src/canais/instagram.js` | novo (tarefa) | cliente Graph API (container → publish) |
| `src/canais/index.js` | novo (tarefa) | registry de canais + `resumoCanais()` |
| `src/config.js` + `.env.example` | sim | `IG_USER_ID`, `IG_ACCESS_TOKEN`, `PUBLICAR_STORIES`, `MAX_STORIES_DIA` |
| `src/app.js` | mínimo | um hook depois do envio no WhatsApp, isolado em try/catch |
| `src/status.js` | sim | contar descartes por motivo (`sem-preco`, `quota-esgotada`) |

## Fronteira

A regra de decisão é **pura** e provada por unit; a chamada HTTP é tarefa com prova `api:`. O
`app.js` recebe **um** ponto de chamada — nada de lógica de Instagram dentro dele.

## Riscos

1. Token expirando em silêncio → CA-7 obriga o `doctor` a checar antes de publicar.
2. Quota medida em 24 h corridas (não por dia de calendário) — usar o que a API devolve.
3. Conta de 80 seguidores: `MAX_STORIES_DIA=5` de fábrica para não virar spam.
