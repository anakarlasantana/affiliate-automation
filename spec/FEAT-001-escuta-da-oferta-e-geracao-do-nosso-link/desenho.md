# Desenho — FEAT-001

## Pipeline exercitado (o mesmo de `src/app.js` → `processarOferta`)

```
mensagem ouvida
  └─ extrairLinks(texto)                            ← CA-1
      └─ expandirLink(url)                          ← CA-2
          └─ desembrulharVerificacaoMeli(url)
              └─ desembrulharAfiliadoRedirecionador(url)
                  └─ sanitizarUrl(url, paramsRemoverPara(url))   ← CA-3
                      └─ perfilDeUrl → loja sem credencial? descarta  ← CA-6
                          └─ resolverMergulhador → produto real     ← CA-4
                              └─ ehPaginaNaoProduto → descarta
                                  └─ chaveProduto (dedup)
                                      └─ converterParaAfiliado(url, expandida)  ← CA-5
                                          └─ compara loja + chave do link gerado ← CA-7
```

## Contratos usados

| Contrato | Assinatura / forma |
| :--- | :--- |
| `converterParaAfiliado` | `(urlLimpa, urlOriginal) => { meuLink, loja, motivo? }` · `meuLink: ''` = não publicar · motivos `sem-provider`, `sem-credencial`, `sem-link`, `erro` |
| `chaveProduto` | `(url) => 'meli:MLB…' \| 'amazon:ASIN…' \| 'shopee:<shop>.<item>' \| null` |
| `perfil` do provider | `urlNaoProduto`, `mergulhador`, `idProduto`, `paramsRemover` |
| credenciais | `AffiliateProvider.credenciaisFaltantes()` lê `process.env` **ao vivo** |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/linkResolver.js` | **não** | a lógica já existe; ganha cobertura |
| `src/affiliates/index.js` | **não** | idem |
| `src/app.js` | **não** | a ordem do pipeline é a referência, não o alvo |
| `test/linkResolver.test.js` | sim | +`extrairLinks`, +`sanitizarUrl` (CA-1, CA-3) |
| `test/affiliates.test.js` | **novo** | descarte sem credencial, sem provider, `chaveProduto`, comparação entrada×gerado (CA-6, CA-7) |
| `test/fixtures/links-ouvidos.json` | sim | fixture de CA-4/CA-5, consumida por `npm run verify:links` |

## Fronteira

**Nenhum arquivo em `src/**` é alterado.** A funcionalidade já existe e foi
verificada ao vivo (6/6 PASS em 26/11/2026, incluindo troca do `matt_tool` de
terceiro pelo nosso). Esta entrega é de **prova**, não de produto: se um critério
falhar, abre-se uma tarefa de produto separada (`ai fix`), não um remendo no teste.

## Riscos

1. **Teste dependente de `.env`** — o `.env` local tem credenciais reais. Os
   testes removem a credencial em `process.env` dentro de `try/finally`, porque
   `credenciaisFaltantes()` lê o ambiente ao vivo; assim o resultado é o mesmo com
   ou sem `.env`.
2. **`api:` sem runner** — o DoR só emite aviso (*"nivel api sem runner ainda"*).
   A prova efetiva de CA-4/CA-5 é `npm run verify:links` (`ai verify api`), que
   depende de rede.
3. **Rede de terceiros** — loja pode responder 5xx ou bloquear; por isso
   `verify:links` fica fora de `npm run verify` (o gate de commit continua
   hermético).
