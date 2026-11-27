# Affiliate Automation

Sistema de automação de afiliados multi-canal: escuta ofertas no **Telegram** e **WhatsApp**, faz bypass de encurtadores, converte para os **seus** links de afiliado e publica em **dois destinos** — no seu grupo do WhatsApp (com **fila persistente anti-ban**) e no **Instagram** (story automático e post no feed, com o **link na bio** via `/go`). O fluxo inclui limpeza de divulgação alheia e rodapé com o convite do **seu** grupo.

O **fluxo é genérico** (serve para qualquer loja); o que muda de loja para loja — formato de link, página intermediária, parâmetros de tracking, identidade do produto — fica declarado no **Perfil da Loja** (`src/affiliates/`).

## O que o sistema faz com cada oferta

1. Captura a mensagem (texto + foto) dos grupos monitorados (WhatsApp e Telegram).
2. Expande encurtadores (`meli.la`, `amzn.to`, `s.shopee...`, `promoby.me`) via HTTP, inclusive redirects por JavaScript / `<meta refresh>` **em cadeia de vários saltos** (ex.: Promobit: `promoby.me` → `api.promobit.com.br` → encurtador da loja).
3. Desembrulha redes de afiliados (Awin, Lomadee...) e remove parâmetros de tracking de terceiros.
4. Encontra a **página do produto**: se o link for intermediário (ex.: `mercadolivre.com.br/social/<perfil>`), o "mergulhador" da loja baixa o HTML e extrai o produto real.
5. Detecta a loja e converte para o **seu** link de afiliado.
6. **Remove todos os outros links da mensagem** (linktr.ee, `t.me` de concorrentes...) — só o seu permanece.
7. **Remove linhas promocionais de outros grupos/canais** ("compartilhe", "participe do canal"...) mantendo título, preço, cupom e forma de pagamento.
8. Busca a **imagem** em cascata — nenhuma oferta sai sem foto:

   | Nível | Fonte | Quando entra |
   |---|---|---|
   | 1 | Foto da **mensagem** do grupo de escuta | Padrão. Fontes em `FONTES_FOTO_SOMENTE_SITE` (ex.: grupo Promobit) pulam este nível — a foto de lá é o card da marca, não o produto |
   | 2 | `og:image` / JSON-LD da **página do produto** | Foto ausente ou grupo Promobit. Consulta primeiro a URL **canônica** (o que o provider resolveu) e cai para a original; em 404 tenta a canônica automaticamente |
   | 2.5 | **API oficial da loja** e **galeria** da página | Só se o nível 2 falhar. `loja:api-imagem` = API (Shopee); `site:galeria` = imagens da própria página (Mercado Livre, Magalu) |
   | 3 | Placeholder "Confira o Produto no Link" | Último recurso. Garante que a oferta **nunca** saia sem foto |

   A origem da foto é gravada em `fila_envio.origem_foto` e aparece no `npm run status` — é o jeito rápido de ver se a cascata está saudável.
9. Adiciona o rodapé com o convite do **seu** grupo (`MEU_GRUPO_LINK`).
10. Entra na fila anti-ban (ritmo por horário + limite diário) e publica no seu grupo.

## Instagram: story e feed

A mesma oferta convertida vira **criativo** e o link vai para a **bio** — `GET /go/<chave>` redireciona
para o produto, e `GET /go` (sem chave) aponta para a **oferta publicada mais recente**.

| Formato | Proporção | Teto/dia | Ritmo | Requisito |
|---|---|---|---|---|
| **Story** | 9:16 (1080×1920) | `MAX_STORIES_DIA` (12) | `INTERVALO_STORY_SEG` (600 s) | foto real + preço |
| **Post no feed** | 4:5 (1080×1350) | `MAX_POSTS_DIA` (6) | 1 post a cada `STORIES_POR_POST` (2) stories | foto real + preço |
| **Reels** | 9:16 | `MAX_REELS_DIA` (1) | — | **adiado** — falta gerar o vídeo (ver `docs/debitos-tecnicos.md`, DT-001) |

- **Story é efêmero** (24 h) e aguenta volume; **post fica na grade** do perfil — por isso os tetos
  são separados (um post não consome a vaga de um story).
- A publicação é **automática**: ao subir, o app levanta o **servidor de mídia** (porta 3000, só
  loopback) e o ciclo publica no ritmo. `PUBLICAR_STORIES=0` é o kill switch.
