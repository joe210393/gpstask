// Haversine 公式計算兩點距離（公尺）
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = angle => (angle * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// localStorage 工具
function setTaskCompleted(taskId) {
  localStorage.setItem(taskId + 'Completed', 'true');
}
function isTaskCompleted(taskId) {
  return localStorage.getItem(taskId + 'Completed') === 'true';
}

// 彈窗顯示/隱藏
function showTaskModal(task, onGo, onClose) {
  document.getElementById('modalTitle').textContent = `任務：${task.name}`;
  document.getElementById('modalDesc').textContent = `您已進入 ${task.name} 範圍，是否要開始？`;
  document.getElementById('taskModal').style.display = 'block';
  document.getElementById('goToTaskBtn').onclick = () => {
    document.getElementById('taskModal').style.display = 'none';
    if (onGo) onGo();
  };
  document.getElementById('closeModal').onclick = () => {
    document.getElementById('taskModal').style.display = 'none';
    if (onClose) onClose();
  };
}

// ===== PWA Service Worker 註冊 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('✅ Service Worker 註冊成功', reg.scope);
        
        // 檢查是否有更新
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('🔄 發現 Service Worker 更新，請重新整理頁面');
            }
          });
        });
      })
      .catch(err => {
        console.warn('⚠️ Service Worker 註冊失敗', err);
      });
  });
}

// ===== iOS PWA 安裝引導 =====
function showIOSInstallPrompt() {
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);
  const isInWebAppiOS = window.matchMedia('(display-mode: standalone)').matches;
  
  // iOS 且不在 PWA 模式下，顯示安裝引導
  if (isIos && !isInStandaloneMode && !isInWebAppiOS) {
    const promptEl = document.getElementById('pwa-install-prompt');
    if (promptEl) {
      // 檢查是否已經顯示過（使用 localStorage）
      const hasShownPrompt = localStorage.getItem('pwa-install-prompt-shown');
      if (!hasShownPrompt) {
        promptEl.style.display = 'block';
        // 記錄已顯示過，避免重複打擾
        localStorage.setItem('pwa-install-prompt-shown', 'true');
      }
    }
  }
}

// 頁面載入完成後檢查是否需要顯示 iOS 安裝引導
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showIOSInstallPrompt);
} else {
  showIOSInstallPrompt();
}

// ===== 推送通知訂閱管理 =====
async function subscribeToPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('⚠️ 瀏覽器不支援推送通知');
    return null;
  }

  try {
    // 1. 獲取 VAPID 公鑰
    const vapidRes = await fetch('/api/push/vapid-public-key');
    const vapidData = await vapidRes.json();
    
    if (!vapidData.success || !vapidData.publicKey) {
      console.warn('⚠️ 推送服務未配置');
      return null;
    }

    const publicKey = vapidData.publicKey;

    // 2. 等待 Service Worker 就緒
    const registration = await navigator.serviceWorker.ready;
    
    // 3. 請求通知權限
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('⚠️ 用戶拒絕了通知權限');
      return null;
    }

    // 4. 訂閱推送
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // 5. 發送訂閱資訊到後端
    const loginUser = getLoginUser();
    if (!loginUser) {
      console.warn('⚠️ 未登入，無法訂閱推送');
      return null;
    }

    const subscribeRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // 發送 cookies (JWT)
      body: JSON.stringify({ subscription })
    });

    const subscribeData = await subscribeRes.json();
    if (subscribeData.success) {
      console.log('✅ 推送通知訂閱成功');
      return subscription;
    } else {
      console.error('❌ 推送訂閱失敗:', subscribeData.message);
      return null;
    }
  } catch (error) {
    console.error('❌ 訂閱推送通知失敗:', error);
    return null;
  }
}

// 輔助函數：將 VAPID 公鑰從 Base64 URL 轉換為 Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 獲取登入用戶資訊（從 localStorage）
function getLoginUser() {
  try {
    return JSON.parse(localStorage.getItem('loginUser') || 'null');
  } catch (e) {
    return null;
  }
}

// 頁面載入時自動嘗試訂閱（如果用戶已登入）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // 延遲訂閱，等待用戶可能的手動操作
    setTimeout(() => {
      const loginUser = getLoginUser();
      if (loginUser) {
        // 檢查是否已經訂閱過（避免重複提示）
        const hasSubscribed = localStorage.getItem('push-subscribed');
        if (!hasSubscribed) {
          subscribeToPushNotifications().then(subscription => {
            if (subscription) {
              localStorage.setItem('push-subscribed', 'true');
            }
          });
        }
      }
    }, 3000); // 3 秒後自動嘗試訂閱
  });
}