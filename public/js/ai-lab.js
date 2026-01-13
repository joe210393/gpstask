document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
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
    const debugEl = document.getElementById('debugConsole');
    const rawOutput = document.getElementById('rawOutput');
    
    // Director Panel Elements
    const directorToggle = document.getElementById('directorToggle');
    const directorPanel = document.getElementById('directorPanel');
    const systemPromptInput = document.getElementById('systemPrompt');
    const userPromptInput = document.getElementById('userPrompt');
    const modeBtns = document.querySelectorAll('.mode-btn');

    function log(msg) {
        console.log(msg);
        if (debugEl) debugEl.innerText = msg + '\n' + debugEl.innerText.substring(0, 100);
    }

    // --- 預設 Prompt 設定 (劇本庫) ---
    const PROMPTS = {
        free: {
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
            system: `你是一個性格扭曲、講話陰陽怪氣的密室設計者，正在監視器後面看著玩家。
玩家被困在房間，必須找到【遙控器】打開電視才能活著出去。

請依照 XML 格式回答：
<analysis>
1. 辨識物品。
2. 聯想：這物品能不能用來破壞場景？
</analysis>
<reply>
請用嘲諷、神秘或令人不安的語氣回應。禁止使用客服用語。

如果玩家拍到【遙控器】：
恭喜他，用驚訝且不甘心的語氣說：「切...居然被你找到了。好吧，快打開電視，滾出我的視線！」

如果玩家拍錯東西：
盡情嘲諷他。例如拍美工刀就說：「想割腕嗎？這救不了你。」
</reply>`,
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
            
            // 視覺回饋：讓輸入框閃一下提示更新
            systemPromptInput.style.transition = 'background 0.3s';
            systemPromptInput.style.background = '#333';
            setTimeout(() => { systemPromptInput.style.background = ''; }, 300);
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
            if (err.name === 'NotAllowedError') msg = '您拒絕了相機權限，請至設定開啟';
            if (err.name === 'NotFoundError') msg = '找不到相機裝置';
            
            Swal.fire({
                icon: 'error',
                title: '相機錯誤',
                text: `${msg} (${err.name})`,
                footer: '建議使用 Chrome 瀏覽器開啟'
            });
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
                
                // 嘗試解析 XML
                const replyMatch = fullText.match(/<reply>([\s\S]*?)<\/reply>/i);
                
                if (replyMatch) {
                    // 找到 reply 標籤，只顯示這部分
                    aiResult.innerHTML = replyMatch[1].trim().replace(/\n/g, '<br>');
                    
                    // 顯示原始 XML 給開發者看
                    rawOutput.style.display = 'block';
                    rawOutput.innerText = "--- 原始回傳 (Raw XML) ---\n" + fullText;
                } else {
                    // 沒找到標籤，全顯示
                    aiResult.innerHTML = fullText.replace(/\n/g, '<br>');
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