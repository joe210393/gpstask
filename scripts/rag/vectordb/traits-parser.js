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

/** 果實類型允許值（英文/中文） */
const ALLOWED_FRUIT_TYPES = new Set([
  'unknown', 'berry', 'drupe', 'capsule', 'legume', 'samara', 'achene', 'nut', 'pome',
  '漿果', '核果', '蒴果', '莢果', '翅果', '瘦果', '堅果', '梨果'
]);

/** evidence 必須包含果實關鍵字，否則視為猜測（避免 \b 在 CJK 邊界問題） */
const EVIDENCE_FRUIT_REQUIRED = /果實|結實|漿果|核果|蒴果|莢果|果/;

/**
 * 果實可見性降級：當證據不足時強制 fruit_type / fruit_color 為 unknown
 * 規則：fruit_visible=false → 強制 unknown；fruit_type!=unknown 但 evidence 不含果 → 強制 unknown
 * @param {Object} traits - 原始 traits（會就地修改）
 */
function applyFruitVisibilityDowngrade(traits) {
  if (!traits || typeof traits !== 'object') return;
  const fv = traits.fruit_visible;
  const fvVal = (fv && typeof fv.value === 'string') ? fv.value.toLowerCase().trim() : '';
  const explicitlyNotVisible = fvVal === 'false' || fvVal === '0';

  // 規則 1：fruit_visible 明確為 false → 強制 unknown
  if (explicitlyNotVisible && (traits.fruit_type || traits.fruit_color)) {
    if (traits.fruit_type) {
      traits.fruit_type = { value: 'unknown', confidence: 0.1, evidence: traits.fruit_type.evidence || 'fruit_visible=false，強制降級' };
    }
    if (traits.fruit_color) {
      traits.fruit_color = { value: 'unknown', confidence: 0.1, evidence: traits.fruit_color.evidence || 'fruit_visible=false，強制降級' };
    }
    return;
  }

  const ft = traits.fruit_type;
  if (!ft || !ft.value || String(ft.value).toLowerCase() === 'unknown') return;

  const val = String(ft.value).toLowerCase().trim();
  const evidence = String(ft.evidence || '');

  // 規則 2：evidence 不含 果/果實/結實 → 強制 unknown
  if (!EVIDENCE_FRUIT_REQUIRED.test(evidence)) {
    traits.fruit_type = { value: 'unknown', confidence: 0.2, evidence: evidence || 'evidence 缺乏果實關鍵字，強制降級' };
    if (traits.fruit_color) {
      traits.fruit_color = { value: 'unknown', confidence: 0.2, evidence: traits.fruit_color.evidence || '與 fruit_type 連動降級' };
    }
    return;
  }

  // 規則 3：fruit_type 值不在允許集合 → unknown
  const normalizedVal = val.replace(/\s/g, '');
  if (!ALLOWED_FRUIT_TYPES.has(val) && !ALLOWED_FRUIT_TYPES.has(normalizedVal)) {
    traits.fruit_type = { value: 'unknown', confidence: 0.2, evidence: 'fruit_type 不在允許集合，強制降級' };
    if (traits.fruit_color) {
      traits.fruit_color = { value: 'unknown', confidence: 0.2, evidence: traits.fruit_color.evidence || '與 fruit_type 連動降級' };
    }
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

  // 果實可見性降級（在主要驗證前執行）
  applyFruitVisibilityDowngrade(traits);

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
    'flower_shape',  // 鐘形花（風鈴草等）
    'flower_position',  // 單生/成對/簇生
    'inflorescence_orientation',  // 直立/下垂
    'fruit_type',
    'fruit_color',
    'fruit_arrangement',  // 果實排列（向後兼容）
    'fruit_cluster',  // 果實排列（單生/成串/總狀/腋生）
    'fruit_surface',  // 果面（光滑/有毛/粗糙/有棱）
    'calyx_persistent',  // 萼宿存
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
    'alternating': '互生',  // 變體
    'opposite': '對生',
    'opposite_decussate': '對生',  // 變體
    'whorled': '輪生',
    'verticillate': '輪生',  // 變體
    'fascicled': '叢生',
    'basal': '基生',
    'clustered': '簇生',
    'spiral': '螺旋葉序',       // Vision 可能輸出 spiral
    'spirally_arranged': '螺旋葉序',  // 變體
    'pinnate': '羽狀複葉',      // 葉序/葉型混用時（注意：這應該對應到 leaf_type，但保留以兼容）
    'pinnately_compound': '羽狀複葉',

    // leaf_type（單葉/複葉，與 leaf_shape 區分）
    'simple': '單葉',
    'compound': '複葉',
    'trifoliate': '三出複葉',
    'trifoliolate': '三出複葉',  // 變體
    'palmate_compound': '掌狀複葉',
    'palmately_compound': '掌狀複葉',
    'bipinnate': '二回羽狀',  // 新增：二回羽狀複葉
    'bipinnately_compound': '二回羽狀',  // 新增
    'pinnately_compound': '羽狀複葉',  // 新增：明確的羽狀複葉

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
    'smooth': '全緣',  // 新增：smooth margin = entire
    'serrate': '鋸齒',
    'serrated': '鋸齒',
    'dentate': '鋸齒',  // 新增：齒狀（類似鋸齒）
    'denticulate': '細鋸齒',  // 新增：細鋸齒
    'undulate': '波狀緣',
    'wavy': '波狀',  // 新增：wavy = undulate
    'crenate': '圓鋸齒',
    'crenulate': '細圓鋸齒',  // 新增
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
    'racemous': '總狀花序',  // 變體
    'panicle': '圓錐花序',
    'paniculate': '圓錐花序',
    'terminal_paniculate': '頂生圓錐花序',
    'corymb_cyme': '聚繖花序',
    'corymb': '繖房花序',
    'corymbose': '繖房花序',  // 變體
    'cyme': '聚繖花序',
    'cymose': '聚繖花序',  // 變體
    'spike': '穗狀花序',
    'spicate': '穗狀花序',  // 變體
    'umbel': '繖形花序',
    'umbellate': '繖形花序',  // 變體
    'capitulum': '頭狀花序',
    'head': '頭狀花序',
    'spadix_spathe': '佛焰花序',
    'spadix': '佛焰花序',  // 簡化形式
    'catkin': '葇荑花序',
    'ament': '葇荑花序',  // 同義詞
    'solitary': '單生花',
    'fascicle': '簇生花序',
    'terminal_flower': '頂生花',
    'axillary_flower': '腋生花',
    'pendulous': '下垂花序',  // 新增：下垂花序（長穗木等）
    'drooping': '下垂花序',  // 新增：下垂花序
    
    // flower_color (支援單一值和複數值)
    'white': '白花',
    'lavender': '紫花',  // 淡紫色 → 紫花
    'lilac': '紫花',  // 淡紫色 → 紫花
    'violet': '紫花',  // 紫羅蘭色 → 紫花
    'yellow': '黃花',
    'red': '紅花',
    'purple': '紫花',
    'deep_purple': '紫花',  // 深紫色 → 紫花
    'dark_purple': '紫花',  // 深紫色 → 紫花
    'pink': '粉紅花',
    'pinkish': '粉紅花',  // 粉紅色 → 粉紅花
    'rose': '粉紅花',  // 玫瑰色 → 粉紅花
    'orange': '橙花',
    'green': '綠花',
    'blue': '藍花',
    'blue_purple': '紫花',  // 藍紫色 → 紫花
    'purple_blue': '紫花',  // 紫藍色 → 紫花
    // 複數值處理（用逗號分隔）
    'yellow, pink, orange': '黃花',  // 取第一個顏色
    'yellow, pink, white': '黃花',
    'pink, white': '粉紅花',
    'red, pink': '粉紅花',  // 紅粉 → 粉紅花（野牡丹常見）
    'purple, pink': '粉紅花',  // 紫粉 → 粉紅花（野牡丹常見）
    'deep_purple, pink': '粉紅花',  // 深紫粉 → 粉紅花
    
    // flower_shape（鐘形花：風鈴草等）
    'bell': '鐘形花',
    'campanulate': '鐘形花',
    'tubular': '鐘形花',
    'bell-shaped': '鐘形花',
    'bell shape': '鐘形花',
    'bellshaped': '鐘形花',
    'campanula': '鐘形花',
    'funnel': '漏斗形花',
    'labiate': '唇形花',
    'papilionaceous': '蝶形花',
    'cruciform': '十字形花',
    'radial': '放射狀花',
    
    // flower_position（花位置）
    'solitary': '單生花',
    'pair': '成對花',
    'cluster': '簇生花',
    
    // inflorescence_orientation（花序方向）
    'erect': '直立花序',
    'drooping': '下垂花序',
    
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
    
    // fruit_cluster（果實排列）
    'solitary': '單生果',
    'cluster': '成串果',
    'raceme': '總狀果',
    'axillary': '腋生果',
    
    // fruit_surface（果面）
    'smooth': '光滑果',
    'hairy': '有毛果',
    'rough': '粗糙果',
    'ridged': '有棱果',
    
    // calyx_persistent（萼宿存）
    'true': '宿存萼',
    'false': '非宿存萼',
    
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

  // B: 強特徵門檻 - fruit/inflo/special/trunk/flower_color 需 ≥ 0.55，其餘 ≥ 0.35；evidence < 6 字 → ×0.8
  // 花色（特別是紫花、粉紅花）對野牡丹等植物鑑別力高，提升為強特徵
  const STRONG_TRAIT_KEYS = new Set(['fruit_type', 'inflorescence', 'flower_shape', 'flower_color', 'root_type', 'special_features', 'surface_hair']);
  const WEAK_MIN = 0.35;
  const STRONG_MIN = 0.55;
  // 部分 key 需要稍微放寬門檻（例如 flower_shape：LM 常給 0.45–0.5，但對風鈴草非常關鍵）
  const PER_KEY_MIN_CONF = {
    // 直接放寬到 0.30，只要不是 unknown 就盡量保留
    flower_shape: 0.30,
  };

  for (const [key, trait] of Object.entries(traits)) {
    if (trait && trait.value && trait.value !== 'unknown') {
      let conf = Math.max(0, Number(trait.confidence) || 0);
      const evidence = String(trait.evidence || '').trim();
      if (evidence.length > 0 && evidence.length < 6) conf *= 0.8;
      const baseMinConf = STRONG_TRAIT_KEYS.has(key) ? STRONG_MIN : WEAK_MIN;
      const minConf = PER_KEY_MIN_CONF[key] != null ? PER_KEY_MIN_CONF[key] : baseMinConf;
      if (conf < minConf) continue;

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
        const STRONG_OUTPUTS = new Set(['有刺', '乳汁', '棕櫚', '胎生苗', '氣生根', '板根']);
        const reqMin = STRONG_OUTPUTS.has(chineseKeyword) ? STRONG_MIN : minConf;
        if (conf < reqMin) continue;
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
          const kw = traitValueMap[partialMatch];
          const reqMin2 = (new Set(['有刺','乳汁','棕櫚','胎生苗','氣生根','板根'])).has(kw) ? STRONG_MIN : minConf;
          if (conf < reqMin2) { /* skip */ } else {
            features.push(kw);
            console.log(`[TraitsParser] ${key}=${trait.value} 使用部分匹配: ${partialMatch} → ${kw}`);
          }
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
 * 從 LM 描述文字擷取強特徵關鍵字（keyword-assist）
 * 目的：讓棕櫚/果實/花序等 case 進 hybrid，與 traits 合併後使用
 * 規則：D1 強特徵優先、花序只留1個、fruit 需果 guard；D2 羽狀裂≠羽狀複葉
 * @param {string} description - Vision/LM 的完整描述
 * @returns {string[]} 特徵列表
 */
function extractFeaturesFromDescriptionKeywords(description) {
  if (!description || typeof description !== 'string') return [];
  const text = description;
  const features = [];

  // D2 避坑：羽狀裂、羽狀葉脈 為葉緣，不當羽狀複葉
  const hasPinnatifid = /羽狀裂|羽狀葉脈/.test(text);

  // A1 棕櫚/複葉（優先，依具體→泛用；棕櫚屬=棕櫚科）
  if (/棕櫚|扇形|羽片|棕櫚科|棕櫚屬|棕櫚幹/.test(text)) features.push('棕櫚');
  if (/二回羽狀|二回複葉/.test(text)) features.push('二回羽狀');
  else if (/三出複葉|三小葉|三出/.test(text)) features.push('三出複葉');
  else if (/掌狀複葉|掌狀裂|掌狀深裂|小葉放射狀/.test(text)) features.push('掌狀複葉');
  else if (!hasPinnatifid && /羽狀複葉|小葉成對排列|小葉密集排列|羽狀[^裂葉脈]/.test(text)) features.push('羽狀複葉');
  else if (/複葉/.test(text)) features.push('複葉'); // D1: 有強複葉則上面已加，不會到這裡

  // 扇形葉、扇狀葉 → 棕櫚（棕竹等）
  if (/扇形葉|扇狀葉|扇形裂片/.test(text) && !features.includes('棕櫚')) features.push('棕櫚');

  // A2 果實（fruit_color 需搭配 果/果實/結實/成熟）
  const hasFruitContext = /果實|結實|成熟|紅果|橙紅.*果|小果實/.test(text);
  if (/漿果|多漿果/.test(text)) features.push('漿果');
  else if (/核果/.test(text)) features.push('核果');
  else if (/蒴果|朔果/.test(text)) features.push('蒴果'); // 朔果=錯字
  else if (/翅果|具翅/.test(text)) features.push('翅果');
  else if (hasFruitContext && !features.includes('漿果') && !features.includes('核果')) {
    // 果實...紅色 / 成熟...紅色 / 紅色...果實（雙向）均可觸發漿果
    if (/(?:紅色|鮮紅|紫黑|深紅|橙紅)[色的]*(?:果實|果)|紅果|橙紅色的果實|橙紅.*果實/.test(text)) features.push('漿果');
    else if (/(?:果實|果).*(?:紅色|鮮紅|橙紅|紫黑|鮮豔)/.test(text)) features.push('漿果');
    else if (/成熟.*(?:紅色|鮮紅|橙紅|紫黑)|變成.*(?:紅色|鮮紅).*果/.test(text)) features.push('漿果');
    // LM 常寫「綠色的小果實」「小果實」「葉腋處綠色果實」→ 多為漿果型，補進 Query 以提升鑑別
    else if (/(?:綠色[的]?小?果實|小果實|果實.*綠色|綠色的?[小]?果實)/.test(text)) features.push('漿果');
  }
  
  // A2.1 果實排列（單生/成串/總狀/腋生）
  if (/成串|串狀|總狀.*果|果實.*成串|果實.*串生/.test(text)) features.push('成串果');
  else if (/單生.*果|單果|一個果實/.test(text)) features.push('單生果');
  else if (/腋生.*果|葉腋.*果|果實.*腋生/.test(text)) features.push('腋生果');
  
  // A2.2 果面（光滑/有毛/粗糙/有棱）
  if (/果實.*有毛|果面.*毛|毛果/.test(text)) features.push('有毛果');
  else if (/果實.*光滑|光滑.*果|果面.*光滑/.test(text)) features.push('光滑果');
  else if (/果實.*粗糙|粗糙.*果|果面.*粗糙/.test(text)) features.push('粗糙果');
  else if (/果實.*棱|有棱.*果|果面.*棱/.test(text)) features.push('有棱果');
  
  // A2.3 萼宿存（萼是否宿存）
  if (/宿存萼|萼.*宿存|果實.*宿存.*萼/.test(text)) features.push('宿存萼');

  // A2.5 花型（鐘形花：風鈴草等，LM 常寫鐘形/吊鐘/鈴鐺狀/風鈴狀）
  // 注意：TLPG / LM 描述裡常出現「風鈴狀花」「風鈴形花」，這裡一律視為鐘形花處理
  if (/鐘形|吊鐘|鈴鐺狀|鐘狀|鐘形花|闊鐘形|筒狀鐘形|風鈴狀|風鈴形|風鈴/.test(text)) {
    features.push('鐘形花');
  }
  
  // A2.6 花位置（單生/成對/簇生）
  if (/單生花|單生|一朵花/.test(text)) features.push('單生花');
  else if (/成對|兩朵|對生花/.test(text)) features.push('成對花');
  else if (/簇生|多朵|密集|叢生花/.test(text)) features.push('簇生花');
  
  // A2.7 花序方向（直立/下垂）
  if (/下垂|垂吊|下彎|向下|低垂|懸垂|垂掛/.test(text)) features.push('下垂花序');
  else if (/直立|向上|挺立/.test(text)) features.push('直立花序');
  
  // A2.8 花色強化提取（特別是紫花、粉紅花對野牡丹等植物鑑別力高）
  if (/深紫|濃紫|紫紅色|紫紅|深紫色|濃紫色/.test(text)) features.push('紫花');
  else if (/粉紅|粉紅色|淡粉|淺粉/.test(text)) features.push('粉紅花');
  else if (/淡紫|淺紫|淡紫色|淺紫色|紫藍|藍紫/.test(text)) features.push('紫花');
  else if (/白色|白花|潔白/.test(text)) features.push('白花');
  else if (/黃色|黃花|金黃/.test(text)) features.push('黃花');
  else if (/紅色|紅花|鮮紅|深紅/.test(text)) features.push('紅花');
  
  // A2.9 花形描述提取（牡丹般、大型花朵等）
  if (/牡丹般|牡丹狀|牡丹型|大型花朵|大花|花朵大/.test(text)) {
    // 牡丹般花型通常與紫花/粉紅花搭配，這裡只提取描述，實際花形由 flower_shape 處理
    // 但可以作為輔助特徵，提升匹配權重
  }

  // A3 花序：D1 只保留 1 個，優先序 繖房>聚繖>穗狀>繖形>頭狀>總狀>圓錐
  if (/繖房花序|繖房/.test(text)) features.push('繖房花序');
  else if (/聚繖花序|聚繖/.test(text)) features.push('聚繖花序');
  else if (/穗狀花序|穗狀/.test(text)) features.push('穗狀花序');
  else if (/繖形花序|傘形花序|繖狀/.test(text)) features.push('繖形花序');
  else if (/頭狀花序|頭狀/.test(text)) features.push('頭狀花序');
  else if (/總狀花序|總狀/.test(text)) features.push('總狀花序');
  else if (/圓錐花序|圓錐/.test(text)) features.push('圓錐花序');

  // B1 葉序（最多 1 個）
  if (/輪生/.test(text)) features.push('輪生');
  else if (/對生/.test(text)) features.push('對生');
  else if (/互生/.test(text)) features.push('互生');
  else if (/叢生|葉叢生/.test(text)) features.push('叢生');

  // B2 葉緣
  if (/鋸齒緣|鋸齒|粗鋸齒/.test(text)) features.push('鋸齒');
  else if (/波狀緣|波狀/.test(text)) features.push('波狀');
  else if (/全緣/.test(text)) features.push('全緣');

  // B3 生活型（最多 1 個，低權重）
  if (/藤本|攀緣|蔓性/.test(text)) features.push('藤本');
  else if (/喬木/.test(text)) features.push('喬木');
  else if (/灌木/.test(text)) features.push('灌木');
  else if (/草本/.test(text)) features.push('草本');

  // C1 刺/乳汁
  if (/有刺|具刺|刺狀|刺多/.test(text)) features.push('有刺');
  if (/乳汁|白色汁液/.test(text)) features.push('乳汁');

  return features;
}

/**
 * 從 LM 描述擷取猜測植物名稱（可能是 A、B 或 C）
 * 用於合併進 guess_names 以提升關鍵字匹配
 * @param {string} description
 * @returns {string[]}
 */
function extractGuessNamesFromDescription(description) {
  if (!description || typeof description !== 'string') return [];
  const names = [];
  // 可能是 X、Y 或 Z / 初步猜測...可能是 X、Y / 推測為 X
  const patterns = [
    /可能(?:是|為)\s*([^。\n]+?)(?:\.|。|$)/g,
    /初步猜測[^。]*?(?:可能)?(?:是|為)\s*([^。\n]+?)(?:\.|。|$)/g,
    /推測[^。]*?(?:可能)?(?:是|為)\s*([^。\n]+?)(?:\.|。|$)/g,
    /(?:很可能|或許)是\s*([^。\n、，]+)/g
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(description)) !== null) {
      const segment = m[1].trim();
      if (!segment || segment.length < 2) continue;
      for (const part of segment.split(/[、，或及與和]/)) {
        let name = part.replace(/\s+/g, '').replace(/^某種?|的?品種?|的?一種?|一種?$/g, '').trim();
        name = name.replace(/屬$|科$|的$|植物$/g, '').trim();
        if (/科|的/.test(name)) name = name.split(/科|的/)[0].trim();
        if (name.length >= 2 && name.length <= 12 && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
  }
  // LM 常見誤寫 → 正確學名/俗名（便於 keyword 匹配）
  const LM_GUESS_SYNONYMS = {
    '紫花蔓達': '紫花長穗木',
    '金光藤': '紫花長穗木',
    '金雀花': '小金雀花'  // 小金雀花 常被簡稱 金雀花
  };
  const expanded = [];
  for (const n of names) {
    expanded.push(n);
    if (LM_GUESS_SYNONYMS[n] && !seen.has(LM_GUESS_SYNONYMS[n])) {
      expanded.push(LM_GUESS_SYNONYMS[n]);
      seen.add(LM_GUESS_SYNONYMS[n]);
    }
  }
  return expanded.slice(0, 8);  // 最多 8 個
}

/** A + D: 類別上限（每類最多 1–2 個）+ 矛盾處理（互斥、包含）→ 壓成 12–18 個高品質特徵 */
const FEATURE_CATEGORY = {
  life_form: ['喬木', '灌木', '草本', '藤本'],
  leaf_arrangement: ['互生', '對生', '輪生', '叢生'],
  leaf_type: ['單葉', '複葉', '羽狀複葉', '掌狀複葉', '二回羽狀', '三出複葉'],
  leaf_margin: ['全緣', '鋸齒', '波狀'],
  flower_inflo: ['總狀花序', '圓錐花序', '聚繖花序', '繖房花序', '頭狀花序', '繖形花序', '穗狀花序', '佛焰花序'],
  flower_shape: ['鐘形花', '漏斗形花', '唇形花', '蝶形花', '十字形花', '放射狀花'],
  flower_position: ['單生花', '成對花', '簇生花'],
  inflorescence_orientation: ['直立花序', '下垂花序'],
  fruit_type: ['莢果', '漿果', '核果', '蒴果', '翅果', '瘦果', '堅果', '梨果'],
  fruit_cluster: ['單生果', '成串果', '總狀果', '腋生果'],
  fruit_surface: ['光滑果', '有毛果', '粗糙果', '有棱果'],
  calyx_persistent: ['宿存萼'],
  flower_color: ['白花', '黃花', '紅花', '紫花', '粉紅花', '橙花', '藍花'],
  trunk_root: ['板根', '氣生根'],
  special: ['有刺', '乳汁', '胎生苗', '棕櫚', '紅苞葉'],
};
const CATEGORY_CAP = { special: 2 };
const INFLORESCO_PRIORITY = ['繖房花序', '聚繖花序', '穗狀花序', '繖形花序', '頭狀花序', '佛焰花序', '總狀花序', '圓錐花序'];
// 互斥類別內的優先順序（越特殊越前面）
const LEAF_ARRANGEMENT_PRIORITY = ['輪生', '對生', '叢生', '互生'];
const LEAF_MARGIN_PRIORITY = ['鋸齒', '波狀', '全緣'];

function getCategory(f) {
  for (const [cat, list] of Object.entries(FEATURE_CATEGORY)) {
    if (list.includes(f)) return cat;
  }
  return null;
}

function capByCategoryAndResolveContradictions(features) {
  if (!Array.isArray(features) || features.length === 0) return features;
  let list = [...features];

  // D 包含：有細類複葉則刪「複葉」
  const compoundFine = ['羽狀複葉', '掌狀複葉', '二回羽狀', '三出複葉'];
  if (compoundFine.some((t) => list.includes(t)) && list.includes('複葉')) {
    list = list.filter((f) => f !== '複葉');
  }

   // D 互斥：surface_hair 無毛 vs 有毛（若同時出現，保留「有毛」側，移除「無毛」）
   const HAIR_POSITIVE_TOKENS = ['柔毛', '絨毛', '粗毛'];
   const hasHairPositive = HAIR_POSITIVE_TOKENS.some((t) => list.includes(t));
   if (hasHairPositive && list.includes('無毛')) {
     list = list.filter((f) => f !== '無毛');
   }

  // D 互斥 + A 類別上限：每類只保留 1 個（special 最多 2）
  const byCat = {};
  for (const f of list) {
    const cat = getCategory(f);
    if (!cat) continue;
    if (!byCat[cat]) byCat[cat] = [];
    if (!byCat[cat].includes(f)) byCat[cat].push(f);
  }

  const out = [];
  for (const [cat, arr] of Object.entries(byCat)) {
    const cap = CATEGORY_CAP[cat] ?? 1;
    let chosen = arr;
    if (cat === 'flower_inflo' && arr.length > 1) {
      const ordered = INFLORESCO_PRIORITY.filter((p) => arr.includes(p));
      chosen = ordered.length ? [ordered[0]] : [arr[0]];
    } else if (cat === 'leaf_arrangement' && arr.length > 1) {
      const ordered = LEAF_ARRANGEMENT_PRIORITY.filter((p) => arr.includes(p));
      chosen = ordered.length ? [ordered[0]] : [arr[0]];
    } else if (cat === 'leaf_margin' && arr.length > 1) {
      const ordered = LEAF_MARGIN_PRIORITY.filter((p) => arr.includes(p));
      chosen = ordered.length ? [ordered[0]] : [arr[0]];
    } else if (arr.length > cap) {
      chosen = arr.slice(0, cap);
    }
    out.push(...chosen);
  }

  return out.length > 0 ? out : features;
}

/**
 * 合併後矛盾處理：有複葉特徵時移除單葉（避免 traits + keyword-assist 合併後衝突）
 * @param {string[]} features
 * @returns {string[]} 處理後的陣列（可為原地修改或新陣列）
 */
function removeCompoundSimpleContradiction(features) {
  if (!Array.isArray(features)) return features;
  const COMPOUND_TOKENS = ['羽狀複葉', '掌狀複葉', '二回羽狀', '三出複葉', '複葉'];
  const hasCompound = COMPOUND_TOKENS.some((t) => features.includes(t));
  if (hasCompound && features.includes('單葉')) {
    return features.filter((f) => f !== '單葉');
  }
  return features;
}

module.exports = {
  parseTraitsFromResponse,
  validateTraits,
  isPlantFromTraits,
  traitsToFeatureList,
  evaluateTraitQuality,
  extractFeaturesFromDescriptionKeywords,
  extractGuessNamesFromDescription,
  removeCompoundSimpleContradiction,
  capByCategoryAndResolveContradictions
};
