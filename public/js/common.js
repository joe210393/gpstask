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

// ===== 推送通知訂閱管理（預留接口，待後端實作） =====
async function subscribeToPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('瀏覽器不支援推送通知');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // 請求通知權限
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('用戶拒絕了通知權限');
      return null;
    }

    // 這裡需要後端提供 VAPID 公鑰
    // 暫時返回 null，等待後端實作
    console.log('✅ 通知權限已授予，等待後端推送服務配置');
    return null;
  } catch (error) {
    console.error('訂閱推送通知失敗:', error);
    return null;
  }
}