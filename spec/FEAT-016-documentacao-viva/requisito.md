---
id: FEAT-016
titulo: Documentacao viva
persona: operadora
prioridade: MEDIA
origem: "README ficou uma aplicacao atras: zero mencoes a Instagram, estrutura de src/ antiga, 6 de 17 comandos citados e deploy sem ffmpeg/Caddy/rollback"
estado: em-revisao
---

## História

Como operadora, quero que a documentação **acompanhe o código** — canais ativos, comandos reais,
como parar/reiniciar e como atualizar a produção — para eu conseguir operar e dar manutenção sem
descobrir no escuro. E quero que isso seja **verificado por teste**, para não voltar a divergir.

## Regras de negócio

- Doc que não é verificada volta a mentir: o contrato mínimo vai para `test/docs.test.js`.
- Todo `npm run <script>` citado na documentação precisa existir no `package.json`.
- A estrutura de pastas documentada precisa refletir `src/` de verdade.
- "Parar e reiniciar" é operação essencial: app, servidor de mídia (filho) e Chrome do perfil.
- O runbook de deploy precisa cobrir as duas dependências novas (ffmpeg e HTTPS/Caddy) e o caminho
  de volta (rollback).

## Critérios de aceite

- **CA-1** — O README shall descrever os **dois canais** (WhatsApp e Instagram: story, feed e link
  na bio via `/go`).
  prova: `unit:test/docs.test.js`
- **CA-2** — Todo `npm run <script>` citado na documentação shall existir no `package.json`, e os
  comandos essenciais do Instagram (`publicar`, `publicar:feed`, `verify:ig`, `status`) shall estar
  documentados.
  prova: `unit:test/docs.test.js`
- **CA-3** — A estrutura de pastas documentada shall listar os diretórios reais de `src/` e as raízes
  `assets/template/`, `data/`, `deploy/` e `tokens/`.
  prova: `unit:test/docs.test.js`
- **CA-4** — O README shall ensinar a **ver e parar** a aplicação: `tokens/app.lock`,
  `kill $(head -1 tokens/app.lock)`, o `src/servidor.js` como processo filho e por que o `Ctrl+C`
  não funciona com o app desacoplado.
  prova: `unit:test/docs.test.js`
- **CA-5** — O runbook de deploy shall cobrir **ffmpeg**, **Caddy/HTTPS**, as **exclusões** do rsync
  (`data/`, `tokens/`, `.env`) e o **rollback**.
  prova: `unit:test/docs.test.js`

## Não-objetivos

- Não reescreve `docs/links-afiliados-por-loja.md` (segue válido, é por loja).
- Não documenta Reels como pronto: aponta o débito (DT-001).
- Não cria site/wiki: a doc vive no repositório, versionada com o código.

