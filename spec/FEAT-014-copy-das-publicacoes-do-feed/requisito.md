---
id: FEAT-014
titulo: Copy das publicacoes do feed
persona: operadora
prioridade: ALTA
origem: "pedido de título, descrição, tags e informações de conversão no post do feed; hoje a legenda é só 'Oferta / link na bio'"
estado: em-revisao
---

## História

Como operadora, quero que o post do feed tenha **título, descrição, preço, cupom, CTA e hashtags**
escritos a partir dos dados reais da oferta — para o cliente entender o valor em 2 segundos e clicar.

## Regras de negócio

- A **primeira linha** é o que o feed mostra antes do "mais": nela vão **produto + preço + gancho**.
- Preço e desconto são **calculados** dos dados reais; nunca inventados.
- O CTA promete o que o `GO_DESTINO` entrega (`oferta` → produto; `grupo` → convite).
- No post **não existe link clicável** — a legenda sempre aponta para a bio.
- Hashtags: **até 10**, sem repetição, 1 da loja + nicho + intenção.
- Disclaimer de preço protege a operação: preço de oferta muda em minutos.

## Critérios de aceite

- **CA-1** — When compõe a publicação do feed, o sistema shall usar o título do produto (`og:title`,
  fallback 1ª linha da mensagem) na zona de título **e** na primeira linha da legenda.
  prova: `unit:test/legenda.test.js`
- **CA-2** — A descrição shall trazer preço, "de/por" e percentual de desconto **calculados** a partir
  dos dados reais, mais a loja de origem.
  prova: `unit:test/legenda.test.js`
- **CA-3** — A primeira linha shall ter **até 125 caracteres** e conter produto, preço e gancho.
  prova: `unit:test/legenda.test.js`
- **CA-4** — A legenda shall incluir **até 10 hashtags**, sem repetição, sempre com a da loja.
  prova: `unit:test/legenda.test.js`
- **CA-5** — O CTA shall ser coerente com `GO_DESTINO`: `oferta` → "link na bio abre a oferta";
  `grupo` → "link na bio leva ao grupo"; e shall nunca prometer link clicável no post.
  prova: `unit:test/legenda.test.js`
- **CA-6** — A legenda shall respeitar **2.200 caracteres** e truncar por **linha inteira**, nunca no
  meio de palavra ou emoji.
  prova: `unit:test/legenda.test.js`
- **CA-7** — When a mensagem trouxer cupom, a legenda shall citar o código (e a validade, se existir).
  prova: `unit:test/legenda.test.js`
- **CA-8** — A sanitização shall remover links crus da mensagem e não afirmar "frete grátis" ou
  "menor preço" sem evidência no texto.
  prova: `unit:test/legenda.test.js`

## Não-objetivos

- Não usa IA/generativa: a copy é montada por regra, determinística e testável.
- Não altera a legenda do WhatsApp (que continua curta, com o link no próprio post).
- Não traduz nem cria campanha paga.

