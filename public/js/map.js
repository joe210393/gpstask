let map;
let userMarker;
let tasksList = [];
let triggeredTasks = new Set();
let completedTaskIds = new Set();

// const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑
const API_BASE = '';

// 地理位置權限狀態
let locationPermissionGranted = false;
let locationPermissionDenied = false;

// 防抖動變數
let lastUserLat = 0;
let lastUserLng = 0;
const MIN_UPDATE_DISTANCE = 0.003; // 最小更新距離 (約 3 公尺)，小於此距離不更新地圖，防止閃爍

// 地理位置權限處理
function requestLocationPermission() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('瀏覽器不支援地理位置功能'));
      return;
    }

    // 檢查權限狀態
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(permission => {
        if (permission.state === 'granted') {
          locationPermissionGranted = true;
          resolve();
        } else if (permission.state === 'denied') {
          locationPermissionDenied = true;
          reject(new Error('地理位置權限已被拒絕'));
        } else {
          // 請求權限
          navigator.geolocation.getCurrentPosition(
            () => {
              locationPermissionGranted = true;
              resolve();
            },
            (err) => {
              locationPermissionDenied = true;
              reject(err);
            },
            { enableHighAccuracy: true, timeout: 20000 }
          );
        }
      });
    } else {
      // 舊版瀏覽器直接請求
      navigator.geolocation.getCurrentPosition(
        () => {
          locationPermissionGranted = true;
          resolve();
        },
        (err) => {
          locationPermissionDenied = true;
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 20000 }
      );
    }
  });
}

// 初始化地圖
function initMapWithUserLocation() {
  // 顯示載入狀態
  showLocationStatus('正在初始化地圖...', 'loading');

  requestLocationPermission()
    .then(() => {
      // 權限已授權，獲取位置
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          initMap(latitude, longitude, 18);
          showLocationStatus('定位成功！', 'success');
          startGeolocation();
        },
        err => handleLocationError(err),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    })
    .catch(err => {
      handleLocationError(err);
    });
}

// 處理定位錯誤
function handleLocationError(error) {
  console.warn('定位錯誤:', error.message);

  let errorMessage = '';
  let showManualLocation = false;

  switch (error.code || error.message) {
    case 1: // PERMISSION_DENIED
      errorMessage = '地理位置權限被拒絕。請在瀏覽器設定中允許網站存取您的位置。';
      showManualLocation = true;
      break;
    case 2: // POSITION_UNAVAILABLE
      errorMessage = '無法取得您的位置資訊。';
      showManualLocation = true;
      break;
    case 3: // TIMEOUT
      errorMessage = '取得位置資訊逾時，將嘗試重新定位...';
      // 不直接顯示手動定位，而是嘗試使用較低的精度重新定位
      initMapWithLowAccuracy();
      return;
    default:
      if (error.message && error.message.includes('不支援')) {
        errorMessage = '您的瀏覽器不支援地理位置功能。';
        showManualLocation = true;
      } else {
        errorMessage = '定位失敗，使用預設位置。';
        showManualLocation = true;
      }
  }

  // 使用預設位置初始化地圖
  initMap(24.757, 121.753, 16);

  if (showManualLocation) {
    showManualLocationOption(errorMessage);
  } else {
    showLocationStatus(errorMessage, 'warning');
  }
}

// 使用較低精度嘗試重新定位
function initMapWithLowAccuracy() {
  showLocationStatus('正在嘗試以較低精度重新定位...', 'loading');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      initMap(latitude, longitude, 18);
      showLocationStatus('定位成功！(低精度模式)', 'success');
      startGeolocation();
    },
    err => {
       console.warn('低精度定位也失敗:', err.message);
       // 如果還是失敗，回退到預設處理
       initMap(24.757, 121.753, 16);
       showManualLocationOption('無法取得您的位置資訊 (定位逾時)');
    },
    { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
  );
}

