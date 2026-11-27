# AGENTS.md — affiliate-automation

Automação de afiliados multi-canal: escuta ofertas no Telegram e WhatsApp,
expande encurtadores, **troca pelos nossos links de afiliado** e republica em um
grupo do WhatsApp, com fila persistente anti-ban.

Este arquivo é o contexto do
[`ai-harness`](https://github.com/anakarlasantana/ai-harness) (o harness o anexa
ao System Prompt de todas as etapas) e também das ferramentas que leem
`AGENTS.md`. As regras duráveis vivem **aqui**, uma vez só.

## Definition of Done (executável)

```bash
npm ci
npm run check   # node --check em src/*.js e src/affiliates/*.js
npm test        # node --test → test/linkResolver.test.js, test/imagem.test.js
```

Não há lint nem build: o projeto é Node >=18, ESM puro, roda direto de `src/`.

## Regras invioláveis

1. **Nunca publique link sem o nosso rastreio.** `converterParaAfiliado()`
   devolve `{ meuLink: '', motivo }` quando a loja está sem credencial
   (`sem-credencial`), sem provider (`sem-provider`), sem link (`sem-link`) ou
   com erro (`erro`). `meuLink` vazio = descarte silencioso, **não** exceção.
2. **O genérico fica no pipeline; o peculiar fica no Perfil da Loja.**
   Comportamento por loja mora em `src/affiliates/<loja>.js` (estende
   `AffiliateProvider`), nunca em `src/app.js`.
3. **Detecção de produto é por exclusão.** `perfil.urlNaoProduto` diz o que *não*
   é produto; o `mergulhador` extrai o produto de páginas intermediárias.
   Formato novo de link deve entrar, não ser descartado por engano.
4. **Dedup por identidade de produto**, via `chaveProduto()` (`meli:MLB…`,
   `amazon:B0…`) — nunca por URL bruta, que muda a cada encurtador.
5. **Todo envio passa pela fila anti-ban** (`src/sendQueue.js` + `src/database.js`).
   Não chame o cliente wppconnect de outro módulo.
6. **Fuso de operação é `TZ_OPERACAO`** (`src/config.js`), nunca o relógio do
   host: em VPS UTC o anti-ban dispararia na madrugada errada.
7. **Nada de segredo em código.** Credenciais só em `.env` (ver `.env.example`).
   `data/`, `tokens/` e `.env` nunca entram no git.

## Onde olhar antes de mexer

| Preciso de | Vá para |
| :--- | :--- |
| fluxo completo e responsabilidade de cada arquivo | `docs/harness/arquitetura.md` |
| contrato do provider (campos, `perfil`, `converter`) | `docs/harness/contrato-provider.md` |
| receitas: nova loja, depurar link, deploy | `docs/harness/receitas.md` |
| peculiaridades de link por loja | `docs/links-afiliados-por-loja.md` |
| requisitos e critérios de aceite | `spec/<ID>-<slug>/requisito.md` (gate: `ai spec review` / `ai spec approve`) |
| **o que foi adiado de propósito e por quê** | `docs/debitos-tecnicos.md` |
| variáveis de ambiente | `.env.example` + `src/config.js` |
| operação (systemd, Docker, QR, doctor) | `README.md` |

## Convenções

- **pt-BR** em identificadores, comentários, logs e documentação (padrão do repo:
  `credenciaisRequeridas`, `mergulhador`, `urlNaoProduto`).
- JSDoc explica **por que** a decisão existe, não o que a linha faz.
- ESM com `import`/`export`; sem `require`, sem transpilação, sem `any`.
- Não adicione dependência sem justificar o trade-off no corpo do commit.
- Diff mínimo: um assunto por commit, sem reformatação geral do arquivo.

## Verificação antes de dizer "pronto"

```bash
npm run verify         # check + test (é o que `ai verify ready` executa)
npm run verify:links   # abre os links reais na loja: produto + nosso rastreio
npm run verify:ig      # READ-ONLY: token, conta profissional e quota do Instagram
npm run verify:api     # os dois acima (é o que `ai verify api` executa)
npm run servidor       # sobe /go/<chave>, /midia/<arquivo> e o webhook do Direct
npm run ensaiar -- <url> --preco 199   # compõe o story e grava no acervo (NÃO publica)
npm run publicar -- <chave>            # publica 1 story do acervo (exige PUBLICAR_STORIES=1)
npm run publicar:feed -- <chave> --foto <arquivo>   # publica 1 post no feed (4:5; --seco só compõe)
npm run recompor                       # regera o acervo com as regras atuais (--seco, --quarentena)
npm run deploy:vps -- --host <ip>      # deploy SIMULADO na VPS (--apply executa; --rollback volta)
```


`npm run verify:links` depende de rede (é o `ai verify api` do harness): usa
`test/fixtures/links-ouvidos.json` e reporta PASS/FAIL/SKIP por link **e a
imagem que seria publicada** (`site:og-image`, galeria, `loja:api-imagem` ou
`PLACEHOLDER`). Placeholder não converte em venda — `--falhar-placeholder`
reprova quando acontecer. Se tocou em link/encurtador, adicione um caso em
`test/linkResolver.test.js` com fixture de `test/fixtures/` (procedência em
`test/fixtures/ORIGEM.md`) **e** inclua o link novo no fixture de verificação.

