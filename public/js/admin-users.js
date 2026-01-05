// 會員管理頁面 JavaScript
if (typeof window.loginUser === 'undefined') {
  window.loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
}

const loginUser = window.loginUser;

// 權限檢查：僅 admin 可訪問
if (!loginUser || loginUser.role !== 'admin') {
  alert('僅限管理員訪問');
  window.location.href = '/login.html';
}

const API_BASE = '';
let currentPage = 1;
const limit = 50;
let usersData = [];
let expandedUsers = new Set(); // 記錄已展開的用戶

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  loadUsers(currentPage);
  setupExportButton();
  setupSeedButton();
});

// 初始化 Header
function initHeader() {
  const loginUserInfo = document.getElementById('loginUserInfo');
  const logoutBtn = document.getElementById('logoutBtn');
  const hamburgerBtn = document.getElementById('hamburgerBtn');

  if (loginUser) {
    loginUserInfo.textContent = getUserDisplayName(loginUser);
    loginUserInfo.style.display = 'inline-block';
    logoutBtn.style.display = 'inline-block';
    logoutBtn.onclick = () => {
      localStorage.removeItem('loginUser');
      window.location.href = '/login.html';
    };
  }

  if (hamburgerBtn) {
    hamburgerBtn.onclick = () => {
      document.getElementById('headerContent').classList.toggle('open');
    };
  }

  document.querySelectorAll('.main-nav a, .main-nav button').forEach(element => {
    element.addEventListener('click', () => {
      document.getElementById('headerContent').classList.remove('open');
    });
  });
}

function getUserDisplayName(user) {
  switch(user.role) {
    case 'admin': return `管理員：${user.username}`;
    case 'shop': return `商店：${user.username}`;
    case 'user': return `用戶：${user.username}`;
    default: return user.username;
  }
}

// 載入用戶列表
async function loadUsers(page) {
  const usersListEl = document.getElementById('usersList');
  usersListEl.innerHTML = '<div class="loading">載入中...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/admin/users?page=${page}&limit=${limit}`, {
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || '載入失敗');
    }

    usersData = data.users;
    displayUsers(data.users);
    updateStats(data.pagination);
    renderPagination(data.pagination);

  } catch (err) {
    console.error('載入用戶列表失敗:', err);
    usersListEl.innerHTML = `<div class="empty-state">❌ 載入失敗：${err.message}</div>`;
  }
}

// 顯示用戶列表
function displayUsers(users) {
  const usersListEl = document.getElementById('usersList');

  if (users.length === 0) {
    usersListEl.innerHTML = '<div class="empty-state">暫無會員資料</div>';
    return;
  }

  usersListEl.innerHTML = users.map(user => createUserCard(user)).join('');
  
  // 綁定展開/摺疊事件
  users.forEach(user => {
    const completedBtn = document.getElementById(`toggle-completed-${user.id}`);
    const inProgressBtn = document.getElementById(`toggle-in-progress-${user.id}`);
    
    if (completedBtn) {
      completedBtn.onclick = () => toggleTasks(user.id, 'completed', completedBtn);
    }
    if (inProgressBtn) {
      inProgressBtn.onclick = () => toggleTasks(user.id, 'in-progress', inProgressBtn);
    }
  });
}

// 創建用戶卡片
function createUserCard(user) {
  const completedTasksList = expandedUsers.has(`${user.id}-completed`) 
    ? `<div class="tasks-list show" id="completed-tasks-${user.id}">載入中...</div>`
    : `<div class="tasks-list" id="completed-tasks-${user.id}"></div>`;
  
  const inProgressTasksList = expandedUsers.has(`${user.id}-in-progress`)
    ? `<div class="tasks-list show" id="in-progress-tasks-${user.id}">載入中...</div>`
    : `<div class="tasks-list" id="in-progress-tasks-${user.id}"></div>`;

  return `
    <div class="user-card">
      <div class="user-header">
        <div class="user-info">
          <div class="user-username">${escapeHtml(user.username)}</div>
          <div style="font-size:0.85rem; color:var(--text-secondary);">
            註冊時間：${formatDate(user.created_at)}
          </div>
        </div>
      </div>
      
      <div class="user-meta">
        <div class="meta-item">
          <div class="meta-label">總積分</div>
          <div class="meta-value">${user.total_points || 0}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">已完成任務</div>
          <div class="meta-value">${user.completed_tasks || 0}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">進行中任務</div>
          <div class="meta-value">${user.in_progress_tasks || 0}</div>
        </div>
      </div>

      <div class="tasks-section">
        ${user.completed_tasks > 0 ? `
          <button class="tasks-toggle" id="toggle-completed-${user.id}">
            📋 查看已完成任務 (${user.completed_tasks})
          </button>
          ${completedTasksList}
        ` : ''}
        
        ${user.in_progress_tasks > 0 ? `
          <button class="tasks-toggle" id="toggle-in-progress-${user.id}">
            🔄 查看進行中任務 (${user.in_progress_tasks})
          </button>
          ${inProgressTasksList}
        ` : ''}
      </div>
    </div>
  `;
}

