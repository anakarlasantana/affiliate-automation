# Desenho -- FEAT-022

## O defeito, no codigo

```js
// src/affiliates/mercadolivre.js:153
// 3) Fallback: vitrine de terceiro apontando para a sua vitrine
const matchVitrine = caminho.match(/^\/social\/([\w-]+)/);
if (matchVitrine && minhaVitrine) { /* usa a vitrine propria */ }
```

O fallback existe, mas so roda quando `extrairProdutoDePaginaSocialMeli` devolve `null`. E o mergulhador
pega o PRIMEIRO `MLB` do HTML:

```js
// src/linkResolver.js:612
const mSlug = html.match(/(MLB-\d+[\w-]*?_JM)/i);
```

Como a vitrine sempre tem algum produto, o fallback nunca dispara -- e o link sai aleatorio.

## Fluxo novo

```
converterParaAfiliado(url)                    (provider, sem mudar assinatura)
  └─ devolve { link, produtoIdentificado, vitrineDeTerceiro, mlbId }

app.js (depois de converter)
  ├─ veioDeVitrine ?
  │    ├─ textoCitaProduto(texto, tituloDoProduto)?  -> link do produto   (CA-2)
  │    └─ nao casa -> pede link da vitrine propria                        (CA-1)
  │         ├─ MELI_SOCIAL_ID configurado -> link vitrine-propria         (CA-5)
  │         └─ sem vitrine -> nao publica (vitrine-sem-ancora)            (CA-3)
  └─ story: so com produto confirmado                                     (CA-4)
```

## Contrato novo

| Funcao | Forma |
| :--- | :--- |
| `linkDaVitrinePropria(url, affiliateId, socialId)` (provider ML) | URL da vitrine com tracking, ou `null` |
| `classificarOrigemDoLink(url)` | `'produto'` \| `'vitrine'` |

## Decisoes e por ques

- **Sem mudar `converter()`:** outros providers nao tem vitrine; alterar a assinatura obrigaria a mexer em
  todos. O app compara o texto e, se precisar, pede o link da vitrine.
- **Casamento por palavra significativa:** o texto do grupo cita parte do titulo ("case starlink" vs
  "Case Starlink Mini Super"). Ja provado na FEAT-021 (`textoCitaProduto`).
- **Vitrine propria em vez de bloquear:** preserva o volume do grupo e a comissao (o link e seu).
- **Story bloqueado:** sem foto/preco do produto confirmado, o feed nao recebe (FEAT-021 mantida).

## Riscos

| Risco | Mitigacao |
| :--- | :--- |
| Muitas ofertas cairem na vitrine propria | log `link=vitrine-propria` (CA-5) mede a proporcao |
| Texto sem produto nenhum | cai em `cupom-sem-produto` (FEAT-021) antes de chegar aqui |
| Vitrine propria nao configurada | `vitrine-sem-ancora`: nao publica (nada de link fake) |
