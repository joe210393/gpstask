#!/usr/bin/env node
/**
 * Taxonomy Enrichment Pipeline
 * 
 * 從 plants-forest-gov-tw-enriched-embed-dedup.jsonl 補齊 taxonomy 欄位
 * 策略：分來源抽取 → 嚴格驗證 → 寫入統一 schema
 * 
 * 使用：
 *   node scripts/rag/enrich_taxonomy.js
 * 
 * 輸出：
 *   plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT = path.join(DATA_DIR, 'plants-forest-gov-tw-enriched-embed-dedup.jsonl');
const OUTPUT = path.join(DATA_DIR, 'plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl');

// ============================================================================
// 1. 來源分類
// ============================================================================

function getSourceType(url, source) {
  if ((source || '').includes('liverworts-local') || (url || '').startsWith('file:///')) {
    return 'local';
  }
  if ((url || '').includes('subjectweb.forest.gov.tw')) {
    return 'forest';
  }
  if ((url || '').includes('kmweb.moa.gov.tw')) {
    return 'kmweb';
  }
  return 'other';
}

// ============================================================================
// 2. Schema 驗證工具
// ============================================================================

function genusFromScientificName(scientificName) {
  if (!scientificName || typeof scientificName !== 'string') return null;
  const cleaned = scientificName.replace(/\s+/g, ' ').trim();
  const token = cleaned.split(' ')[0];
  if (/^[A-Z][a-z-]{2,}$/.test(token)) return token;
  return null;
}

function isValidFamilyZh(zh) {
  return typeof zh === 'string' && /^[一-龥]{2,10}科$/.test(zh);
}

function monthsFromRange(a, b) {
  if (!b || a === b) return [a];
  if (a < b) {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  // 跨年情況：11~2 → [11, 12, 1, 2]
  const first = Array.from({ length: 12 - a + 1 }, (_, i) => a + i);
  const second = Array.from({ length: b }, (_, i) => 1 + i);
  return first.concat(second);
}

function isValidMonths(months) {
  return Array.isArray(months) &&
    months.length > 0 &&
    months.every(m => Number.isInteger(m) && m >= 1 && m <= 12);
}

const LIFEFORM_MAP = {
  '喬木': 'tree',
  '小喬木': 'tree',
  '灌木': 'shrub',
  '亞灌木': 'shrub',
  '多年生草本': 'herb_perennial',
  '一年生草本': 'herb_annual',
  '草本': 'herb',
  '藤本': 'vine',
  '蔓性': 'vine',
  '攀緣': 'vine',
  '水生': 'aquatic',
  '附生': 'epiphyte',
};

const RE_LIFEFORM_HINT = /(喬木|小喬木|灌木|亞灌木|多年生草本|一年生草本|草本|藤本|蔓性|攀緣|水生|附生)/;

const RE_FLOWERING = /(花期|開花期|花季)\s*[:：]?\s*([0-9]{1,2})\s*(?:[~～\-至到]\s*([0-9]{1,2}))?\s*月?/;

const RE_FAMILY_ZH = /(?:科\s*名|科名|分\s*類|分類|科：|科:\s*)([一-龥]{2,8}科)/;
const RE_FAMILY_ANY = /([一-龥]{2,8}科)(?![一-龥])/;

const RE_ALIAS_BLOCK = /(別名|俗名|又稱)\s*[:：]\s*([^\n\r]{1,60})/;

function cleanAlias(raw) {
  const parts = raw.split(/[、,，;；/]/).map(s => s.trim()).filter(Boolean);
  return parts.filter(x =>
    x.length >= 2 &&
    x.length <= 10 &&
    !/[()（）。，.]/.test(x) &&
    !/(花期|分布|科|屬)/.test(x)
  );
}

const RE_ZH_EN = /^([一-龥]{2,10}科)\s*([A-Za-z-]{3,})$/;

function splitFamily(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(RE_ZH_EN);
  if (m) {
    return { zh: m[1], en: m[2], raw };
  }
  const zh = raw.match(/([一-龥]{2,10}科)/)?.[1];
  if (zh && isValidFamilyZh(zh)) {
    return { zh, raw };
  }
  return null;
}

// ============================================================================
// 3. 來源專用抽取器
// ============================================================================

function extractForestTaxonomy(text, scientificName) {
  const taxonomy = {};

  // genus: 只從 scientific_name 拿
  const genus = genusFromScientificName(scientificName || '');
  if (genus) {
    taxonomy.genus = { latin: genus, raw: genus };
  }

  // family
  let familyZh;
  const m1 = text.match(RE_FAMILY_ZH);
  if (m1) {
    familyZh = m1[1];
  } else {
    const m2 = text.match(RE_FAMILY_ANY);
    if (m2) {
      const idx = text.indexOf(m2[1]);
      const window = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + 20));
      if (/(科名|分類|科[:：])/.test(window)) {
        familyZh = m2[1];
      }
    }
  }
  if (familyZh && isValidFamilyZh(familyZh)) {
    taxonomy.family = { zh: familyZh, raw: familyZh };
  }

  // flowering_season
  const fm = text.match(RE_FLOWERING);
  if (fm) {
    const a = parseInt(fm[2], 10);
    const b = fm[3] ? parseInt(fm[3], 10) : undefined;
    if (a >= 1 && a <= 12 && (!b || (b >= 1 && b <= 12))) {
      const months = monthsFromRange(a, b);
      if (isValidMonths(months)) {
        taxonomy.flowering_season = { months, raw: fm[0] };
      }
    }
  }

  // life_form
  const lm = text.match(RE_LIFEFORM_HINT);
  if (lm) {
    const raw = lm[1];
    const norm = LIFEFORM_MAP[raw];
    if (norm) {
      taxonomy.life_form = { norm, raw };
    }
  }

  return taxonomy;
}

function extractKmwebTaxonomy(text, scientificName) {
  const taxonomy = {};

  // genus from scientific_name
  const genus = genusFromScientificName(scientificName || '');
  if (genus) {
    taxonomy.genus = { latin: genus, raw: genus };
  }

  // alias
  const am = text.match(RE_ALIAS_BLOCK);
  if (am) {
    const items = cleanAlias(am[2]);
    if (items.length > 0) {
      taxonomy.alias = { items, raw: am[2] };
    }
  }

  // flowering
  const fm = text.match(RE_FLOWERING);
  if (fm) {
    const a = parseInt(fm[2], 10);
    const b = fm[3] ? parseInt(fm[3], 10) : undefined;
    if (a >= 1 && a <= 12 && (!b || (b >= 1 && b <= 12))) {
      const months = monthsFromRange(a, b);
      if (isValidMonths(months)) {
        taxonomy.flowering_season = { months, raw: fm[0] };
      }
    }
  }

  // life_form
  const lm = text.match(RE_LIFEFORM_HINT);
  if (lm) {
    const raw = lm[1];
    const norm = LIFEFORM_MAP[raw];
    if (norm) {
      taxonomy.life_form = { norm, raw };
    }
  }

  // family（有的話就補）
  const m1 = text.match(RE_FAMILY_ZH);
  const familyZh = m1 && m1[1];
  if (familyZh && isValidFamilyZh(familyZh)) {
    taxonomy.family = { zh: familyZh, raw: familyZh };
  }

  return taxonomy;
}

// local 生活型映射（土生/地生/附生/腐木生 等）
const LOCAL_LIFEFORM_MAP = {
  '土生': 'terrestrial', '地生': 'terrestrial', '陸生': 'terrestrial',
  '附生': 'epiphytic', '著生': 'epiphytic',
  '腐木生': 'saprophytic', '腐生': 'saprophytic',
  '水生': 'aquatic', '喬木': 'tree', '灌木': 'shrub', '草本': 'herb',
  '藤本': 'vine', '蔓性': 'vine', '攀緣': 'vine'
};

function normalizeLocalTaxonomy(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return {};
  const t = { ...taxonomy };
  
  // 如果 family 是字串，嘗試分離
  if (typeof t.family === 'string') {
    const fam = splitFamily(t.family);
    if (fam) {
      t.family = fam;
    } else {
      delete t.family;
    }
  }
  
  // 如果 life_form 是字串，轉成 {norm, raw}
  if (typeof t.life_form === 'string') {
    const raw = t.life_form.trim();
    const firstTerm = raw.split(/[,，]/)[0].trim();
    const norm = LOCAL_LIFEFORM_MAP[firstTerm] || firstTerm;
    t.life_form = { norm, raw };
  }
  
  return t;
}

/** 統一型別：alias、flowering_season 等字串轉成 schema 格式 */
function normalizeTaxonomyTypes(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return taxonomy;
  const t = { ...taxonomy };
  
  // alias 字串 → {items, raw}
  if (typeof t.alias === 'string') {
    const raw = t.alias.trim();
    const items = cleanAlias(raw);
    t.alias = items.length ? { items, raw } : { items: [raw], raw };
  }
  
  // flowering_season 字串 "6" 或 "6-8" → {months, raw}
  if (typeof t.flowering_season === 'string') {
    const raw = t.flowering_season.trim();
    const m = raw.match(/([0-9]{1,2})\s*(?:[~～\-至到]\s*([0-9]{1,2}))?/);
    let ok = false;
    if (m) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : undefined;
      if (a >= 1 && a <= 12 && (!b || (b >= 1 && b <= 12))) {
        const months = monthsFromRange(a, b);
        if (isValidMonths(months)) {
          t.flowering_season = { months, raw };
          ok = true;
        }
      }
    }
    if (!ok) delete t.flowering_season;
  }
  
  // life_form 字串（任何來源）→ {norm, raw}
  if (typeof t.life_form === 'string') {
    const raw = t.life_form.trim();
    const firstTerm = raw.split(/[,，]/)[0].trim();
    const norm = LIFEFORM_MAP[firstTerm] || LOCAL_LIFEFORM_MAP[firstTerm] || firstTerm;
    t.life_form = { norm, raw };
  }
  
  return t;
}

