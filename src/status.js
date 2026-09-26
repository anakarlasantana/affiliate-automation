/**
 * status.js — Mostra a fila de envio atual e as lojas sem credencial.
 * Uso: npm run status
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { resumoLojas } from './affiliates/index.js';
import { contarEnviosHoje, contarOrigemDasFotos } from './database.js';

/** Caminho absoluto (config): funciona mesmo rodando de outro diretorio. */
const caminho = path.join(DATA_DIR, 'fila-status.json');

function mostrarLojasSemCredencial() {
  const lojas = resumoLojas();
  const ativas = lojas.filter((l) => l.ativa);
  const inativas = lojas.filter((l) => !l.ativa);
  console.log(`   Lojas ATIVAS: ${ativas.length ? ativas.map((l) => l.loja).join(', ') : 'nenhuma'}`);
  if (inativas.length) {
    console.log('   ⏳ FALTAM CREDENCIAIS (ofertas dessas lojas são ignoradas):');
    for (const { loja, faltantes } of inativas) {
      console.log(`        • ${loja} → ${faltantes.join(', ')}`);
    }
  }
}

if (!fs.existsSync(caminho)) {
  console.log('Sem dados de status ainda (o app precisa rodar ao menos uma vez).');
  mostrarLojasSemCredencial();
  process.exit(0);
}

const s = JSON.parse(fs.readFileSync(caminho, 'utf8'));
// Contagem lida DIRETO do banco: o JSON pode estar defasado e, antes, somava
// 2 registros por oferta (URL + chave do produto).
const enviadasHoje = contarEnviosHoje();
console.log(`\n📦 FILA DE ENVIO — atualizado em ${s.atualizadoEm}`);
console.log(`   Enviadas hoje: ${enviadasHoje}`);
if (s.pausada) console.log(`   ⛔ Pausada: ${s.pausada}`);
if (s.proximoEnvioSegundos) console.log(`   Proximo envio em ~${s.proximoEnvioSegundos}s`);

if (!s.pendentes || s.pendentes.length === 0) {
  console.log('   Fila vazia. Nada aguardando envio.');
} else {
  console.log(`   ${s.pendentes.length} oferta(s) aguardando:`);
  for (const p of s.pendentes) {
    console.log(`     ${p.posicao}. [${p.loja}] ${p.titulo}`);
  }
}

// Saúde da cascata de imagem: de onde veio a foto de cada oferta enfileirada.
// `placeholder` alto = oferta saiu sem foto real (investigue loja/URL).
const origens = contarOrigemDasFotos();
if (origens.length) {
  const total = origens.reduce((s, o) => s + o.total, 0);
  const comFotoReal = origens.filter((o) => o.origem !== 'placeholder').length;
  console.log(`\n🖼️  FOTO DAS OFERTAS NA FILA (${total} enfileiradas)`);
  for (const { origem, total: n } of origens) {
    const pct = Math.round((n / total) * 100);
    console.log(`     ${String(pct).padStart(3)}%  ${origem} (${n})`);
  }
  console.log(
    comFotoReal === origens.length
      ? '   ✅ Todas com foto real (nenhum placeholder).'
      : `   ⚠️  ${origens.length - comFotoReal} origem(ns) degradada(s) — oferta sem foto do produto.`
  );
}

mostrarLojasSemCredencial();
console.log('');