// 切換任務列表顯示
async function toggleTasks(userId, type, button) {
  const listId = `${type}-tasks-${userId}`;
  const listEl = document.getElementById(listId);
  const key = `${userId}-${type}`;
  
  if (expandedUsers.has(key)) {
    // 摺疊
    listEl.classList.remove('show');
    expandedUsers.delete(key);
  } else {
    // 展開 - 載入任務詳情
    listEl.classList.add('show');
    expandedUsers.add(key);
    
    // 如果還沒載入過，則載入
    if (listEl.textContent === '' || listEl.textContent === '載入中...') {
      await loadUserTasks(userId, type, listEl);
    }
  }
}

// 載入用戶任務詳情
async function loadUserTasks(userId, type, containerEl) {
  containerEl.innerHTML = '載入中...';

  try {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/tasks`, {
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || '載入失敗');
    }

    // 過濾任務（已完成或進行中）
    const tasks = data.tasks.filter(task => {
      if (type === 'completed') {
        return task.status === '完成';
      } else {
        return task.status === '進行中';
      }
    });

    if (tasks.length === 0) {
      containerEl.innerHTML = '<div style="color:var(--text-secondary); padding:1rem;">暫無任務</div>';
      return;
    }

    containerEl.innerHTML = tasks.map(task => createTaskItem(task, type)).join('');

  } catch (err) {
    console.error('載入任務詳情失敗:', err);
    containerEl.innerHTML = `<div style="color:#dc3545; padding:1rem;">載入失敗：${err.message}</div>`;
  }
}

// 創建任務項目
function createTaskItem(task, type) {
  const statusClass = type === 'completed' ? 'completed' : 'in-progress';
  const statusIcon = type === 'completed' ? '✅' : '🔄';
  
  return `
    <div class="task-item ${statusClass}">
      <div class="task-name">${statusIcon} ${escapeHtml(task.task_name)}</div>
      <div class="task-meta">
        <div>積分：${task.points || 0}</div>
        <div>開始時間：${formatDate(task.started_at)}</div>
        ${task.finished_at ? `<div>完成時間：${formatDate(task.finished_at)}</div>` : ''}
        ${task.answer ? `<div>答案：${escapeHtml(task.answer)}</div>` : ''}
      </div>
    </div>
  `;
}

// 更新統計資訊
function updateStats(pagination) {
  const totalUsersEl = document.getElementById('totalUsers');
  if (totalUsersEl) {
    totalUsersEl.textContent = pagination.totalUsers || 0;
  }
}

// 渲染分頁
function renderPagination(pagination) {
  const paginationEl = document.getElementById('pagination');
  
  if (pagination.totalPages <= 1) {
    paginationEl.style.display = 'none';
    return;
  }

  paginationEl.style.display = 'flex';
  
  const { page, totalPages } = pagination;
  
  let html = '';
  
  // 上一頁
  html += `<button ${page === 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">上一頁</button>`;
  
  // 頁碼
  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(totalPages, page + 2);
  
  if (startPage > 1) {
    html += `<button onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span>...</span>`;
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="${i === page ? 'current-page' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span>...</span>`;
    }
    html += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }
  
  // 下一頁
  html += `<button ${page === totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">下一頁</button>`;
  
  paginationEl.innerHTML = html;
}

// 跳轉到指定頁面
function goToPage(page) {
  currentPage = page;
  expandedUsers.clear(); // 清除展開狀態
  loadUsers(page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 設置導出按鈕
function setupExportButton() {
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = '下載中...';
      
      try {
        const res = await fetch(`${API_BASE}/api/admin/users/export`, {
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        // 獲取檔案名稱
        const contentDisposition = res.headers.get('Content-Disposition');
        let filename = '會員資料.xlsx';
        if (contentDisposition) {
          const matches = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (matches && matches[1]) {
            filename = decodeURIComponent(matches[1].replace(/['"]/g, ''));
          }
        }

        // 下載檔案
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        exportBtn.textContent = '✅ 下載完成';
        setTimeout(() => {
          exportBtn.textContent = '📥 下載 Excel';
        }, 2000);

      } catch (err) {
        console.error('導出失敗:', err);
        alert('導出失敗：' + err.message);
        exportBtn.textContent = '📥 下載 Excel';
      } finally {
        exportBtn.disabled = false;
      }
    };
  }
}

// 設置匯入按鈕
function setupSeedButton() {
  const seedBtn = document.getElementById('seedUsersBtn');
  if (seedBtn) {
    seedBtn.onclick = async () => {
      if (!confirm('確定要匯入特定的 60 位會員名單嗎？\n這將會新增不存在的號碼，已存在的會自動跳過。')) {
        return;
      }
      
      seedBtn.disabled = true;
      seedBtn.textContent = '匯入中...';
      
      try {
        const res = await fetch(`${API_BASE}/api/admin/seed-special-users`, {
          method: 'POST',
          credentials: 'include'
        });
        
        const data = await res.json();
        
        if (data.success) {
          alert(data.message);
          // 重新載入列表
          loadUsers(currentPage);
        } else {
          alert('匯入失敗: ' + data.message);
        }
      } catch (err) {
        console.error('匯入請求錯誤:', err);
        alert('匯入發生錯誤，請稍後再試');
      } finally {
        seedBtn.disabled = false;
        seedBtn.textContent = '👥 匯入特定會員';
      }
    };
  }
}

// 工具函數
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

