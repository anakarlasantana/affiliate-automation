# Tarefas -- FEAT-021

- **T-1** -- escopo: `src/midia/preco.js` -- fronteira: produto -- cobre: CA-5 -- wave: 1
- **T-2** -- escopo: `src/midia/cascata-foto.js` -- fronteira: produto -- cobre: CA-1, CA-2 -- wave: 1
- **T-3** -- escopo: `src/midia/bloqueio-oferta.js`, `src/app.js`, `src/oferta.js` -- fronteira: produto -- cobre: CA-3, CA-4, CA-6 -- wave: 2 (depende T-1)
- **T-4** -- escopo: `test/preco-origem.test.js`, `test/cascata-foto.test.js`, `test/bloqueio-oferta.test.js` -- fronteira: teste -- cobre: CA-1, CA-2, CA-3, CA-4, CA-5, CA-6 -- wave: 1
