---
id: FEAT-020
titulo: Fila de publicacao por antiguidade
persona: operadora
prioridade: ALTA
origem: "28/11 em producao: 2 posts compostos e NENHUM publicado no feed. O ciclo dava prioridade absoluta ao story, entao cada oferta nova furava a fila e o post antigo nunca chegava a vez."
estado: em-revisao
---

## História

Como operadora, quero que o ciclo do Instagram publique **o pendente mais antigo**, independente de ser
story ou post — para o feed não morrer de fome quando chegam ofertas novas o tempo todo.

## Regras de negócio

- **Nenhum formato morre de fome:** o critério principal é há quanto tempo o item espera.
- **Interleave continua valendo** como furar fila legítimo: com `STORIES_POR_POST` stories publicados
  contra 0 posts, o post entra primeiro (o feed é permanente; o story some em 24 h).
- **Teto por formato é soberano:** quem atingiu `MAX_STORIES_DIA`/`MAX_POSTS_DIA` sai da disputa,
  e o outro formato assume.
- **Reel é último recurso** (formato mais caro e de menor frequência).
- O motivo da escolha é registrado (`mais-antigo` · `interleave` · `unico`) para auditar o ciclo.

## Critérios de aceite

- **CA-1** — When o post pendente for mais antigo que o story, o sistema shall publicar o **post**.
  prova: `unit:test/escolha.test.js`
- **CA-2** — When o story pendente for mais antigo que o post, o sistema shall publicar o **story**.
  prova: `unit:test/escolha.test.js`
- **CA-3** — When `STORIES_POR_POST` estiver configurado e os stories publicados atingirem
  `(posts+1) × razão`, o sistema shall publicar o **post** mesmo que o story seja mais antigo
  (motivo `interleave`).
  prova: `unit:test/escolha.test.js`
- **CA-4** — If o post estiver no teto diário, o sistema shall escolher o **story** e vice-versa.
  prova: `unit:test/escolha.test.js`
- **CA-5** — When só houver reel pendente, o sistema shall publicá-lo; sem nenhum candidato, shall
  devolver `null` (ciclo não publica).
  prova: `unit:test/escolha.test.js`

## Não-objetivos

- Não muda o intervalo entre publicações (`INTERVALO_STORY_SEG`) nem o preflight.
- Não altera a composição do criativo (FEAT-013/014).
- Não implementa fila persistente própria: quem guarda o estado é o acervo.