- Cada oferta pode ter os dois formatos no acervo, em **chaves por formato** (`meli-MLB1` = story,
  `meli-MLB1:post` = feed): publicar um não bloqueia o outro.
- Log dedicado: `grep '\[ig\]' logs/app.log` mostra preflight, container, publicação e recusa.
  O `npm run status` resume: `story x/12 · post x/6 · reel x/1`.
- Manual: `npm run publicar -- <chave>` (story) e
  `npm run publicar:feed -- <chave> --foto <arquivo> [--seco]` (feed).
- ⚠️ **A Meta baixa a mídia por HTTPS.** `PUBLIC_BASE_URL` precisa ser um host **estável**
  (domínio próprio ou `sslip.io`); túnel efêmero derruba a publicação (`erro 9004`) e o link da bio.

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

**Rodar**

| Ação | Comando |
|---|---|
| Iniciar (primeiro plano — `Ctrl+C` encerra de verdade) | `npm start` |
| Iniciar sem enviar no grupo (valida captura) | `DIAG_MIDIA=1 npm start` |
| Só o servidor de mídia/redirecionador | `npm run servidor` (o app já sobe um) |

**Ver**

| Ação | Comando |
|---|---|
| Fila, credenciais e painel do Instagram | `npm run status` |
| Logs ao vivo (tudo) | `tail -f logs/app.log` |
| Logs do Instagram | `tail -f logs/app.log \| grep '\[ig\]'` |
| O que está rodando | `pgrep -af 'src/app.js'` · `cat tokens/app.lock` · `ss -ltnp \| grep :3000` |
| Diagnóstico completo | `npm run doctor` |

**Publicar e preparar mídia**

| Ação | Comando |
|---|---|
| Story manual | `npm run publicar -- <chave>` |
| Post no feed | `npm run publicar:feed -- <chave> --foto <arquivo>` (`--seco` só compõe) |
| Ensaio: compõe no acervo e **não** publica | `npm run ensaiar -- <url> --preco 199` |
| Recompor o acervo com as regras atuais | `npm run recompor` (`--seco`, `--quarentena`) |

**Testar e validar**

| Ação | Comando |
|---|---|
| Sintaxe + suíte | `npm run verify` |
| Links reais na loja (produto + rastreio + imagem) | `npm run verify:links` |
| Credencial, conta e quota do Instagram | `npm run verify:ig` |

**Deploy e manutenção**

| Ação | Comando |
|---|---|
| Deploy na VPS (simulado, não toca nada) | `npm run deploy:vps -- --host <ip>` |
| Deploy na VPS (real) | `npm run deploy:vps -- --host <ip> --apply` |
| Rollback (código + banco) | `npm run deploy:vps -- --host <ip> --rollback --backup <arquivo> --apply` |
| Sessão do WhatsApp caiu | `npm run reset-sessao` e `npm start` de novo |
| Logs no servidor | `sudo journalctl -u affiliate-automation -f` |

## Parar e reiniciar

A aplicação são **três coisas**: o processo do app (`src/app.js`), o **servidor de mídia** — o
`src/servidor.js`, que o app levanta como **processo filho** na porta 3000 — e os processos **Chrome**
do perfil do WhatsApp. A trava `tokens/app.lock` guarda o pid do dono do perfil — **uma instância por
vez** (se subir outra, ela é recusada com o motivo).

```bash
# ver o que está no ar
pgrep -af 'src/app.js'
cat tokens/app.lock                  # pid dono do perfil
ss -ltnp | grep :3000                # quem serve a mídia

# parar do jeito certo: SIGTERM fecha o WhatsApp, mata a mídia filha,
# limpa Chrome órfão e libera a trava
kill $(head -1 tokens/app.lock)

# se travar no shutdown (não liberou a trava)
kill -9 $(head -1 tokens/app.lock)
pkill -f 'node src/app.js'
rm -f tokens/app.lock

# Chrome preso no perfil — sem matar o seu navegador pessoal
for p in $(pgrep -f chrome); do
  tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q 'tokens/affiliate-automation' && kill "$p"
done
```

`Ctrl+C` funciona quando o app roda em **primeiro plano** (`npm start`). Se ele foi iniciado
desacoplado (`setsid nohup …`), o sinal do terminal não o alcança — use o `kill` acima.

No servidor quem manda é o systemd: `sudo systemctl stop|start|restart affiliate-automation`.

## Deploy 24/7 (systemd) — Oracle Cloud Free / VPS

