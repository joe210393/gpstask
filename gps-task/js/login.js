const USERS = [
  { username: 'user1', password: 'user123', role: 'user' },
  { username: 'user2', password: 'user456', role: 'user' },
  { username: 'staff1', password: 'staff123', role: 'staff' },
  { username: 'staff2', password: 'staff456', role: 'staff' },
  { username: 'admin', password: 'admin', role: 'admin' }
];

const API_BASE = 'http://localhost:3001'; // 本地開發環境

document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const username = this.username.value.trim();
  const password = this.password.value;
  const role = this.role.value;
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    const data = await res.json();
    if (data.success && data.username && data.role) {
      // 存完整 user 資訊
      localStorage.setItem('loginUser', JSON.stringify({
        username: data.username,
        role: data.role,
        id: data.id // 若後端有回傳 id
      }));
      document.getElementById('loginError').textContent = '';
      // 根據角色導向不同頁面
      if (data.role === 'admin') {
        window.location.href = '/staff-dashboard.html'; // 假設 admin 也用這頁
      } else if (data.role === 'staff') {
        window.location.href = '/staff-dashboard.html';
      } else {
        window.location.href = '/user-dashboard.html';
      }
    } else {
      document.getElementById('loginError').textContent = data.message || '登入失敗';
    }
  } catch (err) {
    document.getElementById('loginError').textContent = '伺服器連線失敗';
  }
});

// 若已登入自動跳轉
const loginUser = localStorage.getItem('loginUser');
if (loginUser) {
  const user = JSON.parse(loginUser);
  if (user.role === 'admin' || user.role === 'staff') {
    window.location.href = '/staff-dashboard.html';
  } else if (user.role === 'user') {
    window.location.href = '/user-dashboard.html';
  }
} 