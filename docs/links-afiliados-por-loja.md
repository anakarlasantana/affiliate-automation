# Pesquisa: links de afiliado por loja

> Retrato da pesquisa feita em **23/09/2026** para validar a limpeza de links
> (`sanitizarUrl` + perfis em `src/affiliates/`) loja por loja. Não é
> especificação oficial permanente: formatos de link mudam — revalide com os
> comandos da seção final quando for mexer em alguma loja.

## Método e status de validação

| Loja | Como foi validado |
|---|---|
| Shopee | **Teste ao vivo com a API** (`generateShortLink` → expansão do shortlink → comparação da chave de produto). Fonte: doc Shopee Open Platform + observação direta. |
| Mercado Livre | Pesquisa web: Portal do Afiliado ML (página oficial do gerador de links) + comportamento observado nos logs do app. |
| Magalu | Pesquisa web: Bot do Afiliado (docs/integracoes/magalu) e Acelera Afiliado (formato promoter_id/partner_id). |
| Shein | Pesquisa web: Afilira (guia de onelink da Shein). |
| TikTok Shop | Pesquisa web: artigo oficial "Sharable affiliate links for creators" (TikTok Seller University). |
| Amazon | **Fontes primárias bloqueadas (HTTP 403)** — conjunto de parâmetros baseado no formato consolidado do Amazon Associates. Tratar como "conhecimento consolidado", não como leitura de doc oficial. |
| Promobit (fonte) | **Pesquisa ao vivo em 23/09/2026**: fetch das páginas reais (`promoby.me/<código>`, `promobit.com.br/Redirect/to/<id>/`, HTML de oferta e FAQ) + execução do `expandirLink` do próprio projeto contra links reais. |

## Tabela por loja

Legenda: ✅ validado · ⚠️ lacuna conhecida (adiada — loja não configurada) · ❓ não confirmado

### Shopee ✅

- **Formatos de produto:** `-i.<shop>.<item>`, `/product/<shop>/<item>`, wrapper `opaanlp/<shop>/<item>` (compartilhamento do app) e shortlinks `s.shopee.com.br`.
- **Intermediários:** `shope.ee`, `s.shopee.com.br`; wrapper `opaanlp` é canonicalizado pelo mergulhador do perfil **sem rede** (IDs estão no path).
- **Sai na limpeza (terceiros):** `smtt, smid, share_channel, is_from_login, uls_trackid, sp_atk, af_siteid` (perfil) + `mmp_*, gads_*, __mobile__, exp_group, credential_token` (genérico — caso real: `mmp_pid=an_18150800009` de outro afiliado sujando a URL enviada à API).
- **Entra depois (nossa afiliação):** mutation `generateShortLink(originUrl, subIds)`; `subIds` é **omitido** quando `SHOPEE_SUB_ID` está vazio (string vazia está fora do contrato da API).
- **Validação pós-conversão:** o `idProduto` reconhece `opaanlp`, então a expansão do shortlink gerado volta como `opaanlp/...` e a chave `shopee:<shop>.<item>` é comparada com a original antes de publicar.

### Mercado Livre ✅

- **Formatos de produto:** `/p/MLB...` (catálogo) e `MLB-<id>_JM` / `produto.mercadolivre.com.br/MLB-<id>_-_JM` (anúncio).
- **Intermediários:** `meli.la` (app) → página `/social/<slug>`; mergulhador extrai o `MLB` do HTML. Observação: `mlr.li` e `melila.me` também existem — não estão em `dominios`, mas `expandirLink` resolve antes (funciona por acidente, não por design).
- **Sai na limpeza:** `matt_*` (tracking de qualquer divulgador — o nosso é aplicado depois), `ref, quantity, wid, pdp_filters` (perfil) + genéricos.
- **Entra depois:** `matt_tool=<MELI_AFFILIATE_ID>&matt_word=affiliate` na URL canônica.
- **Preservado de propósito:** `searchVariation` (variação do produto).

