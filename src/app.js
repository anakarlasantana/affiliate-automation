/**
 * app.js — Orquestrador Principal
 *
 * Pipeline: mensagem -> extrair link -> expandir -> sanitizar
 *   -> deduplicar (SQLite) -> converter p/ afiliado -> remontar texto
 *   -> delay anti-ban (5-15s) -> enviar ao meu grupo WhatsApp -> registrar.
 */
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import wppconnect from "@wppconnect-team/wppconnect";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

import config, {
  TOKENS_DIR,
  DATA_DIR,
  horaOperacional,
  inicioDoDiaOperacional,
} from "./config.js";
import {
  contarEnviosHoje,
  jaFoiEnviada,
  listarFilaDb,
  registrarEnvio,
} from "./database.js";
import {
  expandirLink,
  sanitizarUrl,
  extrairLinks,
  desembrulharVerificacaoMeli,
  desembrulharAfiliadoRedirecionador,
  extrairImagemProduto,
} from "./linkResolver.js";
import {
  baixarMidiaComRetry,
  placeholderPara,
  validarImagemBase64,
  textoErro,
  legendaParaFoto,
  dimensoesImagem,
  classificarMidia,
  MIN_LADO_FOTO,
} from "./imagem.js";
import {
  converterParaAfiliado,
  perfilDeUrl,
  ehPaginaNaoProduto,
  resolverMergulhador,
  paramsRemoverPara,
  chaveProduto,
  resumoLojas,
} from "./affiliates/index.js";
import { SendQueue } from "./sendQueue.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fila global de envios (ritmo anti-ban por horário) */
let filaEnvio = null;

/** Catálogo LOCAL de versões do WhatsApp Web (sem quebrar se a dep faltar). */
const requireWaVersion = createRequire(import.meta.url);

/** Perfil do Chrome desta sessão — caminho ABSOLUTO (config), não relativo ao cwd. */
const PERFIL_CHROME = path.join(TOKENS_DIR, config.whatsapp.sessao);

/** Cliente vivo do WhatsApp, para encerramento limpo. */
let wppClientGlobal = null;

/** Binários de Chrome/Chromium testados quando CHROME_PATH não está definido. */
const CANDIDATOS_CHROME = [
  config.whatsapp.chromePath,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
].filter(Boolean);

/*
 * As PECULIARIDADES de cada loja (páginas intermediárias, links que não são
 * produto, parâmetros de tracking, identidade do produto para dedup) vivem no
 * PERFIL da loja, em src/affiliates/<loja>.js. Este arquivo é o fluxo GENÉRICO:
 * escutar → expandir → achar o produto → meu link → imagem → enviar.
 */

/* ================= Pipeline de ofertas ================= */

