---
id: FEAT-011
titulo: Preco e titulo na origem e CTA da bio
persona: operadora
prioridade: ALTA
origem: "monitoramento de 27/11: cupom 'R$ 300 OFF acima de R$ 1.999' virou preço 300 no story; og:title do produto era descartado; GO_DESTINO ausente e obterChaveAtual nulo fariam /go responder 404"
estado: em-revisao
---

## História

Como operadora, quero que o preço e o título do story venham **do produto** (não do texto da mensagem)
e que "LINK NA BIO" leve de fato à oferta publicada — para nenhum story anunciar preço falso, título
genérico ou link quebrado.

## Regras de negócio

- Preço de **cupom/desconto não é preço de produto**: em "R$ 300 OFF acima de R$ 1.999", 300 é o desconto.
- `escolherPreco(daApi, doTexto)` já existe e é testado; passa a ser usado no pipeline (hoje é código morto).
- Sem preço confiável **não há story** (regra de produto mantida: story sem valor não converte).
- O "de/por" do texto é preservado quando for maior que o preço da API.
- Título do criativo vem do `og:title` da página do produto; a 1ª linha da mensagem é só fallback.
- `GET /go` (bio) aponta para a oferta **publicada mais recentemente**; sem oferta, 404 — nunca o grupo.

## Critérios de aceite

- **CA-1** — When o texto não trouxer preço de produto, o sistema shall consultar a origem (API da loja
  quando existir; senão `og:price`/JSON-LD da página) antes de desistir.
  prova: `unit:test/preco-origem.test.js`
- **CA-2** — When houver preço da origem e preço no texto, o pipeline shall escolher com
  `escolherPreco(daApi, doTexto)`: a API vence e o "de" do texto é preservado quando for maior.
  prova: `unit:test/preco-origem.test.js`
- **CA-3** — When o texto trouxer apenas valor de desconto/cupom (`N OFF`, `acima de R$ N`, linha de
  cupom), o sistema shall descartá-lo ao extrair o preço.
  prova: `unit:test/preco-origem.test.js`
- **CA-4** — When a página do produto trouxer `og:title`, o sistema shall usar esse título no criativo e
  no acervo, em vez da primeira linha da mensagem.
  prova: `unit:test/preco-origem.test.js`
- **CA-5** — When `GO_DESTINO=oferta`, o criativo shall usar o CTA "LINK NA BIO" (apoio "oferta do dia")
  em vez de "ENTRE NO GRUPO".
  prova: `unit:test/midia.test.js`
- **CA-6** — When um story é publicado, `GET /go` shall redirecionar para o link de afiliado da oferta
  publicada mais recentemente; if não houver oferta publicada, shall responder 404.
  prova: `unit:test/servidor.test.js`

## Não-objetivos

- Não muda a fila nem o ritmo anti-ban do WhatsApp.
- Não publica nada por conta própria (isso é a FEAT-012).
- Não cria token, conta ou aplicativo da Meta.
- Não resolve o endereço público estável (item de deploy: domínio + Caddy).

