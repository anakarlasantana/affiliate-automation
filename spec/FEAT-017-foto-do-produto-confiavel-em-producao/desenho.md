# Desenho — FEAT-017

## Fluxo (cascata de foto)

```
foto da mensagem (ja baixada)                    <- guardada como PLANO B
   │  FONTES_FOTO_SOMENTE_SITE? pretere (nao descarta)
   ▼
1. site do produto      og:image / galeria
   │  captcha (HTTP 200 sem og:image) -> "sem foto"
   ▼
2. API da loja          Shopee (ML exigiria token - DT-009)
   ▼
3. PLANO B: foto da mensagem  (volta, quando o site falhou)
   ▼
4. placeholder da aplicacao  assets/placeholder-confira-produto.png
   (nunca descarta a oferta)
   ▼
Instagram: so compoe story/post com foto real
```

Cada fonte devolve `{ base64, origem, motivo }` e o resultado final carrega
`tentativas[]` — é o log de uma linha por oferta (CA-8).

## Contrato

| Função | Forma |
| :--- | :--- |
| `resolverFotoDaOferta({ fotoMensagem, origemMensagem, urlProduto, loja, deps })` | `{ base64, origem, motivo, tentativas }` |
| `classificarPagina(html)` | `'produto' \| 'captcha' \| 'vazia'` |
| `placeholderDoProjeto({ raiz, caminhoConfigurado })` | base64 do placeholder da aplicação |
| `linhaDaFoto(resultado)` | string para o log |

## Decisões e por quês

- **Módulo separado (`src/midia/cascata-foto.js`)**: a cascata vive hoje dentro de
  `processarOferta` (1.900 linhas). Extrair permite testar os 8 CAs com `deps`
  injetáveis — padrão já usado no repo — sem arriscar o arquivo crítico.
- **Plano B = foto da mensagem**: em produção a foto 1218×1218 foi baixada e
  descartada porque o site do ML devolveu captcha. A preferência pelo site
  continua; o que muda é não jogar fora o que já se tem.
- **Captcha é "sem foto"**: hoje a página de bloqueio tem HTTP 200 e é tratada
  como página válida sem imagem, o que esconde a causa no log.
- **Placeholder relativo à raiz**: o `.env` da VPS apontava para
  `/home/sn-387116/…`, caminho que só existe no notebook.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Foto do grupo pode ser card de marca | plano B só entra **depois** do site falhar |
| Reenvio após restart perde a imagem | CA-2 usa o base64 persistido |
| ML sem token não entrega foto nem preço | DT-009 registra a limitação |
