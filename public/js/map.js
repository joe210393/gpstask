let map;
let userMarker;
let userAccuracyCircle;
let taskMarkersLayer;
let tasksList = [];
let triggeredTasks = new Set();
let completedTaskIds = new Set();
let taskStatusById = {};
let geoWatchId = null;
let firstLocationFix = false;
let initialTaskViewApplied = false;
let taskNavigatorCollapsed = false;
let lastGeoErrorAt = 0;
let lastGeoWarningAt = 0;

// const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑
const API_BASE = '';
const DEFAULT_MAP_CENTER = { lat: 24.757, lng: 121.753 };
const DEFAULT_MAP_ZOOM = 16;

// 地理位置權限狀態
let locationPermissionGranted = false;
let locationPermissionDenied = false;

// 防抖動變數
let lastUserLat = 0;
let lastUserLng = 0;
const MIN_UPDATE_DISTANCE = 0.003; // 最小更新距離 (約 3 公尺)，小於此距離不更新地圖，防止閃爍

function getStoredLoginUser() {
  try {
    return JSON.parse(localStorage.getItem('loginUser') || 'null');
  } catch (err) {
    return null;
  }
}

function isStaffOrAdminUser(user) {
  return user && (user.role === 'admin' || user.role === 'shop' || user.role === 'staff');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 地理位置權限處理
function requestLocationPermission() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('瀏覽器不支援地理位置功能'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        locationPermissionGranted = true;
        locationPermissionDenied = false;
        resolve(pos);
      },
      err => {
        locationPermissionDenied = err.code === 1;
        reject(err);
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 5000 }
    );
  });
}

// 初始化地圖
function initMapWithUserLocation() {
  initMap(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_ZOOM);
  showLocationStatus('正在尋找 GPS；任務已先載入，可以直接點任務開始。', 'loading');
  startGeolocation({ recenterOnFirstFix: true });
}

// 處理定位錯誤
function handleLocationError(error) {
  console.warn('定位錯誤:', error && (error.message || error.code));

  let errorMessage = '定位暫時失敗，但地圖與任務仍可使用。';

  switch (error.code || error.message) {
    case 1: // PERMISSION_DENIED
      errorMessage = '地理位置權限被拒絕。您仍可從任務導覽開始，或在瀏覽器設定允許定位後重試。';
      break;
    case 2: // POSITION_UNAVAILABLE
      errorMessage = '目前抓不到 GPS 位置。請先用任務導覽查看任務，定位恢復後會自動更新距離。';
      break;
    case 3: // TIMEOUT
      errorMessage = '定位逾時。任務已顯示在地圖上，可以先開始瀏覽或再試一次定位。';
      break;
    default:
      if (error.message && error.message.includes('不支援')) {
        errorMessage = '您的瀏覽器不支援地理位置功能，請使用任務導覽或任務列表查看內容。';
      }
  }

  showManualLocationOption(errorMessage);
}

// 使用較低精度嘗試重新定位
function initMapWithLowAccuracy() {
  showLocationStatus('正在嘗試快速定位；任務仍可先操作。', 'loading');
  startGeolocation({ recenterOnFirstFix: true });
}

// 初始化地圖
function initMap(lat, lng, zoom) {
  if (map) {
    map.setView([lat, lng], zoom);
    return;
  }

  map = L.map('map', {
    zoomControl: true
  }).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  taskMarkersLayer = L.layerGroup().addTo(map);
  createTaskNavigator();

  // 強制刷新進度後載入任務（確保顯示最新進度的任務）
  loadTasks(true);

  setTimeout(() => map.invalidateSize(), 50);
}

// 顯示手動定位選項
function showManualLocationOption(message) {
  const statusDiv = document.getElementById('locationStatus') || createLocationStatusDiv();

  statusDiv.innerHTML = `
    <div class="location-error">
      <div class="error-icon">📍</div>
      <div class="error-message">${escapeHtml(message)}</div>
      <div class="location-options">
        <button onclick="requestLocationAgain()" class="btn-primary">再次定位</button>
        <button onclick="useManualLocation()" class="btn-secondary">用地圖中心當位置</button>
        <a href="/tasks-list.html" class="btn-secondary">任務列表</a>
      </div>
    </div>
  `;
  statusDiv.style.display = 'block';
}

