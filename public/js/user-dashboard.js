const API_BASE = '';
const dashboardUser = (typeof window.loginUser !== 'undefined' && window.loginUser)
  ? window.loginUser
  : JSON.parse(localStorage.getItem('loginUser') || 'null');

if (!dashboardUser || dashboardUser.role !== 'user') {
  alert('此頁面僅限一般用戶使用，請先登入用戶帳號');
  window.location.href = '/login.html';
}

const state = {
  tasks: [],
  summary: {
    total: 0,
    inProgress: 0,
    completed: 0,
    aborted: 0
  }
};

const taskCardsEl = document.getElementById('taskCards');
const emptyStateEl = document.getElementById('taskEmptyState');
const taskCountEl = document.getElementById('taskCount');
const statusFilterEl = document.getElementById('statusFilter');
const searchInputEl = document.getElementById('taskSearch');
const pointsEl = document.getElementById('userPoints');
const inProgressStatEl = document.getElementById('inProgressStat');
const completedStatEl = document.getElementById('completedStat');

const statusClassMap = {
  '進行中': 'status-progress',
  '完成': 'status-done',
  '放棄': 'status-abort'
};

initDashboard();

function initDashboard() {
  bindFilters();
  loadPoints();
  loadInventory();
  loadBadges();
  loadTasks();
}

async function loadInventory() {
  const inventoryListEl = document.getElementById('inventoryList');
  if (!inventoryListEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/user/inventory`, {
      headers: { 'x-username': dashboardUser.username },
      credentials: 'include'
    });
    const data = await res.json();
    inventoryListEl.innerHTML = '';

    if (!data.success || !data.inventory || data.inventory.length === 0) {
      inventoryListEl.innerHTML = '<div style="color:#888; grid-column:1/-1;">目前沒有任何道具</div>';
      return;
    }

    data.inventory.forEach(item => {
      const itemCard = document.createElement('div');
      itemCard.style.cssText = 'background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 10px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);';
      
      const imgHtml = item.image_url 
        ? `<img src="${item.image_url}" style="width: 50px; height: 50px; object-fit: contain; margin-bottom: 5px;">`
        : `<div style="font-size: 2rem; margin-bottom: 5px;">🎒</div>`;

      itemCard.innerHTML = `
        ${imgHtml}
        <div style="font-weight: bold; font-size: 0.9rem; margin-bottom: 2px;">${item.name}</div>
        <div style="font-size: 0.8rem; color: #666;">x${item.quantity}</div>
      `;
      inventoryListEl.appendChild(itemCard);
    });

  } catch (err) {
    console.error('載入背包失敗', err);
    inventoryListEl.innerHTML = '<div style="color:red;">載入失敗</div>';
  }
}

async function loadBadges() {
  const badgesContentEl = document.getElementById('badges-content');
  if (!badgesContentEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/user/badges`, {
      headers: { 'x-username': dashboardUser.username },
      credentials: 'include'
    });
    const data = await res.json();

    if (!data.success) {
      badgesContentEl.innerHTML = '<div class="badges-empty-state"><div class="badges-empty-state-icon">😢</div><div class="badges-empty-state-title">載入失敗</div></div>';
      return;
    }

    displayBadges(data.badges || []);

  } catch (err) {
    console.error('載入稱號失敗', err);
    badgesContentEl.innerHTML = '<div class="badges-empty-state"><div class="badges-empty-state-icon">❌</div><div class="badges-empty-state-title">連線錯誤</div></div>';
  }
}

function displayBadges(badges) {
  const content = document.getElementById('badges-content');
  
  if (badges.length === 0) {
    content.innerHTML = `
      <div class="badges-empty-state">
        <div class="badges-empty-state-icon">🎖️</div>
        <div class="badges-empty-state-title">還沒有稱號</div>
        <div class="badges-empty-state-text">完成劇情任務即可獲得專屬稱號！</div>
        <a href="/map.html" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; border-radius: 30px; text-decoration: none; display: inline-block; font-weight: 600;">開始冒險</a>
      </div>
    `;
    return;
  }

  // 顯示稱號列表
  const grid = document.createElement('div');
  grid.className = 'badges-grid';

  badges.forEach(badge => {
    const card = document.createElement('div');
    card.className = 'badge-card';

    const img = document.createElement('img');
    img.className = 'badge-image';
    img.src = badge.image_url || '/images/mascot.png';
    img.alt = badge.name;
    img.onerror = () => { img.src = '/images/mascot.png'; };

    const name = document.createElement('div');
    name.className = 'badge-name';
    name.textContent = badge.name;

    const source = document.createElement('div');
    source.className = 'badge-source';
    source.textContent = badge.source_type === 'quest' ? '🗺️ 劇情任務' : 
                         badge.source_type === 'event' ? '🎉 特殊活動' : '✨ 特殊獎勵';

    const date = document.createElement('div');
    date.className = 'badge-date';
    date.textContent = new Date(badge.obtained_at).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(source);
    card.appendChild(date);
    grid.appendChild(card);
  });

  content.innerHTML = '';
  content.appendChild(grid);
}

