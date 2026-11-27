# Desenho — FEAT-011

## Fluxo

```
src/app.js (processarOferta)
   ├─ precoDoTexto  = extrairPreco(texto)                     ← CA-3: ignora valor de cupom/desconto
   ├─ precoDaOrigem = precoPelaOrigem({ loja, chave, html })   ← CA-1
   └─ preco = escolherPreco(precoDaOrigem, precoDoTexto)       ← CA-2
        └─ registrarOferta({ preco, titulo: tituloPagina || primeiraLinha })   ← CA-4

src/midia/compor.js (textosDoStory)
   └─ CTAS[goDestino]  → 'oferta' = "LINK NA BIO" / "oferta do dia"            ← CA-5

src/servidor.js (GET /go)
   └─ destinoPadrao('oferta', { oferta: montarDestino(chavePublicadaRecente(acervo), destinos) })
        └─ sem oferta publicada → 404                                         ← CA-6
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `extrairPreco(texto)` | `{ atual, antigo, desconto } \| null` — descarta cupom/desconto |
| `precoPelaOrigem({ loja, chave, html })` | `{ atual, antigo, desconto } \| null` |
| `escolherPreco(daApi, doTexto)` | já existe: API vence, "de" maior preservado |
| `chavePublicadaRecente(acervo)` | `string \| null` (maior `publicadoEm`) |

## Decisões e por quês

- **Cupom não é preço:** oferta de grupo costuma ser `R$ 300 OFF acima de R$ 1.999`; publicar 300 anuncia
  um valor que não existe — destrói confiança e conversão.
- **Consultar a origem antes de desistir:** o texto é escrito por humano e nem sempre traz o valor; a
  página/API é a fonte da verdade. Se nem ela responder, não há story (regra de produto, mantida).
- **Usar `escolherPreco` em vez de criar regra nova:** a função já existe, é testada e resolve "API vence,
  'de' do texto preservado". Ligar é mais seguro do que reescrever.
- **`/go` responde 404 quando não há oferta publicada:** cair no grupo por engano era o pior cenário
  (clique que não leva ao produto). Melhor falhar explícito.
- **`obterChaveAtual` relê o acervo a cada request:** o servidor é outro processo; se lesse só no boot,
  um story publicado depois não apareceria até reiniciar.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| ML sem token (`api/items` → 403; página → captcha) | sem preço confiável → **sem story**; CA-1 não inventa valor |
| Shopee GraphQL indisponível | cai para o texto; se o texto for cupom, descarta (CA-3) |
| `GO_DESTINO=oferta` sem nenhum story publicado | `/go` responde 404 (CA-6) em vez de cair no grupo |
| Acervo já composto com preço antigo | recompor a partir de `fila_envio` (`imagem_base64` + `meu_link`) antes de publicar |
