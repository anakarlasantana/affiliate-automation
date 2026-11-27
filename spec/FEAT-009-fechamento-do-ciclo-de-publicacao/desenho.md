# Desenho — FEAT-009

## Fluxo

```
src/app.js (processarOferta)
   └─ registrarOferta({ chave, link, preco, titulo, imagemBase64, placeholder })   ← CA-1
        ├─ go-destinos.json : chave → link de afiliado      (SEMPRE, mesmo sem foto)
        ├─ sem foto / placeholder → { acervo:false, motivo:'sem-foto' }
        ├─ sem preço válido       → { acervo:false, motivo:'sem-preco' }
        └─ com foto real:
             ├─ composição (template se existir, senão embutido)
             └─ acervo.json : chave → { arquivo, link, preco, titulo }              ← CA-2

src/canais/publicacao.js (publicarDoAcervo)
   ├─ jaPublicado    = acervo[chave].publicadoEm                                   ← CA-4
   ├─ publicadosHoje = contarPublicacoesDoDia(acervo, inicioDoDiaOperacional())     ← CA-5
   ├─ guardas → quota → canal
   └─ sucesso → marcarPublicado(publicadoEm, mediaId)                               ← CA-6

src/servidor.js (webhook)
   └─ if (!diretoAtivo) → 200 sem enviar DM                                        ← CA-3
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `registrarOferta({…})` | `{ chave, destino, acervo, arquivo?, motivo }` |
| `chaveSegura(chave)` | `meli:MLB1` → `meli-MLB1` (segmento válido de URL) |
| `marcarPublicado(midiaDir, chave, {mediaId, quando})` | registro atualizado \| `null` se a chave não existe |
| `contarPublicacoesDoDia(midiaDir, desde)` | número — aceita ISO ou `'YYYY-MM-DD HH:MM:SS'` |
| `conferirPublicacao({…, jaPublicado, publicadosHoje, limiteDia})` | `{pronto, motivo}` com `ja-publicado` e `limite-diario` |

## Arquivos

| Arquivo | Muda? | Papel |
| :--- | :--- | :--- |
| `src/oferta.js` | **novo** | ponto único: destino + mídia + acervo |
| `src/midia/acervo.js` | sim | `marcarPublicado`, `contarPublicacoesDoDia`, preserva `publicadoEm` ao re-registrar |
| `src/linkResolver.js` | sim | devolve `titulo` (og:title) junto da imagem, do mesmo HTML |
| `src/canais/publicacao.js` | sim | dedup, limite e marcação após publicar |
| `src/servidor.js` | sim | `DIRETO_ATIVO` desliga a resposta |
| `src/app.js` | sim | **uma** chamada em `try/catch`, antes do `enqueue` |

## Fronteira

Guarda, contagem e registro são **puros** (fs local) e provados por unit com compositor injetado.
A chamada real ao ffmpeg e ao Instagram fica nas tarefas; a validação final é na VPS.

## Riscos

1. **Compor a cada oferta** custa ~1 s (ffmpeg). O timeout da composição no pipeline é **15 s** (era
   60 s) para um ffmpeg travado não segurar o handler que enfileira a oferta no WhatsApp.
2. **`app.js` não roda localmente sem WhatsApp**: o hook é validado por unit + `npm run check`; a
   prova real acontece no servidor com `DIAG_MIDIA=1`.
3. `og:title` pode faltar → criativo sem título (como antes) e `titulo: ''` no acervo.
4. Oferta que o WhatsApp recebeu com placeholder não gera story — decisão consciente: story com
   imagem genérica não converte.
