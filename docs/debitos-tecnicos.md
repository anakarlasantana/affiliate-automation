# Débitos técnicos

Registro do que foi **adiado de propósito** e do que foi **descoberto no uso** e
ainda não foi resolvido. Cada item diz o que já existe, o que falta e **qual
decisão destrava**.

> Regra: débito é registrado no mesmo commit que o adia. Item resolvido sai daqui.

---

## DT-001 · Reels: a publicação está pronta, falta **gerar o vídeo**

**Status:** adiado por decisão de produto (27/11/2026) — precisa amadurecer o
formato antes de ligar.

### O que já está pronto e testado

| Peça | Onde | Prova |
| :--- | :--- | :--- |
| Container `REELS` com `share_to_feed=true` | `src/canais/instagram.js` | `test/instagram.test.js` |
| Espera do `status_code=FINISHED` antes de publicar | `publicarFeed` + `aguardarContainer` | teste verifica a **ordem** das chamadas |
| Publicação com teto próprio | `publicarReelDoAcervo` (`MAX_REELS_DIA`) | `test/auto-publicacao.test.js` |
| Preflight de `video/mp4` | `preflight({ esperado })` | idem |
| Escolha do formato no ciclo | `src/publicacao/automatica.js` | teste "reel publicado quando story/post não cabem" |

Ou seja: **se existir um MP4 na chave `<produto>:reel`, ele é publicado hoje.**
Nada no caminho de publicação falta.

### O que falta

1. **Ninguém gera o MP4.** `gerarVideo()` existe em `src/midia/video.js` (ffmpeg
   H.264 9:16, ≤30 s) e é **código morto** — nenhum módulo o chama.
2. **A foto original não é guardada.** `registrarOferta` compõe o story e o post
   e apaga a foto temporária. Sem ela não há de onde gerar o vídeo depois.
3. **Nada registra `<produto>:reel`** no acervo (`formato: 'reel'`).

### Por que foi adiado

- **Decisão de produto pendente:** formato (zoom na foto? slideshow? texto
  animado?), duração, capa e roteiro. Um reel genérico de foto parada converte
  menos que um story — não vale publicar só porque é tecnicamente possível.
- **Custo:** 5–15 s de CPU por vídeo 1080×1920. Em 56 ofertas/dia são ~10 min/dia
  de ffmpeg e ~1–3 MB por reel em disco.

### Opções (escolher uma quando houver decisão)

| Opção | Como fica | Custo |
| :--- | :--- | :--- |
| **A · na captura** | `registrarOferta` gera `<chave>:reel` junto com story e post | +5–15 s por oferta; disco cresce |
| **B · sob demanda** | `npm run preparar:reel -- <chave> --foto …` gera e registra; o ciclo publica | controle total, operação manual |
| **C · só ofertas fortes** *(recomendada)* | gera apenas quando desconto ≥ X% ou preço ≥ Y | menos volume, mais relevância |

### O que destrava

1. Definir o **roteiro/duração** do reel (produto).
2. Escolher A, B ou C.
3. Guardar a foto original (hoje é descartada) — pré-requisito de qualquer opção.
4. Implementar `gerarVideo` → `registrarNoAcervo(…, { formato: 'reel' })`.
5. Validar com `npm run verificar` + uma publicação real com `--seco` antes.

---

## DT-002 · Emoji no **story** ainda vira quadradinho (tofu)

**Status:** aberto — descoberto ao compor o primeiro post real.

`semEmoji()` foi aplicado no criativo do **feed** (`src/midia/feed.js`), mas o
**story** continua desenhando o título cru (`src/midia/layout.js` via `oferta.js`).
Um título como `OPORTUNIDADE RARA! 🎟️` sai com `▯` no JPEG.

**Correção:** aplicar `semEmoji()` no `textos.titulo` antes de compor o story
(~3 linhas em `src/oferta.js`) + teste de regressão.
**Impacto:** cosmético, mas aparece em boa parte das ofertas (títulos com emoji
são a regra nos grupos).

---

## DT-003 · URL pública efêmera (túnel ngrok)

**Status:** aberto — bloqueia a operação 24/7 de verdade.

`PUBLIC_BASE_URL`/`GO_BASE_URL` apontam para um túnel ngrok gratuito
(`…ngrok-free.dev`). Quando o túnel muda:

- a **Meta não consegue baixar a mídia** (volta 9004 — foi o erro de 27/11);
- **todo `/go` morre**, inclusive o link da bio.

**Correção:** domínio próprio + Caddy na VPS (item do deploy), com `systemd`
para o app (o servidor de mídia já sobe junto — FEAT-012 CA-7).

---

## DT-004 · `app.js` não tem teste de integração

**Status:** aberto — o bug mais caro da sessão passou por aqui.

Um bloco de preço foi inserido **antes** da declaração de `mensagemFinal`
(`const`, TDZ) e **toda oferta** quebrava com `Cannot access 'mensagemFinal'
before initialization`. Passou por `node --check` e por 181 testes; só o log em
produção pegou.

Hoje existe uma prova de **ordem** no texto do pipeline (`test/preco-origem.test.js`),
que é um paliativo. O correto é extrair o corpo de `processarOferta` para um
módulo importável e testá-lo com um cliente falso.

---

## DT-005 · 22 stories em quarentena que nunca serão publicados

**Status:** aberto — decisão pendente.

`data/midia/acervo-legado.json` guarda 22 stories compostos com as regras antigas
(preço de cupom, CTA "ENTRE NO GRUPO"). Eles saíram do acervo ativo para não
serem publicados errados, mas **as fotos originais não existem mais** — não são
recomponíveis.

**Decisão:** apagar os arquivos (liberar disco) ou manter como histórico.
