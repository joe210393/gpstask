#!/usr/bin/env node
/**
 * 從台灣景觀植物介紹 (tlpg.hsiliu.org.tw) 網址驗證 RAG 辨識
 *
 * 流程（與真實 UX 一致）：爬取網頁 → 抓圖 →
 *   1. 先送第 1 張圖 → /api/vision-test
 *   2. 若 need_more_photos 且 session_data，送第 2 張 + previous_session
 *   3. (已停用) 第 3 張常稀釋正確答案，維持最多 2 張
 *   4. 以最終 plant_rag 比對 Top1 與預期物種
 *
 * 依賴：sharp（可選，用於單圖縮放）。未安裝時用原圖。
 *
 * 使用：
 *   APP_URL=http://localhost:3000 node scripts/rag/verify_from_tlpg_url.js <url1> [url2] ...
 *   或
 *   APP_URL=... node scripts/rag/verify_from_tlpg_url.js --urls url1,url2,url3
 *   APP_URL=... node scripts/rag/verify_from_tlpg_url.js --urls-file scripts/rag/tlpg-100-urls.txt
 *
 * 參數：
 *   --verbose, -v    輸出詳細資訊（Top5、LM 猜測、特徵、分數），便於除錯與優化
 *   --report [路徑]  將完整報告寫入 Markdown（格式對齊 test-report.md），未指定路徑則自動檔名
 *   --urls-file 路徑 從檔案讀取 URL（每行一筆或逗號分隔）
 *
 * 範例：
 *   APP_URL=http://localhost:3000 node scripts/rag/verify_from_tlpg_url.js \
 *     https://tlpg.hsiliu.org.tw/search/view/307 \
 *     https://tlpg.hsiliu.org.tw/search/view/286 \
 *     https://tlpg.hsiliu.org.tw/search/view/543
 *
 * 注意：不改動 gps-task 主程式，此為獨立驗證腳本。
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = null;
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const CELL_SIZE = 400;
const NUM_PANELS = 3;

// 從主程式取得「植物辨識用結構化 Prompt」，避免使用預設的「你是一個有用的 AI 助手」
// 否則多半不會輸出 traits JSON，導致後端只走 embedding（不會進 hybrid/traits）
let PLANT_SYSTEM_PROMPT = null;

async function fetchPlantVisionPrompt() {
  const url = `${APP_URL.replace(/\/$/, '')}/api/plant-vision-prompt`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    // 期望格式：{ success: true, prompt: "....", feature_vocab: [...] }
    if (data && typeof data.prompt === 'string' && data.prompt.trim().length > 50) {
      return data.prompt.trim();
    }
    // 兼容：有些版本可能回 { success: true, data: { prompt } }
    if (data?.data && typeof data.data.prompt === 'string' && data.data.prompt.trim().length > 50) {
      return data.data.prompt.trim();
    }
    return null;
  } catch (_) {
    return null;
  }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function parseTlpgPage(html) {
  const text = html.toString('utf8');
  const result = { plantName: null, scientificName: null, imageUrls: [] };

  const titleMatch = text.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    const parts = titleMatch[1].split('|').map((s) => s.trim());
    if (parts[0]) result.plantName = parts[0];
  }

  const sciMatch = text.match(/學名[：:]\s*([^\n<]+)/);
  if (sciMatch) result.scientificName = sciMatch[1].trim();

  const imgRegex = /href="(https:\/\/tlpg\.hsiliu\.org\.tw\/images\/plant\/\d+\/[^"]+\.(?:jpg|JPG|jpeg|JPEG|png|PNG))"/g;
  let m;
  while ((m = imgRegex.exec(text))) {
    if (!result.imageUrls.includes(m[1])) result.imageUrls.push(m[1]);
  }

  return result;
}

function extractLmGuess(description) {
  if (!description || typeof description !== 'string') return null;
  const replyMatch = description.match(/<reply>([\s\S]*?)<\/reply>/i);
  const replyText = replyMatch ? replyMatch[1].trim() : null;
  if (replyText) {
    const lines = replyText.split('\n').map((s) => s.trim()).filter(Boolean);
    return lines.slice(0, 3).join(' | ') || replyText.slice(0, 150);
  }
  const analysisMatch = description.match(/<analysis>([\s\S]*?)<\/analysis>/i);
  if (analysisMatch) {
    const t = analysisMatch[1].trim().slice(0, 150);
    return t + (t.length >= 150 ? '...' : '');
  }
  return description.slice(0, 150) + (description.length > 150 ? '...' : '');
}

/** 同種植物的俗名／別名對照（預期名 ↔ RAG 回傳名 視為通過） */
const COMMON_NAME_SYNONYMS = [
  ['風鈴草', '風鈴花'],
  ['棕竹', '棕樹'],
  ['長穗木', '紫花長穗木'],
  ['馬纓丹', '五色梅'],  // Lantana camara
  ['西印度櫻桃', '昔來薩樹'],
  ['西印度櫻桃', '勒李']
];

