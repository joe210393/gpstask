/**
 * Traits Parser - 從 Vision AI 回應中提取結構化特徵
 * 參考：image_traits_prompt.md
 */

const KEY_TRAITS = ['leaf_arrangement', 'leaf_shape', 'inflorescence', 'leaf_type'];
const SECONDARY_TRAITS = ['life_form', 'leaf_margin', 'flower_color'];
const GENERIC_TRAITS = new Set([
  'life_form', 'phenology', 'leaf_color', 'leaf_texture', 'stem_type',
  'root_type', 'underground_stem', 'seed_type', 'seed_color',
]);

/**
 * 從 Vision AI 回應中提取 traits JSON
 * @param {string} visionResponse - Vision AI 的原始回應
 * @returns {Object|null} 解析後的 traits 物件，如果失敗則返回 null
 */
function parseTraitsFromResponse(visionResponse) {
  if (!visionResponse || typeof visionResponse !== 'string') {
    return null;
  }

  try {
    // 方法 1: 嘗試找到 ```json ... ``` 區塊
    // 增強：支援後面跟著垃圾文字的情況
    const jsonBlockMatch = visionResponse.match(/```json\s*([\s\S]*?)```/i);
    if (jsonBlockMatch) {
      const jsonStr = jsonBlockMatch[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        return validateTraits(parsed);
      } catch (e) {
        // 如果標準解析失敗，嘗試修復 JSON（例如多餘的逗號或未閉合的括號）
        console.warn('[TraitsParser] JSON 區塊解析失敗，嘗試修復:', e.message);
      }
    }

    // 方法 2: 嘗試找到 { ... } JSON 物件（在 </reply> 之後，或任何地方）
    // 增強：尋找最後一個完整的 JSON 物件結構
    // 策略：尋找 "life_form" 附近的 { ... } 結構
    if (visionResponse.includes('"life_form"')) {
      const startIdx = visionResponse.indexOf('{');
      if (startIdx !== -1) {
        // 嘗試從這裡開始解析，直到找到合法的 JSON
        let bestParsed = null;
        let bestLen = 0;
        
        // 簡單的括號計數法來找結束點
        let bracketCount = 0;
        let inString = false;
        let escape = false;
        let endIdx = -1;
        
        for (let i = startIdx; i < visionResponse.length; i++) {
          const char = visionResponse[i];
          if (!inString) {
            if (char === '{') bracketCount++;
            else if (char === '}') {
              bracketCount--;
              if (bracketCount === 0) {
                // 找到一個潛在的完整物件
                const potentialJson = visionResponse.substring(startIdx, i + 1);
                try {
                  const parsed = JSON.parse(potentialJson);
                  // 驗證是否包含我們需要的欄位
                  if (parsed.life_form || parsed.leaf_arrangement) {
                    return validateTraits(parsed);
                  }
                } catch (e) {
                  // 忽略解析錯誤，繼續尋找更大的物件
                }
              }
            } else if (char === '"') inString = true;
          } else {
            if (escape) escape = false;
            else if (char === '\\') escape = true;
            else if (char === '"') inString = false;
          }
        }
      }
    }

    // 方法 3: 嘗試直接解析整個回應（如果整個回應就是 JSON）
    try {
      const parsed = JSON.parse(visionResponse.trim());
      return validateTraits(parsed);
    } catch (e) {
      // 不是純 JSON，繼續
    }

    return null;
  } catch (error) {
    console.warn('[TraitsParser] 解析 traits JSON 失敗:', error.message);
    return null;
  }
}

/**
 * 驗證並清理 traits 物件
 * @param {Object} traits - 原始 traits 物件
 * @returns {Object|null} 驗證後的 traits 物件
 */
function validateTraits(traits) {
  if (!traits || typeof traits !== 'object') {
    return null;
  }

  // 如果是空物件，返回 null（表示非植物）
  if (Object.keys(traits).length === 0) {
    return null;
  }

  const validTraits = [
    'life_form',
    'phenology',
    'leaf_arrangement',
    'leaf_shape',
    'leaf_type',   // 單葉/複葉（simple/compound/pinnate/palmate）
    'leaf_margin',
    'leaf_texture',
    'leaf_color',  // 葉片顏色
    'inflorescence',
    'flower_color',
    'fruit_type',
    'fruit_color',
    'root_type',  // 新增：根類型
    'stem_type',  // 新增：莖類型
    'underground_stem',  // 新增：地下莖
    'seed_type',  // 新增：種子類型
    'seed_color',  // 新增：種子顏色
    'surface_hair'
  ];

  const validated = {};
  let hasValidTrait = false;

  for (const key of validTraits) {
    if (traits[key]) {
      const trait = traits[key];
      if (trait && typeof trait === 'object' && 'value' in trait) {
        // 驗證 value 不是 "unknown" 或 confidence 太低
        if (trait.value !== 'unknown' && trait.value !== '' && 
            trait.confidence && trait.confidence > 0.3) {
          validated[key] = {
            value: trait.value,
            confidence: Math.max(0, Math.min(1, trait.confidence || 0.5)),
            evidence: trait.evidence || ''
          };
          hasValidTrait = true;
        }
      }
    }
  }

  return hasValidTrait ? validated : null;
}

