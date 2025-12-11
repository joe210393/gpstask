document.addEventListener('DOMContentLoaded', () => {
  const loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
  let userTaskStatus = {};
  let allTasks = []; // 存儲所有任務
  let currentFilter = 'incomplete'; // 預設僅顯示未完成
  // const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑
const API_BASE = '';
  let questProgress = {}; // 儲存劇情進度

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
    } else {
      labels += `<span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.8rem;">✍️ 問答</span>`;
    }
    
    return `<div style="margin-bottom:8px;">${labels}</div>`;
  }

  function render(tasks) {
    const listDiv = document.getElementById('tasksList');
    listDiv.innerHTML = '';

    // 更新任務計數
    updateTaskCount(tasks);

    if (tasks.length === 0) {
      listDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">沒有符合條件的任務</div>';
      return;
    }

    tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <img src="${task.photoUrl}" class="card-img" alt="任務照片" data-imgbig="1" onerror="this.src='/images/mascot.png'">
        <div class="card-body">
          <div class="card-title">${task.name}</div>
          ${getTaskLabelsHtml(task)}
          <div class="card-text">
            <div class="mb-2">
              <span class="text-primary" style="font-weight:600;">💰 ${task.points || 0} 積分</span>
            </div>
            <div>
              ${renderStatusBadge(task)}
            </div>
          </div>
          <div class="card-footer">
            <a class="btn btn-secondary" href="/task-detail.html?id=${task.id}" style="padding: 0.4rem 1rem; font-size: 0.9rem;">任務說明</a>
            <button class="btn btn-primary nav-map-btn" data-lat="${task.lat}" data-lng="${task.lng}" style="padding: 0.4rem 1rem; font-size: 0.9rem;">導航</button>
          </div>
        </div>
      `;
      listDiv.appendChild(card);
    });
    document.querySelectorAll('.nav-map-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const lat = parseFloat(e.target.dataset.lat);
        const lng = parseFloat(e.target.dataset.lng);
        window.location.href = `/map.html?focusLat=${lat}&focusLng=${lng}`;
      });
    });
    // 圖片放大功能
    document.querySelectorAll('.card-img[data-imgbig]').forEach(img => {
      img.addEventListener('click', function() {
        const modalBg = document.getElementById('imgModalBg');
        const modalImg = document.getElementById('imgModalImg');
        modalImg.src = this.src;
        modalBg.classList.add('active');
      });
    });
  }

  function renderStatusBadge(task) {
    const status = userTaskStatus[task.id];
    if (status === '進行中') {
      return '<span style="color:#f97316;font-weight:600;">⏳ 已接取待完成</span>';
    }
    if (!status) {
      return '<span style="color:#10b981;font-weight:600;">🆕 尚未接取</span>';
    }
    if (status === '完成') {
      return '<span class="text-success" style="font-weight:600;">✓ 已完成</span>';
    }
    return `<span style="color:#6b7280;font-weight:600;">${status}</span>`;
  }

  // 篩選任務
  function filterTasks() {
    const filteredTasks = allTasks.filter(task => {
      const status = userTaskStatus[task.id];
      if (currentFilter === 'incomplete') {
        return status === '進行中';
      }
      if (currentFilter === 'notJoined') {
        return !status;
      }
      return true;
    });

    render(filteredTasks);
  }

  // 更新任務計數
  function updateTaskCount(tasks) {
    const countElement = document.getElementById('taskCount');
    const totalVisible = allTasks.length;
    const shownTasks = tasks.length;

    let filterText = '';
    switch (currentFilter) {
      case 'incomplete':
        filterText = '已接取待完成';
        break;
      case 'notJoined':
        filterText = '未接取任務';
        break;
      case 'all':
      default:
        filterText = '可接任務';
        break;
    }

    countElement.textContent = `${filterText}：${shownTasks} / 共 ${totalVisible} 個任務`;
  }

  // 設置篩選器事件監聽器
  const filterSelect = document.getElementById('taskStatusFilter');
  if (filterSelect) {
    filterSelect.value = currentFilter;
    filterSelect.addEventListener('change', function() {
      currentFilter = this.value;
      filterTasks();
    });
  }
  
  // 初始化載入
  Promise.all([
    fetch(`${API_BASE}/api/tasks`).then(r => r.json()),
    loginUser ? fetch(`${API_BASE}/api/user/quest-progress`, { headers: { 'x-username': loginUser.username } }).then(r => r.json()) : Promise.resolve({progress:{}})
  ]).then(([tasksData, progressData]) => {
      if (!tasksData.success) return;
      let tasks = tasksData.tasks;
      questProgress = (progressData && progressData.progress) ? progressData.progress : {};

      // 過濾：劇情任務只保留目前進度的關卡
      tasks = tasks.filter(task => {
        if (task.type !== 'quest') return true;
        if (!task.quest_chain_id) return true;
        const currentStep = questProgress[task.quest_chain_id] || 1;
        return task.quest_order === currentStep;
      });

      allTasks = [...tasks]; // 存儲所有任務數據

      if (loginUser && loginUser.username) {
        fetch(`${API_BASE}/api/user-tasks/all?username=${encodeURIComponent(loginUser.username)}`)
          .then(res => res.json())
          .then(userData => {
            if (userData.success) {
              userTaskStatus = {};
              userData.tasks.forEach(t => { userTaskStatus[t.id] = t.status; });
            }
            filterTasks(); // 使用篩選函數而不是直接渲染
          });
      } else {
        filterTasks(); // 使用篩選函數而不是直接渲染
      }
    });

  // modal 關閉功能
  const modalBg = document.getElementById('imgModalBg');
  const modalClose = document.getElementById('imgModalClose');
  if (modalBg && modalClose) {
    modalClose.onclick = () => modalBg.classList.remove('active');
    modalBg.onclick = e => {
      if (e.target === modalBg) modalBg.classList.remove('active');
    };
  }
});
