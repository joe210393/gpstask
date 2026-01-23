/**
 * 使用 AI 提取植物識別重點
 * 從形態特徵中提取結構化的識別資訊
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'plants.jsonl');
const OUTPUT_FILE = path.join(DATA_DIR, 'plants-enriched.jsonl');
const PROGRESS_FILE = path.join(DATA_DIR, 'extract-progress.json');

// LM Studio API 設定
const API_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
const MODEL = process.env.LM_MODEL || 'google/gemma-3-27b';

// 請求延遲（毫秒）
const REQUEST_DELAY = 500;

// 提取識別重點的 System Prompt
const SYSTEM_PROMPT = `You are a botanist assistant. Extract plant identification features from the given morphological description.

Output ONLY valid JSON with this exact structure (use null for missing info):
{
  "morphology": {
    "leaf": {
      "shape": "葉形 (e.g., lanceolate, ovate, elliptic)",
      "arrangement": "葉序 (e.g., alternate, opposite, whorled)",
      "margin": "葉緣 (e.g., entire, serrate, dentate)",
      "venation": "葉脈 (e.g., pinnate, palmate)",
      "color": "葉色",
      "size": "葉大小"
    },
    "flower": {
      "shape": "花形",
      "color": "花色",
      "size": "花大小",
      "inflorescence": "花序 (e.g., raceme, panicle, umbel)",
      "season": "花期"
    },
    "fruit": {
      "type": "果實類型 (e.g., capsule, berry, drupe)",
      "shape": "果形",
      "color": "果色",
      "size": "果大小"
    },
    "stem": {
      "type": "莖類型",
      "height": "高度",
      "bark": "樹皮特徵"
    },
    "root": {
      "type": "根型"
    }
  },
  "ecology": {
    "habitat": "生長環境 (e.g., forest, grassland, wetland, coast)",
    "elevation": "海拔分布",
    "soil": "土壤類型",
    "light": "光照需求"
  },
  "identification": {
    "key_features": ["獨特識別特徵1", "獨特識別特徵2"],
    "similar_species": "容易混淆的物種",
    "seasonal_features": "季節性特徵"
  }
}`;

/**
 * 呼叫 LM Studio API
 */
async function callLMStudio(userPrompt) {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 從 AI 回應中解析 JSON
 */
function parseAIResponse(response) {
  try {
    // 嘗試直接解析
    return JSON.parse(response);
  } catch (e) {
    // 嘗試提取 JSON 部分
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

/**
 * 延遲函數
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 載入進度
 */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { processed: [], lastIndex: 0 };
}

/**
 * 儲存進度
 */
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * 主函數
 */
async function main() {
  console.log('🌿 開始提取植物識別重點\n');
  console.log(`API: ${API_URL}`);
  console.log(`模型: ${MODEL}\n`);
  console.log('='.repeat(60));

  // 載入進度
  const progress = loadProgress();
  const processedSet = new Set(progress.processed);

  // 讀取所有植物資料
  const plants = [];
  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      plants.push(JSON.parse(line));
    }
  }

  console.log(`\n總共 ${plants.length} 筆植物資料`);

  // 篩選有特徵描述的植物
  const plantsWithFeatures = plants.filter(p => p.features?.has_data);
  console.log(`有特徵描述: ${plantsWithFeatures.length} 筆`);
  console.log(`已處理: ${processedSet.size} 筆`);
  console.log(`待處理: ${plantsWithFeatures.length - processedSet.size} 筆\n`);

  // 開啟輸出檔案
  const writeStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];

    // 跳過已處理的
    if (processedSet.has(plant.code)) {
      skipCount++;
      continue;
    }

    // 如果沒有特徵描述，直接寫入原始資料
    if (!plant.features?.has_data) {
      plant.identification = null;
      writeStream.write(JSON.stringify(plant) + '\n');
      progress.processed.push(plant.code);
      processedSet.add(plant.code);
      continue;
    }

    const plantName = plant.names?.chinese || plant.names?.scientific || plant.code;
    process.stdout.write(`\r處理中: ${i + 1}/${plants.length} | 成功: ${successCount} | 失敗: ${failCount} | ${plantName}`.padEnd(80));

    try {
      // 建立 user prompt
      const morphologyText = plant.features.morphology?.join('\n') || '';
      const lifeForm = plant.features.life_form || '';

      const userPrompt = `Plant: ${plant.names?.scientific || ''} (${plant.names?.chinese || ''})
Life form: ${lifeForm}
Family: ${plant.classification?.family || ''} (${plant.classification?.chfamily || ''})

Morphological description:
${morphologyText}

Extract the identification features from the above description.`;

      // 呼叫 AI
      const response = await callLMStudio(userPrompt);
      const identification = parseAIResponse(response);

      if (identification) {
        plant.identification = identification;
        successCount++;
      } else {
        plant.identification = null;
        failCount++;
      }

    } catch (error) {
      console.error(`\n錯誤 [${plantName}]: ${error.message}`);
      plant.identification = null;
      failCount++;
    }

    // 寫入結果
    writeStream.write(JSON.stringify(plant) + '\n');
    progress.processed.push(plant.code);
    processedSet.add(plant.code);

    // 每 50 筆儲存進度
    if ((successCount + failCount) % 50 === 0) {
      saveProgress(progress);
    }

    await delay(REQUEST_DELAY);
  }

  writeStream.end();
  saveProgress(progress);

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('✅ 提取完成！');
  console.log(`   成功: ${successCount}`);
  console.log(`   失敗: ${failCount}`);
  console.log(`   跳過: ${skipCount}`);
  console.log(`   輸出: ${OUTPUT_FILE}\n`);
}

// 測試模式
async function testOne() {
  console.log('🧪 測試模式 - 提取一筆資料\n');

  // 讀取第一筆有特徵的植物
  const fileStream = fs.createReadStream(INPUT_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let testPlant = null;
  for await (const line of rl) {
    if (line.trim()) {
      const plant = JSON.parse(line);
      if (plant.features?.has_data && plant.features?.morphology?.length >= 2) {
        testPlant = plant;
        break;
      }
    }
  }

  if (!testPlant) {
    console.log('找不到有特徵描述的植物');
    return;
  }

  console.log('測試植物:', testPlant.names?.chinese || testPlant.names?.scientific);
  console.log('形態特徵:');
  testPlant.features.morphology.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.substring(0, 60)}...`);
  });
  console.log('\n呼叫 AI 提取識別重點...\n');

  try {
    const morphologyText = testPlant.features.morphology?.join('\n') || '';
    const lifeForm = testPlant.features.life_form || '';

    const userPrompt = `Plant: ${testPlant.names?.scientific || ''} (${testPlant.names?.chinese || ''})
Life form: ${lifeForm}
Family: ${testPlant.classification?.family || ''} (${testPlant.classification?.chfamily || ''})

Morphological description:
${morphologyText}

Extract the identification features from the above description.`;

    const response = await callLMStudio(userPrompt);
    console.log('AI 回應:');
    console.log(response);

    const identification = parseAIResponse(response);
    if (identification) {
      console.log('\n✅ 解析成功！');
      console.log(JSON.stringify(identification, null, 2));
    } else {
      console.log('\n❌ 解析失敗');
    }

  } catch (error) {
    console.error('錯誤:', error.message);
  }
}

// 執行
const args = process.argv.slice(2);
if (args[0] === 'test') {
  testOne();
} else {
  main();
}
