# Affiliate Automation

Sistema de automação de afiliados multi-canal: escuta ofertas no **Telegram** e **WhatsApp**, faz bypass de encurtadores, converge para os **seus** links de afiliado e republica no seu grupo do WhatsApp — com **fila persistente anti-ban**, limpeza automática de divulgação alheia e rodapé com o link do **seu** grupo.

## O que o sistema faz com cada oferta

1. Captura a mensagem (texto + foto) dos grupos monitorados.
2. Expande encurtadores (`meli.la`, `amzn.to`, `s.shopee...`) via HTTP ou headless browser.
3. Detecta a loja e converte o link para o **seu** link de afiliado.
4. **Remove todos os outros links da mensagem** (linktr.ee, t.me de concorrentes etc.) — só o seu fica.
5. **Remove linhas promocionais de outros grupos/canais** ("compartilhe", "participe do canal", "temos vagas"...), mantendo apenas título, preço, cupom e forma de pagamento.
6. Adiciona o rodapé com o convite do **seu** grupo (`MEU_GRUPO_LINK`).
7. Entra na fila anti-ban (ritmo por horário + limite diário) e publica no seu grupo.

## Stack
- Node.js (ESM) + `gramjs` (Telegram) + `wppconnect` (WhatsApp)
- `axios` (expansão de links) + `better-sqlite3` (deduplicação) + `dotenv`

## Setup
```bash
npm install
cp .env.example .env   # preencha suas chaves
npm start
```

Na primeira execução:
1. O **QR Code do WhatsApp** aparece no terminal — escaneie.
2. O Telegram pedirá telefone/código; a `TELEGRAM_SESSION_STRING` será impressa — salve no `.env`.
3. O console lista os **IDs dos seus grupos WhatsApp** (`...@g.us`) para você mapear no `.env`.

## Lojas suportadas
| Loja | Método |
|---|---|
| Amazon | parâmetro `tag` |
| Shopee | API oficial GraphQL (`generateShortLink`) + fallback |
| Magalu | rewrite `magazinevoce.com.br/magazine{SUA_LOJA}` |
| Mercado Livre | parâmetro de tracking via `.env` |
| Shein | parâmetro de afiliado via `.env` |
| TikTok Shop | parâmetro de afiliado via `.env` |

## Fila de envio anti-ban (persistente)

- Processa **um envio por vez**, com delay dinâmico por horário:
  - **Pico (12–14h, 19–22h):** 5–15s | **Normal:** 45–120s | **Madrugada:** 3–7 min
- Limite diário configurável (`MAX_ENVIOS_DIA`).
- **Persistente:** cada item é gravado no SQLite (`fila_envio`). Se o app cair ou reiniciar, os envios pendentes são retomados automaticamente no boot (`♻️ Fila restaurada do banco`).
- Status atualizado continuamente em `data/fila-status.json`.

## Comandos do dia a dia

| Ação | Comando |
|---|---|
| Iniciar | `npm start` |
| Iniciar em background | `nohup node src/app.js > /tmp/affiliate-app.log 2>&1 &` |
| **Parar** | `pkill -f "node src/app"` |
| **Ver a fila** (pendentes, enviadas hoje, próximo envio) | `npm run status` |
| Acompanhar logs ao vivo | `tail -f /tmp/affiliate-app.log \| grep -vE "^debug\|^http:"` |

Exemplo de `npm run status`:
```
📦 FILA DE ENVIO — atualizado em 15/09/2026 14:32
   Enviadas hoje: 47
   Proximo envio em ~90s
   3 oferta(s) aguardando:
     1. [mercadolivre] PRECINHO NESSE KIT MEIA NOVA...
     2. [amazon] Fone Bluetooth TWS...
```

## Configurações relevantes (.env)

```bash
MEU_GRUPO_WHATSAPP=1203634...@g.us        # ID do seu grupo (destino das ofertas)
MEU_GRUPO_LINK=https://chat.whatsapp.com/...   # convite público do seu grupo (rodapé das ofertas)
MAX_ENVIOS_DIA=80                          # limite diário anti-ban (0 = sem limite)
```

> ⚠️ `MEU_GRUPO_LINK` deve ser o **link de convite** (WhatsApp → seu grupo → "Convidar via link"), **não** o ID interno `@g.us`.

## Adicionando nova loja sem código
No `.env`:
```
AFFILIATE_GENERIC_1=dominio.com:parametro:sua_chave
```

## Estrutura
```
src/
├── config.js            # variáveis de ambiente centralizadas
├── database.js          # SQLite (deduplicação + fila persistente fila_envio)
├── linkResolver.js      # expandir/sanitizar links (HTTP + headless browser)
├── sendQueue.js         # fila anti-ban persistente + status (data/fila-status.json)
├── status.js            # npm run status → resumo da fila
├── clean.js             # utilitário de limpeza do banco (npm run clean)
├── whatsapp.js          # envio via wppconnect / Baileys
├── affiliates/          # providers plugáveis (base.js = contrato)
└── app.js               # orquestrador: escuta → resolve → converte → limpa → enfileira
```

## Aviso
O envio automatizado no WhatsApp viola os Termos de Serviço do WhatsApp. Use conta secundária e por sua conta e risco.