> Destino validado: **Ampere A1 (arm64, 12 GB)**, Debian + Node 22 + Chromium do apt.
> O `better-sqlite3` tem prebuild arm64 e o Chromium do Debian também — nada precisa compilar.

### 0. Pré-requisitos do Instagram (ffmpeg + HTTPS)

O Instagram acrescentou duas dependências que **não existiam** no deploy original:

```bash
# ffmpeg compõe o story (1080x1920) e o post do feed (1080x1350)
sudo apt install -y ffmpeg

# A Meta SÓ baixa mídia por HTTPS. Caddy cuida do certificado (Let's Encrypt).
sudo apt install -y caddy
sudo systemctl enable --now caddy
```

E as portas **80/443** precisam estar abertas em **dois** lugares:

1. **Console OCI** → Instances → instância → Subnet → Security List → *Add Ingress Rules*
   (`0.0.0.0/0`, TCP, 80 e 443);
2. **no host** — o `iptables` do Debian termina com `REJECT`:
   ```bash
   sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

A **porta 3000 continua fechada**: o servidor de mídia escuta só em loopback e o Caddy é quem expõe
(`deploy/Caddyfile` → `reverse_proxy 127.0.0.1:3000`).

Host público sem custo (a Meta precisa de HTTPS estável — túnel efêmero derruba a publicação):

| Serviço | Nome | Conta |
|---|---|---|
| `sslip.io` | `147-15-55-124.sslip.io` | não precisa |
| DuckDNS | `seu-nome.duckdns.org` | grátis |

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
| Fila/credenciais/Instagram no servidor | `cd /opt/affiliate-automation && npm run status` |
| Diagnóstico no servidor | `npm run doctor` |
| Sessão caiu | `rm -rf tokens/affiliate-automation` e refaça o passo 2 |
| **Atualizar o projeto** | `npm run deploy:vps -- --host <ip> --apply` (abaixo) |
| Parar / reiniciar | `sudo systemctl stop\|restart affiliate-automation` |

### 5. Atualizar a produção (deploy de atualização)

O jeito antigo — `rsync` do projeto inteiro — é seguro na **primeira** instalação e perigoso no
**update**, por dois motivos:

| Armadilha | O que acontecia | Como o script resolve |
|---|---|---|
| `rsync` sem excluir `data/` | o banco **local** (teste) sobrescrevia o de produção, que guarda o dedup dos envios → o app **reenviava tudo** ao grupo | `--exclude data` (e `tokens`, `.env`, `logs`, `node_modules`) |
| `cp .env.example .env` | apagava as **credenciais de produção** | o script **lista as chaves faltantes**; você preenche, ele nunca copia |

```bash
# 1) simulação: imprime o plano e NÃO toca no servidor
npm run deploy:vps -- --host <ip> [--dns seu-nome.duckdns.org]

# 2) executa: backup do banco + cópia do código em .prev + rsync + npm ci
#    + valida ffmpeg/caddy/better-sqlite3 + lista o .env que falta
npm run deploy:vps -- --host <ip> --apply

# 3) depois de preencher o .env, roda de novo: verify + Caddyfile + restart + /health
npm run deploy:vps -- --host <ip> --apply

# 4) se algo der errado, volta código E banco
npm run deploy:vps -- --host <ip> --rollback --backup /opt/affiliate-automation/data/ofertas.db.bak.<carimbo> --apply
```

O script **para** se faltar ffmpeg, Caddy, `better-sqlite3`, os quatro assets do template
(`story-base.png`, `story.json`, `post-base.png`, `post.json`) ou chave obrigatória no `.env`.

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
# ---- WhatsApp (destino das ofertas) ----
MEU_GRUPO_WHATSAPP=1203634...@g.us           # ID do seu grupo
MEU_GRUPO_LINK=https://chat.whatsapp.com/... # convite do seu grupo (rodapé + legenda do feed)
MAX_ENVIOS_DIA=150                           # limite diário anti-ban (0 = sem limite)
SHOPEE_SUB_ID=hi-cleo                        # marca d'água dos short links da Shopee
FONTES_FOTO_SOMENTE_SITE=whatsapp:12036...@g.us  # fontes cuja foto da mensagem é IGNORADA

# ---- Instagram ----
IG_USER_ID=178414...                         # id numérico da conta profissional
IG_ACCESS_TOKEN=...                          # token de Usuário do Sistema (não expira)
IG_APP_SECRET=...                            # valida a assinatura do webhook do Direct
IG_VERIFY_TOKEN=...                          # handshake do webhook
PUBLICAR_STORIES=1                           # kill switch da publicação automática
# Base pública da mídia e do link curto: precisa ser HTTPS ESTÁVEL (a Meta baixa por aí)
PUBLIC_BASE_URL=https://147-15-55-124.sslip.io
GO_BASE_URL=https://147-15-55-124.sslip.io
GO_DESTINO=oferta                            # 'oferta' = link na bio abre o produto; 'grupo' = convite
MAX_STORIES_DIA=12
MAX_POSTS_DIA=6                              # teto separado: post fica na grade do perfil
STORIES_POR_POST=2                           # 1 post a cada 2 stories (0 = story sempre primeiro)
INTERVALO_STORY_SEG=600
FEED_ATIVO=1                                 # compõe também o criativo 4:5 na captura
FEED_CONVITE_NA_LEGENDA=1                    # convite do grupo na legenda (quando a bio não leva ao grupo)
MIDIA_DIR=                                   # vazio = data/midia
```

