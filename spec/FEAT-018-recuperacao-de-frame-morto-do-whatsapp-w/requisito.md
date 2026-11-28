---
id: FEAT-018
titulo: Recuperacao de frame morto do WhatsApp Web
persona: operadora
prioridade: ALTA
origem: "28/11 na VPS: 14 erros 'Attempted to use detached Frame A9DF9E9E…' (sempre o mesmo frame) e 91 'Runtime.callFunctionOn timed out' em 60 min; 5 ofertas enviadas com placeholder e 0 com foto real"
estado: em-revisao
---

## História

Como operadora, quero que o app **perceba quando a página do WhatsApp Web morreu** e se recupere —
para o download das fotos voltar a funcionar sozinho, em vez de o app ficar "ativo" mandando
placeholder até alguém reiniciar.

## Regras de negócio

- **Frame morto não se resolve repetindo**: `detached Frame` significa que a página recarregou; insistir
  no mesmo frame gasta ~50 s por oferta e falha sempre.
- **"Sistema ativo" não prova saúde**: os eventos `onMessage` continuam chegando mesmo com a sessão CDP
  morta — é preciso uma chamada de leitura para saber.
- Timeout comum (`callFunctionOn timed out`) **não** é frame morto: aí a retentativa vale.
- A oferta **nunca** é descartada: sem foto em fonte nenhuma, aplica o placeholder da aplicação.

## Critérios de aceite

- **CA-1** — When o download falhar com `detached Frame`/`Target closed`/`Page crashed`, o sistema shall
  **abortar as tentativas** em vez de repetir no mesmo frame, e registrar o id do frame.
  prova: `unit:test/frame-vivo.test.js`
- **CA-2** — O sistema shall dispor de um health-check do cliente (chamada de leitura com prazo) e shall
  reportar `frame-morto` quando a sessão CDP morrer.
  prova: `unit:test/frame-vivo.test.js`
- **CA-3** — Timeout comum e `no media found` shall **não** ser classificados como frame morto (a
  retentativa/re-hidratação continua valendo).
  prova: `unit:test/frame-vivo.test.js`

## Não-objetivos

- Não recria a página automaticamente nesta entrega (o detector e o health-check vêm antes; a recriação
  será avaliada com dados de produção).
- Não muda a ordem da cascata de foto (FEAT-017).
- Não mexe em swap/recursos da VPS (item de infra, fora da spec).