// 初始化地圖
function initMap(lat, lng, zoom) {
  map = L.map('map').setView([lat, lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // 強制刷新進度後載入任務（確保顯示最新進度的任務）
  loadTasks(true);
}

// 顯示手動定位選項
function showManualLocationOption(message) {
  const statusDiv = document.getElementById('locationStatus') || createLocationStatusDiv();

  statusDiv.innerHTML = `
    <div class="location-error">
      <div class="error-icon">📍</div>
      <div class="error-message">${message}</div>
      <div class="location-options">
        <button onclick="requestLocationAgain()" class="btn-primary">重新請求權限</button>
        <button onclick="useManualLocation()" class="btn-secondary">手動輸入位置</button>
        <button onclick="useDefaultLocation()" class="btn-secondary">使用預設位置</button>
      </div>
    </div>
  `;
  statusDiv.style.display = 'block';
}

// 重新請求地理位置權限
function requestLocationAgain() {
  locationPermissionDenied = false;
  showLocationStatus('正在請求權限...', 'loading');
  initMapWithUserLocation();
}

// 手動輸入位置
function useManualLocation() {
  const address = prompt('請輸入您的所在地址（例如：台北市中正區）：');
  if (address) {
    // 使用地址搜尋服務（這裡可以整合 Google Maps 或其他地圖服務）
    searchAddress(address);
  }
}

// 使用地址搜尋（模擬實現）
function searchAddress(address) {
  showLocationStatus(`正在搜尋「${address}」...`, 'loading');

  // 模擬地址搜尋（實際實現需要整合地圖服務API）
  setTimeout(() => {
    // 模擬找到位置
    const mockLat = 25.0330 + (Math.random() - 0.5) * 0.01;
    const mockLng = 121.5654 + (Math.random() - 0.5) * 0.01;

    if (map) {
      map.setView([mockLat, mockLng], 17);
    }

    showLocationStatus(`已定位到「${address}」附近`, 'success');

    // 重新開始地理位置監控
    startGeolocation();
  }, 2000);
}

// 使用預設位置
function useDefaultLocation() {
  if (map) {
    map.setView([24.757, 121.753], 16);
  }
  showLocationStatus('使用預設位置（宜蘭）', 'info');
  startGeolocation();
}

// 顯示定位狀態
function showLocationStatus(message, type = 'info') {
  const statusDiv = document.getElementById('locationStatus') || createLocationStatusDiv();

  const typeClasses = {
    loading: 'status-loading',
    success: 'status-success',
    warning: 'status-warning',
    error: 'status-error',
    info: 'status-info'
  };

  statusDiv.innerHTML = `<div class="location-status ${typeClasses[type] || 'status-info'}">${message}</div>`;
  statusDiv.style.display = 'block';

  // 自動隱藏成功訊息
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

// 創建定位狀態顯示區域
function createLocationStatusDiv() {
  const statusDiv = document.createElement('div');
  statusDiv.id = 'locationStatus';
  statusDiv.className = 'location-status-container';

  // 添加樣式
  const style = document.createElement('style');
  style.textContent = `
    .location-status-container {
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      min-width: 300px;
      max-width: 500px;
    }

    .location-status {
      background: white;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 14px;
      text-align: center;
      border-left: 4px solid #007bff;
    }

    .location-error {
      background: white;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      text-align: center;
    }

    .error-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .error-message {
      color: #666;
      margin-bottom: 16px;
      font-size: 14px;
    }

    .location-options {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .location-options button {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }

    .btn-primary {
      background: #007bff;
      color: white;
    }

    .btn-primary:hover {
      background: #0056b3;
    }

    .btn-secondary {
      background: #6c757d;
      color: white;
    }

    .btn-secondary:hover {
      background: #545b62;
    }

    .status-loading { border-left-color: #ffc107; }
    .status-success { border-left-color: #28a745; }
    .status-warning { border-left-color: #ffc107; }
    .status-error { border-left-color: #dc3545; }
    .status-info { border-left-color: #17a2b8; }
  `;
  document.head.appendChild(style);

  document.body.appendChild(statusDiv);
  return statusDiv;
}

// 距離顯示控制變數
let userLatLng = null;
let distanceDisplayEnabled = false;
let userHeading = 0; // 用戶面向方向

// 計算兩點間距離（使用 Haversine 公式）
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半徑（公里）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 格式化距離顯示
function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}公尺`;
  } else if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)}公里`;
  } else {
    return `${Math.round(distanceKm)}公里`;
  }
}

// 初始化方向感測
function initOrientationTracking() {
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', function(event) {
      if (event.alpha !== null) {
        // alpha 是設備朝向北方時的旋轉角度 (0-360)
        userHeading = event.alpha;
        updateUserMarkerRotation();
      }
    });
  }
}

// 更新用戶標記旋轉
function updateUserMarkerRotation() {
  if (userMarker) {
    // 設置標記的旋轉角度
    const icon = userMarker.getIcon();
    if (icon.options && icon.options.className) {
      userMarker.getElement().style.transform = `rotate(${userHeading}deg)`;
    } else {
      userMarker.getElement().style.transform = `rotate(${userHeading}deg)`;
    }
  }
}

