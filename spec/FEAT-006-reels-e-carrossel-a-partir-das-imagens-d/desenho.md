# Desenho — FEAT-006

## Fluxo

```
fotos do produto (extrairGaleria / API da loja)
  ├─ escolherFormato(fotos)                                     ← CA-1, CA-5
  │     ├─ >=3 fotos → 'carrossel' (até 10)
  │     ├─ 1 foto    → 'zoom'
  │     └─ 0 fotos   → 'nenhum' (não publica)
  ├─ montarArgsFfmpeg({ fotos, duracao }) → argv do ffmpeg       ← CA-2, CA-3
  │     └─ 1080x1920 · 30 fps · H.264 + AAC · ≤30 s
  └─ publicar: container (media_type=REELS, video_url)
        └─ status_code até FINISHED → media_publish
  └─ pacote de publicação → { arquivo, título, descrição, produtoId, canais }   ← CA-6
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `escolherFormato(fotos)` | `'carrossel' \| 'zoom' \| 'nenhum'` + motivo |
| `montarArgsFfmpeg(opts)` | `string[]` — sem executar (testável!) |
| `dentroDoLimite(duracaoSeg, maxSeg = 30)` | `boolean` |
| `payloadReels({ videoUrl, legenda })` | `{ media_type: 'REELS', video_url, caption }` |
| `payloadCarrossel(children)` | `{ media_type: 'CAROUSEL', children }` com 2..10 itens |
| `limiteAtingido(usadosHoje, max)` | `boolean` |
| `canaisComFeed(loja)` | `['shopee']` · `['magalu']` · `['instagram']` (ML Clips é do vendedor) |
| `montarPacotePublicacao({ arquivo, titulo, descricao, chave, loja })` | pacote pronto: arquivo + copy truncada + `produtoId` + canais |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/canais/reels.js` | **novo** | formato, argv do ffmpeg e payloads (puro) |
| `src/midia/video.js` | novo (tarefa) | executa `ffmpeg` de verdade |
| `src/lojaApi.js` | sim (tarefa) | buscar galeria completa quando houver OAuth |
| `src/config.js` + `.env.example` | sim | `MAX_REELS_DIA`, `DURACAO_REEL_SEG` |

## Fronteira

O **argv do ffmpeg** é construído por função pura e provado por unit (CA-2, CA-3) — executar o
binário fica na tarefa, porque depende do `ffmpeg` instalado. O carrossel depende de OAuth do ML
para ter mais de uma foto.

## Riscos

1. `ffmpeg` ausente na VPS → FEAT-006 falha isolada; story e Direct seguem funcionando.
2. Container de vídeo demora a ficar `FINISHED` — polling de 1/min até 5 min (recomendação da doc).
3. Carrossel com 1 foto seria pior que Reels: por isso o formato é escolhido por quantidade.
