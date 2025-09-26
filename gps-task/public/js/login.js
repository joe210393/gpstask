const USERS = [
  { username: 'user1', password: 'user123', role: 'user' },
  { username: 'user2', password: 'user456', role: 'user' },
  { username: 'staff1', password: 'staff123', role: 'shop' },
  { username: 'staff2', password: 'staff456', role: 'shop' }
];

const API_BASE = 'http://localhost:3001'; // 本地開發環境

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
      window.location.href = '/index.html';
    } else {
      document.getElementById('loginMsgUser').textContent = data.message || '登入失敗';
    }
  };
}

// 工作人員登入
const formStaff = document.getElementById('loginFormStaff');
if (formStaff) {
  formStaff.onsubmit = async function(e) {
    e.preventDefault();
    const username = this.username.value.trim();
    const password = this.password.value;
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role: 'shop' })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('loginUser', JSON.stringify(data.user));
      window.location.href = '/index.html';
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
  };
  tabStaff.onclick = () => {
    formUser.style.display = 'none';
    formStaff.style.display = '';
  };
}

// 自動填入帳號（手機門號）
const urlParams = new URLSearchParams(window.location.search);
const prefillUsername = urlParams.get('username');
if (prefillUsername && formUser) {
  formUser.username.value = prefillUsername;
}
