---
id: FEAT-006
titulo: Reels e carrossel a partir das imagens da loja
persona: operadora
prioridade: MEDIA
origem: "Content Publishing (REELS/CAROUSEL) + medição de que nenhuma loja entrega vídeo utilizável"
estado: em-revisao
---

## História

Como operadora, quero transformar as **fotos que já extraio** em Reels e carrosséis automáticos,
porque o Reel é o único formato que o Instagram entrega a quem não me segue — e nenhuma loja me
dá vídeo pronto.

## Regras de negócio

- Vídeo publicado por API sai **sempre como Reels** (vídeo de feed foi depreciado).
- **Nenhuma loja entrega vídeo utilizável**: ML expõe `video_id` (YouTube), Shopee não tem o campo
  e Magalu não entrega imagem (medido). O vídeo é **gerado** com `ffmpeg`.
- Carrossel vai de **2 a 10 itens**; com menos de 3 fotos o retorno é baixo.
- Com **1 foto**, o vídeo ganha movimento (zoom) em vez de slide parado.
- `MAX_REELS_DIA` limita volume; container de vídeo exige aguardar `status_code=FINISHED`.
- OAuth do Mercado Livre é pré-requisito para carrossel com várias fotos (hoje o ML entrega 1).
- **Nenhum feed de vídeo das lojas tem API de publicação para afiliado** (validado em
  26/11/2026): o **Clips** do Mercado Livre é do **vendedor** (com aprovação), o **Shopee Vídeo**
  e o **Magalu Vídeos** existem só nos apps. A API de Afiliados da Shopee é leitura + shortlink,
  sem operação de vídeo.
- Por isso o vídeo vira um **pacote de publicação**: arquivo MP4 + título + descrição + id do
  produto + canais onde há feed. A produção é automática; o upload no app da loja é humano.

## Critérios de aceite

- **CA-1** — When há 3 ou mais fotos do produto, the sistema shall montar um carrossel de até 10 itens na ordem da galeria.
  prova: `unit:test/reels.test.js`
- **CA-2** — When o produto tem vídeo, the sistema shall publicá-lo como media_type=REELS a partir de MP4 9:16 gerado.
  prova: `unit:test/reels.test.js`
- **CA-3** — When gera o MP4, the sistema shall respeitar duração máxima de 30 s e codec H.264 com áudio AAC.
  prova: `unit:test/reels.test.js`
- **CA-4** — If MAX_REELS_DIA foi atingido, the sistema shall não publicar mais reels naquele dia.
  prova: `unit:test/reels.test.js`
- **CA-5** — When só existe uma foto, the sistema shall aplicar movimento de zoom em vez de slideshow estático.
  prova: `unit:test/reels.test.js`
- **CA-6** — When o vídeo é gerado, the sistema shall montar um pacote de publicação com arquivo, título, descrição, id do produto e canais onde há feed.
  prova: `unit:test/reels.test.js`

## Não-objetivos

- Baixar vídeo do YouTube do anúncio do ML (viola os termos do YouTube).
- Legenda com música licenciada: a API só aceita áudio próprio.
- Edição criativa com trilha, transições cinematográficas ou legendas queimadas por IA.
- Publicar Reels fora do Instagram (TikTok tem API própria, outra spec).
- Publicar no **Clips** (ML), **Shopee Vídeo** ou **Magalu Vídeos** por API: não há operação de
  vídeo para afiliado nesses programas — o pacote de publicação existe para o upload humano.
- Republicar vídeo de **criador** do feed de uma loja: conteúdo de terceiros, exige autorização.
- **Clips do Mercado Livre / programa "Afiliados e Criadores"**: exige **10.000+ seguidores** no
  TikTok ou Instagram — a conta `@garimpa.a` (**80**) não se qualifica, e o Clips é do vendedor
  de qualquer forma.
- Usar **banner de Brand Offer** (Shopee) como criativo: é arte de campanha, não a foto do item.