// ============================================================================
// 4. 主 enrichment 函數
// ============================================================================

function joinText(plant) {
  const r = plant.raw_data || {};
  return [r.morphology, r.ecology, r.usage, r.distribution]
    .filter(Boolean)
    .join('\n');
}

function enrichTaxonomy(plant) {
  const url = plant.source_url || '';
  const srcType = getSourceType(url, plant.source);
  const text = joinText(plant);

  // 先保留原本 taxonomy（如果有），但清除無效的欄位
  let taxonomy = plant.taxonomy && Object.keys(plant.taxonomy).length > 0
    ? JSON.parse(JSON.stringify(plant.taxonomy)) // 深拷貝
    : {};

  // 清除無效的 genus（如果格式不對）
  if (taxonomy.genus) {
    if (typeof taxonomy.genus === 'string') {
      // 如果原本是字串，檢查格式
      const latin = taxonomy.genus.trim();
      if (!/^[A-Z][a-z-]{2,}$/.test(latin)) {
        delete taxonomy.genus; // 格式不對，清除
      } else {
        taxonomy.genus = { latin, raw: latin };
      }
    } else if (taxonomy.genus.latin) {
      // 如果已經是物件，檢查 latin 格式
      if (!/^[A-Z][a-z-]{2,}$/.test(taxonomy.genus.latin)) {
        delete taxonomy.genus; // 格式不對，清除
      }
    }
  }

  // 1) 無論來源，先從 scientific_name 補 genus（只要原本沒 genus）
  if (!taxonomy.genus) {
    const genus = genusFromScientificName(plant.scientific_name || '');
    if (genus) {
      taxonomy.genus = { latin: genus, raw: genus };
    }
  }

  // 2) 依來源跑各自的抽取器（只覆蓋「原本沒有」的欄位）
  if (srcType === 'forest') {
    const extra = extractForestTaxonomy(text, plant.scientific_name);
    for (const key of Object.keys(extra)) {
      if (!taxonomy[key]) {
        taxonomy[key] = extra[key];
      }
    }
  } else if (srcType === 'kmweb') {
    const extra = extractKmwebTaxonomy(text, plant.scientific_name);
    for (const key of Object.keys(extra)) {
      if (!taxonomy[key]) {
        taxonomy[key] = extra[key];
      }
    }
  } else if (srcType === 'local') {
    taxonomy = normalizeLocalTaxonomy(taxonomy);
  }

  // 2.5) 統一型別：life_form/alias/flowering_season 字串 → schema 格式
  taxonomy = normalizeTaxonomyTypes(taxonomy);

  // 3) 清除空物件
  const cleaned = Object.fromEntries(
    Object.entries(taxonomy).filter(
      ([, v]) => v && JSON.stringify(v) !== '{}' && v !== null && v !== undefined
    )
  );
  
  plant.taxonomy = Object.keys(cleaned).length > 0 ? cleaned : {};

  return plant;
}

