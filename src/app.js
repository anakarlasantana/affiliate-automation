/**
 * app.js — Orquestrador Principal
 *
 * Pipeline: mensagem -> extrair link -> expandir -> sanitizar
 *   -> deduplicar (SQLite) -> converter p/ afiliado -> remontar texto
 *   -> delay anti-ban (5-15s) -> enviar ao meu grupo WhatsApp -> registrar.
 */
import readline from 'node:readline';
import wppconnect from '@wppconnect-team/wppconnect';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

import config from './config.js';
import { jaFoiEnviada, registrarEnvio } from './database.js';
import { expandirLink, sanitizarUrl, extrairPrimeiroLink, desembrulharVerificacaoMeli } from './linkResolver.js';
import { converterParaAfiliado } from './affiliates/index.js';
import { SendQueue } from './sendQueue.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Fila global de envios (ritmo anti-ban por horário) */
let filaEnvio = null;

/* ================= Pipeline de ofertas ================= */

async function processarOferta(textoOriginal, origem, wppClient, imagemBase64 = null) {
  try {
    const linkCru = extrairPrimeiroLink(textoOriginal);
    if (!linkCru) {
      console.log(`   ↷ [${origem}] Sem link na mensagem (texto: "${(textoOriginal || '').slice(0, 60)}...") — ignorando.`);
      return;
    }

    console.log(`\n🔗 [${origem}] Link capturado: ${linkCru}`);

    const urlExpandida = desembrulharVerificacaoMeli(await expandirLink(linkCru));
    const urlLimpa = sanitizarUrl(urlExpandida);
    console.log(`   ↳ URL limpa: ${urlLimpa}`);

    if (jaFoiEnviada(urlLimpa)) {
      console.log('   ↳ Duplicada — ignorada.');
      return;
    }

    const { meuLink, loja } = await converterParaAfiliado(urlLimpa, urlExpandida);
    if (!meuLink) {
      console.log('   ↷ Conversão falhou ou credencial ausente — ignorando.');
      return;
    }
    if (loja === 'sem-provider' || loja === 'desconhecida') {
      console.log(`   ↷ Loja sem afiliação configurada (${new URL(urlLimpa).hostname}) — ignorando.`);
      return;
    }
    console.log(`   ↳ [${loja}] Meu link: ${meuLink}`);

    // Deduplica tambem pelo link final (sem query): o mesmo produto pode
    // chegar por links/encurtadores diferentes.
    let chaveFinal = meuLink;
    try {
      const u = new URL(meuLink);
      u.search = '';
      u.hash = '';
      chaveFinal = u.toString();
    } catch {}
    if (chaveFinal !== urlLimpa && jaFoiEnviada(chaveFinal)) {
      console.log('   ↳ Produto ja divulgado (mesmo item, link diferente) - ignorada.');
      return;
    }

    // Texto original intacto; só o link é substituído
    let mensagemFinal = textoOriginal.replace(linkCru, meuLink);

    // Remove QUALQUER outro link da mensagem (linktr.ee, convites de grupo,
    // cupons com link etc.) — so o seu link de afiliado permanece.
    const outrosLinks = mensagemFinal.match(/https?:\/\/[^\s<>()"'`]+/gi) || [];
    for (const outro of outrosLinks) {
      if (outro !== meuLink) {
        mensagemFinal = mensagemFinal.replace(outro, '');
        console.log('   🚫 Link estranho removido: ' + outro.slice(0, 70));
      }
    }
    // Remove linhas promocionais de outros grupos/canais (fica so a oferta:
    // descricao do produto, preco, cupom e forma de pagamento).
    const PADRAO_PROMO = /grupo|canal|compartilh|particip|entre no|entrem|vagas|telegram|whats|linktr|siga|segue|divulg|ajud|indique|convite/i;
    const linhasOriginais = mensagemFinal.split(/\n/);
    const linhasMantidas = [];
    for (const linha of linhasOriginais) {
      if (linha.includes(meuLink)) { linhasMantidas.push(linha); continue; } // nunca remove o seu link
      if (PADRAO_PROMO.test(linha)) {
        if (linha.trim()) console.log('   🧹 Linha promocional removida: ' + linha.trim().slice(0, 60));
        continue;
      }
      linhasMantidas.push(linha);
    }
    mensagemFinal = linhasMantidas.join('\n');

    // Limpa linhas que ficaram vazias apos a remocao
    mensagemFinal = mensagemFinal.replace(/\n{3,}/g, '\n\n').trim();

    // Rodape com o link do SEU grupo (substitui a divulgacao removida)
    if (config.whatsapp.meuGrupoLink) {
      mensagemFinal += '\n\n📢 Entre no nosso grupo de ofertas:\n' + config.whatsapp.meuGrupoLink;
    }

    // Entra na fila anti-ban (envio sequencial, delay dinâmico por horário)
    const primeiraLinha = (mensagemFinal.split('\n').find((l) => l.trim()) || '').trim();
    filaEnvio.enqueue({
      mensagemFinal,
      urlLimpa,
      chaveFinal,
      wppClient,
      imagemBase64,
      loja: afiliado ? afiliado.loja.nome : 'desconhecida',
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
async function listarGruposComRetry(client, tentativas = 10, intervaloMs = 5000) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      // força atualização da lista de chats
      await client.listChats().catch(() => {});
      const chats = await client.listChats({ onlyGroups: true });
      if (chats && chats.length) {
        console.log('\n==================================================');
        console.log('📋 GRUPOS DO WHATSAPP (copie os IDs para o .env):');
        console.log('==================================================');
        for (const chat of chats) {
          console.log(`   ${chat.id?._serialized || chat.id} -> ${chat.name || '(sem nome)'}`);
        }
        console.log('==================================================\n');
        return;
      }
      console.log(`⏳ [${i}/${tentativas}] Aguardando sincronização dos grupos...`);
    } catch (erro) {
      console.warn(`⚠️  [${i}/${tentativas}] Falha ao listar grupos: ${erro.message}`);
    }
    await sleep(intervaloMs);
  }
  console.warn('⚠️  Não foi possível listar os grupos. Mande uma mensagem em qualquer grupo e rode de novo.');
}

async function iniciarWhatsApp() {
  const client = await wppconnect.create({
    session: 'affiliate-automation',
    headless: true,
    useChrome: true,
    logQR: true,
  });

  // Utilitário: imprime os IDs dos grupos para mapear os @g.us no .env.
  // Tenta algumas vezes porque a lista só popula após a sincronização inicial.
  listarGruposComRetry(client);

  client.onMessage(async (msg) => {
    try {
      const chatId = msg.chatId || msg.from;
      if (!chatId.endsWith('@g.us')) return;
      // Ajuda na configuração: mostra o ID de qualquer grupo que receber mensagem
      console.log(`👀 Mensagem recebida no grupo: ${chatId} (${msg.chat?.name || '?'})`);
      if (!config.whatsapp.gruposMonitorados.includes(chatId)) {
        console.log('   ↷ Grupo NÃO monitorado — ignorando (adicione o ID no .env se quiser escutá-lo)');
        return;
      }
      // Em mensagens com foto, msg.body contém o BASE64 da imagem e o texto
      // fica em msg.caption. Por isso caption tem prioridade — senão ofertas
      // com foto eram ignoradas por "não ter link".
      let texto = msg.caption || msg.body || '';
      // Segurança extra: nunca processar body que seja base64 de mídia
      if (/^(data:|[A-Za-z0-9+/]{500,}={0,2}$)/.test(texto) && msg.caption) texto = msg.caption;

      // Baixa a foto da mensagem (se houver) para republicar junto com o link
      let imagemBase64 = null;
      const temFoto = ['image', 'sticker'].includes(msg.type) || (msg.isMedia && msg.type !== 'chat');
      if (temFoto) {
        // msg.id pode vir ausente/objeto dependendo da versão do wppconnect
        const msgId =
          typeof msg.id === 'string' && msg.id ? msg.id : msg.id?._serialized || msg.messageId || null;
        if (!msgId) {
          console.warn('⚠️  Mensagem com foto mas sem ID utilizável para download. Chaves:', Object.keys(msg).join(','));
        } else {
          try {
            imagemBase64 = await client.downloadMedia(msgId);
            if (!imagemBase64) {
              console.warn(`⚠️  Mídia detectada (type=${msg.type}) mas download retornou vazio.`);
            } else {
              console.log(`   🖼️  Foto baixada (${Math.round(String(imagemBase64).length / 1024)} KB)`);
            }
          } catch (e) {
            console.warn(`⚠️  Não consegui baixar a imagem (type=${msg.type}, id=${msgId}): ${e.message}`);
          }
        }
      }

      await processarOferta(texto, `whatsapp:${chatId}`, client, imagemBase64);
    } catch (erro) {
      console.error(`❌ Erro no listener do WhatsApp: ${erro.message}`);
    }
  });

  console.log('✅ WhatsApp conectado.');
  return client;
}

/* ================= Telegram (gramjs) ================= */

async function iniciarTelegram(wppClient) {
  const { apiId, apiHash, session, canaisMonitorados } = config.telegram;
  if (!apiId || !apiHash) {
    console.warn('⚠️  Telegram não configurado. Escuta do Telegram desativada.');
    return null;
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => perguntar('Número de telefone (Telegram): '),
    password: () => perguntar('Senha 2FA (vazio se não houver): '),
    phoneCode: () => perguntar('Código recebido no Telegram: '),
    onError: (err) => console.error('Telegram auth error:', err.message),
  });

  if (!session) {
    console.log('\n🔐 SALVE ISTO NO .env (TELEGRAM_SESSION_STRING):');
    console.log(client.session.save(), '\n');
  }

  const canais = canaisMonitorados.map((c) => c.replace(/^@/, '').toLowerCase());

  client.addEventHandler(async (evento) => {
    try {
      const msg = evento.message;
      if (!msg?.message) return;
      const chat = await msg.getChat();
      const username = (chat?.username || '').toLowerCase();
      if (canais.length && !canais.includes(username)) return;

      // Baixa a foto da mensagem do Telegram (se houver) para republicar no WhatsApp
      let imagemBase64 = null;
      const midiaFoto =
        msg.photo ||
        (msg.media && msg.media.className === 'MessageMediaPhoto' ? msg.media : null) ||
        (msg.media?.photo ? msg.media : null) || // MessageMediaWebPage com foto de capa
        null;
      if (midiaFoto) {
        try {
          const buffer = await client.downloadMedia(msg.media || msg, {});
          if (buffer) {
            imagemBase64 = `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`;
            console.log(`   🖼️  Foto do Telegram baixada (${Math.round(buffer.length / 1024)} KB)`);
          } else {
            console.warn('⚠️  Mensagem do Telegram tinha foto, mas o download retornou vazio.');
          }
        } catch (e) {
          console.warn(`⚠️  Não consegui baixar a imagem do Telegram: ${e.message}`);
        }
      }

      await processarOferta(msg.message, `telegram:@${username}`, wppClient, imagemBase64);
    } catch (erro) {
      console.error(`❌ Erro no listener do Telegram: ${erro.message}`);
    }
  }, new NewMessage({}));

  console.log('✅ Telegram conectado.');
  return client;
}

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    })
  );
}

