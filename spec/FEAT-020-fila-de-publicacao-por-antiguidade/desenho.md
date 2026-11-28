# Desenho — FEAT-020

## O problema em uma tabela

O ciclo anterior escolhia assim:

```js
const escolhido = postDevido
  ? { formato: 'post', ... }
  : cabeStory
    ? { formato: 'story', ... }   // ← story SEMPRE furava a fila
    : ...
```

Com ofertas chegando a cada poucos minutos, `cabeStory` era quase sempre verdadeiro e o post nunca era
sorteado. Medição em 28/11 16:00 na VPS:

```
STORY  meli-MLB4286378716       publicada   ✅
STORY  meli-MLB5766094294       publicada   ✅
POST   meli-MLB5766094294:post  pendente    ⏳  (45 min esperando)
STORY  meli-MLB7589458214       pendente    ⏳
POST   meli-MLB7589458214:post  pendente    ⏳
```

## Fluxo novo

```
ciclo (a cada INTERVALO_STORY_SEG)
  │
  ├─ lê pendentes do acervo por formato (story, post, reel)
  ├─ remove quem está no teto do dia
  │
  ├─ interleave?  stories >= (posts + 1) × STORIES_POR_POST
  │     └─ SIM → publica o POST  (motivo=interleave)
  │
  ├─ senão: compara `criado` e publica o MAIS ANTIGO  (motivo=mais-antigo)
  │
  └─ se só houver reel pendente → publica (motivo=unico)
```

## Contrato

| Função | Forma |
| :--- | :--- |
| `escolherDoCiclo({ pendentes, doDia, cfg })` | `{ formato, alvo, motivo }` ou `null` |

- `pendentes`: `{ story, post, reel }` — cada um `{ chave, criado, ... }` ou `null`
- `doDia`: `{ story, post, reel }` — quantos já foram publicados hoje
- `cfg`: `{ maxStoriesDia, maxPostsDia, maxReelsDia, storiesPorPost }`

## Decisões e por quês

- **Antiguidade como critério principal:** é o único que garante que nenhum formato fique preso para
  sempre. A prioridade do story fazia sentido quando só havia story; com feed, ela vira inanição.
- **Interleave antes da antiguidade:** o post é *permanente* e o story dura 24 h. Se só a antiguidade
  valesse, um post velho venceria sempre — e o feed ficaria carregado de ofertas vencidas.
- **Teto por formato como filtro prévio:** não adianta o post ser o mais antigo se o teto de 6 já foi
  atingido; ele sai da disputa e o story assume.
- **Reel por último:** custa CPU (ffmpeg) e tem teto de 1/dia; nunca deve competir com imagem.
- **Função pura, sem I/O:** permite testar 5 regras sem tocar em acervo, rede ou Meta.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Post antigo com preço vencido ganhar a vez | o preço é o do momento da composição; recompor (`npm run recompor`) atualiza |
| Muitos posts antigos acumulados drenarem o dia | `MAX_POSTS_DIA` limita a 6 |
| Interleave configurado como 0 | a regra 2 é desligada; volta a valer só a antiguidade |
