# Desenho -- FEAT-021

## O caso real (28/11, grupo Promobit)

```
Tentando link: promoby.me/f13gutbdu9t2
URL limpa    : mercadolivre.com.br/social/promobit          <- vitrine
Produto extra: MLB-4378526247 case-starlink                 <- mergulhador escolheu
Meu link     : ...MLB-4378526247-_JM?matt_tool=20619494     <- afiliado CORRETO
[foto] foto-mensagem ok (110 KB)
foto preterida por regra SO_SITE -> site falhou (captcha)
foto da mensagem REASSUMIDA (plano B)                        <- card da marca no grupo
preco=500 (do texto "CUPOM NA MAO")                          <- valor de cupom
```

Tres defeitos, tres correcoes independentes.

## Trilha 1 -- foto estrita (CA-1, CA-2)

`resolverFotoDaOferta` ganha `permitirPlanoB` (default `true`). Quando `preferirSite` for verdadeiro
(grupo em `FONTES_FOTO_SOMENTE_SITE`), o chamador passa `permitirPlanoB: false`:

```
site falhou + permitirPlanoB=false  ->  placeholder  (card nunca vai ao grupo)
site falhou + permitirPlanoB=true   ->  foto da mensagem (FEAT-017 mantida)
```

## Trilha 2 -- bloqueio de story (CA-3, CA-4)

Modulo novo `src/midia/bloqueio-oferta.js`:

```js
avaliarOfertaParaStory({ texto, tituloProduto, veioDeVitrine, preco, precoDeProduto })
  -> { story: boolean, motivo: 'vitrine-sem-produto' | 'cupom-sem-produto' | null }
```

- **vitrine-sem-produto**: `veioDeVitrine` E o texto nao menciona o produto extraido (comparacao por
  palavras significativas do titulo).
- **cupom-sem-produto**: o texto nao tem nome de produto (so cupom, preco e link).
- Em ambos: `story: false` -- o **envio no grupo continua** (regra de negocio).

## Trilha 3 -- preco confiavel (CA-5, CA-6)

`valorDeDesconto()` (preco.js) passa a reconhecer:

| Redacao | Exemplo real |
| :--- | :--- |
| `N OFF` | `R$ 120 OFF acima de R$ 799` |
| `CUPOM NA MAO` | `CUPOM NA MAO pra garantir aquele alivio` |
| `use o cupom` | `Use o cupom BLACK10` |
| `cupom de R$ N` | `cupom de R$ 50` |
| `R$ N de desconto` | `R$ 300 de desconto` |
| emoji de cupom na linha | `🎟️ R$ 500` |

Se o texto so tiver cupom e a origem (API/pagina) nao trouxer preco -> `resolverPreco` devolve `null`.

## Decisoes e por ques

- **Regra acima do plano B:** a FEAT-017 priorizou "sempre ter imagem"; em grupo cujo card nao e o produto
  isso piora o resultado. A regra volta a mandar, com placeholder no pior caso.
- **Bloqueio de story, nao de envio:** o WhatsApp e o canal principal e a oferta pode ser boa; o feed e
  permanente e nao aceita imagem/preco duvidosos (escolha B2 da operacao).
- **Comparacao por palavras do titulo:** evita bloquear quando o texto cita o produto de outro jeito
  (ex.: "case starlink" no texto e `Case Starlink Mini` no titulo).
- **Lista de redacoes explicita:** cada item veio de uma oferta real; heuristica generica erra mais.

## Riscos

| Risco | Mitigacao |
| :--- | :--- |
| Bloquear story bom por falta de match | match por palavra significativa (>=4 letras) e normalizacao de acento |
| Placeholder em grupo SO_SITE com site fora | e o comportamento pedido (A) |
| Muitas redacoes futuras | log `cupom-sem-produto` mostra o caso e a lista cresce com dado |
