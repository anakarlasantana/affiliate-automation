/**
 * servidor.js — as três portas públicas do projeto:
 *
 *   GET  /go/<chave>          → 302 para o link de afiliado + conta o clique
 *   GET  /midia/<arquivo>     → serve o JPEG/MP4 que a META baixa
 *   POST /webhooks/instagram  → assinado, responde 200 na hora e manda o Direct
 *
 * POR QUE existe: a Meta baixa a mídia por URL pública (não aceita base64) e o
 * webhook do Direct exige HTTPS público. Sem framework: `node:http` resolve, e
 * o projeto não ganha dependência nova.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';

import {
  chaveDoCaminho,
  destinoPadrao,
  montarDestino,
  registrarClique,
} from './redirecionador.js';
import {
  dentroDaJanela,
  deveResponder,
  jaRespondido,
  lerEvento,
  marcarRespondido,
  montarResposta,
  validarAssinatura,
} from './canais/direct.js';

const TIPOS = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};

/** Link curto do produto (o que vai na bio e no Direct). */
export function linkCurto(config, chave) {
  const base = String(config?.publicacao?.goBaseUrl || '').replace(/\/+$/, '');
  if (!base || !chave) return null;
  return `${base}/go/${chave}`;
}

/** Nome de arquivo seguro: só o basename, sem `..` nem barra. */
export function nomeSeguro(caminho) {
  const base = path.basename(String(caminho || ''));
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(base) || base.startsWith('.')) return null;
  return base;
}

