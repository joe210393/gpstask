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
        const MISSION_ENABLED = true; // 測試版：可關閉以回到單關卡模式
        const MISSION_STYLE_POOL = {
            fail: [
                "你到底在亂找什麼？這種東西也敢拿來？",
                "笑死，這跟任務毫無關係，重找。",
                "這不是遙控器/電池，你是在搞笑嗎？",
                "別浪費我時間，去找正確的東西。",
                "你看清楚了嗎？這根本不是我要的。"
            ],
            success: [
                "哼，居然被你找到…別太得意。",
                "行吧，算你有點用。",
                "好啊，算你過關，別拖拖拉拉。",
                "切，運氣不錯，但下一關不會這麼好。",
                "不錯，但別以為這樣就結束了。"
            ]
        };

        const MISSION_STEPS = [
            {
                key: 'remote',
                title: "🛡️ 密室逃脫任務：遙控器之謎",
                intro: "【劇情前情提要】\n你醒來時發現自己被困在一個陌生的房間，門窗都打不開。\n牆上的電視閃爍著雜訊，旁邊有一張紙條寫著：\n「只有看見真相的人才能離開...」\n\n看來你必須找到【遙控器】並打開電視，才能找到逃脫的線索。\n快看看四周有什麼可疑的東西吧！",
                system: `你是一個性格扭曲、講話陰陽怪氣的密室設計者。
任務目標：玩家必須找到【電視遙控器 (TV Remote)】。

請嚴格執行以下思考步驟：
1. 先客觀辨識圖片中的物品到底是什麼。(例如：瓶子、手機、滑鼠、書本...)
2. 比對該物品是否為「電視遙控器」。注意：形狀相似的長方形物體(如藥罐、眼鏡盒)都不是遙控器。
3. 只有在【100% 確定是遙控器】時，才算成功。

請依照 XML 格式回答，**必須完成三個標籤**：
<analysis>
1. 我看到的物品是：(例如：一罐魚油)
2. 它是不是遙控器：(是/否)
</analysis>
<reply>
請嚴格遵守：
如果不符合任務目標(不是遙控器)，只能進行嘲諷。絕對不可以說出「恭喜」或「找到了」。
如果符合任務目標(是遙控器)，才能說「恭喜」。

範例 A (不是遙控器)：
哈？你拿一個電風扇想幹嘛？這能轉台嗎？快去給我找遙控器！

範例 B (是遙控器)：
切...居然被你找到了。好吧，快打開電視，滾出我的視線！
</reply>
<result>
success 或 fail (只能二選一，小寫)
</result>

**重要：必須完成 <reply> 與 <result> 標籤才能結束回應，否則任務失敗。**`,
                user: "我找到了這個，這能幫我逃出去嗎？"
            },
            {
                key: 'battery',
                title: "🔋 第二關：電力解鎖",
                intro: "【轉折】雖然你找到了遙控器，但它好像沒有電。\n電視亮了一下又熄掉，你注意到遙控器背蓋鬆動。\n紙條又出現一句話：\n「沒有能量，真相就不會說話。」\n\n看來你得找到【電池】或【遙控器電池蓋】。快找找附近的小物件！",
                system: `你是一個性格扭曲、講話陰陽怪氣的密室設計者。
任務目標：玩家必須找到【電池 (Battery)】或【遙控器電池蓋】。

請嚴格執行以下思考步驟：
1. 先客觀辨識圖片中的物品到底是什麼。(例如：電池、硬幣、鑰匙、眼鏡盒...)
2. 比對該物品是否為「電池」或「遙控器電池蓋」。
3. 只有在【100% 確定是電池或電池蓋】時，才算成功。

請依照 XML 格式回答，**必須完成三個標籤**：
<analysis>
1. 我看到的物品是：(例如：一顆AA電池)
2. 它是不是電池或電池蓋：(是/否)
</analysis>
<reply>
請嚴格遵守：
如果不符合任務目標，只能進行嘲諷。絕對不可以說出「恭喜」或「找到了」。
如果符合任務目標，才能說「恭喜」。
</reply>
<result>
success 或 fail (只能二選一，小寫)
</result>

**重要：必須完成 <reply> 與 <result> 標籤才能結束回應，否則任務失敗。**`,
                user: "我找到這個了，能讓電視開起來嗎？"
            }
        ];

        const PROMPTS = {
            free: {
                title: "🌿 自由探索模式",
                intro: "這裡沒有任務壓力，你可以隨意拍攝身邊的植物或物品，我會為你介紹它們的小知識。",
                system: `你是一位專業的植物形態學家與生態研究員。

**重要：你必須按照以下步驟進行分析，絕對不能跳過任何步驟！**

請依照以下 XML 格式回答：

<analysis>
**第一步：尺寸判斷（必須完成，用於驗證生活型）**

**請仔細觀察圖片中的尺寸參考：**
- 如果有手指、硬幣、手錶等參考物，請描述物體相對於參考物的大小
- 如果沒有參考物，請描述物體在畫面中的比例（佔畫面多少比例）
- 估算物體的實際尺寸範圍（例如：葉片長度約 5-10 公分、花朵直徑約 2-3 公分、整體高度約 30-50 公分）

**尺寸判斷的重要性：**
- 喬木：通常高度 > 3 公尺，主幹明顯
- 灌木：通常高度 0.5-3 公尺，多分枝
- 草本：通常高度 < 0.5 公尺，莖柔軟
- 如果判斷為「灌木」但尺寸只有 10 公分，請重新檢查！

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

**三、根與莖（Root & Stem）**
- 根的類型：直根、鬚根、氣生根、儲藏根、支柱根
- 莖的類型：地上莖、地下莖、匍匐莖、直立莖、肉質莖、木質莖
- 地下莖細分：根莖、球莖、鱗莖、塊莖

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
- 乾果：裂果、不裂果、翅果、堅果
- 肉果：漿果、核果、梨果、聚合果
- 果實來源：單果、聚合果、多花果

**範例（正確）：**
「這是一種灌木植物，整體高度約 50-80 公分。葉序為對生，葉形為橢圓形，葉緣為鋸齒緣，葉片長約 5-8 公分。具有聚繖花序，花朵密集排列成球狀，花朵直徑約 2-3 公分，花色為粉紅色。」

**範例（錯誤）：**
「這是一種綠色植物，葉子長長的，邊緣有鋸齒，開白色小花。」（不能用這種描述！）

**如果是動物：** 描述體型、顏色、特徵部位、行為等
**如果是物品：** 描述形狀、顏色、材質、大小、用途等

**第三步：判斷類別（必須完成）**
明確指出這是：植物 / 動物 / 人造物 / 其他

**第四步：提取生物特徵（僅限植物）**
如果是植物，請用上述專業術語提取關鍵識別特徵，例如：
- 生活型：灌木（必須與尺寸判斷一致！）
- 葉序：對生
- 葉形：橢圓形
- 葉緣：鋸齒緣
- 花序：聚繖花序（必須仔細觀察！）
- 花色：粉紅色
- 尺寸：高度 50-80 公分，花朵直徑 2-3 公分
- 其他：有刺、氣生根等

**第五步：尺寸驗證（僅限植物）**
檢查生活型與尺寸是否一致：
- 如果判斷為「喬木」但高度只有 30 公分 → 重新判斷為「灌木」或「草本」
- 如果判斷為「灌木」但高度只有 10 公分 → 重新判斷為「草本」
- 如果判斷為「草本」但高度有 2 公尺 → 重新判斷為「灌木」

**第六步：初步猜測（僅限植物）**
根據你觀察到的特徵，猜測可能是什麼植物（給 1-3 個候選名稱，中文為主）

**注意：絕對不要直接給出最終答案！你只能描述細節和猜測，最終答案需要透過資料庫比對後才能確定。**
</analysis>

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

        // ------------------------------------------------
        // 2. 狀態變數 (State Variables) - 必須在函數前宣告
        // ------------------------------------------------
        let isDrawing = false;
        let points = [];
        let stream = null;
        let facingMode = 'environment'; // 預設使用後鏡頭
        let currentMode = 'free';       // 預設模式
        let missionStepIndex = 0;
        let missionCompleted = false;
        let mapInstance = null;
        let mapMarker = null;
        let lastLocationText = '';
        let lastLatLng = null;

        // ------------------------------------------------
        // 3. DOM 元素選取 (DOM Elements)
        // ------------------------------------------------
        const video = document.getElementById('cameraFeed');
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');
        const instruction = document.querySelector('.instruction');
        const resultPanel = document.getElementById('resultPanel');
        const croppedImage = document.getElementById('croppedImage');
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

        // Multi-photo state
        const capturedPhotos = [];
        const REQUIRED_PHOTOS = 3;
        const CONFIDENCE_HIGH = 0.85;
        const CONFIDENCE_MEDIUM = 0.40;
        
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
        const voiceUser = document.getElementById('voiceUser');
        const voiceAi = document.getElementById('voiceAi');
        const voiceStatus = document.getElementById('voiceStatus');
        const voiceSpeakToggle = document.getElementById('voiceSpeakToggle');
        const cameraContainer = document.querySelector('.camera-container');
        let miniMapEl = document.getElementById('miniMap');
        let locationInfoEl = document.getElementById('locationInfo');
        let miniMapWrap = document.querySelector('.mini-map-wrap');
        let miniMapToggle = document.getElementById('miniMapToggle');
        let miniMapRefresh = document.getElementById('miniMapRefresh');
        const locationBar = document.getElementById('locationBar');

        if (!video || !canvas) throw new Error('關鍵 DOM 元素遺失');

        // ------------------------------------------------
        // 4. 功能函數 (Functions)
        // ------------------------------------------------

        // 畫布調整
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        // 取得當前劇本
        function getActiveScript() {
            if (currentMode === 'mission' && MISSION_ENABLED) {
                return MISSION_STEPS[missionStepIndex] || MISSION_STEPS[0];
            }
            return PROMPTS[currentMode];
        }

        function resetMission() {
            missionStepIndex = 0;
            missionCompleted = false;
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

        let speechRecognition = null;
        let isRecording = false;

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
            if (micBtn) micBtn.classList.remove('active');
            if (voiceStatus) voiceStatus.textContent = '語音待命';
            if (voicePanel) voicePanel.classList.add('hidden');
        }

        async function sendVoiceChat(userText) {
            try {
                updateVoicePanel(userText, '...', '送出中');
                let finalSystemPrompt = systemPromptInput && systemPromptInput.value ? systemPromptInput.value : '';
                let finalUserPrompt = userPromptInput && userPromptInput.value ? userPromptInput.value : '';
                if (!finalSystemPrompt || finalSystemPrompt.length < 10) {
                    const fallbackScript = getActiveScript();
                    finalSystemPrompt = fallbackScript ? fallbackScript.system : finalSystemPrompt;
                }
                if (!finalUserPrompt) {
                    const fallbackScript = getActiveScript();
                    finalUserPrompt = fallbackScript ? fallbackScript.user : finalUserPrompt;
                }

                const locationTextForPrompt = lastLocationText
                    || (lastLatLng
                        ? `緯度 ${lastLatLng.latitude.toFixed(5)}，經度 ${lastLatLng.longitude.toFixed(5)}`
                        : '');
                if (locationTextForPrompt) {
                    finalSystemPrompt += `\n\n【拍攝地點資訊】${locationTextForPrompt}`;
                }
                finalSystemPrompt += `\n\n【輸出語言】${getLanguageInstruction()}`;
                finalSystemPrompt += `\n\n【回答規範】請不要在回覆中提及「我根據地點資訊/位置資訊推斷」或引用地名作為判斷依據。地點僅作為背景參考，回答要自然。`;

                const payload = {
                    systemPrompt: finalSystemPrompt,
                    userPrompt: finalUserPrompt,
                    text: userText,
                    locationText: locationTextForPrompt
                };

                const apiRes = await fetch('/api/chat-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!apiRes.ok) {
                    const errText = await apiRes.text();
                    throw new Error(`伺服器錯誤: ${errText}`);
                }
                const data = await apiRes.json();
                if (!data.success) throw new Error(data.message || 'AI 回覆失敗');

                const rawText = data.description || '';
                const cleanedText = rawText.replace(/```xml|```/gi, '').trim();
                const replyMatch = cleanedText.match(/<reply>([\s\S]*?)<\/reply>/i);
                const fallbackMatch = cleanedText.match(/<analysis>([\s\S]*?)<\/analysis>/i);
                const replyText = replyMatch
                    ? replyMatch[1].trim()
                    : (cleanedText || (fallbackMatch ? fallbackMatch[1].trim() : ''));
                updateVoicePanel(userText, replyText, '完成');

                const shouldSpeak = voiceSpeakToggle ? voiceSpeakToggle.checked : true;
                if (shouldSpeak && 'speechSynthesis' in window && replyText) {
                    const utter = new SpeechSynthesisUtterance(replyText);
                    utter.lang = getSpeechLocale();
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(utter);
                }
            } catch (err) {
                console.error('語音聊天錯誤', err);
                updateVoicePanel(userText, '語音回覆失敗，請再試一次', '失敗');
            }
        }

        function initSpeechChat() {
            if (!micBtn) return;
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const showTextFallback = async () => {
                const result = await Swal.fire({
                    title: '改用文字輸入',
                    input: 'text',
                    inputPlaceholder: '請輸入你要問的內容',
                    showCancelButton: true,
                    confirmButtonText: '送出'
                });
                if (result.isConfirmed && result.value) {
                    sendVoiceChat(result.value.trim());
                }
            };
            if (!SpeechRecognition) {
                micBtn.addEventListener('click', () => {
                    Swal.fire({
                        icon: 'info',
                        title: '語音辨識不可用',
                        text: isIOS ? 'iOS Safari 不支援語音辨識，請改用文字輸入或使用支援的瀏覽器' : '此裝置或瀏覽器不支援語音辨識'
                    }).then(showTextFallback);
                });
                return;
            }

            const recognition = new SpeechRecognition();
            speechRecognition = recognition;
            recognition.lang = getSpeechLocale();
            recognition.interimResults = true;
            recognition.continuous = false;

            micBtn.addEventListener('click', () => {
                if (!isRecording) {
                    recognition.lang = getSpeechLocale();
                    updateVoicePanel('', '', '聆聽中...');
                    recognition.start();
                    isRecording = true;
                    micBtn.classList.add('active');
                } else {
                    stopVoiceRecognition();
                }
            });

            recognition.onstart = () => {
                updateVoicePanel('', '', '聆聽中...');
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
                updateVoicePanel(finalTranscript || interim, '...', '辨識中...');
                if (finalTranscript) {
                    stopVoiceRecognition();
                    sendVoiceChat(finalTranscript.trim());
                }
            };

            recognition.onerror = (event) => {
                console.warn('語音辨識錯誤', event);
                const reason = event.error || 'unknown';
                updateVoicePanel('', '語音辨識失敗', '失敗');
                isRecording = false;
                micBtn.classList.remove('active');
                Swal.fire({
                    icon: 'error',
                    title: '語音辨識失敗',
                    text: isIOS ? 'iOS Safari 常會失敗，建議改用文字輸入' : `錯誤：${reason}`
                }).then(showTextFallback);
            };

            recognition.onend = () => {
                isRecording = false;
                micBtn.classList.remove('active');
                if (voiceStatus) voiceStatus.textContent = '語音待命';
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
        function setMode(mode) {
            log(`切換模式: ${mode}`);
            currentMode = mode;

            // UI 按鈕狀態更新
            modeBtns.forEach(btn => {
                if (btn.dataset.mode === mode) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            // Body class 更新 (CSS特效用)
            document.body.className = `mode-${mode}`;

            if (mode === 'mission' && MISSION_ENABLED) {
                resetMission();
            }

            const script = getActiveScript();
            applyScript(script, true);
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
            if (e.touches) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        }

        function startDraw(e) {
            stopVoiceRecognition();
            if (resultPanel.style.display === 'flex') return;
            isDrawing = true;
            points = [];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const pos = getPos(e);
            points.push(pos);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ffd700';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            instruction.style.opacity = '0';
        }

        function moveDraw(e) {
            if (!isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            points.push(pos);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }

        function endDraw() {
            if (!isDrawing) return;
            isDrawing = false;
            ctx.closePath();
            if (points.length > 5) {
                processSelection()
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                instruction.style.opacity = '1';
            }
        }

        // 截圖處理
        function processSelection() {
            // 計算邊界
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
            
            const width = maxX - minX;
            const height = maxY - minY;

            // 建立暫存 Canvas 處理原始影像
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = video.videoWidth;
            tempCanvas.height = video.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            // 計算縮放比例與位移
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

            // 映射座標
            const sourceX = (minX - offsetX) * (video.videoWidth / renderWidth);
            const sourceY = (minY - offsetY) * (video.videoHeight / renderHeight);
            const sourceW = width * (video.videoWidth / renderWidth);
            const sourceH = height * (video.videoHeight / renderHeight);

            // 最終截圖
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = width;
            finalCanvas.height = height;
            const finalCtx = finalCanvas.getContext('2d');

            try {
                finalCtx.drawImage(tempCanvas, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
                const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.95); // 高畫質
                addPhotoToCollection(dataUrl);
            } catch (e) {
                console.error('截圖失敗', e);
                aiResult.innerHTML = '<span style="color:red">截圖失敗: ' + e.message + '</span>';
                showResultPanel();
            }
        }

        // 添加照片到集合
        function addPhotoToCollection(dataUrl) {
            if (capturedPhotos.length >= REQUIRED_PHOTOS) {
                // 已滿，替換最後一張
                capturedPhotos[REQUIRED_PHOTOS - 1] = dataUrl;
            } else {
                capturedPhotos.push(dataUrl);
            }

            // 更新 UI
            updatePhotoStrip();
            croppedImage.src = dataUrl;
            showResultPanel();
        }

        // 更新照片條
        function updatePhotoStrip() {
            photoSlots.forEach((slot, index) => {
                slot.classList.remove('filled', 'active');
                const existingImg = slot.querySelector('img');
                if (existingImg) existingImg.remove();

                if (capturedPhotos[index]) {
                    slot.classList.add('filled');
                    const img = document.createElement('img');
                    img.src = capturedPhotos[index];
                    slot.appendChild(img);
                }
            });

            // 標記下一個要拍的位置
            const nextIndex = Math.min(capturedPhotos.length, REQUIRED_PHOTOS - 1);
            if (capturedPhotos.length < REQUIRED_PHOTOS) {
                photoSlots[nextIndex]?.classList.add('active');
            }

            // 更新提示文字和按鈕狀態
            const count = capturedPhotos.length;
            if (count >= REQUIRED_PHOTOS) {
                if (photoHint) {
                    photoHint.textContent = '✓ 已拍攝 3 張照片，可以開始辨識';
                    photoHint.classList.add('complete');
                }
                analyzeBtn.disabled = false;
                if (addPhotoBtn) {
                    addPhotoBtn.disabled = true;
                    addPhotoBtn.textContent = '已完成';
                }
            } else {
                if (photoHint) {
                    photoHint.textContent = `請從不同角度拍攝 (${count}/${REQUIRED_PHOTOS})`;
                    photoHint.classList.remove('complete');
                }
                analyzeBtn.disabled = true;
                if (addPhotoBtn) {
                    addPhotoBtn.disabled = false;
                    addPhotoBtn.textContent = `拍攝第 ${count + 1} 張`;
                }
            }
        }

        function showResultPanel() {
            resultPanel.style.display = 'flex';
            resultPanel.classList.add('active');

            const count = capturedPhotos.length;
            if (count < REQUIRED_PHOTOS) {
                aiResult.innerHTML = `<div style="text-align:center; color:#666;">
                    <div style="font-size:24px; margin-bottom:8px;">📷</div>
                    <div>請繼續拍攝不同角度的照片</div>
                    <div style="font-size:13px; color:#999; margin-top:4px;">多角度可提高辨識準確度</div>
                </div>`;
            } else {
                aiResult.innerHTML = '準備就緒，點擊「AI 辨識」開始分析';
            }
            if(rawOutput) rawOutput.style.display = 'none';
            analyzeBtn.textContent = 'AI 辨識';
        }

        function retry() {
            // 清空所有照片
            capturedPhotos.length = 0;
            updatePhotoStrip();

            resultPanel.classList.remove('active');
            resultPanel.style.display = 'none';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            instruction.style.opacity = '1';
            aiResult.innerHTML = '';
            points = [];
        }

        // ------------------------------------------------
        // 5. 事件監聽 (Event Listeners)
        // ------------------------------------------------

        // 視窗大小改變
        window.addEventListener('resize', resizeCanvas);

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

        // 返回
        backBtn.addEventListener('click', () => {
            window.location.href = '/'; 
        });

        // 繪圖事件
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', moveDraw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', moveDraw, { passive: false });
        canvas.addEventListener('touchend', (e) => { e.preventDefault(); endDraw(); }, { passive: false });
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
                instruction.style.opacity = '1';
            });
        }

        // AI 思考動畫系統
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

        // 發送照片進行分析（單次請求）
        async function analyzePhotos(photoDataUrl, systemPrompt, userPrompt, gpsData) {
            const response = await fetch(photoDataUrl);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append('image', blob, 'capture_grid.jpg');
            formData.append('systemPrompt', systemPrompt);
            formData.append('userPrompt', userPrompt);

            if (gpsData) {
                formData.append('latitude', gpsData.latitude);
                formData.append('longitude', gpsData.longitude);
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

                if (currentMode === 'mission' && MISSION_ENABLED) {
                    const failHint = MISSION_STYLE_POOL.fail[Math.floor(Math.random() * MISSION_STYLE_POOL.fail.length)];
                    const successHint = MISSION_STYLE_POOL.success[Math.floor(Math.random() * MISSION_STYLE_POOL.success.length)];
                    finalSystemPrompt += `\n\n【語氣變化指令】\n失敗時請隨機使用一種嘲諷風格，例如：${failHint}\n成功時請隨機使用一種帶刺的肯定，例如：${successHint}`;
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

                // 3. 合併照片並分析（單次 API 請求）
                setThinkingStage('upload');
                updateLoadingMessage('📷 合併照片中...');

                // 如果有多張照片，合併成格子圖
                const gridImage = await combinePhotosToGrid(capturedPhotos);
                if (!gridImage) {
                    throw new Error('無法處理照片');
                }

                // 更新預覽圖為合併後的格子圖
                croppedImage.src = gridImage;

                // 添加多照片提示到 prompt
                if (capturedPhotos.length > 1) {
                    finalUserPrompt += `\n\n【注意】這是從 ${capturedPhotos.length} 個不同角度拍攝的照片組合，請綜合分析所有角度的特徵。`;
                }

                setThinkingStage('analyze');

                // 單次 API 請求
                const result = await analyzePhotos(gridImage, finalSystemPrompt, finalUserPrompt, gpsData);

                console.log('🤖 API 回應:', result);

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
                        allPlants.push(p);
                    });

                    // 計算平均信心度
                    const scores = allPlants.map(p => p.score);
                    avgConfidence = scores.reduce((a, b) => a + b, 0) / scores.length;

                    setThinkingStage('search');
                    await new Promise(r => setTimeout(r, 500));
                    console.log(`🌿 植物結果: ${allPlants.length} 個, 平均信心度: ${Math.round(avgConfidence * 100)}%`);
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

                // 依分數排序植物
                allPlants.sort((a, b) => b.score - a.score);

                // 5. 根據結果類型顯示不同內容
                if (hasPlantResult && avgConfidence >= CONFIDENCE_HIGH) {
                    // 高信心度植物：直接顯示答案
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
            } finally {
                stopThinkingAnimation();
                aiLoading.classList.add('hidden');
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = '再次辨識';
                if (addPhotoBtn) addPhotoBtn.disabled = false;
            }
        });

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

            // 顯示目前猜測
            if (plants.length > 0) {
                html += `
                    <div style="margin-top: 12px; padding: 12px; background: #fff8e1; border-radius: 8px; border: 1px solid #ffe082;">
                        <div style="font-size: 13px; color: #f57c00; margin-bottom: 8px;">目前推測:</div>
                        ${plants.slice(0, 2).map(p => `
                            <div style="font-size: 14px; color: #333;">
                                • ${p.chinese_name || p.scientific_name} <span style="color:#999">(${Math.round(p.score * 100)}%)</span>
                            </div>
                        `).join('')}
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
                const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
                return match ? match[1].trim() : null;
            }

            let finalReplyText = extractTag(fullText, 'reply');

            // 如果沒有 <reply> 標籤，嘗試其他方式
            if (!finalReplyText) {
                // 嘗試提取 </analysis> 後的內容
                const analysisEndIndex = fullText.indexOf('</analysis>');
                if (analysisEndIndex !== -1) {
                    finalReplyText = fullText.substring(analysisEndIndex + 11).trim();
                    // 移除可能的結尾 ``` 標記
                    finalReplyText = finalReplyText.replace(/\s*```$/i, '');
                    // 移除 <reply> 和 </reply> 標記如果存在
                    finalReplyText = finalReplyText.replace(/<\/?reply>/gi, '').trim();
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
