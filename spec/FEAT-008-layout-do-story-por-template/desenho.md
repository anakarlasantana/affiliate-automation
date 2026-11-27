# Desenho — FEAT-008

## Fluxo

```
ensaiar/compor
  ├─ template: assets/template/story-base.png (1080×1920, normalizado do
  │            layout_instagram.jpeg 768×1376: escala 1,40625 + crop 7px)
  ├─ zonas:    assets/template/story.json  → foto, título, preço, preçoDe, cta   ← CA-1
  │            └─ ausente/inválido → LAYOUT_EMBUTIDO (mesmas proporções)        ← CA-2
  ├─ foto:     dimensões reais → contain na zona, escalaMax 1 (sem upscale)      ← CA-3
  ├─ título:   truncado em 2 linhas com reticências                              ← CA-5
  ├─ textos:   preço com contorno, CTA centralizado na pílula                    ← CA-6
  └─ saída:    JPEG q:v 2 · yuvj420p · lanczos
```

## Contratos

| Função | Forma |
| :--- | :--- |
| `validarLayout(obj)` | `{ ok, erros[] }` — exige largura/altura e as zonas foto/título/preço/cta |
| `carregarLayout(arquivo)` | layout mesclado \| `null` (arquivo ausente ou inválido) |
| `mesclarLayout(parcial)` | zona ausente herda o embutido — aceita JSON parcial |
| `normalizarTemplate({largura,altura})` | `{ precisa, escala, alturaEscalada, cropY, padY }` |
| `calcularFotoNaZona(dim, zona, escalaMax)` | `{ escala, w, h, x, y }` — contain centralizado |
| `truncarTitulo(texto, zona)` | `string[]` ≤ `zona.linhas`, com `…` no corte |
| `montarArgsComTemplate({…})` | `string[]` (argv do ffmpeg) |

## Arquivos

| Arquivo | Muda? | Papel |
| :--- | :--- | :--- |
| `assets/template/story-base.png` | **novo** | arte normalizada 1080×1920 (do `layout_instagram.jpeg`) |
| `assets/template/story.json` | **novo** | zonas medidas no template |
| `src/midia/layout.js` | **novo** | validação, normalização, enquadramento, truncamento e argv |
| `test/layout.test.js` | **novo** | os 7 critérios |
| `scripts/ensaiar-story.mjs` | tarefa | compor pelo template quando o JSON existir |
| `src/midia/compor.js` | tarefa | mantém o layout embutido como fallback |

## Fronteira

Toda a matemática (zonas, normalização, contain, truncamento) é **pura** e provada. O ffmpeg só é
executado na tarefa de composição. O template é **asset versionado**, não código.

## Riscos

1. **PNG base tem 1,9 MB** — aceitável para arte, mas é binário no git; se crescer, converter para
   WebP/JPEG de alta qualidade é decisão separada.
2. **Template 768 px** exige upscale 1,41× uma única vez; re-exportar em 1080×1920 elimina isso.
3. **Zona de texto depende do fundo escuro da arte**: se o template mudar para fundo claro, o
   contorno do preço (já configurado) é o que segura a legibilidade.
4. Espaço para o título é de 2 linhas; título maior vira reticências (nunca vaza da zona).
