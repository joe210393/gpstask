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
            mission: {
                title: "🛡️ 密室逃脫任務：遙控器之謎",
                intro: "【劇情前情提要】\n你醒來時發現自己被困在一個陌生的房間，門窗都打不開。\n牆上的電視閃爍著雜訊，旁邊有一張紙條寫著：\n「只有看見真相的人才能離開...」\n\n看來你必須找到【遙控器】並打開電視，才能找到逃脫的線索。\n快看看四周有什麼可疑的東西吧！",
                system: `你是一個性格扭曲、講話陰陽怪氣的密室設計者。
任務目標：玩家必須找到【電視遙控器 (TV Remote)】。

請嚴格執行以下思考步驟：
1. 先客觀辨識圖片中的物品到底是什麼。(例如：瓶子、手機、滑鼠、書本...)
2. 比對該物品是否為「電視遙控器」。注意：形狀相似的長方形物體(如藥罐、眼鏡盒)都不是遙控器。
3. 只有在【100% 確定是遙控器】時，才算成功。

請依照 XML 格式回答，**必須完成兩個標籤**：
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

**重要：必須完成 <reply> 標籤才能結束回應，否則任務失敗。**`,
                user: "我找到了這個，這能幫我逃出去嗎？"
            }
        };

        // ------------------------------------------------
        // 2. 狀態變數 (State Variables) - 必須在函數前宣告
        // ------------------------------------------------
        let isDrawing = false;
        let points = [];
        let stream = null;
        let facingMode = 'environment'; // 預設使用後鏡頭
        let currentMode = 'free';       // 預設模式

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

        if (!video || !canvas) throw new Error('關鍵 DOM 元素遺失');

        // ------------------------------------------------
        // 4. 功能函數 (Functions)
        // ------------------------------------------------

        // 畫布調整
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
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

            // 更新 Prompt 輸入框 (作為視覺參考)
            const script = PROMPTS[mode];
            if (script) {
                if (systemPromptInput) systemPromptInput.value = script.system;
                if (userPromptInput) userPromptInput.value = script.user;
                
                // 輸入框閃爍特效
                if (systemPromptInput) {
                    systemPromptInput.style.transition = 'background 0.3s';
                    systemPromptInput.style.background = '#333';
                    setTimeout(() => { systemPromptInput.style.background = ''; }, 300);
                }

                // 彈出劇情介紹
                Swal.fire({
                    title: script.title,
                    text: script.intro,
                    icon: mode === 'mission' ? 'warning' : 'info',
                    confirmButtonText: '開始',
                    backdrop: `rgba(0,0,0,0.8)`
                });
            }
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
                    finalSystemPrompt = PROMPTS[currentMode].system;
                    // 同步回 UI
                    if (systemPromptInput) systemPromptInput.value = finalSystemPrompt;
                }
                
                // User prompt 也要防呆
                if (!finalUserPrompt) {
                     finalUserPrompt = PROMPTS[currentMode].user;
                }

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

                    if (replyMatch) {
                        // 完美情況
                        aiResult.innerHTML = replyMatch[1].trim().replace(/\n/g, '<br>');
                    } else {
                        // 容錯情況：AI 沒寫好 XML
                        // 嘗試尋找 </analysis> 之後的內容
                        const analysisEndIndex = fullText.indexOf('</analysis>');
                        if (analysisEndIndex !== -1) {
                            const content = fullText.substring(analysisEndIndex + 11).trim();
                            aiResult.innerHTML = content.replace(/\n/g, '<br>');
                        } else {
                            // 最慘情況：全顯示
                            aiResult.innerHTML = fullText.replace(/\n/g, '<br>');
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
        setMode('free'); // 預設模式
        startCamera();
        
        log('初始化完成');

    } catch (criticalErr) {
        console.error('致命錯誤:', criticalErr);
        log('FATAL: ' + criticalErr.message);
        alert('程式啟動失敗，請重新整理頁面: ' + criticalErr.message);
    }
});