> ⚠️  `MEU_GRUPO_LINK` deve ser o **link de convite** (WhatsApp → seu grupo → "Convidar via link"), **não** o ID interno `@g.us`.

## Estrutura

```
src/
├── app.js            # orquestrador: escuta → resolve → converte → limpa → enfileira
├── config.js         # variáveis de ambiente centralizadas
├── database.js       # SQLite (dedup por produto + fila persistente)
├── linkResolver.js   # expandir/sanitizar links + og:image/og:title/preço da página
├── sendQueue.js      # fila anti-ban persistente + status
├── oferta.js         # ponto único: destino + criativo (story e post) no acervo
├── servidor.js       # /go, /midia e webhook do Direct (sobe como filho do app)
├── instancia.js      # trava de perfil único do Chrome + recuperação do browserClose
├── deploy.js         # regras do deploy (exclusões, merge de .env, rollback)
├── status.js         # npm run status (fila, credenciais e painel do Instagram)
├── status-ig.js      # montagem da seção INSTAGRAM do status
├── midia/            # composição: layout do story, feed 4:5, preço, vídeo, acervo
├── canais/           # publicação: instagram.js (containers), publicacao.js, direct.js
├── publicacao/       # ciclo automático + servidor de mídia interno
└── affiliates/       # providers plugáveis (base.js = contrato + perfil da loja)
    ├── index.js      # registry + API de perfis de loja
    ├── mercadolivre.js  shopee.js  amazon.js  magalu.js
    └── shein.js  tiktokshop.js  generic.js

assets/template/      # story-base.png + story.json · post-base.png + post.json (zonas medidas)
data/                 # ofertas.db (SQLite), fila-status.json, midia/ (acervo + JPEGs)
deploy/               # affiliate-automation.service (systemd) + Caddyfile (HTTPS)
docs/                 # arquitetura, receitas, links por loja, débitos técnicos
logs/                 # app.log (espelho de tudo, inclusive do Instagram)
tokens/               # sessão do Chrome/WhatsApp + app.lock (uma instância por perfil)
```

## Trabalhando no projeto com agentes de IA (ai-harness)

O repositório publica o próprio contexto para o
[`ai-harness`](https://github.com/anakarlasantana/ai-harness):

- [`AGENTS.md`](AGENTS.md) — regras invioláveis, comandos de prontidão e mapa
  "onde olhar". É o arquivo que o harness injeta no System Prompt e que Cline,
  Codex e Claude também leem.
- [`.harness/context.json`](.harness/context.json) — provider, amostragem por
  etapa, comandos e `verification.readiness` (`npm run check && npm test`).
- `docs/harness/` — [arquitetura](docs/harness/arquitetura.md),
  [contrato do provider](docs/harness/contrato-provider.md) e
  [receitas](docs/harness/receitas.md).

Na raiz deste repositório (depois de instalar o harness com `npm link`):

```bash
ai plan create <specId>                    # desenho + tarefas
ai build code <taskId> "..." --spec <ID>   # implementação
ai verify ready                            # roda npm run check && npm test
ai ops dashboard                           # painel local das execuções
```

Artefatos de execução (`.harness/tasks/`, `tests/`, `rework/`) ficam fora do git.

## Aviso
O envio automatizado no WhatsApp viola os Termos de Serviço do WhatsApp. Use conta secundária e por sua conta e risco.
