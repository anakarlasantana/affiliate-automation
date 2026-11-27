# Desenho — FEAT-010

## Fluxo

```
src/app.js (main)
   └─ adquirirTrava({ diretorio: TOKENS_DIR })                     ← CA-1
        ├─ tokens/app.lock criado com `wx` (atômico)
        ├─ dono vivo     → { ok:false, motivo:'trava-ocupada' } → exit 1
        ├─ dono morto    → reaproveita o arquivo                   ← CA-4
        └─ varredura ps  → app antigo sem trava → libera e falha   ← CA-1

src/app.js (statusFind · wppconnect)
   └─ deveEncerrarPorStatus({ status, jaConectou })                ← CA-2
        └─ browserClose + sessão ativa → exit 1 em 2s

src/app.js (conectarWhatsAppComRetry e --diag-midia)
   └─ janelaQrMs({ ehTTY, timeoutQrMs, headlessSeg })              ← CA-3

handlers SIGINT/SIGTERM/uncaughtException
   └─ liberarTrava({ diretorio: TOKENS_DIR })                      ← CA-4
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `janelaQrMs({ ehTTY, timeoutQrMs, headlessSeg })` | ms; inválido → 300s; mínimo 30s |
| `adquirirTrava({ diretorio, pid, estaVivo, processos })` | `{ ok:true, arquivo, liberar }` ou `{ ok:false, motivo, pidDono, pids? }` |
| `liberarTrava({ diretorio, pid })` | `boolean` — só remove do próprio dono |
| `processosDoApp({ executar })` | `number[]` sem o próprio pid |
| `deveEncerrarPorStatus({ status, jaConectou })` | `{ encerrar:true, motivo }` ou `null` |

## Decisões e por quês

- **Arquivo com `wx` antes da varredura:** `ps` sozinho tem corrida — dois `npm start` simultâneos não
  se enxergam antes de qualquer um abrir o navegador. O `wx` é atômico no filesystem.
- **`ps` como segunda camada:** pega processo antigo que subiu sem a trava (versão anterior, pm2).
- **Default de 300s (era 60s):** sem TTY ninguém escaneia na hora; o QR é lido de `tokens/qr-ascii.txt`.
- **`process.exit(1)` no `browserClose`:** sob systemd, seguir sem navegador deixa o serviço `active` e
  o `Restart=` nunca acontece — foi o que aconteceu em 27/11 (pid vivo, sem Chrome).

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Trava órfã bloquear o boot | dono morto → reaproveitada (CA-4); a mensagem indica `rm -f tokens/app.lock` |
| `ps` indisponível no container | retorna `[]` (não derruba o boot); a trava de arquivo continua valendo |
| Encerrar em vez de reconectar | só depois de conectado; antes disso o retry de 3 tentativas continua |