// 重新請求地理位置權限
function requestLocationAgain() {
  locationPermissionDenied = false;
  showLocationStatus('正在重新定位；您仍可先操作任務。', 'loading');
  startGeolocation({ recenterOnFirstFix: true });
}

// 手動輸入位置
function useManualLocation() {
  const center = map ? map.getCenter() : DEFAULT_MAP_CENTER;
  const input = prompt('可輸入「緯度,經度」，或直接按確定使用目前地圖中心作為位置。', `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`);
  if (input === null) return;

  const parts = input.split(',').map(part => Number(part.trim()));
  const lat = Number.isFinite(parts[0]) ? parts[0] : center.lat;
  const lng = Number.isFinite(parts[1]) ? parts[1] : center.lng;

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    showLocationStatus('座標格式不正確，請輸入像 24.757000,121.753000 這樣的緯度與經度。', 'warning');
    return;
  }

  setUserPosition(lat, lng, 30, { recenter: true, manual: true });
  showLocationStatus('已用指定位置更新距離與任務排序。', 'success');
}

// 使用地址搜尋（模擬實現）
function searchAddress(address) {
  showLocationStatus(`目前未串接地址搜尋，請改用座標或地圖中心定位。`, 'warning');
}

// 使用預設位置
function useDefaultLocation() {
  setUserPosition(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng, 50, { recenter: true, manual: true });
  showLocationStatus('已使用預設位置更新任務距離。', 'info');
}

