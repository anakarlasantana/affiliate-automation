# Desenho — FEAT-005

## Fluxo

```
Meta  ──POST──▶ /webhooks/instagram
                 ├─ validarAssinatura(corpoCru, X-Hub-Signature-256, APP_SECRET)  ← CA-1
                 │     └─ inválida → 401, fim
                 ├─ 200 imediato (a Meta exige resposta rápida)                     ← CA-6
                 └─ processar (async):
                      ├─ lerEvento(payload) → { igsid, texto, mid, quando }
                      ├─ deveResponder(texto, PALAVRA)          sem palavra → ignora ← CA-2
                      ├─ jaRespondido(mid)                      repetido → ignora     ← CA-3
                      ├─ dentroDaJanela(quando, 24h)            vencida → registra    ← CA-4
                      └─ montarResposta(link, avisoAutomação)   → POST /<IG_ID>/messages ← CA-5
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `validarAssinatura(corpo, header, segredo)` | `boolean` — HMAC-SHA256 `sha256=<hex>` |
| `lerEvento(payload)` | `{ igsid, texto, mid, quando }` \| `null` |
| `deveResponder(texto, palavra)` | `boolean` — normaliza acento/caixa |
| `jaRespondido(mid)` / `marcarRespondido(mid)` | idempotência (memória + tabela) |
| `dentroDaJanela(quando, agora, 24h)` | `boolean` |
| `montarResposta(link)` | `string` com link + aviso de automação |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/canais/direct.js` | **novo** | assinatura, parsing do webhook, resposta (puro) |
| `src/servidor.js` | sim | rota `POST /webhooks/instagram` (raw body!) |
| `src/database.js` | sim | tabela `direct_respondidos(mid, igsid, quando)` |
| `src/config.js` + `.env.example` | sim | `IG_APP_SECRET`, `DIRECT_PALAVRA`, `DIRECT_ATIVO` |
| `scripts/verificar-ig.mjs` | sim | checar assinatura do webhook (read-only) |

## Fronteira

Tudo que decide **se** responde é puro e testado. O envio HTTP e o registro em banco são tarefas.
A rota do webhook precisa do **corpo cru** — `express.json()` destruiria a assinatura.

## Riscos

1. Reenvio da Meta (retry) duplicaria DMs → idempotência por `mid` é obrigatória (CA-3).
2. Janela de 24 h: responder fora dela dá erro de API — por isso checamos antes (CA-4).
3. Segredo do app no `.env`; assinatura sem segredo não valida — endpoint fica fechado se faltar.
