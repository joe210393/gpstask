document.addEventListener('DOMContentLoaded', () => {
  // 使用全局的 window.loginUser
  if (!window.loginUser || !window.loginUser.username) {
    document.getElementById('userProgressSection').style.display = '';
    document.getElementById('userTasks').innerHTML = '<li>請先登入</li>';
    return;
  }

  // const API_BASE = 'http://localhost:3001'; // 本地開發環境 - 生產環境使用相對路徑
  const API_BASE = '';

  if (window.loginUser.role === 'shop' || window.loginUser.role === 'admin') {
    document.getElementById('staffReviewSection').style.display = '';
    document.getElementById('userProgressSection').style.display = 'none';

    const staffCardGrid = document.getElementById('staffCardGrid');
    const staffPagination = document.getElementById('staffPagination');
    const staffResultCount = document.getElementById('staffResultCount');
    const PAGE_SIZE = 15;
    let staffTasks = [];
    let staffCurrentPage = 1;

    function loadInProgressTasks(qTask, qUser) {
      let url = `${API_BASE}/api/user-tasks/in-progress`;
      const params = [];
      if (qTask) params.push('taskName=' + encodeURIComponent(qTask));
      if (qUser) params.push('username=' + encodeURIComponent(qUser));
      if (params.length) url += '?' + params.join('&');
      fetch(url, { headers: { 'x-username': window.loginUser.username } })
        .then(res => res.json())
        .then(data => {
          staffTasks = data.success ? (data.tasks || []) : [];
          staffCurrentPage = 1;
          renderStaffCards();
        });
    }

    function renderStaffCards(page = staffCurrentPage) {
      if (!staffCardGrid) return;
      staffCardGrid.innerHTML = '';
      staffPagination.innerHTML = '';

      if (!staffTasks.length) {
        staffResultCount.textContent = '共 0 筆任務';
        staffCardGrid.innerHTML = `<div class="review-card empty-state" style="text-align:center;">
          <h3>尚無進行中任務</h3>
          <p style="color:var(--text-secondary);margin:0;">請嘗試調整搜尋條件</p>
        </div>`;
        return;
      }

      const total = staffTasks.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      staffCurrentPage = Math.min(Math.max(page, 1), totalPages);
      const start = (staffCurrentPage - 1) * PAGE_SIZE;
      const items = staffTasks.slice(start, start + PAGE_SIZE);

      items.forEach(task => {
        const card = document.createElement('article');
        card.className = 'review-card';
        const { markup: answerBlock, hasAnswer } = buildAnswerMarkup(task, {
          textLabel: '回答內容：',
          photoLabel: '使用者上傳照片：',
          showPlaceholder: true
        });
        const disabledHint = hasAnswer ? '' : `<p style="color:#c00;font-size:0.85rem;margin:0;">尚未提交內容，無法審核通過</p>`;
        const detailUrl = `/task-detail.html?id=${task.task_id}`;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
            <div>
              <div class="avatar">${task.username}</div>
              <h3>${task.task_name}</h3>
            </div>
            <span class="status-tag">進行中</span>
          </div>
          <div class="meta-list">
            <div>📅 開始：${toTWTime(task.started_at)}</div>
            <div>🧭 任務建立者：${task.task_creator || '—'}</div>
            <div>💰 積分：${task.points || 0}</div>
          </div>
          <p style="color:var(--text-secondary);line-height:1.5;">${task.description || '—'}</p>
          ${answerBlock}
          ${disabledHint}
          <div class="actions">
            <button class="btn btn-primary staffFinishBtn" data-id="${task.user_task_id}" ${hasAnswer ? '' : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>設為完成</button>
            <a class="btn btn-secondary" href="${detailUrl}" target="_blank" style="display:block;text-align:center;margin-top:0.5rem;">查看詳情</a>
          </div>
        `;
        staffCardGrid.appendChild(card);
      });

      staffResultCount.textContent = `共 ${total} 筆任務，顯示第 ${staffCurrentPage} / ${totalPages} 頁`;
      renderStaffPagination(totalPages);
      staffCardGrid.querySelectorAll('.staffFinishBtn').forEach(btn => {
        if (btn.disabled) return;
        btn.onclick = function() {
          if (!confirm('確定要設為完成？')) return;
          const taskId = this.dataset.id;
          const task = staffTasks.find(t => t.user_task_id == taskId);
          if (!task) return;
          fetch(`${API_BASE}/api/user-tasks/finish`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-username': window.loginUser.username
            },
            body: JSON.stringify({ username: task.username, task_id: task.task_id })
          })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              loadInProgressTasks(
                document.getElementById('searchTaskName').value,
                document.getElementById('searchUsername').value
              );
            } else {
              alert(data.message || '操作失敗');
            }
          });
        };
      });
    }

    function renderStaffPagination(totalPages) {
      if (!staffPagination) return;
      staffPagination.innerHTML = '';
      if (totalPages <= 1) return;

      const prevBtn = document.createElement('button');
      prevBtn.textContent = '«';
      prevBtn.disabled = staffCurrentPage === 1;
      prevBtn.onclick = () => renderStaffCards(staffCurrentPage - 1);
      staffPagination.appendChild(prevBtn);

      for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === staffCurrentPage) btn.classList.add('active');
        btn.onclick = () => renderStaffCards(i);
        staffPagination.appendChild(btn);
      }

      const nextBtn = document.createElement('button');
      nextBtn.textContent = '»';
      nextBtn.disabled = staffCurrentPage === totalPages;
      nextBtn.onclick = () => renderStaffCards(staffCurrentPage + 1);
      staffPagination.appendChild(nextBtn);
    }

    loadInProgressTasks();
    document.getElementById('searchForm').onsubmit = function(e) {
      e.preventDefault();
      staffTasks = [];
      staffCurrentPage = 1;
      staffCardGrid.innerHTML = '<div class="review-card empty-state">資料載入中...</div>';
      loadInProgressTasks(this.taskName.value, this.username.value);
    };
  } else {
    document.getElementById('userProgressSection').style.display = '';
    document.getElementById('staffReviewSection').style.display = 'none';
    fetch(`${API_BASE}/api/user-tasks/all?username=${encodeURIComponent(window.loginUser.username)}`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const ul = document.getElementById('userTasks');
        if (data.tasks.length === 0) {
          ul.innerHTML = '<li>目前沒有任何任務紀錄</li>';
          return;
        }
        data.tasks.forEach(task => {
          const li = document.createElement('li');
          const { markup: answerBlock } = buildAnswerMarkup(task, {
            textLabel: '猜謎 / 答案：',
            photoLabel: '我上傳的照片：',
            showPlaceholder: true
          });
          li.innerHTML = `
            <strong>${task.name}</strong> <span style="color:${task.status==='完成'?'green':'orange'};">${task.status}</span><br>
            <img src="${task.photoUrl}" alt="任務照片" style="max-width:120px;max-height:80px;"> <br>
            ${task.description}<br>
            ${answerBlock}
            開始：${toTWTime(task.started_at)}<br>
            完成：${toTWTime(task.finished_at)}<br>
            <b>RANK：</b>${task.rank || '-'}<br>
            <b>獲得積分：</b>${task.points || 0}<br>
            <a href="/task-detail.html?id=${task.id}">前往任務說明</a><br>
            <div style='margin:12px 0;'>
              <textarea id="answer_${task.user_task_id}" rows="3" style="width:90%;max-width:400px;border-radius:6px;padding:8px;" placeholder="若此題有猜謎，請在此輸入答案" ${task.status === '完成' ? 'disabled' : ''}>${task.answer || ''}</textarea>
              ${task.status === '完成'
                ? '<span style="margin-left:8px;color:#28a745;font-weight:bold;">答案已提交完成</span>'
                : `<button class="submitAnswerBtn" data-id="${task.user_task_id}" style="margin-left:8px;">送出答案</button>
                   <span class="answerMsg" id="msg_${task.user_task_id}" style="margin-left:8px;color:#007bff;"></span>`
              }
            </div>
          `;
          ul.appendChild(li);
        });
        ul.querySelectorAll('.submitAnswerBtn').forEach(btn => {
          btn.onclick = async function() {
            const id = this.dataset.id;
            const textarea = document.getElementById('answer_' + id);
            const msg = document.getElementById('msg_' + id);
            const answer = textarea.value.trim();
            if (!answer) { msg.textContent = '請輸入答案'; return; }
            msg.textContent = '儲存中...';
            const res = await fetch(`${API_BASE}/api/user-tasks/${id}/answer`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer })
            });
            const data = await res.json();
            if (data.success) msg.textContent = '答案已儲存';
            else msg.textContent = data.message || '儲存失敗';
          };
        });
      });
  }
});

function buildAnswerMarkup(task, options = {}) {
  const answerRaw = (task && typeof task.answer === 'string') ? task.answer.trim() : '';
  const hasAnswer = !!answerRaw;
  const isPhoto = hasAnswer && isPhotoAnswer(task?.task_type, answerRaw);
  const textLabel = options.textLabel || '答案：';
  const photoLabel = options.photoLabel || '上傳照片：';

  if (!hasAnswer) {
    const placeholder = options.showPlaceholder
      ? `<span style='color:#c00;'>（尚未提交）</span>`
      : `<span style='color:#c00;'>（尚未填寫）</span>`;
    return {
      markup: `<div style='margin:6px 0;'><b style='color:#7c3aed;'>${textLabel}</b>${placeholder}</div>`,
      hasAnswer: false
    };
  }

  if (isPhoto) {
    const safeUrl = escapeHTML(answerRaw);
    return {
      markup: `
        <div style="margin:8px 0;">
          <b style="color:#7c3aed;display:block;margin-bottom:4px;">${photoLabel}</b>
          <div style="border:1px solid #e5e7eb;padding:6px;border-radius:8px;max-width:260px;background:#f9fafb;">
            <img src="${safeUrl}" alt="使用者上傳照片" style="width:100%;max-height:240px;object-fit:contain;border-radius:6px;" onerror="this.src='/images/mascot.png'">
            <div style="text-align:right;margin-top:4px;">
              <a href="${safeUrl}" target="_blank" style="color:#6366f1;font-size:0.9rem;">在新視窗開啟原圖</a>
            </div>
          </div>
        </div>
      `,
      hasAnswer: true
    };
  }

  return {
    markup: `<b style='color:#7c3aed;'>${textLabel}</b><span style='background:#f3f3ff;padding:4px 8px;border-radius:6px;'>${escapeHTML(answerRaw)}</span><br>`,
    hasAnswer: true
  };
}

function isPhotoAnswer(taskType, answer) {
  if (!answer) return false;
  if (taskType === 'photo') return true;
  const normalized = answer.toLowerCase();
  if (normalized.startsWith('data:image/')) return true;
  if (normalized.startsWith('/images/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/i.test(normalized);
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toTWTime(str) {
  if (!str) return '-';
  const d = new Date(str);
  d.setHours(d.getHours() + 8);
  return d.toISOString().replace('T',' ').slice(0,19);
} 