// 顯示定位狀態
function showLocationStatus(message, type = 'info', options = {}) {
  const statusDiv = document.getElementById('locationStatus') || createLocationStatusDiv();

  const typeClasses = {
    loading: 'status-loading',
    success: 'status-success',
    warning: 'status-warning',
    error: 'status-error',
    info: 'status-info'
  };

  statusDiv.innerHTML = `<div class="location-status ${typeClasses[type] || 'status-info'}">${escapeHtml(message)}</div>`;
  statusDiv.style.display = 'block';

  // 自動隱藏成功訊息
  if (type === 'success' && !options.persist) {
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
      credentials: 'include', // 發送 cookies (JWT)，確保認證資訊傳遞
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

function normalizeTaskCoordinates(task) {
  const lat = Number(task.lat);
  const lng = Number(task.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    ...task,
    lat,
    lng,
    radius: Number(task.radius) || 50,
    points: Number(task.points) || 0
  };
}

function resetTaskMarkers() {
  if (taskMarkersLayer) {
    taskMarkersLayer.clearLayers();
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

    const allTasks = (tasksRes.tasks || [])
      .map(normalizeTaskCoordinates)
      .filter(Boolean);
    console.log('[loadTasks] 獲取的進度:', progress);
    console.log('[loadTasks] 所有任務數量:', allTasks.length);

    // 統計劇情任務資訊
    const questTasks = allTasks.filter(t => t.type === 'quest');
    const questChains = new Set(questTasks.map(t => t.quest_chain_id).filter(id => id));
    console.log('[loadTasks] 劇情任務總數:', questTasks.length);
    console.log('[loadTasks] 劇情線數量:', questChains.size);
    console.log('[loadTasks] 劇情線 ID 列表:', Array.from(questChains));

    // 過濾邏輯：劇情任務只顯示目前進度的關卡
    resetTaskMarkers();

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

    renderTaskNavigator();

    if (!focusFromUrl()) {
      fitInitialTaskView();
    }
  } catch (err) {
    console.error('載入任務失敗:', err);
    showLocationStatus('任務載入失敗，請檢查網路後重新整理。', 'error', { persist: true });
    renderTaskNavigator();
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

  marker.addTo(taskMarkersLayer || map);

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
  const loginUser = getStoredLoginUser();
  const isStaffOrAdmin = isStaffOrAdminUser(loginUser);

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

function createTaskNavigator() {
  if (document.getElementById('taskNavigator')) return;

  const panel = document.createElement('aside');
  panel.id = 'taskNavigator';
  panel.className = 'task-navigator';
  panel.innerHTML = `
    <div class="task-navigator-header">
      <div>
        <div class="task-navigator-title">任務導覽</div>
        <div id="taskNavigatorSummary" class="task-navigator-summary">正在載入任務...</div>
      </div>
      <button id="taskNavigatorToggle" class="task-navigator-toggle" type="button" aria-label="收合任務導覽">收合</button>
    </div>
    <div id="taskNavigatorList" class="task-navigator-list"></div>
  `;

  document.body.appendChild(panel);
  document.getElementById('taskNavigatorToggle').addEventListener('click', () => {
    setTaskNavigatorCollapsed(!taskNavigatorCollapsed);
  });
}

function setTaskNavigatorCollapsed(isCollapsed) {
  taskNavigatorCollapsed = isCollapsed;
  const panel = document.getElementById('taskNavigator');
  const toggle = document.getElementById('taskNavigatorToggle');
  if (!panel || !toggle) return;

  panel.classList.toggle('is-collapsed', isCollapsed);
  toggle.textContent = isCollapsed ? '展開' : '收合';
  toggle.setAttribute('aria-label', isCollapsed ? '展開任務導覽' : '收合任務導覽');
}

function getTaskKindLabel(task) {
  if (task.type === 'quest') return `劇情第 ${task.quest_order || 1} 關`;
  if (task.type === 'timed') return '限時任務';
  return '一般任務';
}

function getAnswerKindLabel(task) {
  const labels = {
    multiple_choice: '選擇題',
    photo: '拍照',
    number: '數字解謎',
    keyword: '關鍵字',
    location: '打卡',
    qa: '問答'
  };
  return labels[task.task_type] || '問答';
}

function getTaskStatusLabel(task) {
  if (completedTaskIds.has(task.id) || taskStatusById[task.id] === '完成') return '已完成';
  if (taskStatusById[task.id] === '進行中') return '進行中';
  return '可接取';
}

function getTaskDistanceText(task) {
  if (!userLatLng) return '等待定位';
  return formatDistance(haversineDistance(userLatLng.lat, userLatLng.lng, task.lat, task.lng));
}

function sortTasksForNavigator(tasks) {
  return tasks.slice().sort((a, b) => {
    const aDone = getTaskStatusLabel(a) === '已完成' ? 1 : 0;
    const bDone = getTaskStatusLabel(b) === '已完成' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    if (userLatLng) {
      const aDist = haversineDistance(userLatLng.lat, userLatLng.lng, a.lat, a.lng);
      const bDist = haversineDistance(userLatLng.lat, userLatLng.lng, b.lat, b.lng);
      if (aDist !== bDist) return aDist - bDist;
    }

    if (a.type === 'quest' && b.type === 'quest' && a.quest_chain_id === b.quest_chain_id) {
      return Number(a.quest_order || 0) - Number(b.quest_order || 0);
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function renderTaskNavigator() {
  const list = document.getElementById('taskNavigatorList');
  const summary = document.getElementById('taskNavigatorSummary');
  if (!list || !summary) return;

  if (!tasksList.length) {
    summary.textContent = '目前沒有可顯示任務';
    list.innerHTML = `
      <div class="task-navigator-empty">
        <div>目前地圖上沒有可顯示的任務。</div>
        <a href="/tasks-list.html">前往任務列表</a>
      </div>
    `;
    return;
  }

  summary.textContent = userLatLng
    ? `共 ${tasksList.length} 個任務，已依距離排序`
    : `共 ${tasksList.length} 個任務，GPS 還在定位中`;

  const sortedTasks = sortTasksForNavigator(tasksList).slice(0, 8);
  list.innerHTML = sortedTasks.map(task => {
    const status = getTaskStatusLabel(task);
    const statusClass = status === '已完成' ? 'is-complete' : (status === '進行中' ? 'is-active' : '');
    const description = escapeHtml(task.description || '').slice(0, 42);
    return `
      <article class="task-navigator-item ${statusClass}">
        <div class="task-navigator-item-main">
          <div class="task-navigator-name">${escapeHtml(task.name)}</div>
          <div class="task-navigator-meta">
            <span>${escapeHtml(getTaskKindLabel(task))}</span>
            <span>${escapeHtml(getAnswerKindLabel(task))}</span>
            <span>${escapeHtml(getTaskDistanceText(task))}</span>
          </div>
          ${description ? `<div class="task-navigator-desc">${description}${description.length >= 42 ? '...' : ''}</div>` : ''}
        </div>
        <div class="task-navigator-actions">
          <span class="task-navigator-status">${status}</span>
          <button type="button" data-focus-task="${task.id}">定位圖釘</button>
          <a href="/task-detail.html?id=${task.id}">${status === '已完成' ? '查看' : '開始'}</a>
        </div>
      </article>
    `;
  }).join('');

  list.querySelectorAll('[data-focus-task]').forEach(button => {
    button.addEventListener('click', () => {
      focusTaskFromNavigator(Number(button.dataset.focusTask));
    });
  });
}

function focusTaskFromNavigator(taskId) {
  const task = tasksList.find(item => Number(item.id) === Number(taskId));
  if (!task || !map) return;

  map.setView([task.lat, task.lng], Math.max(map.getZoom(), 18));
  if (task._marker) task._marker.openPopup();

  if (window.innerWidth <= 700) {
    setTaskNavigatorCollapsed(true);
  }
}

function fitInitialTaskView() {
  if (initialTaskViewApplied || !map || userLatLng || !tasksList.length) return;
  initialTaskViewApplied = true;

  if (tasksList.length === 1) {
    map.setView([tasksList[0].lat, tasksList[0].lng], 17);
    return;
  }

  const bounds = L.latLngBounds(tasksList.map(task => [task.lat, task.lng]));
  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      paddingTopLeft: [24, 110],
      paddingBottomRight: [360, 120],
      maxZoom: 17
    });
  }
}

// 顯示任務卡片（模態框）
function showTaskCard(taskId) {
  const task = tasksList.find(t => t.id === taskId);
  if (!task) return;

  // 檢查使用者權限
  const loginUser = getStoredLoginUser();
  const isStaffOrAdmin = isStaffOrAdminUser(loginUser);

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
  if (document.getElementById('distanceBtn')) return;

  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'distance-controls';
  controlsDiv.innerHTML = `
    <button onclick="toggleDistanceDisplay()" class="active" id="distanceBtn" type="button">隱藏距離</button>
  `;

  document.body.appendChild(controlsDiv);
}

function updateDistanceButton() {
  const btn = document.getElementById('distanceBtn');
  if (!btn) return;
  btn.classList.toggle('active', distanceDisplayEnabled);
  btn.textContent = distanceDisplayEnabled ? '隱藏距離' : '顯示距離';
}

// 切換距離顯示
function toggleDistanceDisplay() {
  if (!userLatLng) {
    showLocationStatus('尚未取得定位；任務可以先開始，距離會在 GPS 恢復後顯示。', 'warning');
    return;
  }

  distanceDisplayEnabled = !distanceDisplayEnabled;
  updateDistanceButton();

  if (distanceDisplayEnabled) {
    tasksList.forEach(task => updateTaskDistance(task));
  } else {
    // 隱藏所有距離顯示
    tasksList.forEach(task => {
      if (task._marker) {
        const newPopupContent = createTaskPopup(task).replace(/<div class="task-distance">.*?<\/div>/, '');
        task._marker.setPopupContent(newPopupContent);
      }
    });
  }

  renderTaskNavigator();
}

// 檢查任務是否已完成
function isTaskCompleted(taskId) {
  return completedTaskIds.has(taskId);
}

function focusFromUrl() {
  if (!map) return false;

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
    return true;
  }
  return false;
}

function startGeolocation(options = {}) {
  if (!('geolocation' in navigator)) {
    handleLocationError(new Error('瀏覽器不支援地理位置功能'));
    return;
  }

  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }

  requestLocationPermission()
    .then(pos => {
      setUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, {
        recenter: options.recenterOnFirstFix !== false
      });
      showLocationStatus(`定位成功，精度約 ${Math.round(pos.coords.accuracy || 0)} 公尺。`, 'success');
    })
    .catch(err => handleLocationError(err));

  geoWatchId = navigator.geolocation.watchPosition(
    pos => {
      setUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, {
        recenter: !firstLocationFix && options.recenterOnFirstFix !== false
      });
    },
    err => handleGeoError(err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function watchPosition() {
  startGeolocation({ recenterOnFirstFix: false });
}

function setUserPosition(latitude, longitude, accuracy = 20, options = {}) {
  if (!map) return;

  const wasFirstFix = !firstLocationFix;
  const normalizedAccuracy = Number(accuracy) || 20;

  checkProximity(latitude, longitude);

  const moveDist = firstLocationFix
    ? haversineDistance(lastUserLat, lastUserLng, latitude, longitude)
    : Infinity;

  if (moveDist <= MIN_UPDATE_DISTANCE && !options.manual) {
    return;
  }

  lastUserLat = latitude;
  lastUserLng = longitude;
  userLatLng = { lat: latitude, lng: longitude };
  firstLocationFix = true;
  locationPermissionGranted = true;
  locationPermissionDenied = false;

  const accuracyColor = normalizedAccuracy > 80 ? '#f59e0b' : '#007bff';
  if (normalizedAccuracy > 80 && Date.now() - lastGeoWarningAt > 10000) {
    lastGeoWarningAt = Date.now();
    showLocationStatus(`GPS 訊號偏弱，誤差約 ${Math.round(normalizedAccuracy)} 公尺；任務仍可操作。`, 'warning');
  }

  if (!userMarker) {
    userMarker = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: '/images/red-arrow.svg',
        iconSize: [64, 64],
        iconAnchor: [32, 32]
      })
    }).addTo(map);

    userAccuracyCircle = L.circle([latitude, longitude], {
      radius: normalizedAccuracy,
      color: accuracyColor,
      weight: 1,
      opacity: 0.5,
      fillColor: accuracyColor,
      fillOpacity: 0.1
    }).addTo(map);
  } else {
    userMarker.setLatLng([latitude, longitude]);
    if (userAccuracyCircle) {
      userAccuracyCircle.setLatLng([latitude, longitude]);
      userAccuracyCircle.setRadius(normalizedAccuracy);
      userAccuracyCircle.setStyle({ color: accuracyColor, fillColor: accuracyColor });
    }
  }

  if (!distanceDisplayEnabled) {
    distanceDisplayEnabled = true;
  }
  addDistanceControls();
  updateDistanceButton();

  tasksList.forEach(task => updateTaskDistance(task));
  renderTaskNavigator();

  if (options.recenter || (wasFirstFix && options.recenter !== false)) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 17));
    return;
  }

  const mapCenter = map.getCenter();
  const distFromCenter = haversineDistance(mapCenter.lat, mapCenter.lng, latitude, longitude);
  if (distFromCenter > 0.3) {
    map.setView([latitude, longitude], map.getZoom());
  }
}

