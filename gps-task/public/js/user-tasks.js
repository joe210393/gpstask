document.addEventListener('DOMContentLoaded', () => {
  // 使用全局的 window.loginUser
  if (!window.loginUser || !window.loginUser.username) {
    document.getElementById('userProgressSection').style.display = '';
    document.getElementById('userTasks').innerHTML = '<li>請先登入</li>';
    return;
  }

  const API_BASE = 'http://localhost:3001'; // 本地開發環境

  if (window.loginUser.role === 'shop' || window.loginUser.role === 'admin') {
    document.getElementById('staffReviewSection').style.display = '';
    document.getElementById('userProgressSection').style.display = 'none';
    function loadInProgressTasks(qTask, qUser) {
      let url = `${API_BASE}/api/user-tasks/in-progress`;
      const params = [];
      if (qTask) params.push('taskName=' + encodeURIComponent(qTask));
      if (qUser) params.push('username=' + encodeURIComponent(qUser));
      if (params.length) url += '?' + params.join('&');
      fetch(url, { headers: { 'x-username': window.loginUser.username } })
        .then(res => res.json())
        .then(data => {
          const ul = document.getElementById('inProgressTasks');
          ul.innerHTML = '';
          if (!data.success || !data.tasks.length) {
            ul.innerHTML = '<li>查無進行中任務</li>';
            return;
          }
          data.tasks.forEach(task => {
            const li = document.createElement('li');
            let answerBlock = '';
            let finishBtn = `<button class=\"staffFinishBtn\" data-id=\"${task.user_task_id}\">設為完成</button>`;
            if ('answer' in task) {
              if (task.answer && task.answer.trim() !== '') {
                answerBlock = `<b style='color:#7c3aed;'>答案：</b><span style='background:#f3f3ff;padding:4px 8px;border-radius:6px;'>${task.answer}</span><br>`;
              } else {
                answerBlock = `<b style='color:#7c3aed;'>答案：</b><span style='color:#c00;'>（尚未填寫）</span><br>`;
                finishBtn = `<button class=\"staffFinishBtn\" data-id=\"${task.user_task_id}\" disabled style='opacity:0.5;cursor:not-allowed;'>設為完成</button><span style='color:#c00;margin-left:8px;'>需填寫答案</span>`;
              }
            }
            li.innerHTML = `<b>使用者：</b><span style='color:#007bff;'>${task.username}</span> <b>任務：</b>${task.task_name}<br>
              <span style=\"color:orange;\">進行中</span>｜開始：${toTWTime(task.started_at)}<br>
              <b>說明：</b>${task.description}<br>
              ${answerBlock}
              <b>獲得積分：</b>${task.points || 0}<br>
              ${finishBtn}
`;
            ul.appendChild(li);
          });
          ul.querySelectorAll('.staffFinishBtn').forEach(btn => {
            btn.onclick = function() {
              if (!confirm('確定要設為完成？')) return;
              const taskId = this.dataset.id;
              // 找到對應的任務物件
              const task = data.tasks.find(t => t.user_task_id == taskId);
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
                if (data.success) loadInProgressTasks();
                else alert(data.message || '操作失敗');
              });
            };
          });
        });
    }
    loadInProgressTasks();
    document.getElementById('searchForm').onsubmit = function(e) {
      e.preventDefault();
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
          let answerBlock = `<div style='margin:6px 0 6px 0;'><b style='color:#7c3aed;'>猜謎答案：</b>${task.answer ? task.answer : ''}</div>`;
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

function toTWTime(str) {
  if (!str) return '-';
  const d = new Date(str);
  d.setHours(d.getHours() + 8);
  return d.toISOString().replace('T',' ').slice(0,19);
} 