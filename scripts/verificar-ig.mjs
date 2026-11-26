#!/usr/bin/env node
/**
 * verificar-ig.mjs — checagem READ-ONLY do canal Instagram.
 *
 * POR QUE existe: antes de publicar qualquer coisa, é preciso provar que o token
 * vale, que a conta é profissional e quanta quota resta. `content_publishing_limit`
 * responde tudo isso sem publicar nada — é o equivalente ao `verify:links`.
 *
 * Sem token no `.env`, imprime SKIP e sai com 0: o gate não pode quebrar numa
 * máquina sem credencial.
 */
import config from '../src/config.js';
import { quota } from '../src/canais/instagram.js';
import { resumoCanais } from '../src/canais/index.js';

const canal = resumoCanais()[0];

if (!canal || canal.faltantes.length) {
  console.log(`SKIP · Instagram sem credencial (falta ${canal?.faltantes.join(', ') || 'canal'})`);
  process.exit(0);
}

try {
  const q = await quota(config.instagram);
  console.log(
    `OK · conta ${config.instagram.userId} · quota ${q.usada}/${q.total} nas últimas 24h (livre ${q.livre})`,
  );
  console.log(`   PUBLICAR_STORIES=${config.instagram.publicarStories ? '1' : '0'}`);
  if (!config.publicacao.baseUrl) {
    console.log('   ATENÇÃO: PUBLIC_BASE_URL vazio — a Meta não conseguirá baixar a mídia');
  }
} catch (erro) {
  console.error(`FALHOU · ${erro.message}`);
  console.error('   confira IG_USER_ID / IG_ACCESS_TOKEN e se a conta é profissional');
  process.exit(1);
}
