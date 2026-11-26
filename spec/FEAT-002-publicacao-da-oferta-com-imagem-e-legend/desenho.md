# Desenho — FEAT-002

## Cascata de imagem (motivo em `src/app.js`, funções em `src/imagem.js`)

```
0. FONTES_FOTO_SOMENTE_SITE casa a origem?  → ignora a foto da mensagem
1. foto da mensagem (msg.body / downloadMedia)  → classificarMidia
      └─ miniatura (< 300px no lado maior) → descarta         ← CA-1, CA-2
2. og:image / galeria do site (extrairImagemProduto/Galeria)  → CA-2
3. API oficial da loja (imagemPelaApiDaLoja)                  → CA-2
4. placeholder da loja (placeholderPara)                      ← CA-3
      └─ legendaParaFoto(mensagemFinal, meuLink)              ← CA-4
```

Regra central: **dimensão, não bytes**. O `jpegThumbnail` do WhatsApp tem 72x72 e
~1,5–2,5 KB; um `og:image` legítimo pode ter 15 KB. Um piso em bytes não separa
os dois — `MIN_LADO_FOTO = 300` separa.

## Contratos usados

| Contrato | Forma |
| :--- | :--- |
| `classificarMidia(entrada)` | `{ miniatura: boolean, … }` — decide se a mídia serve |
| `dimensoesImagem(entrada)` | `{ largura, altura }` a partir do cabeçalho do arquivo |
| `validarImagemBase64(dataUrl)` | `{ valido, motivo? }` — barra data-URL corrompida |
| `placeholderPara(loja)` | `{ base64, origem }` — arte em `assets/` ou `PLACEHOLDER_IMAGEM` |
| `legendaParaFoto(mensagemFinal, meuLink)` | `string` ≤ `LIMITE_LEGENDA_FOTO` (1000); **não anexa** o link — trunca preservando o link que já está no texto |
| `baixarMidiaComRetry(cliente, id, rotulo, opts)` | `{ base64, tentativas }` — 4 tentativas com espera |

## Arquivos

| Arquivo | Muda? | Por quê |
| :--- | :--- | :--- |
| `src/imagem.js` | **não** | lógica já existe; ganha cobertura |
| `src/app.js` | **não** | a cascata é a referência |
| `test/imagem.test.js` | sim | +`placeholderPara` (CA-3), +`legendaParaFoto` (CA-4); CA-1/CA-2 já cobertos por `dimensoesImagem`/`classificarMidia` |
| `test/fixtures/*.jpg/.webp/.png` | não | fixtures reais já existem (ver `ORIGEM.md`) |

## Fronteira

Nenhum arquivo em `src/**` é alterado — mesma lógica da FEAT-001: a entrega é de
prova. O comportamento de envio (fila anti-ban) **não** é tocado.

## Riscos

1. **Fixture binária** — as imagens são reais (ver `ORIGEM.md`); não inventamos
   buffers, porque o bug original era justamente "bytes não distinguem miniatura".
2. **`legendaParaFoto` com link longo** — se o link + texto passar de 1000, a
   função trunca; o teste cobre o limite para não descobrir isso em produção.
3. **Placeholder ausente** — se `assets/placeholder-confira-produto.png` sumir, o
   app não tem rede de segurança; o teste garante que `placeholderPara` devolve
   base64 válido para as lojas conhecidas.