/**
 * 根據 traits 判斷是否為植物
 * 參考：traits_matching_algorithm.md
 * 
 * 判斷邏輯：
 * 1. 如果有高 confidence (>=0.75) 的關鍵特徵（leaf_arrangement, leaf_shape, inflorescence），判定為植物
 * 2. 如果有中等 confidence (>=0.5) 的關鍵特徵，且總共有 2+ 個有效特徵，判定為植物
 * 3. 否則返回 false
 * 
 * @param {Object} traits - 驗證後的 traits 物件
 * @returns {Object} { is_plant: boolean, confidence: number, reason: string }
 */
function isPlantFromTraits(traits) {
  if (!traits || Object.keys(traits).length === 0) {
    return {
      is_plant: false,
      confidence: 0,
      reason: '未提取到任何植物特徵'
    };
  }

  // 關鍵特徵（高權重）：leaf_type 納入以支援棕櫚/複葉類
  const keyTraits = ['leaf_arrangement', 'leaf_shape', 'inflorescence', 'leaf_type'];

  // 次要特徵（中等權重）
  const secondaryTraits = ['life_form', 'leaf_margin', 'flower_color'];

  // leaf_type 複葉相關值（棕櫚/羽狀/掌狀等，強植物指標）
  const COMPOUND_LEAF_VALUES = new Set(['compound', 'pinnate', 'palmate', 'pinnately_compound', 'trifoliate', 'bipinnate']);

  // 檢查關鍵特徵
  let highConfidenceKeyTraits = 0;
  let mediumConfidenceKeyTraits = 0;

  for (const key of keyTraits) {
    if (traits[key]) {
      const conf = traits[key].confidence;
      const val = (traits[key].value || '').toString().toLowerCase();
      // leaf_type 的 compound/pinnate/palmate 視為強植物特徵（棕櫚類關鍵）
      if (key === 'leaf_type' && COMPOUND_LEAF_VALUES.has(val)) {
        if (conf >= 0.5) mediumConfidenceKeyTraits++;
      } else if (conf >= 0.75) {
        highConfidenceKeyTraits++;
      } else if (conf >= 0.5) {
        mediumConfidenceKeyTraits++;
      }
    }
  }

  // 計算總有效特徵數
  const totalValidTraits = Object.keys(traits).length;

  // 判斷邏輯
  if (highConfidenceKeyTraits >= 1) {
    // 有高 confidence 的關鍵特徵，判定為植物
    return {
      is_plant: true,
      confidence: 0.9,
      reason: `檢測到 ${highConfidenceKeyTraits} 個高信心度關鍵特徵（葉序/葉形/花序）`
    };
  } else if (mediumConfidenceKeyTraits >= 1 && totalValidTraits >= 2) {
    // 有中等 confidence 的關鍵特徵，且總共有 2+ 個有效特徵
    return {
      is_plant: true,
      confidence: 0.7,
      reason: `檢測到 ${mediumConfidenceKeyTraits} 個中等信心度關鍵特徵，共 ${totalValidTraits} 個有效特徵`
    };
  } else if (totalValidTraits >= 3) {
    // 總共有 3+ 個有效特徵（即使都不是關鍵特徵）
    return {
      is_plant: true,
      confidence: 0.6,
      reason: `檢測到 ${totalValidTraits} 個有效植物特徵`
    };
  } else {
    // 特徵不足，判定為非植物
    return {
      is_plant: false,
      confidence: 0.3,
      reason: `特徵不足：僅有 ${totalValidTraits} 個有效特徵，且無關鍵特徵`
    };
  }
}

/**
 * 將 traits 轉換為特徵列表（用於 hybrid_search）
 * @param {Object} traits - 驗證後的 traits 物件
 * @returns {Array<string>} 特徵列表
 */
