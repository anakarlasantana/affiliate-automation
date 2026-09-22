# Fixtures reais (nao sinteticas)

Extraidas da tabela `fila_envio` (data/ofertas.db) e do backup
`data/diagnostico/removidas-231-236-238-241.json` em 22/09/2026.

| arquivo | origem | dimensoes | papel no teste |
| --- | --- | --- | --- |
| miniatura-whatsapp-*.jpg | fila_envio ids 231/236/238/241 (`msg.body`) | 72x72 | NEGATIVO: precisa ser rejeitada |
| foto-og-image-322x500.jpg | fila_envio id 239 (`site:og-image`) | 322x500 | POSITIVO: 15 KB e foto de verdade |
| foto-og-image-500x459.webp | fila_envio id 242 (`site:og-image`) | 500x459 | POSITIVO: cobertura de WebP |
| placeholder-800x800.png | fila_envio id 215 (`placeholder`) | 800x800 | POSITIVO: PNG gerado por placeholderPara() |

Os 15 KB do og-image 322x500 sao a prova de que TAMANHO EM BYTES nao
separa miniatura de foto (as miniaturas de 72x72 tem ate 2,5 KB): a
separacao tem de ser por DIMENSAO.
