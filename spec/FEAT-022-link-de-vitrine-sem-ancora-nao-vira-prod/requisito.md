---
id: FEAT-022
titulo: Link de vitrine sem ancora nao vira produto aleatorio
persona: operadora
prioridade: ALTA
origem: "28/11: oferta de CUPOM do Promobit gerou link para um case Starlink escolhido ao acaso pelo mergulhador (primeiro MLB do HTML da vitrine). Em 6h, 31 ofertas passaram por /social/ e NENHUMA tinha o token ref."
estado: em-revisao
---

## Historia

Como operadora, quero que oferta de cupom/vitrine va ao grupo com link legitimo (produto certo ou a
minha vitrine) e nunca com um produto escolhido ao acaso -- para nao publicar oferta fake.

## Regras de negocio

- Produto aleatorio e fake. Se o produto extraido da vitrine nao tem relacao com o texto, nao pode virar
  link de produto.
- O fallback para a vitrine propria ja existe (`MELI_SOCIAL_ID`), mas so roda quando o mergulhador devolve
  `null` -- e ele quase nunca devolve, porque pega o primeiro MLB do HTML.
- Cupom continua indo ao grupo, com link da vitrine propria: o cliente escolhe o produto la.
- Story exige foto confiavel: oferta de vitrine sem produto confirmado nao gera story.
- Foto de vitrine vem do site/API, nunca do card da mensagem.

## Criterios de aceite

- **CA-1** -- When o link for de vitrine e o produto extraido nao casar com o texto da oferta, o sistema shall
  usar o link da vitrine propria (`MELI_SOCIAL_ID`) em vez do produto aleatorio.
  prova: `unit:test/vitrine.test.js`
- **CA-2** -- When o produto extraido casar com o texto (palavras significativas em comum), o sistema shall
  usar o link do produto.
  prova: `unit:test/vitrine.test.js`
- **CA-3** -- If nao houver vitrine propria configurada e o produto nao casar, o sistema shall nao publicar a
  oferta (motivo `vitrine-sem-ancora`).
  prova: `unit:test/vitrine.test.js`
- **CA-4** -- When a oferta vier de vitrine sem produto confirmado, o sistema shall enviar ao grupo e shall nao
  gerar story (motivo `vitrine-sem-produto`).
  prova: `unit:test/bloqueio-oferta.test.js`
- **CA-5** -- O log shall registrar a origem do link usado (`produto` | `vitrine-propria`).
  prova: `unit:test/vitrine.test.js`

## Nao-objetivos

- Nao tenta adivinhar o produto dentro da vitrine por busca (proxima spec).
- Nao muda a conversao de link direto de produto.
- Nao altera layout, legenda ou o redirecionador `/go`.
