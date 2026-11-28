---
id: FEAT-017
titulo: Foto do produto confiavel em producao
persona: operadora
prioridade: ALTA
origem: "28/11 em producao: foto da mensagem baixada (1218x1218) e enviada como placeholder; PLACEHOLDER_IMAGEM do .env apontava para o notebook; ML devolve captcha (HTTP 200 sem og:image) e FONTES_FOTO_SOMENTE_SITE descartava a foto sem plano B"
estado: em-revisao
---

## História

Como operadora, quero que **toda oferta de produto chegue ao WhatsApp e ao Instagram com foto real** —
e que, quando não houver foto em fonte nenhuma, use **o placeholder da aplicação** em vez de um genérico
de emergência. Hoje a foto é baixada e perdida no caminho; em produção **todas** as ofertas saíram com
placeholder.

## Regras de negócio

- **Foto real sempre vence o placeholder.** Placeholder é último recurso absoluto.
- `FONTES_FOTO_SOMENTE_SITE` **prefere** o site, mas **não descarta** a foto da mensagem: ela vira plano B.
- **Página de captcha/bloqueio** (HTTP 200 sem `og:image`) é tratada como *sem foto*, não como página válida.
- **Nenhuma oferta válida é descartada** por falta de imagem.
- **Cupom/listagem não vai a canal nenhum**; produto com cupom vai, citando o cupom.
- O `PLACEHOLDER_IMAGEM` funciona **relativo à raiz do projeto** — a mesma config vale em qualquer servidor.
- Toda degradação é **registrada** (fonte, dimensões, KB) — fim do placeholder silencioso.

## Critérios de aceite

- **CA-1** — When a foto da mensagem for baixada com dimensões válidas, o sistema shall preservá-la até o
  envio, sem trocá-la por placeholder no caminho.
  prova: `unit:test/cascata-foto.test.js`
- **CA-2** — When a oferta for reenviada (restart/retomada da fila), shall reusar a imagem persistida sem
  perdê-la.
  prova: `unit:test/cascata-foto.test.js`
- **CA-3** — If uma fonte de foto falhar, o sistema shall registrar o motivo e tentar a próxima fonte antes
  de qualquer placeholder.
  prova: `unit:test/cascata-foto.test.js`
- **CA-4** — When `FONTES_FOTO_SOMENTE_SITE` mandar buscar no site e o site não entregar foto, o sistema
  shall usar a foto da mensagem como plano B.
  prova: `unit:test/cascata-foto.test.js`
- **CA-5** — When o site devolver captcha/bloqueio (HTTP 200 sem `og:image`), o sistema shall classificar
  como *sem foto* e seguir a cascata.
  prova: `unit:test/cascata-foto.test.js`
- **CA-6** — When nenhuma fonte entregar foto, o sistema shall aplicar o placeholder da aplicação
  (`assets/placeholder-confira-produto.png`) e manter a oferta.
  prova: `unit:test/cascata-foto.test.js`
- **CA-7** — O caminho do placeholder shall funcionar relativo à raiz do projeto, sem depender de caminho
  absoluto do notebook.
  prova: `unit:test/cascata-foto.test.js`
- **CA-8** — O sistema shall registrar uma linha por oferta com a fonte da foto e as dimensões.
  prova: `unit:test/cascata-foto.test.js`
- **CA-9** — When a mensagem só trouxer cupom/listagem, o sistema shall não enfileirar nem registrar
  criativo em nenhum canal.
  prova: `unit:test/links-ouvidos.test.js`
- **CA-10** — When a oferta tiver cupom junto de um produto, o sistema shall enviar o produto e citar o
  cupom na legenda.
  prova: `unit:test/legenda.test.js`

## Não-objetivos

- Não integra a API oficial do Mercado Livre (exige token OAuth) — registrado como débito DT-009.
- Não busca imagem em buscadores (resultado impreciso).
- Não muda o layout do story nem do post.

