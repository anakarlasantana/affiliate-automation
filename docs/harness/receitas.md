# Receitas

Três tarefas que aparecem sempre, com o caminho exato neste repositório.

---

## 1. Adicionar uma loja nova

**Antes de escrever código:** se a loja só precisa de um parâmetro de tracking na
URL, não crie provider — use `AFFILIATE_GENERIC_N` no `.env`
(`dominio.com:parametro:sua_chave`). Código só quando o formato de link é
peculiar (página intermediária, id de produto próprio, API de assinatura).

1. Crie `src/affiliates/<loja>.js` estendendo `AffiliateProvider`
   (modelo: `src/affiliates/amazon.js` é o mais simples;
   `mercadolivre.js` é o que tem `mergulhador` e `idProduto`).
2. Preencha `dominios`, `nome`, `credenciaisRequeridas` e `perfil`
   (`urlNaoProduto`, `mergulhador`, `idProduto`, `paramsRemover`).
   Detalhes em [`contrato-provider.md`](contrato-provider.md).
3. Implemente `async converter(urlLimpa, urlOriginal)` — **dois argumentos**.
   Devolva `null` quando não houver como gerar o nosso link.
4. Registre a classe: importe e adicione ao array `PROVIDERS` em
   `src/affiliates/index.js` (a ordem importa — o primeiro `match()` vence).
5. Declare as variáveis novas em `.env.example` (e leia-as em `src/config.js`
   se a loja precisar de mais de uma).
6. Valide:

   ```bash
   npm run check          # sintaxe
   npm run status         # a loja aparece? faltantes corretos?
   npm run doctor         # painel de lojas e diagnóstico
   ```

7. Se o parsing for frágil (extração de id, regex de produto), extraia a função
   pura e teste em `test/` com `node --test`, usando fixture de
   `test/fixtures/` (procedência em `ORIGEM.md`).

Com o harness: `ai plan create <specId>` → `ai build code <taskId>` →
`ai verify ready`.

---

## 2. Depurar um link que não virou oferta

Percorra a cadeia **na ordem** e descubra em qual etapa parou.

| Sintoma | Etapa | Onde olhar |
| :--- | :--- | :--- |
| link não é nem encontrado na mensagem | `extrairLinks` | `src/linkResolver.js` |
| encurtador não expande | `expandirLink` | redirect HTTP, `<meta refresh>`, JS (`extrairRedirectJS`) |
| sobra tracking de terceiro | `sanitizarUrl` | `paramsRemover` da loja + params globais |
| oferta descartada como "não produto" | `ehPaginaNaoProduto` | `urlNaoProduto` da loja e `NAO_PRODUTO_GLOBAL` |
| link é de vitrine/perfil | `resolverMergulhador` | o `mergulhador` existe e casa? |
| `motivo: 'sem-provider'` | registry | domínio registrado? senão use `AFFILIATE_GENERIC_N` |
| `motivo: 'sem-credencial'` | registry | `npm run status` lista as variáveis faltantes |
| `motivo: 'sem-link'` | `converter()` | a loja devolveu `null` — credencial válida? formato novo? |
| `motivo: 'erro'` | `converter()` | a exceção aparece no log (`console.warn`) |

Comandos úteis:

```bash
npm run doctor                 # configuração efetiva + lojas
npm run status                 # fila + credenciais faltantes
DIAG_MIDIA=1 npm start         # conecta e ESCUTA, mas NÃO envia; imprime o payload cru de cada foto
npm run diag:midia             # varre histórico dos grupos e relata a cascata de imagem
```

Fixture de referência para redirect por `<meta refresh>` em cadeia:
`test/fixtures/promoby-redirect.html` (usada em `test/linkResolver.test.js`).

Com o harness: `ai build debug <taskId>` e, se virar correção recorrente,
`ai fix <rwId>`.

---

## 3. Operação e deploy

```bash
npm run doctor        # diagnóstico completo
npm run status        # fila persistente + credenciais faltantes
sudo journalctl -u affiliate-automation -f     # logs em produção (systemd)
```

- **systemd:** unit pronta em `deploy/affiliate-automation.service`
  (`Restart=always`, `RestartSec=30`, `KillMode=control-group` para o Chrome
  filho morrer junto). Depois de alterar:
  `sudo cp deploy/affiliate-automation.service /etc/systemd/system/ && sudo systemctl daemon-reload`.
- **Docker:** `docker compose up -d --build` e `docker logs -f affiliate-automation`
  (o QR aparece no log na primeira execução). `tokens/`, `data/` e `.env` são
  volumes — recriar o container não perde a sessão.
- **Sessão caiu:** `npm run reset-sessao` (remove `tokens/`) e refaça o
  pareamento pelo QR.
- **Boot frágil:** `WHATSAPP_WEB_VERSION=auto` fixa a versão embutida (evita o
  fallback live que quebra a injeção), `WPP_TENTATIVAS=3` com limpeza de Chrome
  órfão entre as tentativas e `WPP_DEVICE_SYNC_TIMEOUT=900` para backlog de dias.
- **Fuso:** `TZ_OPERACAO` é obrigatório em VPS UTC — sem ele, o anti-ban dispara
  na madrugada errada. Limite diário em `MAX_ENVIOS_DIA`.

**Nunca** valide mudança de envio com `npm start` apontando para o grupo real:
use `DIAG_MIDIA=1`, que enfileira mas não envia.

Com o harness: `ai ops dashboard` (painel de execuções) e `ai verify ready`.