async function processarOferta(
  textoOriginal,
  origem,
  wppClient,
  imagemBase64 = null,
  origemFotoMidia = null,
) {
  try {
    // Percorre TODOS os links da mensagem ate achar um link de produto
    // convertivel. Links de perfil grupal (meli.la -> /social/...), landing
    // pages e links sem afiliacao sao pulados.
    const linksEncontrados = extrairLinks(textoOriginal);
    if (linksEncontrados.length === 0) {
      console.log(
        `   ↷ [${origem}] Sem link na mensagem (texto: "${(textoOriginal || "").slice(0, 60)}...") — ignorando.`,
      );
      return;
    }

    let linkCru = null,
      urlLimpa = null,
      meuLink = null,
      loja = null;
    for (const linkTentativa of linksEncontrados) {
      console.log(`
🔗 [${origem}] Tentando link: ${linkTentativa}`);
      try {
        // Atalho (antes de qualquer HTTP): link direto de loja sem credencial
        // configurada é descartado na hora — sem baixar HTML nem imagem.
        const preAlvo = perfilDeUrl(linkTentativa);
        if (preAlvo && !preAlvo.ativa) {
          console.log(
            `   ⏳ [${preAlvo.loja}] ignorada — falta ${preAlvo.faltantes.join(", ")} no .env (oferta NÃO enviada).`,
          );
          continue;
        }
        // Expande encurtador → desembrulha verificacao do ML → desembrulha
        // links de redes de afiliados (Awin, Lomadee...) até a loja real.
        const urlExpandida = desembrulharAfiliadoRedirecionador(
          desembrulharVerificacaoMeli(await expandirLink(linkTentativa)),
        );
        let urlTentativa = sanitizarUrl(
          urlExpandida,
          paramsRemoverPara(urlExpandida),
        );
        console.log(`   ↳ URL limpa: ${urlTentativa}`);

        // Loja conhecida sem credencial: descarta ANTES de baixar HTML/imagem.
        const alvoLink = perfilDeUrl(urlTentativa);
        if (alvoLink && !alvoLink.ativa) {
          console.log(
            `   ⏳ [${alvoLink.loja}] ignorada — falta ${alvoLink.faltantes.join(", ")} no .env (oferta NÃO enviada).`,
          );
          continue;
        }

        // Páginas intermediárias (perfil/vitrine/social) que não são produto,
        // mas que podemos "mergulhar" para extrair o produto real do HTML.
        // O mergulhador é declarado no PERFIL da loja (src/affiliates/), então
        // suportar um novo formato de link não exige mexer neste pipeline.
        const mergulhador = resolverMergulhador(urlTentativa);
        if (mergulhador) {
          console.log(
            `   ↳ Página intermediária (${mergulhador.nome}) — buscando o produto dentro dela...`,
          );
          const urlProduto = await mergulhador.extrair(urlExpandida);
          if (!urlProduto) {
            console.log(
              `   ↷ Produto nao encontrado em ${mergulhador.nome} — tentando proximo link...`,
            );
            urlTentativa = "";
          } else {
            urlTentativa =
              urlExpandida === urlProduto
                ? urlTentativa
                : sanitizarUrl(urlProduto, paramsRemoverPara(urlProduto));
            console.log(`   ↳ Produto extraído: ${urlTentativa}`);
          }
        }
        if (!urlTentativa) continue;

        // Não é produto? Perfil/vitrine/landing da própria loja (perfil da
        // loja) ou convite/agregador de terceiro (regra global).
        if (ehPaginaNaoProduto(urlTentativa)) {
          console.log(
            "   ↷ Não é link de produto (perfil/vitrine/landing/convite) — tentando próximo link...",
          );
          continue;
        }

        // Dedup pela IDENTIDADE DO PRODUTO (MLB/ASIN/shopId.itemId...): o mesmo
        // item pode chegar por slug, vitrine ou encurtador diferente.
        const chaveProdutoAtual = chaveProduto(urlTentativa);
        if (chaveProdutoAtual && jaFoiEnviada(`produto:${chaveProdutoAtual}`)) {
          console.log(
            `   ↳ Produto já divulgado (${chaveProdutoAtual}) — tentando próximo link...`,
          );
          continue;
        }

        if (jaFoiEnviada(urlTentativa)) {
          console.log("   ↳ Duplicada — tentando proximo link...");
          continue;
        }

        const conv = await converterParaAfiliado(urlTentativa, urlExpandida);
        if (!conv.meuLink) {
          if (conv.motivo === "sem-credencial") {
            console.log(
              `   ⏳ [${conv.loja}] ignorada — falta ${(conv.faltantes || []).join(", ")} no .env (oferta NÃO enviada).`,
            );
          } else {
            console.log(
              `   ↷ Sem conversao de afiliado para ${new URL(urlTentativa).hostname} — tentando proximo link...`,
            );
          }
          continue;
        }
        linkCru = linkTentativa;
        urlLimpa = urlTentativa;
        meuLink = conv.meuLink;
        loja = conv.loja;
        break;
      } catch (erroLink) {
        console.log(
          "   ↷ Falha ao resolver este link (" +
            erroLink.message +
            ") — tentando proximo...",
        );
      }
    }

    if (!linkCru) {
      console.log(
        "   ↷ Nenhum link de produto utilizavel na mensagem — ignorando.",
      );
      return;
    }
    console.log(`   ↳ [${loja}] Meu link: ${meuLink}`);

    // Cascata de imagem (nenhuma oferta sai sem foto):
    //  1. foto da mensagem original (ja vem em imagemBase64);
    //  2. foto oficial do site (og:image da URL canonica do produto);
    //  3. placeholder da loja (assets locais) — ultimo recurso, nunca descarta.
    // O rotulo de origemFotoMidia diz COMO a foto da mensagem foi obtida
    // (mensagem:body | mensagem:download | mensagem:miniatura) — assim o
    // `npm run status` mostra na hora se alguma oferta saiu degradada.
    let origemFoto = imagemBase64 ? origemFotoMidia || "mensagem" : null;
    if (imagemBase64) {
      const v = validarImagemBase64(String(imagemBase64));
      if (!v.valido) {
        console.warn(
          `   ⚠️  Foto da mensagem invalida (${v.motivo}) — buscando no site...`,
        );
        imagemBase64 = null;
        origemFoto = null;
      }
    }
    if (!imagemBase64) {
      try {
        // urlLimpa (escopo da funcao), nao urlTentativa (escopo do loop):
        // antes, mensagem SEM foto quebrava aqui com ReferenceError e a
        // oferta inteira era perdida.
        const doSite = await extrairImagemProduto(urlLimpa);
        if (doSite?.base64) {
          const v = validarImagemBase64(doSite.base64);
          if (v.valido) {
            imagemBase64 = doSite.base64;
            origemFoto = doSite.origem || "site";
            console.log(
              `   🖼️  Foto do produto obtida do site (${v.kb} KB, ${v.mime}, via ${origemFoto})`,
            );
          } else {
            console.warn(
              `   ⚠️  Foto do site invalida (${v.motivo}) — usando placeholder.`,
            );
          }
        } else {
          console.log(
            "   🖼️  Site sem foto util — usando placeholder da loja.",
          );
        }
      } catch (e) {
        console.warn(
          `   ⚠️  Erro ao buscar foto do produto: ${textoErro(e)} — usando placeholder.`,
        );
      }
    }
    if (!imagemBase64) {
      // Nivel 3: garante que a oferta SEMPRE tenha foto (nunca descarta).
      const ph = placeholderPara(loja);
      imagemBase64 = ph.base64;
      origemFoto = ph.origem;
      console.log(
        `   🖼️  Placeholder [${loja}] aplicado — oferta mantida com foto generica.`,
      );
    }

    // Deduplica pela IDENTIDADE DO PRODUTO (MLB/ASIN/shopId.itemId...): o mesmo
    // item pode chegar por links, vitrines e encurtadores diferentes.
    // Fallback: link final sem query/hash.
    let chaveFinal = chaveProduto(urlLimpa);
    if (chaveFinal) {
      chaveFinal = `produto:${chaveFinal}`;
    } else {
      chaveFinal = meuLink;
      try {
        const u = new URL(meuLink);
        u.search = "";
        u.hash = "";
        chaveFinal = u.toString();
      } catch {}
    }
    if (chaveFinal && chaveFinal !== urlLimpa && jaFoiEnviada(chaveFinal)) {
      console.log(
        "   ↳ Produto já divulgado (mesmo item, link diferente) — ignorada.",
      );
      return;
    }

    // Texto original intacto; só o link é substituído
    let mensagemFinal = textoOriginal.replace(linkCru, meuLink);

    // Remove QUALQUER outro link da mensagem (linktr.ee, convites de grupo,
    // cupons com link etc.) — so o seu link de afiliado permanece.
    const outrosLinks = mensagemFinal.match(/https?:\/\/[^\s<>()"'`]+/gi) || [];
    for (const outro of outrosLinks) {
      if (outro !== meuLink) {
        mensagemFinal = mensagemFinal.replace(outro, "");
        console.log("   🚫 Link estranho removido: " + outro.slice(0, 70));
      }
    }
    // Remove linhas promocionais de outros grupos/canais (fica so a oferta:
    // descricao do produto, preco, cupom e forma de pagamento).
    const PADRAO_PROMO =
      /grupo|canal|compartilh|particip|entre no|entrem|vagas|telegram|whats|linktr|siga|segue|divulg|ajud|indique|convite/i;
    const linhasOriginais = mensagemFinal.split(/\n/);
    const linhasMantidas = [];
    for (const linha of linhasOriginais) {
      if (linha.includes(meuLink)) {
        linhasMantidas.push(linha);
        continue;
      } // nunca remove o seu link
      if (PADRAO_PROMO.test(linha)) {
        if (linha.trim())
          console.log(
            "   🧹 Linha promocional removida: " + linha.trim().slice(0, 60),
          );
        continue;
      }
      linhasMantidas.push(linha);
    }
    mensagemFinal = linhasMantidas.join("\n");

    // Limpa linhas que ficaram vazias apos a remocao
    mensagemFinal = mensagemFinal.replace(/\n{3,}/g, "\n\n").trim();

    // Rodape com o link do SEU grupo (substitui a divulgacao removida)
    if (config.whatsapp.meuGrupoLink) {
      mensagemFinal +=
        "\n\n📢 Compartilhe o nosso grupo de ofertas:\n" +
        config.whatsapp.meuGrupoLink;
    }

    // Entra na fila anti-ban (envio sequencial, delay dinâmico por horário).
    // origemFoto rastreia a cascata: mensagem | site:* | placeholder.
    const primeiraLinha = (
      mensagemFinal.split("\n").find((l) => l.trim()) || ""
    ).trim();
    filaEnvio.enqueue({
      mensagemFinal,
      urlLimpa,
      chaveFinal,
      wppClient,
      imagemBase64,
      origemFoto,
      meuLink,
      loja: loja,
      titulo: primeiraLinha.slice(0, 80),
    });
  } catch (erro) {
    console.error(`❌ Erro ao processar oferta [${origem}]: ${erro.message}`);
  }
}

/* ================= WhatsApp (wppconnect) ================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lista os grupos do WhatsApp com retentativas (a sincronização inicial
 * pode demorar). Imprime em destaque para não se perder nos logs de debug.
 */
async function listarGruposComRetry(
  client,
  tentativas = 10,
  intervaloMs = 5000,
) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      // força atualização da lista de chats
      await client.listChats().catch(() => {});
      const chats = await client.listChats({ onlyGroups: true });
      if (chats && chats.length) {
        console.log("\n==================================================");
        console.log("📋 GRUPOS DO WHATSAPP (copie os IDs para o .env):");
        console.log("==================================================");
        for (const chat of chats) {
          console.log(
            `   ${chat.id?._serialized || chat.id} -> ${chat.name || "(sem nome)"}`,
          );
        }
        console.log("==================================================\n");
        return;
      }
      console.log(
        `⏳ [${i}/${tentativas}] Aguardando sincronização dos grupos...`,
      );
    } catch (erro) {
      console.warn(
        `⚠️  [${i}/${tentativas}] Falha ao listar grupos: ${erro.message}`,
      );
    }
    await sleep(intervaloMs);
  }
  console.warn(
    "⚠️  Não foi possível listar os grupos. Mande uma mensagem em qualquer grupo e rode de novo.",
  );
}

/* ================= Conexão WhatsApp (boot resiliente) ================= */

/** Encontra um Chrome/Chromium usável (no VPS arm64 é o Chromium do apt). */
let caminhoChromeCache = null;

function detectarChrome() {
  if (caminhoChromeCache) return caminhoChromeCache;
  for (const candidato of CANDIDATOS_CHROME) {
    if (!fs.existsSync(candidato)) continue;
    let versao = "";
    try {
      versao = execFileSync(candidato, ["--version"], {
        encoding: "utf8",
        timeout: 15000,
      }).trim();
    } catch {
      versao = "(não respondeu --version)";
    }
    caminhoChromeCache = { caminho: candidato, versao };
    return caminhoChromeCache;
  }
  return null;
}

