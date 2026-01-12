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

    function log(msg) {
        console.log(msg);
        if (debugEl) debugEl.innerText = msg + '\n' + debugEl.innerText.substring(0, 100);
    }

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
                // 嘗試 1: 指定模式 (後鏡頭/前鏡頭)
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facingMode },
                    audio: false
                });
            } catch (err1) {
                log('指定鏡頭失敗，嘗試通用設定: ' + err1.name);
                // 嘗試 2: 放棄指定，只要有畫面就好 (Fallback)
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
            }
            
            video.srcObject = stream;
            // Android 關鍵：必須明確呼叫 play()，並處理 Promise
            try {
                await video.play();
                log('相機啟動成功');
            } catch (playErr) {
                log('播放失敗: ' + playErr.message);
            }
            
        } catch (err) {
            console.error('相機啟動失敗:', err);
            log('相機致命錯誤: ' + err.name + ' - ' + err.message);
            
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
        window.location.href = '/'; // 回首頁
    });

    // 2. Drawing Logic
    function getPos(e) {
        if (e.touches) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function startDraw(e) {
        // 如果結果面板已經打開，禁止繪畫
        if (resultPanel.classList.contains('active')) return;

        isDrawing = true;
        points = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const pos = getPos(e);
        points.push(pos);
        log(`Start: ${Math.round(pos.x)}, ${Math.round(pos.y)}`);
        
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffd700'; // 金黃色
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        instruction.style.opacity = '0'; // 隱藏提示
    }

    function moveDraw(e) {
        if (!isDrawing) return;
        e.preventDefault(); // 防止捲動
        
        const pos = getPos(e);
        points.push(pos);
        // log(`Move: ${points.length}`);
        
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    }

    function endDraw() {
        if (!isDrawing) return;
        isDrawing = false;
        ctx.closePath();
        
        log(`End: points=${points.length}`);
        
        if (points.length > 5) { // 放寬限制，原本是 10
            processSelection();
        } else {
            // 清除無效繪圖
            log('太短了');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            instruction.style.opacity = '1';
        }
    }

    // Event Listeners for Touch/Mouse
    // 使用 passive: false 來確保可以 preventDefault
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    
    // 修正觸控事件綁定
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault(); // 防止觸發 click
        endDraw();
    }, { passive: false });
    canvas.addEventListener('touchcancel', endDraw); // 增加 touchcancel 處理

    // 增加一個強制結束按鈕 (以防滑出邊界)
    document.body.addEventListener('mouseup', () => {
        if(isDrawing) endDraw();
    });

    // 3. Image Processing (Crop & Cut)
    function processSelection() {
        // 1. 計算 Bounding Box (最小外接矩形)
        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        // 增加一點 padding
        const padding = 20;
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(canvas.width, maxX + padding);
        maxY = Math.min(canvas.height, maxY + padding);
        
        const width = maxX - minX;
        const height = maxY - minY;

        log(`Size: ${Math.round(width)}x${Math.round(height)}`);

        // if (width < 50 || height < 50) {
        //     // 太小了，重來
        //     log('範圍太小');
        //     ctx.clearRect(0, 0, canvas.width, canvas.height);
        //     instruction.style.opacity = '1';
        //     return;
        // }

        // 2. 從 Video 截圖
        // 建立一個臨時 Canvas 來畫 Video
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        // 計算 Video 到 Screen 的比例
        // 因為 object-fit: cover，需要算裁切偏移
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

        // 映射座標回 Video 原始尺寸
        const sourceX = (minX - offsetX) * (video.videoWidth / renderWidth);
        const sourceY = (minY - offsetY) * (video.videoHeight / renderHeight);
        const sourceW = width * (video.videoWidth / renderWidth);
        const sourceH = height * (video.videoHeight / renderHeight);

        // 3. 裁切最終圖片
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
            
            // 顯示結果
            const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.8);
            croppedImage.src = dataUrl;
            log('截圖成功，準備顯示面板');
            
            showResultPanel();
        } catch (e) {
            console.error('截圖失敗', e);
            log('截圖失敗: ' + e.message);
            // 即使失敗也顯示面板，方便除錯
            aiResult.innerHTML = '<span style="color:red">截圖失敗: ' + e.message + '</span>';
            showResultPanel();
        }
    }

    function showResultPanel() {
        log('呼叫 showResultPanel');
        resultPanel.style.display = 'flex'; // 強制顯示
        // 強制重繪
        resultPanel.offsetHeight; 
        resultPanel.classList.add('active');
        
        aiResult.innerHTML = '準備就緒，點擊「AI 辨識」開始分析';
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'AI 辨識';
    }

    function retry() {
        resultPanel.classList.remove('active');
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

        try {
            // 將 DataURL 轉為 Blob
            const response = await fetch(croppedImage.src);
            const blob = await response.blob();
            
            const formData = new FormData();
            formData.append('image', blob, 'capture.jpg');

            // 取得 GPS (縮短超時時間)
            let gps = null;
            try {
                const pos = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { 
                        timeout: 2000, // 縮短為 2 秒
                        enableHighAccuracy: false // 犧牲一點精度換速度
                    });
                });
                gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                formData.append('latitude', gps.lat);
                formData.append('longitude', gps.lng);
                console.log('GPS 取得成功:', gps);
            } catch (e) {
                console.warn('無法取得 GPS (或超時)，將進行無 GPS 辨識', e);
            }

            console.log('正在傳送圖片至後端...');

            // 呼叫後端 API
            const apiRes = await fetch('/api/vision-test', {
                method: 'POST',
                body: formData
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                throw new Error(`伺服器回應錯誤 (${apiRes.status}): ${errText}`);
            }

            const data = await apiRes.json();
            console.log('後端回應:', data);

            if (data.success) {
                // 將換行符號轉換為 HTML 換行
                const formattedText = data.description.replace(/\n/g, '<br>');
                aiResult.innerHTML = formattedText;
            } else {
                aiResult.innerHTML = `<span style="color:red">AI 辨識失敗: ${data.message || '未知錯誤'}</span>`;
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
