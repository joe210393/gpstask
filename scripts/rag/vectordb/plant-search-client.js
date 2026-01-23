/**
 * 植物向量搜尋 Client
 * 用於 Node.js server 呼叫 Embedding API
 *
 * 功能：
 * 1. 智慧搜尋：自動判斷是否為植物，只有植物才搜尋
 * 2. 分類查詢：判斷輸入是植物/動物/人造物/食物/其他
 *
 * 使用方式：
 *   const { smartSearch, classify } = require('./plant-search-client');
 *   const results = await smartSearch('紅色的花');
 */

const EMBEDDING_API_URL =
  process.env.EMBEDDING_API_URL || 'http://localhost:8100';

/**
 * 健康檢查
 */
async function healthCheck() {
  try {
    const response = await fetch(`${EMBEDDING_API_URL}/health`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 分類查詢
 * @param {string} query - 要分類的文字
 * @returns {Promise<Object>} 分類結果
 *
 * 返回格式：
 * {
 *   category: "plant" | "animal" | "artifact" | "food" | "other",
 *   confidence: 0.xx,
 *   is_plant: true/false,
 *   plant_score: 0.xx
 * }
 */
async function classify(query) {
  try {
    const response = await fetch(`${EMBEDDING_API_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Classify error:', error.message);
    return { category: 'other', confidence: 0, is_plant: false, plant_score: 0 };
  }
}

/**
 * 智慧搜尋植物
 * 會先判斷是否為植物相關查詢，只有植物才搜尋
 *
 * @param {string} query - 搜尋關鍵字（支援自然語言）
 * @param {number} topK - 返回結果數量（預設 5）
 * @returns {Promise<Object>} 搜尋結果
 *
 * 返回格式：
 * {
 *   query: "...",
 *   classification: { category, is_plant, plant_score, ... },
 *   results: [...],  // 只有 is_plant=true 時才有資料
 *   message: "..."
 * }
 */
async function smartSearch(query, topK = 5) {
  try {
    const response = await fetch(`${EMBEDDING_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, smart: true }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Smart search error:', error.message);
    return {
      query,
      classification: { category: 'other', is_plant: false },
      results: [],
      message: `搜尋失敗: ${error.message}`,
    };
  }
}

/**
 * 直接搜尋植物（不做分類判斷）
 * @param {string} query - 搜尋關鍵字
 * @param {number} topK - 返回結果數量
 */
async function searchPlants(query, topK = 5) {
  try {
    const response = await fetch(`${EMBEDDING_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, smart: false }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[PlantSearch] Search error:', error.message);
    return [];
  }
}

/**
 * 根據植物代碼獲取詳細資訊 URL
 */
function getPlantDetailUrl(code) {
  const encodedCode = encodeURIComponent(code);
  return `https://tai2.ntu.edu.tw/species/${encodedCode}`;
}

/**
 * 格式化搜尋結果為文字
 */
function formatResults(results) {
  if (!results || results.length === 0) {
    return '沒有找到相關植物';
  }

  return results
    .map((r, i) => {
      return `${i + 1}. ${r.chinese_name || '未知'} (${r.scientific_name})\n   科：${r.family} | 相似度：${(r.score * 100).toFixed(1)}%`;
    })
    .join('\n\n');
}

module.exports = {
  healthCheck,
  classify,
  smartSearch,
  searchPlants,
  getPlantDetailUrl,
  formatResults,
  EMBEDDING_API_URL,
};