function bindFilters() {
  statusFilterEl.addEventListener('change', applyFilters);
  searchInputEl.addEventListener('input', () => {
    applyFilters();
  });
}

async function loadPoints() {
  try {
    const res = await fetch(`${API_BASE}/api/user/points`, {
      headers: { 'x-username': dashboardUser.username }
    });
    const data = await res.json();
    if (data.success) {
      pointsEl.textContent = data.totalPoints || 0;
    }
  } catch (err) {
    console.error('載入積分失敗', err);
  }
}

async function loadTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/user-tasks/all?username=${encodeURIComponent(dashboardUser.username)}`);
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || '載入任務失敗');
    }
    const rawTasks = (data.tasks || []).map(task => ({
      id: task.id,
      userTaskId: task.user_task_id,
      name: task.name,
      description: task.description || '尚無描述',
      status: task.status,
      points: task.points || 0,
      lat: task.lat,
      lng: task.lng,
      started_at: task.started_at,
      finished_at: task.finished_at,
      photoUrl: task.photoUrl || '',
      radius: task.radius || 0
    }));

    const summary = {
      total: rawTasks.length,
      inProgress: rawTasks.filter(task => task.status === '進行中').length,
      completed: rawTasks.filter(task => task.status === '完成').length,
      aborted: rawTasks.filter(task => task.status === '放棄').length
    };

    const activeTasks = rawTasks.filter(task => task.status !== '完成');

    state.tasks = activeTasks;
    state.summary = summary;
    updateStats();
    applyFilters();
  } catch (err) {
    console.error(err);
    showErrorState(err.message || '無法載入任務列表');
  }
}

function updateStats() {
  const { total, inProgress, completed } = state.summary;
  inProgressStatEl.textContent = inProgress;
  completedStatEl.textContent = completed;
  taskCountEl.textContent = `${state.tasks.length} 個任務`;
}

function applyFilters() {
  let filtered = [...state.tasks];
  const statusValue = statusFilterEl.value;
  const keyword = (searchInputEl.value || '').trim().toLowerCase();

  if (statusValue !== 'all') {
    filtered = filtered.filter(task => task.status === statusValue);
  }

  if (keyword) {
    filtered = filtered.filter(task =>
      task.name.toLowerCase().includes(keyword) ||
      task.description.toLowerCase().includes(keyword)
    );
  }

  taskCountEl.textContent = `${filtered.length} 個任務`;
  renderTaskCards(filtered);
}

function renderTaskCards(list) {
  taskCardsEl.innerHTML = '';
  if (!list.length) {
    emptyStateEl.style.display = 'block';
    taskCardsEl.appendChild(emptyStateEl);
    return;
  }
  emptyStateEl.style.display = 'none';

  list.forEach(task => {
    const card = document.createElement('article');
    card.className = 'task-card';
    const statusClass = statusClassMap[task.status] || 'status-progress';
    const finishedInfo = task.finished_at ? `<span>🏁 完成：${formatDate(task.finished_at)}</span>` : '';
    const detailUrl = `/task-detail.html?id=${task.id}`;
    const mapUrl = task.lat && task.lng ? `/map.html?focusLat=${task.lat}&focusLng=${task.lng}` : '/map.html';

    card.innerHTML = `
      <div class="task-card-header">
        <h3 class="task-title">${task.name}</h3>
        <span class="status-badge ${statusClass}">${task.status}</span>
      </div>
      <div class="task-meta">
        <span>📅 開始：${formatDate(task.started_at)}</span>
        ${finishedInfo}
        <span>💰 ${task.points} 積分</span>
      </div>
      <p class="task-desc">${task.description}</p>
      <div class="task-card-footer">
        <a class="btn btn-primary" href="${detailUrl}">查看任務</a>
        <a class="btn btn-secondary" href="${mapUrl}">在地圖查看</a>
      </div>
    `;
    taskCardsEl.appendChild(card);
  });
}

function showErrorState(message) {
  taskCardsEl.innerHTML = `
    <div class="empty-state" style="border-style: solid;">
      <h3>載入失敗</h3>
      <p>${message}</p>
    </div>
  `;
}

function formatDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}
