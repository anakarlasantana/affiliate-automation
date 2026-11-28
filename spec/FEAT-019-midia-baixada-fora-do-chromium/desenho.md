# Desenho — FEAT-019

## O problema, no código de terceiro

```js
// @wppconnect-team/wppconnect/dist/api/whatsapp.js:119
async downloadMedia(messageId) {
  return await evaluateAndReturn(this.page, async (messageId) => {
    const media = await WPP.chat.downloadMedia(messageId);   // roda NA PÁGINA
    return WPP.util.blobToBase64(media);
  }, messageId);
}
```

```js
// @wppconnect/wa-js (bundle): o wa-js processa a imagem NO RENDERER
"image" === r.type ? (j = r?.isHD ? 2560 : 1600) : ...
const S = MediaPrep.prepRawMedia(M, { ...w, maxDimension: j });
```

**Medido em 28/11**: 91 × `Runtime.callFunctionOn timed out` em 60 min, com `nproc=4` e
`load average 0,21`. Aumentar OCPU de 2→4 **não mudou nada** — não é falta de recurso, é onde o
trabalho acontece.

## Fluxo novo (fallback)

```
1. client.downloadMedia(id)            ← caminho atual (funciona no notebook)
       │ falhou?
       ▼
2. metadadosNaPagina(client, id)       ← UMA chamada leve: directPath + mediaKey (~200 B)
       │
       ▼
3. baixarMidiaForaDoNavegador()        ← Node: GET mmg.whatsapp.net<directPath>
       │
       ▼
4. descriptografarMidia()              ← Node: AES-256-CBC + HMAC (10 bytes finais)
       │
       ▼
5. data-URL JPEG  → origemFotoMidia = 'mensagem:node'
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `normalizarMediaKey(chave)` | `Buffer(32)` ou `null` |
| `derivarChaves(mediaKey, tipo)` | `{ iv, cipherKey, macKey, refKey }` ou `null` |
| `descriptografarMidia(buffer, mediaKey, tipo)` | `{ ok, dados, motivo }` |
| `baixarMidiaForaDoNavegador({ metadados, http, host, timeoutMs })` | `{ base64, bytes, motivo }` |
| `metadadosNaPagina(client, msgId)` | `{ directPath, mediaKey, mimetype }` ou `null` |

## Decisões e por quês

- **Fallback, não substituição:** no notebook o `downloadMedia` funciona e é mais simples; trocar o
  caminho principal quebraria o que já está bom.
- **Uma chamada à página, só com strings:** o `evaluate` devolve ~200 bytes em vez da imagem inteira em
  base64 — é o que evita o timeout do CDP.
- **Verificar o MAC antes de usar:** arquivo adulterado ou chave trocada devolveria lixo; melhor recusar
  e cair na cascata.
- **`MIDIA_NO_NODE=0`:** permite desligar sem deploy de código, se a estratégia causar efeito colateral.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| `metadadosNaPagina` usa `page.evaluate` — falha se o CDP estiver morto | devolve `null` e a cascata segue (FEAT-017) |
| Formato de criptografia do WhatsApp pode mudar | MAC inválido → recusa explícita, sem publicar lixo |
| `directPath` expira (URL assinada) | download imediato após receber a mensagem |
| Vídeo não suportado | fora de escopo (DT-001) |
