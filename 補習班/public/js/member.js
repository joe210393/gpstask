(() => {
  async function postJson(url, data){
    // fetch CSRF token required by server
    const csrfRes = await fetch('/api/public/csrf', { credentials: 'same-origin' });
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','CSRF-Token': csrfToken}, body: JSON.stringify(data), credentials:'same-origin' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  window.addEventListener('DOMContentLoaded', () => {
    const reg = document.getElementById('reg-form');
    if (reg) {
      reg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(reg).entries());
        const msg = document.getElementById('msg');
        try {
          await postJson('/api/public/members/register', data);
          location.href = '/';
        } catch {
          if (msg) msg.textContent = '註冊失敗';
        }
      });
    }
    const login = document.getElementById('login-form');
    if (login) {
      login.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(login).entries());
        const msg = document.getElementById('msg');
        try {
          await postJson('/api/public/members/login', data);
          location.href = '/';
        } catch {
          if (msg) msg.textContent = '登入失敗';
        }
      });
    }
  });
})();


