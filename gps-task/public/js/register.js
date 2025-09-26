const API_BASE = 'http://localhost:3001'; // 本地開發環境

document.getElementById('registerForm').onsubmit = async function(e) {
  e.preventDefault();
  const username = this.username.value.trim();
  if (!/^09[0-9]{8}$/.test(username)) {
    document.getElementById('registerMsg').textContent = '請輸入正確的手機門號';
    return;
  }
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, role: 'user' })
  });
  const data = await res.json();
  if (data.success) {
    // 將帳號帶到登入頁
    window.location.href = '/login.html?username=' + encodeURIComponent(username);
    // 不再顯示註冊成功訊息
    // document.getElementById('registerMsg').textContent = '註冊成功，請直接登入';
    // this.reset();
  } else {
    document.getElementById('registerMsg').textContent = data.message || '註冊失敗';
  }
};