// 取得使用者劇情進度（強制刷新，破壞快取）
function fetchQuestProgress(forceRefresh = false) {
  const userJson = localStorage.getItem('loginUser');
  if (!userJson) return Promise.resolve({});
  try {
    const loginUser = JSON.parse(userJson);
    if (!loginUser || !loginUser.username) return Promise.resolve({});
    
    // 添加時間戳參數破壞快取，確保每次獲取最新進度
    const url = forceRefresh 
      ? `${API_BASE}/api/user/quest-progress?_t=${Date.now()}`
      : `${API_BASE}/api/user/quest-progress`;
    
    return fetch(url, {
      headers: { 'x-username': loginUser.username },
      cache: 'no-cache' // 強制不從快取讀取
    })
    .then(res => res.json())
    .then(data => {
      console.log('[fetchQuestProgress] 獲取的進度:', data);
      return data.success ? data.progress : {};
    })
    .catch(err => {
      console.error('[fetchQuestProgress] 錯誤:', err);
      return {};
    });
  } catch (e) {
    console.error('[fetchQuestProgress] 解析錯誤:', e);
    return Promise.resolve({});
  }
}

// 載入任務並顯示在地圖上
async function loadTasks(forceRefreshProgress = false) {
  try {
    // 優先獲取最新進度，確保進度是最新的
    const progress = await fetchQuestProgress(forceRefreshProgress);
    
    // 然後獲取任務列表
    const tasksRes = await fetch(`${API_BASE}/api/tasks`).then(r => r.json());

    if (!tasksRes.success) return;

    const allTasks = tasksRes.tasks;
    console.log('[loadTasks] 獲取的進度:', progress);
    console.log('[loadTasks] 所有任務數量:', allTasks.length);

    // 統計劇情任務資訊
    const questTasks = allTasks.filter(t => t.type === 'quest');
    const questChains = new Set(questTasks.map(t => t.quest_chain_id).filter(id => id));
    console.log('[loadTasks] 劇情任務總數:', questTasks.length);
    console.log('[loadTasks] 劇情線數量:', questChains.size);
    console.log('[loadTasks] 劇情線 ID 列表:', Array.from(questChains));

    // 過濾邏輯：劇情任務只顯示目前進度的關卡
    tasksList = allTasks.filter(task => {
      // 1. 如果不是劇情任務，直接顯示
      if (task.type !== 'quest') return true;
      
      // 2. 如果是劇情任務，檢查 quest_order
      // 注意：quest_chain_id 必須存在
      if (!task.quest_chain_id) {
        console.warn('[loadTasks] 任務', task.id, '是劇情任務但沒有 quest_chain_id');
        return true; // 資料異常時預設顯示
      }
      
      // 3. 強制轉換為字串以確保類型匹配（解決 MySQL 數字類型與 JSON 字串類型的問題）
      const chainId = String(task.quest_chain_id);
      const currentStep = progress[chainId];
      
      if (currentStep === undefined) {
        // 用戶還沒開始這個劇情線，顯示第一關
        const shouldShow = Number(task.quest_order) === 1;
        console.log(`[loadTasks] 任務 ${task.id} (劇情線 ${chainId}, 關卡 ${task.quest_order}): 未開始，${shouldShow ? '顯示第一關' : '不顯示'}`);
        return shouldShow;
      } else {
        // 用戶已經開始這個劇情線，顯示當前進度關卡
        const shouldShow = Number(task.quest_order) === Number(currentStep);
        console.log(`[loadTasks] 任務 ${task.id} (劇情線 ${chainId}, 關卡 ${task.quest_order}): 當前進度=${currentStep}, ${shouldShow ? '顯示' : '不顯示'}`);
        return shouldShow;
      }
    });

    console.log('[loadTasks] 過濾後的任務數量:', tasksList.length);
    const displayedQuestTasks = tasksList.filter(t => t.type === 'quest');
    console.log('[loadTasks] 顯示的劇情任務數量:', displayedQuestTasks.length);
    console.log('[loadTasks] 顯示的劇情任務:', displayedQuestTasks.map(t => ({
      id: t.id,
      name: t.name,
      quest_chain_id: t.quest_chain_id,
      quest_order: t.quest_order
    })));

    tasksList.forEach(task => {
      // 創建任務標記
      const marker = createTaskMarker(task);
      task._marker = marker;

      // 如果有用戶位置，顯示距離
      if (userLatLng && distanceDisplayEnabled) {
        updateTaskDistance(task);
      }
    });

    focusFromUrl();
  } catch (err) {
    console.error('載入任務失敗:', err);
  }
}

