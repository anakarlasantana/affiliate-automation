# Arquitetura — affiliate-automation

Mapa do fluxo real, com os nomes de função que existem no código. Serve para
responder "onde olhar" antes de editar. Para o contrato de loja, ver
[`contrato-provider.md`](contrato-provider.md).

## Fluxo de uma oferta

```
mensagem (WhatsApp/Telegram)
  └─ extrairLinks(texto)                         linkResolver.js
      └─ expandirLink(urlEncurtada)              resolve encurtador/meta refresh/JS
          └─ desembrulharAfiliadoRedirecionador  remove rede de afiliado de terceiro
              └─ sanitizarUrl(urlFinal, params)  remove tracking alheio
                  └─ ehPaginaNaoProduto(url)     registry: é vitrine/perfil/convite?
                  └─ resolverMergulhador(url)    registry: página intermediária?
                  └─ chaveProduto(url)           registry: identidade p/ dedup
                      └─ jaFoiEnviada(chave)     database: já publicamos este item?
                      └─ converterParaAfiliado(urlLimpa, urlOriginal)
                              └─ <Loja>Provider.converter()  nosso link
                      └─ imagem (cascata)            imagem.js + lojaApi.js
                      └─ SendQueue.enqueue(item)     fila anti-ban persistente
                          └─ envio ao grupo           wppconnect
                              └─ registrarEnvio(chave) database
```

`processarOferta()` em `src/app.js` é quem amarra esse encadeamento. Nenhum
outro módulo deve chamar o cliente do WhatsApp.

## Arquivo → responsabilidade → o que ele NÃO faz

| Arquivo | Responsabilidade | Não faz |
| :--- | :--- | :--- |
| `src/app.js` | orquestrador: listeners (wppconnect + Telegram), `processarOferta()`, boot resiliente (detecção de Chrome, versão do WhatsApp Web, limpeza de `SingletonLock`), `--doctor`, `--diag-midia` | não decide formato de link de loja; não implementa conversão |
| `src/config.js` | todas as variáveis de ambiente, caminhos absolutos derivados do arquivo, fuso de operação (`horaOperacional`, `inicioDoDiaOperacional`), janelas/delays anti-ban, validação de obrigatórias | não contém regra de negócio de loja |
| `src/linkResolver.js` | expandir encurtadores (`expandirLink`), redirect por JS (`extrairRedirectJS`), desembrulhar afiliados de terceiros, sanitizar (`sanitizarUrl`), extrair imagem (`extrairImagemProduto`, `extrairImagemDaLoja`, `extrairImagemDeUrl`, `extrairGaleria`) | não gera link de afiliado; não envia nada |
| `src/affiliates/index.js` | registry: `perfilDeUrl`, `ehPaginaNaoProduto`, `resolverMergulhador`, `paramsRemoverPara`, `chaveProduto`, `resumoLojas`, `converterParaAfiliado` | não implementa loja nenhuma |
| `src/affiliates/base.js` | contrato `AffiliateProvider` (campos estáticos + `perfil` + `converter`) | não é instanciado diretamente |
| `src/affiliates/<loja>.js` | o **Perfil da Loja**: domínios, credenciais exigidas, peculiaridades de URL e a conversão para o nosso link | não conhece fila, banco nem envio |
| `src/imagem.js` | cascata de imagem (mensagem → `downloadMedia` → og:image → API da loja → placeholder), validação de dimensão (`MIN_LADO_FOTO = 300`) e legenda (`LIMITE_LEGENDA_FOTO = 1000`) | não baixa link nem converte afiliado |
| `src/lojaApi.js` | imagens por API oficial da loja (`imagemPelaApiDaLoja`, `imagemShopee`, `lojasComApiDeImagem`) | não é usado para gerar link |
| `src/database.js` | SQLite (`data/ofertas.db`, WAL): dedup (`ofertas_enviadas`) + fila (`fila_envio`) | não aplica política anti-ban |
| `src/sendQueue.js` | `SendQueue`: fila em memória persistida em `data/fila-status.json`, `restaurarPendentes`, delays por faixa horária | não decide o que é oferta válida |
| `src/status.js` | `npm run status`: fila + credenciais faltantes | não envia |

## Fronteiras que o código respeita

- **Captura ≠ domínio.** `app.js` sabe *quando* enviar; `affiliates/` sabe *como*
  virar link nosso.
