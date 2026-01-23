/**
 * TAI2 植物資料爬蟲
 * 爬取 tai2.ntu.edu.tw 的植物資料：名彙資訊、特徵描述、分布位置
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const vm = require('vm');

const BASE_URL = 'https://tai2.ntu.edu.tw';
const DATA_DIR = path.join(__dirname, 'data');
const PLANT_LIST_FILE = path.join(DATA_DIR, 'plant-list.json');
const PLANT_DATA_FILE = path.join(DATA_DIR, 'plants.jsonl');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

// 搜索關鍵字列表（用於獲取植物列表）
const SEARCH_KEYWORDS = [
  // 常見植物名稱用字
  '草', '木', '花', '葉', '蕨', '蘭', '竹', '松', '杉', '柏',
  '藤', '樹', '果', '豆', '瓜', '菜', '茶', '麻', '薯', '芋',
  '莓', '蓮', '荷', '菊', '梅', '桃', '李', '杏', '櫻', '柳',
  '榕', '楓', '桑', '棕', '椰', '檳', '橡', '楠', '檜', '樟',
  '台灣', '高山', '海濱', '水生', '附生', '寄生',
  // 英文屬名前綴
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

// 請求延遲（毫秒）
const REQUEST_DELAY = 500;

// 確保資料目錄存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 發送 HTTP GET 請求
 */
function fetch(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const makeRequest = (attempt) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else if (res.statusCode === 404) {
            resolve(null);
          } else if (attempt < retries) {
            setTimeout(() => makeRequest(attempt + 1), 1000 * attempt);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', (err) => {
        if (attempt < retries) {
          setTimeout(() => makeRequest(attempt + 1), 1000 * attempt);
        } else {
          reject(err);
        }
      });
    };
    makeRequest(1);
  });
}

/**
 * 延遲函數
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 搜索植物並返回結果
 */
async function searchPlants(keyword) {
  const url = `${BASE_URL}/search_name/${encodeURIComponent(keyword)}`;
  try {
    const response = await fetch(url);
    if (!response) return [];

    const data = JSON.parse(response);
    return data.result2 || [];
  } catch (error) {
    console.error(`  搜索失敗 [${keyword}]: ${error.message}`);
    return [];
  }
}

/**
 * 獲取所有植物列表
 */
async function getAllPlants() {
  console.log('📋 開始獲取植物列表...\n');

  const plantsMap = new Map(); // 使用 Map 去重，key = code
  let totalSearches = 0;

  for (const keyword of SEARCH_KEYWORDS) {
    totalSearches++;
    process.stdout.write(`\r  搜索進度: ${totalSearches}/${SEARCH_KEYWORDS.length} - "${keyword}"`.padEnd(60));

    const results = await searchPlants(keyword);

    for (const plant of results) {
      if (plant.code && !plantsMap.has(plant.code)) {
        plantsMap.set(plant.code, {
          code: plant.code,
          scientific_name: plant.simnametitle?.replace(/<\/?em>/g, '') || '',
          chinese_name: plant.chname || '',
          family: plant.family || '',
          chfamily: plant.chfamily || '',
          apgfamily: plant.apgfamily || '',
          chapgfamily: plant.chapgfamily || '',
          genus: plant.genus || '',
          chgenus: plant.chgenus || '',
          endemic_type: plant.endetype || 'native',
          fern: plant.fern === 'yes'
        });
      }
    }

    await delay(REQUEST_DELAY);
  }

  const plants = Array.from(plantsMap.values());
  console.log(`\n\n✅ 獲取到 ${plants.length} 種植物\n`);

  // 儲存植物列表
  fs.writeFileSync(PLANT_LIST_FILE, JSON.stringify(plants, null, 2));
  console.log(`💾 植物列表已儲存至: ${PLANT_LIST_FILE}\n`);

  return plants;
}

/**
 * 提取名彙資訊
 */
