---
id: FEAT-013
titulo: Publicacao no feed do Instagram
persona: operadora
prioridade: ALTA
origem: "pedido de replicar as ofertas no feed; a Content Publishing aceita 4:5 a 1.91:1 (o story 9:16 é recusado) e o media_type estava fixo em STORIES"
estado: em-revisao
---

## História

Como operadora, quero que as mesmas ofertas que vão para o grupo também apareçam no **feed** do
Instagram — como post, carrossel ou reels — para alcançar quem não abre os stories.

## Regras de negócio

- Feed aceita **4:5 a 1.91:1**; o story 9:16 **não serve** → composição própria sobre `post-base`.
- Dedup é por **(produto, formato)**: story publicado não impede o post do mesmo produto.
- A **quota é compartilhada** entre story/post/reels (`content_publishing_limit`).
- Reels só publica com `status_code=FINISHED`; enquanto processa, não bloqueia nada.
- O link não é clicável no post: a legenda promete o que o `GO_DESTINO` realmente entrega.

## Critérios de aceite

- **CA-1** — When for publicar no feed, o sistema shall normalizar `post-base` (928×1152) para
  **1080×1350** e compor com as zonas de `assets/template/post.json`: foto em `contain` na janela
  (sem cobrir os adesivos), título e preço no painel navy, CTA na pílula amarela, apoio na rosa.
  prova: `unit:test/feed.test.js`
- **CA-2** — When publica **post** de imagem única, shall criar container `IMAGE`, publicar e gravar
  `mediaId`/`publicadoEm` no formato `post`.
  prova: `unit:test/feed.test.js`
- **CA-3** — When houver 2 a 10 fotos da galeria, shall montar **carrossel** (`is_carousel_item` +
  `CAROUSEL`) na ordem da galeria.
  prova: `unit:test/feed.test.js`
- **CA-4** — When publica **reels**, shall gerar MP4 9:16 (≤30 s, H.264/AAC), criar container `REELS`
  com `share_to_feed=true` e publicar só após `FINISHED`.
  prova: `unit:test/instagram.test.js`
- **CA-5** — While o container de vídeo não estiver `FINISHED`, o sistema shall não publicar, tentar no
  ciclo seguinte e nunca bloquear o WhatsApp.
  prova: `unit:test/feed.test.js`
- **CA-6** — If `MAX_POSTS_DIA`, `MAX_REELS_DIA` ou a quota estiverem esgotados, shall não publicar
  aquele formato.
  prova: `unit:test/feed.test.js`
- **CA-7** — O dedup shall ser por **(produto, formato)**: story publicado não impede o post, e
  vice-versa.
  prova: `unit:test/feed.test.js`
- **CA-8** — O preflight shall validar `image/jpeg` para post/carrossel e `video/mp4` para reels.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-9** — When o ciclo rodar, o log shall usar `[ig]` com o formato (`post`/`carrossel`/`reels`) no
  mesmo `logs/app.log`.
  prova: `unit:test/feed.test.js`
- **CA-10** — `GET /go` shall redirecionar para o link do **último publicado de qualquer formato**.
  prova: `unit:test/servidor.test.js`

## Não-objetivos

- Não gera vídeo a partir de vídeo da loja (a FEAT-006 mediu que nenhuma entrega vídeo utilizável).
- Não faz anúncios pagos, não edita a bio, não republica oferta já publicada naquele formato.
- A redação da legenda é a FEAT-014.
- **Reels: a geração do vídeo fica para depois.** A publicação está pronta e testada
  (container, `share_to_feed`, espera do `FINISHED`, teto), mas nada gera o MP4 hoje.
  O formato precisa ser definido antes de ligar — ver `DT-001` em
  [`docs/debitos-tecnicos.md`](../../docs/debitos-tecnicos.md).

