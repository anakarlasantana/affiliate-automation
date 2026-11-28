---
id: FEAT-019
titulo: Midia baixada fora do Chromium
persona: operadora
prioridade: ALTA
origem: "28/11: downloadMedia falhou 91 vezes com 'Runtime.callFunctionOn timed out' na VPS — mesmo com 4 vCPU e load 0,21; toda oferta caiu em placeholder. O wppconnect roda o download DENTRO da pagina (evaluateAndReturn) e o wa-js processa a imagem no renderer (prepRawMedia)."
estado: em-revisao
---

## História

Como operadora, quero que a **foto da mensagem seja baixada mesmo quando o navegador travar** — para as
ofertas chegarem ao WhatsApp e ao Instagram com imagem real, e não com placeholder.

## Regras de negócio

- **O trabalho pesado sai do navegador.** Baixar e descriptografar imagem é CPU pura; não deve rodar no
  renderer que já hospeda o WhatsApp Web.
- **A página só entrega metadados** (`directPath`, `mediaKey`, ~200 bytes) — nunca a imagem inteira.
- **O caminho atual continua primeiro**: o download pelo wppconnect é tentado antes; o Node é fallback.
- **Falha em qualquer etapa** cai na cascata de foto (site → plano B → placeholder), sem descartar a oferta.
- `MIDIA_NO_NODE=0` desliga a estratégia (para diagnóstico).

## Critérios de aceite

- **CA-1** — O sistema shall derivar as chaves da mídia (`iv` 16, `cipherKey` 32, `macKey` 32, `refKey` 32)
  por HKDF-SHA256 a partir da `mediaKey` de 32 bytes, rejeitando chave inválida.
  prova: `unit:test/midia-node.test.js`
- **CA-2** — O sistema shall descriptografar o arquivo do WhatsApp (AES-256-CBC + HMAC-SHA256 nos
  10 últimos bytes) e **recusar** o arquivo quando o MAC não conferir.
  prova: `unit:test/midia-node.test.js`
- **CA-3** — When o `downloadMedia` do wppconnect falhar, o sistema shall baixar a mídia em **Node**
  (`mmg.whatsapp.net` + descriptografia) e marcar a origem como `mensagem:node`.
  prova: `unit:test/midia-node.test.js`
- **CA-4** — O sistema shall extrair os metadados com **uma única chamada** à página, sem trazer os bytes
  da imagem, e shall devolver `null` (sem lançar) quando a página não responder.
  prova: `unit:test/midia-node.test.js`
- **CA-5** — If o download em Node falhar (`metadados-incompletos`, `mac-invalido`, `http-4xx`,
  `timeout-download`), o sistema shall registrar o motivo e seguir a cascata de foto, sem descartar a oferta.
  prova: `unit:test/midia-node.test.js`

## Não-objetivos

- Não substitui o download atual quando ele funciona (o Node é fallback).
- Não implementa download de vídeo (Reels segue adiado, DT-001).
- Não muda a política de foto por fonte (`FONTES_FOTO_SOMENTE_SITE`, FEAT-017).
- Não recria a página do WhatsApp quando o frame morre (FEAT-018 cobre a detecção).

