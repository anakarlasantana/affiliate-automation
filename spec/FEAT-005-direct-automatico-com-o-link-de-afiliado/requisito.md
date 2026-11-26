---
id: FEAT-005
titulo: Direct automático com o link de afiliado
persona: operadora
prioridade: ALTA
origem: "Instagram Messaging API (link permitido no DM, janela de 24h) + opção 1 recomendada"
estado: em-revisao
---

## História

Como operadora, quero que quem responder **LINK** no meu story receba na hora o link do produto
no Direct — porque o Direct **é clicável** e o story não — para a venda acontecer com o meu
rastreio, sem automação proibida.

## Regras de negócio

- O Instagram só permite responder a quem **falou primeiro**: a resposta abre uma janela de
  **24 h** (`docs` de Messaging API). O sistema nunca inicia conversa.
- O webhook é público e **assinado** (`X-Hub-Signature-256`); assinatura inválida = 401.
- Idempotência por `mid`: a mesma mensagem nunca gera duas respostas.
- A primeira mensagem declara que é **automação** (exigência legal citada na doc da Meta).
- O link enviado é o do **nosso** redirecionador (FEAT-003), com o `matt_tool`.
- Retenção mínima: guarda-se o `IGSID` só para idempotência e métrica.

## Critérios de aceite

- **CA-1** — If a assinatura X-Hub-Signature-256 não confere, the sistema shall responder 401 sem processar a mensagem.
  prova: `unit:test/direct.test.js`
- **CA-2** — When chega mensagem sem a palavra-chave, the sistema shall não responder e não iniciar conversa.
  prova: `unit:test/direct.test.js`
- **CA-3** — When a mensagem já foi respondida, the sistema shall não responder de novo (idempotência por mid).
  prova: `unit:test/direct.test.js`
- **CA-4** — If a janela de 24 h expirou, the sistema shall não enviar a resposta e registrar o motivo.
  prova: `unit:test/direct.test.js`
- **CA-5** — When responde, the DM shall conter o nosso link de afiliado e o aviso de que é atendimento automático.
  prova: `unit:test/direct.test.js`
- **CA-6** — When o webhook é chamado, the sistema shall responder 200 em menos de 5 s e processar depois.
  prova: `api:ig-webhook`

## Não-objetivos

- Iniciar conversa com quem nunca falou (bloqueado pela API e proibido pela política).
- Chatbot de atendimento geral / IA de conversa.
- Responder a comentários de post (é outro produto da Meta).
- Handover para atendimento humano (Multi Apps).