function isMatch(expected, actual, scientificName) {
  if (!actual) return false;
  const e = (expected || '').trim();
  const a = (actual || '').trim();
  const s = (scientificName || '').trim();
  if (e === a) return true;
  for (const [x, y] of COMMON_NAME_SYNONYMS) {
    if ((e === x && a === y) || (e === y && a === x)) return true;
  }
  if (a.includes(e) || e.includes(a)) return true;
  if (s && a.toLowerCase().includes(s.split(/\s+/)[0]?.toLowerCase())) return true;
  return false;
}

/** 在候選名單中找預期物種的排名（1-based），找不到回傳 999 */
function findRank(plantList, expectedName, scientificName) {
  if (!Array.isArray(plantList) || !expectedName) return 999;
  for (let i = 0; i < plantList.length; i++) {
    const p = plantList[i];
    if (isMatch(expectedName, p.chinese_name, p.scientific_name)) return i + 1;
  }
  return 999;
}

/** 將單張圖縮成一個格子的尺寸（統一輸出 jpeg 以利合成） */
async function resizeToCell(buffer) {
  return sharp(buffer)
    .resize(CELL_SIZE, CELL_SIZE, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** 從一張圖裁切中心局部（ratio 為邊長比例，如 0.5 = 中心一半），再縮成格子尺寸 */
async function zoomCenter(buffer, ratio) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 100;
  const h = meta.height || 100;
  const cw = Math.max(1, Math.floor(w * ratio));
  const ch = Math.max(1, Math.floor(h * ratio));
  const left = Math.floor((w - cw) / 2);
  const top = Math.floor((h - ch) / 2);
  return sharp(buffer)
    .extract({ left, top, width: cw, height: ch })
    .resize(CELL_SIZE, CELL_SIZE, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * 取得最多 3 張圖的 buffer；不足 3 張時用第一張的「局部放大」補滿 3 格。
 * 回傳長度為 3 的 Buffer 陣列，每個已是 CELL_SIZE x CELL_SIZE。
 */
async function buildCompositePanelBuffers(imageUrls) {
  const urls = imageUrls.slice(0, NUM_PANELS);
  const buffers = [];
  for (const url of urls) {
    buffers.push(await fetchUrl(url));
  }
  const panels = [];
  if (buffers.length >= 3) {
    panels.push(await resizeToCell(buffers[0]), await resizeToCell(buffers[1]), await resizeToCell(buffers[2]));
  } else if (buffers.length === 2) {
    panels.push(await resizeToCell(buffers[0]), await resizeToCell(buffers[1]), await zoomCenter(buffers[0], 0.5));
  } else if (buffers.length === 1) {
    panels.push(await resizeToCell(buffers[0]), await zoomCenter(buffers[0], 0.5), await zoomCenter(buffers[0], 0.35));
  }
  return panels;
}

/**
 * 將 3 個已為 CELL_SIZE x CELL_SIZE 的 buffer 橫向拼成一張大圖（3*CELL_SIZE x CELL_SIZE）
 */
async function compositeThreePanels(panelBuffers) {
  const totalWidth = CELL_SIZE * NUM_PANELS;
  const composites = panelBuffers.map((buf, i) => ({
    input: buf,
    left: i * CELL_SIZE,
    top: 0
  }));
  return sharp({
    create: {
      width: totalWidth,
      height: CELL_SIZE,
      channels: 3,
      background: { r: 248, g: 248, b: 248 }
    }
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * 從網頁解析的 imageUrls 產出一張「三格合成圖」buffer；若無 sharp 則回傳第一張原圖。
 * （僅在 --composite 模式下使用）
 */
async function getImageToSend(imageUrls) {
  if (!sharp || imageUrls.length === 0) {
    if (!sharp) console.warn('  ⚠️ 未安裝 sharp，僅使用第一張圖片');
    return fetchUrl(imageUrls[0]);
  }
  const panels = await buildCompositePanelBuffers(imageUrls);
  return compositeThreePanels(panels);
}

/** 取得單張圖 buffer（兩段式流程用），index 從 0 起算 */
async function getSingleImageBuffer(imageUrls, index) {
  const url = imageUrls[index];
  if (!url) throw new Error(`無圖片 index ${index}`);
  let buf = await fetchUrl(url);
  if (sharp) {
    buf = await sharp(buf).resize(1200, 1200, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  }
  return buf;
}

/** 呼叫 vision-test API（支援 previous_session 補拍） */
async function callVisionApi(imageBuffer, previousSession = null) {
  const apiUrl = `${APP_URL.replace(/\/$/, '')}/api/vision-test`;
  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'plant.jpg');
  if (PLANT_SYSTEM_PROMPT) {
    form.append('systemPrompt', PLANT_SYSTEM_PROMPT);
    form.append('userPrompt', '請依照提示詞分析這張植物圖片，並輸出 <analysis> / <reply> 與結構化 traits JSON。');
  }
  if (previousSession) {
    form.append('previous_session', JSON.stringify(previousSession));
  }
  const res = await fetch(apiUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function verifyOne(pageUrl, verbose = false) {
  console.log('\n' + '='.repeat(60));
  console.log('🌐 網址:', pageUrl);

  let html;
  try {
    html = await fetchUrl(pageUrl);
  } catch (e) {
    console.error('❌ 無法取得網頁:', e.message);
    return { url: pageUrl, ok: false, error: e.message };
  }

  const parsed = parseTlpgPage(html);
  if (!parsed.plantName) {
    console.error('❌ 無法解析植物名稱');
    return { url: pageUrl, ok: false, error: 'parse plant name failed' };
  }
  if (parsed.imageUrls.length === 0) {
    console.error('❌ 無圖片連結');
    return { url: pageUrl, ok: false, error: 'no images' };
  }

  const singlePhotoMode = process.env.SINGLE_PHOTO_MODE === '1';
  console.log('  預期物種:', parsed.plantName, parsed.scientificName ? `(${parsed.scientificName})` : '');
  console.log('  圖片數:', parsed.imageUrls.length);
  console.log('  流程:', singlePhotoMode ? '單張模式（僅用第1張）' : '兩段式（1張→若需要補拍→2張）');

  let data;
  let rounds = 0;
  const maxRounds = singlePhotoMode ? 1 : Math.min(2, parsed.imageUrls.length);

  try {
    // 第 1 輪：送第 1 張
    let imageBuffer = await getSingleImageBuffer(parsed.imageUrls, 0);
    data = await callVisionApi(imageBuffer);
    rounds = 1;

    // 若 need_more_photos 且還有圖可補拍，繼續
    while (data.need_more_photos && data.session_data && rounds < maxRounds) {
      rounds++;
      console.log(`  📷 補拍第 ${rounds} 張（need_more_photos）`);
      imageBuffer = await getSingleImageBuffer(parsed.imageUrls, rounds - 1);
      data = await callVisionApi(imageBuffer, data.session_data);
    }

    if (rounds > 1) {
      console.log(`  ✅ 兩段式完成，共 ${rounds} 輪`);
    }
  } catch (e) {
    const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
    console.error('❌ API 請求失敗:', e.message + cause);
    console.error('   💡 請確認：1) 主程式已啟動  2) APP_URL 正確 (目前:', APP_URL, ')');
    return { url: pageUrl, expected: parsed.plantName, ok: false, error: e.message, parsed };
  }
  const plantRag = data?.plant_rag || {};
  const plants = plantRag.plants || [];
  const embeddingOnlyPlants = plantRag.embedding_only_plants || [];
  const top1 = plants[0];

  const rankEmbedding = findRank(embeddingOnlyPlants, parsed.plantName, parsed.scientificName);
  const rankHybrid = findRank(plants, parsed.plantName, parsed.scientificName);
  let ragEffect = 'n/a';
  if (embeddingOnlyPlants.length > 0) {
    if (rankHybrid < rankEmbedding) ragEffect = 'help';
    else if (rankHybrid > rankEmbedding) ragEffect = 'disturb';
    else ragEffect = 'neutral';
  }

  const matched = top1 && isMatch(parsed.plantName, top1.chinese_name, top1.scientific_name);
  const top1Name = top1 ? `${top1.chinese_name || ''} (${top1.scientific_name || '無學名'})` : '無結果';

  if (plants.length === 0) {
    const msg = plantRag.message || (plantRag.is_plant === false ? '判斷非植物' : '未知');
    console.log('  ⚠️ RAG 無結果:', msg);
  }
  console.log('  RAG Top1:', top1Name);
  if (verbose) {
    const desc = data?.description;
    const lmGuess = desc ? extractLmGuess(desc) : null;
    console.log('  LM / 描述摘要:', lmGuess || '(無)');
    const qf = data?.quick_features;
    const qfStr = typeof qf === 'string' ? qf : (qf && typeof qf === 'object' ? JSON.stringify(qf).slice(0, 150) : null);
    console.log('  快速特徵:', qfStr && qfStr.length > 0 ? qfStr.slice(0, 200) + (qfStr.length > 200 ? '...' : '') : '(無，完整分析模式不產生)');
    const fi = plantRag.feature_info;
    let traitStr = null;
    if (fi?.query_traits && Array.isArray(fi.query_traits)) {
      traitStr = fi.query_traits.join(', ');
    } else if (fi?.feature_details && Array.isArray(fi.feature_details)) {
      const names = fi.feature_details.map((d) => d.name || d).filter(Boolean);
      traitStr = names.length ? names.join(', ') : null;
    }
    console.log('  Query 特徵:', traitStr || '(無，可能僅用 embedding 搜尋)');
    console.log('  Top5:');
    plants.slice(0, 5).forEach((p, i) => {
      const sc = p.score != null ? (p.score * 100).toFixed(1) : '-';
      const mf = p.matched_features?.length ? ` [${p.matched_features.join(', ')}]` : '';
      const sci = (p.scientific_name || '無').replace(/\s+/g, ' ').trim();
      console.log(`    ${i + 1}. ${p.chinese_name || '-'} (${sci}) ${sc}%${mf}`);
    });
  }
  console.log(matched ? '  ✅ 符合預期' : '  ❌ 不符預期');

  return {
    url: pageUrl,
    expected: parsed.plantName,
    scientificName: parsed.scientificName,
    top1: top1?.chinese_name,
    top1Scientific: top1?.scientific_name,
    top5: plants.slice(0, 5).map((p) => p.chinese_name),
    ok: matched,
    parsed,
    apiData: data,
    plants,
    plantRag,
    rounds,
    rank_embedding: rankEmbedding,
    rank_hybrid: rankHybrid,
    rag_effect: ragEffect
  };
}

/** 將單一案例寫成 test-report 風格的 Markdown 區塊 */
function formatCaseReport(result, index) {
  const { parsed, apiData, plants, plantRag, ok } = result;
  const lines = [];
  const name = parsed?.plantName || result.expected || '未知';
  const status = ok ? '✅正確' : '❌錯誤';
  lines.push(`## ${name}（${status}）`);
  lines.push('');
  lines.push(`- **網址**: ${result.url}`);
  lines.push(`- **預期物種**: ${parsed?.plantName || result.expected || '-'}${parsed?.scientificName ? ` (${parsed.scientificName})` : ''}`);
  lines.push(`- **圖片數**: ${parsed?.imageUrls?.length ?? 0}`);
  lines.push(`- **補拍輪數**: ${result.rounds ?? 1}（兩段式流程）`);
  lines.push(`- **使用結構化 Prompt**: ${PLANT_SYSTEM_PROMPT ? '是' : '否'}`);
  lines.push(`- **RAG Top1**: ${result.top1 || '無'}${result.top1Scientific ? ` (${result.top1Scientific})` : ''}`);
  if (result.rank_embedding != null || result.rank_hybrid != null) {
    const re = result.rank_embedding ?? '-';
    const rh = result.rank_hybrid ?? '-';
    const effect = result.rag_effect === 'help' ? '幫忙' : result.rag_effect === 'disturb' ? '擾亂' : result.rag_effect === 'neutral' ? '不變' : 'n/a';
    lines.push(`- **Embedding-only 排名**: ${re} | **Hybrid 排名**: ${rh} | **RAG 效果**: ${effect}`);
  }
  if (result.error) lines.push(`- **錯誤**: ${result.error}`);
  lines.push('');

  if (!apiData) return lines.join('\n');

  const desc = apiData?.description;
  if (desc) {
    const lmGuess = extractLmGuess(desc);
    lines.push('### LM / 描述摘要');
    lines.push(lmGuess ? lmGuess : '(無)');
    lines.push('');
  }

  const qf = apiData?.quick_features;
  if (qf != null) {
    const qfStr = typeof qf === 'string' ? qf : JSON.stringify(qf).slice(0, 300);
    if (qfStr.length > 0) {
      lines.push('### 快速特徵');
      lines.push(qfStr + (qfStr.length >= 300 ? '...' : ''));
      lines.push('');
    }
  }

  const fi = plantRag?.feature_info;
  if (fi) {
    lines.push('### Query 特徵（送進 hybrid 的特徵）');
    let traitStr = null;
    if (fi.query_traits && Array.isArray(fi.query_traits)) {
      traitStr = fi.query_traits.join(', ');
    } else if (fi.feature_details && Array.isArray(fi.feature_details)) {
      traitStr = fi.feature_details.map((d) => d.name || d).filter(Boolean).join(', ');
    }
    lines.push(traitStr || '(無)');
    if (fi.total_score != null) lines.push(`- 特徵總分: ${fi.total_score.toFixed(4)}`);
    if (fi.matched_count != null) lines.push(`- 匹配數: ${fi.matched_count}`);
    lines.push('');
  }

  lines.push('### RAG 結果');
  lines.push(`- 類型: ${plantRag?.search_type ?? '(未回傳)'}`);
  lines.push(`- 訊息: ${plantRag?.message ?? '-'}`);
  if (plantRag?.lm_confidence_boost != null) {
    lines.push(`- LM 加成: ${(plantRag.lm_confidence_boost * 100).toFixed(0)}%`);
  }
  lines.push('');

  if (plants && plants.length > 0) {
    lines.push('📋 候選名單（依分數排序）');
    lines.push('');
    plants.forEach((p, i) => {
      const sci = (p.scientific_name || '無學名').replace(/\s+/g, ' ').trim();
      const scorePct = p.score != null ? `${(p.score * 100).toFixed(1)}%` : '-';
      const embPct = p.embedding_score != null ? `embedding: ${(p.embedding_score * 100).toFixed(1)}%` : '';
      const featPct = p.feature_score != null ? `feature: ${(p.feature_score * 100).toFixed(1)}%` : '';
      const sub = [embPct, featPct].filter(Boolean).join(', ');
      const mf = p.matched_features?.length ? ` 匹配特徵: ${p.matched_features.join(', ')}` : '';
      lines.push(`  ${i + 1}. ${p.chinese_name || '-'} (${sci}) - 分數: ${scorePct}${sub ? ` (${sub})` : ''}${mf ? '\n     ' + mf : ''}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

/** 寫入完整報告檔（格式對齊 test-report.md，便於決定下一步修改與權重） */
function writeReport(results, reportPath) {
  const fs = require('fs');
  const header = [
    '# RAG 驗證報告（tlpg 網址）',
    '',
    `產生時間: ${new Date().toISOString()}`,
    `APP_URL: ${APP_URL}`,
    `總筆數: ${results.length}，通過: ${results.filter((r) => r.ok).length}`,
    '',
    '---',
    ''
  ].join('\n');

  const withEffect = results.filter((r) => r.rag_effect && r.rag_effect !== 'n/a');
  const helpCount = withEffect.filter((r) => r.rag_effect === 'help').length;
  const neutralCount = withEffect.filter((r) => r.rag_effect === 'neutral').length;
  const disturbCount = withEffect.filter((r) => r.rag_effect === 'disturb').length;
  const naCount = results.length - withEffect.length;

  const summary = [
    '## 結果彙總',
    '',
    ...results.map((r, i) => {
      const status = r.ok ? '✅' : '❌';
      return `${i + 1}. ${status} ${r.expected || r.url} → Top1: ${r.top1 || '無'}`;
    }),
    '',
    '### Embedding-only vs Hybrid（同一 query）',
    '',
    `- **幫忙**（hybrid 排名較前）: ${helpCount}`,
    `- **不變**: ${neutralCount}`,
    `- **擾亂**（hybrid 排名較後）: ${disturbCount}`,
    `- **n/a**（無 embedding_only 資料）: ${naCount}`,
    '',
    '---',
    ''
  ].join('\n');

  const body = results.map((r, i) => formatCaseReport(r, i)).join('\n---\n\n');
  const content = header + summary + body;
  fs.mkdirSync(require('path').dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content, 'utf8');
  return reportPath;
}

async function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  let reportPath = null;
  let urlsFilePath = null;
  const rawArgs = process.argv.slice(2).filter((a) => a !== '--verbose' && a !== '-v');
  const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--report' || rawArgs[i] === '--out') {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('http') && !next.startsWith('-')) {
        reportPath = next;
        i++;
      } else {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        reportPath = require('path').join(__dirname, `verify-report-${stamp}.md`);
      }
      continue;
    }
    if (rawArgs[i] === '--urls-file' && rawArgs[i + 1]) {
      urlsFilePath = rawArgs[i + 1];
      i++;
      continue;
    }
    args.push(rawArgs[i]);
  }
  let urls = [];
  if (urlsFilePath && fs.existsSync(urlsFilePath)) {
    const content = fs.readFileSync(urlsFilePath, 'utf8');
    urls = content
      .split(/[\n,]/)
      .map((u) => u.trim())
      .filter((u) => u && (u.startsWith('http://') || u.startsWith('https://')));
  }
  if (urls.length === 0 && args.includes('--urls')) {
    const i = args.indexOf('--urls');
    urls = (args[i + 1] || '').split(',').map((u) => u.trim()).filter(Boolean);
  }
  if (urls.length === 0) {
    urls = args.filter((a) => !a.startsWith('-') && (a.startsWith('http') || a.startsWith('https')));
  }

  if (urls.length === 0) {
    urls = [
      'https://tlpg.hsiliu.org.tw/search/view/307',
      'https://tlpg.hsiliu.org.tw/search/view/286',
      'https://tlpg.hsiliu.org.tw/search/view/543',
      'https://tlpg.hsiliu.org.tw/search/view/136',
      'https://tlpg.hsiliu.org.tw/search/view/284',
      'https://tlpg.hsiliu.org.tw/search/view/285',
      'https://tlpg.hsiliu.org.tw/search/view/288',
      'https://tlpg.hsiliu.org.tw/search/view/291',
      'https://tlpg.hsiliu.org.tw/search/view/297',
      'https://tlpg.hsiliu.org.tw/search/view/296',
      'https://tlpg.hsiliu.org.tw/search/view/298',
      'https://tlpg.hsiliu.org.tw/search/view/310'
    ];
    console.log('📌 未指定網址，使用預設 12 筆');
  }

  console.log('APP_URL:', APP_URL);
  console.log('待驗證筆數:', urls.length);

  const healthUrl = `${APP_URL.replace(/\/$/, '')}/`;
  try {
    const h = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
    console.log('  ✅ 主程式可連線');
  } catch (e) {
    console.error('  ❌ 無法連線主程式:', e.message);
    console.error('  💡 請先啟動 gps-task (npm start)，並確認 APP_URL 正確');
    process.exit(1);
  }

  // 取得植物辨識 prompt（僅需抓一次）
  PLANT_SYSTEM_PROMPT = await fetchPlantVisionPrompt();
  if (PLANT_SYSTEM_PROMPT) {
    console.log('  ✅ 已載入植物辨識 Prompt（將啟用 traits/hybrid 解析）');
  } else {
    console.warn('  ⚠️ 無法取得 /api/plant-vision-prompt，將使用預設 prompt（通常只會走 embedding）');
  }

  const results = [];
  for (const url of urls) {
    const r = await verifyOne(url, verbose);
    results.push(r);
    await new Promise((x) => setTimeout(x, 2000));
  }

  const passed = results.filter((r) => r.ok).length;
  const withEffect = results.filter((r) => r.rag_effect && r.rag_effect !== 'n/a');
  const helpCount = withEffect.filter((r) => r.rag_effect === 'help').length;
  const neutralCount = withEffect.filter((r) => r.rag_effect === 'neutral').length;
  const disturbCount = withEffect.filter((r) => r.rag_effect === 'disturb').length;
  console.log('\n' + '='.repeat(60));
  console.log('📊 結果彙總:', `${passed}/${results.length} 通過`);
  console.log('📊 Embedding vs Hybrid: 幫忙', helpCount, '| 不變', neutralCount, '| 擾亂', disturbCount, '| n/a', results.length - withEffect.length);
  results.forEach((r, i) => {
    const status = r.ok ? '✅' : '❌';
    const eff = r.rag_effect ? ` [${r.rag_effect}]` : '';
    console.log(`  ${i + 1}. ${status} ${r.expected || r.url} → Top1: ${r.top1 || '無'}${eff}`);
  });

  if (reportPath) {
    try {
      const written = writeReport(results, reportPath);
      console.log('📄 完整報告已寫入:', written);
    } catch (e) {
      console.error('❌ 寫入報告失敗:', e.message);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
