# Desenho — FEAT-012

## Fluxo

```
src/app.js (depois de "🎯 Sistema ativo" e restaurarPendentes)
   └─ iniciarPublicacaoAutomatica({ config, canal, acervo, avisar })        ← CA-1
        ├─ PUBLICAR_STORIES=0 → log 🛑 e retorna                            ← CA-3
        ├─ CA-7: porta livre? sobe servidor interno : usa o existente
        └─ loop (timer próprio, FORA do caminho do WhatsApp)
             ├─ próximo = story pendente mais antigo do acervo              ← CA-1
             ├─ guardas: MAX_STORIES_DIA · quota Meta · INTERVALO_STORY_SEG  ← CA-2
             ├─ preflight: /health 200 + mídia 200 image/jpeg                ← CA-4
             │     └─ falhou → 'midia-inacessivel', adia SEM chamar a Meta
             ├─ 9004 / 2207052 → mantém pendente e pausa o ciclo             ← CA-5
             └─ sucesso → publicadoEm + mediaId, log [ig]                    ← CA-6 · CA-8
```

## Contrato de log (`[ig]`)

| Momento | Linha |
| :--- | :--- |
| início | `📸 [ig] Acervo: 25 prontos · 3 publicados hoje` |
| preflight | `🔎 [ig] Preflight ok · health 200 · mídia 200 image/jpeg 300KB` |
| container | `🆔 [ig] Container 1789… criado · meli-MLB4169407211 · R$ 239` |
| sucesso | `✅ [ig] Publicado · mediaId 1813… · hoje 4/12 · quota 3/100` |
| espera | `⏳ [ig] Próximo em ~8min · 24 pendentes` |
| recusa | `⛔ [ig] Recusado: midia-inacessivel (9004/2207052) · story segue pendente` |
| kill switch | `🛑 [ig] Ciclo parado: PUBLICAR_STORIES=0` |
| resumo | `📊 [ig] Ciclo: 1 publicado · 0 falhas · 24 pendentes` |

## Contratos

| Função | Forma |
| :--- | :--- |
| `iniciarPublicacaoAutomatica({ config, canal, acervo, avisar, deps })` | `{ parar(), ciclo() }` |
| `proximoPendente(acervo)` | `{ chave, arquivo, link, preco } \| null` (mais antigo) |
| `podePublicar({ acervo, config, quota, agora })` | `{ ok, motivo }` |
| `preflight({ baseUrl, arquivo, http })` | `{ ok, motivo, bytes, tipo }` |

## Decisões e por quês

- **Preflight antes da Meta:** foi exatamente o que faltou hoje. A chamada de 27/11 gastou quota-uso,
  voltou 9004 e não publicou; com preflight o app apenas adia e diz `midia-inacessivel`.
- **Pausar no 9004 em vez de insistir:** se a Meta não consegue baixar a mídia, todos os próximos
  falhariam igual — insistir só queima chamadas e polui o log.
- **Opção A (servidor interno):** "subir e operar" só é verdade se o servidor de mídia subir junto. Se a
  porta estiver ocupada (servidor externo/pm2), o app **usa o existente** em vez de duplicar — mesmo
  princípio da trava única da FEAT-010.
- **`avisar(msg)` injetado:** os módulos de canal continuam puros (sem `console`), como `servidor.js` já
  faz com `avisar`/`aoMarcar`. O app injeta `console.log` (que o espelho grava em `logs/app.log`) e o CLI
  injeta um logger que escreve na tela **e** no arquivo — é o que garante o CA-10.
- **Loop com timer próprio:** publicar não pode competir com a escuta/envio do WhatsApp; erro de
  publicação nunca derruba o pipeline.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Publicar a cada 10 min parecer robótico | `INTERVALO_STORY_SEG` configurável + `MAX_STORIES_DIA=12` |
| Servidor interno ocupar a porta 3000 | detecta porta ocupada e usa o servidor existente (CA-7) |
| ngrok free com interstitial | preflight detecta `content-type: text/html` e adia com motivo claro |
| 25 stories compostos com regras antigas | recompor (FEAT-011) antes de ligar o ciclo |
