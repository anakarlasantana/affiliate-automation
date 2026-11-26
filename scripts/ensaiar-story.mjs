#!/usr/bin/env node
/**
 * ensaiar-story.mjs — ensaio local ponta a ponta, SEM publicar nada.
 *
 * Faz o caminho real do app (expandir → mergulhar → converter), baixa a foto do
 * produto, compõe o story 9:16 e grava em `data/midia`. No fim imprime o link
 * curto e a URL pública que a Meta usaria — nada sai para o Instagram.
 *
 * Uso:
 *   npm run ensaiar -- <url> --preco 199 [--destino grupo|oferta]
 */
import fs from 'node:fs';
import path from 'node:path';

import config from '../src/config.js';
import {
  desembrulharAfiliadoRedirecionador,
  desembrulharVerificacaoMeli,
  expandirLink,
  extrairImagemDaLoja,
  extrairImagemProduto,
  sanitizarUrl,
} from '../src/linkResolver.js';
import {
  chaveProduto,
  converterParaAfiliado,
  paramsRemoverPara,
  resolverMergulhador,
} from '../src/affiliates/index.js';
import { comporStory, textosDoStory } from '../src/midia/compor.js';
import { nomeDaMidia } from '../src/midia/quadro.js';
import { registrarDestino } from '../src/redirecionador.js';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opcao = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : padrao;
};

const precoNum = Number(opcao('preco', NaN));
const destino = opcao('destino', config.publicacao.goDestino || 'grupo');

if (!url) {
  console.error('uso: npm run ensaiar -- <url> --preco 199 [--destino grupo|oferta]');
  process.exit(1);
}
if (!Number.isFinite(precoNum) || precoNum <= 0) {
  console.error('informe --preco: sem preço o story NÃO é publicado (regra do projeto)');
  process.exit(1);
}

console.log(`\n=== ENSAIO · nada é publicado ===\nurl: ${url}\n`);

const expandida = desembrulharAfiliadoRedirecionador(
  desembrulharVerificacaoMeli(await expandirLink(url)),
);
let alvo = sanitizarUrl(expandida, paramsRemoverPara(expandida));

const mergulhador = resolverMergulhador(alvo);
if (mergulhador) {
  const produto = await mergulhador.extrair(expandida);
  if (produto) {
    alvo = produto === expandida ? alvo : sanitizarUrl(produto, paramsRemoverPara(produto));
  }
}

const chave = chaveProduto(alvo);
const conv = await converterParaAfiliado(alvo, expandida);
const chaveUrl = String(chave || '').replace(/[^A-Za-z0-9_-]/g, '-');

console.log(`produto    : ${alvo}`);
console.log(`chave      : ${chave || '(sem identidade)'}`);
console.log(`loja       : ${conv.loja}`);
console.log(`nosso link : ${conv.meuLink || `DESCARTADA (${conv.motivo})`}`);

if (!conv.meuLink) {
  console.error('\nSem link de afiliado não há story — é a regra nº 1 do projeto.');
  process.exit(2);
}

const imagem = (await extrairImagemProduto(alvo)) || (await extrairImagemDaLoja(alvo));
if (!imagem) {
  console.error('\nSem foto do produto: publicaria placeholder. Ensaio abortado.');
  process.exit(3);
}

const textos = textosDoStory({ atual: precoNum, antigo: null, desconto: null }, destino);
if (!textos) {
  console.error('\nPreço inválido para o criativo.');
  process.exit(4);
}

const pasta = config.publicacao.midiaDir;
fs.mkdirSync(pasta, { recursive: true });

const buffer = Buffer.from(String(imagem.base64).split(',')[1] || '', 'base64');
const origem = path.join(pasta, `.origem-${process.pid}.jpg`);
fs.writeFileSync(origem, buffer);

const nomeSaida = nomeDaMidia(buffer);
const saida = path.join(pasta, nomeSaida);

await comporStory({ entrada: origem, saida, textos });
fs.rmSync(origem, { force: true });

const base = config.publicacao.baseUrl || `http://127.0.0.1:${config.publicacao.porta}`;
const curto = `${(config.publicacao.goBaseUrl || base).replace(/\/+$/, '')}/go/${chaveUrl}`;

// Guarda o destino para o servidor conseguir redirecionar /go/<chave>.
const arquivoDestinos = path.join(config.caminhos.data, 'go-destinos.json');
registrarDestino(arquivoDestinos, chaveUrl, conv.meuLink);

console.log(`imagem     : ${imagem.origem} (${Math.round(buffer.length / 1024)} KB)`);
console.log(`story gerado: ${saida}`);
console.log(`URL p/ Meta : ${base}/midia/${nomeSaida}`);
console.log(`link curto  : ${curto}`);
console.log(`destino     : registrado em ${arquivoDestinos}`);
console.log(`textos      : ${textos.preco}${textos.de ? ` · ${textos.de}` : ''} · ${textos.principal} · ${textos.apoio}`);
console.log('\nConfira a imagem e, se estiver boa, o story está pronto para o deploy.\n');
