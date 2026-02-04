#!/usr/bin/env node
/**
 * P0.5 資料去重：合併同物種多筆紀錄
 *
 * 策略：
 * - 依 scientific_name（正規化後）分組，同種合併為一筆
 * - 若無 scientific_name，不與他筆合併（避免 七里香 等同中文名異物種被錯誤合併）
 *
 * 輸入：plants-forest-gov-tw-clean.jsonl（P0 輸出）
 * 輸出：plants-forest-gov-tw-dedup.jsonl
 *
 * 使用：node scripts/rag/dedup_plant_data.js
 * 或：  npm run dedup:plant-data
 */

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-clean.jsonl');
const OUTPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-dedup.jsonl');

/** 正規化學名（用於分組） */
function normalizeScientific(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t.toLowerCase() : null;
}

/** 合併陣列欄位（去重、保留順序） */
function mergeArrays(arrays) {
  const seen = new Set();
  const result = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const v = String(item || '').trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        result.push(v);
      }
    }
  }
  return result;
}

/** 合併 common_names（含 chinese_name） */
function mergeCommonNames(plants) {
  const seen = new Set();
  const result = [];
  for (const p of plants) {
    const cn = (p.chinese_name || '').trim();
    if (cn && !seen.has(cn)) {
      seen.add(cn);
      result.push(cn);
    }
    const arr = p.common_names || [];
    for (const c of arr) {
      const t = String(c || '').trim();
      if (t && t.length >= 2 && !seen.has(t)) {
        seen.add(t);
        result.push(t);
      }
    }
  }
  return result;
}

/** 選擇最長的非空字串 */
function pickLongest(values) {
  let best = '';
  for (const v of values) {
    const s = typeof v === 'string' ? v : (Array.isArray(v) ? v.join(' ') : '');
    if (s && s.length > best.length) best = s;
  }
  return best;
}

/** 合併多筆同物種紀錄為一筆 */
function mergePlants(plants) {
  if (plants.length === 0) return null;
  if (plants.length === 1) return plants[0];

  const base = JSON.parse(JSON.stringify(plants[0]));
  const id = base.identification || {};

  for (let i = 1; i < plants.length; i++) {
    const p = plants[i];
    const pi = p.identification || {};

    id.key_features = mergeArrays([id.key_features, pi.key_features]);
    id.key_features_norm = mergeArrays([id.key_features_norm, pi.key_features_norm]);
    id.trait_tokens = mergeArrays([id.trait_tokens, pi.trait_tokens]);
    id.must_traits = mergeArrays([id.must_traits, pi.must_traits]);
  }

  base.common_names = mergeCommonNames(plants);

  const summaries = plants.map((p) => (p.identification || {}).summary).filter(Boolean);
  const morphSummaries = plants.map((p) => (p.identification || {}).morphology_summary_zh).filter(Boolean);
  const queryTexts = plants.map((p) => (p.identification || {}).query_text_zh).filter(Boolean);

  id.summary = pickLongest(summaries) || id.summary;
  id.morphology_summary_zh = pickLongest(morphSummaries) || id.morphology_summary_zh;

  const longestQuery = pickLongest(queryTexts);
  if (longestQuery) {
    id.query_text_zh = longestQuery;
  } else if (id.key_features_norm && id.key_features_norm.length > 0) {
    const lf = id.life_form || base.identification?.life_form || '';
    id.query_text_zh = `${lf}。${id.morphology_summary_zh || id.summary || ''} ${(id.key_features_norm || []).join(' ')}`.trim();
  }

  base.identification = id;

  base.source_url = plants.map((p) => p.source_url).filter(Boolean)[0] || base.source_url;
  base.source = base.source || 'forest-gov-tw';

  return base;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error('❌ 輸入檔不存在:', INPUT_PATH);
    console.error('   請先執行: npm run clean:plant-data');
    process.exit(1);
  }

  const content = fs.readFileSync(INPUT_PATH, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  const byKey = new Map();
  const noScientific = [];

  for (const line of lines) {
    try {
      const plant = JSON.parse(line);
      const sciNorm = normalizeScientific(plant.scientific_name);

      if (sciNorm) {
        if (!byKey.has(sciNorm)) byKey.set(sciNorm, []);
        byKey.get(sciNorm).push(plant);
      } else {
        noScientific.push(plant);
      }
    } catch (e) {
      console.warn('⚠️ 跳過無效行:', e.message);
    }
  }

  const merged = [];

  for (const [, group] of byKey) {
    const one = mergePlants(group);
    if (one) merged.push(one);
  }

  for (const p of noScientific) {
    merged.push(p);
  }

  const output = merged.map((p) => JSON.stringify(p)).join('\n') + (merged.length ? '\n' : '');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  const removed = lines.length - merged.length;

  console.log('');
  console.log('========================================');
  console.log('P0.5 資料去重完成');
  console.log('========================================');
  console.log(`  輸入: ${INPUT_PATH}`);
  console.log(`  輸出: ${OUTPUT_PATH}`);
  console.log(`  原始筆數: ${lines.length}`);
  console.log(`  去重後筆數: ${merged.length}`);
  console.log(`  合併移除筆數: ${removed}`);
  console.log(`  無學名保留: ${noScientific.length} 筆（不合併）`);
  console.log('');

  if (byKey.size > 0) {
    let shown = 0;
    for (const [key, group] of byKey) {
      if (group.length > 1 && shown < 15) {
        const names = [...new Set(group.map((p) => p.chinese_name))].join(', ');
        console.log(`  合併範例: ${key} (${group.length}筆) → ${names}`);
        shown++;
      }
    }
  }

  console.log('');
  console.log('✅ 下一步：');
  console.log('  1. 重置 Qdrant: ./scripts/rag/reset_local_qdrant.sh（本機）');
  console.log('  2. 刪除進度檔: rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json');
  console.log('  3. 重新向量化: FORCE_RECREATE=1 ./scripts/rag/run_local_embed.sh');
  console.log('  4. 重建 plant-name-mapping: npm run build:plant-mapping');
  console.log('');
}

main();
