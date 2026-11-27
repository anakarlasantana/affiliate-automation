---
id: FEAT-012
titulo: Publicacao automatica de stories
persona: operadora
prioridade: ALTA
origem: "publicar falhou com 9004/2207052 porque o servidor de mídia estava parado (túnel 502 text/html) e a Meta não conseguiu baixar a imagem; pedido: o Instagram operar sozinho quando o app sobe e o WhatsApp sincroniza, com log monitorável"
estado: em-revisao
---

## História

Como operadora, quero que o Instagram **comece a operar junto com o WhatsApp**: ao subir e conectar,
o app publica os stories prontos, um por vez, respeitando quota e intervalo — e registra tudo em
`logs/app.log`, no mesmo padrão do WhatsApp, para eu acompanhar sem rodar comando nenhum.

## Regras de negócio

- **Nada é publicado sem mídia acessível**: preflight antes de cada chamada (o erro de 9004 custou uma
  chamada e não publicou).
- Falha de mídia **não** marca como publicado; o story continua pendente para o próximo ciclo.
- `PUBLICAR_STORIES=0` é kill switch absoluto e precisa dizer o motivo no log.
- A publicação roda **fora** do caminho crítico do WhatsApp: nunca bloqueia escuta nem envio.
- Um único processo basta: o app sobe o servidor de mídia se a porta estiver livre (Opção A).
- O log do Instagram segue o padrão `[ig]` no mesmo arquivo espelhado do app.

## Critérios de aceite

- **CA-1** — When o app inicia e o WhatsApp conecta, o sistema shall publicar os stories prontos do
  acervo (mais antigos primeiro), sem comando manual.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-2** — When houver story pendente e decisão de publicar, o sistema shall respeitar
  `MAX_STORIES_DIA`, a quota da Meta e `INTERVALO_STORY_SEG` (padrão 600s, mínimo 120s).
  prova: `unit:test/auto-publicacao.test.js`
- **CA-3** — If `PUBLICAR_STORIES=0`, o sistema shall não publicar nada e registrar o motivo uma vez.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-4** — Before chamar a Meta, o sistema shall verificar `/health` e a mídia (200 + `image/jpeg`);
  if falhar, shall adiar com motivo `midia-inacessivel` sem consumir chamada.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-5** — If a Meta recusar com code 9004 / subcode 2207052, o sistema shall manter o story pendente,
  registrar o motivo e pausar o ciclo daquela execução.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-6** — When o story é publicado, o sistema shall gravar `publicadoEm` e `mediaId` no acervo, e
  uma nova oferta com story shall entrar no ciclo automaticamente.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-7** — When a porta do servidor estiver livre, o app shall subir o servidor de mídia interno;
  if já estiver ocupada, shall usar o existente sem duplicar (e sem atropelar a trava da FEAT-010).
  prova: `unit:test/servidor.test.js`
- **CA-8** — When o ciclo rodar, o sistema shall emitir o log no mesmo arquivo do WhatsApp
  (`logs/app.log`) com prefixo `[ig]`, cobrindo acervo, preflight, container, sucesso, recusa e resumo.
  prova: `unit:test/auto-publicacao.test.js`
- **CA-9** — When `npm run status` for executado, o sistema shall exibir a seção Instagram: publicados
  hoje, pendentes, quota, último `mediaId` e último bloqueio.
  prova: `unit:test/status.test.js`
- **CA-10** — When `npm run publicar` for executado, o comando shall emitir o mesmo formato `[ig]` e
  também gravar em `logs/app.log`.
  prova: `unit:test/auto-publicacao.test.js`

## Não-objetivos

- Não muda o layout do criativo (FEAT-008) nem o conteúdo do story (FEAT-011).
- Não publica Reels nem carrossel (FEAT-006 fica fora).
- Não faz retry infinito: pausa o ciclo e tenta de novo no próximo boot/período.
- Não substitui o supervisor (`systemd`): só publica enquanto o processo estiver vivo.

