---
id: FEAT-001
titulo: Escuta da oferta e geração do nosso link de afiliado
persona: operadora
prioridade: ALTA
origem: propósito central do app (README "O que o sistema faz com cada oferta")
estado: em-revisao
---

## História

Como operadora de um grupo de ofertas, quero que cada link ouvido nos grupos
monitorados seja convertido no **meu** link de afiliado do **mesmo** produto,
para que a venda seja atribuída a mim em vez de ao divulgador original.

## Regras de negócio

- O pipeline é genérico; o que muda por loja mora no Perfil da Loja
  (`src/affiliates/<loja>.js`, ver `docs/harness/contrato-provider.md`).
- Nunca publicar link sem o nosso rastreio: loja sem credencial no `.env`
  significa oferta **descartada**, não link repassado.
- Detecção de produto é por exclusão (`perfil.urlNaoProduto`) combinada com o
  `mergulhador`, que extrai o produto de páginas intermediárias.
- Dedup é por identidade de produto (`chaveProduto`), nunca por URL bruta.
- Formato de link de cada loja e o que sai/entra na limpeza está em
  `docs/links-afiliados-por-loja.md` — é a referência para os casos de teste.

## Critérios de aceite

- **CA-1** — When a mensagem ouvida traz texto com links, the sistema shall extrair todos os http(s) e descartar o restante do texto.
  prova: `unit:test/linkResolver.test.js`
- **CA-2** — When o link é de encurtador (meli.la, amzn.to, promoby.me), the sistema shall expandi-lo até a URL final, inclusive redirect por meta refresh/JS em cadeia.
  prova: `unit:test/linkResolver.test.js`
- **CA-3** — When a URL carrega tracking de terceiros (matt_, utm_, tag, smtt, af_siteid), the sistema shall removê-lo antes da conversão.
  prova: `unit:test/linkResolver.test.js`
- **CA-4** — If a URL é página intermediária (ex.: mercadolivre.com.br/social/perfil), the sistema shall mergulhar no HTML e extrair a URL do produto real.
  prova: `api:verify-links`
- **CA-5** — When o produto é identificado, the sistema shall gerar link com o NOSSO id de afiliado, da mesma loja, e o link shall abrir o produto (HTTP 200).
  prova: `api:verify-links`
- **CA-6** — If a loja está sem credencial no .env, the sistema shall descartar a oferta (meuLink vazio) em vez de publicar link sem afiliação.
  prova: `unit:test/affiliates.test.js`
- **CA-7** — When entrada e link gerado são comparados, the sistema shall casar loja e identidade de produto (meli:MLB, shopee:shop.item), bloqueando divergência.
  prova: `unit:test/affiliates.test.js`

## Não-objetivos

- **Escuta real** (conectar no WhatsApp/Telegram e ouvir de fato): exige sessão
  por QR e publica em grupo real. Validada manualmente com `DIAG_MIDIA=1` e
  `npm run diag:midia`; não vira `jornada:` porque este repositório não tem
  runner de e2e.
- Dedup entre dias (`jaFoiEnviada`) e fila anti-ban: cobertos na FEAT-002 e em
  `src/database.js`/`src/sendQueue.js`.
- Lojas sem credencial configurada (Amazon, Shein, TikTok Shop): a regra "sem
  credencial descarta" é testada (CA-6), mas não há caso de conversão real delas.
- Loja nova via `AFFILIATE_GENERIC_N`: coberto pelo contrato do provider, não
  por esta feature.
