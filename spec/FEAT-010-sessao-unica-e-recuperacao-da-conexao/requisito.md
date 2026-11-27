---
id: FEAT-010
titulo: Sessao unica e recuperacao da conexao
persona: operadora
prioridade: ALTA
origem: "análise do console de 27/11: duas instâncias no mesmo perfil do Chrome derrubaram a sessão (6 QRs), o app seguiu vivo sem navegador e a janela do QR sem TTY era de 60s"
estado: em-revisao
---

## História

Como operadora, quero que o app garanta **uma instância por perfil do Chrome**, que a janela do QR
funcione no servidor e que, se o navegador cair depois de conectado, o processo **encerre** — para a
sessão parar de cair e o supervisor religar sozinho.

## Regras de negócio

- **O perfil do Chrome é exclusivo.** Dois processos no mesmo `userDataDir` fazem o WhatsApp Web ver
  dois navegadores no mesmo aparelho e deslogar a sessão.
- A guarda vale para o **caminho principal** (`main()`), não só para `--diag-midia` — era o buraco:
  a função de detecção existia, mas só o diagnóstico a usava.
- Trava **nunca** pode bloquear o próximo boot: se o dono morreu, é reaproveitada.
- Depois de conectado, ficar sem navegador é estado terminal → sair ≠ 0 e deixar o supervisor religar.
- Antes de conectar, a queda é do ciclo normal de tentativas (não encerra).

## Critérios de aceite

- **CA-1** — When já houver instância viva com o mesmo perfil, o sistema shall recusar iniciar,
  informar o pid e sair ≠ 0, sem abrir segundo Chrome.
  prova: `unit:test/instancia.test.js`
- **CA-2** — If o navegador fechar depois de uma conexão bem-sucedida, o sistema shall encerrar em
  até 30s com código ≠ 0.
  prova: `unit:test/instancia.test.js`
- **CA-3** — When não houver TTY e `WPP_QR_HEADLESS_SEG` não estiver definido, o sistema shall usar
  janela de 300s, e a variável shall constar do `.env.example`.
  prova: `unit:test/instancia.test.js`
- **CA-4** — When o processo receber SIGINT/SIGTERM, ou quando a trava encontrada for de um dono
  morto, o sistema shall liberar/reaproveitar a trava, nunca bloquear o próximo start.
  prova: `unit:test/instancia.test.js`

## Não-objetivos

- Não muda o fluxo de ofertas, o anti-ban nem a fila.
- Não religa a sessão nem publica nada: apenas impede a queda por concorrência.
- Não substitui `systemd`/`pm2`: quem religa continua sendo o supervisor.

