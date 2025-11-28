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
const API_BASE = '';

// 初始化任務類型切換邏輯
function setupTaskTypeToggle(selectId, divId) {
  const select = document.getElementById(selectId);
  const div = document.getElementById(divId);
  if (select && div) {
    select.addEventListener('change', function() {
      div.style.display = this.value === 'multiple_choice' ? 'block' : 'none';
    });
  }
}

setupTaskTypeToggle('taskTypeSelect', 'multipleChoiceOptions');
setupTaskTypeToggle('editTaskTypeSelect', 'editMultipleChoiceOptions');

// 讀取任務列表
function loadTasks() {
  fetch(`${API_BASE}/api/tasks/admin`, {
    headers: { 'x-username': loginUser.username }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;
      const container = document.getElementById('allTasks');
      container.innerHTML = '';

      // 顯示用戶角色信息
      const userRole = data.userRole || loginUser.role;
      
      if (data.tasks.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center;color:#666;padding:20px;">目前沒有任務${userRole === 'staff' ? '（您只能看到自己創建的任務）' : ''}</div>`;
        return;
      }

      data.tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'card';

        // 創建者信息（只有管理員能看到）
        const creatorInfo = (userRole === 'admin' && task.created_by)
          ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.5rem;">👤 ${task.created_by}</div>`
          : '';
        
        // 任務類型顯示
        let typeText = '問答題';
        let typeColor = 'bg-gray-100 text-gray-800';
        if (task.task_type === 'multiple_choice') { typeText = '選擇題'; }
        else if (task.task_type === 'photo') { typeText = '拍照任務'; }

        card.innerHTML = `
          <img src="${task.photoUrl}" class="card-img" alt="任務照片" style="height:160px;" onerror="this.src='/images/mascot.png'">
          <div class="card-body">
            ${creatorInfo}
            <div class="card-title" style="font-size:1.1rem; display:flex; justify-content:space-between; align-items:start;">
              <span>${task.name}</span>
              <span style="font-size:0.8rem; background:#f3f4f6; padding:2px 8px; border-radius:12px; white-space:nowrap;">${typeText}</span>
            </div>
            <div class="card-text">
              <div style="font-size:0.9rem; margin-bottom:4px;">📍 (${task.lat}, ${task.lng})</div>
              <div style="font-size:0.9rem; margin-bottom:4px;">🎯 半徑: ${task.radius}m</div>
              <div style="font-size:0.9rem; font-weight:600; color:var(--primary-color);">💰 積分: ${task.points || 0}</div>
              <div style="font-size:0.9rem; margin-top:8px; color:var(--text-secondary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                ${task.description}
              </div>
            </div>
            <div class="card-footer">
              <button class="btn btn-primary editBtn" data-id="${task.id}" style="padding:0.4rem 1rem; font-size:0.9rem;">編輯</button>
              <button class="btn btn-danger delBtn" data-id="${task.id}" style="padding:0.4rem 1rem; font-size:0.9rem; margin-left:auto;">刪除</button>
            </div>
          </div>
        `;
        container.appendChild(card);
      });
      // 編輯按鈕
      container.querySelectorAll('.editBtn').forEach(btn => {
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
              
              // 設置任務類型與選項
              form.task_type.value = t.task_type || 'qa';
              const editOptionsDiv = document.getElementById('editMultipleChoiceOptions');
              editOptionsDiv.style.display = (t.task_type === 'multiple_choice') ? 'block' : 'none';
              
              if (t.task_type === 'multiple_choice' && t.options) {
                const opts = typeof t.options === 'string' ? JSON.parse(t.options) : t.options;
                if (Array.isArray(opts) && opts.length >= 4) {
                  form.optionA.value = opts[0];
                  form.optionB.value = opts[1];
                  form.optionC.value = opts[2];
                  form.optionD.value = opts[3];
                  
                  // 設置正確答案選中狀態
                  if (t.correct_answer === opts[0]) form.correct_answer_select.value = 'A';
                  else if (t.correct_answer === opts[1]) form.correct_answer_select.value = 'B';
                  else if (t.correct_answer === opts[2]) form.correct_answer_select.value = 'C';
                  else if (t.correct_answer === opts[3]) form.correct_answer_select.value = 'D';
                }
              } else {
                // 清空選項
                form.optionA.value = '';
                form.optionB.value = '';
                form.optionC.value = '';
                form.optionD.value = '';
                form.correct_answer_select.value = 'A';
              }

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
              
              // 開啟 Modal
              document.getElementById('editModal').classList.add('show');
            });
        };
      });
      // 刪除按鈕
      container.querySelectorAll('.delBtn').forEach(btn => {
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
  
  // 處理任務類型與選項
  const task_type = form.task_type.value;
  console.log('新增任務表單 - task_type:', task_type);
  let options = null;
  let correct_answer = null;
  
  if (task_type === 'multiple_choice') {
    const optA = form.optionA.value.trim();
    const optB = form.optionB.value.trim();
    const optC = form.optionC.value.trim();
    const optD = form.optionD.value.trim();
    
    if (!optA || !optB || !optC || !optD) {
      document.getElementById('addTaskMsg').textContent = '請填寫所有選擇題選項';
      return;
    }
    options = [optA, optB, optC, optD];
    
    const sel = form.correct_answer_select.value;
    if (sel === 'A') correct_answer = optA;
    else if (sel === 'B') correct_answer = optB;
    else if (sel === 'C') correct_answer = optC;
    else if (sel === 'D') correct_answer = optD;
  }

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
      body: JSON.stringify({ name, lat, lng, radius, points, description, photoUrl, youtubeUrl, task_type, options, correct_answer })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('addTaskMsg').textContent = '新增成功！';
      form.reset();
      // 重置選項顯示
      document.getElementById('multipleChoiceOptions').style.display = 'none';
      loadTasks();
    } else {
      document.getElementById('addTaskMsg').textContent = data.message || '新增失敗';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('addTaskMsg').textContent = '伺服器連線失敗';
  }
});