// ============================================================================
// 5. 批次處理主程式
// ============================================================================

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`❌ 輸入檔案不存在: ${INPUT}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT, 'utf8'),
    crlfDelay: Infinity,
  });
  
  const out = fs.createWriteStream(OUTPUT, 'utf8');

  let total = 0;
  let updated = 0;
  let stats = {
    forest: { total: 0, updated: 0 },
    kmweb: { total: 0, updated: 0 },
    local: { total: 0, updated: 0 },
    other: { total: 0, updated: 0 },
  };

  console.log(`📖 開始處理: ${INPUT}`);
  console.log(`📝 輸出至: ${OUTPUT}\n`);

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    total++;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      console.warn(`⚠️  第 ${total} 行 JSON 解析失敗，跳過`);
      continue;
    }

    const before = JSON.stringify(obj.taxonomy || {});
    const enriched = enrichTaxonomy(obj);
    const after = JSON.stringify(enriched.taxonomy || {});
    
    const srcType = getSourceType(enriched.source_url || '', enriched.source || '');
    stats[srcType].total++;
    
    if (before !== after) {
      updated++;
      stats[srcType].updated++;
    }

    out.write(JSON.stringify(enriched) + '\n');

    // 每 500 筆顯示進度
    if (total % 500 === 0) {
      console.log(`  處理中... ${total} 筆，已更新 ${updated} 筆`);
    }
  }

  out.end();
  
  console.log(`\n✅ 完成 taxonomy enrichment`);
  console.log(`   總共處理: ${total} 筆`);
  console.log(`   更新: ${updated} 筆 (${(updated / total * 100).toFixed(1)}%)`);
  console.log(`\n📊 依來源統計:`);
  for (const [src, s] of Object.entries(stats)) {
    if (s.total > 0) {
      console.log(`   ${src}: ${s.total} 筆，更新 ${s.updated} 筆 (${(s.updated / s.total * 100).toFixed(1)}%)`);
    }
  }
  console.log(`\n📁 輸出檔案: ${OUTPUT}`);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
