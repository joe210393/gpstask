#!/usr/bin/env node
/**
 * P0.6 資料強化：trait_tokens 瘦身、key_features_norm 原子化、低品質 Gate
 *
 * 目的：讓 feature matching 有更高品質的 payload，減少萬用模板與 match 失敗
 *
 * 輸入：plants-forest-gov-tw-dedup.jsonl
 * 輸出：plants-forest-gov-tw-enriched.jsonl
 *
 * 使用：node scripts/rag/enrich_plant_data.js
 * 或：  npm run enrich:plant-data
 */

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-dedup.jsonl');
const OUTPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-enriched.jsonl');

/** 非原子特徵 → 標準原子詞（對齊 FEATURE_VOCAB，利於 hybrid 匹配） */
const ATOMIZE_MAP = {
  '三出複': '三出複葉',
  '羽狀複': '羽狀複葉',
  '掌狀複': '掌狀複葉',
  '一回羽狀複': '羽狀複葉',
  '奇數羽狀複': '羽狀複葉',
  '紅苞': '紅苞葉',
  '黃色蒴': '蒴果',
  '核果狀莢': '莢果',
  '全緣或波狀': '全緣',
  '全緣或波狀緣': '全緣',
  '穗狀': '穗狀花序',
  '總狀': '總狀花序',
  '圓錐': '圓錐花序',
  '繖房': '繖房花序',
  '聚繖': '聚繖花序',
  '繖形': '繖形花序',
  '頭狀': '頭狀花序',
  '軟刺蒴果': '蒴果',
};

/** 低品質關鍵字（key_features_norm 含則標記降權） */
const LOW_QUALITY_KEYWORDS = /推測|缺乏|不明|未見|待觀察|待定|未明確|資料有限|需進一步|無法提供/;

/**
 * trait_tokens 瘦身：同一 prefix 只保留第一個值
 * 優先順序：leaf_type > fruit_type > inflorescence > life_form > leaf_arrangement > leaf_margin > flower_color
 */
function dedupeTraitTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const byPrefix = new Map();
  const ORDER = ['leaf_type', 'fruit_type', 'inflorescence', 'life_form', 'leaf_arrangement', 'leaf_margin', 'flower_color', 'leaf_shape', 'leaf_texture'];
  for (const t of tokens) {
    if (!t || typeof t !== 'string' || !t.includes('=')) continue;
    const [prefix] = t.split('=');
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, t);
  }
  const result = [];
  for (const p of ORDER) {
    if (byPrefix.has(p)) result.push(byPrefix.get(p));
  }
  for (const [p, v] of byPrefix) {
    if (!ORDER.includes(p)) result.push(v);
  }
  return result.slice(0, 12);
}

/**
 * key_features_norm 原子化：替換縮寫、拆開含 / 的、移除噪音
 */
function atomizeKeyFeaturesNorm(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const result = [];
  for (let item of arr) {
    if (!item || typeof item !== 'string') continue;
    const raw = item.trim();
    if (!raw || raw.length < 2) continue;
    if (LOW_QUALITY_KEYWORDS.test(raw)) continue;
    if (/^生活型：|^學名：/.test(raw)) continue;

    let normalized = ATOMIZE_MAP[raw] || raw;
    if (normalized.includes('/')) {
      normalized = normalized.split('/')[0].trim();
    }
    if (normalized.length < 2) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.slice(0, 15);
}

/**
 * 判斷是否為低品質筆（需降權）
 */
function isLowQuality(plant) {
  const id = plant.identification || {};
  const tt = id.trait_tokens || [];
  const kfn = id.key_features_norm || [];
  const kf = id.key_features || [];
  const text = [...kfn, ...kf].join(' ');

  if (tt.length < 2 && kfn.length < 2) return true;
  if (LOW_QUALITY_KEYWORDS.test(text)) return true;
  if (/缺乏詳細描述|缺乏詳細形態|缺乏詳細生態/.test(text)) return true;
  return false;
}

/**
 * 單筆強化
 */
function enrichPlant(plant) {
  const copy = JSON.parse(JSON.stringify(plant));
  const id = copy.identification || {};
  if (!id) return copy;

  if (id.trait_tokens && id.trait_tokens.length > 0) {
    id.trait_tokens = dedupeTraitTokens(id.trait_tokens);
  }
  if (id.key_features_norm && id.key_features_norm.length > 0) {
    id.key_features_norm = atomizeKeyFeaturesNorm(id.key_features_norm);
  }

  copy._quality_score = isLowQuality(copy) ? 0.3 : 1.0;
  copy.identification = id;
  return copy;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error('❌ 輸入檔不存在:', INPUT_PATH);
    console.error('   請先執行: npm run dedup:plant-data');
    process.exit(1);
  }

  const content = fs.readFileSync(INPUT_PATH, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  const enriched = [];
  let lowQualityCount = 0;

  for (const line of lines) {
    try {
      const plant = JSON.parse(line);
      const out = enrichPlant(plant);
      enriched.push(out);
      if (out._quality_score < 1) lowQualityCount++;
    } catch (e) {
      console.warn('⚠️ 跳過無效行:', e.message);
    }
  }

  const output = enriched.map((p) => JSON.stringify(p)).join('\n') + (enriched.length ? '\n' : '');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log('');
  console.log('========================================');
  console.log('P0.6 資料強化完成');
  console.log('========================================');
  console.log(`  輸入: ${INPUT_PATH}`);
  console.log(`  輸出: ${OUTPUT_PATH}`);
  console.log(`  總筆數: ${enriched.length}`);
  console.log(`  低品質（quality_score=0.3）: ${lowQualityCount} 筆`);
  console.log('');
  console.log('✅ 下一步：');
  console.log('  1. 重置 Qdrant: ./scripts/rag/reset_local_qdrant.sh');
  console.log('  2. 刪除進度檔: rm -f scripts/rag/vectordb/embed_plants_forest_jina_progress.json');
  console.log('  3. 重新向量化: USE_JINA_API=false ./scripts/rag/run_local_embed.sh');
  console.log('');
}

main();