// 編輯彈窗關閉
function closeModal() {
  document.getElementById('editModal').classList.remove('show');
}

const closeEditModalBtn = document.getElementById('closeEditModal');
if(closeEditModalBtn) closeEditModalBtn.onclick = closeModal;

const cancelEditModalBtn = document.getElementById('cancelEditModal');
if(cancelEditModalBtn) cancelEditModalBtn.onclick = closeModal;


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
  
  // 處理任務類型與選項
  const task_type = form.task_type.value;
  console.log('正在提交編輯表單，任務類型:', task_type); // Debug Log
  let options = null;
  let correct_answer = null;
  
  if (task_type === 'multiple_choice') {
    const optA = form.optionA.value.trim();
    const optB = form.optionB.value.trim();
    const optC = form.optionC.value.trim();
    const optD = form.optionD.value.trim();
    
    if (!optA || !optB || !optC || !optD) {
      document.getElementById('editTaskMsg').textContent = '請填寫所有選擇題選項';
      return;
    }
    options = [optA, optB, optC, optD];
    
    const sel = form.correct_answer_select.value;
    if (sel === 'A') correct_answer = optA;
    else if (sel === 'B') correct_answer = optB;
    else if (sel === 'C') correct_answer = optC;
    else if (sel === 'D') correct_answer = optD;
  } else {
    // 如果不是選擇題，確保 options 和 correct_answer 為 null (傳遞給後端以清空)
    options = null;
    correct_answer = null;
  }

  document.getElementById('editTaskMsg').textContent = '';
  fetch(`${API_BASE}/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-username': loginUser.username },
    body: JSON.stringify({ name, lat, lng, radius, points, description, photoUrl, youtubeUrl, task_type, options, correct_answer })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      document.getElementById('editTaskMsg').textContent = '更新成功！';
      setTimeout(() => {
        closeModal();
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
