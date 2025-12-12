const USERS = [
  { username: 'user1', password: 'user123', role: 'user' },
  { username: 'user2', password: 'user456', role: 'user' },
  { username: 'staff1', password: 'staff123', role: 'shop' },
  { username: 'staff2', password: 'staff456', role: 'shop' }
];

// const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑

// 一般用戶登入
const formUser = document.getElementById('loginFormUser');
if (formUser) {
  formUser.onsubmit = async function(e) {
    e.preventDefault();
    const username = this.username.value.trim();
    if (!/^09[0-9]{8}$/.test(username)) {
      document.getElementById('loginMsgUser').textContent = '請輸入正確的手機門號';
      return;
    }
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role: 'user' })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('loginUser', JSON.stringify(data.user));
      // staff 也走一般登入，但登入後導向審核頁
      if (data.user && data.user.role === 'staff') {
        window.location.href = '/user-tasks.html';
      } else {
        window.location.href = '/index.html';
      }
    } else {
      document.getElementById('loginMsgUser').textContent = data.message || '登入失敗';
    }
  };
}

// 工作人員登入（僅 admin/shop）
const formStaff = document.getElementById('loginFormStaff');
if (formStaff) {
  formStaff.onsubmit = async function(e) {
    e.preventDefault();
    const username = this.username.value.trim();
    const password = this.password.value.trim();

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role: 'staff_portal' })
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem('loginUser', JSON.stringify(data.user));
      // admin/shop 登入後導向後台
      window.location.href = '/staff-dashboard.html';
    } else {
      document.getElementById('loginMsgStaff').textContent = data.message || '登入失敗';
    }
  };
}

// 若已登入自動跳轉
// const loginUser = localStorage.getItem('loginUser');
// if (loginUser) {
//   // 可依需求自動跳轉
//   // window.location.href = '/index.html';
// }

// Tab 切換功能
const tabUser = document.getElementById('tabUser');
const tabStaff = document.getElementById('tabStaff');
if (tabUser && tabStaff && formUser && formStaff) {
  tabUser.onclick = () => {
    formUser.style.display = '';
    formStaff.style.display = 'none';
    tabUser.classList.add('active');
    tabStaff.classList.remove('active');
  };
  tabStaff.onclick = () => {
    formUser.style.display = 'none';
    formStaff.style.display = '';
    tabStaff.classList.add('active');
    tabUser.classList.remove('active');
  };
}

// 自動填入帳號（手機門號）
const urlParams = new URLSearchParams(window.location.search);
const prefillUsername = urlParams.get('username');
if (prefillUsername && formUser) {
  formUser.username.value = prefillUsername;
}
