// Haversine 公式計算兩點距離（公尺）
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = angle => (angle * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// localStorage 工具
function setTaskCompleted(taskId) {
  localStorage.setItem(taskId + 'Completed', 'true');
}
function isTaskCompleted(taskId) {
  return localStorage.getItem(taskId + 'Completed') === 'true';
}

// 彈窗顯示/隱藏
function showTaskModal(task, onGo, onClose) {
  document.getElementById('modalTitle').textContent = `任務：${task.name}`;
  document.getElementById('modalDesc').textContent = `您已進入 ${task.name} 範圍，是否要開始？`;
  document.getElementById('taskModal').style.display = 'block';
  document.getElementById('goToTaskBtn').onclick = () => {
    document.getElementById('taskModal').style.display = 'none';
    if (onGo) onGo();
  };
  document.getElementById('closeModal').onclick = () => {
    document.getElementById('taskModal').style.display = 'none';
    if (onClose) onClose();
  };
}
