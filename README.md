# Affiliate Automation

Sistema de automação de afiliados multi-canal: escuta ofertas no **Telegram** e **WhatsApp**, faz bypass de encurtadores, converge para os **seus** links de afiliado e republica no seu grupo do WhatsApp.

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

## Adicionando nova loja sem código
No `.env`:
```
AFFILIATE_GENERIC_1=dominio.com:parametro:sua_chave
```

## Estrutura
```
src/
├── config.js            # variáveis de ambiente centralizadas
├── database.js          # SQLite (deduplicação)
├── linkResolver.js      # expandir/sanitizar links
├── affiliates/          # providers plugáveis (base.js = contrato)
└── app.js               # orquestrador + anti-ban (5-15s)
```

## Aviso
O envio automatizado no WhatsApp viola os Termos de Serviço do WhatsApp. Use conta secundária e por sua conta e risco.
