/**
 * AI 視覺實驗室（精簡版）
 * 流程：圈選物體 → 上傳照片到 LM → LM 回覆答案
 * 不含 RAG、特徵提取、植物搜尋等
 */
document.addEventListener('DOMContentLoaded', () => {
    let isDrawing = false;
    let points = [];
    let stream = null;
    let facingMode = 'environment';
    let capturedPhoto = null; // 單張照片

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
    const loadingText = document.getElementById('loadingText');
    const aiResult = document.getElementById('aiResult');

    if (!video || !canvas) return;

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function getPos(e) {
        if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
            finalCtx.drawImage(tempCanvas, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
            capturedPhoto = finalCanvas.toDataURL('image/jpeg', 0.95);
            croppedImage.src = capturedPhoto;
            resultPanel.style.display = 'flex';
            resultPanel.classList.add('active');
            aiResult.innerHTML = '準備就緒，點擊「AI 辨識」';
            analyzeBtn.disabled = false;
        } catch (e) {
            aiResult.innerHTML = '<span style="color:red">截圖失敗</span>';
            resultPanel.style.display = 'flex';
            resultPanel.classList.add('active');
        }
    }

    async function startCamera() {
        try {
            if (stream) stream.getTracks().forEach(t => t.stop());
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            video.srcObject = stream;
            await video.play();
        } catch (err) {
            console.error('相機啟動失敗:', err);
            aiResult.innerHTML = '<span style="color:red">無法存取相機</span>';
        }
    }

    async function analyzePhoto() {
        if (!capturedPhoto) return;
        analyzeBtn.disabled = true;
        aiResult.innerHTML = '';
        aiLoading.classList.remove('hidden');
        if (loadingText) loadingText.textContent = 'AI 辨識中...';

        try {
            const response = await fetch(capturedPhoto);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append('image', blob, 'capture.jpg');
            formData.append('simpleMode', 'true');
            formData.append('systemPrompt', '你是一個友善的 AI 助手。請簡潔描述圖片中圈選的物體。');
            formData.append('userPrompt', '請描述這張圖片中圈選區域的物體是什麼，並用簡短文字介紹。');

            const res = await fetch('/api/vision-test', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || '辨識失敗');
            if (!data.success) throw new Error(data.message || '辨識失敗');

            const text = data.description || '(無回應)';
            aiResult.innerHTML = text.replace(/\n/g, '<br>');
        } catch (err) {
            aiResult.innerHTML = `<span style="color:#c62828">${err.message || '辨識失敗'}</span>`;
        } finally {
            aiLoading.classList.add('hidden');
            analyzeBtn.disabled = false;
        }
    }

    function retry() {
        capturedPhoto = null;
        resultPanel.style.display = 'none';
        resultPanel.classList.remove('active');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        instruction.style.opacity = '1';
        aiResult.innerHTML = '';
        analyzeBtn.disabled = true;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    switchCameraBtn.addEventListener('click', () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        startCamera();
    });

    backBtn.addEventListener('click', () => { window.location.href = '/'; });

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', e => { e.preventDefault(); endDraw(); }, { passive: false });
    canvas.addEventListener('touchcancel', endDraw);

    retryBtn.addEventListener('click', retry);
    analyzeBtn.addEventListener('click', analyzePhoto);

    startCamera();
});