/* ================= Bootstrap ================= */

async function main() {
  console.log('🚀 Iniciando Affiliate Automation...\n');
  if (!config.whatsapp.meuGrupo) {
    console.warn('⚠️  MEU_GRUPO_WHATSAPP não está definido no .env!');
  }

  // Fila de envio: envia, registra no banco e loga
  filaEnvio = new SendQueue(async ({ mensagemFinal, urlLimpa, chaveFinal, wppClient, imagemBase64 }) => {
    if (imagemBase64) {
      // Envia a foto do produto com a oferta na legenda.
      // Fallback em cascata: base64 -> arquivo temporário -> só texto.
      try {
        await wppClient.sendImage(config.whatsapp.meuGrupo, imagemBase64, 'produto.jpg', mensagemFinal);
      } catch (erroBase64) {
        console.warn(`⚠️  sendImage via base64 falhou (${erroBase64.message}) — tentando via arquivo...`);
        try {
          const dataUrl = String(imagemBase64);
          const [cabecalho, dados] = dataUrl.split(',');
          const mime = /data:(.*?)(;base64)?$/.exec(cabecalho)?.[1] || 'image/jpeg';
          const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
          const tmp = path.join(os.tmpdir(), `oferta-${Date.now()}${ext}`);
          fs.writeFileSync(tmp, Buffer.from(dados, 'base64'));
          try {
            await wppClient.sendImage(config.whatsapp.meuGrupo, tmp, `produto${ext}`, mensagemFinal);
          } finally {
            fs.unlink(tmp, () => {});
          }
        } catch (erroArquivo) {
          console.warn(`⚠️  sendImage via arquivo falhou (${erroArquivo.message}) — enviando só o texto.`);
          await wppClient.sendText(config.whatsapp.meuGrupo, mensagemFinal);
        }
      }
    } else {
      await wppClient.sendText(config.whatsapp.meuGrupo, mensagemFinal);
    }
    registrarEnvio(urlLimpa);
    if (chaveFinal && chaveFinal !== urlLimpa) registrarEnvio(chaveFinal);
    console.log('   ✅ Enviada e registrada.');
  });

  const wppClient = await iniciarWhatsApp();
  await iniciarTelegram(wppClient);
  console.log('\n🎯 Sistema ativo. Monitorando ofertas...\n');

  // Retoma envios que ficaram pendentes de execucoes anteriores
  filaEnvio.restaurarPendentes();
}

main().catch((erro) => {
  console.error(`💥 Falha fatal na inicialização: ${erro.message}`);
  process.exit(1);
});
