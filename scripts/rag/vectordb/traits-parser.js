/**
 * Traits Parser - 從 Vision AI 回應中提取結構化特徵
 * 參考：image_traits_prompt.md
 */

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
    const jsonBlockMatch = visionResponse.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonBlockMatch) {
      const jsonStr = jsonBlockMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      return validateTraits(parsed);
    }

    // 方法 2: 嘗試找到 { ... } JSON 物件（在 </reply> 之後）
    const replyEndIndex = visionResponse.indexOf('</reply>');
    if (replyEndIndex !== -1) {
      const afterReply = visionResponse.substring(replyEndIndex + 7);
      const jsonMatch = afterReply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateTraits(parsed);
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

  // 定義有效的 trait keys（包含所有特徵）
  const validTraits = [
    'life_form',
    'phenology',
    'leaf_arrangement',
    'leaf_shape',
    'leaf_margin',
    'leaf_texture',
    'leaf_color',  // 新增：葉片顏色
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

  // 關鍵特徵（高權重）
  const keyTraits = ['leaf_arrangement', 'leaf_shape', 'inflorescence'];
  
  // 次要特徵（中等權重）
  const secondaryTraits = ['life_form', 'leaf_margin', 'flower_color'];
  
  // 檢查關鍵特徵
  let highConfidenceKeyTraits = 0;
  let mediumConfidenceKeyTraits = 0;
  
  for (const key of keyTraits) {
    if (traits[key]) {
      const conf = traits[key].confidence;
      if (conf >= 0.75) {
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
    'acicular': '針形',
    
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
    'panicle': '圓錐花序',
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
        features.push(chineseKeyword);
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

  return features;
}

module.exports = {
  parseTraitsFromResponse,
  validateTraits,
  isPlantFromTraits,
  traitsToFeatureList
};