function traitsToFeatureList(traits) {
  if (!traits || Object.keys(traits).length === 0) {
    return [];
  }

  const features = [];
  
  // 映射表：將英文 trait value 轉換為中文關鍵字
  const traitValueMap = {
    // life_form
    'tree': '喬木',
    'small_tree': '小喬木',
    'shrub': '灌木',
    'subshrub': '亞灌木',
    'herb': '草本',
    'herbaceous': '草本',  // 新增：herbaceous = herb
    'annual_herb': '一年生草本',
    'biennial_herb': '二年生草本',
    'perennial_herb': '多年生草本',
    'vine': '藤本',
    'climbing_vine': '攀緣藤本',
    'aquatic': '水生植物',
    
    // phenology
    'annual': '一年生',
    'spring_flowering': '春華',
    'biennial': '二年生',
    'perennial': '多年生',
    'annual_perennial': '一年生或多年生',  // 新增
    'evergreen': '常綠',
    'deciduous': '落葉',
    
    // leaf_arrangement
    'alternate': '互生',
    'opposite': '對生',
    'whorled': '輪生',
    'fascicled': '叢生',
    'basal': '基生',
    'clustered': '簇生',
    'spiral': '螺旋葉序',       // Vision 可能輸出 spiral
    'pinnate': '羽狀複葉',      // 葉序/葉型混用時
    'pinnately_compound': '羽狀複葉',

    // leaf_type（單葉/複葉，與 leaf_shape 區分）
    'simple': '單葉',
    'compound': '複葉',
    'trifoliate': '三出複葉',
    'palmate_compound': '掌狀複葉',
    'palmately_compound': '掌狀複葉',

    // 棕櫚/科（Vision 可能輸出 palm、arecaceae）
    'palm': '棕櫚',
    'arecaceae': '棕櫚',
    'palm_like': '棕櫚',

    // leaf_shape
    'ovate': '卵形',
    'obovate': '倒卵形',
    'lanceolate': '披針形',
    'linear': '線形',
    'linear_lanceolate': '線狀披針形',  // 新增
    'elliptic': '橢圓形',
    'oblong_elliptic': '長橢圓形',
    'orbicular': '圓形',
    'cordate': '心形',
    'reniform': '腎形',
    'triangular': '三角形',
    'rhombic': '菱形',
    'spatulate': '匙形',
    'fiddle': '提琴形',
    'palmate': '掌狀',
    'palmately_compound': '掌狀複葉',
    'acicular': '針形',
    'fan_shaped': '棕櫚',  // 棕櫚扇形葉
    
    // leaf_margin
    'entire': '全緣',
    'serrate': '鋸齒',
    'serrated': '鋸齒',  // 新增：serrated = serrate
    'undulate': '波狀緣',
    'crenate': '圓鋸齒',
    'shallow_lobed': '淺裂',
    'deep_lobed': '深裂',
    'pinnatifid': '羽狀裂',
    'palmately_lobed': '掌狀裂',
    
    // leaf_texture
    'smooth': '光滑',  // 新增
    'glabrous': '無毛',
    'pubescent': '有毛',
    'rough': '粗糙',
    'waxy': '蠟質',
    'coriaceous': '革質',  // 新增
    'leathery': '革質',    // 新增
    
    // inflorescence
    'raceme': '總狀花序',
    'racemose': '總狀花序',
    'panicle': '圓錐花序',
    'paniculate': '圓錐花序',
    'terminal_paniculate': '頂生圓錐花序',
    'corymb_cyme': '聚繖花序',
    'corymb': '繖房花序',
    'cyme': '聚繖花序',
    'spike': '穗狀花序',
    'umbel': '繖形花序',
    'capitulum': '頭狀花序',
    'head': '頭狀花序',
    'spadix_spathe': '佛焰花序',
    'catkin': '葇荑花序',
    'solitary': '單生花',
    'fascicle': '簇生花序',
    'terminal_flower': '頂生花', // 新增
    'axillary_flower': '腋生花', // 新增
    
    // flower_color (支援單一值和複數值)
    'white': '白花',
    'lavender': '淡紫色',
    'yellow': '黃花',
    'red': '紅花',
    'purple': '紫花',
    'pink': '粉紅花',
    'orange': '橙花',
    'green': '綠花',
    'blue': '藍花',
    // 複數值處理（用逗號分隔）
    'yellow, pink, orange': '黃花',  // 取第一個顏色
    'yellow, pink, white': '黃花',
    'pink, white': '粉紅花',
    'red, pink': '紅花',
    
    // fruit_type
    'drupe': '核果',
    'capsule': '蒴果',
    'achene': '瘦果',
    'berry': '漿果',
    'legume': '莢果',
    'samara': '翅果',
    'nut': '堅果',
    'pome': '梨果',
    'aggregate': '聚合果',
    'caryopsis': '穎果',
    
    // fruit_color
    'red': '紅果',
    'green': '綠果',
    'yellow': '黃果',
    'purple': '紫果',
    'black': '黑果',
    'brown': '棕果',
    'orange': '橙果',
    'green_brown': '綠棕果',
    'red_brown': '紅棕果',
    
    // leaf_color
    'green': '綠葉',
    'purple': '紫葉',
    'red': '紅葉',
    'variegated': '斑葉',
    'silver': '銀葉',
    'yellow': '黃葉',
    'green_purple': '綠紫葉',
    
    // root_type
    'taproot': '直根',
    'fibrous': '鬚根',
    'aerial': '氣生根',
    'storage': '儲藏根',
    'prop': '支柱根',
    'buttress': '板根',
    'pneumatophore': '呼吸根',
    
    // stem_type
    'woody': '木質莖',
    'herbaceous': '草質莖',
    'succulent': '肉質莖',
    'climbing': '攀緣莖',
    'creeping': '匍匐莖',
    'prostrate': '匍匐',
    'erect': '直立莖',
    
    // underground_stem
    'rhizome': '根莖',
    'bulb': '鱗莖',
    'corm': '球莖',
    'tuber': '塊莖',
    'tuberous_root': '塊根',
    
    // seed_type
    'winged': '有翅種子',
    'wingless': '無翅種子',
    'hairy': '具毛種子',
    'spiny': '具刺種子',
    
    // seed_color
    'black': '黑種子',
    'brown': '棕種子',
    'red': '紅種子',
    'yellow': '黃種子',
    'white': '白種子',
    
    // surface_hair
    'glabrous': '無毛',
    'pubescent_soft': '柔毛',
    'tomentose': '絨毛',
    'hirsute': '粗毛',
    'spiny': '有刺',
    'scaly': '鱗片'
  };

  for (const [key, trait] of Object.entries(traits)) {
    if (trait && trait.value && trait.value !== 'unknown') {
      let traitValue = trait.value;
      
      // 處理複數值（用逗號分隔的情況）
      if (typeof traitValue === 'string' && traitValue.includes(',')) {
        // 取第一個值作為主要特徵
        traitValue = traitValue.split(',')[0].trim();
      }
      
      // 處理特殊值（例如：pinkish_white → pink, green_brown → green）
      if (traitValue.includes('_')) {
        const parts = traitValue.split('_');
        // 嘗試匹配主要部分
        for (const part of parts) {
          if (traitValueMap[part]) {
            traitValue = part;
            break;
          }
        }
      }
      
      // 優先使用映射表
      const chineseKeyword = traitValueMap[traitValue];
      if (chineseKeyword) {
        // flower_color 誤塞種子顏色時丟棄（紅種子、白種子、黃種子等會干擾搜尋）
        if (key === 'flower_color' && /種子/.test(chineseKeyword)) {
          console.warn(`[TraitsParser] flower_color 含種子顏色 (${chineseKeyword})，已忽略`);
        } else {
          features.push(chineseKeyword);
        }
      } else {
        // 如果沒有映射，嘗試部分匹配
        const partialMatch = Object.keys(traitValueMap).find(k => 
          traitValue.includes(k) || k.includes(traitValue)
        );
        if (partialMatch) {
          features.push(traitValueMap[partialMatch]);
          console.log(`[TraitsParser] ${key}=${trait.value} 使用部分匹配: ${partialMatch} → ${traitValueMap[partialMatch]}`);
        } else {
          // 如果還是沒有映射，不要使用原始 value，因為這會干擾 embedding 搜尋
          // 英文特徵會導致中文資料庫匹配失敗
          console.warn(`[TraitsParser] 未找到 ${key}=${trait.value} 的中文映射，已忽略此特徵`);
        }
      }
    }
  }

  // 矛盾處理 v0：羽狀/掌狀複葉與單葉互斥，保留複葉（區辨力較高）
  const COMPOUND_LEAF_TOKENS = ['羽狀複葉', '掌狀複葉', '二回羽狀', '三出複葉', '複葉'];
  const hasCompound = COMPOUND_LEAF_TOKENS.some((t) => features.includes(t));
  if (hasCompound && features.includes('單葉')) {
    features = features.filter((f) => f !== '單葉');
    console.log('[TraitsParser] 矛盾處理: 有複葉特徵，已移除「單葉」');
  }

  return features;
}

