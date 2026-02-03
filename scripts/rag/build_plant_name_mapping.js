#!/usr/bin/env node
/**
 * 從 plants-forest-gov-tw-final-4302.jsonl 生成學名/中文名對應表
 * Step 9: LM 學名可匹配 RAG 中文
 *
 * 輸出格式：
 * - byScientific: { "euphorbia pulcherrima": ["一品紅", "猩猩木", ...], ... }
 * - byChinese: { "一品紅": "Euphorbia pulcherrima", ... }
 * - allNames: { "euphorbia pulcherrima": ["Euphorbia pulcherrima", "一品紅", ...], ... }
 *   用於 LM 名稱 → 擴展為所有同種異名 → 與 RAG 結果比對
 */

const fs = require('fs');
const path = require('path');

const JSONL_PATH = path.join(__dirname, 'data', 'plants-forest-gov-tw-final-4302.jsonl');
const OUTPUT_PATH = path.join(__dirname, 'data', 'plant-name-mapping.json');

function normalizeScientific(s) {
  if (!s || typeof s !== 'string') return null;
  return s.trim().toLowerCase();
}

function normalizeChinese(s) {
  if (!s || typeof s !== 'string') return '';
  return s.trim();
}

const byScientific = {};
const byChinese = {};
/** 任一名稱 -> 該植物所有異名列表，用於 LM 名稱擴展匹配 */
const allNames = {};

const content = fs.readFileSync(JSONL_PATH, 'utf8');
const lines = content.split('\n').filter(Boolean);

for (const line of lines) {
  try {
    const plant = JSON.parse(line);
    const chinese = normalizeChinese(plant.chinese_name);
    const scientific = plant.scientific_name ? plant.scientific_name.trim() : null;
    const sciNorm = scientific ? normalizeScientific(scientific) : null;
    const commonNames = Array.isArray(plant.common_names) ? plant.common_names : [];

    if (!chinese && !sciNorm) continue;

    const names = new Set();
    if (chinese) names.add(chinese);
    if (scientific) names.add(scientific);
    for (const c of commonNames) {
      const t = String(c || '').trim();
      if (t && t.length >= 2) names.add(t);
    }
    const nameList = [...names];

    if (sciNorm) {
      byScientific[sciNorm] = [chinese, ...commonNames].filter(Boolean).map(normalizeChinese);
      byScientific[sciNorm] = [...new Set(byScientific[sciNorm])];
    }
    if (chinese) {
      byChinese[chinese] = scientific || chinese;
    }

    // 每個名稱（學名/中文/俗名）都指向完整異名列表
    const keysToAdd = new Set();
    if (sciNorm) keysToAdd.add(sciNorm);
    if (chinese) keysToAdd.add(chinese);
    for (const c of commonNames) {
      const t = String(c || '').trim();
      if (t && t.length >= 2) keysToAdd.add(t);
    }
    for (const k of keysToAdd) {
      allNames[k] = nameList;
    }
  } catch (e) {
    console.warn('Skip line:', e.message);
  }
}

const output = {
  byScientific,
  byChinese,
  allNames,
  meta: { generatedAt: new Date().toISOString(), source: 'plants-forest-gov-tw-final-4302.jsonl', count: lines.length }
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
console.log(`✅ 已生成 ${OUTPUT_PATH}，共 ${Object.keys(byScientific).length} 學名、${Object.keys(byChinese).length} 中文名`);
