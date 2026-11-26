---
id: FEAT-004
titulo: Story automático no Instagram
persona: operadora
prioridade: ALTA
origem: "opção A escolhida (API oficial, sem sticker) + decisão sem-preço-não-publica"
estado: em-revisao
---

## História

Como operadora, quero que o story saia sozinho, com a foto do produto, o **preço** e o convite a
responder **LINK** — para eu ter alcance 24/7 sem arriscar a conta com automação proibida.

## Regras de negócio

- A API **não** insere sticker de link; o story convida a responder, e o link vai no Direct
  (FEAT-005).
- **Sem preço não publica** — decisão de produto: story sem valor não converte.
- `PUBLICAR_STORIES=0` de fábrica (kill switch); `MAX_STORIES_DIA` limita o volume em conta pequena.
- A falha do Instagram **nunca** pode bloquear o envio no WhatsApp.
- Quota conferida antes de cada publicação (`GET /content_publishing_limit`).
- Container expira em 24 h; vídeo sempre vira Reels (FEAT-006).

## Critérios de aceite

- **CA-1** — If PUBLICAR_STORIES=0, the sistema shall não publicar nada no Instagram.
  prova: `unit:test/canais.test.js`
- **CA-2** — If o preço do produto não foi resolvido, the sistema shall não publicar o story e registrar o motivo.
  prova: `unit:test/canais.test.js`
- **CA-3** — If a quota de publicação está esgotada, the sistema shall não tentar publicar e registrar o motivo.
  prova: `unit:test/canais.test.js`
- **CA-4** — If a oferta já foi publicada no Instagram, the sistema shall não publicar de novo (dedup por canal).
  prova: `unit:test/canais.test.js`
- **CA-5** — If a publicação no Instagram falha, the sistema shall manter o envio no WhatsApp e reportar o erro separadamente.
  prova: `unit:test/canais.test.js`
- **CA-6** — When publica, the sistema shall criar um container media_type=STORIES e chamar media_publish com o id devolvido.
  prova: `api:ig-story`
- **CA-7** — If o token está inválido ou expirado, the sistema shall desligar o canal e avisar no doctor.
  prova: `api:ig-quota`

## Não-objetivos

- Link clicável dentro do story: não existe na API (doc + changelog até jul/2026).
- Automação de aparelho/RPA: viola os termos da Meta.
- Anúncio patrocinado em Stories: é mídia paga, decisão separada.
- Editar bio: a API não expõe escrita de perfil.