/** Catálogo local de versões do WhatsApp Web (dependência do wppconnect). */
function catalogoWaVersion() {
  try {
    return requireWaVersion("@wppconnect/wa-version");
  } catch {
    return null;
  }
}

/** Versão a fixar: 'auto' = a mais recente do catálogo local; 'latest' = live. */
function versaoWhatsAppWeb() {
  const escolhida = (config.whatsapp.webVersion || "auto").trim();
  if (escolhida === "latest") return undefined;
  if (escolhida !== "auto") return escolhida;
  try {
    return catalogoWaVersion()?.getVersionInfo?.().version || undefined;
  } catch {
    return undefined;
  }
}

/** Dono do SingletonLock: symlink "<hostname>-<pid>" (ou null). */
function donoDoLock() {
  try {
    const destino = fs.readlinkSync(path.join(PERFIL_CHROME, "SingletonLock"));
    const pid = Number(String(destino).split("-").pop());
    return { destino, pid: Number.isInteger(pid) && pid > 0 ? pid : null };
  } catch {
    return null;
  }
}

/** O pid ainda existe? */
function pidVivo(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chrome usando ESTE perfil (processo pai; ignora renderizadores). A varredura
 * é feita sempre: se um Chrome morre com o perfil sujo, o próximo boot limpa.
 */
function chromesDoPerfil() {
  const achados = [];
  try {
    const saida = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      timeout: 10000,
    });
    for (const linha of saida.split("\n")) {
      const m = linha.trim().match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      const args = m[2];
      // O binário real pode ser /opt/google/chrome/chrome, /usr/bin/chromium etc.
      const eBinarioChrome =
        /(^|\s)(\/[\w./-]+)?(google-chrome[\w-]*|chrome|chromium)(\s|$)/.test(
          args,
        );
      // Linhas de script (bash/node) que apenas MENCIONAM o perfil não são Chrome.
      const primeiroToken = args.split(/\s+/)[0] || "";
      const eScript = /(^|\/)(bash|sh|node|python3?)$/.test(primeiroToken);
      if (
        args.includes(PERFIL_CHROME) &&
        !args.includes("--type=") &&
        !eScript &&
        eBinarioChrome
      ) {
        achados.push({ pid: Number(m[1]) });
      }
    }
  } catch {
    // sem `ps` disponível: segue sem essa checagem
  }
  return achados;
}

/**
 * Limpa restos de execuções interrompidas — a causa nº 1 de "o app não sobe":
 * Chrome pendurado no perfil e Singleton* apontando para pid já morto.
 */
function limparRestosChrome() {
  for (const { pid } of chromesDoPerfil()) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`🧹 Chrome órfão encerrado (pid ${pid}).`);
    } catch {
      // já morreu
    }
  }
  const lock = donoDoLock();
  if (lock && !pidVivo(lock.pid)) {
    for (const nome of [
      "SingletonLock",
      "SingletonCookie",
      "SingletonSocket",
    ]) {
      try {
        fs.unlinkSync(path.join(PERFIL_CHROME, nome));
      } catch {
        // nada a remover
      }
    }
    console.log(
      `🧹 Lock órfão removido (pid ${lock.pid ?? "?"} não existe mais).`,
    );
  }
}

/** Status do wppconnect traduzido para o que significa na prática. */
function traduzirStatus(status) {
  const mapa = {
    notLogged:
      "📱 NINGUÉM LOGADO — escaneie o QR Code para conectar o WhatsApp",
    qrReadSuccess: "✅ QR lido com sucesso! Sincronizando…",
    qrReadFail: "❌ O QR não foi lido a tempo — vem nova tentativa",
    qrReadError: "❌ Falha ao ler o QR Code",
    isLogged: "🔑 Sessão reconhecida (já logado)",
    inChat: "✅ WhatsApp pronto",
    phoneNotConnected:
      "📴 CELULAR DESCONECTADO — confira o WhatsApp e a internet do celular",
    autocloseCalled: "⏱️  Tempo esgotado nesta tentativa",
    serverClose: "⚠️  O servidor do WhatsApp fechou a conexão",
    browserClose: "⚠️  O navegador foi fechado",
    disconnectedMobile: "📴 O celular se desconectou",
  };
  return mapa[status] || `ℹ️  status: ${status}`;
}

/** Cria o cliente com versão fixada, QR legível e status traduzido. */
async function criarClienteWhatsApp(chave) {
  const versao = versaoWhatsAppWeb();
  console.log(
    versao
      ? `📌 WhatsApp Web fixado na versão ${versao} (catálogo local)`
      : "📌 WhatsApp Web SEM versão fixada (live) — defina WHATSAPP_WEB_VERSION se falhar",
  );

  const chrome = detectarChrome();
  if (chrome) console.log(`🌐 Navegador: ${chrome.caminho} ${chrome.versao}`);
  else
    console.warn(
      "🌐 Nenhum Chrome/Chromium do sistema — usando o binário do puppeteer.",
    );

  return wppconnect.create({
    session: config.whatsapp.sessao,
    headless: true,
    useChrome: true,
    logQR: true,
    // 'autoClose' = tempo de vida da página esperando o QR ser lido.
    autoClose: chave.autoCloseMs,
    // Após autenticar, limite para a sincronização do dispositivo: com backlog
    // de dias o padrão de 3 min mata o boot no meio da SYNCING.
    deviceSyncTimeout: config.whatsapp.deviceSyncMs,
    ...(versao ? { whatsappVersion: versao } : {}),
    folderNameToken: TOKENS_DIR,
    puppeteerOptions: {
      userDataDir: PERFIL_CHROME,
      // Timeout de protocolo maior: downloadMedia de fotos grandes estourava
      // "Runtime.callFunctionOn timed out" sob carga do Chromium.
      protocolTimeout: 120000,
      ...(chrome ? { executablePath: chrome.caminho } : {}),
    },
    catchQR: (_qr, _ascii, tentativa) => {
      chave.pediuQR = true;
      console.log(
        "\n📱 ESCANEIE O QR CODE ACIMA — WhatsApp > Dispositivos conectados > Conectar dispositivo" +
          `\n   (QR nº ${tentativa}; expira em ${Math.round(chave.autoCloseMs / 1000)}s)\n`,
      );
    },
    statusFind: (status) => {
      if (status === "notLogged") chave.pediuQR = true;
      console.log(`   ${traduzirStatus(status)}`);
    },
  });
}

/** Conecta com N tentativas e limpeza entre elas. Erro carrega {pediuQR}. */
async function conectarWhatsAppComRetry() {
  const tentativas = config.whatsapp.tentativas;
  // Sem terminal não há quem escaneie o QR: janela curta só para falhar rápido
  // (o passo a passo do QR é impresso no bloco final de orientação).
  const autoCloseMs = process.stdin.isTTY ? config.whatsapp.timeoutQrMs : 60000;
  const esperas = [30, 90];
  let pediuQR = false;
  let ultimoErro = null;

  for (let i = 1; i <= tentativas; i++) {
    limparRestosChrome();
    const chave = { autoCloseMs, pediuQR: false };
    try {
      const client = await criarClienteWhatsApp(chave);
      pediuQR = pediuQR || chave.pediuQR;
      console.log(`✅ WhatsApp conectado na tentativa ${i}/${tentativas}.`);
      return { client, pediuQR };
    } catch (erro) {
      ultimoErro = erro;
      pediuQR = pediuQR || chave.pediuQR;
      console.warn(`⚠️  [WhatsApp ${i}/${tentativas}] falhou: ${erro.message}`);
      if (i < tentativas) {
        const espera = esperas[Math.min(i - 1, esperas.length - 1)];
        console.log(`↻ Limpando restos e tentando de novo em ${espera}s...`);
        await sleep(espera * 1000);
      }
    }
  }

  const erro = new Error(
    ultimoErro?.message || "falha desconhecida ao iniciar o WhatsApp",
  );
  erro.pediuQR = pediuQR;
  throw erro;
}

