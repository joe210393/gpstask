// 確保 loginUser 變數存在（從 HTML 文件中的 header 腳本獲取）
if (typeof window.loginUser === 'undefined') {
  window.loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
  if (!window.loginUser || (window.loginUser.role !== 'admin' && window.loginUser.role !== 'shop')) {
    window.location.href = '/login.html';
  }
}

// 設置 loginUser 變數的引用
const loginUser = window.loginUser;

// const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

// 讀取任務列表
function loadTasks() {
  fetch(`${API_BASE}/api/tasks/admin`, {
    headers: { 'x-username': loginUser.username }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;
      const ul = document.getElementById('allTasks');
      ul.innerHTML = '';

      // 顯示用戶角色信息
      const userRole = data.userRole || loginUser.role;
      const roleText = userRole === 'admin' ? '管理員' : '工作人員';

      if (data.tasks.length === 0) {
        ul.innerHTML = `<li style="text-align:center;color:#666;padding:20px;">目前沒有任務${userRole === 'staff' ? '（您只能看到自己創建的任務）' : ''}</li>`;
        return;
      }

      data.tasks.forEach(task => {
        const li = document.createElement('li');

        // 創建者信息（只有管理員能看到）
        const creatorInfo = (userRole === 'admin' && task.created_by)
          ? `<div style="color:#666;font-size:0.9em;margin-bottom:5px;">創建者：${task.created_by}</div>`
          : '';

        li.innerHTML = creatorInfo +
          `<strong>${task.name}</strong> (${task.lat}, ${task.lng}) 半徑:${task.radius}m 積分:${task.points || 0}<br>說明: ${task.description}<br><img src="${task.photoUrl}" alt="任務照片" style="max-width:120px;max-height:80px;">` +
          (task.youtubeUrl ? `<br><iframe width="200" height="113" src="${task.youtubeUrl.replace('watch?v=','embed/')}" frameborder="0" allowfullscreen></iframe>` : '') +
          `<br><button class="editBtn" data-id="${task.id}">編輯</button> <button class="delBtn" data-id="${task.id}">刪除</button>`;
        ul.appendChild(li);
      });
      // 編輯按鈕
      ul.querySelectorAll('.editBtn').forEach(btn => {
        btn.onclick = function() {
          const id = this.dataset.id;
          fetch(`${API_BASE}/api/tasks/${id}`)
            .then(res => res.json())
            .then(data => {
              if (!data.success) return;
              const t = data.task;
              const form = document.getElementById('editTaskForm');
              form.id.value = t.id;
              form.name.value = t.name;
              form.lat.value = t.lat;
              form.lng.value = t.lng;
              form.radius.value = t.radius;
              form.points.value = t.points || 0;
              form.description.value = t.description;
              form.photoUrl.value = t.photoUrl;
              form.youtubeUrl.value = t.youtubeUrl || '';
              document.getElementById('editTaskMsg').textContent = '';
              // 預覽現有圖片
              const preview = document.getElementById('editPhotoPreview');
              if (t.photoUrl) {
                preview.src = t.photoUrl;
                preview.style.display = '';
              } else {
                preview.style.display = 'none';
              }
              document.getElementById('editPhotoInput').value = '';
              document.getElementById('editModal').style.display = 'flex';
            });
        };
      });
      // 刪除按鈕
      ul.querySelectorAll('.delBtn').forEach(btn => {
        btn.onclick = function() {
          if (!confirm('確定要刪除這個任務嗎？')) return;
          const id = this.dataset.id;
          fetch(`${API_BASE}/api/tasks/${id}`, { 
            method: 'DELETE',
            headers: { 'x-username': loginUser.username }
          })
            .then(res => res.json())
            .then(data => {
              if (data.success) loadTasks();
              else alert(data.message || '刪除失敗');
            });
        };
      });
    });
}

loadTasks();

document.getElementById('addTaskForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = this;
  const name = form.name.value.trim();
  const lat = form.lat.value;
  const lng = form.lng.value;
  const radius = form.radius.value;
  const points = form.points.value;
  const description = form.description.value.trim();
  const photoFile = form.photo.files[0];
  const youtubeUrl = form.youtubeUrl.value.trim();
  document.getElementById('addTaskMsg').textContent = '';
  if (!photoFile) {
    document.getElementById('addTaskMsg').textContent = '請選擇任務照片';
    return;
  }
  try {
    // 1. 上傳圖片
    const fd = new FormData();
    fd.append('photo', photoFile);
    const uploadRes = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'x-username': loginUser.username },
      body: fd
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      document.getElementById('addTaskMsg').textContent = uploadData.message || '圖片上傳失敗';
      return;
    }
    // 2. 新增任務
    const photoUrl = uploadData.url;
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-username': loginUser.username
      },
      body: JSON.stringify({ name, lat, lng, radius, points, description, photoUrl, youtubeUrl })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('addTaskMsg').textContent = '新增成功！';
      form.reset();
      loadTasks();
    } else {
      document.getElementById('addTaskMsg').textContent = data.message || '新增失敗';
    }
  } catch (err) {
    document.getElementById('addTaskMsg').textContent = '伺服器連線失敗';
  }
});

// 編輯彈窗關閉
document.getElementById('closeEditModal').onclick = function() {
  document.getElementById('editModal').style.display = 'none';
};

// 編輯表單送出
document.getElementById('editTaskForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const form = this;
  const id = form.id.value;
  const name = form.name.value.trim();
  const lat = form.lat.value;
  const lng = form.lng.value;
  const radius = form.radius.value;
  const points = form.points.value;
  const description = form.description.value.trim();
  const photoUrl = form.photoUrl.value.trim();
  const youtubeUrl = form.youtubeUrl.value.trim();
  document.getElementById('editTaskMsg').textContent = '';
  fetch(`${API_BASE}/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-username': loginUser.username },
    body: JSON.stringify({ name, lat, lng, radius, points, description, photoUrl, youtubeUrl })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      document.getElementById('editTaskMsg').textContent = '更新成功！';
      setTimeout(() => {
        document.getElementById('editModal').style.display = 'none';
        loadTasks();
      }, 800);
    } else {
      document.getElementById('editTaskMsg').textContent = data.message || '更新失敗';
    }
  });
});

// 編輯照片即時上傳與預覽
const editPhotoInput = document.getElementById('editPhotoInput');
const editPhotoPreview = document.getElementById('editPhotoPreview');
const editPhotoUrlInput = document.querySelector('#editTaskForm input[name="photoUrl"]');
if (editPhotoInput) {
  editPhotoInput.addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    // 預覽
    const reader = new FileReader();
    reader.onload = function(e) {
      editPhotoPreview.src = e.target.result;
      editPhotoPreview.style.display = '';
    };
    reader.readAsDataURL(file);
    // 上傳
    const fd = new FormData();
    fd.append('photo', file);
    editPhotoUrlInput.disabled = true;
    editPhotoUrlInput.value = '上傳中...';
    try {
      const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', headers: { 'x-username': loginUser.username }, body: fd });
      const data = await res.json();
      if (data.success) {
        editPhotoUrlInput.value = data.url;
      } else {
        editPhotoUrlInput.value = '';
        alert(data.message || '圖片上傳失敗');
      }
    } catch {
      editPhotoUrlInput.value = '';
      alert('圖片上傳失敗');
    }
    editPhotoUrlInput.disabled = false;
  });
}
