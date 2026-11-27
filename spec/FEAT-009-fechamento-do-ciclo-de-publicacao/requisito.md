---
id: FEAT-009
titulo: Fechamento do ciclo de publicação
persona: operadora
prioridade: ALTA
origem: "auditoria das FEAT-007/008: pipeline não grava acervo, DIRETO_ATIVO ignorado, dedup e limite inertes, título sempre vazio"
estado: em-revisao
---

## História

Como operadora, quero que o **pipeline real** alimente o acervo e o redirecionador (hoje só o ensaio
faz), que o Direct respeite a flag, e que o Instagram não republique a mesma oferta nem estoure o
limite diário — para o sistema funcionar sozinho no servidor, não só no ensaio.

## Regras de negócio

- **Um único ponto de chamada** no `app.js` registra a oferta; falha ali **nunca** derruba o WhatsApp.
- Título vem do `og:title` da página já baixada (nenhum request extra).
- `DIRETO_ATIVO=0` desliga a resposta automática mesmo com webhook válido (flag > assinatura).
- Dedup e limite diário são medidos **pelo acervo** (`publicadoEm`), não pela quota da API — a quota
  ficou em 0 após publicar, então não serve como contador confiável.
- Dia operacional vem de `inicioDoDiaOperacional()` (`TZ_OPERACAO`), nunca do relógio do host.
- Oferta sem foto real (placeholder) **não entra no acervo** — story sem imagem do produto não
  publica; o destino do link curto, sim, é registrado.

## Critérios de aceite

- **CA-1** — When uma oferta é convertida, the sistema shall registrar o destino e a mídia composta no acervo em um único ponto de chamada.
  prova: `unit:test/oferta.test.js`
- **CA-2** — When a página do produto traz og:title, the sistema shall guardar o título no acervo e usá-lo no criativo.
  prova: `unit:test/oferta.test.js`
- **CA-3** — If DIRETO_ATIVO está desligado, the sistema shall não responder no Direct nem com webhook válido.
  prova: `unit:test/servidor.test.js`
- **CA-4** — If a chave já foi publicada no Instagram, the sistema shall recusar com motivo ja-publicado.
  prova: `unit:test/publicacao.test.js`
- **CA-5** — If as publicações do dia atingiram MAX_STORIES_DIA, the sistema shall recusar com motivo limite-diario.
  prova: `unit:test/publicacao.test.js`
- **CA-6** — When a publicação conclui, the sistema shall marcar a chave com publicadoEm e mediaId no acervo.
  prova: `unit:test/publicacao.test.js`

## Não-objetivos

- Compor o story para ofertas cujo WhatsApp usou placeholder (sem foto real do produto).
- Agendar publicação por horário: o `app.js` publica quando a oferta passa; limite e janela ficam no
  canal (FEAT-004).
- Contar clique por origem (bloco, story, direct) — hoje o contador é por chave.
- Regenerar automaticamente o `story-base.png` quando a arte mudar (segue manual, por script).
