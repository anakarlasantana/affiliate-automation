---
id: FEAT-003
titulo: Mídia pública e redirecionador de afiliado
persona: operadora
prioridade: ALTA
origem: "docs de Content Publishing (mídia em servidor público) + opção A de story"
estado: em-revisao
---

## História

Como operadora, quero que cada oferta renda uma **imagem 9:16 pronta** e um **link curto no meu
domínio** que leve ao produto com o meu rastreio — e que eu saiba quantos clicaram — para o
Instagram conseguir baixar a mídia e para eu medir o que ele não mede.

## Regras de negócio

- A Meta **baixa** a mídia por URL pública; base64 no `.env` não serve.
- Story é **9:16**; publicar 1:1 gera tarja. O criativo é composto, não recortado.
- **JPEG, nunca PNG/WebP**: PNG já teve relato de deixar o link do sticker inoperante, e a galeria
  das lojas pode vir WebP.
- **Preço é obrigatório** no criativo. Fonte 1 = API da loja; fonte 2 = texto ouvido; sem nenhum
  dos dois, a oferta não vira story (FEAT-004).
- A página do produto **não** entrega preço ao scraping (medido: preview do ML 12,7 KB e da Shopee
  21,7 KB sem `price`) — por isso a API e o texto são as fontes.
- O redirecionador é nosso: destino trocável sem tocar no Instagram (a API não edita bio).
- **Banner oficial existe, mas não é foto de produto**: a API de Afiliados da Shopee devolve
  `banners[].fileName` / `imageUrl` das *Brand Offers* (changelog de 15/06/2021) — é arte de
  **campanha**, não o item; no máximo serve de fundo, nunca como criativo principal.
- **A vitrine própria é fonte preferencial quando o site bloqueia**: a loja do afiliado
  (`mercadolivre.com.br/social/<slug>`, `magazinevoce.com.br/magazine<loja>`) serve os cards com a
  imagem do produto, e o `mergulhador` já lê a vitrine do ML. O site do Magalu devolve **403**; a
  vitrine é a alternativa a validar.

## Critérios de aceite

- **CA-1** — When a oferta é aprovada, the sistema shall compor imagem 1080x1920 (9:16) a partir da foto do produto, sem distorcer.
  prova: `unit:test/midia.test.js`
- **CA-2** — If a foto de origem é PNG ou WebP, the sistema shall convertê-la para JPEG antes de servir.
  prova: `unit:test/midia.test.js`
- **CA-3** — When o texto ouvido traz preço, the sistema shall extrair o valor e o "de/por" ignorando parcelamento e frete.
  prova: `unit:test/midia.test.js`
- **CA-4** — When a loja tem API de preço, the sistema shall preferir o preço da API ao do texto.
  prova: `unit:test/midia.test.js`
- **CA-5** — When a mídia é composta, the sistema shall servi-la numa URL pública com hash do conteúdo.
  prova: `unit:test/midia.test.js`
- **CA-6** — When alguém abre /go/<chave>, the sistema shall redirecionar 302 para o link de afiliado com o nosso rastreio.
  prova: `unit:test/redirecionador.test.js`
- **CA-7** — When o redirecionamento acontece, the sistema shall registrar o clique daquela chave.
  prova: `unit:test/redirecionador.test.js`
- **CA-8** — If a chave não existe ou expirou, the sistema shall responder 404 sem redirecionar.
  prova: `unit:test/redirecionador.test.js`

## Não-objetivos

- Publicar no Instagram (é a FEAT-004).
- Editar a bio do perfil: a API do Instagram não expõe escrita de perfil.
- Hospedagem externa (S3/R2): o servidor do próprio app serve a mídia.
- Recortar a foto original do produto: a composição apenas a enquadra.
