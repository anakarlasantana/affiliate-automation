---
id: FEAT-021
titulo: Foto estrita, cupom bloqueado e preco confiavel
persona: operadora
prioridade: ALTA
origem: "28/11 em producao: oferta de CUPOM do grupo Promobit saiu com a foto do CARD DA MARCA (o plano B da FEAT-017 anulou a regra FONTES_FOTO_SOMENTE_SITE) e com preco 500 lido do texto, que e valor de cupom e nao do produto. O link de afiliado estava correto (matt_tool=20619494)."
estado: em-revisao
---

## Historia

Como operadora, quero que a foto do card da marca nunca va ao grupo e que oferta de cupom sem produto
nao ocupe o feed do Instagram -- sem perder a oferta no grupo quando ela for legitima.

## Regras de negocio

- A regra manda mais que o plano B. Em `FONTES_FOTO_SOMENTE_SITE`, a foto da mensagem NAO volta como
  plano B: se o site falhar, aplica o placeholder da aplicacao.
- Vitrine nao escolhe produto pelo anunciante. Quando o link e `/social/<perfil>` e o texto nao cita o
  produto extraido, a oferta segue para o WhatsApp mas nao gera story (imagem e preco sao duvidosos).
- Cupom nao e preco de produto. Redacoes como `CUPOM NA MAO`, `use o cupom`, `cupom de R$ N` e
  `R$ N de desconto` tambem marcam valor de desconto.
- Sem preco de produto nao ha story (regra de produto mantida).
- Oferta legitima nunca e descartada: bloqueio de story nunca bloqueia o envio no grupo.

## Criterios de aceite

- **CA-1** -- When o grupo estiver em `FONTES_FOTO_SOMENTE_SITE` e o site nao entregar foto, o sistema shall
  aplicar o placeholder e shall nao usar a foto da mensagem como plano B.
  prova: `unit:test/cascata-foto.test.js`
- **CA-2** -- Fora desses grupos, o plano B da foto da mensagem shall continuar valendo.
  prova: `unit:test/cascata-foto.test.js`
- **CA-3** -- When o link for de vitrine e o texto nao citar o produto extraido, o sistema shall enviar a
  oferta ao grupo e shall nao gerar story, registrando `vitrine-sem-produto`.
  prova: `unit:test/bloqueio-oferta.test.js`
- **CA-4** -- When a mensagem for so cupom (sem nome de produto), o sistema shall registrar
  `cupom-sem-produto` e shall nao gerar story.
  prova: `unit:test/bloqueio-oferta.test.js`
- **CA-5** -- O reconhecimento de cupom shall cobrir `N OFF`, `CUPOM NA MAO`, `use o cupom`, `cupom de R$ N`,
  `R$ N de desconto` e valor na mesma linha de um emoji de cupom.
  prova: `unit:test/preco-origem.test.js`
- **CA-6** -- If o texto so trouxer valor de cupom e nao houver preco de produto (API/pagina), o sistema shall
  devolver `null` e shall nao compor story.
  prova: `unit:test/preco-origem.test.js`

## Nao-objetivos

- Nao bloqueia o envio no grupo (o WhatsApp continua sendo o canal principal).
- Nao tenta adivinhar qual produto a vitrine "queria" mostrar.
- Nao muda o layout nem a legenda do feed (FEAT-013/014).
