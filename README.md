# Affiliate Automation

Sistema de automação de afiliados multi-canal: escuta ofertas no **Telegram** e **WhatsApp**, faz bypass de encurtadores, converte para os **seus** links de afiliado e republica no seu grupo do WhatsApp — com **fila persistente anti-ban**, limpeza de divulgação alheia e rodapé com o link do **seu** grupo.

O **fluxo é genérico** (serve para qualquer loja); o que muda de loja para loja — formato de link, página intermediária, parâmetros de tracking, identidade do produto — fica declarado no **Perfil da Loja** (`src/affiliates/`).

## O que o sistema faz com cada oferta

1. Captura a mensagem (texto + foto) dos grupos monitorados (WhatsApp e Telegram).
2. Expande encurtadores (`meli.la`, `amzn.to`, `s.shopee...`, `promoby.me`) via HTTP, inclusive redirects por JavaScript / `<meta refresh>` **em cadeia de vários saltos** (ex.: Promobit: `promoby.me` → `api.promobit.com.br` → encurtador da loja).
3. Desembrulha redes de afiliados (Awin, Lomadee...) e remove parâmetros de tracking de terceiros.
4. Encontra a **página do produto**: se o link for intermediário (ex.: `mercadolivre.com.br/social/<perfil>`), o "mergulhador" da loja baixa o HTML e extrai o produto real.
5. Detecta a loja e converte para o **seu** link de afiliado.
6. **Remove todos os outros links da mensagem** (linktr.ee, `t.me` de concorrentes...) — só o seu permanece.
7. **Remove linhas promocionais de outros grupos/canais** ("compartilhe", "participe do canal"...) mantendo título, preço, cupom e forma de pagamento.
8. Busca a **imagem**: usa a foto da mensagem ou, na falta dela, a `og:image`/`twitter:image` da página da loja. Fontes em `FONTES_FOTO_SOMENTE_SITE` (ex.: grupo Promobit) **ignoram a foto da mensagem** — a imagem sai sempre do site do produto.
9. Adiciona o rodapé com o convite do **seu** grupo (`MEU_GRUPO_LINK`).
10. Entra na fila anti-ban (ritmo por horário + limite diário) e publica no seu grupo.

## Loja sem credencial = nada de link sem afiliação

Provider sem credencial configurada fica **INATIVO**: a oferta é descartada cedo (sem baixar HTML/imagem) e o sistema **nunca publica link sem o seu rastreio**. As variáveis que faltam aparecem no boot, a cada oferta descartada e no `npm run status`:

```
🏬 Lojas ATIVAS: Magalu, MercadoLivre
⏳ FALTAM CREDENCIAIS (ofertas dessas lojas são ignoradas):
      • Amazon → AMAZON_TAG
      • Shopee → SHOPEE_SECRET
      • Shein → SHEIN_AFFILIATE_ID
      • TikTokShop → TIKTOKSHOP_AFFILIATE_ID
   → Preencha no .env e reinicie: a loja liga sozinha, sem mexer no código.
```

## Stack
- Node.js (ESM) + `gramjs` (Telegram) + `wppconnect` (WhatsApp, via Chrome/Puppeteer)
- `axios` (links e imagens) + `better-sqlite3` (dedup + fila persistente) + `dotenv`

## Setup
```bash
npm install
cp .env.example .env   # preencha suas chaves
npm run doctor         # valida ambiente antes de abrir o WhatsApp
npm start
```

Na primeira execução:
1. O **QR Code do WhatsApp** aparece no terminal — escaneie.
2. O Telegram pede telefone/código e imprime a `TELEGRAM_SESSION_STRING` — salve no `.env`. **Sem a sessão salva, autentique uma vez em terminal interativo** (sob `nohup`/pm2 o Telegram fica desativado e o WhatsApp segue normal).
3. O console lista os **IDs dos seus grupos WhatsApp** (`...@g.us`) para você mapear no `.env`.

## Lojas suportadas e peculiaridades de link