### Amazon ⚠️ lacuna adiada

- **Formatos de produto:** `/dp/<ASIN>`, `/gp/product/<ASIN>`, `/d/<ASIN>` (10 caracteres).
- **Intermediários:** `amzn.to` (expandido pelo pipeline).
- **Sai na limpeza hoje:** `tag, ref_, assoc_id, ascsubtag, linkcode, camp, creative, creativeasin` (genérico) + `pf_rd_*, pd_rd_*, qid, sr, th, _encoding, content-id` (perfil).
- **⚠️ Faltando (adiado — `AMAZON_TAG` vazia no `.env`):** `linkId` (ads nativos — o regex atual só casa `linkcode`), `mkevt, mkcid, mkrid, bbn` (hash de campanha), `sprefix, keywords, crid, dcb, vpcd, dib, dib_tag` (ruído de busca). Nenhum identifica produto — removê-los é seguro.
- **Entra depois:** `tag=<AMAZON_TAG>`.

### Magalu ⚠️ lacuna adiada

- **Formatos de produto:** `magazineluiza.com.br/p/<id>` e `/oferta/...`; forma oficial de afiliado: `magazinevoce.com.br/magazine<loja>/<path>`; rastreamento em `magazineluiza.com.br` via **`promoter_id`** (+ `partner_id`).
- **Intermediários:** `divulgador.magalu.com` e `onelink` (resolvidos hoje por expansão/redirect; `especiais.magazineluiza.com.br` casa por sufixo).
- **Sai na limpeza hoje:** `itag, pid, offer_id, partner_id` (perfil) + genéricos.
- **⚠️ Lacuna (adiada — `MAGALU_STORE_ID` sem uso real por enquanto):** **`promoter_id` não é removido** — link de produto com o `promoter_id` de OUTRO afiliado sobrevive à limpeza; o converter só troca host/caminho e o parâmetro de terceiro vai junto na URL final. Risco de atribuição errada.
- **Entra depois:** reescrita de host para `magazinevoce.com.br/magazine<SUA_LOJA>/<path>` (descarta prefixo `magazineXXX` de terceiro).

### Shein ⚠️ lacuna adiada

- **Formatos de produto:** `-p-<id>.html`, `/product/<id>`, `/goods/<id>`.
- **Intermediários:** os links que circulam em grupos são **`onelink`** (`onelink.shein.com`, casa por sufixo com `shein.com`) — **não revelam o produto sem serem lidos**. Hoje: redirect HTTP/JS cobre parte dos casos; se o produto só estiver no HTML, a oferta é **perdida** (nunca publicada com link errado — seguro, mas com perda).
- **Sai na limpeza:** `url_from, second_share, share_from, goods_id, mallcode` (perfil) + genéricos.
- **Entra depois:** `aff_id=<SHEIN_AFFILIATE_ID>` (confere com o padrão do mercado).
- **⚠️ Pendência futura:** mergulhador dedicado para onelink (baixar a página e extrair `-p-<id>.html`).

### TikTok Shop ❓ não confirmado — revisar antes de ativar

- **Formatos de produto:** `/product/<id>` ou `product_id` na query; só produto é oferta (vídeo/perfil descartados).
- **Gerador oficial:** "Share > Copy Link" no painel; link vale **100 dias**; atribuição pelo último clique (doc TikTok Seller University).
- **⚠️ Não confirmado:** o código seta **`affiliate_id`** na query, mas a doc oficial **não usa esse parâmetro** — o `converter()` atual pode não estar rastreando nada.
- **Estado atual:** `TIKTOKSHOP_AFFILIATE_ID` vazio no `.env` → loja INATIVA, ofertas descartadas antes da conversão (nenhum dano acontecendo).
- **Pendência futura:** revisar o mecanismo real de rastreio do TikTok Shop **antes** de preencher a credencial.