/** Orientação acionável quando a conexão não vem. */
function blocoComoResolver({ erro, pediuQR }) {
  const linhas = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║   ❌  NÃO FOI POSSÍVEL CONECTAR O WHATSAPP                    ║",
    "╚══════════════════════════════════════════════════════════════╝",
    `   Diagnóstico    : ${erro}`,
    `   Causa provável : ${
      pediuQR
        ? "a SESSÃO CAIU — é preciso escanear o QR Code de novo"
        : "falha ao carregar/injetar o WhatsApp Web (rede ou versão)"
    }`,
    "",
    "   O QUE FAZER:",
  ];
  if (pediuQR) {
    linhas.push(
      "   1. Rode `npm start` num terminal e escaneie o QR (WhatsApp > Dispositivos conectados).",
      "   2. Em servidor, veja o QR ao vivo: `journalctl -u affiliate-automation -f`.",
      "   3. Se o QR não vier ou expirar sempre: `npm run reset-sessao` e depois `npm start`.",
    );
  } else {
    linhas.push(
      "   1. Rode `npm start` de novo — falha de rede costuma ser passageira.",
      "   2. Cheque versão fixada e validade: `npm run doctor`.",
      "   3. Se falhar sempre: `npm run reset-sessao` e depois `npm start`.",
    );
  }
  console.log(linhas.join("\n") + "\n");
}

/* ============ Diagnóstico de mídia (DIAG_MIDIA=1) ============ */