| Loja | Credencial | Peculiaridade tratada |
|---|---|---|
| Mercado Livre | `MELI_AFFILIATE_ID` + `MELI_SOCIAL_ID` | O `meli.la` compartilhado abre a vitrine `/social/<slug>`; o sistema extrai o `MLB` da URL ou do HTML e monta a URL canônica (`/p/MLB...` ou `produto.mercadolivre.com.br/MLB-...-_JM`) com `matt_tool`/`matt_word`. `searchVariation` é preservado |
| Shopee | `SHOPEE_APP_ID` + `SHOPEE_SECRET` | API oficial GraphQL (`generateShortLink`) com assinatura SHA256; fallback parametrizado |
| Magalu | `MAGALU_STORE_ID` | reescreve o host para `magazinevoce.com.br/magazine<SUA_LOJA>/...` (descarta a vitrine de terceiro) |
| Amazon | `AMAZON_TAG` | parâmetro `tag`; produto identificado pelo ASIN (`/dp/<ASIN>`) |
| Shein | `SHEIN_AFFILIATE_ID` | parâmetro `aff_id`; id do produto em `-p-<id>.html` |
| TikTok Shop | `TIKTOKSHOP_AFFILIATE_ID` | parâmetro `affiliate_id`; só `/product/<id>` é oferta (vídeo/perfil é ignorado) |
| Genérica | `AFFILIATE_GENERIC_N` | formato `dominio.com:parametro:sua_chave` |

> Pesquisa detalhada por loja (formatos de link, parâmetros de rastreamento,
> lacunas adiadas e como revalidar): [`docs/links-afiliados-por-loja.md`](docs/links-afiliados-por-loja.md).

## Perfil da Loja (ajustar/adicionar loja sem mexer no pipeline)

```js
// src/affiliates/minhaloja.js
static credenciaisRequeridas = ['MINHALOJA_ID'];   // sem isso a loja fica INATIVA

static perfil = {
  urlNaoProduto: [/\/busca/, /\/categoria/],       // o que NUNCA é produto
  mergulhador: { nome, matches: (url) => bool, extrair: async (url) => urlProduto|null },
  idProduto: (url) => 'minhaloja:123',             // dedup pela identidade do produto
  paramsRemover: [/^rastro_extra$/i],              // tracking específico da loja
};
```

O `app.js` só consome o perfil (`perfilDeUrl`, `ehPaginaNaoProduto`, `resolverMergulhador`, `paramsRemoverPara`, `chaveProduto`). Loja nova = **1 arquivo** (ou 1 linha no `.env`, no caso das genéricas).

## Deduplicação por identidade do produto

O mesmo item pode chegar por slug, vitrine e encurtadores diferentes — por isso a dedup usa a identidade do produto (`meli:MLB...`, `amazon:ASIN`, `shopee:shopId.itemId`, `magalu:<id>`, `shein:<id>`, `tiktok:<id>`), com fallback para o link final sem query/hash.

## Fila de envio anti-ban (persistente)

- Processa **um envio por vez**, com delay dinâmico por horário:
  - **Pico (12–14h, 19–22h):** 5–15s | **Normal:** 45–120s | **Madrugada:** 3–7 min
- Limite diário configurável (`MAX_ENVIOS_DIA`), contado **uma vez por oferta** (as chaves extras de dedup não contam).
- **Persistente:** cada item é gravado no SQLite (`fila_envio`). Se o app cair ou reiniciar, os pendentes são retomados no boot (`♻️ Fila restaurada do banco`).
- Status em `data/fila-status.json` (caminho absoluto: funciona com `nohup`/pm2/cron a partir de qualquer diretório).

## Comandos do dia a dia

| Ação | Comando |
|---|---|
| Iniciar | `npm start` |
| Diagnóstico do ambiente (Node, Chrome, sessão, rede, banco, lojas) | `npm run doctor` |
| **Ver a fila** e as credenciais que faltam | `npm run status` |
| Checar a sintaxe de todos os módulos | `npm run check` |
| Sessão do WhatsApp caiu / QR expira sempre | `npm run reset-sessao` e rode `npm start` de novo |
| Rodar 24/7 (VPS) | seção **Deploy 24/7** abaixo |
| Acompanhar logs ao vivo | `npm start` no terminal ou `journalctl -u affiliate-automation -f` |

## Deploy 24/7 (systemd) — Oracle Cloud Free / VPS

> Destino validado: **Ampere A1 (arm64, 12 GB)**, Debian + Node 22 + Chromium do apt.
> O `better-sqlite3` tem prebuild arm64 e o Chromium do Debian também — nada precisa compilar.

### 1. Provisionamento

```bash
# usuário dedicado (o bot não roda como root)
sudo useradd -m -s /bin/bash affiliate

# Node 22 (o nodejs do repositório Debian é antido demais)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs chromium

# projeto (sem node_modules/tokens: reinstala e reautentica no destino)
sudo mkdir -p /opt/affiliate-automation
sudo rsync -a --exclude node_modules --exclude tokens --exclude .git ./ /opt/affiliate-automation/
sudo chown -R affiliate:affiliate /opt/affiliate-automation
cd /opt/affiliate-automation && sudo -u affiliate npm ci
sudo -u affiliate cp .env.example .env && sudo -u affiliate nano .env
```