function average(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, cur) => acc + cur, 0);
  return sum / values.length;
}

/** 高頻、低區辨力的中文特徵（value 層級） */
const GENERIC_VALUES = new Set([
  '互生', '對生', '喬木', '灌木', '草本', '全緣', '鋸齒', '卵形', '橢圓形', '披針形',
  '常綠', '落葉', '革質', '光滑', '無毛', '木質莖', '草質莖', '基生', '輪生', '叢生', '簇生'
]);

function evaluateTraitQuality(traits) {
  if (!traits || Object.keys(traits).length === 0) {
    return {
      quality: 0,
      coverage: 0,
      keyAverage: 0,
      secondaryAverage: 0,
      totalValidTraits: 0,
      genericRatio: 1
    };
  }

  const totalValidTraits = Object.keys(traits).length;
  const coverage = Math.min(1, totalValidTraits / 6);

  const getConfidence = (key) => {
    if (!traits[key]) return 0;
    return Math.max(0, Math.min(1, traits[key].confidence || 0));
  };

  const getEffectiveConfidence = (key) => {
    if (key === 'flower_color' && traits[key]) {
      const val = (traits[key].value || '').toString();
      if (/種子|籽|葉/.test(val)) return 0;
    }
    return getConfidence(key);
  };

  const keyConfs = KEY_TRAITS.map(getEffectiveConfidence).filter(c => c > 0);
  const secondaryConfs = SECONDARY_TRAITS.map(getEffectiveConfidence).filter(c => c > 0);
  const keyAverage = average(keyConfs);
  const secondaryAverage = average(secondaryConfs);
  const avgConf = keyConfs.length > 0 ? keyAverage : secondaryAverage;

  const features = traitsToFeatureList(traits);
  const genericCount = features.filter((f) => GENERIC_VALUES.has(f)).length;
  const genericRatio = features.length > 0 ? genericCount / features.length : 1;

  const conf = Math.max(0, Math.min(1, (avgConf - 0.45) / 0.35));
  const spec = 1 - Math.max(0, Math.min(1, (genericRatio - 0.4) / 0.5));
  const quality = Math.max(0, Math.min(1, 0.4 * coverage + 0.4 * conf + 0.2 * spec));

  return {
    quality,
    coverage,
    keyAverage,
    secondaryAverage,
    totalValidTraits,
    genericRatio
  };
}

