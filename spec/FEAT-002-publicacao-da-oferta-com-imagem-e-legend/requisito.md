---
id: FEAT-002
titulo: Publicação da oferta com imagem e legenda do nosso link
persona: operadora
prioridade: ALTA
origem: README — cascata de imagem e legenda; docs/harness/arquitetura.md
estado: em-revisao
---

## História

Como operadora do grupo, quero que a oferta publicada traga a imagem do **mesmo
produto** (a da mensagem ouvida ou uma do site) junto com a legenda que carrega
o **meu** link, para o leitor comprar o produto certo pelo meu rastreio.

## Regras de negócio

- Nenhuma oferta sai sem foto: a cascata termina no placeholder da loja
  (`assets/placeholder-confira-produto.png`, sobrescrito por `PLACEHOLDER_IMAGEM`).
- Miniatura do WhatsApp (72x72, `jpegThumbnail`) **não** é foto do produto. O
  critério é **dimensão** (`MIN_LADO_FOTO = 300px`), não bytes: um og:image
  legítimo tem ~15 KB, menos que muitos thumbnails.
- `FONTES_FOTO_SOMENTE_SITE` força a foto do site para fontes cujo card não é o
  produto (ex.: grupo Promobit) — regra aplicada antes da cascata.
- A legenda respeita `LIMITE_LEGENDA_FOTO = 1000` e sempre contém o nosso link.
- Ordem da cascata (motivo em `src/app.js`, funções em `src/imagem.js`):
  foto da mensagem → `downloadMedia` → og:image/galeria do site → API da loja →
  placeholder.

## Critérios de aceite

- **CA-1** — When a mensagem ouvida traz foto, the sistema shall aceitar como foto do produto apenas mídia com lado maior maior ou igual a 300px.
  prova: `unit:test/imagem.test.js`
- **CA-2** — If a foto recebida é miniatura (72x72), the sistema shall tratá-la como insuficiente e recorrer à imagem do site ou ao placeholder.
  prova: `unit:test/imagem.test.js`
- **CA-3** — If não há foto na mensagem nem no site, the sistema shall publicar o placeholder da loja, nunca uma oferta sem imagem.
  prova: `unit:test/imagem.test.js`
- **CA-4** — When a legenda com o nosso link excede 1000 caracteres, the sistema shall truncar o texto preservando o link de afiliado.
  prova: `unit:test/imagem.test.js`
- **CA-5** — When a página do produto expõe og:image, the sistema shall publicar a foto do produto em vez do placeholder.
  prova: `api:verify-links`

## Não-objetivos

- **Envio real** ao grupo do WhatsApp (fila anti-ban, janelas de horário,
  `MAX_ENVIOS_DIA`): depende de sessão viva e publica em grupo real. A política
  fica em `src/sendQueue.js` e é validada em produção, não aqui.
- Dedup entre dias (`jaFoiEnviada`) — pertence ao FEAT-001 (identidade de
  produto).
- Legenda "bonita" (emoji, formatação de preço): o app apenas limpa divulgação
  alheia e anexa o link; redação criativa está fora do escopo.
- Recorte/redimensionamento da imagem: o app publica a imagem como veio.