// 輔助函式：生成標籤 HTML
function getTaskLabelsHtml(task) {
  let labels = '';
  
  // 1. 任務類型標籤
  if (task.type === 'quest') {
    labels += `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.8rem; margin-right:4px;">📚 劇情</span>`;
  } else if (task.type === 'timed') {
    labels += `<span style="background:#fff3cd; color:#856404; padding:2px 6px; border-radius:4px; font-size:0.8rem; margin-right:4px;">⏱️ 限時</span>`;
  } else {
    labels += `<span style="background:#f3f4f6; color:#374151; padding:2px 6px; border-radius:4px; font-size:0.8rem; margin-right:4px;">📍 單一</span>`;
  }

  // 2. 回答類型標籤
  if (task.task_type === 'multiple_choice') {
    labels += `<span style="background:#d1fae5; color:#065f46; padding:2px 6px; border-radius:4px; font-size:0.8rem;">☑️ 選擇題</span>`;
  } else if (task.task_type === 'photo') {
    labels += `<span style="background:#fce7f3; color:#9d174d; padding:2px 6px; border-radius:4px; font-size:0.8rem;">📸 拍照</span>`;
  } else if (task.task_type === 'number') {
    labels += `<span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.8rem;">🔢 數字解謎</span>`;
  } else if (task.task_type === 'keyword') {
    labels += `<span style="background:#ede9fe; color:#5b21b6; padding:2px 6px; border-radius:4px; font-size:0.8rem;">🔑 關鍵字</span>`;
  } else if (task.task_type === 'location') {
    labels += `<span style="background:#ecfccb; color:#3f6212; padding:2px 6px; border-radius:4px; font-size:0.8rem;">📍 打卡</span>`;
  } else {
    labels += `<span style="background:#f3f4f6; color:#374151; padding:2px 6px; border-radius:4px; font-size:0.8rem;">✍️ 問答</span>`;
  }
  
  return `<div style="margin-bottom:8px;">${labels}</div>`;
}

// 創建任務標記
function createTaskMarker(task) {
  // 如果已完成，優先使用已完成圖示
  if (completedTaskIds.has(task.id)) {
    const icon = L.icon({
      iconUrl: '/images/feature-reward.png',
      iconSize: [64, 64],
      iconAnchor: [32, 64],
      popupAnchor: [0, -64]
    });
    const marker = L.marker([task.lat, task.lng], { icon });
    bindPopupAndEvents(marker, task);
    return marker;
  }

  let icon;

  if (task.type === 'quest') {
    // 劇情任務 - 獎牌樣式 (使用 emoji 或自定義 HTML)
    icon = L.divIcon({
      className: 'custom-map-icon quest-icon',
      html: `
        <div style="
          position: relative;
          text-align: center;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
        ">
          <div style="font-size: 48px;">🏅</div>
          <div style="
            background: #FFD700;
            color: #8B4513;
            font-size: 10px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 10px;
            position: absolute;
            bottom: -5px;
            left: 50%;
            transform: translateX(-50%);
            white-space: nowrap;
            border: 1px solid #B8860B;
          ">劇情</div>
        </div>
      `,
      iconSize: [50, 60],
      iconAnchor: [25, 50],
      popupAnchor: [0, -50]
    });
  } else if (task.type === 'timed') {
    // 限時任務 - 碼錶樣式 + 剩餘數量
    const max = task.max_participants || 100;
    const current = task.current_participants || 0;
    const left = Math.max(0, max - current);
    
    // 計算剩餘時間簡短顯示 (例如: 2h, 30m)
    let timeLabel = '';
    if (task.time_limit_end) {
      const now = new Date();
      const end = new Date(task.time_limit_end);
      const diff = end - now;
      if (diff > 0) {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) timeLabel = `${Math.floor(hours/24)}天`;
        else if (hours > 0) timeLabel = `${hours}時`;
        else timeLabel = `${minutes}分`;
      } else {
        timeLabel = '結束';
      }
    }

    icon = L.divIcon({
      className: 'custom-map-icon timed-icon',
      html: `
        <div style="
          position: relative;
          text-align: center;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
        ">
          <div style="font-size: 48px;">⏱️</div>
          <div style="
            background: #fff;
            color: #d9534f;
            font-size: 10px;
            font-weight: bold;
            padding: 2px 4px;
            border-radius: 4px;
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%);
            white-space: nowrap;
            border: 1px solid #d9534f;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          ">
            剩${left}名
            ${timeLabel ? `<br><span style="color:#333">剩${timeLabel}</span>` : ''}
          </div>
        </div>
      `,
      iconSize: [50, 70],
      iconAnchor: [25, 50],
      popupAnchor: [0, -50]
    });
  } else {
    // 單一任務 - 維持原樣 (紅色圖釘)
    icon = L.icon({
      iconUrl: '/images/flag-red.png',
      iconSize: [72, 72],
      iconAnchor: [36, 72],
      popupAnchor: [0, -72]
    });
  }

  const marker = L.marker([task.lat, task.lng], { icon });
  bindPopupAndEvents(marker, task);
  return marker;
}

