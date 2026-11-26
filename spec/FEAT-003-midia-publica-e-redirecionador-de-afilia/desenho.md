# Desenho — FEAT-003

## Fluxo

```
oferta aprovada (FEAT-001/002)
  ├─ preço: API da loja → texto ouvido → (nada = não vira story)   ← CA-3, CA-4
  ├─ composição 1080x1920 JPEG (enquadramento, faixa de preço, CTA) ← CA-1, CA-2
  ├─ hospedagem: /midia/<sha1>.jpg (URL pública que a Meta baixa)   ← CA-5
  └─ /go/<chave> → 302 link de afiliado + clique                    ← CA-6, CA-7, CA-8
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `extrairPreco(texto)` | `{ atual, antigo?, desconto? }` \| `null` — ignora `12x de R$` e frete |
| `escolherPreco(daApi, doTexto)` | API vence o texto (CA-4) |
| `enquadrar(largura, altura, alvo)` | `{ escala, x, y, w, h }` — *cover*, sem distorcer |
| `precisaJpeg(mime)` | `true` para `image/png` e `image/webp` |
| `nomeDaMidia(buffer)` | `<sha1>.jpg` — hash do conteúdo (idempotente) |
| `montarDestino(chave, destinos)` | URL de afiliado ou `null` (404) |
| `registrarClique(contador, chave)` | incrementa e devolve o total |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/midia/preco.js` | **novo** | parser de preço (puro, testável) |
| `src/midia/quadro.js` | **novo** | enquadramento 9:16 + decisão de JPEG (puro) |
| `src/midia/compor.js` | novo (tarefa) | usa `sharp` para gerar o JPEG final |
| `src/redirecionador.js` | **novo** | destino + contagem de cliques (puro) |
| `src/servidor.js` | novo (tarefa) | `GET /midia/:nome` e `GET /go/:chave` |
| `src/config.js` + `.env.example` | sim | `PUBLIC_BASE_URL`, `GO_BASE_URL`, `GO_DESTINO`, `MIDIA_DIR` |

## Fonte da imagem (ordem)

1. **`og:image` da página do produto** — medido e funcionando: ML 36 KB e Shopee 171 KB em JPEG.
2. **Vitrine do afiliado** (`/social/<slug>`, `magazinevoce.com.br/magazine<loja>`) quando o site da
   loja bloquear — é o caso do Magalu (**403** no domínio principal, `404` na URL convertida).
3. **Galeria da página**, quando existir, para carrossel.

Banner de **Brand Offer** fica de fora: é arte de campanha, não a foto do item.

## Fronteira

A **lógica pura** (preço, enquadramento, destino, clique) entra já, com teste: é o que o DoR exige
como `unit:`. A **parte com dependência externa** (`sharp`, servidor HTTP) fica como tarefa e não é
provada por unit.

## Riscos

1. `sharp` é dependência nativa nova — precisa justificar o trade-off no commit.
2. Sem domínio público, CA-5 não tem como ser validado em produção (o teste unitário cobre a
   nomeação/hash, não o DNS).
3. Preço da API da Shopee usa a assinatura que já existe; se a API cair, cai para o texto.
