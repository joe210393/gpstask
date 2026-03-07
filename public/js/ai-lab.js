// ==========================================
// 全域工具函數 (Global Utils)
// ==========================================
const debugEl = document.getElementById('debugConsole');
function log(msg) {
    console.log(msg);
    if (debugEl) debugEl.innerText = msg + '\n' + debugEl.innerText.substring(0, 100);
}

// ==========================================
// 主程式 (Main Application)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 包裹在 try-catch 中以捕獲初始化錯誤
    try {
        log('DOM Ready - 初始化開始');

        // ------------------------------------------------
        // 1. 設定與劇本 (Configuration & Prompts)
        // ------------------------------------------------
        // 任務劇本已移除，改為使用「新增任務」API 的任務（承接任務後由 currentTask 提供）

        const PROMPTS = {
            free: {
                title: "🌿 自由探索模式",
                intro: "這裡沒有任務壓力，你可以隨意拍攝身邊的植物或物品，我會為你介紹它們的小知識。",
                system: `你是一位專業的植物形態學家與生態研究員。

**重要：你必須按照以下步驟進行分析，絕對不能跳過任何步驟！**

請依照以下 XML 格式回答，並在最後輸出結構化的 traits JSON：

<analysis>
**第一步：尺寸判斷（必須完成，用於驗證生活型）**

**請透過以下方式估算尺寸：**
1. **畫面比例推估：** 觀察物體在畫面中佔據的比例
   - 如果物體佔畫面高度約 1/3，且畫面是標準手機拍攝（約 50-100 公分距離），可推估物體高度
   - 如果物體佔畫面很小（< 10%），可能是大型物體（喬木）的局部
   - 如果物體佔畫面很大（> 50%），可能是小型物體（草本）的特寫

2. **視覺經驗推估：** 根據常見物體的視覺大小經驗
   - 葉片：一般草本葉片 2-10 公分，灌木葉片 3-15 公分，喬木葉片 5-30 公分
   - 花朵：一般小花 0.5-2 公分，中型花 2-5 公分，大花 5-15 公分
   - 整體：草本通常 < 50 公分，灌木 50-300 公分，喬木 > 300 公分

3. **結構特徵推估：** 觀察植物的結構特徵
   - 如果能看到明顯的主幹且粗壯 → 可能是喬木
   - 如果多分枝且無明顯主幹 → 可能是灌木
   - 如果莖細軟且低矮 → 可能是草本

**估算物體的實際尺寸範圍（必須具體）：**
- 整體高度：約 X 公分（或 X 公尺）
- 葉片長度：約 X 公分
- 花朵直徑：約 X 公分

**尺寸判斷的重要性：**
- 喬木：通常高度 > 3 公尺，主幹明顯
- 灌木：通常高度 0.5-3 公尺，多分枝
- 草本：通常高度 < 0.5 公尺，莖柔軟
- 如果判斷為「灌木」但高度只有 10 公分，請重新檢查為「草本」！

**第二步：詳細描述圖片細節（必須完成）**

**如果是植物，必須使用專業的植物形態學術語描述，絕對不能用「葉子形狀」「顏色」這種模糊詞彙！**

植物描述必須包含以下專業術語（根據圖片可見特徵選擇）：

**一、形態（整體外觀與生活型）**
- 生活型：喬木、灌木、草本、藤本、半灌木（必須與尺寸判斷一致！）
- 生長型：直立、匍匐、攀緣、纏繞、蔓生、叢生、浮水、沉水
- 壽命型：一年生、二年生、多年生
- 表面特徵：光滑、有毛、有刺、有蠟質、粗糙、黏性
- **整體尺寸：** 高度、寬度、葉片大小、花朵大小（必須具體描述）

**二、葉（Leaf）**
- 葉的構造：單葉、複葉、退化葉
- 葉序：互生、對生、輪生
- 葉形：披針形、卵形、橢圓形、心形、線形、圓形、腎形、倒卵形、針形、戟形、楔形、扇形
- 葉緣：全緣、鋸齒緣、波狀緣、裂緣、鈍齒緣、重鋸齒
- **葉片尺寸：** 長度、寬度（必須具體描述）

**三、根與莖（Root & Stem）- 非常重要！**
- **根的類型：** 直根、鬚根、氣生根、儲藏根、支柱根、板根、呼吸根
- **莖的類型：** 地上莖、地下莖、匍匐莖、直立莖、肉質莖、木質莖、攀緣莖
- **地下莖細分：** 根莖、球莖、鱗莖、塊莖、塊根
- **莖的特徵：** 中空、實心、有節、有稜、有刺、有毛、光滑

**四、花（Flower）- 特別注意花序類型！**
- 花的性別：單性花、雙性花、無性花
- **花序（必須仔細觀察，這是識別關鍵）：**
  - **總狀花序：** 花軸上有多朵花，每朵花有花梗，從下往上開花（如：油菜花）
  - **穗狀花序：** 花軸上有多朵花，但花無梗或極短（如：小麥）
  - **繖形花序：** 花軸頂端有多朵花，花梗長度相近，呈傘狀（如：繡球花、蔥）
  - **圓錐花序：** 總狀花序的分枝版，呈圓錐形（如：稻米）
  - **頭狀花序：** 花軸頂端膨大，多朵小花密集排列（如：向日葵）
  - **聚繖花序：** 多個繖形花序組合，呈球狀或半球狀（如：繡球花、八仙花）
  - **佛焰花序：** 特殊結構，有佛焰苞包裹（如：芋頭）
  - **單生花：** 只有一朵花
- 花對稱性：放射對稱、左右對稱、不對稱
- **花朵尺寸：** 直徑、長度（必須具體描述）

**五、果實（Fruit）**
- 乾果：裂果、不裂果、翅果、堅果、蒴果、瘦果
- 肉果：漿果、核果、梨果、聚合果
- 果實來源：單果、聚合果、多花果
- **果實顏色：** 綠色、紅色、黃色、黑色、棕色、紫色等（必須描述）

**六、種子（Seed）- 如果可見，必須描述！**
- **種子類型：** 有翅種子、無翅種子、具毛種子、具刺種子
- **種子顏色：** 黑色、棕色、紅色、黃色、白色等
- **種子大小：** 大、中、小（可估算直徑或長度）
- **種子形狀：** 圓形、橢圓形、扁平、長條形等

**範例（正確）：**
「這是一種灌木植物，整體高度約 50-80 公分。葉序為對生，葉形為橢圓形，葉緣為鋸齒緣，葉片長約 5-8 公分。具有聚繖花序，花朵密集排列成球狀，花朵直徑約 2-3 公分，花色為粉紅色。」

**範例（錯誤）：**
「這是一種綠色植物，葉子長長的，邊緣有鋸齒，開白色小花。」（不能用這種描述！）

**如果是動物：** 描述體型、顏色、特徵部位、行為等
**如果是物品：** 描述形狀、顏色、材質、大小、用途等

**圈選範圍內的主體與背景：**
使用者圈選的區域可能同時包含主體（焦點）與背景。請判斷「主要焦點」是什麼：若主體是動物、昆蟲或人造物而植物僅在背景，第三步請判斷為「動物」或「人造物」，並輸出空 JSON。只有當主體是植物時，才在第四步提取植物特徵。

**第三步：判斷類別（必須完成）**
明確指出「圈選範圍內的主要焦點」是：植物 / 動物 / 人造物 / 其他

**第四步：提取生物特徵（僅限植物）**
如果是植物，請用上述專業術語提取關鍵識別特徵，例如：
- 生活型：灌木（必須與尺寸判斷一致！）
- 葉序：對生
- 葉形：橢圓形
- 葉緣：鋸齒緣
- **葉片顏色：** 綠色、紫色、斑葉等（必須描述，特別是雙色葉或特殊顏色）
- 花序：聚繖花序（必須仔細觀察！）
- **花色：** 粉紅色（注意：只有花朵的顏色才是花色，葉子的顏色不是花色！）
- **果實類型：** 漿果、核果、莢果等（如果可見）
- **果實顏色：** 紅色、黑色等（如果可見）
- **根莖類型：** 直根、鬚根、氣生根、地下莖等（如果可見）
- **種子類型：** 有翅、無翅等（如果可見）
- **種子顏色：** 黑色、棕色等（如果可見）
- 尺寸：高度 50-80 公分，花朵直徑 2-3 公分
- 其他：有刺、氣生根等

**重要：葉片顏色和花色是不同特徵！**
- **葉片顏色（leaf_color）**：描述葉子的顏色，如「綠色」、「紫色」、「上綠下紫」
- **花色（flower_color）**：只描述花朵的顏色，如「粉紅色」、「白色」
- 如果照片中沒有花朵，請將 flower_color 設為 "unknown"

**第五步：尺寸驗證（僅限植物）**
檢查生活型與尺寸是否一致：
- 如果判斷為「喬木」但高度只有 30 公分 → 重新判斷為「灌木」或「草本」
- 如果判斷為「灌木」但高度只有 10 公分 → 重新判斷為「草本」
- 如果判斷為「草本」但高度有 2 公尺 → 重新判斷為「灌木」

**第六步：初步猜測（僅限植物）**
根據你觀察到的特徵，猜測可能是什麼植物（給 1-3 個候選名稱，中文為主）

**注意：絕對不要直接給出最終答案！你只能描述細節和猜測，最終答案需要透過資料庫比對後才能確定。**
</analysis>

**第七步：輸出結構化特徵（僅限植物，必須輸出 JSON）**
如果第三步判斷為「植物」，請在 </reply> 之後輸出以下 JSON 格式的特徵資料（不要加其他文字）：

\`\`\`json
{
  "life_form": {"value":"shrub","confidence":0.8,"evidence":"植株呈木質分枝"},
  "phenology": {"value":"evergreen","confidence":0.7,"evidence":"葉片全年保持綠色"},
  "leaf_arrangement": {"value":"opposite","confidence":0.9,"evidence":"葉片對生排列"},
  "leaf_shape": {"value":"ovate","confidence":0.8,"evidence":"葉片呈卵形"},
  "leaf_margin": {"value":"serrate","confidence":0.85,"evidence":"葉緣有明顯鋸齒"},
  "leaf_texture": {"value":"chartaceous_thick","confidence":0.6,"evidence":"葉片質地厚紙質"},
  "inflorescence": {"value":"corymb_cyme","confidence":0.9,"evidence":"聚繖花序，花朵密集排列成球狀"},
  "flower_color": {"value":"pink","confidence":0.9,"evidence":"花朵呈粉紅色"},
  "leaf_color": {"value":"green_purple","confidence":0.8,"evidence":"葉片上表面綠色，下表面或新葉呈紫紅色"},
  "fruit_type": {"value":"berry","confidence":0.8,"evidence":"照片可見漿果"},
  "fruit_color": {"value":"red","confidence":0.9,"evidence":"果實呈紅色"},
  "root_type": {"value":"fibrous","confidence":0.7,"evidence":"鬚根系"},
  "stem_type": {"value":"woody","confidence":0.8,"evidence":"木質莖"},
  "seed_type": {"value":"winged","confidence":0.6,"evidence":"種子具翅"},
  "seed_color": {"value":"brown","confidence":0.7,"evidence":"種子呈棕色"},
  "surface_hair": {"value":"glabrous","confidence":0.7,"evidence":"葉片表面光滑無毛"}
}
\`\`\`

**注意：**
- 如果看不到果實，請回傳 "fruit_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見果實"}
- 如果看不到種子，請回傳 "seed_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見種子"}
- 如果看不到根莖，請回傳 "root_type": {"value":"unknown","confidence":0.1,"evidence":"照片未見根部"}
- **根莖類型非常重要，如果照片中可見根部或地下莖，必須描述！**

**重要規則：**
1. 每個 trait 都要有 value、confidence(0~1)、evidence
2. 如果看不到或無法判斷，請回傳 value = "unknown" 並給低 confidence (0.1-0.3)
3. 只填寫能清楚觀察到的特徵，不確定就不要填或填 unknown
4. 如果第三步判斷為「動物」或「人造物」，請輸出空的 JSON：{}

<reply>
用親切、專業但通俗的語氣向玩家介紹這個東西。
- 如果是植物/動物：介紹學名、別名、冷知識或用途。
- 如果是物品：介紹它的用途，或是提供一個相關的生活小撇步。

**重要：在 <reply> 中，你只能根據 <analysis> 中描述的細節來介紹，不要直接猜測名稱。**
</reply>`,
                user: "請詳細分析這張圖片，描述所有可見的細節特徵，然後判斷這是什麼類別（植物/動物/人造物）。"
            },
            mission: null
        };

        // 覆寫自由探索模式的系統提示：改為單純介紹用，避免多步驟結構化輸出
        PROMPTS.free.system = `你是一位友善的自然與生活解說員。

你的任務：根據使用者提供的圖片，用簡單、好懂的中文介紹圈選區域裡的主要東西是什麼。

請遵守以下原則：
1. 先用 1～2 句話說明「這看起來是什麼」。
2. 接著最多再用 1～2 個短段落，補充外觀特徵、可能的用途、生活小知識或有趣的背景。
3. 回答只使用一般段落文字，不要使用任何 XML 標籤、JSON、程式碼區塊，也不要分步驟（不要寫「第一步」、「第二步」）。
4. 如果無法確定精確名稱，就用「看起來像是某種……」的方式描述，不要硬猜學名。

語氣請保持自然、親切、適合一般大眾閱讀。`;

        PROMPTS.free.user = "請用簡單、好懂的方式介紹這張照片圈選的東西，不需要列出分析步驟或結構化分析，只要直接說明是什麼以及一些有趣的小介紹。";

        // ------------------------------------------------
        // 2. 狀態變數 (State Variables) - 必須在函數前宣告
        // ------------------------------------------------
        let isDrawing = false;
        let points = [];
        let selectionMode = 'reticle';  // 'reticle' = 單手框選, 'draw' = 手繪圈選
        let reticleCenter = { x: 0, y: 0 };
        let reticleRadius = 0;
        let tapStart = null;           // 用於區分「點擊移動框」與「手繪」
        let stream = null;
        let facingMode = 'environment'; // 預設使用後鏡頭
        let currentMode = 'free';       // 預設模式
        let mapInstance = null;
        let mapMarker = null;
        let lastLocationText = '';
        let lastLatLng = null;
        let lastTaskDistance = null;
        let lastTaskBearing = null;
        let lastHeading = 0;
        let headingSource = 'none';
        let lastHeadingUpdateAt = 0;
        let lastGpsUpdateAt = 0;
        let taskObjectVisible = false;

        // ------------------------------------------------
        // 3. DOM 元素選取 (DOM Elements)
        // ------------------------------------------------
        const video = document.getElementById('cameraFeed');
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');
        const instruction = document.querySelector('.instruction');
        const selectionInstruction = document.getElementById('selectionInstruction');
        const instructionText = document.getElementById('instructionText');
        const captureReticleBtn = document.getElementById('captureReticleBtn');
        const reticleOverlay = document.getElementById('reticleOverlay');
        const btnReticleMode = document.getElementById('btnReticleMode');
        const btnDrawMode = document.getElementById('btnDrawMode');
        const resultPanel = document.getElementById('resultPanel');
        const previewArea = document.getElementById('previewArea');
        const backBtn = document.getElementById('backBtn');
        const switchCameraBtn = document.getElementById('switchCameraBtn');
        const captureBtn = document.getElementById('captureBtn');
        const micBtn = document.getElementById('micBtn');
        const retryBtn = document.getElementById('retryBtn');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const addPhotoBtn = document.getElementById('addPhotoBtn');
        const aiLoading = document.getElementById('aiLoading');
        const loadingText = document.getElementById('loadingText');
        const aiResult = document.getElementById('aiResult');
        const rawOutput = document.getElementById('rawOutput');
        const photoStrip = document.getElementById('photoStrip');
        const photoSlots = document.querySelectorAll('.photo-slot');
        const photoHint = document.getElementById('photoHint');

        // Multi-photo state（兩段式：1 張即可辨識，不清楚再補拍）
        const capturedPhotos = [];
        const MIN_PHOTOS_TO_ANALYZE = 1;
        const MAX_PHOTOS = 3;
        const CONFIDENCE_HIGH = 0.85;
        const CONFIDENCE_MEDIUM = 0.40;
        let needMorePhotosSession = null; // 補拍時儲存 session_data
        
        // Director Panel Elements
        const directorToggle = document.getElementById('directorToggle');
        const directorPanel = document.getElementById('directorPanel');
        const systemPromptInput = document.getElementById('systemPrompt');
        const userPromptInput = document.getElementById('userPrompt');
        const modeBtns = document.querySelectorAll('.mode-btn');
        const uiLayer = document.querySelector('.ui-layer');
        let langSelect = document.getElementById('langSelect');
        const zoomControl = document.getElementById('zoomControl');
        const zoomValue = document.getElementById('zoomValue');
        const zoomButtons = document.querySelectorAll('.zoom-btn');
        const voicePanel = document.getElementById('voicePanel');
        const floatingMicBtn = document.getElementById('floatingMicBtn');
        const voiceDraftInput = document.getElementById('voiceDraftInput');
        const voiceRecordBtn = document.getElementById('voiceRecordBtn');
        const voiceSendBtn = document.getElementById('voiceSendBtn');
        const voiceCloseBtn = document.getElementById('voiceCloseBtn');
        const voiceUser = document.getElementById('voiceUser');
        const voiceAi = document.getElementById('voiceAi');
        const voiceStatus = document.getElementById('voiceStatus');
        const voiceSpeakToggle = document.getElementById('voiceSpeakToggle');
        const queryTransit = document.getElementById('queryTransit');
        const queryTransitLabel = document.getElementById('queryTransitLabel');
        const answerToast = document.getElementById('answerToast');
        const answerToastText = document.getElementById('answerToastText');
        const answerToastClose = document.getElementById('answerToastClose');
        const cameraContainer = document.querySelector('.camera-container');
        const featureDockToggle = document.getElementById('featureDockToggle');
        const featureDockMenu = document.getElementById('featureDockMenu');
        const featureDrawerPanel = document.getElementById('featureDrawerPanel');
        const dockModeBtn = document.getElementById('dockModeBtn');
        const dockLangBtn = document.getElementById('dockLangBtn');
        const dockZoomBtn = document.getElementById('dockZoomBtn');
        const dockModePanel = document.getElementById('dockModePanel');
        const dockLangPanel = document.getElementById('dockLangPanel');
        const dockZoomPanel = document.getElementById('dockZoomPanel');
        let miniMapEl = document.getElementById('miniMap');
        let locationInfoEl = document.getElementById('locationInfo');
        let miniMapWrap = document.querySelector('.mini-map-wrap');
        let miniMapToggle = document.getElementById('miniMapToggle');
        let miniMapRefresh = document.getElementById('miniMapRefresh');
        const locationBar = document.getElementById('locationBar');
        const taskBgmBtn = document.getElementById('taskBgmBtn');
        const taskIntroBtn = document.getElementById('taskIntroBtn');
        const taskIntroPanel = document.getElementById('taskIntroPanel');
        const taskIntroTitle = document.getElementById('taskIntroTitle');
        const taskIntroCover = document.getElementById('taskIntroCover');
        const taskIntroDescription = document.getElementById('taskIntroDescription');
        const taskIntroClose = document.getElementById('taskIntroClose');
        const taskBgm = document.getElementById('taskBgm');
        const taskStatusBox = document.getElementById('taskStatusBox');
        const taskStatusText = document.getElementById('taskStatusText');
        const taskDebugText = document.getElementById('taskDebugText');
        const taskGuideArrow = document.getElementById('taskGuideArrow');
        const taskTargetObj = document.getElementById('taskTargetObj');
        const taskTargetImg = document.getElementById('taskTargetImg');
        const taskEncounterModal = document.getElementById('taskEncounterModal');
        const taskEncounterCover = document.getElementById('taskEncounterCover');
        const taskEncounterTitle = document.getElementById('taskEncounterTitle');
        const taskEncounterClose = document.getElementById('taskEncounterClose');
        const taskEncounterStart = document.getElementById('taskEncounterStart');
        const answerModal = document.getElementById('answerModal');
        const answerTaskName = document.getElementById('answerTaskName');
        const answerTaskDescription = document.getElementById('answerTaskDescription');
        const answerInputContainer = document.getElementById('answerInputContainer');
        const answerMessage = document.getElementById('answerMessage');
        const btnAnswerCancel = document.getElementById('btnAnswerCancel');
        const btnAnswerSubmit = document.getElementById('btnAnswerSubmit');
        const lockOverlay = document.getElementById('lockOverlay');
        const lockWheels = document.getElementById('lockWheels');
        const lockMsg = document.getElementById('lockMsg');
        const btnLockCancel = document.getElementById('btnLockCancel');
        const btnLockSubmit = document.getElementById('btnLockSubmit');
        const completionModal = document.getElementById('completionModal');
        const completionReward = document.getElementById('completionReward');
        const btnCompletionClose = document.getElementById('btnCompletionClose');

        // 任務情境（來自 AR-VIEW／新增任務 API：由 URL taskId 載入；進入後先見相機，再自行找地點）
        let currentTask = null;
        let currentTaskId = null;
        let currentUserTaskId = null;
        let targetLat = null;
        let targetLng = null;
        let navigationWatchId = null;
        let navigationPollTimer = null;
        let deviceHeading = 0;
        let taskReached = false;
        let bgmAutoStarted = false;
        let orientationPermissionState = 'idle';

        if (!video || !canvas) throw new Error('關鍵 DOM 元素遺失');

        // ------------------------------------------------
        // 4. 功能函數 (Functions)
        // ------------------------------------------------

        // 畫布調整
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            if (reticleRadius === 0) {
                reticleCenter.x = canvas.width / 2;
                reticleCenter.y = canvas.height / 2;
            }
            reticleRadius = Math.floor(0.35 * Math.min(canvas.width, canvas.height));
            updateReticlePosition();
        }

        // 單手框選：更新取景框位置與大小
        function updateReticlePosition() {
            if (!reticleOverlay || !reticleRadius) return;
            const r = reticleRadius;
            reticleOverlay.style.width = (2 * r) + 'px';
            reticleOverlay.style.height = (2 * r) + 'px';
            reticleOverlay.style.left = reticleCenter.x + 'px';
            reticleOverlay.style.top = reticleCenter.y + 'px';
            reticleOverlay.style.transform = 'translate(-50%, -50%)';
        }

        // 取景框的邊界矩形（用於裁切）
        function getReticleRect() {
            return {
                minX: reticleCenter.x - reticleRadius,
                minY: reticleCenter.y - reticleRadius,
                maxX: reticleCenter.x + reticleRadius,
                maxY: reticleCenter.y + reticleRadius
            };
        }

        // ---------- 任務情境（AR-VIEW 整合：任務封面＋景點說明＋背景音樂）----------
        function loadTaskBGM(task) {
            if (!taskBgm) return;
            const musicUrl = task?.bgm_url || task?.audio_url || null;
            if (musicUrl) {
                taskBgm.src = musicUrl;
                taskBgm.load();
                taskBgm.volume = 0.5;
                if (taskBgmBtn) {
                    taskBgmBtn.classList.remove('hidden');
                    taskBgmBtn.title = '任務背景音樂';
                }
            } else {
                taskBgm.src = '';
                if (taskBgmBtn) taskBgmBtn.classList.add('hidden');
            }
        }

        function showTaskContext(task) {
            currentTask = task;
            const statusPill = document.querySelector('.status-pill');
            if (statusPill) statusPill.textContent = task.name || '任務';
            if (taskIntroTitle) taskIntroTitle.textContent = task.name || '任務';
            if (taskIntroCover) {
                const photo = task.photoUrl || task.photo_url || '';
                taskIntroCover.src = photo;
                taskIntroCover.style.display = photo ? 'block' : 'none';
            }
            if (taskIntroDescription) {
                taskIntroDescription.textContent = task.description || '';
            }
            if (taskIntroBtn) taskIntroBtn.classList.remove('hidden');
            if (taskTargetImg) {
                taskTargetImg.src = task.ar_image_url || task.photoUrl || task.photo_url || '/images/mascot.png';
            }
            // 不自動彈出景點介紹：與 AR-VIEW 一致，進入後先看到相機畫面，由使用者自行點 📋 查看
        }

        function getLoginUser() {
            try { return JSON.parse(localStorage.getItem('loginUser') || 'null'); } catch (e) {}
            try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) {}
            return null;
        }

        async function fetchCurrentUserTaskId() {
            if (!currentTaskId) return null;
            const loginUser = getLoginUser();
            if (!loginUser || !loginUser.username) return null;
            try {
                const res = await fetch(`/api/user-tasks?username=${encodeURIComponent(loginUser.username)}`);
                const data = await res.json();
                if (!data.success || !Array.isArray(data.tasks)) return null;
                const t = data.tasks.find((x) => String(x.id) === String(currentTaskId));
                if (!t) return null;
                currentUserTaskId = t.user_task_id;
                return currentUserTaskId;
            } catch (err) {
                console.warn('取得進行中任務失敗', err);
                return null;
            }
        }

        function haversineDistance(lat1, lon1, lat2, lon2) {
            const toRad = (v) => v * Math.PI / 180;
            const R = 6371e3;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        function calculateBearing(startLat, startLng, destLat, destLng) {
            const toRad = (v) => v * Math.PI / 180;
            const toDeg = (v) => v * 180 / Math.PI;
            const y = Math.sin(toRad(destLng - startLng)) * Math.cos(toRad(destLat));
            const x = Math.cos(toRad(startLat)) * Math.sin(toRad(destLat))
                - Math.sin(toRad(startLat)) * Math.cos(toRad(destLat)) * Math.cos(toRad(destLng - startLng));
            return (toDeg(Math.atan2(y, x)) + 360) % 360;
        }

        async function ensureOrientationPermission() {
            if (orientationPermissionState === 'granted' || orientationPermissionState === 'unsupported') {
                return orientationPermissionState;
            }
            if (orientationPermissionState === 'requesting') {
                return orientationPermissionState;
            }
            try {
                if (typeof DeviceOrientationEvent !== 'undefined'
                    && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    orientationPermissionState = 'requesting';
                    const permission = await DeviceOrientationEvent.requestPermission();
                    orientationPermissionState = permission;
                    if (permission !== 'granted') {
                        console.warn('方向權限未授權');
                    }
                } else {
                    orientationPermissionState = 'unsupported';
                }
            } catch (err) {
                orientationPermissionState = 'error';
                console.warn('請求方向權限失敗', err);
            }
            renderTaskDebug();
            return orientationPermissionState;
        }

        function closeDockPanels() {
            if (featureDrawerPanel) featureDrawerPanel.classList.add('hidden');
            if (dockModePanel) dockModePanel.classList.add('hidden');
            if (dockLangPanel) dockLangPanel.classList.add('hidden');
            if (dockZoomPanel) dockZoomPanel.classList.add('hidden');
        }

        function toggleDockPanel(panelName) {
            const panels = {
                mode: dockModePanel,
                lang: dockLangPanel,
                zoom: dockZoomPanel
            };
            const panel = panels[panelName];
            if (!panel || !featureDrawerPanel) return;
            const willOpen = panel.classList.contains('hidden');
            closeDockPanels();
            if (willOpen) {
                featureDrawerPanel.classList.remove('hidden');
                panel.classList.remove('hidden');
            }
        }

        function renderTaskDebug(distanceMeters = lastTaskDistance, bearing = lastTaskBearing) {
            if (!taskDebugText) return;
            const gpsAge = lastGpsUpdateAt ? `${Math.round((Date.now() - lastGpsUpdateAt) / 1000)}s` : '--';
            const headingAge = lastHeadingUpdateAt ? `${Math.round((Date.now() - lastHeadingUpdateAt) / 1000)}s` : '--';
            const bearingText = Number.isFinite(bearing) ? `${Math.round(bearing)}°` : '--';
            const headingText = lastHeadingUpdateAt ? `${Math.round(deviceHeading)}°` : '--';
            const diffText = (Number.isFinite(bearing) && lastHeadingUpdateAt)
                ? `${Math.round(((bearing - deviceHeading + 540) % 360) - 180)}°`
                : '--';
            taskDebugText.textContent = `方位:${bearingText} 手機:${headingText} 差:${diffText} | 權限:${orientationPermissionState} | 感測:${headingSource} | GPS:${gpsAge} | 方向:${headingAge}`;
        }

        function refreshTaskNavigationFromCache() {
            if (!Number.isFinite(lastTaskDistance) || !Number.isFinite(lastTaskBearing)) {
                renderTaskDebug();
                return;
            }
            updateTaskNavigationUI(lastTaskDistance, lastTaskBearing);
        }

        function handleOrientationEvent(event) {
            let currentHeading = null;
            if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
                currentHeading = event.webkitCompassHeading;
                headingSource = 'webkitCompassHeading';
            } else if (event.alpha != null && !Number.isNaN(event.alpha)) {
                currentHeading = (360 - event.alpha + 360) % 360;
                headingSource = 'alpha';
            }
            if (currentHeading == null) {
                return;
            }
            let headingDiff = currentHeading - lastHeading;
            if (headingDiff > 180) headingDiff -= 360;
            if (headingDiff < -180) headingDiff += 360;
            lastHeading += headingDiff * 0.15;
            deviceHeading = (lastHeading + 360) % 360;
            lastHeadingUpdateAt = Date.now();
            if (orientationPermissionState === 'requesting' || orientationPermissionState === 'idle' || orientationPermissionState === 'error') {
                orientationPermissionState = 'granted';
            }
            refreshTaskNavigationFromCache();
        }

        function updateTaskNavigationUI(distanceMeters, bearing) {
            lastTaskDistance = distanceMeters;
            lastTaskBearing = bearing;
            const hasHeading = lastHeadingUpdateAt > 0;
            const diff = ((bearing - deviceHeading + 540) % 360) - 180;
            if (taskStatusBox) taskStatusBox.classList.remove('hidden');
            if (taskStatusText) taskStatusText.textContent = `距離目標: ${Math.max(0, Math.round(distanceMeters))}m`;
            renderTaskDebug(distanceMeters, bearing);

            const revealDistance = Math.max(8, currentTask?.radius || 30);
            const interactionDistance = Math.max(6, (currentTask?.radius || 30) / 2);
            const activeFovDeg = taskObjectVisible ? 50 : 30;
            const isInView = hasHeading && Math.abs(diff) < activeFovDeg;
            const canRevealObject = distanceMeters <= revealDistance;
            const shouldShowObject = canRevealObject && isInView;

            if (taskGuideArrow) {
                taskGuideArrow.style.transform = `rotate(${hasHeading ? diff : 0}deg) translate(0, -100px)`;
                taskGuideArrow.classList.toggle('hidden', shouldShowObject && distanceMeters <= revealDistance);
            }
            if (taskTargetObj) {
                if (shouldShowObject) {
                    taskObjectVisible = true;
                    taskTargetObj.classList.remove('hidden');
                    const xOffset = (diff / 40) * (window.innerWidth / 2);
                    let scale = 1.2 - (Math.min(distanceMeters, 50) / 60);
                    if (scale < 0.4) scale = 0.4;
                    const topPercent = distanceMeters <= interactionDistance ? 52 : 56;
                    taskTargetObj.style.left = '50%';
                    taskTargetObj.style.top = `${topPercent}%`;
                    taskTargetObj.style.transform = `translate(-50%, -50%) translateX(${xOffset}px) scale(${scale})`;
                    taskTargetObj.style.opacity = '1';
                } else {
                    taskObjectVisible = false;
                    taskTargetObj.classList.add('hidden');
                }
            }

            if (taskStatusText) {
                if (!hasHeading) {
                    taskStatusText.textContent = `距離目標: ${Math.max(0, Math.round(distanceMeters))}m（請點一下畫面啟用方向）`;
                } else if (shouldShowObject) {
                    taskStatusText.textContent = distanceMeters <= interactionDistance
                        ? `已找到目標：${Math.round(distanceMeters)}m`
                        : `目標進入視野：${Math.round(distanceMeters)}m`;
                } else {
                    taskStatusText.textContent = `距離目標: ${Math.max(0, Math.round(distanceMeters))}m`;
                }
            }
        }

        function tryAutoPlayTaskBgm(distanceMeters) {
            if (!taskBgm || !taskBgm.src || bgmAutoStarted) return;
            const triggerDistance = Math.max(8, currentTask?.radius || 30);
            if (distanceMeters > triggerDistance) return;
            taskBgm.play().then(() => {
                bgmAutoStarted = true;
                if (taskBgmBtn) taskBgmBtn.textContent = '🔊';
            }).catch(() => {
                // iOS/Safari 常會擋自動播放，保留手動按鈕即可
            });
        }

        function startTaskNavigation() {
            if (!navigator.geolocation || targetLat == null || targetLng == null) return;
            if (navigationWatchId !== null) {
                navigator.geolocation.clearWatch(navigationWatchId);
            }
            if (navigationPollTimer) {
                clearInterval(navigationPollTimer);
                navigationPollTimer = null;
            }
            navigationWatchId = navigator.geolocation.watchPosition((pos) => {
                const { latitude, longitude } = pos.coords;
                lastLatLng = { latitude, longitude };
                lastGpsUpdateAt = Date.now();
                if (mapInstance && mapMarker) {
                    mapMarker.setLatLng([latitude, longitude]);
                    mapInstance.setView([latitude, longitude], 16);
                }
                const distanceMeters = haversineDistance(latitude, longitude, targetLat, targetLng);
                const bearing = calculateBearing(latitude, longitude, targetLat, targetLng);
                updateTaskNavigationUI(distanceMeters, bearing);
                tryAutoPlayTaskBgm(distanceMeters);
                if (locationBar) {
                    locationBar.textContent = `目前位置：距離任務 ${Math.round(distanceMeters)}m`;
                }
                taskReached = distanceMeters <= Math.max(6, currentTask?.radius || 30);
            }, (err) => {
                console.warn('任務導航定位失敗', err);
                if (taskStatusText) taskStatusText.textContent = '定位失敗，請確認 GPS 已開啟';
            }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });

            // iPhone/Safari 有時 watchPosition 更新不穩，補一層定時輪詢
            navigationPollTimer = setInterval(() => {
                navigator.geolocation.getCurrentPosition((pos) => {
                    const { latitude, longitude } = pos.coords;
                    lastLatLng = { latitude, longitude };
                    lastGpsUpdateAt = Date.now();
                    const distanceMeters = haversineDistance(latitude, longitude, targetLat, targetLng);
                    const bearing = calculateBearing(latitude, longitude, targetLat, targetLng);
                    updateTaskNavigationUI(distanceMeters, bearing);
                    if (locationBar) {
                        locationBar.textContent = `目前位置：距離任務 ${Math.round(distanceMeters)}m`;
                    }
                }, () => {}, { enableHighAccuracy: true, maximumAge: 1500, timeout: 6000 });
            }, 2500);
        }

        function loadTaskFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const taskId = params.get('taskId');
            if (!taskId) return;
            currentTaskId = taskId;
            targetLat = parseFloat(params.get('lat'));
            targetLng = parseFloat(params.get('lng'));
            fetch(`/api/tasks/${taskId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.task) {
                        const task = data.task;
                        if (task.lat && task.lng) {
                            targetLat = Number(task.lat);
                            targetLng = Number(task.lng);
                        }
                        loadTaskBGM(task);
                        showTaskContext(task);
                        setMode('mission', false);
                        startTaskNavigation();
                    }
                })
                .catch(err => console.error('載入任務失敗:', err));
        }

        function openTaskEncounter() {
            if (!currentTask || !taskEncounterModal) return;
            if (taskEncounterCover) {
                taskEncounterCover.src = currentTask.ar_image_url || currentTask.photoUrl || currentTask.photo_url || '/images/mascot.png';
            }
            if (taskEncounterTitle) {
                taskEncounterTitle.textContent = currentTask.name || '任務';
            }
            if (taskEncounterStart) {
                if (currentTask.task_type === 'location') taskEncounterStart.textContent = '📍 開始打卡';
                else if (currentTask.task_type === 'number') taskEncounterStart.textContent = '🔒 開始解鎖';
                else taskEncounterStart.textContent = '✍️ 開始答題';
            }
            taskEncounterModal.classList.remove('hidden');
        }

        function closeTaskEncounter() {
            if (taskEncounterModal) taskEncounterModal.classList.add('hidden');
        }

        function initLockWheels(digits = 4) {
            if (!lockWheels) return;
            lockWheels.innerHTML = '';
            for (let i = 0; i < digits; i += 1) {
                const wheel = document.createElement('div');
                wheel.className = 'wheel';
                wheel.dataset.value = '0';
                wheel.innerHTML = '<button class="btn-up" type="button">▲</button><div class="digit">0</div><button class="btn-down" type="button">▼</button>';
                const digitEl = wheel.querySelector('.digit');
                const setVal = (v) => {
                    const nv = (v + 10) % 10;
                    wheel.dataset.value = String(nv);
                    digitEl.textContent = String(nv);
                };
                wheel.querySelector('.btn-up').onclick = () => setVal(Number(wheel.dataset.value) + 1);
                wheel.querySelector('.btn-down').onclick = () => setVal(Number(wheel.dataset.value) - 1);
                let startY = null;
                wheel.addEventListener('pointerdown', (ev) => { startY = ev.clientY; wheel.setPointerCapture(ev.pointerId); });
                wheel.addEventListener('pointermove', (ev) => {
                    if (startY == null) return;
                    const dy = ev.clientY - startY;
                    if (Math.abs(dy) > 18) {
                        setVal(Number(wheel.dataset.value) + (dy < 0 ? 1 : -1));
                        startY = ev.clientY;
                    }
                });
                wheel.addEventListener('pointerup', () => { startY = null; });
                wheel.addEventListener('pointercancel', () => { startY = null; });
                lockWheels.appendChild(wheel);
            }
        }

        function getLockCode() {
            return Array.from(lockWheels.querySelectorAll('.wheel')).map((w) => w.dataset.value || '0').join('');
        }

        function showCompletionModal(message) {
            if (!completionModal) return;
            if (completionReward) completionReward.innerHTML = message || '✅ 任務已完成';
            completionModal.classList.remove('hidden');
        }

        function showAnswerModal(task) {
            if (!answerModal || !task) return;
            answerTaskName.textContent = task.name || '任務';
            answerTaskDescription.textContent = task.description || '請根據提示完成任務';
            answerInputContainer.innerHTML = '';
            answerMessage.textContent = '';
            btnAnswerSubmit.disabled = true;

            if (task.task_type === 'multiple_choice') {
                const choicesDiv = document.createElement('div');
                choicesDiv.className = 'answer-choices';
                let choices = [];
                if (Array.isArray(task.options)) choices = task.options;
                else if (typeof task.options === 'string') {
                    try { choices = JSON.parse(task.options || '[]'); } catch (e) { choices = []; }
                }
                choices.forEach((choice) => {
                    const node = document.createElement('div');
                    node.className = 'answer-choice';
                    node.textContent = choice;
                    node.dataset.value = choice;
                    node.onclick = () => {
                        choicesDiv.querySelectorAll('.answer-choice').forEach((c) => c.classList.remove('selected'));
                        node.classList.add('selected');
                        btnAnswerSubmit.disabled = false;
                    };
                    choicesDiv.appendChild(node);
                });
                answerInputContainer.appendChild(choicesDiv);
            } else if (task.task_type === 'photo') {
                const group = document.createElement('div');
                group.className = 'answer-input-group';
                group.innerHTML = '<label>📸 上傳照片</label><input type="file" id="answerPhotoInput" accept="image/*" capture="environment"><img id="answerPhotoPreview" style="display:none;max-width:100%;margin-top:10px;border-radius:8px;">';
                answerInputContainer.appendChild(group);
                const input = document.getElementById('answerPhotoInput');
                const preview = document.getElementById('answerPhotoPreview');
                input.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        preview.src = ev.target.result;
                        preview.style.display = 'block';
                        btnAnswerSubmit.disabled = false;
                    };
                    reader.readAsDataURL(file);
                });
            } else {
                const group = document.createElement('div');
                group.className = 'answer-input-group';
                group.innerHTML = '<label>✍️ 請輸入答案</label><input type="text" id="answerTextInput" autocomplete="off" placeholder="請輸入您的答案...">';
                answerInputContainer.appendChild(group);
                const input = document.getElementById('answerTextInput');
                input.addEventListener('input', () => {
                    btnAnswerSubmit.disabled = input.value.trim() === '';
                });
                setTimeout(() => input.focus(), 150);
            }
            answerModal.classList.remove('hidden');
        }

        async function submitTaskAnswer() {
            if (!currentTask) return;
            let answer = '';
            if (currentTask.task_type === 'multiple_choice') {
                const selected = document.querySelector('.answer-choice.selected');
                if (!selected) {
                    answerMessage.textContent = '❌ 請選擇一個答案';
                    return;
                }
                answer = selected.dataset.value;
            } else if (currentTask.task_type === 'photo') {
                const photoInput = document.getElementById('answerPhotoInput');
                if (!photoInput?.files?.[0]) {
                    answerMessage.textContent = '❌ 請上傳照片';
                    return;
                }
                const fd = new FormData();
                fd.append('photo', photoInput.files[0]);
                answerMessage.textContent = '📤 上傳照片中...';
                const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
                const uploadData = await uploadRes.json();
                if (!uploadData.success) {
                    answerMessage.textContent = '❌ 上傳失敗';
                    return;
                }
                answer = uploadData.url;
            } else {
                const input = document.getElementById('answerTextInput');
                answer = input?.value?.trim() || '';
                if (!answer) {
                    answerMessage.textContent = '❌ 請輸入答案';
                    return;
                }
            }

            if (!currentUserTaskId) await fetchCurrentUserTaskId();
            if (!currentUserTaskId) {
                answerMessage.textContent = '❌ 找不到任務記錄';
                return;
            }
            btnAnswerSubmit.disabled = true;
            answerMessage.textContent = '⏳ 驗證中...';
            const res = await fetch(`/api/user-tasks/${currentUserTaskId}/answer`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer })
            });
            const data = await res.json();
            if (data.success && (data.isCompleted || (data.message && data.message.includes('已完成')))) {
                answerModal.classList.add('hidden');
                showCompletionModal(data.earnedItemName ? `🎁 獲得：${data.earnedItemName}` : '✅ 任務已完成');
            } else {
                answerMessage.textContent = '❌ ' + (data.message || '答案錯誤，請重試');
                btnAnswerSubmit.disabled = false;
            }
        }

        async function submitLockCode() {
            if (!currentUserTaskId) await fetchCurrentUserTaskId();
            if (!currentUserTaskId) {
                lockMsg.textContent = '找不到任務記錄';
                return;
            }
            lockMsg.textContent = '驗證中...';
            const res = await fetch(`/api/user-tasks/${currentUserTaskId}/answer`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer: getLockCode() })
            });
            const data = await res.json();
            if (data.success && data.isCompleted) {
                lockOverlay.classList.add('hidden');
                showCompletionModal(data.earnedItemName ? `🎁 獲得：${data.earnedItemName}` : '✅ 任務已完成');
            } else {
                lockMsg.textContent = data.message || '答案錯誤';
            }
        }

        async function startTaskInteraction() {
            closeTaskEncounter();
            if (!currentTask) return;
            if (currentTask.task_type === 'location') {
                if (!lastLatLng) {
                    Swal.fire({ icon: 'info', title: '尚未取得位置', text: '請先靠近任務地點後再試' });
                    return;
                }
                const dist = haversineDistance(lastLatLng.latitude, lastLatLng.longitude, targetLat, targetLng);
                if (dist > Math.max(6, currentTask.radius || 30)) {
                    Swal.fire({ icon: 'warning', title: '還沒到任務地點', text: `目前距離約 ${Math.round(dist)}m` });
                    return;
                }
                if (!currentUserTaskId) await fetchCurrentUserTaskId();
                if (!currentUserTaskId) {
                    Swal.fire({ icon: 'error', title: '找不到任務紀錄' });
                    return;
                }
                const res = await fetch(`/api/user-tasks/${currentUserTaskId}/answer`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ answer: 'checked_in' })
                });
                const data = await res.json();
                if (data.success && data.isCompleted) {
                    showCompletionModal(data.earnedItemName ? `🎁 獲得：${data.earnedItemName}` : '📍 打卡成功');
                } else {
                    Swal.fire({ icon: 'warning', title: '打卡失敗', text: data.message || '請再試一次' });
                }
            } else if (currentTask.task_type === 'number') {
                const digits = Math.max(2, Math.min(8, String(currentTask.correct_answer || '').trim().length || 4));
                initLockWheels(digits);
                lockMsg.textContent = '';
                lockOverlay.classList.remove('hidden');
            } else {
                showAnswerModal(currentTask);
            }
        }

        function captureSelectionDataUrlFromRect(minX, minY, maxX, maxY) {
            const width = maxX - minX;
            const height = maxY - minY;
            if (width < 10 || height < 10) return null;
            if (!video.videoWidth || !video.videoHeight) {
                throw new Error('相機畫面尚未就緒');
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = video.videoWidth;
            tempCanvas.height = video.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            const screenRatio = canvas.width / canvas.height;
            const videoRatio = video.videoWidth / video.videoHeight;
            let renderWidth, renderHeight, offsetX, offsetY;
            if (screenRatio > videoRatio) {
                renderWidth = canvas.width;
                renderHeight = canvas.width / videoRatio;
                offsetX = 0;
                offsetY = (canvas.height - renderHeight) / 2;
            } else {
                renderHeight = canvas.height;
                renderWidth = canvas.height * videoRatio;
                offsetX = (canvas.width - renderWidth) / 2;
                offsetY = 0;
            }

            const sourceX = (minX - offsetX) * (video.videoWidth / renderWidth);
            const sourceY = (minY - offsetY) * (video.videoHeight / renderHeight);
            const sourceW = width * (video.videoWidth / renderWidth);
            const sourceH = height * (video.videoHeight / renderHeight);

            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = width;
            finalCanvas.height = height;
            const finalCtx = finalCanvas.getContext('2d');
            finalCtx.drawImage(tempCanvas, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
            return finalCanvas.toDataURL('image/jpeg', 0.95);
        }

        function captureCurrentReticleDataUrl() {
            const rect = getReticleRect();
            return captureSelectionDataUrlFromRect(rect.minX, rect.minY, rect.maxX, rect.maxY);
        }

        // 依矩形裁切並加入照片（供框選與手繪共用）
        function processSelectionFromRect(minX, minY, maxX, maxY) {
            try {
                const dataUrl = captureSelectionDataUrlFromRect(minX, minY, maxX, maxY);
                if (!dataUrl) return;
                addPhotoToCollection(dataUrl);
            } catch (e) {
                console.error('截圖失敗', e);
                aiResult.innerHTML = '<span style="color:red">截圖失敗: ' + e.message + '</span>';
                showResultPanel();
            }
        }

        // 取得當前劇本（任務模式使用 API 任務 currentTask，否則自由探索）
        function getActiveScript() {
            if (currentMode === 'mission' && currentTask) {
                const name = currentTask.name || '任務';
                const desc = currentTask.description || '';
                return {
                    title: name,
                    intro: desc || '請根據任務說明與景點介紹進行互動。',
                    system: `你是此景點的導覽者。請根據以下任務說明，用簡潔、友善的方式回答玩家的提問或介紹圈選的內容。\n\n【任務】${name}\n${desc ? '【說明】' + desc : ''}`,
                    user: '請根據這個任務的景點介紹，說明我圈選的內容。'
                };
            }
            return PROMPTS.free;
        }

        function applyScript(script, showIntro = true) {
            if (!script) return;
            if (systemPromptInput) systemPromptInput.value = script.system;
            if (userPromptInput) userPromptInput.value = script.user;
            
            if (systemPromptInput) {
                systemPromptInput.style.transition = 'background 0.3s';
                systemPromptInput.style.background = '#333';
                setTimeout(() => { systemPromptInput.style.background = ''; }, 300);
            }

            if (showIntro) {
                Swal.fire({
                    title: script.title,
                    text: script.intro,
                    icon: currentMode === 'mission' ? 'warning' : 'info',
                    confirmButtonText: '開始',
                    backdrop: `rgba(0,0,0,0.8)`
                });
            }
        }

        function getLanguageInstruction() {
            const lang = langSelect ? langSelect.value : 'zh';
            switch (lang) {
                case 'en':
                    return 'Please reply in English.';
                case 'ja':
                    return '日本語で回答してください。';
                case 'ko':
                    return '한국어로 답변해 주세요.';
                default:
                    return '請用繁體中文回答。';
            }
        }

        function getSpeechLocale() {
            const lang = langSelect ? langSelect.value : 'zh';
            switch (lang) {
                case 'en':
                    return 'en-US';
                case 'ja':
                    return 'ja-JP';
                case 'ko':
                    return 'ko-KR';
                default:
                    return 'zh-TW';
            }
        }

        function initLanguageSelector() {
            if (!langSelect) return;
            const saved = localStorage.getItem('aiLabLang');
            if (saved) langSelect.value = saved;
            langSelect.addEventListener('change', () => {
                localStorage.setItem('aiLabLang', langSelect.value);
            });
        }

        function updateVoicePanel(userText, aiText, statusText) {
            if (!voicePanel) return;
            voicePanel.classList.remove('hidden');
            if (voiceUser && userText !== undefined) voiceUser.textContent = userText || '—';
            if (voiceAi && aiText !== undefined) voiceAi.textContent = aiText || '—';
            if (voiceStatus && statusText !== undefined) voiceStatus.textContent = statusText;
        }

        function openVoicePanel() {
            if (voicePanel) voicePanel.classList.remove('hidden');
        }

        function setVoiceButtonsRecordingState(active) {
            if (micBtn) micBtn.classList.toggle('active', active);
            if (floatingMicBtn) floatingMicBtn.classList.toggle('active', active);
            if (voiceRecordBtn) {
                voiceRecordBtn.classList.toggle('active', active);
                voiceRecordBtn.textContent = active ? '⏹️ 停止收音' : '🎙️ 開始說話';
            }
        }

        function closeVoicePanel() {
            stopVoiceRecognition();
            if (voicePanel) voicePanel.classList.add('hidden');
        }

        function extractReplyText(rawText) {
            const cleanedText = String(rawText || '').replace(/```(?:xml|json)?|```/gi, '').trim();
            const replyMatch = cleanedText.match(/<reply>([\s\S]*?)<\/reply>/i);
            const analysisMatch = cleanedText.match(/<analysis>([\s\S]*?)<\/analysis>/i);
            return replyMatch
                ? replyMatch[1].trim()
                : (cleanedText || (analysisMatch ? analysisMatch[1].trim() : ''));
        }

        let speechRecognition = null;
        let isRecording = false;
        let speechRecognitionSupported = false;
        let answerToastTimer = null;

        function stopVoiceRecognition() {
            if (speechRecognition && isRecording) {
                try {
                    speechRecognition.stop();
                } catch (err) {
                    console.warn('停止語音辨識失敗', err);
                    try {
                        speechRecognition.abort();
                    } catch (abortErr) {
                        console.warn('中止語音辨識失敗', abortErr);
                    }
                }
            }
            isRecording = false;
            setVoiceButtonsRecordingState(false);
            if (voiceStatus) voiceStatus.textContent = '可送出提問';
        }

        function resetVoiceComposer() {
            if (voiceDraftInput) voiceDraftInput.value = '';
            if (voiceUser) voiceUser.textContent = '—';
            if (voiceAi) voiceAi.textContent = '—';
            if (voiceStatus) voiceStatus.textContent = '語音待命';
        }

        function showQueryTransit(message) {
            if (queryTransitLabel && message) {
                queryTransitLabel.textContent = message;
            }
            if (queryTransit) {
                queryTransit.classList.remove('hidden');
                queryTransit.classList.remove('returning');
                queryTransit.classList.add('sending');
            }
        }

        function hideQueryTransit() {
            if (queryTransit) {
                queryTransit.classList.add('hidden');
                queryTransit.classList.remove('sending', 'returning');
            }
        }

        async function playQueryReturnAnimation(message) {
            if (queryTransitLabel && message) {
                queryTransitLabel.textContent = message;
            }
            if (!queryTransit) return;
            queryTransit.classList.remove('hidden', 'sending');
            queryTransit.classList.add('returning');
            await new Promise((resolve) => setTimeout(resolve, 850));
            hideQueryTransit();
        }

        function showAnswerToast(text) {
            if (!answerToast || !answerToastText) return;
            answerToastText.textContent = text || '';
            answerToast.classList.remove('hidden');
            if (answerToastTimer) clearTimeout(answerToastTimer);
            answerToastTimer = setTimeout(() => {
                answerToast.classList.add('hidden');
            }, 12000);
        }

        function hideAnswerToast() {
            if (answerToastTimer) clearTimeout(answerToastTimer);
            if (answerToast) answerToast.classList.add('hidden');
        }

        function collapseResultPanel() {
            if (resultPanel) {
                resultPanel.classList.remove('active');
                resultPanel.style.display = 'none';
            }
            if (selectionInstruction) {
                selectionInstruction.style.opacity = '1';
                selectionInstruction.style.display = '';
            }
        }

        async function analyzeVisionQuestion(photoDataUrl, systemPrompt, userPrompt, gpsData) {
            const response = await fetch(photoDataUrl);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append('image', blob, 'voice-capture.jpg');
            formData.append('systemPrompt', systemPrompt);
            formData.append('userPrompt', userPrompt);
            formData.append('simpleMode', 'true');
            formData.append('skipRag', 'true');
            if (gpsData) {
                formData.append('latitude', gpsData.latitude);
                formData.append('longitude', gpsData.longitude);
            }

            const apiRes = await fetch('/api/vision-test', {
                method: 'POST',
                body: formData
            });
            if (!apiRes.ok) {
                const errText = await apiRes.text();
                throw new Error(errText || '視覺提問失敗');
            }
            return await apiRes.json();
        }

        async function sendVoiceChat(userText) {
            try {
                hideAnswerToast();
                showQueryTransit('問題已摺成紙飛機送出...');
                if (voiceSendBtn) voiceSendBtn.disabled = true;
                const snapshot = captureCurrentReticleDataUrl();
                if (!snapshot) {
                    throw new Error('無法擷取圈內畫面');
                }

                let finalSystemPrompt = systemPromptInput && systemPromptInput.value ? systemPromptInput.value : '';
                if (!finalSystemPrompt || finalSystemPrompt.length < 10) {
                    const fallbackScript = getActiveScript();
                    finalSystemPrompt = fallbackScript ? fallbackScript.system : finalSystemPrompt;
                }

                const locationTextForPrompt = lastLocationText
                    || (lastLatLng
                        ? `緯度 ${lastLatLng.latitude.toFixed(5)}，經度 ${lastLatLng.longitude.toFixed(5)}`
                        : '');
                if (locationTextForPrompt) {
                    finalSystemPrompt += `\n\n【拍攝地點資訊】${locationTextForPrompt}`;
                }
                finalSystemPrompt += `\n\n【輸出語言】${getLanguageInstruction()}`;
                finalSystemPrompt += `\n\n【回答規範】你是即時視覺導覽助手。請根據取景框截圖與使用者提問，用自然、直接的口吻回答 2 到 4 句。不要輸出 XML、JSON、analysis、步驟清單。若看不清楚，就坦白說並給出重新拍攝建議。不要提到你是根據座標推斷。`;

                let gpsData = null;
                try {
                    const pos = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000, enableHighAccuracy: false });
                    });
                    gpsData = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                    lastLatLng = gpsData;
                } catch (gpsErr) {
                    console.warn('語音提問略過 GPS', gpsErr);
                }

                const finalUserPrompt = `這是使用者目前在手機取景框中看到的畫面。請先理解畫面主體，再回答這個問題：${userText}${locationTextForPrompt ? `\n\n背景位置資訊：${locationTextForPrompt}` : ''}`;
                if (voicePanel) voicePanel.classList.add('hidden');
                resetVoiceComposer();
                const data = await analyzeVisionQuestion(snapshot, finalSystemPrompt, finalUserPrompt, gpsData);
                if (!data.success) throw new Error(data.message || 'AI 回覆失敗');

                const replyText = extractReplyText(data.description || '');
                await playQueryReturnAnimation('AI 紙飛機回來了');
                showAnswerToast(replyText);

                const shouldSpeak = voiceSpeakToggle ? voiceSpeakToggle.checked : true;
                if (shouldSpeak && 'speechSynthesis' in window && replyText) {
                    const utter = new SpeechSynthesisUtterance(replyText);
                    utter.lang = getSpeechLocale();
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(utter);
                }
            } catch (err) {
                console.error('語音聊天錯誤', err);
                await playQueryReturnAnimation('紙飛機帶回了錯誤訊息');
                showAnswerToast(err.message || '語音回覆失敗，請再試一次');
            } finally {
                hideQueryTransit();
                if (voiceSendBtn) voiceSendBtn.disabled = false;
                resetVoiceComposer();
            }
        }

        function initSpeechChat() {
            if (!micBtn && !floatingMicBtn) return;
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const preferKeyboardDictation = isIOS;
            speechRecognitionSupported = !!SpeechRecognition;

            const openComposerFromLauncher = (statusText) => {
                openVoicePanel();
                if (voiceDraftInput) {
                    requestAnimationFrame(() => voiceDraftInput.focus());
                }
                if (!speechRecognitionSupported || preferKeyboardDictation) {
                    updateVoicePanel(
                        voiceDraftInput ? voiceDraftInput.value.trim() : '',
                        '',
                        statusText || (isIOS
                            ? '請直接使用 iPhone 鍵盤的麥克風輸入文字，完成後按送出'
                            : '此裝置不支援語音轉文字，可直接輸入文字後送出')
                    );
                }
            };

            const startVoiceRecognition = () => {
                if (!speechRecognitionSupported || !speechRecognition || preferKeyboardDictation) {
                    openComposerFromLauncher();
                    return;
                }
                openVoicePanel();
                if (!isRecording) {
                    speechRecognition.lang = getSpeechLocale();
                    updateVoicePanel(voiceDraftInput ? voiceDraftInput.value.trim() : '', '', '聆聽中...');
                    speechRecognition.start();
                    isRecording = true;
                    setVoiceButtonsRecordingState(true);
                } else {
                    stopVoiceRecognition();
                }
            };

            [micBtn, floatingMicBtn].forEach((btn) => {
                if (!btn) return;
                btn.addEventListener('click', startVoiceRecognition);
            });
            if (voiceRecordBtn) {
                voiceRecordBtn.addEventListener('click', startVoiceRecognition);
            }
            if (voiceCloseBtn) {
                voiceCloseBtn.addEventListener('click', closeVoicePanel);
            }
            if (answerToastClose) {
                answerToastClose.addEventListener('click', hideAnswerToast);
            }
            if (voiceDraftInput) {
                voiceDraftInput.addEventListener('input', () => {
                    openVoicePanel();
                    if (voiceUser) voiceUser.textContent = voiceDraftInput.value.trim() || '—';
                });
            }
            if (voiceSendBtn) {
                voiceSendBtn.addEventListener('click', () => {
                    const text = voiceDraftInput ? voiceDraftInput.value.trim() : '';
                    if (!text) {
                        Swal.fire({ icon: 'info', title: '請先說話或輸入文字', text: '送出時會自動搭配圈內畫面一起提問' });
                        return;
                    }
                    stopVoiceRecognition();
                    sendVoiceChat(text);
                });
            }

            if (voiceRecordBtn) {
                voiceRecordBtn.textContent = preferKeyboardDictation ? '⌨️ 鍵盤語音輸入' : '🎙️ 開始說話';
            }

            if (!SpeechRecognition) {
                return;
            }

            const recognition = new SpeechRecognition();
            speechRecognition = recognition;
            recognition.lang = getSpeechLocale();
            recognition.interimResults = true;
            recognition.continuous = false;

            recognition.onstart = () => {
                updateVoicePanel(voiceDraftInput ? voiceDraftInput.value.trim() : '', '', '聆聽中...');
            };

            recognition.onresult = (event) => {
                let finalTranscript = '';
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interim += transcript;
                    }
                }
                const transcriptText = (finalTranscript || interim).trim();
                if (voiceDraftInput) voiceDraftInput.value = transcriptText;
                updateVoicePanel(transcriptText, voiceAi ? voiceAi.textContent : '', finalTranscript ? '已轉成文字，可送出' : '辨識中...');
                if (finalTranscript) {
                    stopVoiceRecognition();
                }
            };

            recognition.onerror = (event) => {
                console.warn('語音辨識錯誤', event);
                const reason = event.error || 'unknown';
                updateVoicePanel(voiceDraftInput ? voiceDraftInput.value.trim() : '', '語音辨識失敗', '失敗');
                isRecording = false;
                setVoiceButtonsRecordingState(false);
                if (preferKeyboardDictation) {
                    openComposerFromLauncher('請改用 iPhone 鍵盤的麥克風輸入文字，完成後按送出');
                } else if (voiceStatus) {
                    voiceStatus.textContent = `語音辨識失敗：${reason}`;
                }
            };

            recognition.onend = () => {
                isRecording = false;
                setVoiceButtonsRecordingState(false);
                if (voiceStatus && voiceStatus.textContent === '聆聽中...') {
                    voiceStatus.textContent = '可送出提問';
                }
            };
        }

        function initMiniMapToggle() {
            if (!miniMapToggle || !miniMapWrap) return;
            const saved = localStorage.getItem('aiLabMiniMapCollapsed');
            if (saved === '1') {
                miniMapWrap.classList.add('collapsed');
            }
            miniMapToggle.addEventListener('click', () => {
                miniMapWrap.classList.toggle('collapsed');
                const isCollapsed = miniMapWrap.classList.contains('collapsed');
                localStorage.setItem('aiLabMiniMapCollapsed', isCollapsed ? '1' : '0');
                if (!isCollapsed && mapInstance) {
                    setTimeout(() => {
                        mapInstance.invalidateSize();
                        if (lastLatLng) {
                            mapInstance.setView([lastLatLng.latitude, lastLatLng.longitude], 16);
                        }
                    }, 200);
                }
            });
            if (miniMapRefresh) {
                miniMapRefresh.addEventListener('click', () => {
                    requestLocation();
                });
            }
        }

        // 切換模式
        function setMode(mode, showIntro = true) {
            log(`切換模式: ${mode}`);
            if (mode === 'mission' && !currentTask) {
                Swal.fire({
                    icon: 'info',
                    title: '尚未承接任務',
                    text: '請先從任務詳情進入 AI 視覺探索，或使用自由探索模式。'
                });
                mode = 'free';
            }
            currentMode = mode;

            // UI 按鈕狀態更新
            modeBtns.forEach(btn => {
                if (btn.dataset.mode === mode) {
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            });

            // Body class 更新 (CSS特效用)
            document.body.className = `mode-${mode}`;

            const script = getActiveScript();
            applyScript(script, showIntro);
        }

        // 啟動相機
        async function startCamera() {
            try {
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                }
                
                log('正在啟動相機...');
                
                // 高畫質相機設定（iOS/Android 優化）
                const highQualityConstraints = {
                    video: {
                        facingMode: facingMode,
                        width: { ideal: 1920, min: 1280 },
                        height: { ideal: 1080, min: 720 },
                        aspectRatio: { ideal: 16/9 },
                        // iOS 需要這些設定來獲得更好畫質
                        advanced: [
                            { width: 1920, height: 1080 },
                            { width: 1280, height: 720 }
                        ]
                    },
                    audio: false
                };

                try {
                    stream = await navigator.mediaDevices.getUserMedia(highQualityConstraints);
                    log(`相機解析度: ${stream.getVideoTracks()[0]?.getSettings()?.width || '?'}x${stream.getVideoTracks()[0]?.getSettings()?.height || '?'}`);
                } catch (err1) {
                    log('高畫質模式失敗，嘗試標準設定: ' + err1.name);
                    // 降級到標準設定
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                facingMode: facingMode,
                                width: { ideal: 1280 },
                                height: { ideal: 720 }
                            },
                            audio: false
                        });
                    } catch (err2) {
                        log('標準設定也失敗，使用最基本設定');
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: true,
                            audio: false
                        });
                    }
                }
                
                video.srcObject = stream;
                try {
                    await video.play();
                    log('相機啟動成功');
                } catch (playErr) {
                    log('播放失敗: ' + playErr.message);
                }

                setupZoomControl();
                
            } catch (err) {
                console.error('相機啟動失敗:', err);
                log('相機錯誤: ' + err.name);
                
                let msg = '無法存取相機，請確認權限';
                let showRetry = false;
                
                if (err.name === 'NotAllowedError') {
                    msg = '您拒絕了相機權限';
                    showRetry = true;
                } else if (err.name === 'NotFoundError') {
                    msg = '找不到相機裝置';
                }
                
                const result = await Swal.fire({
                    icon: 'error',
                    title: '相機錯誤',
                    text: `${msg} (${err.name})`,
                    confirmButtonText: showRetry ? '重新請求權限' : '確定',
                    showCancelButton: showRetry,
                    cancelButtonText: '取消'
                });
                
                if (result.isConfirmed && showRetry) {
                    setTimeout(startCamera, 500);
                }
            }
        }

        function setZoomLevel(track, targetZoom, caps) {
            const minZoom = caps.zoom.min;
            const maxZoom = caps.zoom.max;
            const zoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));
            if (zoomValue) zoomValue.textContent = `${Number(zoom).toFixed(1)}x`;
            zoomButtons.forEach(btn => {
                btn.classList.toggle('active', Number(btn.dataset.zoom) === Math.round(zoom));
            });
            return track.applyConstraints({ advanced: [{ zoom }] }).catch((err) => {
                console.warn('Zoom 設定失敗', err);
            });
        }

        function setupZoomControl() {
            if (!stream || !zoomControl || !zoomValue || !zoomButtons.length) return;
            const [track] = stream.getVideoTracks();
            if (!track || !track.getCapabilities) {
                zoomControl.classList.add('hidden');
                return;
            }
            const caps = track.getCapabilities();
            if (!caps.zoom) {
                zoomControl.classList.add('hidden');
                return;
            }
            zoomControl.classList.remove('hidden');
            const settings = track.getSettings();
            const currentZoom = settings.zoom || caps.zoom.min;
            zoomValue.textContent = `${Number(currentZoom).toFixed(1)}x`;
            zoomButtons.forEach((btn) => {
                btn.onclick = () => setZoomLevel(track, Number(btn.dataset.zoom), caps);
            });
        }

        // 位置與地圖
        function ensureMiniMapElements() {
            if (miniMapEl && locationInfoEl) return;
            if (!cameraContainer) {
                log('找不到 camera-container，無法建立地圖容器');
                return;
            }
            const wrap = document.createElement('div');
            wrap.className = 'mini-map-wrap';

            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'miniMapToggle';
            toggleBtn.className = 'mini-map-toggle';
            toggleBtn.title = '切換地圖';
            toggleBtn.textContent = '🗺️';

            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'miniMapRefresh';
            refreshBtn.className = 'mini-map-refresh';
            refreshBtn.title = '定位更新';
            refreshBtn.textContent = '📍';

            const mapDiv = document.createElement('div');
            mapDiv.id = 'miniMap';
            mapDiv.className = 'mini-map';

            const infoDiv = document.createElement('div');
            infoDiv.id = 'locationInfo';
            infoDiv.className = 'location-info';
            infoDiv.textContent = '定位中...';

            wrap.appendChild(toggleBtn);
            wrap.appendChild(refreshBtn);
            wrap.appendChild(mapDiv);
            wrap.appendChild(infoDiv);
            cameraContainer.appendChild(wrap);

            miniMapEl = mapDiv;
            locationInfoEl = infoDiv;
            miniMapWrap = wrap;
            miniMapToggle = toggleBtn;
            miniMapRefresh = refreshBtn;
        }

        function initMiniMap() {
            ensureMiniMapElements();
            if (!miniMapEl) {
                log('找不到地圖容器，略過地圖顯示');
                return;
            }
            if (miniMapWrap && miniMapToggle) {
                initMiniMapToggle();
            }
            updateLocationText('定位中...');
            requestLocation();
            if (!window.L) {
                log('Leaflet 未載入，僅顯示位置文字');
                return;
            }

            mapInstance = L.map(miniMapEl, {
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                tap: false,
                touchZoom: false
            }).setView([25.0330, 121.5654], 13);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18
            }).addTo(mapInstance);

            mapMarker = L.marker([25.0330, 121.5654]).addTo(mapInstance);
            updateLocationText('定位中...');
            requestLocation();
        }

        function updateLocationText(text) {
            lastLocationText = text;
            if (locationInfoEl) {
                locationInfoEl.textContent = text;
            }
            if (locationBar) {
                locationBar.textContent = `目前位置：${text}`;
            }
        }

        async function reverseGeocode(lat, lng) {
            try {
                const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
                const res = await fetch(url, { headers: { 'Accept-Language': 'zh-TW' } });
                if (!res.ok) throw new Error('reverse geocode failed');
                const data = await res.json();
                const name = data.name || '';
                const address = data.address || {};
                const city = address.city || address.town || address.village || '';
                const suburb = address.suburb || address.neighbourhood || address.hamlet || '';
                const road = address.road || address.street || '';
                const display = [name, city, suburb, road].filter(Boolean).join(' ');
                return display || data.display_name || '';
            } catch (err) {
                console.warn('反向地理編碼失敗', err);
                return '';
            }
        }

        async function requestLocation() {
            if (!navigator.geolocation) {
                updateLocationText('裝置不支援定位');
                return;
            }
            try {
                const pos = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        timeout: 4000, enableHighAccuracy: false
                    });
                });
                const { latitude, longitude } = pos.coords;
                lastLatLng = { latitude, longitude };
                if (mapInstance && mapMarker) {
                    mapMarker.setLatLng([latitude, longitude]);
                    mapInstance.setView([latitude, longitude], 16);
                }
                const display = await reverseGeocode(latitude, longitude);
                updateLocationText(display || `緯度 ${latitude.toFixed(5)}，經度 ${longitude.toFixed(5)}`);
            } catch (err) {
                console.warn('定位失敗', err);
                updateLocationText('定位失敗');
            }
        }

        // 繪圖相關函數
        function getPos(e) {
            if (e.touches && e.touches[0]) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            if (e.changedTouches && e.changedTouches[0]) {
                return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        }

        function startDraw(e) {
            stopVoiceRecognition();
            if (resultPanel.style.display === 'flex') return;
            const pos = getPos(e);
            if (selectionMode === 'reticle') {
                tapStart = { x: pos.x, y: pos.y };
                return;
            }
            isDrawing = true;
            points = [];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            points.push(pos);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ffd700';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (selectionInstruction) selectionInstruction.style.opacity = '0';
        }

        function moveDraw(e) {
            if (selectionMode === 'reticle') {
                if (tapStart) {
                    const pos = getPos(e);
                    const dx = pos.x - tapStart.x, dy = pos.y - tapStart.y;
                    if (Math.sqrt(dx * dx + dy * dy) > 15) tapStart = null;
                }
                return;
            }
            if (!isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            points.push(pos);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }

        function endDraw(e) {
            if (selectionMode === 'reticle') {
                if (tapStart && e) {
                    const pos = getPos(e);
                    const dx = pos.x - tapStart.x, dy = pos.y - tapStart.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= 15) {
                        const r = reticleRadius;
                        reticleCenter.x = Math.max(r, Math.min(canvas.width - r, pos.x));
                        reticleCenter.y = Math.max(r, Math.min(canvas.height - r, pos.y));
                        updateReticlePosition();
                    }
                }
                tapStart = null;
                return;
            }
            if (!isDrawing) return;
            isDrawing = false;
            ctx.closePath();
            if (points.length > 5) {
                processSelection();
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (selectionInstruction) selectionInstruction.style.opacity = '1';
            }
        }

        // 截圖處理（手繪圈選：從 points 算邊界後呼叫共用裁切）
        function processSelection() {
            let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
            points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
            const padding = 20;
            minX = Math.max(0, minX - padding);
            minY = Math.max(0, minY - padding);
            maxX = Math.min(canvas.width, maxX + padding);
            maxY = Math.min(canvas.height, maxY + padding);
            processSelectionFromRect(minX, minY, maxX, maxY);
        }

        // 添加照片到集合
        function addPhotoToCollection(dataUrl) {
            if (capturedPhotos.length >= MAX_PHOTOS) {
                capturedPhotos[MAX_PHOTOS - 1] = dataUrl;
            } else {
                capturedPhotos.push(dataUrl);
            }

            // 更新 UI
            updatePhotoStrip();
            updatePreviewArea();
            showResultPanel();
        }

        // 更新照片條（每次從 DOM 取得 slot，確保顯示在結果面板內的縮圖正確）
        function updatePhotoStrip() {
            const strip = document.getElementById('photoStrip');
            const slots = strip ? strip.querySelectorAll('.photo-slot') : [];
            slots.forEach((slot, index) => {
                slot.classList.remove('filled', 'active');
                const existingImg = slot.querySelector('img');
                if (existingImg) existingImg.remove();

                if (capturedPhotos[index]) {
                    slot.classList.add('filled');
                    const img = document.createElement('img');
                    img.src = capturedPhotos[index];
                    img.alt = `第 ${index + 1} 張`;
                    img.setAttribute('loading', 'eager');
                    slot.appendChild(img);
                }
            });

            const nextIndex = Math.min(capturedPhotos.length, MAX_PHOTOS - 1);
            if (capturedPhotos.length < MAX_PHOTOS && slots[nextIndex]) {
                slots[nextIndex].classList.add('active');
            }

            const count = capturedPhotos.length;
            if (count >= MIN_PHOTOS_TO_ANALYZE) {
                analyzeBtn.disabled = false;
                if (photoHint) {
                    if (count >= MAX_PHOTOS) {
                        photoHint.innerHTML = `✓ 已拍攝 ${MAX_PHOTOS} 張，可開始辨識`;
                    } else if (count === 1) {
                        photoHint.innerHTML = [
                            '若此物品並非「生物」請直接辨識。',
                            '若是生物類（例如植物）建議補上第二、三張：',
                            '請拍攝特寫花朵、果實、葉片等位置，越多細節推測出的結論越準確。'
                        ].join('<br>');
                    } else {
                        photoHint.innerHTML = `已拍 ${count} 張，可辨識或再補 1 張（建議：花朵／果實／葉片特寫）。`;
                    }
                    photoHint.classList.toggle('complete', count >= MAX_PHOTOS);
                }
                if (addPhotoBtn) {
                    addPhotoBtn.disabled = count >= MAX_PHOTOS;
                    addPhotoBtn.textContent = count >= MAX_PHOTOS ? '已完成' : `拍攝第 ${count + 1} 張`;
                }
            } else {
                if (photoHint) photoHint.textContent = `請拍攝至少 ${MIN_PHOTOS_TO_ANALYZE} 張照片`;
                analyzeBtn.disabled = true;
                if (addPhotoBtn) {
                    addPhotoBtn.disabled = false;
                    addPhotoBtn.textContent = '拍攝第 1 張';
                }
            }
        }

        // 預覽區：依 1/2/3 張顯示，不裁切、不空白
        function updatePreviewArea() {
            if (!previewArea) return;
            previewArea.innerHTML = '';
            previewArea.className = 'preview-area';
            const count = capturedPhotos.length;
            if (count === 0) return;
            previewArea.classList.add('preview-count-' + Math.min(count, 3));
            for (let i = 0; i < count; i++) {
                const img = document.createElement('img');
                img.src = capturedPhotos[i];
                img.alt = `第 ${i + 1} 張`;
                img.loading = 'eager';
                previewArea.appendChild(img);
            }
        }

        function showResultPanel() {
            resultPanel.style.display = 'flex';
            resultPanel.classList.add('active');
            if (selectionInstruction) selectionInstruction.style.display = 'none';

            const count = capturedPhotos.length;
            if (count < MIN_PHOTOS_TO_ANALYZE) {
                aiResult.innerHTML = `<div style="text-align:center; color:#666;">
                    <div style="font-size:24px; margin-bottom:8px;">📷</div>
                    <div>請拍攝一張照片</div>
                    <div style="font-size:13px; color:#999; margin-top:4px;">不清楚時可再補拍不同角度</div>
                </div>`;
            } else {
                aiResult.innerHTML = '準備就緒，點擊「AI 辨識」開始分析';
            }
            if(rawOutput) rawOutput.style.display = 'none';
            analyzeBtn.textContent = 'AI 辨識';
            // 面板顯示後再刷新照片條與預覽區，確保縮圖與大圖在可見時正確繪製
            requestAnimationFrame(() => {
                updatePhotoStrip();
                updatePreviewArea();
            });
        }

        function retry() {
            capturedPhotos.length = 0;
            needMorePhotosSession = null;
            updatePhotoStrip();
            updatePreviewArea();

            resultPanel.classList.remove('active');
            resultPanel.style.display = 'none';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (selectionInstruction) selectionInstruction.style.opacity = '1';
            if (selectionInstruction) selectionInstruction.style.display = '';
            aiResult.innerHTML = '';
            points = [];
        }

        // ------------------------------------------------
        // 5. 事件監聽 (Event Listeners)
        // ------------------------------------------------

        // 視窗大小改變與初始尺寸
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        // 相機切換
        switchCameraBtn.addEventListener('click', () => {
            facingMode = facingMode === 'environment' ? 'user' : 'environment';
            startCamera();
        });

        // 拍照
        captureBtn.addEventListener('click', () => {
            try {
                if (!video.videoWidth || !video.videoHeight) {
                    throw new Error('相機尚未就緒');
                }
                const photoCanvas = document.createElement('canvas');
                photoCanvas.width = video.videoWidth;
                photoCanvas.height = video.videoHeight;
                const photoCtx = photoCanvas.getContext('2d');
                photoCtx.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);
                const dataUrl = photoCanvas.toDataURL('image/jpeg', 0.95);
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                if (navigator.canShare && !isIOS) {
                    fetch(dataUrl)
                        .then(res => res.blob())
                        .then(blob => {
                            const file = new File([blob], `ai-lab-${Date.now()}.jpg`, { type: 'image/jpeg' });
                            return navigator.share({ files: [file], title: 'AI Lab Photo' });
                        })
                        .catch(() => {
                            const link = document.createElement('a');
                            link.href = dataUrl;
                            link.download = `ai-lab-${Date.now()}.jpg`;
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                        });
                } else if (isIOS) {
                    const win = window.open();
                    if (win) {
                        win.document.write(`<img src="${dataUrl}" style="width:100%"/>`);
                    }
                    Swal.fire({
                        icon: 'info',
                        title: '已開啟照片',
                        text: '請長按圖片儲存'
                    });
                } else {
                    const link = document.createElement('a');
                    link.href = dataUrl;
                    link.download = `ai-lab-${Date.now()}.jpg`;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                }
            } catch (err) {
                console.error('拍照失敗', err);
                Swal.fire({
                    icon: 'error',
                    title: '拍照失敗',
                    text: err.message
                });
            }
        });

        // 返回（有 taskId 時回任務詳情，與 AR-VIEW 一致）
        backBtn.addEventListener('click', () => {
            const taskId = new URLSearchParams(window.location.search).get('taskId');
            if (taskId) window.location.href = `/task-detail.html?id=${taskId}`;
            else window.location.href = '/';
        });

        // 繪圖事件
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', moveDraw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', moveDraw, { passive: false });
        canvas.addEventListener('touchend', (e) => { e.preventDefault(); endDraw(e); }, { passive: false });
        canvas.addEventListener('touchcancel', endDraw);

        // 導演面板開關
        if (directorToggle && directorPanel) {
            directorToggle.addEventListener('click', () => {
                directorPanel.classList.toggle('open');
            });
        }

        // 模式按鈕
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                setMode(btn.dataset.mode);
            });
        });

        // 重試按鈕
        retryBtn.addEventListener('click', retry);

        // 拍攝下一張按鈕
        if (addPhotoBtn) {
            addPhotoBtn.addEventListener('click', () => {
                // 關閉結果面板，回到拍攝模式
                resultPanel.classList.remove('active');
                resultPanel.style.display = 'none';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (selectionInstruction) {
                    selectionInstruction.style.opacity = '1';
                    selectionInstruction.style.display = '';  // 讓「框內拍照」按鈕再次顯示，才能拍第二、三張
                }
            });
        }

        // 框內拍照（單手模式）
        if (captureReticleBtn) {
            captureReticleBtn.addEventListener('click', () => {
                if (selectionMode !== 'reticle') return;
                if (!video.videoWidth || !video.videoHeight) {
                    aiResult.innerHTML = '<span style="color:red">相機尚未就緒</span>';
                    showResultPanel();
                    return;
                }
                const rect = getReticleRect();
                processSelectionFromRect(rect.minX, rect.minY, rect.maxX, rect.maxY);
            });
        }

        // 切換框選 / 手繪模式
        function setSelectionMode(mode) {
            selectionMode = mode;
            if (btnReticleMode) btnReticleMode.classList.toggle('active', mode === 'reticle');
            if (btnDrawMode) btnDrawMode.classList.toggle('active', mode === 'draw');
            if (reticleOverlay) reticleOverlay.classList.toggle('hidden', mode !== 'reticle');
            if (selectionInstruction) selectionInstruction.classList.toggle('hide-for-draw', mode !== 'reticle');
            if (instructionText) {
                instructionText.textContent = mode === 'reticle'
                    ? '將物體置於框內，點擊下方按鈕拍照'
                    : '請用手指圈選物體';
            }
        }
        if (btnReticleMode) btnReticleMode.addEventListener('click', () => setSelectionMode('reticle'));
        if (btnDrawMode) btnDrawMode.addEventListener('click', () => setSelectionMode('draw'));
        setSelectionMode('reticle');
        loadTaskFromUrl();

        if (taskBgmBtn && taskBgm) {
            taskBgmBtn.addEventListener('click', () => {
                if (taskBgm.paused) {
                    taskBgm.play().catch(() => {});
                    taskBgmBtn.textContent = '🔊';
                } else {
                    taskBgm.pause();
                    taskBgmBtn.textContent = '🎵';
                }
            });
        }
        if (taskIntroBtn && taskIntroPanel) {
            taskIntroBtn.addEventListener('click', () => {
                taskIntroPanel.classList.remove('hidden');
            });
        }
        if (taskIntroClose && taskIntroPanel) {
            taskIntroClose.addEventListener('click', () => {
                taskIntroPanel.classList.add('hidden');
            });
        }
        if (featureDockToggle && featureDockMenu) {
            featureDockToggle.addEventListener('click', async () => {
                await ensureOrientationPermission();
                const willOpen = featureDockMenu.classList.contains('hidden');
                featureDockMenu.classList.toggle('hidden');
                if (!willOpen) {
                    closeDockPanels();
                }
                featureDockToggle.textContent = willOpen ? '×' : '☰';
            });
        }
        if (dockModeBtn) {
            dockModeBtn.addEventListener('click', async () => {
                await ensureOrientationPermission();
                toggleDockPanel('mode');
            });
        }
        if (dockLangBtn) {
            dockLangBtn.addEventListener('click', async () => {
                await ensureOrientationPermission();
                toggleDockPanel('lang');
            });
        }
        if (dockZoomBtn) {
            dockZoomBtn.addEventListener('click', async () => {
                await ensureOrientationPermission();
                toggleDockPanel('zoom');
            });
        }
        if (taskTargetObj) {
            taskTargetObj.addEventListener('click', () => {
                openTaskEncounter();
            });
        }
        if (taskEncounterClose) {
            taskEncounterClose.addEventListener('click', closeTaskEncounter);
        }
        if (taskEncounterStart) {
            taskEncounterStart.addEventListener('click', () => {
                startTaskInteraction().catch((err) => {
                    console.error('開始任務互動失敗', err);
                    Swal.fire({ icon: 'error', title: '任務互動失敗', text: err.message || '請稍後再試' });
                });
            });
        }
        if (btnAnswerCancel) {
            btnAnswerCancel.addEventListener('click', () => {
                answerModal.classList.add('hidden');
            });
        }
        if (btnAnswerSubmit) {
            btnAnswerSubmit.addEventListener('click', () => {
                submitTaskAnswer().catch((err) => {
                    console.error('提交任務答案失敗', err);
                    answerMessage.textContent = '❌ 送出失敗';
                    btnAnswerSubmit.disabled = false;
                });
            });
        }
        if (btnLockCancel) {
            btnLockCancel.addEventListener('click', () => {
                lockOverlay.classList.add('hidden');
            });
        }
        if (btnLockSubmit) {
            btnLockSubmit.addEventListener('click', () => {
                submitLockCode().catch((err) => {
                    console.error('送出密碼失敗', err);
                    lockMsg.textContent = '連線失敗';
                });
            });
        }
        if (btnCompletionClose) {
            btnCompletionClose.addEventListener('click', () => {
                completionModal.classList.add('hidden');
            });
        }

        window.addEventListener('deviceorientation', handleOrientationEvent, true);
        window.addEventListener('deviceorientationabsolute', handleOrientationEvent, true);
        window.addEventListener('pointerdown', async () => {
            await ensureOrientationPermission();
            if (taskReached) {
                tryAutoPlayTaskBgm(0);
            }
        });

        const AI_THINKING_STAGES = {
            upload: [
                '📤 正在上傳照片...',
                '📷 讀取圖片資料中...',
                '🔄 準備傳送至 AI...'
            ],
            analyze: [
                '🔍 AI 正在觀察圖片...',
                '🧠 辨識物體輪廓中...',
                '👀 分析色彩與紋理...',
                '🎯 鎖定主要特徵...',
                '📐 測量比例關係...'
            ],
            plant: [
                '🌿 這看起來像植物...',
                '🍃 分析葉片形狀...',
                '🌸 檢查花朵特徵...',
                '🌳 判斷生長型態...',
                '📋 提取關鍵特徵...'
            ],
            search: [
                '📚 搜尋植物資料庫...',
                '🔎 比對 9000+ 種植物...',
                '⚖️ 計算相似度分數...',
                '🏆 排序最佳候選...'
            ],
            finalize: [
                '✨ 整理辨識結果...',
                '📊 計算信心度...',
                '✅ 準備顯示答案...'
            ]
        };

        let thinkingInterval = null;
        let currentStage = 'upload';
        let stageMessageIndex = 0;

        // 開始 AI 思考動畫
        function startThinkingAnimation() {
            stopThinkingAnimation();
            currentStage = 'upload';
            stageMessageIndex = 0;

            // 立即顯示第一個訊息（不使用延遲）
            if (loadingText) {
                loadingText.textContent = AI_THINKING_STAGES[currentStage][0];
                loadingText.style.opacity = '1';
            }

            console.log('🎬 思考動畫開始:', AI_THINKING_STAGES[currentStage][0]);

            thinkingInterval = setInterval(() => {
                const messages = AI_THINKING_STAGES[currentStage];
                if (messages) {
                    stageMessageIndex = (stageMessageIndex + 1) % messages.length;
                    updateLoadingMessage(messages[stageMessageIndex]);
                }
            }, 1500); // 每 1.5 秒換一個訊息
        }

        // 切換到下一個思考階段
        function setThinkingStage(stage) {
            if (AI_THINKING_STAGES[stage]) {
                currentStage = stage;
                stageMessageIndex = 0;
                console.log('🔄 切換思考階段:', stage, AI_THINKING_STAGES[stage][0]);
                // 立即更新（不使用淡入效果避免延遲）
                if (loadingText) {
                    loadingText.textContent = AI_THINKING_STAGES[stage][0];
                }
            }
        }

        // 停止思考動畫
        function stopThinkingAnimation() {
            if (thinkingInterval) {
                clearInterval(thinkingInterval);
                thinkingInterval = null;
                console.log('⏹️ 思考動畫停止');
            }
        }

        // 更新載入訊息（帶淡入效果）
        function updateLoadingMessage(message) {
            if (loadingText && message) {
                loadingText.style.transition = 'opacity 0.15s ease';
                loadingText.style.opacity = '0.5';
                setTimeout(() => {
                    loadingText.textContent = message;
                    loadingText.style.opacity = '1';
                }, 150);
            }
        }

        // 合併多張照片成一張格子圖
        async function combinePhotosToGrid(photos) {
            return new Promise((resolve) => {
                const count = photos.length;
                if (count === 0) {
                    resolve(null);
                    return;
                }
                if (count === 1) {
                    resolve(photos[0]);
                    return;
                }

                // 創建格子圖 canvas
                const gridCanvas = document.createElement('canvas');
                const ctx = gridCanvas.getContext('2d');

                // 根據照片數量決定排列方式（高解析度 1920x1080 每格）
                const cols = count <= 2 ? count : 2;
                const rows = Math.ceil(count / cols);
                const cellWidth = 1920;
                const cellHeight = 1080;

                gridCanvas.width = cellWidth * cols;
                gridCanvas.height = cellHeight * rows;

                // 填充白色背景
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

                // 載入並繪製每張照片
                let loaded = 0;
                photos.forEach((photoUrl, index) => {
                    const img = new Image();
                    img.onload = () => {
                        const col = index % cols;
                        const row = Math.floor(index / cols);
                        const x = col * cellWidth;
                        const y = row * cellHeight;

                        // 保持比例繪製
                        const scale = Math.min(cellWidth / img.width, cellHeight / img.height);
                        const drawWidth = img.width * scale;
                        const drawHeight = img.height * scale;
                        const offsetX = x + (cellWidth - drawWidth) / 2;
                        const offsetY = y + (cellHeight - drawHeight) / 2;

                        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

                        // 添加照片編號標籤
                        ctx.fillStyle = 'rgba(0,0,0,0.6)';
                        ctx.fillRect(x + 5, y + 5, 30, 25);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 16px sans-serif';
                        ctx.fillText(`${index + 1}`, x + 12, y + 23);

                        loaded++;
                        if (loaded === count) {
                            resolve(gridCanvas.toDataURL('image/jpeg', 0.9));
                        }
                    };
                    img.onerror = () => {
                        loaded++;
                        if (loaded === count) {
                            resolve(gridCanvas.toDataURL('image/jpeg', 0.9));
                        }
                    };
                    img.src = photoUrl;
                });
            });
        }

        // 發送照片進行分析（支援補圖 previous_session）
        async function analyzePhotos(photoDataUrl, systemPrompt, userPrompt, gpsData, opts) {
            const response = await fetch(photoDataUrl);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append('image', blob, 'capture.jpg');
            formData.append('systemPrompt', systemPrompt);
            formData.append('userPrompt', userPrompt);
            formData.append('skipRag', 'true'); // 只使用 LM 回覆，不進行植物 RAG / 資料庫比對

            if (gpsData) {
                formData.append('latitude', gpsData.latitude);
                formData.append('longitude', gpsData.longitude);
            }
            if (opts?.previousSession) {
                formData.append('previous_session', JSON.stringify(opts.previousSession));
            }

            const apiRes = await fetch('/api/vision-test', {
                method: 'POST',
                body: formData
            });

            if (!apiRes.ok) {
                throw new Error('照片分析失敗');
            }

            return await apiRes.json();
        }

        // AI 辨識按鈕 (核心邏輯 - 多照片版本)
        analyzeBtn.addEventListener('click', async () => {
            stopVoiceRecognition();
            analyzeBtn.disabled = true;
            if (addPhotoBtn) addPhotoBtn.disabled = true;
            hideAnswerToast();
            showQueryTransit('照片問題已摺成紙飛機送出...');
            collapseResultPanel();

            // 立即顯示載入動畫（確保在任何 async 之前）
            aiResult.innerHTML = '';
            if(rawOutput) rawOutput.style.display = 'none';
            aiLoading.classList.remove('hidden');

            // 開始 AI 思考動畫
            startThinkingAnimation();

            // 強制渲染更新
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            try {

                // 1. 準備 Prompt
                let finalSystemPrompt = systemPromptInput && systemPromptInput.value ? systemPromptInput.value : '';
                let finalUserPrompt = userPromptInput && userPromptInput.value ? userPromptInput.value : '';

                if (!finalSystemPrompt || finalSystemPrompt.length < 10) {
                    const fallbackScript = getActiveScript();
                    finalSystemPrompt = fallbackScript ? fallbackScript.system : finalSystemPrompt;
                    if (systemPromptInput) systemPromptInput.value = finalSystemPrompt;
                }

                if (!finalUserPrompt) {
                    const fallbackScript = getActiveScript();
                    finalUserPrompt = fallbackScript ? fallbackScript.user : finalUserPrompt;
                }

                const locationTextForPrompt = lastLocationText
                    || (lastLatLng ? `緯度 ${lastLatLng.latitude.toFixed(5)}，經度 ${lastLatLng.longitude.toFixed(5)}` : '');
                if (locationTextForPrompt) {
                    finalSystemPrompt += `\n\n【拍攝地點資訊】${locationTextForPrompt}`;
                    finalUserPrompt += `\n\n拍攝地點：${locationTextForPrompt}`;
                }
                finalSystemPrompt += `\n\n【輸出語言】${getLanguageInstruction()}`;

                // 2. 取得 GPS
                let gpsData = null;
                try {
                    const pos = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000, enableHighAccuracy: false });
                    });
                    gpsData = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                    lastLatLng = gpsData;
                } catch (gpsErr) {
                    console.warn('GPS 略過', gpsErr);
                }

                // 3. 兩段式多圖：補拍時只送新圖 + previous_session；首次則送單張或格子圖
                setThinkingStage('upload');
                const isFollowUp = !!needMorePhotosSession;
                const imageToSend = isFollowUp
                    ? capturedPhotos[capturedPhotos.length - 1]
                    : await combinePhotosToGrid(capturedPhotos);
                if (!imageToSend) throw new Error('無法處理照片');
                updatePreviewArea();

                if (!isFollowUp && capturedPhotos.length > 1) {
                    finalUserPrompt += `\n\n【注意】這是從 ${capturedPhotos.length} 個不同角度拍攝的照片組合，請綜合分析所有角度的特徵。`;
                }

                setThinkingStage('analyze');
                updateLoadingMessage(isFollowUp ? '🔍 正在比對第二張圖...' : '🔍 正在分析圖片...');

                // 未使用 RAG 時不呼叫快速特徵提取（省一次 API，直接由 LM 回覆）
                let quickFeatures = null;

                const result = await analyzePhotos(imageToSend, finalSystemPrompt, finalUserPrompt, gpsData, needMorePhotosSession ? { previousSession: needMorePhotosSession } : null);

                console.log('🤖 API 回應:', result);

                // 跳過 RAG 模式：只顯示 LM 回覆，不處理植物資料庫結果
                if (result.skip_rag) {
                    stopThinkingAnimation();
                    if (quickFeatures) aiResult.innerHTML = '';
                    let displayText = result.description || '';
                    const replyMatch = displayText.match(/<reply>([\s\S]*?)<\/reply>/i);
                    if (replyMatch) displayText = replyMatch[1].trim();
                    await playQueryReturnAnimation('AI 紙飛機帶回了答案');
                    showAnswerToast(displayText);
                    aiLoading.classList.add('hidden');
                    analyzeBtn.disabled = false;
                    analyzeBtn.textContent = '再次辨識';
                    if (addPhotoBtn) addPhotoBtn.disabled = false;
                    retry();
                    return;
                }

                // 兩段式多圖：需要補拍時儲存 session，顯示提示
                if (result.need_more_photos && result.session_data) {
                    needMorePhotosSession = result.session_data;
                    const nextPhotoNum = (result.session_data.photo_count ?? 1) + 1;
                    aiResult.innerHTML = `
                        <div class="need-more-photos" style="text-align:center; padding:20px;">
                            <div style="font-size:28px; margin-bottom:12px;">📷</div>
                            <div style="font-size:16px; font-weight:600; color:#f57c00;">${result.need_more_photos_message || '請從不同角度再拍一張'}</div>
                            <div style="font-size:13px; color:#666; margin-top:8px;">特別是花朵或花序，可提高辨識準確度</div>
                            <div style="margin-top:16px;">
                                <span style="font-size:13px; color:#999;">點「拍攝第 ${nextPhotoNum} 張」補拍後，再點「AI 辨識」</span>
                            </div>
                        </div>
                    `;
                    if (addPhotoBtn) {
                        addPhotoBtn.disabled = false;
                        addPhotoBtn.textContent = `拍攝第 ${nextPhotoNum} 張`;
                    }
                    analyzeBtn.textContent = '補拍後再辨識';
                    await playQueryReturnAnimation('AI 紙飛機請你再補一張');
                    showAnswerToast((result.need_more_photos_message || '請從不同角度再拍一張').replace(/\s+/g, ' ').trim());
                    stopThinkingAnimation();
                    aiLoading.classList.add('hidden');
                    analyzeBtn.disabled = false;
                    return;
                }
                needMorePhotosSession = null;

                // 處理結果
                const allPlants = [];
                let avgConfidence = 0;
                let hasPlantResult = false;

                // 檢查是否有植物 RAG 結果
                if (result.plant_rag?.is_plant && result.plant_rag?.plants?.length > 0) {
                    hasPlantResult = true;
                    setThinkingStage('plant');
                    await new Promise(r => setTimeout(r, 300));

                    result.plant_rag.plants.forEach(p => {
                        // 如果有調整後分數（LM 與 RAG 匹配），使用調整後分數；否則使用原始分數
                        allPlants.push({
                            ...p,
                            displayScore: p.adjusted_score !== undefined ? p.adjusted_score : p.score
                        });
                    });

                    // 使用「最佳匹配」的分數作為信心度（不用平均，避免稀釋）
                    // 例：三色堇 90%、香堇菜 82% → 顯示 90%，而非平均 86%
                    const scores = allPlants.map(p => p.displayScore || p.score);
                    avgConfidence = scores.length > 0 ? Math.max(...scores) : 0;
                    
                    // 如果有 LM 信心度加成，在日誌中顯示
                    if (result.plant_rag.lm_confidence_boost) {
                        console.log(`📈 LM 與 RAG 匹配，信心度加成: ${(result.plant_rag.lm_confidence_boost * 100).toFixed(0)}%`);
                    }

                    setThinkingStage('search');
                    await new Promise(r => setTimeout(r, 500));
                    console.log(`🌿 植物結果: ${allPlants.length} 個, 最佳信心度: ${Math.round(avgConfidence * 100)}%`);
                } else {
                    // 非植物情況也要顯示動畫進度
                    setThinkingStage('analyze');
                    await new Promise(r => setTimeout(r, 500));
                    console.log('📦 非植物結果，類別:', result.plant_rag?.category || 'unknown');
                }

                setThinkingStage('finalize');
                await new Promise(r => setTimeout(r, 300));

                // 停止思考動畫
                stopThinkingAnimation();

                // 將單一結果包裝成陣列格式（兼容後續處理）
                const allResults = [result];

                // 依分數排序植物（使用顯示分數）
                allPlants.sort((a, b) => (b.displayScore || b.score) - (a.displayScore || a.score));

                // 5. 根據結果類型顯示不同內容
                // 如果有快速特徵已顯示，清除它並顯示最終結果
                if (quickFeatures) {
                    // 清除快速特徵顯示區域，準備顯示最終結果
                    aiResult.innerHTML = '';
                }
                
                if (hasPlantResult && avgConfidence >= CONFIDENCE_HIGH) {
                    // 高信心度植物 (≥85%)：直接顯示答案
                    showHighConfidenceResult(allResults, allPlants, avgConfidence);
                } else if (hasPlantResult && avgConfidence >= CONFIDENCE_MEDIUM) {
                    // 中等信心度植物：請求補拍
                    showMediumConfidenceResult(allResults, allPlants, avgConfidence);
                } else if (hasPlantResult && allPlants.length > 0) {
                    // 低信心度但有植物結果：請重新拍攝
                    showLowConfidenceResult(allResults, allPlants, avgConfidence);
                } else {
                    // 沒有植物結果或是其他物品：顯示一般 AI 回應
                    showNonPlantResult(allResults);
                }

                await playQueryReturnAnimation('AI 紙飛機帶回了答案');
                showAnswerToast((aiResult.textContent || '').replace(/\s+/g, ' ').trim());
                retry();

            } catch (err) {
                console.error('API 錯誤:', err);
                stopThinkingAnimation();

                // 根據錯誤類型顯示不同訊息
                let errorMessage = '系統錯誤';
                if (err.message.includes('fetch') || err.message.includes('Failed')) {
                    errorMessage = 'AI 服務暫時無法連線';
                } else if (err.message.includes('timeout')) {
                    errorMessage = 'AI 回應超時';
                } else {
                    errorMessage = err.message;
                }

                aiResult.innerHTML = `
                    <div style="text-align: center; padding: 16px;">
                        <div style="font-size: 28px; margin-bottom: 8px;">⚠️</div>
                        <div style="color: #c62828; font-weight: 500;">${errorMessage}</div>
                        <div style="color: #666; font-size: 13px; margin-top: 8px;">請稍後再試</div>
                    </div>
                `;
                await playQueryReturnAnimation('紙飛機帶回了錯誤訊息');
                showAnswerToast(errorMessage);
            } finally {
                hideQueryTransit();
                stopThinkingAnimation();
                aiLoading.classList.add('hidden');
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = '再次辨識';
                if (addPhotoBtn) addPhotoBtn.disabled = false;
            }
        });

        // 顯示第一階段結果（快速特徵提取）
        function showQuickFeatures(features) {
            // 格式化特徵文字（將列表格式轉換為更易讀的格式）
            let formattedFeatures = features;
            
            // 如果是列表格式（*   **生活型:** ...），轉換為更易讀的格式
            if (features.includes('*') && features.includes('**')) {
                formattedFeatures = features
                    .split('\n')
                    .filter(line => line.trim().startsWith('*'))
                    .map(line => {
                        // 移除 * 和 ** 標記，保留內容
                        return line.replace(/^\*\s*\*\*/, '•').replace(/\*\*/g, '').trim();
                    })
                    .join('\n');
            }
            
            aiResult.innerHTML = `
                <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #81c784;">
                    <div style="display: flex; align-items: center; margin-bottom: 12px;">
                        <div style="font-size: 24px; margin-right: 8px;">🔍</div>
                        <div style="font-size: 16px; font-weight: 600; color: #2e7d32;">圖片細節分析</div>
                    </div>
                    <div style="background: white; border-radius: 8px; padding: 12px; font-size: 14px; line-height: 1.8; color: #333; white-space: pre-wrap;">${formattedFeatures}</div>
                    <div style="margin-top: 12px; text-align: center; font-size: 12px; color: #666;">
                        <div style="display: inline-flex; align-items: center;">
                            <div style="width: 12px; height: 12px; border-radius: 50%; background: #4caf50; margin-right: 6px; animation: pulse 1.5s infinite;"></div>
                            正在比對資料庫，請稍候...
                        </div>
                    </div>
                </div>
            `;
            
            // 確保結果區域可見
            aiResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // 高信心度結果 (>85%)
        function showHighConfidenceResult(allResults, plants, confidence) {
            const topPlant = plants[0];
            const confidencePercent = Math.round(confidence * 100);

            let html = `
                <div style="text-align: center; margin-bottom: 12px;">
                    <div style="font-size: 28px; margin-bottom: 8px;">🌿</div>
                    <div style="font-size: 18px; font-weight: 600; color: #2e7d32;">辨識結果</div>
                    <div class="confidence-bar" style="margin: 12px auto; max-width: 200px;">
                        <div class="confidence-fill high" style="width: ${confidencePercent}%"></div>
                    </div>
                    <div style="font-size: 13px; color: #4caf50;">信心度: ${confidencePercent}%</div>
                </div>
            `;

            // 主要植物
            html += `
                <div style="padding: 16px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-radius: 12px; border: 2px solid #4caf50; margin-bottom: 12px;">
                    <div style="font-size: 20px; font-weight: 600; color: #1b5e20; margin-bottom: 4px;">
                        ${topPlant.chinese_name || topPlant.scientific_name}
                    </div>
                    <div style="font-size: 14px; color: #558b2f; font-style: italic; margin-bottom: 8px;">
                        ${topPlant.scientific_name}
                    </div>
                    <div style="font-size: 13px; color: #666;">
                        科: ${topPlant.family || '-'} | 型態: ${topPlant.life_form || '-'}
                    </div>
                    ${topPlant.summary ? `<div style="font-size: 13px; color: #555; margin-top: 8px; line-height: 1.5;">${topPlant.summary}</div>` : ''}
                </div>
            `;

            // 其他可能
            if (plants.length > 1) {
                html += `<div style="font-size: 13px; color: #666; margin-top: 8px;">其他可能: `;
                html += plants.slice(1, 3).map(p => p.chinese_name || p.scientific_name).join('、');
                html += `</div>`;
            }

            aiResult.innerHTML = html;
        }

        // 中等信心度結果 (40-85%)
        function showMediumConfidenceResult(allResults, plants, confidence) {
            const confidencePercent = Math.round(confidence * 100);

            let html = `
                <div class="need-more-photos">
                    <div class="icon">🤔</div>
                    <div class="message">需要更多角度確認</div>
                    <div class="hint">目前信心度 ${confidencePercent}%，請再拍攝一個不同角度</div>
                </div>
            `;

            // 顯示目前猜測（使用 displayScore = LM 加成後的調整分數）
            if (plants.length > 0) {
                html += `
                    <div style="margin-top: 12px; padding: 12px; background: #fff8e1; border-radius: 8px; border: 1px solid #ffe082;">
                        <div style="font-size: 13px; color: #f57c00; margin-bottom: 8px;">目前推測:</div>
                        ${plants.slice(0, 2).map(p => {
                            const score = (p.displayScore !== undefined ? p.displayScore : p.score) * 100;
                            return `
                            <div style="font-size: 14px; color: #333;">
                                • ${p.chinese_name || p.scientific_name} <span style="color:#999">(${Math.round(score)}%)</span>
                            </div>
                        `}).join('')}
                    </div>
                `;
            }

            aiResult.innerHTML = html;

            // 允許補拍一張
            if (addPhotoBtn) {
                addPhotoBtn.disabled = false;
                addPhotoBtn.textContent = '補拍一張';
            }
            analyzeBtn.textContent = '重新分析';
        }

        // 低信心度結果 (<40%)
        function showLowConfidenceResult(allResults, plants, confidence) {
            const confidencePercent = Math.round(confidence * 100);

            aiResult.innerHTML = `
                <div class="retry-message">
                    <div class="icon">📷</div>
                    <div class="message">無法確認辨識結果</div>
                    <div class="hint">信心度僅 ${confidencePercent}%，建議重新拍攝</div>
                </div>
                <div style="margin-top: 12px; text-align: center;">
                    <div style="font-size: 13px; color: #666; margin-bottom: 8px;">拍攝建議:</div>
                    <div style="font-size: 12px; color: #888; line-height: 1.6;">
                        • 確保光線充足<br>
                        • 拍攝葉片、花朵等特徵<br>
                        • 避免過度晃動
                    </div>
                </div>
            `;

            // 重置照片
            retryBtn.textContent = '重新拍攝';
        }

        // 非植物結果
        function showNonPlantResult(allResults) {
            // 使用第一張照片的 AI 回應
            const firstResult = allResults[0];
            console.log('📋 showNonPlantResult called:', firstResult);

            if (!firstResult?.success) {
                aiResult.innerHTML = '<span style="color:red">辨識失敗，請重試</span>';
                return;
            }

            let fullText = firstResult.description || '';

            if (!fullText) {
                aiResult.innerHTML = '<span style="color:red">AI 回應為空，請再試一次</span>';
                return;
            }

            // 移除 markdown 代碼區塊標記 (```xml ... ``` 或 ```json ... ```)
            fullText = fullText.replace(/^```(?:xml|json)?\s*/i, '').replace(/\s*```$/i, '');

            // XML 解析邏輯
            function extractTag(text, tag) {
                // 使用非貪婪匹配，但確保匹配到正確的結束標籤
                // 先找到所有可能的標籤位置
                const openTag = `<${tag}>`;
                const closeTag = `</${tag}>`;
                const openIndex = text.indexOf(openTag);
                if (openIndex === -1) return null;
                
                // 從開始標籤之後開始搜尋結束標籤
                const startPos = openIndex + openTag.length;
                const closeIndex = text.indexOf(closeTag, startPos);
                if (closeIndex === -1) return null;
                
                return text.substring(startPos, closeIndex).trim();
            }

            let finalReplyText = extractTag(fullText, 'reply');

            // 如果沒有 <reply> 標籤，嘗試其他方式
            if (!finalReplyText) {
                // 嘗試提取 </analysis> 後的內容（<reply> 通常在 </analysis> 之後）
                // 先找到最後一個 </analysis> 的位置（因為可能有多個）
                let analysisEndIndex = -1;
                let searchIndex = 0;
                while (true) {
                    const found = fullText.indexOf('</analysis>', searchIndex);
                    if (found === -1) break;
                    analysisEndIndex = found;
                    searchIndex = found + 11;
                }
                
                if (analysisEndIndex !== -1) {
                    // 從 </analysis> 之後提取內容
                    let afterAnalysis = fullText.substring(analysisEndIndex + 11).trim();
                    
                    // 🔥 關鍵修復：移除 JSON 區塊 (```json ... ```)
                    // 很多時候模型會在 </analysis> 後面接 JSON，然後才是 <reply> 或直接結束
                    // 我們需要把 JSON 區塊移除，以免它被當成回覆顯示
                    const jsonBlockStart = afterAnalysis.indexOf('```json');
                    if (jsonBlockStart !== -1) {
                        const jsonBlockEnd = afterAnalysis.indexOf('```', jsonBlockStart + 7);
                        if (jsonBlockEnd !== -1) {
                            // 移除 JSON 區塊，保留前後內容
                            afterAnalysis = afterAnalysis.substring(0, jsonBlockStart) + afterAnalysis.substring(jsonBlockEnd + 3);
                        } else {
                            // 如果 JSON 區塊沒閉合，直接截斷
                            afterAnalysis = afterAnalysis.substring(0, jsonBlockStart);
                        }
                    }
                    
                    // 移除可能的結尾 ``` 標記
                    afterAnalysis = afterAnalysis.replace(/\s*```$/i, '');
                    // 移除 <reply> 和 </reply> 標記如果存在
                    afterAnalysis = afterAnalysis.replace(/<\/?reply>/gi, '').trim();
                    
                    // 如果還有內容，使用它
                    if (afterAnalysis && afterAnalysis.length > 10) {
                        finalReplyText = afterAnalysis;
                    }
                }
            }

            // 如果還是沒有內容，嘗試使用 <analysis> 內容
            if (!finalReplyText) {
                finalReplyText = extractTag(fullText, 'analysis');
            }

            // 最後嘗試：使用整個回應（移除 XML 標籤）
            if (!finalReplyText) {
                finalReplyText = fullText
                    .replace(/<\/?(?:analysis|reply|result)>/gi, '')
                    .replace(/\s*```$/i, '')
                    .trim();
            }

            // 移除可能殘留的 XML/markdown 標記
            finalReplyText = finalReplyText.replace(/<\/?reply>/gi, '').trim();

            console.log('📝 Final reply text:', finalReplyText.substring(0, 100) + '...');

            if (finalReplyText) {
                // 決定顯示的類別圖標
                let categoryInfo = '';
                if (firstResult.plant_rag) {
                    const cat = firstResult.plant_rag.category || '一般物品';
                    const categoryIcons = {
                        'animal': '🐾 動物',
                        'artifact': '🔧 人造物',
                        'food': '🍴 食物',
                        'other': '📦 其他',
                        'plant': '🌿 植物'
                    };
                    categoryInfo = categoryIcons[cat] || `📝 ${cat}`;
                }

                aiResult.innerHTML = `
                    <div style="text-align: center; margin-bottom: 10px;">
                        <span style="font-size: 24px;">${categoryInfo.split(' ')[0] || '🔍'}</span>
                    </div>
                    <div style="padding: 12px; background: #f5f5f5; border-radius: 8px; line-height: 1.6;">
                        ${finalReplyText.replace(/\n/g, '<br>')}
                    </div>
                `;

                // 顯示識別類別
                if (categoryInfo) {
                    aiResult.innerHTML += `
                        <div style="margin-top: 8px; font-size: 12px; color: #666; text-align: center;">
                            ${categoryInfo}
                        </div>
                    `;
                }
            } else {
                aiResult.innerHTML = '<span style="color:red">AI 回應為空，請再試一次</span>';
            }
        }

        // ------------------------------------------------
        // 6. 初始化 (Initialization)
        // ------------------------------------------------
        resizeCanvas();
        initLanguageSelector();
        initSpeechChat();
        setMode('free'); // 預設模式
        initMiniMap();
        startCamera();
        
        log('初始化完成');

    } catch (criticalErr) {
        console.error('致命錯誤:', criticalErr);
        log('FATAL: ' + criticalErr.message);
        alert('程式啟動失敗，請重新整理頁面: ' + criticalErr.message);
    }
});