// 綁定 Popup 和點擊事件的輔助函數
function bindPopupAndEvents(marker, task) {
  // 創建增強的彈出視窗
  const popupContent = createTaskPopup(task);
  marker.bindPopup(popupContent, {
    maxWidth: 320,
    className: 'task-popup'
  });

  marker.addTo(map);

  // 添加點擊事件
  marker.on('click', () => {
    // 如果是限時任務，檢查是否過期
    if (task.type === 'timed' && task.time_limit_end) {
      const now = new Date();
      const end = new Date(task.time_limit_end);
      if (now > end) {
        alert('此限時任務已結束');
        // 但還是顯示卡片讓他們看
      }
    }
    showTaskCard(task.id); // 注意: showTaskCard 參數修正為 ID 或 task 對象，這裡原代碼看起來是傳 task ID 或 object，稍後確認 showTaskCard 定義
  });
}

// 創建任務彈出視窗內容
function createTaskPopup(task) {
  const points = task.points || 0;
  const distance = userLatLng && distanceDisplayEnabled
    ? formatDistance(haversineDistance(userLatLng.lat, userLatLng.lng, task.lat, task.lng))
    : '';

  // 檢查使用者權限
  const userJson = localStorage.getItem('user');
  const loginUser = userJson ? JSON.parse(userJson) : null;
  const isStaffOrAdmin = loginUser && (loginUser.role === 'admin' || loginUser.role === 'shop' || loginUser.role === 'staff');

  // 限時任務資訊
  let timedInfo = '';
  if (task.type === 'timed') {
    const max = task.max_participants || 0;
    const current = task.current_participants || 0;
    const left = Math.max(0, max - current);
    let timeStr = '已結束';
    let isExpired = false;
    if (task.time_limit_end) {
      const now = new Date();
      const end = new Date(task.time_limit_end);
      const diff = end - now;
      if (diff > 0) {
         const days = Math.floor(diff / (1000 * 60 * 60 * 24));
         const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
         const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
         timeStr = `${days > 0 ? days + '天 ' : ''}${hours}時 ${minutes}分`;
      } else {
         isExpired = true;
      }
    }
    timedInfo = `
      <div class="timed-task-info" style="background:#fff3cd; padding:8px; border-radius:6px; margin:8px 0; border:1px solid #ffeeba;">
        <div style="color:#856404; font-weight:bold; font-size:0.9rem;">⏱️ 限時任務</div>
        <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:0.85rem;">
          <span>剩餘名額: <b style="color:${left===0?'red':'black'}">${left}</b> / ${max}</span>
          <span style="color:${isExpired ? 'red' : '#155724'}">${isExpired ? '已結束' : '剩 ' + timeStr}</span>
        </div>
      </div>
    `;
  }
  
  // 劇情任務標籤
  let questLabel = '';
  if (task.type === 'quest') {
    questLabel = `<div style="background:#e0f2fe; color:#0369a1; padding:4px 8px; border-radius:4px; margin-bottom:8px; font-size:0.85rem; font-weight:bold;">📚 劇情任務 (第 ${task.quest_order || 1} 關)</div>`;
  }

  return `
    <div class="task-popup-content">
      <div class="task-popup-header">
        <h4>${task.name}</h4>
        ${getTaskLabelsHtml(task)}
        <div class="task-points">💰 ${points} 積分</div>
      </div>
      <div class="task-popup-body">
        ${questLabel}
        ${timedInfo}
        <p class="task-description">${task.description}</p>
        ${task.photoUrl ? `<div class="task-image"><img src="${task.photoUrl}" alt="${task.name}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;"></div>` : ''}
        ${task.youtubeUrl ? `<div class="task-video-link"><a href="${task.youtubeUrl}" target="_blank" style="color: #007bff; text-decoration: none;">🎬 觀看相關影片</a></div>` : ''}
        ${distance ? `<div class="task-distance">📍 距離：${distance}</div>` : ''}
        <div class="task-actions">
          <a href="/task-detail.html?id=${task.id}" class="task-detail-btn">📖 查看詳情</a>
          ${isStaffOrAdmin 
            ? `<button onclick="alert('管理員或工作人員無法接取任務')" class="task-card-btn" style="background-color: #6c757d; cursor: not-allowed;">🚫 管理員無法接任務</button>`
            : `<button onclick="showTaskCard(${task.id})" class="task-card-btn">🎯 開始任務</button>`
          }
        </div>
      </div>
    </div>
  `;
}

