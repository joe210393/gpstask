// 權限檢查
const loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
if (!loginUser || loginUser.role !== 'user') {
  window.location.href = '/login.html';
}

document.getElementById('loginUserInfo').textContent = `使用者：${loginUser.username}`;
document.getElementById('logoutBtn').onclick = function() {
  localStorage.removeItem('loginUser');
  window.location.href = '/login.html';
};

fetch('/data/tasks.json')
  .then(res => res.json())
  .then(tasks => {
    const ul = document.getElementById('currentTasks');
    let hasTask = false;
    tasks.forEach(task => {
      if (localStorage.getItem(task.id + 'Completed') !== 'true') {
        hasTask = true;
        const li = document.createElement('li');
        li.innerHTML = `<strong>${task.name}</strong> <a href="${task.pageUrl}">前往任務</a>`;
        ul.appendChild(li);
      }
    });
    if (!hasTask) {
      ul.innerHTML = '<li>恭喜你，所有任務都已完成！</li>';
    }
  });