/** JSON.stringify que nunca lança (log não pode derrubar o app). */
function descreverValor(valor) {
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

/**
 * Espelha console.log/warn/error em logs/app.log.
 *
 * POR QUE: rodando via nohup/pm2/systemd o terminal morre junto com o processo
 * e o histórico do que aconteceu com a mídia (body miniatura? download falhou?)
 * se perdia — foi o que escondeu este bug por dias.
 */
function espelharLogsEmArquivo() {
  const caminho = path.join(config.caminhos.root, "logs", "app.log");
  try {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    // appendFileSync (e nao createWriteStream): o app chama process.exit() em
    // varios caminhos e o buffer de um stream assincrono se perdia — o arquivo
    // de log simplesmente nao existia depois do exit.
    fs.appendFileSync(caminho, "── nova execução ──\n");
    for (const nivel of ["log", "warn", "error"]) {
      const original = console[nivel].bind(console);
      console[nivel] = (...args) => {
        original(...args);
        try {
          fs.appendFileSync(
            caminho,
            `${new Date().toISOString()} [${nivel}] ${args.map(descreverValor).join(" ")}\n`,
          );
        } catch {
          // log é acessório: nunca interrompe a execução
        }
      };
    }
    return caminho;
  } catch {
    return null;
  }
}

/**
 * Descreve um candidato de mídia SEM despejar base64 no log: bytes, dimensões
 * e formato. Aceita data-URL, base64 cru ou Buffer.
 */
function descreverMidia(rotulo, entrada) {
  if (entrada == null || entrada === "") return `${rotulo}=ausente`;
  if (!Buffer.isBuffer(entrada) && typeof entrada !== "string") {
    return `${rotulo}=objeto(${typeof entrada}) — não é base64`;
  }
  const texto = Buffer.isBuffer(entrada) ? entrada.toString("base64") : entrada;
  const bruto = texto.startsWith("data:") ? texto.slice(texto.indexOf(",") + 1) : texto;
  const kb = Math.round((bruto.length * 3) / 4 / 1024);
  const prefixo = texto.startsWith("data:")
    ? texto.slice(0, texto.indexOf(","))
    : "sem-prefixo";
  const dim = dimensoesImagem(texto);
  return dim
    ? `${rotulo}=${dim.largura}x${dim.altura} ${dim.formato} ${kb}KB (${prefixo})`
    : `${rotulo}=ILEGIVEL ${kb}KB (${prefixo})`;
}

/**
 * DIAG_MIDIA=1 — imprime o payload cru de uma mensagem com foto e mede as duas
 * vias possíveis (body e downloadMedia, direto e via re-hidratação) para provar
 * de onde vem a imagem que vai ao grupo. Só lê; nunca envia nada.
 */
async function relatarMidiaCrua(msg, chatId, client) {
  let midiaBody = null;
  let midiaBaixada = null;
  let midiaFresca = null;
  const linhas = [
    "",
    "🧪 ────── DIAG_MIDIA: mensagem com foto ──────",
    `   grupo        : ${chatId} (${msg.chat?.name || "?"})`,
    `   type/isMedia : ${msg.type} | ${msg.isMedia} | mimetype=${msg.mimetype || "-"}`,
    `   body         : ${typeof msg.body} (${typeof msg.body === "string" ? msg.body.length : 0} chars)`,
    `   ${descreverMidia("body", msg.body)}`,
    `   ${descreverMidia("preview", msg.mediaData?.preview)}`,
  ];

  const corpo = String(msg.body || "");
  if (corpo) {
    const classe = classificarMidia(corpo);
    // So guarda como midia se realmente for imagem (caption de texto nao conta).
    if (dimensoesImagem(corpo)) midiaBody = corpo;
    linhas.push(
      `   body x limite: ${classe.motivo} — miniatura=${classe.miniatura} (limite ${MIN_LADO_FOTO}px)`,
    );
  }

  const id = msg.id?._serialized || msg.messageId || msg.id;
  linhas.push(
    `   id           : ${typeof id === "string" && id ? id : "(AUSENTE — downloadMedia vai falhar)"}`,
  );

  if (typeof id === "string" && id && client) {
    try {
      midiaBaixada = await client.downloadMedia(id);
      linhas.push(`   download(id) : ${descreverMidia("baixado", midiaBaixada)}`);
    } catch (e) {
      linhas.push(`   download(id) : ERRO ${textoErro(e)}`);
    }
    try {
      const fresco = await client.getMessageById(id);
      linhas.push(`   getMsgById   : ${fresco ? "ok" : "null"}`);
      if (fresco) {
        try {
          midiaFresca = await client.downloadMedia(fresco);
          linhas.push(`   download(fresco): ${descreverMidia("baixado", midiaFresca)}`);
        } catch (e) {
          linhas.push(`   download(fresco): ERRO ${textoErro(e)}`);
        }
      }
    } catch (e) {
      linhas.push(`   getMsgById   : ERRO ${textoErro(e)}`);
    }
  }

  linhas.push("🧪 ───────────────────────────────────────────", "");
  console.log(linhas.join("\n"));
  return { id, body: midiaBody, baixado: midiaBaixada || midiaFresca };
}

async function iniciarWhatsApp() {
  const { client } = await conectarWhatsAppComRetry();

  // Utilitário: imprime os IDs dos grupos para mapear os @g.us no .env.
  // Tenta algumas vezes porque a lista só popula após a sincronização inicial.
  listarGruposComRetry(client);

  client.onMessage(async (msg) => {
    try {
      const chatId = msg.chatId || msg.from;
      if (!chatId.endsWith("@g.us")) return;
      // Ajuda na configuração: mostra o ID de qualquer grupo que receber mensagem
      console.log(
        `👀 Mensagem recebida no grupo: ${chatId} (${msg.chat?.name || "?"})`,
      );
      if (!config.whatsapp.gruposMonitorados.includes(chatId)) {
        console.log(
          "   ↷ Grupo NÃO monitorado — ignorando (adicione o ID no .env se quiser escutá-lo)",
        );
        return;
      }
      let texto = msg.caption || msg.body || "";
      // Segurança extra: nunca processar body que seja base64 de mídia
      if (/^(data:|[A-Za-z0-9+/]{500,}={0,2}$)/.test(texto) && msg.caption)
        texto = msg.caption;

      // Em mensagens com foto, msg.body contém o BASE64 da imagem e o texto
      // fica em msg.caption. Por isso caption tem prioridade — senão ofertas
      // com foto eram ignoradas por "não ter link".
      let imagemBase64 = null;
      /** Rastreia DE ONDE veio a foto da mensagem (vai para origem_foto no banco). */
      let origemFotoMidia = null;
      const temFoto =
        ["image", "sticker"].includes(msg.type) ||
        (msg.isMedia && msg.type !== "chat");
      if (temFoto) {
        const corpo = String(msg.body || "");

        // Modo diagnostico (DIAG_MIDIA=1): imprime o payload cru da mensagem
        // (body/preview/downloadMedia, com dimensoes e KB) antes de decidir.
        if (config.whatsapp.diagMidia) {
          await relatarMidiaCrua(msg, chatId, client);
        }

        // 1) msg.body: pode ser data-URL completa OU base64 cru (varia por
        //    versão do wppconnect). Sem prefixo, assume o mimetype da msg.
        //
        //    ARMADILHA (bug corrigido aqui): em mensagem com foto o body
        //    normalmente traz só o `jpegThumbnail` do WhatsApp — 72x72 e
        //    1,5-2,5 KB. Aceitar o body sem medir publicava quadrado borrado e
        //    nunca tentava o downloadMedia (que tem a foto em resolução cheia).
        const candidatoBody = /^data:image\//i.test(corpo)
          ? corpo
          : /^[A-Za-z0-9+/]{500,}={0,2}$/.test(corpo)
            ? `data:${msg.mimetype || "image/jpeg"};base64,${corpo}`
            : null;

        if (candidatoBody) {
          const v = validarImagemBase64(candidatoBody);
          const classe = classificarMidia(candidatoBody);
          if (!v.valido) {
            console.log(
              `   ↷ msg.body descartado (${v.motivo}) — tentando downloadMedia.`,
            );
          } else if (classe.miniatura) {
            console.log(
              `   🔬 msg.body é MINIATURA (${classe.motivo} < ${MIN_LADO_FOTO}px, ${v.kb} KB) — ignorando e baixando a foto real.`,
            );
          } else {
            imagemBase64 = candidatoBody;
            origemFotoMidia = "mensagem:body";
            console.log(
              `   🖼️  Foto via msg.body (${classe.motivo}, ${v.kb} KB, ${classe.formato}).`,
            );
          }
        }

        // 2) downloadMedia é o caminho de MAIOR qualidade (foto em resolução
        //    cheia). É aqui que a foto que o grupo recebe de verdade é obtida.
        if (!imagemBase64) {
          const candidatos = [
            typeof msg.id === "string" && msg.id ? msg.id : null,
            msg.id?._serialized || null,
            msg.messageId || null,
            msg.quotedMsgId || null,
            msg.id || null,
          ].filter(Boolean);
          let dl = { base64: null };
          for (const cid of candidatos) {
            const rotulo = typeof cid === "string" ? cid.slice(-20) : "msg-obj";
            dl = await baixarMidiaComRetry(
              client,
              cid,
              `whatsapp:${chatId}:${rotulo}`,
            );
            if (dl.base64) break;
          }

          // 2b) Re-hidratação: no backlog/SYNCING e em mensagem recém-chegada o
          //     wppconnect responde "no media found for message id". Buscar a
          //     mensagem de novo na store faz o download passar.
          if (!dl.base64 && typeof client.getMessageById === "function") {
            const idParaBusca = msg.id?._serialized || msg.messageId || msg.id;
            if (idParaBusca) {
              try {
                const fresco = await client.getMessageById(idParaBusca);
                if (fresco) {
                  const base64 = await client.downloadMedia(fresco);
                  const v = validarImagemBase64(String(base64 || ""));
                  if (v.valido) {
                    console.log(
                      `   🔄 Foto recuperada por re-hidratação da mensagem (${v.kb} KB).`,
                    );
                    dl = { base64: String(base64), tentativas: 1 };
                  }
                }
              } catch (e) {
                console.warn(`   Re-hidratação falhou: ${textoErro(e)}`);
              }
            }
          }

          if (dl.base64) {
            // Nunca publicar miniatura achando que é a foto (defesa em
            // profundidade: vale tanto para o download quanto para o body).
            const classe = classificarMidia(dl.base64);
            if (classe.miniatura) {
              console.warn(
                `   🔬 downloadMedia devolveu MINIATURA (${classe.motivo}) — descartando e usando fallback.`,
              );
            } else {
              imagemBase64 = dl.base64;
              origemFotoMidia = "mensagem:download";
              console.log(`   🖼️  Foto baixada da mensagem (${classe.motivo}).`);
            }
          }
        }

        // 3) mediaData.preview = ÚLTIMO recurso. ATENÇÃO: o wppconnect 2.3.3
        //    declara MediaData SEM o campo `preview` (media-data/message.d.ts),
        //    então na prática este ramo é código morto — o `String(objeto)`
        //    antigo virava "[object Object]" e era rejeitado. Fica como rede de
        //    segurança caso a lib volte a expor a thumb (só aceita string).
        if (
          !imagemBase64 &&
          typeof msg.mediaData?.preview === "string" &&
          msg.mediaData.preview
        ) {
          try {
            const prev = msg.mediaData.preview;
            const cand = /^data:/i.test(prev)
              ? prev
              : `data:${msg.mimetype || "image/jpeg"};base64,${prev}`;
            const v = validarImagemBase64(cand);
            if (v.valido) {
              const classe = classificarMidia(cand);
              imagemBase64 = cand;
              origemFotoMidia = classe.miniatura
                ? "mensagem:miniatura"
                : "mensagem:preview";
              console.log(
                `   🖼️  Foto via mediaData.preview (${classe.motivo}, ${v.kb} KB) — último recurso.`,
              );
            }
          } catch {
            /* segue sem imagem */
          }
        }

        if (!imagemBase64) {
          console.warn(
            "   ⚠️  Foto da mensagem indisponível (body miniatura/inválido e download falhou) — fallback do site será usado." +
              ` [type=${msg.type}, isMedia=${msg.isMedia}, mimetype=${msg.mimetype}]`,
          );
        }
      } else if (typeof msg.mimetype === "string" && /^image\//i.test(msg.mimetype)) {
        // imagem que não passou em temFoto: sem este aviso o caso cairia no
        // og:image do site em silêncio (foi assim que o sintoma ficou invisível).
        console.log(
          `   🔎 Mimetype de imagem (${msg.mimetype}) mas temFoto=false — usando fallback do site.`,
        );
      }

      await processarOferta(
        texto,
        `whatsapp:${chatId}`,
        client,
        imagemBase64,
        origemFotoMidia,
      );
    } catch (erro) {
      console.error(`❌ Erro no listener do WhatsApp: ${erro.message}`);
    }
  });

  console.log("✅ WhatsApp conectado.");
  return client;
}

/* ================= Telegram (gramjs) ================= */

async function iniciarTelegram(wppClient) {
  const { apiId, apiHash, session, canaisMonitorados } = config.telegram;
  if (!apiId || !apiHash) {
    console.warn(
      "⚠️  Telegram não configurado (falta TELEGRAM_API_ID/TELEGRAM_API_HASH). Escuta do Telegram desativada.",
    );
    return null;
  }
  // Sem sessão salva o gramjs pede telefone/código no terminal. Sob nohup/pm2
  // não existe entrada interativa — avisa e segue apenas com o WhatsApp.
  if (!session && !process.stdin.isTTY) {
    console.warn(
      "⚠️  Telegram: TELEGRAM_SESSION_STRING ausente e a entrada não é interativa (nohup/pm2).",
    );
    console.warn(
      "    Rode `npm start` uma vez no terminal para autenticar e salvar a sessão.",
    );
    console.warn("    Escuta do Telegram desativada nesta execução.");
    return null;
  }

  const client = new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
    },
  );

  await client.start({
    phoneNumber: () => perguntar("Número de telefone (Telegram): "),
    password: () => perguntar("Senha 2FA (vazio se não houver): "),
    phoneCode: () => perguntar("Código recebido no Telegram: "),
    onError: (err) => console.error("Telegram auth error:", err.message),
  });

  if (!session) {
    console.log("\n🔐 SALVE ISTO NO .env (TELEGRAM_SESSION_STRING):");
    console.log(client.session.save(), "\n");
  }

  const canais = canaisMonitorados.map((c) =>
    c.replace(/^@/, "").toLowerCase(),
  );

  client.addEventHandler(async (evento) => {
    try {
      const msg = evento.message;
      if (!msg?.message) return;
      const chat = await msg.getChat();
      const username = (chat?.username || "").toLowerCase();
      if (canais.length && !canais.includes(username)) return;

      // Baixa a foto da mensagem do Telegram (se houver) para republicar no WhatsApp
      let imagemBase64 = null;
      const midiaFoto =
        msg.photo ||
        (msg.media && msg.media.className === "MessageMediaPhoto"
          ? msg.media
          : null) ||
        (msg.media?.photo ? msg.media : null) || // MessageMediaWebPage com foto de capa
        null;
      if (midiaFoto) {
        for (let t = 1; t <= 3 && !imagemBase64; t++) {
          try {
            const buffer = await client.downloadMedia(msg.media || msg, {});
            if (buffer) {
              const cand = `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
              const v = validarImagemBase64(cand);
              if (v.valido) {
                imagemBase64 = cand;
                console.log(
                  `   🖼️  Foto do Telegram baixada (tentativa ${t}/3, ${v.kb} KB)`,
                );
              } else {
                console.warn(
                  `   ⚠️  Foto do Telegram invalida (${v.motivo}) — tentando de novo...`,
                );
              }
            } else {
              console.warn(
                `   ⚠️  Telegram: download vazio (tentativa ${t}/3).`,
              );
            }
          } catch (e) {
            console.warn(
              `   ⚠️  Telegram: download falhou (tentativa ${t}/3): ${textoErro(e)}`,
            );
          }
          if (!imagemBase64 && t < 3)
            await new Promise((r) => setTimeout(r, 2000 * t));
        }
      }

      await processarOferta(
        msg.message,
        `telegram:@${username}`,
        wppClient,
        imagemBase64,
      );
    } catch (erro) {
      console.error(`❌ Erro no listener do Telegram: ${erro.message}`);
    }
  }, new NewMessage({}));

  console.log("✅ Telegram conectado.");
  return client;
}

function perguntar(pergunta) {
  // Sem terminal interativo não há como responder: evita travar o processo.
  if (!process.stdin.isTTY) return Promise.resolve("");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    }),
  );
}

/* ================= Doctor ================= */

/** Heurística: o leveldb do perfil guarda a credencial de login (last-wid). */
function sessaoPareceLogada() {
  const dir = path.join(PERFIL_CHROME, "Default", "Local Storage", "leveldb");
  try {
    for (const nome of fs.readdirSync(dir)) {
      try {
        if (fs.readFileSync(path.join(dir, nome)).includes("last-wid"))
          return true;
      } catch {
        // arquivo de lock/temp do leveldb: ignora
      }
    }
  } catch {
    // sem leveldb: perfil recém-criado
  }
  return false;
}

/**
 * Diagnóstico de ambiente e infraestrutura. Não envia nada, não abre o
 * WhatsApp e não exige .env completo.
 * Uso: npm run doctor  (== node src/app.js --doctor)
 */
async function executarDoctor() {
  const ok = (m) => console.log(`✅ ${m}`);
  const aviso = (m) => console.log(`⚠️  ${m}`);
  const falha = (m) => console.log(`❌ ${m}`);
  let problemas = 0;
  const linha = () => console.log("");

  console.log("\n🔍 DIAGNÓSTICO — Affiliate Automation\n");

  if (process.stdin.isTTY) ok("terminal interativo (QR visível)");
  else
    aviso(
      "sem terminal interativo: o QR só é visível via `journalctl -u affiliate-automation -f` (systemd) ou log do container",
    );

  linha();
  const [major] = process.versions.node.split(".").map(Number);
  if (major >= 18)
    ok(`Node v${process.versions.node} (${process.arch}/${process.platform})`);
  else {
    problemas++;
    falha(`Node v${process.versions.node} — o projeto precisa de Node 18+`);
  }
  if (process.arch === "arm64") {
    aviso(
      "arm64 (Oracle Ampere A1): use o Chromium do sistema — apt install chromium",
    );
  }
  const totalGb = os.totalmem() / 1024 ** 3;
  ok(`RAM total: ${totalGb.toFixed(1)} GB`);
  if (totalGb < 3)
    aviso(
      "menos de 3 GB: o Chrome sozinho consome ~0.5-1 GB na sincronização inicial",
    );

  linha();
  console.log(`🕒 Fuso de operação: ${config.operacao.tz}`);
  console.log(
    `   Agora no servidor (UTC)      : ${new Date().toISOString().slice(11, 19)}`,
  );
  console.log(`   Hora no fuso de operação     : ${horaOperacional()}h`);
  console.log(
    `   Virada do dia (anti-ban)     : ${inicioDoDiaOperacional().slice(11)} UTC`,
  );
  if (new Date().getHours() === horaOperacional())
    ok("o fuso do processo é o de operação");
  else
    aviso(
      `o relógio do host está em outro fuso — o app usa ${config.operacao.tz} (${horaOperacional()}h)`,
    );

  linha();
  const chrome = detectarChrome();
  if (chrome) ok(`Navegador: ${chrome.caminho} — ${chrome.versao}`);
  else {
    problemas++;
    falha(
      "nenhum Chrome/Chromium do sistema — no Debian/Ubuntu: apt install chromium",
    );
  }

  linha();
  const catalogo = catalogoWaVersion();
  if (!catalogo) {
    aviso(
      '@wppconnect/wa-version indisponível — a versão do WhatsApp Web ficaria "live" (instável)',
    );
  } else {
    try {
      const info = catalogo.getVersionInfo();
      ok(`WhatsApp Web (catálogo local): ${info.version}`);
      const dias = (new Date(info.expire) - new Date()) / 86400000;
      if (Number.isFinite(dias) && dias < 15) {
        aviso(
          `essa versão expira em ${Math.max(0, Math.round(dias))}d — rode npm update @wppconnect/wa-version`,
        );
      } else ok(`validade da versão: ${String(info.expire).slice(0, 10)}`);
    } catch (e) {
      aviso(`catálogo de versões sem resposta: ${e.message}`);
    }
  }

  linha();
  if (!fs.existsSync(PERFIL_CHROME)) {
    aviso("sem perfil do Chrome ainda — na 1ª execução será pedido o QR Code");
  } else {
    ok(`perfil do Chrome: ${PERFIL_CHROME}`);
    if (sessaoPareceLogada())
      ok("o perfil contém credenciais de login (last-wid)");
    else aviso("sem credenciais de login no perfil — deve pedir QR Code");
    const lock = donoDoLock();
    if (!lock) ok("nenhum lock pendente no perfil");
    else if (pidVivo(lock.pid)) ok(`lock ativo e válido (pid ${lock.pid})`);
    else aviso("lock órfão no perfil — o boot remove automaticamente");
    const orfaos = chromesDoPerfil();
    if (orfaos.length)
      aviso(
        `Chrome pendurado no perfil: pid ${orfaos.map((o) => o.pid).join(", ")}`,
      );
    else ok("nenhum Chrome pendurado no perfil");
  }

  linha();
  for (const [nome, dir] of [
    ["data", DATA_DIR],
    ["tokens", TOKENS_DIR],
  ]) {
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      ok(`${nome}/ gravável: ${dir}`);
    } catch {
      problemas++;
      falha(`${nome}/ SEM permissão de escrita: ${dir}`);
    }
  }

  linha();
  try {
    ok(
      `banco OK — enviadas hoje (fuso ${config.operacao.tz}): ${contarEnviosHoje()}`,
    );
    ok(`fila pendente: ${listarFilaDb().length}`);
  } catch (e) {
    problemas++;
    falha(`banco: ${e.message}`);
  }

  linha();
  try {
    const resposta = await fetch("https://web.whatsapp.com", {
      signal: AbortSignal.timeout(15000),
    });
    if (resposta.ok) ok("rede OK — web.whatsapp.com respondeu");
    else aviso(`web.whatsapp.com respondeu HTTP ${resposta.status}`);
  } catch (e) {
    problemas++;
    falha(`sem acesso a web.whatsapp.com: ${e.message}`);
  }

  linha();
  const faltamTelegram = [
    !config.telegram.apiId && "TELEGRAM_API_ID",
    !config.telegram.apiHash && "TELEGRAM_API_HASH",
    !config.telegram.session && "TELEGRAM_SESSION_STRING",
  ].filter(Boolean);
  if (faltamTelegram.length)
    aviso(
      `Telegram sem ${faltamTelegram.join(", ")} — a escuta do Telegram fica desativada`,
    );
  else ok("Telegram configurado");
  const lojas = resumoLojas();
  const ativas = lojas.filter((l) => l.ativa);
  const inativas = lojas.filter((l) => !l.ativa);
  ok(
    `lojas ativas: ${ativas.length ? ativas.map((l) => l.loja).join(", ") : "nenhuma"}`,
  );
  for (const { loja, faltantes } of inativas) {
    aviso(
      `loja ${loja} sem credencial (${faltantes.join(", ")}): ofertas ignoradas`,
    );
  }

  linha();
  if (problemas === 0) {
    console.log("🟢 Ambiente OK — pode rodar `npm start`.\n");
    return 0;
  }
  console.log(
    `🔴 ${problemas} problema(s) acima impedem o boot — corrija e rode de novo.\n`,
  );
  return 1;
}

/* ================= Bootstrap ================= */

/**
 * Painel de boot: mostra o que já está operante e LEMBRA quais credenciais
 * ainda faltam no .env — lojas sem credencial têm as ofertas ignoradas.
 */
function painelLojas() {
  const lojas = resumoLojas();
  const ativas = lojas.filter((l) => l.ativa);
  const inativas = lojas.filter((l) => !l.ativa);
  console.log(
    `🏬 Lojas ATIVAS: ${ativas.length ? ativas.map((l) => l.loja).join(", ") : "nenhuma"}`,
  );
  if (inativas.length) {
    console.log("⏳ FALTAM CREDENCIAIS (ofertas dessas lojas são ignoradas):");
    for (const { loja, faltantes } of inativas) {
      console.log(`      • ${loja} → ${faltantes.join(", ")}`);
    }
    console.log(
      "   → Preencha no .env e reinicie: a loja liga sozinha, sem mexer no código.",
    );
  }
  console.log("");
}

/**
 * Deriva o nome de arquivo do mime REAL do data-URL.
 * Evita mandar WebP/PNG/GIF para o wppconnect como ".jpg" — o filename é
 * usado por algumas versões para derivar o mimetype e pode causar falha
 * ou envio com Content-Type errado.
 */
function nomeArquivoDeMime(dataUrl) {
  const mime =
    /data:(image\/[a-z0-9+.-]+)/i.exec(String(dataUrl))?.[1] || "image/jpeg";
  if (/png/i.test(mime)) return "produto.png";
  if (/webp/i.test(mime)) return "produto.webp";
  if (/gif/i.test(mime)) return "produto.gif";
  if (/avif/i.test(mime)) return "produto.avif";
  return "produto.jpg";
}

async function main() {
  // Espelha tudo em logs/app.log ANTES de qualquer log de boot (nohup/pm2
  // perdem o terminal e com ele o histórico do diagnóstico).
  const arquivoLog = espelharLogsEmArquivo();
  console.log("🚀 Iniciando Affiliate Automation...\n");
  if (arquivoLog) console.log(`🗒️  Logs em ${arquivoLog}`);
  painelLojas();
  if (config.whatsapp.diagMidia) {
    console.warn(
      "🧪 DIAG_MIDIA=1 LIGADO — modo diagnóstico de mídia:\n" +
        "   • o app conecta, escuta e imprime o payload cru de cada foto;\n" +
        "   • a fila NÃO envia nada (nada é publicado no grupo);\n" +
        "   • desligue (DIAG_MIDIA= remover do .env) para voltar a publicar.\n",
    );
  }
  if (!config.whatsapp.meuGrupo) {
    console.warn("⚠️  MEU_GRUPO_WHATSAPP não está definido no .env!");
  }

  // Fila de envio: TODA oferta sai com foto (nunca texto puro).
  // sendImageFromBase64 e o correto para data-URL (sendImage so aceita
  // caminho/URL http — era a causa dos "falhou (undefined)").
  filaEnvio = new SendQueue(
    async ({
      mensagemFinal,
      urlLimpa,
      chaveFinal,
      wppClient,
      imagemBase64,
      origemFoto,
      meuLink,
      loja,
    }) => {
      // Garantia final: se algo chegou sem imagem (fila antiga), usa placeholder.
      if (!imagemBase64 || !validarImagemBase64(String(imagemBase64)).valido) {
        const ph = placeholderPara(loja);
        imagemBase64 = ph.base64;
        origemFoto = ph.origem;
        console.log(
          `   🖼️  Placeholder [${loja || "?"}] aplicado no envio — oferta mantida com foto.`,
        );
      }
      const legenda = legendaParaFoto(mensagemFinal, meuLink || urlLimpa);
      if (legenda.length < String(mensagemFinal || "").length) {
        console.log(
          `   ✂️  Legenda truncada para ${legenda.length} chars (limite de caption do WhatsApp).`,
        );
      }
      // Envia a foto do produto com a oferta na legenda.
      // Fallback: base64 direto -> arquivo temporario. Sem sendText puro.
      try {
        await wppClient.sendImageFromBase64(
          config.whatsapp.meuGrupo,
          String(imagemBase64),
          nomeArquivoDeMime(imagemBase64),
          legenda,
        );
        console.log(
          `   🖼️  Imagem enviada via base64 (origem: ${origemFoto || "desconhecida"}).`,
        );
      } catch (erroBase64) {
        console.warn(
          `   ⚠️  sendImageFromBase64 falhou (${textoErro(erroBase64)}) — tentando via arquivo...`,
        );
        const dataUrl = String(imagemBase64);
        const virgula = dataUrl.indexOf(",");
        const cabecalho = virgula >= 0 ? dataUrl.slice(0, virgula) : "";
        const dados = virgula >= 0 ? dataUrl.slice(virgula + 1) : "";
        if (!dados) throw new Error("imagem sem payload base64 apos a virgula");
        const mime =
          /data:(.*?)(;base64)?$/i.exec(cabecalho)?.[1] || "image/jpeg";
        const ext = mime.includes("png")
          ? ".png"
          : mime.includes("webp")
            ? ".webp"
            : mime.includes("gif")
              ? ".gif"
              : ".jpg";
        const tmp = path.join(os.tmpdir(), `oferta-${Date.now()}${ext}`);
        fs.writeFileSync(tmp, Buffer.from(dados, "base64"));
        try {
          await wppClient.sendImage(
            config.whatsapp.meuGrupo,
            tmp,
            `produto${ext}`,
            legenda,
          );
          console.log(
            `   🖼️  Imagem enviada via arquivo (origem: ${origemFoto || "desconhecida"}).`,
          );
        } finally {
          fs.unlink(tmp, () => {});
        }
      }
      // Só o registro principal conta para o limite diário; a chave do produto
      // entra apenas na deduplicação (antes a mesma oferta contava 2x e o
      // MAX_ENVIOS_DIA valia pela metade).
      registrarEnvio(urlLimpa, true);
      if (chaveFinal && chaveFinal !== urlLimpa)
        registrarEnvio(chaveFinal, false);
      console.log("   ✅ Enviada e registrada.");
    },
  );

  try {
    wppClientGlobal = await iniciarWhatsApp();
  } catch (erro) {
    blocoComoResolver({ erro: erro.message, pediuQR: !!erro.pediuQR });
    limparRestosChrome();
    process.exit(1);
  }
  const wppClient = wppClientGlobal;
  await iniciarTelegram(wppClient);
  console.log("\n🎯 Sistema ativo. Monitorando ofertas...\n");

  // Retoma envios que ficaram pendentes de execucoes anteriores
  filaEnvio.restaurarPendentes({ wppClient });
}

/** Encerramento limpo: fecha o cliente, mata o Chrome e limpa locks órfãos. */
function encerrar(motivo, codigo = 0) {
  console.log(`
🛑 Encerrando (${motivo})...`);
  try {
    wppClientGlobal?.close?.();
  } catch {
    // cliente já morto
  }
  limparRestosChrome();
  setTimeout(() => process.exit(codigo), 1500).unref();
}

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => encerrar(sinal));
}
process.on("uncaughtException", (erro) => {
  console.error(`💥 Exceção não tratada: ${erro?.message || erro}`);
  limparRestosChrome();
  process.exit(1);
});
process.on("unhandledRejection", (erro) => {
  console.warn(
    `⚠️  Promise rejeitada sem tratamento: ${erro?.message || erro}`,
  );
});

/* ================= Probe de mídia: npm run diag:midia ================= */

/** Extensão de arquivo a partir do formato detectado (para salvar as amostras). */
function extensaoDeFormato(formato) {
  if (formato === 'png') return 'png';
  if (formato === 'gif') return 'gif';
  if (formato === 'webp') return 'webp';
  if (formato === 'jpeg') return 'jpg';
  return 'bin';
}

/** Outro `src/app.js` já rodando? O perfil do Chrome é exclusivo (um por vez). */
function outraInstanciaRodando() {
  try {
    const saida = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 10000 });
    return saida
      .split('\n')
      .filter((linha) => linha.includes('src/app.js') && !linha.includes('--diag-midia'))
      .map((linha) => linha.trim().split(/\s+/)[0])
      .filter((pid) => Number(pid) && Number(pid) !== process.pid);
  } catch {
    return [];
  }
}

/**
 * `npm run diag:midia` — abre o WhatsApp APENAS PARA MEDIR as fotos recebidas.
 *
 * Percorre as últimas mensagens dos grupos monitorados, imprime o payload cru
 * de cada foto (body x downloadMedia, com dimensões) e salva os bytes em
 * data/diagnostico/ para inspeção visual. NUNCA envia nada.
 *
 * É o caminho para medir fotos ANTIGAS (a instrumentação DIAG_MIDIA=1 do
 * `npm start` só vê as mensagens que chegam enquanto o app está rodando).
 */
async function executarDiagnosticoMidia() {
  const arquivoLog = espelharLogsEmArquivo();
  const argLimite = process.argv.find((a) => a.startsWith('--limite='));
  const limite = Math.max(
    1,
    parseInt(argLimite?.split('=')[1] || process.env.DIAG_MIDIA_LIMITE || '10', 10),
  );

  console.log('🔬 diag:midia — medindo as fotos já recebidas (nada é enviado)');
  if (arquivoLog) console.log(`🗒️  Logs em ${arquivoLog}`);

  const conflito = outraInstanciaRodando();
  if (conflito.length) {
    console.error(
      `⛔ Há outra instância do app rodando (pid ${conflito.join(', ')}) e o perfil do\n` +
        '   Chrome é exclusivo. Pare o app (Ctrl+C / pm2 stop) e rode de novo.',
    );
    return 1;
  }

  const grupos = config.whatsapp.gruposMonitorados;
  if (!grupos.length) {
    console.error(
      '⛔ GRUPOS_WHATSAPP_MONITORADOS está vazio no .env — não sei qual histórico varrer.\n' +
        '   Rode `npm start` e mande uma mensagem no grupo: o ID (@g.us) aparece no log.',
    );
    return 1;
  }

  const pastaSaida = path.join(config.caminhos.data, 'diagnostico');
  fs.mkdirSync(pastaSaida, { recursive: true });

  let client = null;
  let miniaturas = 0;
  let fotos = 0;
  let semMidia = 0;
  try {
    client = await criarClienteWhatsApp({
      autoCloseMs: process.stdin.isTTY ? config.whatsapp.timeoutQrMs : 60000,
      pediuQR: false,
    });
    console.log(`✅ Conectado. Varrendo as últimas ${limite} mensagens de cada grupo...\n`);

    for (const chatId of grupos) {
      let mensagens = [];
      try {
        mensagens = await client.getMessages(chatId, { count: limite });
      } catch (e) {
        console.warn(`   ⚠️  Não consegui ler ${chatId}: ${textoErro(e)}`);
        continue;
      }
      const comFoto = mensagens.filter(
        (m) =>
          ['image', 'sticker'].includes(m.type) ||
          (m.isMedia && /^image\//i.test(String(m.mimetype || ''))),
      );
      console.log(
        `📂 ${chatId}: ${mensagens.length} mensagem(ns), ${comFoto.length} com foto`,
      );

      for (const msg of comFoto) {
        const r = await relatarMidiaCrua(msg, chatId, client);
        const bytes = r.baixado || r.body;
        if (!bytes) {
          semMidia++;
          continue;
        }
        const classe = classificarMidia(bytes);
        if (classe.miniatura) miniaturas++;
        else fotos++;
        const destino = path.join(
          pastaSaida,
          `amostra-${Date.now()}-${chatId.slice(0, 6)}-${classe.motivo}.${extensaoDeFormato(classe.formato)}`,
        );
        fs.writeFileSync(destino, Buffer.from(bytes.slice(bytes.indexOf(',') + 1), 'base64'));
        console.log(`   💾 ${destino}`);
      }
    }

    console.log(
      '\n🔬 RESUMO do histórico varrido:\n' +
        `   fotos de verdade : ${fotos}\n` +
        `   MINIATURAS       : ${miniaturas}${
          miniaturas ? '  ← o downloadMedia na store TEM a foto; o bug é a cascata aceitar o body' : ''
        }\n` +
        `   sem mídia nenhuma: ${semMidia}\n` +
        `   amostras salvas  : ${pastaSaida}/\n`,
    );
    return 0;
  } catch (e) {
    console.error(`💥 diag:midia falhou: ${textoErro(e)}`);
    return 1;
  } finally {
    try {
      await client?.close?.();
    } catch {
      // cliente já morto
    }
    limparRestosChrome();
  }
}

if (process.argv.includes("--diag-midia")) {
  // npm run diag:midia — mede as fotos do histórico sem enviar nada
  executarDiagnosticoMidia()
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      console.error(`💥 diag:midia falhou: ${erro?.message || erro}`);
      process.exit(1);
    });
} else if (process.argv.includes("--doctor")) {
  // npm run doctor — diagnóstico sem abrir o WhatsApp
  executarDoctor()
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      console.error(`💥 Doctor falhou: ${erro.message}`);
      process.exit(1);
    });
} else {
  main().catch((erro) => {
    console.error(`💥 Falha fatal na inicialização: ${erro.message}`);
    limparRestosChrome();
    process.exit(1);
  });
}
