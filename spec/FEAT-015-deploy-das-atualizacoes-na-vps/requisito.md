---
id: FEAT-015
titulo: Deploy das atualizacoes na VPS
persona: operadora
prioridade: ALTA
origem: "producao parada desde 24/09 com o codigo de 23/09; a receita de rsync do README nao exclui data/ (sobrescreveria o banco de producao) e o passo de .env apaga credenciais"
estado: em-revisao
---

## História

Como operadora, quero **atualizar a VPS** com tudo que foi construído (Instagram: story,
feed, redirecionador, mídia) sem perder a sessão do WhatsApp nem o histórico de envios —
e com caminho de volta se algo der errado.

## Regras de negócio

- **`data/`, `tokens/`, `.env` e `logs/` são do servidor.** O `data/ofertas.db` tem o dedup
  dos envios: sobrescrever faz o app reenviar tudo ao grupo.
- O `.env` é **merge**: o deploy **aponta** as chaves que faltam, nunca copia o exemplo por cima.
- Backup datado do banco + cópia do código em `.prev` **antes** de qualquer escrita.
- A Meta exige **HTTPS**: a mídia sai por Caddy em 80/443; a porta 3000 fica em loopback.
- Deployment é **systemd** (a documentação diz para preferir isso ao Docker).

## Critérios de aceite

- **CA-1** — O rsync do deploy shall excluir `data`, `tokens`, `.env`, `logs` e `node_modules`,
  para que a atualização não sobrescreva banco, sessão e credenciais.
  prova: `unit:test/deploy.test.js`
- **CA-2** — O deploy shall comparar o `.env` do servidor com o `.env.example` e **listar as
  chaves faltantes**, sem jamais copiar o exemplo por cima.
  prova: `unit:test/deploy.test.js`
- **CA-3** — O deploy shall gerar backup datado de `data/ofertas.db` e cópia do código em
  `/opt/affiliate-automation.prev` antes de escrever.
  prova: `unit:test/deploy.test.js`
- **CA-4** — O deploy shall validar `ffmpeg`, `caddy` e `better-sqlite3` no servidor e reprovar
  sem eles.
  prova: `unit:test/deploy.test.js`
- **CA-5** — O deploy shall validar os quatro assets do template e reprovar se faltar algum.
  prova: `unit:test/deploy.test.js`
- **CA-6** — O deploy shall rodar `npm ci` e `npm run verify` no servidor antes de religar o serviço.
  prova: `unit:test/deploy.test.js`
- **CA-7** — O serviço shall rodar sob o unit existente (`Restart=always`,
  `KillMode=control-group`) e o servidor de mídia shall escutar só em loopback.
  prova: `unit:test/deploy.test.js`
- **CA-8** — `PUBLIC_BASE_URL`/`GO_BASE_URL` shall usar host estável com HTTPS (`sslip.io`
  derivado do IP ou DuckDNS), nunca túnel efêmero.
  prova: `unit:test/deploy.test.js`
- **CA-9** — O `Caddyfile` shall encaminhar `/go`, `/midia`, `/health` e `/webhooks` para
  `127.0.0.1:3000`, expondo apenas 80/443.
  prova: `unit:test/deploy.test.js`
- **CA-10** — O deploy shall oferecer `--rollback` que restaura código e, opcionalmente, o banco.
  prova: `unit:test/deploy.test.js`

## Não-objetivos

- Não configura DNS nem abre portas no console do provedor (ações manuais documentadas).
- Não migra `data/` do notebook (é banco de teste).
- Não instala Caddy/ffmpeg do zero com receita própria: usa `apt` e a documentação do README.