### Genéricas (`.env`)

- Formato `AFFILIATE_GENERIC_N=dominio.com:parametro:sua_chave`; sem perfil (sem `idProduto`/`paramsRemover` próprios) — dependem só da limpeza genérica.

### Promobit (fonte de oferta — não é loja) ✅

> Diferente dos outros grupos, as mensagens do **grupo Promobit VIP**
> (`whatsapp:120363419781062962@g.us`) e do canal `@promobit_oficial` têm DUAS
> peculiaridades: o link encadeia dois intermediários e a foto da mensagem é o
> **card da Promobit**, não o produto.

- **Formatos de link de saída** (validados ao vivo em 23/09/2026):
  - `https://promoby.me/<código>` → **301** → `https://api.promobit.com.br/v4/redirect/<código>` → página HTML (200) com redirect **JavaScript** (`var _ = 3, s = Math.random(), l = 'https://<destino>'`) + fallback no âncora `clique aqui` + pixel de tracking `supix.promobit.com.br/out?...`;
  - `https://www.promobit.com.br/Redirect/to/<idOferta>/` → mesma página de redirect JS (responde **200**, não 3xx).
- **Destino real**: o encurtador da LOJA (`meli.la/...`, `s.shopee...`, `amazon.com.br/dp/...?tag=promobit-d-20`...). Por isso a expansão precisa de **vários saltos**: Promobit → loja → página do produto.
- **Tratamento no código**: `expandirLink` itera até `MAX_SALTOS_EXPANSAO` (4) saltos com guarda de loop; `extrairRedirectJS` casa o padrão `l = '...'` (fixture real em `test/fixtures/promoby-redirect.html`) com fallback no âncora "clique aqui". Depois disso o fluxo é o MESMO dos outros grupos (mergulhador → `chaveProduto` → sanitização genérica).
- **Imagem**: a foto que vem na mensagem é o card da marca — a variável `FONTES_FOTO_SOMENTE_SITE` (`.env`) faz a cascata pular o nível 1 e ir direto na `og:image` do site do produto (nível 2), com placeholder como último recurso.

## Lacunas adiadas para o futuro (TODOs)

Condição de ativação: **preencher a credencial da loja no `.env`** → aplicar o ajuste correspondente antes de ligar a loja.

| # | Loja | Arquivo | O que muda |
|---|---|---|---|
| 1 | Magalu | `src/affiliates/magalu.js` | adicionar `/^promoter_id$/i` ao `paramsRemover` |
| 2 | Amazon | `src/affiliates/amazon.js` | adicionar `linkId, mkevt, mkcid, mkrid, bbn, sprefix, keywords, crid, dcb, vpcd, dib, dib_tag` ao `paramsRemover` |
| 3 | Shein | `src/affiliates/shein.js` | mergulhador dedicado para `onelink.shein.com` (ler página → extrair `-p-<id>.html`) |
| 4 | TikTok Shop | `src/affiliates/tiktokshop.js` | revisar `affiliate_id` (não confirmado na doc oficial) |
| 5 | *(opcional)* ML | `src/affiliates/mercadolivre.js` | incluir `mlr.li` e `melila.me` em `dominios` (hoje resolvidos por expansão) |

## Como revalidar

```bash
npm run check          # sintaxe de src/*.js e src/affiliates/*.js
npm test               # testes (imagem/mídia)

# Dry-run por loja (sem envio): uma URL real por loja passando por
# sanitizarUrl → mergulhador → chaveProduto — o padrão usado na validação
# de 23/09/2026 (ver histórico do repositório).
```

Critério de aceite por loja: (a) URL limpa sem parâmetros de terceiro; (b) `chaveProduto` devolve a identidade do item; (c) após converter, expandir o link gerado e confirmar que a chave é a mesma — se divergir, a oferta não pode ser publicada (o `app.js` já descarta nesse caso).