function extractNames(document) {
  const names = {
    scientific: null,
    scientific_full: null,
    chinese: null,
    publication: null,
    first_record: null,
    synonyms: [],
    common_names: {
      chinese: [],
      english: [],
      japanese: [],
      other: []
    },
    references: []
  };

  // 提取學名（從頁面標題或 .fullname）
  const fullNameEl = document.querySelector('.fullname em, .name em, h1 em');
  if (fullNameEl) {
    names.scientific = fullNameEl.textContent.trim();
    const parent = fullNameEl.parentElement;
    if (parent) {
      names.scientific_full = parent.textContent.trim();
    }
  }

  // 提取中文名
  const chNameEl = document.querySelector('.chname, h1.chname, .fullname + .chname');
  if (chNameEl) {
    names.chinese = chNameEl.textContent.trim();
  }

  // 提取名彙資訊區塊
  const nameSection = document.querySelector('.main_content1 .name1');
  if (nameSection) {
    const h2s = nameSection.querySelectorAll('h2');
    h2s.forEach(h2 => {
      const text = h2.textContent.trim();
      const nextEl = h2.nextElementSibling;

      if (text.includes('學名發表文獻') && nextEl?.tagName === 'P') {
        names.publication = nextEl.textContent.trim();
      }

      if (text.includes('台灣首次記錄') && nextEl?.tagName === 'P') {
        names.first_record = nextEl.textContent.trim();
      }

      if (text.includes('異名') && nextEl?.tagName === 'P') {
        const synonymText = nextEl.textContent.trim();
        if (synonymText !== '無') {
          names.synonyms = synonymText.split(/[，,]/).map(s => s.trim()).filter(s => s);
        }
      }

      if (text.includes('各語言俗名') && nextEl?.tagName === 'UL') {
        const items = nextEl.querySelectorAll('li');
        items.forEach(li => {
          const langEl = li.querySelector('.va_top');
          const nameEl = li.querySelector('.width_90');
          if (langEl && nameEl) {
            const lang = langEl.textContent.trim();
            const namesText = nameEl.textContent.trim();
            const nameList = namesText.split(/[.，,]\s*/).map(n => n.trim()).filter(n => n && n !== '.');

            if (lang === '中') {
              names.common_names.chinese = nameList;
            } else if (lang === '英') {
              names.common_names.english = nameList;
            } else if (lang === '日') {
              names.common_names.japanese = nameList;
            } else if (nameList.length > 0) {
              names.common_names.other.push({ lang, names: nameList });
            }
          }
        });
      }

      if (text.includes('參考文獻') && nextEl?.tagName === 'UL') {
        const items = nextEl.querySelectorAll('li');
        items.forEach(li => {
          const div = li.querySelector('div');
          if (div) {
            const refText = div.textContent.trim();
            if (refText) {
              names.references.push(refText);
            }
          }
        });
      }
    });
  }

  return names;
}

/**
 * 提取特徵描述
 */
function extractFeatures(document) {
  const features = {
    life_form: null,           // 生活型
    morphology: [],            // 形態特徵
    cited_specimens: null,     // 引證標本
    description_zh: null,      // 完整描述（備用）
    has_data: false
  };

  // 方法1: 檢查 .des1（有結構化資料）
  const des1 = document.querySelector('.main_content2 .des1');
  if (des1) {
    const h2s = des1.querySelectorAll('h2');
    h2s.forEach(h2 => {
      const text = h2.textContent.trim();
      const nextEl = h2.nextElementSibling;

      // 生活型
      if (text.includes('生活型') && nextEl?.tagName === 'P') {
        features.life_form = nextEl.textContent.trim();
        features.has_data = true;
      }

      // 形態特徵
      if (text.includes('形態特徵')) {
        if (nextEl?.tagName === 'UL') {
          const items = nextEl.querySelectorAll('li');
          items.forEach(li => {
            const desc = li.textContent.trim();
            if (desc) {
              features.morphology.push(desc);
            }
          });
          features.has_data = true;
        } else if (nextEl?.tagName === 'P') {
          features.morphology.push(nextEl.textContent.trim());
          features.has_data = true;
        }
      }

      // 引證標本
      if (text.includes('引證標本') && nextEl?.tagName === 'P') {
        features.cited_specimens = nextEl.textContent.trim();
      }
    });

    // 組合完整描述
    if (features.has_data) {
      let desc = '';
      if (features.life_form) {
        desc += `生活型: ${features.life_form}\n`;
      }
      if (features.morphology.length > 0) {
        desc += `形態特徵:\n${features.morphology.map(m => `- ${m}`).join('\n')}`;
      }
      features.description_zh = desc.trim();
    }
  }

  // 方法2: 檢查 .des2（可能有非結構化資料）
  if (!features.has_data) {
    const des2 = document.querySelector('.main_content2 .des2');
    if (des2) {
      const text = des2.textContent.trim();
      if (text && !text.includes('資料建置中')) {
        features.description_zh = text;
        features.has_data = true;
      }
    }
  }

  return features;
}

/**
 * 提取分布位置
 */
function extractDistribution(html) {
  const distribution = {
    locations: [],
    has_data: false
  };

  // 從 JavaScript 變數 spcm 中提取
  const spcmMatch = html.match(/var spcm\s*=\s*(\[[\s\S]*?\]);/);
  if (spcmMatch) {
    try {
      // 使用 vm 模組安全地解析 JavaScript
      const context = { spcm: [] };
      vm.createContext(context);
      vm.runInContext(`spcm = ${spcmMatch[1]}`, context);

      if (Array.isArray(context.spcm) && context.spcm.length > 0) {
        distribution.has_data = true;

        // 去重處理（根據座標）
        const seen = new Set();
        context.spcm.forEach(specimen => {
          if (specimen.locinfo) {
            const key = `${specimen.locinfo.Y},${specimen.locinfo.X}`;
            if (!seen.has(key)) {
              seen.add(key);
              distribution.locations.push({
                loc_zh: specimen.locinfo.loc || null,
                loc_en: specimen.locinfo.locE || null,
                district: specimen.locinfo.district || null,
                coordinates: {
                  lat: specimen.locinfo.Y || null,
                  lng: specimen.locinfo.X || null
                },
                country: specimen.locinfo.country || null
              });
            }
          }
        });
      }
    } catch (error) {
      // 解析失敗，忽略
    }
  }

  return distribution;
}