- **Persistência ≠ política.** `database.js` grava; `sendQueue.js` decide o ritmo
  (janelas quentes, silêncio, delays).
- **Rede ≠ parsing.** Toda saída HTTP passa por `linkResolver.js`, que é o único
  lugar que segue redirects e lê `<meta refresh>`/JS.
- **Ambiente ≠ código.** Nenhuma credencial ou fuso hardcoded: tudo em
  `src/config.js` a partir do `.env`.

## Canais e mídia (FEAT-003 a FEAT-006)

Módulos de lógica **pura** criados com as specs de Instagram (sem rede, sem token):

| Arquivo | Responsabilidade |
| :--- | :--- |
| `src/midia/preco.js` | extrai preço/desconto do texto ouvido e escolhe entre API e texto |
| `src/midia/quadro.js` | enquadramento 9:16 (cover), decisão PNG/WebP→JPEG, nome com hash |
| `src/redirecionador.js` | `/go/<chave>` → destino https + contagem de clique |
| `src/canais/base.js` | contrato `CanalPublisher` + `decidirPublicacao()` (kill switch, preço, quota, dedup, limite) |
| `src/canais/direct.js` | assinatura do webhook, leitura do evento, janela de 24 h, texto da DM |
| `src/canais/reels.js` | formato (carrossel/zoom), argv do ffmpeg 9:16 e payloads REELS/CAROUSEL |

**Implementado** (sem credencial, coberto por `node --test`):

| Arquivo | Faz |
| :--- | :--- |
| `src/midia/compor.js` | story 1080×1920 JPEG com faixa de preço e CTA (ffmpeg) |
| `src/midia/video.js` | Reel H.264 9:16 a partir das fotos (ffmpeg) |
| `src/servidor.js` | `GET /go/<chave>`, `GET /midia/<arquivo>`, `POST /webhooks/instagram` |
| `src/canais/instagram.js` | Graph API: container → `media_publish`, quota |
| `src/canais/index.js` | registry de canais (`InstagramStory`) |
| `scripts/verificar-ig.mjs` | checagem read-only de token/quota (`npm run verify:ig`) |
| `src/midia/acervo.js` | índice `chave → arquivo/link/preço` (`data/midia/acervo.json`) |
| `src/canais/publicacao.js` | guardas de publicação + legenda + quota → `npm run publicar` |
| `src/midia/layout.js` | composição sobre o template da marca (zonas, normalização, contain) |
| `assets/template/` | `story-base.png` (1080×1920) + `story.json` com as zonas medidas |
| `src/oferta.js` | ponto único do pipeline: grava destino sempre e mídia composta só com foto real (FEAT-009) |
| `src/instancia.js` | trava do perfil do Chrome (uma instância), janela do QR sem TTY e decisão de encerrar no `browserClose` (FEAT-010) |

**Ainda depende de credencial/infra** (não testável offline): publicar de verdade no Instagram
(`IG_USER_ID` + `IG_ACCESS_TOKEN` e domínio público), validar a galeria do Mercado Livre (OAuth) e
colocar HTTPS na frente do `npm run servidor` (Caddy/nginx).


## Verificação

`npm run check` (sintaxe de todos os arquivos) + `npm test` (`node --test`).
Testes cobrem `linkResolver` e `imagem`, que são justamente os módulos com
parsing frágil. `src/affiliates/*` não tem teste unitário hoje — mudança de
provider deve ser validada com uma url real e o `npm run doctor`.


## Débitos e pendências

O que foi **adiado de propósito** e o que foi **descoberto no uso** e ainda não
foi resolvido fica em [`docs/debitos-tecnicos.md`](../debitos-tecnicos.md), com
status, o que já existe, o que falta e qual decisão destrava.

Em aberto hoje:

- **DT-001 · Reels** — publicação pronta (container, `FINISHED`, teto, preflight de
  `video/mp4`), mas **nada gera o MP4**: `gerarVideo()` é código morto e a foto
  original não é guardada. Adiado para definir formato/duração/roteiro.
- **DT-002** — emoji no **story** ainda sai como `▯` (o `semEmoji` só vale no feed).
- **DT-003** — URL pública efêmera (túnel ngrok): quando muda, a mídia e a bio caem.
- **DT-004** — `app.js` sem teste de integração (o bug de TDZ passou por 181 testes).
- **DT-005** — 22 stories em quarentena sem foto original (decisão: apagar ou manter).
