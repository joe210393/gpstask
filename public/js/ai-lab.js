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
                system: `你是一位博學多聞的生態研究員與生活智慧王。
請依照以下 XML 格式回答：
<analysis>
客觀辨識圖片中的物體、植物或場景。如果是植物，請分析其特徵。
</analysis>
<reply>
用親切、專業但通俗的語氣向玩家介紹這個東西。
- 如果是植物/動物：介紹學名、別名、冷知識或用途。
- 如果是物品：介紹它的用途，或是提供一個相關的生活小撇步。
</reply>`,
                user: "請問這是什麼？有什麼特別的嗎？"
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
        const retryBtn = document.getElementById('retryBtn');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const aiLoading = document.getElementById('aiLoading');
        const aiResult = document.getElementById('aiResult');
        const rawOutput = document.getElementById('rawOutput');
        
        // Director Panel Elements
        const directorToggle = document.getElementById('directorToggle');
        const directorPanel = document.getElementById('directorPanel');
        const systemPromptInput = document.getElementById('systemPrompt');
        const userPromptInput = document.getElementById('userPrompt');
        const modeBtns = document.querySelectorAll('.mode-btn');
        const langSelect = document.getElementById('langSelect');
        const cameraContainer = document.querySelector('.camera-container');
        let miniMapEl = document.getElementById('miniMap');
        let locationInfoEl = document.getElementById('locationInfo');

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

        function initLanguageSelector() {
            if (!langSelect) return;
            const saved = localStorage.getItem('aiLabLang');
            if (saved) langSelect.value = saved;
            langSelect.addEventListener('change', () => {
                localStorage.setItem('aiLabLang', langSelect.value);
            });
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
                
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: facingMode },
                        audio: false
                    });
                } catch (err1) {
                    log('指定鏡頭失敗，嘗試通用設定: ' + err1.name);
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                }
                
                video.srcObject = stream;
                try {
                    await video.play();
                    log('相機啟動成功');
                } catch (playErr) {
                    log('播放失敗: ' + playErr.message);
                }
                
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

        // 位置與地圖
        function ensureMiniMapElements() {
            if (miniMapEl && locationInfoEl) return;
            if (!cameraContainer) {
                log('找不到 camera-container，無法建立地圖容器');
                return;
            }
            const wrap = document.createElement('div');
            wrap.className = 'mini-map-wrap';

            const mapDiv = document.createElement('div');
            mapDiv.id = 'miniMap';
            mapDiv.className = 'mini-map';

            const infoDiv = document.createElement('div');
            infoDiv.id = 'locationInfo';
            infoDiv.className = 'location-info';
            infoDiv.textContent = '定位中...';

            wrap.appendChild(mapDiv);
            wrap.appendChild(infoDiv);
            cameraContainer.appendChild(wrap);

            miniMapEl = mapDiv;
            locationInfoEl = infoDiv;
        }

        function initMiniMap() {
            ensureMiniMapElements();
            if (!miniMapEl) {
                log('找不到地圖容器，略過地圖顯示');
                return;
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
                processSelection();
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
                const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.9); // 提高畫質到 0.9
                croppedImage.src = dataUrl;
                showResultPanel();
            } catch (e) {
                console.error('截圖失敗', e);
                aiResult.innerHTML = '<span style="color:red">截圖失敗: ' + e.message + '</span>';
                showResultPanel();
            }
        }

        function showResultPanel() {
            resultPanel.style.display = 'flex';
            resultPanel.classList.add('active');
            if (!aiResult.innerHTML.includes('辨識結果')) {
                aiResult.innerHTML = '準備就緒，點擊「AI 辨識」開始分析';
                if(rawOutput) rawOutput.style.display = 'none';
            }
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'AI 辨識';
        }

        function retry() {
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
        directorToggle.addEventListener('click', () => {
            directorPanel.classList.toggle('open');
        });

        // 模式按鈕
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                setMode(btn.dataset.mode);
            });
        });

        // 重試按鈕
        retryBtn.addEventListener('click', retry);

        // AI 辨識按鈕 (核心邏輯)
        analyzeBtn.addEventListener('click', async () => {
            analyzeBtn.disabled = true;
            aiLoading.classList.remove('hidden');
            aiResult.innerHTML = '';
            if(rawOutput) rawOutput.style.display = 'none';

            try {
                // 1. 準備圖片
                const response = await fetch(croppedImage.src);
                const blob = await response.blob();
                const formData = new FormData();
                formData.append('image', blob, 'capture.jpg');
                
                // 2. 準備 Prompt (強健性設計)
                // 優先使用 systemPromptInput 的值 (導演手動修改優先)
                // 但如果為空，強制回退到 PROMPTS[currentMode] (確保神經病 Prompt 存在)
                let finalSystemPrompt = systemPromptInput && systemPromptInput.value ? systemPromptInput.value : '';
                let finalUserPrompt = userPromptInput && userPromptInput.value ? userPromptInput.value : '';

                if (!finalSystemPrompt || finalSystemPrompt.length < 10) {
                    log('Prompt 空白或過短，強制載入預設劇本');
                    const fallbackScript = getActiveScript();
                    finalSystemPrompt = fallbackScript ? fallbackScript.system : finalSystemPrompt;
                    // 同步回 UI
                    if (systemPromptInput) systemPromptInput.value = finalSystemPrompt;
                }
                
                // User prompt 也要防呆
                if (!finalUserPrompt) {
                     const fallbackScript = getActiveScript();
                     finalUserPrompt = fallbackScript ? fallbackScript.user : finalUserPrompt;
                }

                if (currentMode === 'mission' && MISSION_ENABLED) {
                    const failHint = MISSION_STYLE_POOL.fail[Math.floor(Math.random() * MISSION_STYLE_POOL.fail.length)];
                    const successHint = MISSION_STYLE_POOL.success[Math.floor(Math.random() * MISSION_STYLE_POOL.success.length)];
                    finalSystemPrompt += `\n\n【語氣變化指令】\n失敗時請隨機使用一種嘲諷風格，例如：${failHint}\n成功時請隨機使用一種帶刺的肯定，例如：${successHint}`;
                }

                if (lastLocationText) {
                    finalSystemPrompt += `\n\n【拍攝地點資訊】${lastLocationText}`;
                }
                finalSystemPrompt += `\n\n【輸出語言】${getLanguageInstruction()}`;

                log(`發送 Prompt (${currentMode}): ${finalSystemPrompt.substring(0, 15)}...`);
                formData.append('systemPrompt', finalSystemPrompt);
                formData.append('userPrompt', finalUserPrompt);

                // 3. 準備 GPS
                try {
                    const pos = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { 
                            timeout: 2000, enableHighAccuracy: false 
                        });
                    });
                    formData.append('latitude', pos.coords.latitude);
                    formData.append('longitude', pos.coords.longitude);
                    lastLatLng = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                    if (!lastLocationText || lastLocationText === '定位中...' || lastLocationText === '定位失敗') {
                        const display = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
                        updateLocationText(display || `緯度 ${pos.coords.latitude.toFixed(5)}，經度 ${pos.coords.longitude.toFixed(5)}`);
                    }
                    log('GPS 附加成功');
                } catch (gpsErr) {
                    console.warn('GPS 略過', gpsErr);
                }

                // 4. 發送請求
                const apiRes = await fetch('/api/vision-test', {
                    method: 'POST',
                    body: formData
                });

                if (!apiRes.ok) {
                    const errText = await apiRes.text();
                    throw new Error(`伺服器錯誤: ${errText}`);
                }

                const data = await apiRes.json();
                
                // 5. 處理回應 (XML 解析)
                if (data.success) {
                    const fullText = data.description;
                    console.log("Full AI Response:", fullText);

                    // XML 解析邏輯
                    const replyMatch = fullText.match(/<reply>([\s\S]*?)<\/reply>/i);
                    const analysisMatch = fullText.match(/<analysis>([\s\S]*?)<\/analysis>/i);

                    function extractTag(text, tag) {
                        const tagMatch = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
                        return tagMatch ? tagMatch[1].trim() : null;
                    }
                    function extractOpenTagContent(text, tag) {
                        const openTag = new RegExp(`<${tag}>`, 'i');
                        const openMatch = text.match(openTag);
                        if (!openMatch) return null;
                        const startIdx = openMatch.index + openMatch[0].length;
                        return text.substring(startIdx).trim();
                    }
                    function inferResultFromAnalysis(analysisText) {
                        if (!analysisText) return null;
                        if (/是\s*$/m.test(analysisText) && /是不是遙控器|是不是電池|是不是電池蓋|是不是電池或電池蓋/.test(analysisText)) {
                            return 'success';
                        }
                        if (/否\s*$/m.test(analysisText) && /是不是遙控器|是不是電池|是不是電池蓋|是不是電池或電池蓋/.test(analysisText)) {
                            return 'fail';
                        }
                        return null;
                    }

                    let finalReplyText = '';
                    if (replyMatch) {
                        finalReplyText = replyMatch[1].trim();
                    } else {
                        // 容錯情況：AI 沒寫好 XML
                        // 嘗試尋找 </analysis> 之後的內容
                        const analysisEndIndex = fullText.indexOf('</analysis>');
                        if (analysisEndIndex !== -1) {
                            finalReplyText = fullText.substring(analysisEndIndex + 11).trim();
                        } else {
                            const looseReply = extractOpenTagContent(fullText, 'reply');
                            if (looseReply) {
                                finalReplyText = looseReply;
                            } else {
                                finalReplyText = fullText;
                            }
                        }
                    }

                    if (!finalReplyText && analysisMatch) {
                        finalReplyText = analysisMatch[1].trim();
                    }

                    if (finalReplyText) {
                        aiResult.innerHTML = finalReplyText.replace(/\n/g, '<br>');
                    } else {
                        aiResult.innerHTML = '<span style="color:red">AI 回應為空，請再試一次</span>';
                    }

                    // 任務模式：判斷是否過關，進入下一關
                    if (currentMode === 'mission' && MISSION_ENABLED && !missionCompleted) {
                        let resultTag = extractTag(fullText, 'result');
                        if (!resultTag) {
                            resultTag = inferResultFromAnalysis(extractTag(fullText, 'analysis'));
                        }
                        if (resultTag && resultTag.toLowerCase() === 'success') {
                            if (missionStepIndex < MISSION_STEPS.length - 1) {
                                missionStepIndex += 1;
                                const nextScript = getActiveScript();
                                applyScript(nextScript, true);
                                log(`任務進度前進到第 ${missionStepIndex + 1} 關`);
                            } else {
                                missionCompleted = true;
                                Swal.fire({
                                    title: '🎉 任務完成',
                                    text: '你已完成所有測試關卡！',
                                    icon: 'success',
                                    confirmButtonText: '太好了',
                                    backdrop: `rgba(0,0,0,0.8)`
                                });
                                log('任務完成');
                            }
                        }
                    }
                } else {
                    aiResult.innerHTML = `<span style="color:red">辨識失敗: ${data.message}</span>`;
                }

            } catch (err) {
                console.error('API 錯誤:', err);
                aiResult.innerHTML = `<span style="color:red">系統錯誤: ${err.message}</span>`;
            } finally {
                aiLoading.classList.add('hidden');
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = '再次辨識';
            }
        });

        // ------------------------------------------------
        // 6. 初始化 (Initialization)
        // ------------------------------------------------
        resizeCanvas();
        initLanguageSelector();
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