/**
 * 獲取單一植物的詳細資料
 */
async function getPlantDetail(plantInfo) {
  const url = `${BASE_URL}/species/${encodeURIComponent(plantInfo.code)}`;

  try {
    const html = await fetch(url);
    if (!html) {
      return null;
    }

    const dom = new JSDOM(html);
    const document = dom.window.document;

    const names = extractNames(document);
    const features = extractFeatures(document);
    const distribution = extractDistribution(html);

    return {
      code: plantInfo.code,
      names: {
        scientific: names.scientific || plantInfo.scientific_name,
        scientific_full: names.scientific_full,
        chinese: names.chinese || plantInfo.chinese_name,
        publication: names.publication,
        first_record: names.first_record,
        synonyms: names.synonyms,
        common_names: names.common_names,
        references: names.references
      },
      classification: {
        family: plantInfo.family,
        chfamily: plantInfo.chfamily,
        apgfamily: plantInfo.apgfamily,
        chapgfamily: plantInfo.chapgfamily,
        genus: plantInfo.genus,
        chgenus: plantInfo.chgenus
      },
      features,
      distribution,
      endemic_type: plantInfo.endemic_type,
      is_fern: plantInfo.fern,
      crawled_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`  獲取詳情失敗 [${plantInfo.code}]: ${error.message}`);
    return null;
  }
}

/**
 * 載入進度
 */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { completed: [], failed: [], lastIndex: 0 };
}

/**
 * 儲存進度
 */
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * 爬取所有植物詳細資料
 */
async function crawlAllPlants(plants, startIndex = 0) {
  console.log('🌿 開始爬取植物詳細資料...\n');

  const progress = loadProgress();
  const completedSet = new Set(progress.completed);

  // 開啟 JSONL 文件（追加模式）
  const writeStream = fs.createWriteStream(PLANT_DATA_FILE, { flags: 'a' });

  let successCount = progress.completed.length;
  let failCount = progress.failed.length;
  const total = plants.length;

  for (let i = startIndex; i < plants.length; i++) {
    const plant = plants[i];

    // 跳過已完成的
    if (completedSet.has(plant.code)) {
      continue;
    }

    process.stdout.write(`\r  進度: ${i + 1}/${total} | 成功: ${successCount} | 失敗: ${failCount} | ${plant.chinese_name || plant.scientific_name}`.padEnd(80));

    const detail = await getPlantDetail(plant);

    if (detail) {
      writeStream.write(JSON.stringify(detail) + '\n');
      progress.completed.push(plant.code);
      completedSet.add(plant.code);
      successCount++;
    } else {
      progress.failed.push(plant.code);
      failCount++;
    }

    progress.lastIndex = i;

    // 每 50 筆儲存一次進度
    if ((i + 1) % 50 === 0) {
      saveProgress(progress);
    }

    await delay(REQUEST_DELAY);
  }

  writeStream.end();
  saveProgress(progress);

  console.log(`\n\n✅ 爬取完成！`);
  console.log(`   成功: ${successCount}`);
  console.log(`   失敗: ${failCount}`);
  console.log(`   資料已儲存至: ${PLANT_DATA_FILE}\n`);
}

/**
 * 主函數
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  console.log('🌱 TAI2 植物資料爬蟲');
  console.log('='.repeat(60) + '\n');

  try {
    switch (command) {
      case 'list':
        // 只獲取植物列表
        await getAllPlants();
        break;

      case 'crawl':
        // 從已有列表爬取詳情
        if (!fs.existsSync(PLANT_LIST_FILE)) {
          console.log('❌ 找不到植物列表，請先執行: node crawler.js list');
          return;
        }
        const plants = JSON.parse(fs.readFileSync(PLANT_LIST_FILE, 'utf8'));
        const startIndex = parseInt(args[1]) || 0;
        await crawlAllPlants(plants, startIndex);
        break;

      case 'resume':
        // 繼續上次的爬取
        if (!fs.existsSync(PLANT_LIST_FILE)) {
          console.log('❌ 找不到植物列表，請先執行: node crawler.js list');
          return;
        }
        const plantList = JSON.parse(fs.readFileSync(PLANT_LIST_FILE, 'utf8'));
        const progress = loadProgress();
        console.log(`📂 從索引 ${progress.lastIndex} 繼續爬取...\n`);
        await crawlAllPlants(plantList, progress.lastIndex);
        break;

      case 'all':
      default:
        // 完整流程：獲取列表 + 爬取詳情
        const allPlants = await getAllPlants();
        await crawlAllPlants(allPlants);
        break;
    }
  } catch (error) {
    console.error('\n❌ 發生錯誤:', error);
  }
}

// 執行
if (require.main === module) {
  main();
}

module.exports = { getAllPlants, getPlantDetail, crawlAllPlants };