Se for mover uma sessão já existente, enxágue o cache antes de copiar
(`tokens/` chega a ~500 MB, dos quais ~425 MB são cache recriável;
a sessão real tem 30–80 MB):

```bash
rm -rf tokens/affiliate-automation/Default/Cache \
       tokens/affiliate-automation/Default/Code\ Cache \
       tokens/affiliate-automation/Default/Service\ Worker
```

### 2. Autentique a sessão uma vez (QR)

```bash
sudo -u affiliate -H bash -c 'cd /opt/affiliate-automation && npm start'
```

Escaneie o QR (WhatsApp > Dispositivos conectados > Conectar dispositivo).
Conectado, `Ctrl+C` e siga para o systemd.

### 3. Unit do systemd

```bash
sudo cp deploy/affiliate-automation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-automation
sudo journalctl -u affiliate-automation -f   # logs e, se precisar, o QR
```

O unit usa `Restart=always` + `RestartSec=30` (volta sozinho após crash/OOM/queda
de rede) e `KillMode=control-group` (o Chrome filho morre junto no restart — sem
lock órfão travando o boot seguinte). O boot também se autossana:

- versão do WhatsApp Web **fixada no catálogo local** (`WHATSAPP_WEB_VERSION=auto`),
  sem o fallback para a versão live que quebra a injeção;
- **3 tentativas** com limpeza de Chrome órfão e de `SingletonLock` entre elas;
- QR com janela de 5 min em terminal (no journal: 60 s por tentativa + orientação
  impressa de como proceder);
- sincronização do dispositivo com 15 min de tolerância (o padrão de 3 min mata
  o boot quando há backlog de dias);
- caminhos absolutos e fuso de operação independentes do servidor (UTC).

### 4. Rotina

| Situação | Comando |
|---|---|
| Ver o que está acontecendo | `sudo journalctl -u affiliate-automation -f` |
| Fila/credenciais no servidor | `cd /opt/affiliate-automation && npm run status` |
| Diagnóstico no servidor | `npm run doctor` |
| Sessão caiu | `rm -rf tokens/affiliate-automation` e refaça o passo 2 |
| Atualizar o projeto | rsync novo + `npm ci` + `sudo systemctl restart affiliate-automation` |

### Docker (alternativa pronta)

O mesmo projeto roda em container (`Dockerfile` + `docker-compose.yml` na raiz,
base Debian slim + Chromium do apt, funciona em amd64 e arm64):

```bash
docker compose up -d --build
docker logs -f affiliate-automation   # o QR aparece aqui na 1ª execução
```

`tokens/`, `data/` e `.env` são montados no container: recriar o container não
perde a sessão. Prefira o systemd quando puder — processo único, sem camada
extra e com atualização de segurança do Chromium pelo apt.

## Configurações relevantes (.env)

```bash
MEU_GRUPO_WHATSAPP=1203634...@g.us           # ID do seu grupo (destino das ofertas)
MEU_GRUPO_LINK=https://chat.whatsapp.com/... # convite do seu grupo (rodapé das ofertas)
MAX_ENVIOS_DIA=150                           # limite diário anti-ban (0 = sem limite)
SHOPEE_SUB_ID=hi-cleo                        # marca d'água dos short links da Shopee
FONTES_FOTO_SOMENTE_SITE=whatsapp:12036...@g.us  # fontes cuja foto da mensagem é IGNORADA
                                                # (imagem vem sempre do site do produto)
```

> ⚠️  `MEU_GRUPO_LINK` deve ser o **link de convite** (WhatsApp → seu grupo → "Convidar via link"), **não** o ID interno `@g.us`.

## Estrutura

```
src/
├── app.js            # orquestrador: escuta → resolve → converte → limpa → enfileira
├── config.js         # variáveis de ambiente centralizadas
├── database.js       # SQLite (dedup por produto + fila persistente)
├── linkResolver.js   # expandir/sanitizar links + og:image do produto
├── sendQueue.js      # fila anti-ban persistente + status
├── status.js         # npm run status (fila + credenciais faltantes)
└── affiliates/       # providers plugáveis (base.js = contrato + perfil da loja)
    ├── index.js      # registry + API de perfis de loja
    ├── mercadolivre.js  shopee.js  amazon.js  magalu.js
    └── shein.js  tiktokshop.js  generic.js
data/                 # ofertas.db (SQLite) e fila-status.json
docs/                 # documentação (pesquisa de links por loja, etc.)
tokens/               # sessão do Chrome/WhatsApp (login do wppconnect)
```

## Aviso
O envio automatizado no WhatsApp viola os Termos de Serviço do WhatsApp. Use conta secundária e por sua conta e risco.
