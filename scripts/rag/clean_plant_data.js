#!/usr/bin/env node
/**
 * P0 資料清理：移除 XX屬 / XX科 及無效分類階層
 *
 * 剔除 chinese_name 結尾為以下字樣的紀錄：
 * - 屬、科、亞科、族、亞屬、綱、目
 *
 * 輸入：plants-forest-gov-tw-final-4302.jsonl
 * 輸出：plants-forest-gov-tw-clean.jsonl
 *
 * 使用：node scripts/rag/clean_plant_data.js
 * 或：  npm run clean:plant-data
 */

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-final-4302.jsonl');
const OUTPUT_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-clean.jsonl');

// 黑名單：chinese_name 結尾為這些字樣 → 剔除
const INVALID_SUFFIXES = ['屬', '科', '亞科', '族', '亞屬', '綱', '目'];

// 例外：結尾符合黑名單但為有效物種名（如 龍目=龍眼）
const EXCEPTIONS = new Set(['龍目']);

function isInvalidTaxonName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || EXCEPTIONS.has(trimmed)) return false;
  return INVALID_SUFFIXES.some(s => trimmed.endsWith(s));
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error('❌ 輸入檔不存在:', INPUT_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(INPUT_PATH, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  const kept = [];
  const removed = [];

  for (const line of lines) {
    try {
      const plant = JSON.parse(line);
      const chinese = plant.chinese_name || '';

      if (isInvalidTaxonName(chinese)) {
        removed.push({ name: chinese, scientific: plant.scientific_name || '(無)' });
        continue;
      }

      kept.push(line);
    } catch (e) {
      console.warn('⚠️ 跳過無效行:', e.message);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');

  console.log('');
  console.log('========================================');
  console.log('P0 資料清理完成');
  console.log('========================================');
  console.log(`  輸入: ${INPUT_PATH}`);
  console.log(`  輸出: ${OUTPUT_PATH}`);
  console.log(`  原始筆數: ${lines.length}`);
  console.log(`  保留筆數: ${kept.length}`);
  console.log(`  剔除筆數: ${removed.length}`);
  console.log('');

  if (removed.length > 0) {
    console.log('剔除的紀錄（chinese_name）：');
    removed.slice(0, 30).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} (${r.scientific})`);
    });
    if (removed.length > 30) {
      console.log(`  ... 共 ${removed.length} 筆`);
    }
  }

  console.log('');
  console.log('✅ 下一步：');
  console.log('  1. 重新向量化: ./scripts/rag/run_local_embed.sh (或 Zeabur)');
  console.log('  2. 重建 plant-name-mapping: npm run build:plant-mapping');
  console.log('  3. Qdrant 需整庫重建 collection（embed 腳本會處理）');
  console.log('');
}

main();
