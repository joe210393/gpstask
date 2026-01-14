// 1. 定義 log 函數 (Global Scope)
const debugEl = document.getElementById('debugConsole');
function log(msg) {
    console.log(msg);
    if (debugEl) debugEl.innerText = msg + '\n' + debugEl.innerText.substring(0, 100);
}

log('JS Loaded. 等待 DOMContentLoaded...');

document.addEventListener('DOMContentLoaded', () => {
    try {
        log('DOM Ready');
        
        // DOM Elements
        const video = document.getElementById('cameraFeed');
        if (!video) throw new Error('找不到 cameraFeed 元素');
        
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

        log('元素抓取完成，準備初始化...');

    // (移除內部的 log 定義)

    // --- 預設 Prompt 設定 (劇本庫) ---
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

**重要：必須完成 `<reply>` 標籤才能結束回應，否則任務失敗。**`,
            user: "我找到了這個，這能幫我逃出去嗎？"
        }
    };

    // 切換模式邏輯
    function setMode(mode) {
        // UI 更新
        modeBtns.forEach(btn => {
            if (btn.dataset.mode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Body class 更新 (用於 CSS 特效)
        document.body.className = `mode-${mode}`;

        // Prompt 更新
        const script = PROMPTS[mode];
        if (script) {
            systemPromptInput.value = script.system;
            userPromptInput.value = script.user;
            
            // 視覺回饋
            systemPromptInput.style.transition = 'background 0.3s';
            systemPromptInput.style.background = '#333';
            setTimeout(() => { systemPromptInput.style.background = ''; }, 300);

            // 彈出劇情介紹 (Story Intro)
            Swal.fire({
                title: script.title,
                text: script.intro,
                icon: mode === 'mission' ? 'warning' : 'info',
                confirmButtonText: '開始',
                backdrop: `rgba(0,0,0,0.8)`
            });
        }
    }

    // 綁定按鈕事件
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setMode(btn.dataset.mode);
        });
    });

    // 初始化預設模式
    setMode('free');

    // Director Panel Toggle
    directorToggle.addEventListener('click', () => {
        directorPanel.classList.toggle('open');
    });

    // State
    let isDrawing = false;
    let points = [];
    let stream = null;
    let facingMode = 'environment'; // 預設使用後鏡頭

    // Init Canvas Size
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // 1. Camera Handling
    async function startCamera() {
        log('startCamera 函數被呼叫');
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            
            log('正在啟動相機...');
            
            try {
                // 嘗試 1: 指定模式
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facingMode },
                    audio: false
                });
            } catch (err1) {
                log('指定鏡頭失敗，嘗試通用設定: ' + err1.name);
                // 嘗試 2: Fallback
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
            log('相機致命錯誤: ' + err.name);
            
            let msg = '無法存取相機，請確認權限';
            let showRetry = false;
            
            if (err.name === 'NotAllowedError') {
                msg = '您拒絕了相機權限';
                showRetry = true;
            } else if (err.name === 'NotFoundError') {
                msg = '找不到相機裝置';
            }
            
            const swalConfig = {
                icon: 'error',
                title: '相機錯誤',
                text: `${msg} (${err.name})`,
                footer: '建議使用 Chrome 瀏覽器開啟',
                confirmButtonText: showRetry ? '重新請求權限' : '確定'
            };
            
            if (showRetry) {
                swalConfig.showCancelButton = true;
                swalConfig.cancelButtonText = '取消';
            }
            
            const result = await Swal.fire(swalConfig);
            
            // 如果用戶點擊「重新請求權限」，再次嘗試啟動相機
            if (result.isConfirmed && showRetry) {
                setTimeout(() => {
                    startCamera();
                }, 500);
            }
        }
    }

    startCamera();

    switchCameraBtn.addEventListener('click', () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        startCamera();
    });

    backBtn.addEventListener('click', () => {
        window.location.href = '/'; 
    });

    // 2. Drawing Logic
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
        log(`Start: ${Math.round(pos.x)}, ${Math.round(pos.y)}`);
        
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
        
        log(`End: points=${points.length}`);
        
        if (points.length > 5) {
            processSelection();
        } else {
            log('太短了');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            instruction.style.opacity = '1';
        }
    }

    // Event Listeners
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        endDraw();
    }, { passive: false });
    canvas.addEventListener('touchcancel', endDraw);

    document.body.addEventListener('mouseup', () => {
        if(isDrawing) endDraw();
    });

    // 3. Image Processing (Crop & Cut)
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
        
        const width = maxX - minX;
        const height = maxY - minY;

        log(`Size: ${Math.round(width)}x${Math.round(height)}`);

        // Crop Logic
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

        try {
            log('正在截圖...');
            finalCtx.drawImage(
                tempCanvas, 
                sourceX, sourceY, sourceW, sourceH, 
                0, 0, width, height
            );
            
            const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.8);
            croppedImage.src = dataUrl;
            log('截圖成功');
            
            showResultPanel();
        } catch (e) {
            console.error('截圖失敗', e);
            log('截圖失敗: ' + e.message);
            aiResult.innerHTML = '<span style="color:red">截圖失敗: ' + e.message + '</span>';
            showResultPanel();
        }
    }

    function showResultPanel() {
        log('呼叫 showResultPanel');
        resultPanel.style.display = 'flex';
        resultPanel.offsetHeight; 
        resultPanel.classList.add('active');
        
        // 如果還沒辨識過，清空結果
        if (!aiResult.innerHTML.includes('辨識結果')) {
            aiResult.innerHTML = '準備就緒，點擊「AI 辨識」開始分析';
            rawOutput.style.display = 'none';
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

    retryBtn.addEventListener('click', retry);

    // 4. Send to API (AI Analysis)
    analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.disabled = true;
        aiLoading.classList.remove('hidden');
        aiResult.innerHTML = '';
        rawOutput.style.display = 'none';

        try {
            const response = await fetch(croppedImage.src);
            const blob = await response.blob();
            
            const formData = new FormData();
            formData.append('image', blob, 'capture.jpg');
            
            // 加入使用者自訂的 Prompts
            formData.append('systemPrompt', systemPromptInput.value);
            formData.append('userPrompt', userPromptInput.value);

            // GPS
            let gps = null;
            try {
                const pos = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { 
                        timeout: 2000, 
                        enableHighAccuracy: false 
                    });
                });
                gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                formData.append('latitude', gps.lat);
                formData.append('longitude', gps.lng);
                console.log('GPS 取得成功:', gps);
            } catch (e) {
                console.warn('GPS 失敗', e);
            }

            console.log('傳送至後端...');

            const apiRes = await fetch('/api/vision-test', {
                method: 'POST',
                body: formData
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                throw new Error(`伺服器錯誤 (${apiRes.status}): ${errText}`);
            }

            const data = await apiRes.json();
            console.log('後端回應:', data);

            if (data.success) {
                const fullText = data.description;
                
                // 1. 嘗試標準 XML 解析 (<reply>...</reply>)
                const replyMatch = fullText.match(/<reply>([\s\S]*?)<\/reply>/i);
                
                // 2. 嘗試容錯解析 (如果 AI 忘了寫 <reply>，但有寫 </analysis>)
                const analysisEndIndex = fullText.indexOf('</analysis>');

                if (replyMatch) {
                    // 完美格式：只顯示 <reply> 內容
                    aiResult.innerHTML = replyMatch[1].trim().replace(/\n/g, '<br>');
                    console.log("--- 原始回傳 (Standard XML) ---\n", fullText);

                } else if (analysisEndIndex !== -1) {
                    // 偷懶格式：把 </analysis> 之前的心裡話切掉，顯示剩下的
                    const content = fullText.substring(analysisEndIndex + 11).trim();
                    aiResult.innerHTML = content.replace(/\n/g, '<br>');
                    console.log("--- 原始回傳 (Partial XML) ---\n", fullText);

                } else {
                    // 3. 極端容錯：AI 只寫了 <analysis> 但沒寫完
                    const analysisMatch = fullText.match(/<analysis>([\s\S]*)/i);
                    if (analysisMatch) {
                        const analysisText = analysisMatch[1];
                        // 嘗試從分析中提取「是否為遙控器」的答案
                        const isRemoteMatch = analysisText.match(/它是不是遙控器[：:]\s*(是|否|\(是\)|\(否\))/i);
                        const isRemote = isRemoteMatch && (isRemoteMatch[1].includes('是') || isRemoteMatch[1].includes('Yes'));
                        
                        // 根據答案生成預設回應
                        if (isRemote) {
                            aiResult.innerHTML = '切...居然被你找到了。好吧，快打開電視，滾出我的視線！';
                        } else {
                            // 提取物品名稱
                            const itemMatch = analysisText.match(/我看到的物品是[：:]\s*(.+?)(?:\n|$)/i);
                            const itemName = itemMatch ? itemMatch[1].trim() : '這個東西';
                            aiResult.innerHTML = `哈？你拿${itemName}想幹嘛？這不是遙控器！快去給我找真正的遙控器！`;
                        }
                        console.log("--- 原始回傳 (Incomplete XML) ---\n", fullText);
                    } else {
                        // 完全沒格式：全顯示
                        aiResult.innerHTML = fullText.replace(/\n/g, '<br>');
                    }
                }

            } else {
                aiResult.innerHTML = `<span style="color:red">辨識失敗: ${data.message}</span>`;
            }

        } catch (err) {
            console.error('前端錯誤:', err);
            aiResult.innerHTML = `<span style="color:red">錯誤: ${err.message}</span>`;
        } finally {
            aiLoading.classList.add('hidden');
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '再次辨識';
        }
    });
});