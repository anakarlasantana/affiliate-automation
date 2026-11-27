# Desenho — FEAT-014

## Estrutura da legenda

```
{gancho}                          <- <=125 chars: produto + preco + gancho      (CA-1, CA-3)
{descricao}                       <- beneficio, derivado do titulo/mensagem    (CA-1)
💰 {preco}   de {antigo} (-{pct}%)                                             (CA-2)
🏷️ Cupom: {CODIGO}               <- so quando existe                          (CA-7)
🏬 {loja}
🔗 Link na bio -> {promessa coerente com GO_DESTINO}                           (CA-5)
⚠️ Preco e disponibilidade podem mudar.
{ate 10 hashtags}                                                              (CA-4)
```

## Contrato

| Função | Forma |
| :--- | :--- |
| `legendaDoFeed({ titulo, preco, loja, cupom, goDestino, texto, hashtagsExtras })` | `string` (≤2200, truncada por linha) |
| `gancho({ titulo, preco })` | `string` com ≤125 chars |
| `montarHashtags({ loja, extras })` | `string[]` único, máx 10, loja primeiro |
| `limparTextoDoGrupo(texto)` | remove links, cupons já citados e frases sem evidência |

## Decisões e por quês

- **Regra, não IA:** legenda precisa ser determinística, testável e sem custo por post.
- **Primeira linha com preço:** o feed corta em ~125 chars; sem o preço ali, o cliente não abre o "mais".
- **CTA amarrado ao `GO_DESTINO`:** prometer "abre a oferta" com a bio apontando para o grupo quebra a
  confiança e queima o clique.
- **Disclaimer de preço:** oferta de grupo muda de minuto em minuto; sem o aviso, a reclamação é sua.
- **Sem link cru na legenda:** no feed não é clicável e ainda suja o texto.

## Riscos

| Risco | Mitigação |
| :--- | :--- |
| Descrição sem categoria do produto (não temos nicho) | deriva do título por palavra-chave; `DESCRICAO_EXTRA` no `.env` complementa |
| Hashtag demais reduz alcance | teto 10, lista curada |
| Texto do grupo com caixa-alta e emoji demais | sanitização normaliza e mantém no máximo 2 emojis |
