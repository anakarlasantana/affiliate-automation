# Desenho — FEAT-013

## Fluxo

```
assets/template/post-base.jpeg (928x1152)
   └─ normalizado: post-base.png 1080x1350          ← CA-1
   └─ assets/template/post.json (zonas medidas)
        foto   : contain, teto 1.0 (adesivos preservados)
        titulo : painel navy (og:title, 2 linhas)
        preco  : painel navy (bold)
        cta    : pílula amarela -> "LINK NA BIO"
        apoio  : pílula rosa    -> "OFERTA DO DIA"


src/midia/feed.js
   └─ comporFeed({ foto, textos, template }) -> JPEG 1080x1350   ← CA-1


src/canais/instagram.js
   ├─ criarContainer({ tipo: 'IMAGE' })        -> CA-2
   ├─ criarContainer({ tipo: 'CAROUSEL' })     -> CA-3
   └─ criarContainer({ tipo: 'REELS' })        -> CA-4 (+ share_to_feed)
        └─ aguardarContainer(FINISHED, timeout maior)            ← CA-5


src/midia/acervo.js
   └─ chave por formato: `meli-MLB1` (story) | `meli-MLB1:post`  ← CA-7
   └─ chavePublicadaRecente() considera TODOS os formatos        ← CA-10
```

## Zonas medidas (canvas 1080x1350)

| Zona | x | y | w | h |
| :--- | ---: | ---: | ---: | ---: |
| foto | 162 | 337 | 756 | 554 |
| titulo | 100 | 955 | 880 | 90 |
| preco | 100 | 1045 | 520 | 95 |
| de | 640 | 1060 | 340 | 70 |
| cta | 270 | 1148 | 508 | 67 |
| apoio | 432 | 1269 | 162 | 41 |

## Decisões e por quês

- **Template próprio para 4:5:** a Meta recusa 9:16 no feed; reaproveitar o story daria erro de API.
- **`contain` na janela:** o layout tem adesivos (lupa, sacola) dentro da moldura; `cover` os cobriria.
- **Título no painel navy:** a faixa do cabeçalho é halftone e o logo ocupa o centro — não há área limpa.
- **Dedup por (produto, formato):** sem isso o story publicaria e bloquearia o post do mesmo produto.
- **Reels espera `FINISHED`:** o processamento do vídeo leva minutos; publicar antes devolve erro.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Janela é paisagem (756x554): foto retrato fica baixa | documentado; próximo layout pode aumentar a janela |
| Reels de foto = slideshow (ffmpeg) | custo de CPU no VPS; engajamento menor que vídeo real |
| Quota compartilhada (100/24 h) | limites por formato (CA-6) |
