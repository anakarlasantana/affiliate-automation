---
id: FEAT-008
titulo: Layout do story por template
persona: operadora
prioridade: ALTA
origem: "arte da marca (assets/layout_instagram.jpeg) + story publicado lavado, medido YAVG 191"
estado: em-revisao
---

## História

Como operadora, quero que o story saia **dentro da arte da Garimpa Aí** — logo, moldura, faixa
escura do preço e pílula amarela do CTA — com a foto do produto e os textos nos lugares certos,
para o story parecer profissional em vez de “imagem esticada com texto solto”.

## Regras de negócio

- O **visual é do template**, não do código: `assets/template/story-base.png` (1080×1920) carrega a
  arte; `assets/template/story.json` diz onde cada zona fica. Trocar a arte não exige tocar em JS.
- **Degradação segura**: se o JSON faltar ou for inválido, a composição cai no layout embutido —
  publicar nunca pode falhar por causa de arquivo de design.
- **Foto não é ampliada além do original** (`escalaMax = 1`): a foto do Mercado Livre tem 500×500 e
  antes era esticada 3,84× até borrar.
- O fundo do template é escuro na faixa de texto justamente para o preço **não estourar** (o story
  anterior tinha YAVG 191 de fundo branco com texto branco).
- Título truncado em **2 linhas** com reticências; preço com **contorno** para ler sobre qualquer
  fundo; CTA **centralizado** na pílula.
- Preço continua **obrigatório** (regra herdada da FEAT-004).
- Template fora de 1080×1920 é **normalizado uma vez** (escala por largura + corte central).

## Critérios de aceite

- **CA-1** — When o story.json é válido, the sistema shall compor sobre o PNG base usando as zonas declaradas de foto, título, preço e CTA.
  prova: `unit:test/layout.test.js`
- **CA-2** — If o story.json está ausente ou inválido, the sistema shall cair no layout embutido sem quebrar a composição.
  prova: `unit:test/layout.test.js`
- **CA-3** — When a foto é menor que a zona, the sistema shall enquadrá-la em contain sem ampliar além do tamanho original.
  prova: `unit:test/layout.test.js`
- **CA-4** — When o template não é 1080x1920, the sistema shall normalizá-lo uma vez preservando o centro da arte.
  prova: `unit:test/layout.test.js`
- **CA-5** — When o título excede duas linhas, the sistema shall truncá-lo com reticências dentro da largura da zona.
  prova: `unit:test/layout.test.js`
- **CA-6** — When compõe com template, the sistema shall desenhar o preço com contorno e o CTA centralizado na zona do layout.
  prova: `unit:test/layout.test.js`
- **CA-7** — If o preço não foi resolvido, the sistema shall não compor o story e devolver erro explícito.
  prova: `unit:test/layout.test.js`

## Não-objetivos

- Redesenhar a arte no código (CSS/canvas): o visual vem do PNG.
- Animar o story (vídeo): story é imagem estática.
- Gerar variação de layout por loja nesta rodada (o JSON permite, mas não é entrega).
- Trocar a fonte da marca: usa a fonte padrão do sistema até haver `.ttf` licenciado no repositório.
