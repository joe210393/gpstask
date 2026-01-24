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

const EMBEDDING_API_TIMEOUT_MS = Number(process.env.EMBEDDING_API_TIMEOUT_MS || 8000);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 健康檢查
 */
async function healthCheck() {
  try {
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/health`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: error.message, url: EMBEDDING_API_URL };
  }
}

/**
 * Qdrant/collection 統計（用於確認向量是否已建）
 */
async function stats() {
  try {
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/stats`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, url: EMBEDDING_API_URL };
    }
    return await response.json();
  } catch (error) {
    return { ok: false, error: error.message, url: EMBEDDING_API_URL };
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
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Classify error:', error.message, 'url=', EMBEDDING_API_URL);
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
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, smart: true }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Smart search error:', error.message, 'url=', EMBEDDING_API_URL);
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
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/search`, {
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
    console.error('[PlantSearch] Search error:', error.message, 'url=', EMBEDDING_API_URL);
    return [];
  }
}

/**
 * 取得 Vision AI 用的結構化 Prompt
 */
async function getVisionPrompt() {
  try {
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/vision-prompt`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Get vision prompt error:', error.message, 'url=', EMBEDDING_API_URL);
    return null;
  }
}

/**
 * 混合搜尋：結合 embedding + 特徵權重
 * @param {Object} options - 搜尋選項
 * @param {string} options.query - 自然語言描述
 * @param {string[]} options.features - Vision AI 提取的特徵
 * @param {string[]} options.guessNames - Vision AI 猜測的植物名稱
 * @param {number} options.topK - 返回結果數量
 */
async function hybridSearch({ query = '', features = [], guessNames = [], topK = 5 }) {
  try {
    const response = await fetchWithTimeout(`${EMBEDDING_API_URL}/hybrid-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        features,
        guess_names: guessNames,
        top_k: topK,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[PlantSearch] Hybrid search error:', error.message, 'url=', EMBEDDING_API_URL);
    return {
      query,
      features,
      guess_names: guessNames,
      results: [],
      error: error.message,
    };
  }
}

/**
 * 解析 Vision AI 的 JSON 回應
 * @param {string} visionResponse - Vision AI 的原始回應
 */
function parseVisionResponse(visionResponse) {
  try {
    // 嘗試直接解析 JSON
    const parsed = JSON.parse(visionResponse);
    return {
      success: true,
      intent: parsed.intent || 'unknown',
      confidence: parsed.confidence || 0,
      shortCaption: parsed.short_caption || '',
      plant: parsed.plant || { guess_names: [], features: [] },
      general: parsed.general || { keywords: [] },
    };
  } catch (e) {
    // 嘗試從文字中提取 JSON
    const jsonMatch = visionResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          intent: parsed.intent || 'unknown',
          confidence: parsed.confidence || 0,
          shortCaption: parsed.short_caption || '',
          plant: parsed.plant || { guess_names: [], features: [] },
          general: parsed.general || { keywords: [] },
        };
      } catch (e2) {
        // ignore
      }
    }
    return {
      success: false,
      intent: 'unknown',
      confidence: 0,
      shortCaption: visionResponse.substring(0, 100),
      plant: { guess_names: [], features: [] },
      general: { keywords: [] },
      rawText: visionResponse,
    };
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
  stats,
  classify,
  smartSearch,
  searchPlants,
  hybridSearch,
  getVisionPrompt,
  parseVisionResponse,
  getPlantDetailUrl,
  formatResults,
  EMBEDDING_API_URL,
};