function handleGeoError(err) {
  let msg = '';
  switch (err.code) {
    case 1: msg = '定位權限被拒絕。任務仍可查看，允許權限後可顯示距離與自動觸發。'; break;
    case 2: msg = '暫時無法取得定位。請先查看任務導覽，GPS 恢復後會自動更新。'; break;
    case 3: msg = '定位逾時。任務已可操作，您也可以稍後再試一次定位。'; break;
    default: msg = '定位發生未知錯誤';
  }
  console.warn(msg);

  if (Date.now() - lastGeoErrorAt > 8000) {
    lastGeoErrorAt = Date.now();
    showManualLocationOption(msg);
  }
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

let globalLoginUser = null;

async function refreshUserTaskStatus() {
  const loginUser = getStoredLoginUser();
  if (!loginUser || !loginUser.username) {
    completedTaskIds = new Set();
    taskStatusById = {};
    renderTaskNavigator();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/user-tasks/all?username=${encodeURIComponent(loginUser.username)}`, {
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.tasks)) {
      taskStatusById = {};
      data.tasks.forEach(task => {
        taskStatusById[task.id] = task.status;
      });
      completedTaskIds = new Set(data.tasks.filter(task => task.status === '完成').map(task => task.id));
      renderTaskNavigator();
    }
  } catch (err) {
    console.warn('載入使用者任務狀態失敗:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 初始化方向感測
  initOrientationTracking();

  globalLoginUser = getStoredLoginUser();
  initMapWithUserLocation();

  refreshUserTaskStatus().then(() => {
    if (map) loadTasks(true);
  });
});