// 顯示任務卡片（模態框）
function showTaskCard(taskId) {
  const task = tasksList.find(t => t.id === taskId);
  if (!task) return;

  // 檢查使用者權限
  const userJson = localStorage.getItem('user');
  const loginUser = userJson ? JSON.parse(userJson) : null;
  const isStaffOrAdmin = loginUser && (loginUser.role === 'admin' || loginUser.role === 'shop' || loginUser.role === 'staff');

  // 限時任務資訊 (重複利用邏輯)
  let timedInfo = '';
  if (task.type === 'timed') {
    const max = task.max_participants || 0;
    const current = task.current_participants || 0;
    const left = Math.max(0, max - current);
    let timeStr = '已結束';
    let isExpired = false;
    if (task.time_limit_end) {
      const now = new Date();
      const end = new Date(task.time_limit_end);
      const diff = end - now;
      if (diff > 0) {
         const days = Math.floor(diff / (1000 * 60 * 60 * 24));
         const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
         const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
         timeStr = `${days > 0 ? days + '天 ' : ''}${hours}時 ${minutes}分`;
      } else {
         isExpired = true;
      }
    }
    timedInfo = `
      <div class="timed-task-info" style="background:#fff3cd; padding:10px; border-radius:8px; margin:10px 0; border:1px solid #ffeeba;">
        <div style="color:#856404; font-weight:bold; font-size:1rem; margin-bottom:5px;">⏱️ 限時任務</div>
        <div style="display:flex; flex-direction:column; gap:4px; font-size:0.9rem;">
          <div>👥 剩餘名額: <b style="color:${left===0?'red':'black'}">${left}</b> / ${max}</div>
          <div style="color:${isExpired ? 'red' : '#155724'}">⏳ ${isExpired ? '已結束' : '剩餘時間: ' + timeStr}</div>
        </div>
      </div>
    `;
  }
  
  // 劇情任務標籤
  let questLabel = '';
  if (task.type === 'quest') {
    questLabel = `<div style="background:#e0f2fe; color:#0369a1; padding:6px 10px; border-radius:6px; margin-bottom:10px; font-weight:bold;">📚 劇情任務 (第 ${task.quest_order || 1} 關)</div>`;
  }

  const modal = document.createElement('div');
  modal.className = 'task-modal';
  modal.innerHTML = `
    <div class="task-modal-overlay" onclick="closeTaskModal()"></div>
    <div class="task-modal-content">
      <div class="task-modal-header">
        <div style="flex:1;">
          <h3>${task.name}</h3>
          ${getTaskLabelsHtml(task)}
        </div>
        <button onclick="closeTaskModal()" class="close-btn">&times;</button>
      </div>
      <div class="task-modal-body">
        <div class="task-info">
          ${questLabel}
          ${timedInfo}
          <div class="task-meta">
            <span class="task-points">💰 ${task.points || 0} 積分</span>
            <span class="task-radius">📍 範圍：${task.radius}公尺</span>
          </div>
          <p class="task-description">${task.description}</p>
          ${task.photoUrl ? `
            <div class="task-image">
              <img src="${task.photoUrl}" alt="${task.name}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            </div>
          ` : ''}
        </div>

        <div class="task-steps">
          <h4>任務步驟：</h4>
          <ol>
            <li>📍 前往任務地點</li>
            <li>🎯 點擊任務標記</li>
            <li>📝 完成任務說明</li>
            <li>✅ 獲得積分獎勵</li>
          </ol>
        </div>

        ${task.youtubeUrl ? `
          <div class="task-video">
            <h4>相關影片：</h4>
            <div class="video-placeholder">
              <iframe width="100%" height="200"
                src="https://www.youtube.com/embed/${extractYouTubeId(task.youtubeUrl)}"
                frameborder="0" allowfullscreen>
              </iframe>
            </div>
          </div>
        ` : ''}

        <div class="task-actions-modal">
          ${isStaffOrAdmin 
            ? `<button onclick="alert('管理員或工作人員無法接取任務')" class="btn-secondary" style="background-color: #6c757d;">🚫 管理員無法接任務</button>`
            : `<a href="/task-detail.html?id=${task.id}" class="btn-primary">前往任務頁面</a>`
          }
          <button onclick="closeTaskModal()" class="btn-secondary">關閉</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 添加動畫效果
  setTimeout(() => {
    modal.classList.add('show');
  }, 10);
}

// 關閉任務模態框
function closeTaskModal() {
  const modal = document.querySelector('.task-modal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.remove();
    }, 300);
  }
}

// 更新任務距離顯示
function updateTaskDistance(task) {
  if (!userLatLng || !task._marker) return;

  const distance = haversineDistance(userLatLng.lat, userLatLng.lng, task.lat, task.lng);

  // 更新彈出視窗內容
  const newPopupContent = createTaskPopup(task);
  task._marker.setPopupContent(newPopupContent);

  // 如果距離很近，顯示特殊提示
  if (distance * 1000 <= task.radius) {
    showNearbyTaskAlert(task, distance);
  }
}

// 顯示附近任務提示
function showNearbyTaskAlert(task, distance) {
  if (triggeredTasks.has(task.id)) return; // 已經觸發過

  const alertDiv = document.createElement('div');
  alertDiv.className = 'nearby-task-alert';
  alertDiv.innerHTML = `
    <div class="alert-content">
      <div class="alert-icon">🎯</div>
      <div class="alert-text">
        <strong>${task.name}</strong><br>
        您已經進入任務範圍！<br>
        <small>距離：${formatDistance(distance)}</small>
      </div>
      <button onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
  `;

  document.body.appendChild(alertDiv);

  // 3秒後自動消失
  setTimeout(() => {
    if (alertDiv.parentElement) {
      alertDiv.remove();
    }
  }, 3000);
}

// 提取 YouTube 影片 ID
function extractYouTubeId(url) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length == 11) ? match[7] : null;
}

// 添加距離顯示控制按鈕
function addDistanceControls() {
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'distance-controls';
  controlsDiv.innerHTML = `
    <button onclick="toggleDistanceDisplay()" class="active" id="distanceBtn">
      📍 顯示距離
    </button>
  `;

  // 將控制按鈕添加到地圖容器
  const mapContainer = document.getElementById('map');
  if (mapContainer) {
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(controlsDiv);
  }
}

// 切換距離顯示
function toggleDistanceDisplay() {
  distanceDisplayEnabled = !distanceDisplayEnabled;
  const btn = document.getElementById('distanceBtn');

  if (distanceDisplayEnabled) {
    btn.classList.add('active');
    btn.textContent = '📍 顯示距離';
    // 重新載入任務以顯示距離
    loadTasks();
  } else {
    btn.classList.remove('active');
    btn.textContent = '📍 隱藏距離';
    // 隱藏所有距離顯示
    tasksList.forEach(task => {
      if (task._marker) {
        const newPopupContent = createTaskPopup(task).replace(/<div class="task-distance">.*?<\/div>/, '');
        task._marker.setPopupContent(newPopupContent);
      }
    });
  }
}

// 檢查任務是否已完成
function isTaskCompleted(taskId) {
  return completedTaskIds.has(taskId);
}

function focusFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const lat = parseFloat(urlParams.get('focusLat'));
  const lng = parseFloat(urlParams.get('focusLng'));
  if (!isNaN(lat) && !isNaN(lng)) {
    map.setView([lat, lng], 18);
    // 找到最近的 marker 並開啟 popup
    let minDist = Infinity, minMarker = null;
    tasksList.forEach(task => {
      const d = haversineDistance(lat, lng, task.lat, task.lng);
      if (d < minDist) { minDist = d; minMarker = task._marker; }
    });
    if (minMarker) minMarker.openPopup();
  }
}

function startGeolocation() {
  if (!('geolocation' in navigator)) {
    alert('您的裝置不支援定位功能。');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => watchPosition(),
    err => handleGeoError(err),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

let userAccuracyCircle; // GPS 精度圓圈

function watchPosition() {
  navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      
      // === GPS 精度過濾 ===
      // 如果精度太差 (> 60m)，忽略這次更新 (除非是第一次定位)
      if (accuracy > 60 && lastUserLat !== 0) {
        // 更新一下精度圈，讓使用者知道目前訊號不穩
        if (userAccuracyCircle) {
          userAccuracyCircle.setRadius(accuracy);
          userAccuracyCircle.setStyle({ color: '#ffc107', fillColor: '#ffc107' }); // 黃色警告
        }
        return; 
      }

      // 如果精度回來了，改回藍色
      if (userAccuracyCircle) {
        userAccuracyCircle.setStyle({ color: '#007bff', fillColor: '#007bff' });
      }
      
      // === 防抖動處理 ===
      // 計算與上一次位置的距離
      const moveDist = haversineDistance(lastUserLat, lastUserLng, latitude, longitude);
      
      // 🔥 優化：每次 GPS 更新都檢查任務觸發，確保邊緣判定的即時性
      checkProximity(latitude, longitude);
      
      // 只有當移動距離超過 MIN_UPDATE_DISTANCE (3公尺) 時才更新地圖上的 Marker (節省渲染資源)
      if (moveDist > MIN_UPDATE_DISTANCE) {
          lastUserLat = latitude;
          lastUserLng = longitude;
          
          userLatLng = { lat: latitude, lng: longitude };

          // 更新用戶位置標記
          if (!userMarker) {
            userMarker = L.marker([latitude, longitude], {
              icon: L.icon({
                iconUrl: '/images/red-arrow.svg',
                iconSize: [64, 64],
                iconAnchor: [32, 32]
              })
            }).addTo(map);

            // 添加精度圓圈
            userAccuracyCircle = L.circle([latitude, longitude], {
              radius: accuracy || 10, // 精度半徑 (公尺)
              color: '#007bff',
              weight: 1,
              opacity: 0.5,
              fillColor: '#007bff',
              fillOpacity: 0.1
            }).addTo(map);

            // 首次設置用戶位置時，將地圖中心點設置為用戶位置
            map.setView([latitude, longitude], map.getZoom());
          } else {
            userMarker.setLatLng([latitude, longitude]);
            
            // 更新精度圓圈
            if (userAccuracyCircle) {
              userAccuracyCircle.setLatLng([latitude, longitude]);
              userAccuracyCircle.setRadius(accuracy || 10);
            }

            // 強制拉回視角：如果使用者跑出畫面太遠 (>300m)，自動拉回來
            const mapCenter = map.getCenter();
            const distFromCenter = haversineDistance(mapCenter.lat, mapCenter.lng, latitude, longitude);
            if (distFromCenter > 0.3) { // 300公尺
                map.setView([latitude, longitude], map.getZoom());
            }
          }

          // 啟用距離顯示並更新所有任務距離
          if (!distanceDisplayEnabled) {
            distanceDisplayEnabled = true;
            addDistanceControls();
          }

          // 更新所有任務的距離顯示
          tasksList.forEach(task => {
            updateTaskDistance(task);
          });
      }
    },
    err => handleGeoError(err),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );
}

function handleGeoError(err) {
  let msg = '';
  switch (err.code) {
    case 1: msg = '請允許存取位置才能體驗任務功能'; break;
    case 2: msg = '無法取得您的定位資訊，請確認網路或 GPS 設定'; break;
    case 3: msg = '定位超時，請重新整理'; break;
    default: msg = '定位發生未知錯誤';
  }
  // alert(msg); // 減少干擾，只在控制台輸出
  console.warn(msg);
}

function checkProximity(userLat, userLng) {
  tasksList.forEach(task => {
    if (triggeredTasks.has(task.id) || isTaskCompleted(task.id)) return;
    // 檢查任務 proximity
    // 移除簡易過濾，因為經緯度換算距離在不同緯度有差異，且可能過濾掉邊界情況
    // 直接用 haversineDistance 計算最準確，反正任務數量通常不多
    if (triggeredTasks.has(task.id) || isTaskCompleted(task.id)) return;
    
    const dist = haversineDistance(userLat, userLng, task.lat, task.lng);
    if (dist * 1000 <= task.radius) { // 轉換為公尺
      triggeredTasks.add(task.id);
      showTaskModal(task, () => { window.location.href = `/task-detail.html?id=${task.id}`; });
    }
  });
}

function showTaskModal(task, onGo, onClose) {
  const loginUser = globalLoginUser;
  document.getElementById('modalTitle').textContent = `任務：${task.name}`;
  document.getElementById('modalDesc').textContent = `您已進入 ${task.name} 範圍，是否要開始？`;
  document.getElementById('taskModal').style.display = 'block';
  if (loginUser && loginUser.role === 'shop') {
    document.getElementById('goToTaskBtn').style.display = 'none';
    document.getElementById('modalDesc').textContent = '工作人員帳號無法參與任務';
  } else {
    document.getElementById('goToTaskBtn').style.display = '';
    document.getElementById('goToTaskBtn').onclick = () => {
      document.getElementById('taskModal').style.display = 'none';
      window.location.href = `/task-detail.html?id=${task.id}`;
    };
  }
  document.getElementById('closeModal').onclick = () => {
    document.getElementById('taskModal').style.display = 'none';
    if (onClose) onClose();
  };
}

function isTaskCompleted(taskId) {
  return completedTaskIds.has(taskId);
}

let globalLoginUser = null;

document.addEventListener('DOMContentLoaded', () => {
  // 初始化方向感測
  initOrientationTracking();

  globalLoginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
  const loginUser = globalLoginUser;
  
  // 優先強制刷新劇情進度，確保獲取最新狀態
  if (loginUser && loginUser.username) {
    // 先強制刷新進度，然後載入已完成任務列表，最後初始化地圖
    Promise.all([
      fetchQuestProgress(true), // 強制刷新進度
      fetch(`${API_BASE}/api/user-tasks/all?username=${encodeURIComponent(loginUser.username)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            completedTaskIds = new Set(data.tasks.filter(t => t.status === '完成').map(t => t.id));
          }
          return data;
        })
    ]).then(() => {
      initMapWithUserLocation();
    });
  } else {
    initMapWithUserLocation();
  }
});