function responderJson(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/**
 * Cria o servidor. Dependências injetadas para o teste não precisar de rede.
 */
export function criarServidor({
  config,
  destinos = {},
  cliques = {},
  respondidos = {},
  enviarDirect = async () => {},
  obterChaveAtual = () => null,
  aoMarcar = () => {},
  avisar = () => {},
} = {}) {
  const publicacao = config?.publicacao || {};

  /** Destino padrão (bio sem chave): grupo ou oferta do momento. */
  function destinoConfigurado() {
    return destinoPadrao(publicacao.goDestino, {
      grupo: config?.whatsapp?.meuGrupoLink || '',
      oferta: montarDestino(obterChaveAtual(), destinos),
    });
  }

  function servirMidia(res, caminho) {
    const nome = nomeSeguro(caminho);
    if (!nome) return responderJson(res, 400, { erro: 'nome inválido' });

    const arquivo = path.join(publicacao.midiaDir || '', nome);
    const tipo = TIPOS[path.extname(nome).toLowerCase()];
    if (!tipo) return responderJson(res, 415, { erro: 'tipo não suportado' });

    let dados;
    try {
      dados = fs.readFileSync(arquivo);
    } catch {
      return responderJson(res, 404, { erro: 'mídia não encontrada' });
    }

    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': dados.length,
      'Cache-Control': 'public, max-age=86400, immutable',
    });
    res.end(dados);
  }

  /**
   * Processa um evento de webhook: palavra-chave → idempotência → janela → DM.
   * Devolve o registro de respondidos (sem mutar o recebido).
   */
  function processarDirect(payload, respondidosAtuais) {
    const evento = lerEvento(payload);
    if (!evento) return respondidosAtuais;

    if (!deveResponder(evento.texto, publicacao.palavraDireto || 'LINK')) return respondidosAtuais;
    if (jaRespondido(respondidosAtuais, evento.mid)) return respondidosAtuais;
    if (!dentroDaJanela(evento.quando)) {
      avisar(`Direct: janela de 24h expirada para ${evento.igsid}`);
      return respondidosAtuais;
    }

    const link = linkCurto(config, obterChaveAtual()) || config?.whatsapp?.meuGrupoLink || null;
    if (!link) {
      avisar('Direct: sem link para responder (nem oferta do momento, nem grupo)');
      return respondidosAtuais;
    }

    const proximo = marcarRespondido(respondidosAtuais, evento.mid, evento.igsid);
    aoMarcar(evento.mid, evento.igsid);
    enviarDirect({ igsid: evento.igsid, texto: montarResposta(link) }).catch((erro) =>
      avisar(`Direct: falha ao enviar (${erro.message})`),
    );
    return proximo;
  }

  function tratarWebhook(req, res, url) {
    // Handshake de verificação do webhook da Meta.
    if (req.method === 'GET') {
      const desafio = url.searchParams.get('hub.challenge');
      if (url.searchParams.get('hub.mode') === 'subscribe' && desafio) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(desafio);
      }
      return responderJson(res, 400, { erro: 'verificação inválida' });
    }

    if (req.method !== 'POST') return responderJson(res, 405, { erro: 'método' });

    const pedacos = [];
    req.on('data', (parte) => pedacos.push(parte));
    req.on('end', () => {
      const corpoCru = Buffer.concat(pedacos).toString('utf8');
      const assinatura = req.headers['x-hub-signature-256'];

      if (!validarAssinatura(corpoCru, assinatura, config?.instagram?.appSecret)) {
        return responderJson(res, 401, { erro: 'assinatura inválida' });
      }

      // 200 imediato: a Meta reenvia se demorarmos, e reenvio = DM duplicada.
      responderJson(res, 200, { recebido: true });

      setImmediate(() => {
        try {
          const atualizados = processarDirect(JSON.parse(corpoCru), respondidos);
          for (const chave of Object.keys(atualizados)) respondidos[chave] = atualizados[chave];
        } catch (erro) {
          avisar(`Direct: payload inválido (${erro.message})`);
        }
      });
    });
  }

  function tratar(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const caminho = url.pathname;

    if (caminho === '/' || caminho === '/health') {
      return responderJson(res, 200, { ok: true, servico: 'affiliate-automation' });
    }

    if (caminho === '/go' || caminho === '/go/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return responderJson(res, 405, { erro: 'método' });
      }
      const destino = destinoConfigurado();
      if (!destino) return responderJson(res, 404, { erro: 'sem destino padrão configurado' });

      res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (caminho.startsWith('/go/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return responderJson(res, 405, { erro: 'método' });
      }

      const chave = chaveDoCaminho(caminho);
      // Chave desconhecida = 404 (CA-8): o link curto nunca "cai" no grupo por engano.
      const destino = chave ? montarDestino(chave, destinos) : null;
      if (!destino) return responderJson(res, 404, { erro: 'chave não encontrada' });

      const { cliques: atualizados, total } = registrarClique(cliques, chave);
      for (const k of Object.keys(atualizados)) cliques[k] = atualizados[k];
      avisar(`clique ${chave} → ${total}`);

      res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (caminho.startsWith('/midia/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return responderJson(res, 405, { erro: 'método' });
      }
      return servirMidia(res, decodeURIComponent(caminho.slice('/midia/'.length)));
    }

    if (caminho.startsWith('/webhooks/instagram')) return tratarWebhook(req, res, url);

    return responderJson(res, 404, { erro: 'rota inexistente' });
  }

  return http.createServer(tratar);
}

// Executado direto (`npm run servidor`): sobe as três rotas públicas.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    // Import dinâmico: os testes não tocam no SQLite (better-sqlite3 nativo).
    const { listarDirectRespondidos, marcarDirectRespondido } = await import('./database.js');

    // Idempotência sobrevive ao restart: a Meta reenvia webhook.
    const respondidos = {};
    for (const { mid, igsid } of listarDirectRespondidos(24)) {
      respondidos[mid] = { igsid, quando: Date.now() };
    }

    const porta = config.publicacao.porta;

    criarServidor({
      config,
      respondidos,
      aoMarcar: (mid, igsid) => marcarDirectRespondido(mid, igsid),
    }).listen(porta, () => {
      console.log(`🌐 servidor em http://127.0.0.1:${porta}`);
      console.log('   GET  /go/<chave>  ·  GET /midia/<arquivo>  ·  POST /webhooks/instagram');
      console.log(`   Direct: ${Object.keys(respondidos).length} mensagem(ns) já respondida(s) nas últimas 24h`);
      if (!config.publicacao.baseUrl) {
        console.log('   ⚠️  PUBLIC_BASE_URL vazio — a Meta não conseguirá baixar a mídia');
      }
    });
  })().catch((erro) => {
    console.error(`💥 servidor não subiu: ${erro.message}`);
    process.exit(1);
  });
}


