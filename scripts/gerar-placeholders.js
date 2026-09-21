#!/usr/bin/env node
/**
 * gerar-placeholders.js
 * Rende HTML → PNG 800x800 com marca de cada loja, usando o Chromium do
 * projeto (mesmo binário do WhatsApp). A arte fica em data/placeholders/.
 *
 * Politica: o placeholderPara do app prioriza PNGs em disco (com hot-reload
 * por mtime). Para trocar o design, basta re-rodar este script e reiniciar
 * (ou nao reiniciar — o hot-reload captura a troca).
 *
 * Uso:
 *   node scripts/gerar-placeholders.js          # gera todas as lojas
 *   node scripts/gerar-placeholders.js Shopee   # gera apenas uma loja
 *
 * Requer: puppeteer (já instalado no projeto)
 */

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(DATA_DIR, 'placeholders');

/** Executável do Chromium: usa CHROME_PATH (igual ao app), ou PUPPETEER_EXECUTABLE_PATH. */
const CHROME_BIN =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  '/usr/bin/chromium' ||
  '';

/** Fonte do sistema usada pelo Chromium do projeto (deve existir no VPS). */
const FONT_STACK = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Brand de cada loja: cor de fundo, nome, subtítulo, cor do texto. */
const LOJAS = [
  { slug: 'MercadoLivre',    cor: '#FFE600', corTexto: '#1A1A1A', nome: 'Mercado Livre',   tag: 'toque no link',       emoji: '🔍' },
  { slug: 'Shopee',           cor: '#EE4D2D', corTexto: '#FFFFFF', nome: 'Shopee',            tag: 'toque no link',       emoji: '🛍️' },
  { slug: 'Magalu',           cor: '#0086FF', corTexto: '#FFFFFF', nome: 'Magazine Luiza',   tag: 'toque no link',       emoji: '📦' },
  { slug: 'Amazon',           cor: '#FF9900', corTexto: '#1A1A1A', nome: 'Amazon',            tag: 'toque no link',       emoji: '📦' },
  { slug: 'Shein',            cor: '#000000', corTexto: '#FFFFFF', nome: 'Shein',             tag: 'toque no link',       emoji: '👗' },
  { slug: 'TikTokShop',       cor: '#111111', corTexto: '#FFFFFF', nome: 'TikTok Shop',       tag: 'toque no link',       emoji: '🎵' },
  { slug: 'default',          cor: '#1F6FEB', corTexto: '#FFFFFF', nome: 'Ofertas do Dia',    tag: 'toque no link',       emoji: '✨' },
];

const filtro = process.argv[2] ? [process.argv[2]] : null;

function buildHtml(loja) {
  // Background com gradiente sutil + padrão de triângulos em baixa opacidade
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:100%; height:100%; }
  body {
    width: 800px; height: 800px;
    background: ${loja.cor};
    background-image:
      repeating-linear-gradient(45deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 18px,
        rgba(0,0,0,0.06) 19px, rgba(0,0,0,0.06) 20px),
      radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.08) 60%);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: ${FONT_STACK};
    overflow: hidden;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 10px;
    background: rgba(0,0,0,0.18);
    color: ${loja.corTexto};
    padding: 8px 18px; border-radius: 40px;
    font-size: 22px; font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 24px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  }
  .badge .emoji { font-size: 26px; line-height: 1; }
  h1 {
    color: ${loja.corTexto};
    font-size: ${loja.nome === 'Mercado Livre' ? '64' : '58'}px;
    font-weight: 900;
    text-align: center;
    line-height: 1.05;
    text-shadow: ${loja.nome === 'Mercado Livre' ? '0 3px 0 rgba(0,0,0,0.25)' : '0 2px 0 rgba(0,0,0,0.3)'};
  }
  .tag {
    color: ${loja.corTexto};
    opacity: 0.92;
    font-size: 26px;
    font-weight: 600;
    margin-top: 18px;
    letter-spacing: 1px;
  }
  .tag .seta { margin-left: 12px; font-size: 30px; }
  .corte {
    position: absolute; bottom: 0; left: 0;
    width: 100%; height: 90px;
    background: linear-gradient(to top, rgba(0,0,0,0.22), rgba(0,0,0,0));
  }
</style>
</head>
<body>
  <div class="badge"><span class="emoji">${loja.emoji}</span> ${loja.nome.toUpperCase()}</div>
  <h1>OFERTAS</h1>
  <div class="tag">${loja.tag} <span class="seta">👉</span></div>
  <div class="corte"></div>
</body>
</html>`;
}

async function render(loja) {
  const out = path.join(OUT_DIR, `${loja.slug}.png`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN || undefined,
    headless: 'old' in puppeteer ? true : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--single-process',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
    await page.setContent(buildHtml(loja), { waitUntil: 'load' });
    // Espera um frame para garantir que CSS foi aplicado
    await new Promise((r) => setTimeout(r, 150));
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(out, buf);
    console.log(`  ✓ ${loja.slug}  ${buf.length} bytes → ${out}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('🎨 Gerando placeholders branding...\n');
  const lista = LOJAS.filter((l) => !filtro || filtro.includes(l.slug));
  if (filtro && !lista.length) {
    console.log(`❌ Loja "${filtro[0]}" não reconhecida. Disponiveis: ${LOJAS.map((l) => l.slug).join(', ')}`);
    process.exit(1);
  }
  for (const loja of lista) {
    await render(loja);
  }
  console.log(`\n✅ ${lista.length} placeholder(s) gerado(s) em ${OUT_DIR}`);
}

main().catch((e) => {
  console.error('❌ Falha:', e.message);
  process.exit(1);
});