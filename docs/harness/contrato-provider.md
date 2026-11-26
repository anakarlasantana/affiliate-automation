# Contrato do provider — o Perfil da Loja

O pipeline é genérico. O que muda de loja para loja está em
`src/affiliates/<loja>.js`, uma classe que **estende** `AffiliateProvider`
(`src/affiliates/base.js`). O registry (`src/affiliates/index.js`) é a única
porta de entrada.

## Campos estáticos

```js
export class MinhaLojaProvider extends AffiliateProvider {
  static dominios = ['minhaloja.com.br'];   // sem "www"; subdomínio é aceito
  static nome = 'Minha Loja';               // nome amigável (aparece nos logs)
  static credenciaisRequeridas = ['MINHALOJA_ID'];

  static perfil = {
    urlNaoProduto: [/\/vitrine\//i],  // URLs que NÃO são produto
    mergulhador: {                    // ou null
      nome: 'pagina-intermediaria',
      matches: (url) => /\/social\//.test(url),
      extrair: async (url) => '...',  // devolve a URL do produto real
    },
    idProduto: (url) => `minhaloja:${url.searchParams.get('id')}`,  // ou null
    paramsRemover: [/^utm_/i],        // tracking extra desta loja
  };

  async converter(urlLimpa, urlOriginal) {
    // devolve o NOSSO link, ou null quando a oferta deve ser descartada
  }
}
```

### `credenciaisRequeridas` e "loja ativa"

`credenciaisFaltantes()` filtra as chaves ausentes em `process.env` e
`estaConfigurado()` é `credenciaisFaltantes().length === 0`. Loja inativa **não
publica nada** — é o mecanismo que garante a regra "nunca link sem afiliação".

### `perfil` — as peculiaridades de link

| Campo | Papel | Efeito no pipeline |
| :--- | :--- | :--- |
| `urlNaoProduto` | `RegExp[]` de páginas que não são produto (vitrine, perfil, landing) | `ehPaginaNaoProduto()` descarta |
| `mergulhador` | `{ nome, matches(url), extrair(url) }` ou `null` | `resolverMergulhador()` baixa o HTML e acha o produto real |
| `idProduto` | `(URL) => string \| null` | `chaveProduto()` — base do dedup (`meli:MLB…`, `amazon:B0…`) |
| `paramsRemover` | `RegExp[]` de tracking extra | somado aos parâmetros globais em `sanitizarUrl()` |

A detecção de produto é **por exclusão**: o default é "é produto". Um formato
novo de link da loja continua sendo aceito em vez de descartado por engano;
só entra em `urlNaoProduto` o que comprovadamente não é produto.

## `converter(urlLimpa, urlOriginal)`

**Recebe dois argumentos.** Alguns `converter()` de loja precisam da URL
original expandida (com tokens de referência) para identificar o produto, mesmo
depois de a URL ter sido sanitizada. O JSDoc de `base.js` documenta apenas
`converter(_urlLimpa)` — está desatualizado em relação ao registry, que chama
`alvo.criar().converter(urlLimpa, urlOriginal)`. **Confie no registry.**

Retorno: `Promise<string|null>`. `null` (ou string vazia) = oferta descartada.

## Saída do registry: `converterParaAfiliado(urlLimpa, urlOriginal)`

```js
{ meuLink: string, loja: string, motivo?: string, faltantes?: string[] }
```

| `motivo` | Quando |
| :--- | :--- |
| *(ausente)* | sucesso — `meuLink` preenchido |
| `sem-provider` | nenhum provider dedicado nem genérico atende o hostname |
| `sem-credencial` | loja conhecida, mas falta variável em `.env` (`faltantes` diz quais) |
| `sem-link` | `converter()` devolveu vazio — a loja não gerou link |
| `erro` | `converter()` lançou exceção (logada com `console.warn`) |

`meuLink: ''` **nunca** deve chegar ao envio. Todo consumidor trata como
descarte silencioso.

## Providers registrados

`PROVIDERS` em `src/affiliates/index.js`: `Amazon`, `Shopee`, `Magalu`,
`MercadoLivre`, `Shein`, `TikTokShop` — esses são os valores de `static nome`,
que aparecem em logs, em `resumoLojas()` e no `loja` devolvido por
`converterParaAfiliado()`. Além deles, lojas **sem código novo** entram por `.env`:

```bash
AFFILIATE_GENERIC_1=aliexpress.com:aff_fcid:MEU_ID
```

Isso cria um `GenericProvider` (o primeiro `AFFILIATE_GENERIC_N` que casar com o
domínio vence). `AFFILIATE_GENERIC_2` e `_3` seguem o mesmo formato.