/**
 * 當 traits JSON 解析失敗時，從 LM 描述文字擷取強特徵關鍵字
 * 目的：讓棕櫚/果實/花序等 case 仍能進 hybrid（否則會 fallback 到純 embedding）
 * @param {string} description - Vision/LM 的完整描述
 * @returns {string[]} 特徵列表，若無匹配則返回空陣列
 */
function extractFeaturesFromDescriptionKeywords(description) {
  if (!description || typeof description !== 'string') return [];
  const text = description;
  const features = [];

  // 棕櫚/複葉相關（優先，區辨力高）
  if (/棕櫚|扇形|羽片|叢生|棕櫚科|棕櫚幹/.test(text)) {
    features.push('棕櫚');
  }
  if (/羽狀複葉|羽狀裂|羽狀/.test(text)) {
    features.push('羽狀複葉');
  }
  if (/掌狀複葉|掌狀裂|掌狀深裂/.test(text)) {
    features.push('掌狀複葉');
  }
  if (/二回羽狀/.test(text)) features.push('二回羽狀');
  if (/三出複葉|三出/.test(text)) features.push('三出複葉');

  // 果實相關（火筒樹、西印度櫻桃、金露花等）
  if (/漿果|多漿果/.test(text)) features.push('漿果');
  if (/核果/.test(text)) features.push('核果');
  if (/蒴果/.test(text)) features.push('蒴果');
  if (/紅色果實|紅果|鮮紅色果|紫黑色果|深紅/.test(text) && !features.includes('漿果') && !features.includes('核果')) {
    features.push('漿果'); // 紅色果實多為漿果
  }

  // 花序類型（長穗木=穗狀、菊科=頭狀等）
  if (/穗狀花序|穗狀/.test(text)) features.push('穗狀花序');
  if (/頭狀花序|頭狀/.test(text)) features.push('頭狀花序');
  if (/繖形花序|繖形|繖房/.test(text)) features.push('繖形花序');

  // 葉緣（鋸齒 vs 全緣 可拉開差距）
  if (/鋸齒|鋸齒緣|粗鋸齒/.test(text)) features.push('鋸齒');

  return features;
}

module.exports = {
  parseTraitsFromResponse,
  validateTraits,
  isPlantFromTraits,
  traitsToFeatureList,
  evaluateTraitQuality,
  extractFeaturesFromDescriptionKeywords
};
