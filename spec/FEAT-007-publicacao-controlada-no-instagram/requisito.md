---
id: FEAT-007
titulo: Publicação controlada no Instagram
persona: operadora
prioridade: ALTA
origem: "lacunas encontradas ao subir o servidor local: mídia sem índice, quota nunca consultada"
estado: em-revisao
---

## História

Como operadora, quero **publicar um story sob demanda** (`npm run publicar -- <chave>`) com guardas
claras — flag, credencial, URL pública e preço — para testar o canal no Instagram sem envolver o
WhatsApp e sem publicar por acidente.

## Regras de negócio

- Publicar é ato **explícito**: o CLI só age com `PUBLICAR_STORIES=1`; o padrão é desligado.
- A Meta **baixa** a mídia por URL pública: sem `PUBLIC_BASE_URL` não há publicação.
- **Sem preço não publica** (decisão de produto herdada da FEAT-004).
- O webhook da Meta só é aceito se o `hub.verify_token` conferir (`IG_VERIFY_TOKEN`).
- O acervo (`data/midia/acervo.json`) liga **chave → arquivo + link + preço**; sem ele o CLI não
  sabe o que publicar (o JPEG tem nome por hash, exigência do FEAT-003).
- Quota consultada **antes** de publicar (`content_publishing_limit`); falha na consulta aborta.
- Motivos distintos: `desligado` (flag) ≠ `sem-credencial` (token) — não confundir no log.

## Critérios de aceite

- **CA-1** — If o hub.verify_token recebido difere do configurado, the sistema shall responder 403 sem devolver o challenge.
  prova: `unit:test/servidor.test.js`
- **CA-2** — When o hub.verify_token confere, the sistema shall responder 200 com o challenge em texto puro.
  prova: `unit:test/servidor.test.js`
- **CA-3** — When o ensaio compõe um story, the sistema shall registrar no acervo a chave com arquivo, link e preço, persistindo em disco.
  prova: `unit:test/publicacao.test.js`
- **CA-4** — If PUBLICAR_STORIES está desligado, the sistema shall recusar a publicação com motivo desligado.
  prova: `unit:test/publicacao.test.js`
- **CA-5** — If falta credencial do Instagram, the sistema shall recusar com motivo sem-credencial, distinto do kill switch.
  prova: `unit:test/publicacao.test.js`
- **CA-6** — If PUBLIC_BASE_URL não está configurada, the sistema shall recusar porque a Meta não conseguiria baixar a mídia.
  prova: `unit:test/publicacao.test.js`
- **CA-7** — If a chave não está no acervo, the sistema shall recusar e listar as chaves disponíveis.
  prova: `unit:test/publicacao.test.js`
- **CA-8** — When tudo está configurado, the sistema shall publicar um story e devolver o mediaId.
  prova: `unit:test/publicacao.test.js`

## Não-objetivos

- **Ligar a publicação automática no `app.js`**: é tarefa separada, validada na VPS (o `app.js`
  importa o SQLite nativo e mexe no caminho crítico de produção).
- Deploy (systemd do servidor + HTTPS): é operação, vive no README — não é comportamento testável.
- Galeria do Mercado Livre (OAuth) para carrossel: segue como pré-requisito da FEAT-006.
- Publicar no Direct: é a FEAT-005; aqui só o story.
