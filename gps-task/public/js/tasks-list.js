document.addEventListener('DOMContentLoaded', () => {
  const loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
  let userTaskStatus = {};
  let allTasks = []; // 存儲所有任務
  let currentFilter = 'all'; // 當前篩選狀態
  const API_BASE = 'http://localhost:3001'; // 本地開發環境
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
      const completed = userTaskStatus[task.id] === '完成';
      const card = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-card-img">
          <img src="${task.photoUrl}" alt="任務照片" data-imgbig="1">
        </div>
        <div class="task-card-info">
          <div class="task-card-title">${task.name}</div>
          <div class="task-card-points">${task.points || 0} 積分</div>
          <div class="task-card-status">${completed ? '<span style=\'color:green;\'>已完成</span>' : '<span style=\'color:#f59e42;\'>待完成</span>'}</div>
          <div class="task-card-btns">
            <a class="task-btn" href="/task-detail.html?id=${task.id}">前往任務說明</a>
            <button class="task-btn nav-map-btn" data-lat="${task.lat}" data-lng="${task.lng}">導航到地圖</button>
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
    document.querySelectorAll('.task-card-img img[data-imgbig]').forEach(img => {
      img.addEventListener('click', function() {
        const modalBg = document.getElementById('imgModalBg');
        const modalImg = document.getElementById('imgModalImg');
        modalImg.src = this.src;
        modalBg.classList.add('active');
      });
    });
  }

  // 篩選任務
  function filterTasks() {
    let filteredTasks = [...allTasks];

    switch (currentFilter) {
      case 'completed':
        filteredTasks = allTasks.filter(task => userTaskStatus[task.id] === '完成');
        break;
      case 'incomplete':
        filteredTasks = allTasks.filter(task => userTaskStatus[task.id] !== '完成');
        break;
      case 'all':
      default:
        filteredTasks = [...allTasks];
        break;
    }

    render(filteredTasks);
  }

  // 更新任務計數
  function updateTaskCount(tasks) {
    const countElement = document.getElementById('taskCount');
    const totalTasks = allTasks.length;
    const shownTasks = tasks.length;

    let filterText = '';
    switch (currentFilter) {
      case 'completed':
        filterText = '已完成任務';
        break;
      case 'incomplete':
        filterText = '未完成任務';
        break;
      case 'all':
      default:
        filterText = '全部任務';
        break;
    }

    countElement.textContent = `${filterText}：${shownTasks} / 共 ${totalTasks} 個任務`;
  }

  // 設置篩選器事件監聽器
  const filterSelect = document.getElementById('taskStatusFilter');
  if (filterSelect) {
    filterSelect.addEventListener('change', function() {
      currentFilter = this.value;
      filterTasks();
    });
  }
  fetch(`${API_BASE}/api/tasks`)
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;
      const tasks = data.tasks;
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
