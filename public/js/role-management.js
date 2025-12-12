// 權限/帳號管理頁（admin/shop）
if (typeof window.loginUser === 'undefined') {
  window.loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
}

const loginUser = window.loginUser;
if (!loginUser || (loginUser.role !== 'admin' && loginUser.role !== 'shop')) {
  window.location.href = '/login.html';
}

const API_BASE = '';

function setMsg(el, text, ok = false) {
  if (!el) return;
  el.textContent = text || '';
  el.style.color = ok ? '#16a34a' : '#dc3545';
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function loadShopProfile() {
  const form = document.getElementById('shopProfileForm');
  const msg = document.getElementById('shopProfileMsg');
  if (!form) return;
  setMsg(msg, '載入店家資訊中...', true);
  const { ok, data } = await jsonFetch(`${API_BASE}/api/shop/profile`, { method: 'GET' });
  if (!ok || !data.success) return setMsg(msg, data.message || '載入失敗', false);
  const p = data.profile || {};
  form.shop_name.value = p.shop_name || '';
  form.shop_address.value = p.shop_address || '';
  form.shop_description.value = p.shop_description || '';
  setMsg(msg, '已載入', true);
}

function initRoleManagementUI() {
  const adminCreateAccountBox = document.getElementById('adminCreateAccountBox');
  const shopProfileBox = document.getElementById('shopProfileBox');

  if (loginUser.role === 'admin') {
    if (adminCreateAccountBox) adminCreateAccountBox.style.display = '';
  }
  if (loginUser.role === 'shop') {
    if (shopProfileBox) shopProfileBox.style.display = '';
    loadShopProfile();
  }

  // admin：建立 shop/admin
  const createAccountForm = document.getElementById('createAccountForm');
  const createAccountMsg = document.getElementById('createAccountMsg');
  if (createAccountForm) {
    createAccountForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(createAccountMsg, '建立中...', true);
      const fd = new FormData(createAccountForm);
      const payload = {
        role: fd.get('role'),
        username: String(fd.get('username') || '').trim(),
        password: String(fd.get('password') || '')
      };
      const { ok, data } = await jsonFetch(`${API_BASE}/api/admin/accounts`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!ok || !data.success) return setMsg(createAccountMsg, data.message || '建立失敗', false);
      setMsg(createAccountMsg, '建立成功！對方第一次登入後可自行改密碼。', true);
      createAccountForm.reset();
    });
  }

  // admin/shop：指派 staff
  const assignStaffForm = document.getElementById('assignStaffForm');
  const assignStaffMsg = document.getElementById('assignStaffMsg');
  if (assignStaffForm) {
    assignStaffForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(assignStaffMsg, '處理中...', true);
      const username = String(new FormData(assignStaffForm).get('username') || '').trim();
      const { ok, data } = await jsonFetch(`${API_BASE}/api/staff/assign`, {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      if (!ok || !data.success) return setMsg(assignStaffMsg, data.message || '指派失敗', false);
      setMsg(assignStaffMsg, '已指派為 staff', true);
      assignStaffForm.reset();
    });
  }

  // admin/shop：撤銷 staff
  const revokeStaffForm = document.getElementById('revokeStaffForm');
  const revokeStaffMsg = document.getElementById('revokeStaffMsg');
  if (revokeStaffForm) {
    revokeStaffForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('確定要撤銷 staff？撤銷後會恢復為一般用戶，可重新接任務。')) return;
      setMsg(revokeStaffMsg, '處理中...', true);
      const username = String(new FormData(revokeStaffForm).get('username') || '').trim();
      const { ok, data } = await jsonFetch(`${API_BASE}/api/staff/revoke`, {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      if (!ok || !data.success) return setMsg(revokeStaffMsg, data.message || '撤銷失敗', false);
      setMsg(revokeStaffMsg, '已撤銷 staff，恢復為一般用戶', true);
      revokeStaffForm.reset();
    });
  }

  // admin/shop：修改密碼
  const changePasswordForm = document.getElementById('changePasswordForm');
  const changePasswordMsg = document.getElementById('changePasswordMsg');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(changePasswordMsg, '更新中...', true);
      const fd = new FormData(changePasswordForm);
      const payload = {
        oldPassword: String(fd.get('oldPassword') || ''),
        newPassword: String(fd.get('newPassword') || '')
      };
      const { ok, data } = await jsonFetch(`${API_BASE}/api/change-password`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!ok || !data.success) return setMsg(changePasswordMsg, data.message || '更新失敗', false);
      setMsg(changePasswordMsg, '密碼已更新', true);
      changePasswordForm.reset();
    });
  }

  // shop：店家資訊
  const shopProfileForm = document.getElementById('shopProfileForm');
  const shopProfileMsg = document.getElementById('shopProfileMsg');
  if (shopProfileForm) {
    shopProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(shopProfileMsg, '儲存中...', true);
      const fd = new FormData(shopProfileForm);
      const payload = {
        shop_name: String(fd.get('shop_name') || '').trim(),
        shop_address: String(fd.get('shop_address') || '').trim(),
        shop_description: String(fd.get('shop_description') || '').trim()
      };
      const { ok, data } = await jsonFetch(`${API_BASE}/api/shop/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (!ok || !data.success) return setMsg(shopProfileMsg, data.message || '儲存失敗', false);
      setMsg(shopProfileMsg, '店家資訊已更新', true);
    });
  }
}

initRoleManagementUI();


