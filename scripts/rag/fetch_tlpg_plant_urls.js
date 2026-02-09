#!/usr/bin/env node
/**
 * 從台灣景觀植物介紹 (tlpg.hsiliu.org.tw) 搜尋列表抓取植物 view URL，
 * 隨機取 N 筆寫入檔案，供 verify_from_tlpg_url.js --urls-file 使用。
 *
 * 列表為 /search，分頁參數 start=0,10,20,...，每頁約 10 筆，共約 932 筆。
 *
 * 使用：
 *   node scripts/rag/fetch_tlpg_plant_urls.js [--count 100] [--out 路徑]
 *
 * 預設：count=100，out=scripts/rag/tlpg-100-urls.txt
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://tlpg.hsiliu.org.tw';
const SEARCH_URL = `${BASE}/search`;
const PER_PAGE = 10;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function extractViewIds(html) {
  const text = html.toString('utf8');
  const ids = new Set();
  const regex = /\/search\/view\/(\d+)/g;
  let m;
  while ((m = regex.exec(text))) ids.add(parseInt(m[1], 10));
  return [...ids];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const args = process.argv.slice(2);
  let count = 100;
  let outPath = path.join(__dirname, 'tlpg-100-urls.txt');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = Math.max(1, parseInt(args[i + 1], 10));
      i++;
    } else if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  const allIds = new Set();
  let start = 0;
  let emptyPages = 0;

  console.log('正在抓取 TLPG 搜尋列表...');
  while (emptyPages < 2) {
    const url = `${SEARCH_URL}?start=${start}`;
    const html = await fetchUrl(url);
    const ids = extractViewIds(html);
    if (ids.length === 0) {
      emptyPages++;
    } else {
      emptyPages = 0;
      ids.forEach((id) => allIds.add(id));
    }
    console.log(`  start=${start} → ${ids.length} 筆，累計 ${allIds.size}`);
    start += PER_PAGE;
    if (start > 1000) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const idList = shuffle([...allIds]);
  const selected = idList.slice(0, count).map((id) => `${BASE}/search/view/${id}`);
  const content = selected.join('\n');

  const dir = path.dirname(outPath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, content + '\n', 'utf8');

  console.log(`\n已寫入 ${selected.length} 筆 URL → ${outPath}`);
  console.log('執行驗證範例：');
  console.log(`  APP_URL=https://gpstask.zeabur.app node scripts/rag/verify_from_tlpg_url.js --urls-file ${outPath} -v --report ./report-100.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
