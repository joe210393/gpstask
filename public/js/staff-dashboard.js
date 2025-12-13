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

let globalQuestChainsMap = {}; // 用於快取劇情資訊

// 載入劇情列表
function loadQuestChains() {
  return fetch(`${API_BASE}/api/quest-chains`, {
    headers: { 'x-username': loginUser.username }
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) return;
    
    // 更新快取
    globalQuestChainsMap = {};
    data.questChains.forEach(q => {
      globalQuestChainsMap[q.id] = q;
    });

    // 更新任務表單的劇情下拉選單
    const selects = [document.getElementById('questChainSelect'), document.getElementById('editQuestChainSelect')];
    selects.forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '<option value="">-- 請選擇 --</option>';
      data.questChains.forEach(q => {
        sel.innerHTML += `<option value="${q.id}">${q.title}</option>`;
      });
    });

    // 更新劇情管理列表
    const list = document.getElementById('questChainList');
    if (list) {
      list.innerHTML = '';
      if (data.questChains.length === 0) {
        list.innerHTML = '<div style="color:#888;">目前沒有劇情任務線</div>';
      } else {
        data.questChains.forEach(q => {
          const div = document.createElement('div');
          div.style.cssText = 'background:white; padding:15px; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.05); border-left:4px solid #007bff; position: relative;';
          div.innerHTML = `
            <div style="font-weight:bold; font-size:1.1rem; margin-bottom:5px; padding-right: 30px;">${q.title}</div>
            <div style="font-size:0.9rem; color:#666; margin-bottom:8px;">${q.description || '無描述'}</div>
            <div style="font-size:0.85rem; color:#28a745;">🏆 全破獎勵: ${q.chain_points} 分</div>
            ${q.badge_name ? `
              <div style="font-size:0.85rem; color:#e0a800; display:flex; align-items:center; gap:5px; margin-top:5px;">
                🎖 獎章: ${q.badge_name}
                ${q.badge_image ? `<img src="${q.badge_image}" style="width:20px; height:20px; object-fit:contain;">` : ''}
              </div>` : ''}
            
            <button class="btn-delete-quest" data-id="${q.id}" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #dc3545; cursor: pointer; font-size: 1.2rem; padding: 0;" title="刪除劇情">&times;</button>
          `;
          list.appendChild(div);
        });

        // 綁定刪除按鈕事件
        document.querySelectorAll('.btn-delete-quest').forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!confirm('確定要刪除這個劇情嗎？\n注意：如果該劇情下還有任務，將無法刪除。')) return;
            
            const id = this.dataset.id;
            fetch(`${API_BASE}/api/quest-chains/${id}`, {
              method: 'DELETE',
              headers: { 'x-username': loginUser.username }
            })
            .then(res => res.json())
            .then(resData => {
              if (resData.success) {
                alert('刪除成功');
                loadQuestChains();
              } else {
                alert(resData.message || '刪除失敗');
              }
            })
            .catch(err => {
              console.error(err);
              alert('發生錯誤');
            });
          });
        });
      }
    }
  });
}

// 綁定新增劇情按鈕與 Modal
const btnCreateQuest = document.getElementById('btnCreateQuest');
const questModal = document.getElementById('questModal');
const closeQuestModal = document.getElementById('closeQuestModal');

// 圖片預覽邏輯
const questBadgeInput = document.getElementById('questBadgeInput');
const questBadgePreview = document.getElementById('questBadgePreview');
if (questBadgeInput) {
  questBadgeInput.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        questBadgePreview.src = e.target.result;
        questBadgePreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      questBadgePreview.style.display = 'none';
    }
  });
}

if (btnCreateQuest && questModal) {
  btnCreateQuest.onclick = () => questModal.classList.add('show');
  closeQuestModal.onclick = () => questModal.classList.remove('show');
}

// 送出新增劇情表單
const createQuestForm = document.getElementById('createQuestForm');
if (createQuestForm) {
  createQuestForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const form = this;
    const title = form.title.value.trim();
    const description = form.description.value.trim();
    const chain_points = form.chain_points.value;
    const badge_name = form.badge_name.value.trim();
    const badgeImageFile = form.badge_image.files[0];

    // 使用 FormData 上傳
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description);
    fd.append('chain_points', chain_points);
    fd.append('badge_name', badge_name);
    if (badgeImageFile) {
      fd.append('badge_image', badgeImageFile);
    }

    fetch(`${API_BASE}/api/quest-chains`, {
      method: 'POST',
      headers: { 'x-username': loginUser.username },
      body: fd // 不用設定 Content-Type，fetch 會自動設定 multipart/form-data
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('劇情建立成功！');
        form.reset();
        if (questBadgePreview) questBadgePreview.style.display = 'none';
        questModal.classList.remove('show');
        loadQuestChains();
      } else {
        alert(data.message || '建立失敗');
      }
    })
    .catch(err => {
      console.error(err);
      alert('發生錯誤');
    });
  });
}

// 初始化任務分類切換邏輯
function setupCategoryToggle(selectId, questDivId, timedDivId) {
  const select = document.getElementById(selectId);
  const questDiv = document.getElementById(questDivId);
  const timedDiv = document.getElementById(timedDivId);
  
  if (select && questDiv && timedDiv) {
    const update = () => {
      const val = select.value;
      questDiv.style.display = (val === 'quest') ? 'block' : 'none';
      timedDiv.style.display = (val === 'timed') ? 'block' : 'none';
    };
    select.addEventListener('change', update);
    update(); // 初始化狀態
  }
}

setupCategoryToggle('taskCategorySelect', 'questFields', 'timedFields');
setupCategoryToggle('editTaskCategorySelect', 'editQuestFields', 'editTimedFields');

// 初始化任務類型切換邏輯
function setupTaskTypeToggle(selectId, divId, standardAnswerDivId) {
  const select = document.getElementById(selectId);
  const div = document.getElementById(divId);
  const standardAnswerDiv = document.getElementById(standardAnswerDivId);
  
  if (select) {
    select.addEventListener('change', function() {
      const val = this.value;
      if (div) div.style.display = (val === 'multiple_choice') ? 'block' : 'none';
      if (standardAnswerDiv) {
        standardAnswerDiv.style.display = (val === 'number' || val === 'keyword') ? 'block' : 'none';
      }
    });
  }
}

setupTaskTypeToggle('taskTypeSelect', 'multipleChoiceOptions', 'standardAnswerBlock');
setupTaskTypeToggle('editTaskTypeSelect', 'editMultipleChoiceOptions', 'editStandardAnswerBlock');

// 確保先載入劇情和道具，再載入任務
Promise.all([loadQuestChains(), loadItems()]).then(() => {
  loadTasks();
});

// === 道具管理邏輯 ===
let globalItemsMap = {};

function loadItems() {
  return fetch(`${API_BASE}/api/items`)
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;
      globalItemsMap = {};
      const list = document.getElementById('itemList');
      const selects = document.querySelectorAll('.item-select'); // 任務表單中的下拉選單
      
      if (list) list.innerHTML = '';
      
      // 更新下拉選單
      selects.forEach(sel => {
        const currentVal = sel.value; // 保留目前選擇
        sel.innerHTML = '<option value="">-- 無 --</option>';
        data.items.forEach(item => {
          sel.innerHTML += `<option value="${item.id}">${item.name}</option>`;
        });
        sel.value = currentVal;
      });

      if (data.items.length === 0) {
        if (list) list.innerHTML = '<div style="color:#888;">目前沒有道具</div>';
      } else {
        data.items.forEach(item => {
          globalItemsMap[item.id] = item;
          if (list) {
            const div = document.createElement('div');
            div.style.cssText = 'background:white; padding:10px; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.05); border-left:4px solid #ffc107; position: relative;';
            div.innerHTML = `
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                ${item.image_url ? `<img src="${item.image_url}" style="width:30px; height:30px; object-fit:contain;">` : '<span style="font-size:1.5rem;">🎒</span>'}
                <div style="font-weight:bold; font-size:1rem;">${item.name}</div>
              </div>
              <div style="font-size:0.85rem; color:#666; margin-bottom:8px;">${item.description || '無描述'}</div>
              <div style="display:flex; gap:5px; justify-content:flex-end;">
                  <button class="btn-grant-item" data-id="${item.id}" style="padding:2px 8px; font-size:0.8rem; border-radius:4px; background:#28a745; color:white; border:none; cursor:pointer;" title="發放給玩家">🎁 發放</button>
                  <button class="btn-edit-item" data-id="${item.id}" style="padding:2px 8px; font-size:0.8rem; border-radius:4px; background:#007bff; color:white; border:none; cursor:pointer;" title="編輯道具">✏️</button>
                  <button class="btn-delete-item" data-id="${item.id}" style="padding:2px 8px; font-size:0.8rem; border-radius:4px; background:#dc3545; color:white; border:none; cursor:pointer;" title="刪除道具">🗑️</button>
              </div>
            `;
            list.appendChild(div);
          }
        });

        // 綁定道具按鈕事件
        setupItemButtons();
      }
    });
}

function setupItemButtons() {
  // 刪除道具
  document.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!confirm('確定要刪除這個道具嗎？\n注意：如果該道具被任務引用，將無法刪除。')) return;
      fetch(`${API_BASE}/api/items/${this.dataset.id}`, {
        method: 'DELETE',
        headers: { 'x-username': loginUser.username }
      })
      .then(res => res.json())
      .then(resData => {
        if (resData.success) {
          alert('道具已刪除');
          loadItems();
        } else {
          alert(resData.message || '刪除失敗');
        }
      });
    });
  });

  // 編輯道具
  const editItemModal = document.getElementById('editItemModal');
  const editItemForm = document.getElementById('editItemForm');
  const closeEditItemModal = document.getElementById('closeEditItemModal');
  const editItemImageInput = document.getElementById('editItemImageInput');
  const editItemImagePreview = document.getElementById('editItemImagePreview');

  if (editItemModal) {
    if (closeEditItemModal) closeEditItemModal.onclick = () => editItemModal.classList.remove('show');
    
    // 預覽圖片
    if (editItemImageInput) {
      editItemImageInput.onchange = function() {
        const file = this.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = e => {
            editItemImagePreview.src = e.target.result;
            editItemImagePreview.style.display = 'block';
          };
          reader.readAsDataURL(file);
        }
      };
    }

    // 開啟編輯 Modal
    document.querySelectorAll('.btn-edit-item').forEach(btn => {
      btn.onclick = function() {
        const id = this.dataset.id;
        const item = globalItemsMap[id];
        if (!item) return;

        editItemForm.id.value = item.id;
        editItemForm.name.value = item.name;
        editItemForm.description.value = item.description || '';
        editItemForm.image_url.value = item.image_url || '';
        editItemImageInput.value = ''; // 清空檔案選擇
        
        if (item.image_url) {
          editItemImagePreview.src = item.image_url;
          editItemImagePreview.style.display = 'block';
        } else {
          editItemImagePreview.style.display = 'none';
        }

        editItemModal.classList.add('show');
      };
    });

    // 提交編輯
    if (editItemForm) {
      // 避免重複綁定 listener，先移除舊的 (雖然這裡是動態綁定按鈕，但 form 是靜態的，所以還好)
      // 但為了安全，我們可以檢查是否已綁定，或者簡單地讓它覆蓋
      editItemForm.onsubmit = function(e) {
        e.preventDefault();
        const id = this.id.value;
        const fd = new FormData();
        fd.append('name', this.name.value.trim());
        fd.append('description', this.description.value.trim());
        
        // 優先使用上傳的圖片
        if (this.new_image.files[0]) {
          fd.append('image', this.new_image.files[0]);
        } else {
          fd.append('image_url', this.image_url.value.trim());
        }

        fetch(`${API_BASE}/api/items/${id}`, {
          method: 'PUT',
          headers: { 'x-username': loginUser.username },
          body: fd
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert('道具更新成功');
            editItemModal.classList.remove('show');
            loadItems();
          } else {
            alert(data.message || '更新失敗');
          }
        });
      };
    }
  }

  // 發放道具
  const grantItemModal = document.getElementById('grantItemModal');
  const grantItemForm = document.getElementById('grantItemForm');
  const closeGrantItemModal = document.getElementById('closeGrantItemModal');
  const grantItemName = document.getElementById('grantItemName');

  if (grantItemModal) {
    if (closeGrantItemModal) closeGrantItemModal.onclick = () => grantItemModal.classList.remove('show');

    // 開啟發放 Modal
    document.querySelectorAll('.btn-grant-item').forEach(btn => {
      btn.onclick = function() {
        const id = this.dataset.id;
        const item = globalItemsMap[id];
        if (!item) return;

        grantItemForm.reset();
        grantItemForm.item_id.value = item.id;
        grantItemForm.quantity.value = 1;
        grantItemName.textContent = item.name;
        
        grantItemModal.classList.add('show');
      };
    });

    // 提交發放
    if (grantItemForm) {
      grantItemForm.onsubmit = function(e) {
        e.preventDefault();
        const itemId = this.item_id.value;
        const username = this.username.value.trim();
        const quantity = this.quantity.value;

        if (!username) return alert('請輸入玩家帳號');

        fetch(`${API_BASE}/api/admin/grant-item`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-username': loginUser.username 
          },
          body: JSON.stringify({ username, item_id: itemId, quantity })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert(data.message);
            grantItemModal.classList.remove('show');
          } else {
            alert(data.message || '發放失敗');
          }
        });
      };
    }
  }
}

// 道具 Modal 邏輯 (新增)
const btnCreateItem = document.getElementById('btnCreateItem');
const itemModal = document.getElementById('itemModal');
const closeItemModal = document.getElementById('closeItemModal');
const itemImageInput = document.getElementById('itemImageInput');
const itemImagePreview = document.getElementById('itemImagePreview');

if (btnCreateItem && itemModal) {
  btnCreateItem.onclick = () => itemModal.classList.add('show');
  closeItemModal.onclick = () => itemModal.classList.remove('show');
}

if (itemImageInput) {
  itemImageInput.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        itemImagePreview.src = e.target.result;
        itemImagePreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      itemImagePreview.style.display = 'none';
    }
  });
}

const createItemForm = document.getElementById('createItemForm');
if (createItemForm) {
  createItemForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const form = this;
    const fd = new FormData();
    fd.append('name', form.name.value.trim());
    fd.append('description', form.description.value.trim());
    if (form.image.files[0]) {
      fd.append('image', form.image.files[0]);
    }

    fetch(`${API_BASE}/api/items`, {
      method: 'POST',
      headers: { 'x-username': loginUser.username },
      body: fd
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('道具新增成功');
        form.reset();
        itemImagePreview.style.display = 'none';
        itemModal.classList.remove('show');
        loadItems();
      } else {
        alert(data.message || '新增失敗');
      }
    });
  });
}

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
      
      const userRole = data.userRole || loginUser.role;
      
      if (data.tasks.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center;color:#666;padding:20px;">目前沒有任務${userRole === 'staff' ? '（您只能看到自己創建的任務）' : ''}</div>`;
        return;
      }

      // 輔助函式：生成任務卡片 HTML
      const createCardHtml = (task) => {
        // 創建者信息（只有管理員能看到）
        const creatorInfo = (userRole === 'admin' && task.created_by)
          ? `<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.5rem;">👤 ${task.created_by}</div>`
          : '';
        
        // 任務類型與標籤顯示
        let typeText = '問答題';
        if (task.task_type === 'multiple_choice') { typeText = '選擇題'; }
        else if (task.task_type === 'photo') { typeText = '拍照任務'; }
        else if (task.task_type === 'number') { typeText = '數字解謎'; }
        else if (task.task_type === 'keyword') { typeText = '關鍵字解碼'; }
        else if (task.task_type === 'location') { typeText = '地點打卡'; }
        else if (task.task_type === 'number') { typeText = '數字解謎'; }
        else if (task.task_type === 'keyword') { typeText = '關鍵字解碼'; }
        else if (task.task_type === 'location') { typeText = '地點打卡'; }

        // 任務分類標籤 (單題/限時/劇情)
        let categoryTag = '';
        if (task.type === 'quest') {
          categoryTag = `<span style="font-size:0.75rem; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; margin-right:4px;">📚 劇情 (第${task.quest_order}關)</span>`;
        } else if (task.type === 'timed') {
          categoryTag = `<span style="font-size:0.75rem; background:#fef3c7; color:#92400e; padding:2px 6px; border-radius:4px; margin-right:4px;">⏱ 限時</span>`;
        } else {
          categoryTag = `<span style="font-size:0.75rem; background:#f3f4f6; color:#374151; padding:2px 6px; border-radius:4px; margin-right:4px;">📝 單題</span>`;
        }

        // 道具標籤
        let itemTag = '';
        if (task.required_item_id) itemTag += `<span style="font-size:0.75rem; background:#ffebee; color:#dc3545; padding:2px 6px; border-radius:4px;">🔒 需道具</span> `;
        if (task.reward_item_id) itemTag += `<span style="font-size:0.75rem; background:#e8f5e9; color:#28a745; padding:2px 6px; border-radius:4px;">🎁 獎勵道具</span>`;

        return `
          <img src="${task.photoUrl}" class="card-img" alt="任務照片" style="height:160px;" onerror="this.src='/images/mascot.png'">
          <div class="card-body">
            ${creatorInfo}
            <div class="card-title" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px;">
              <div style="font-size:1.1rem; font-weight:bold;">${task.name}</div>
              <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${categoryTag}
                <span style="font-size:0.75rem; background:#f3f4f6; padding:2px 6px; border-radius:4px;">${typeText}</span>
                ${itemTag}
              </div>
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
      };

      // 1. 分組任務
      const otherTasks = [];
      const questGroups = {}; // chainId -> tasks[]

      data.tasks.forEach(task => {
        if (task.type === 'quest' && task.quest_chain_id) {
          if (!questGroups[task.quest_chain_id]) {
            questGroups[task.quest_chain_id] = [];
          }
          questGroups[task.quest_chain_id].push(task);
        } else {
          otherTasks.push(task);
        }
      });

      // 2. 渲染一般任務 (直接放在 Grid 中)
      otherTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = createCardHtml(task);
        container.appendChild(card);
      });

      // 3. 渲染劇情任務群組
      // 將群組按 ID 或標題排序
      const sortedChainIds = Object.keys(questGroups).sort((a, b) => b - a); // 新的在上面?
      
      sortedChainIds.forEach(chainId => {
        const tasks = questGroups[chainId];
        // 依關卡順序排序
        tasks.sort((a, b) => (a.quest_order || 0) - (b.quest_order || 0));
        
        const chainInfo = globalQuestChainsMap[chainId] || { title: `未知劇情 (ID: ${chainId})`, description: '' };
        
        const groupContainer = document.createElement('div');
        groupContainer.style.gridColumn = '1 / -1'; // 佔滿 Grid 整行
        groupContainer.style.marginTop = '10px';
        groupContainer.style.marginBottom = '10px';
        
        const details = document.createElement('details');
        details.innerHTML = `
          <summary style="padding:12px 15px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; cursor:pointer; font-weight:bold; display:flex; justify-content:space-between; align-items:center; outline:none;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.2rem;">📚</span>
              <div>
                <div style="color:#0369a1;">${chainInfo.title}</div>
                <div style="font-size:0.85rem; color:#64748b; font-weight:normal;">共 ${tasks.length} 個關卡 • 全破獎勵 ${chainInfo.chain_points || 0} 分</div>
              </div>
            </div>
            <span style="font-size:0.85rem; color:#0ea5e9;">▼ 展開/收合</span>
          </summary>
          <div class="quest-tasks-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:20px; padding:20px; background:#f8fafc; border:1px solid #e2e8f0; border-top:none; border-radius:0 0 8px 8px;">
            <!-- 任務卡片放這裡 -->
          </div>
        `;
        
        const grid = details.querySelector('.quest-tasks-grid');
        tasks.forEach(task => {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.background = 'white';
          card.style.borderColor = '#e2e8f0';
          card.innerHTML = createCardHtml(task);
          grid.appendChild(card);
        });
        
        groupContainer.appendChild(details);
        container.appendChild(groupContainer);
      });

      // 綁定編輯按鈕事件 (使用事件委派，因為按鈕現在分布在不同層級)
      container.addEventListener('click', function(e) {
        const editBtn = e.target.closest('.editBtn');
        const delBtn = e.target.closest('.delBtn');
        
        if (editBtn) {
          const id = editBtn.dataset.id;
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
              form.ar_image_url.value = t.ar_image_url || '';
              
              // 預覽 AR 圖片
              const arPreview = document.getElementById('editArImagePreview');
              if (t.ar_image_url) {
                arPreview.src = t.ar_image_url;
                arPreview.style.display = '';
              } else {
                arPreview.style.display = 'none';
              }
              document.getElementById('editArImageInput').value = '';

              // 設置任務分類 (Single/Timed/Quest)
              const typeSelect = document.getElementById('editTaskCategorySelect');
              typeSelect.value = t.type || 'single';
              // 觸發 change 事件以更新欄位顯示
              typeSelect.dispatchEvent(new Event('change'));

              // 填入劇情任務欄位
              if (t.type === 'quest') {
                const qSelect = document.getElementById('editQuestChainSelect');
                qSelect.value = t.quest_chain_id || '';
                document.querySelector('#editTaskForm input[name="quest_order"]').value = t.quest_order || 1;
              }

              // 填入限時任務欄位
              if (t.type === 'timed') {
                // 轉換 ISO 時間字串為 datetime-local 格式 (YYYY-MM-DDTHH:mm)
                const formatTime = (isoStr) => isoStr ? new Date(isoStr).toISOString().slice(0, 16) : '';
                document.querySelector('#editTaskForm input[name="time_limit_start"]').value = formatTime(t.time_limit_start);
                document.querySelector('#editTaskForm input[name="time_limit_end"]').value = formatTime(t.time_limit_end);
                document.querySelector('#editTaskForm input[name="max_participants"]').value = t.max_participants || 0;
              }
              
              // 填入道具欄位
              document.getElementById('editRequiredItemSelect').value = t.required_item_id || '';
              document.getElementById('editRewardItemSelect').value = t.reward_item_id || '';

              // 設置任務類型與選項
              form.task_type.value = t.task_type || 'qa';
              const editOptionsDiv = document.getElementById('editMultipleChoiceOptions');
              const editStandardAnswerDiv = document.getElementById('editStandardAnswerBlock');
              
              editOptionsDiv.style.display = (t.task_type === 'multiple_choice') ? 'block' : 'none';
              editStandardAnswerDiv.style.display = (t.task_type === 'number' || t.task_type === 'keyword') ? 'block' : 'none';
              
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
              } else if (t.task_type === 'number' || t.task_type === 'keyword') {
                form.correct_answer_text.value = t.correct_answer || '';
                // 清空選項
                form.optionA.value = '';
                form.optionB.value = '';
                form.optionC.value = '';
                form.optionD.value = '';
              } else {
                // 清空選項和標準答案
                form.optionA.value = '';
                form.optionB.value = '';
                form.optionC.value = '';
                form.optionD.value = '';
                form.correct_answer_select.value = 'A';
                form.correct_answer_text.value = '';
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
        }
        
        if (delBtn) {
          if (!confirm('確定要刪除這個任務嗎？')) return;
          const id = delBtn.dataset.id;
          fetch(`${API_BASE}/api/tasks/${id}`, { 
            method: 'DELETE',
            headers: { 'x-username': loginUser.username }
          })
            .then(res => res.json())
            .then(data => {
              if (data.success) loadTasks();
              else alert(data.message || '刪除失敗');
            });
        }
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
  const arImageFile = form.arImage?.files[0]; // 選填
  
  // 處理任務分類與額外欄位
  const type = form.type.value;
  const quest_chain_id = form.quest_chain_id?.value || null;
  const quest_order = form.quest_order?.value || null;
  const time_limit_start = form.time_limit_start?.value || null;
  const time_limit_end = form.time_limit_end?.value || null;
  const max_participants = form.max_participants?.value || null;
  // 道具欄位
  const required_item_id = form.required_item_id?.value || null;
  const reward_item_id = form.reward_item_id?.value || null;

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
  } else if (task_type === 'number' || task_type === 'keyword') {
    correct_answer = form.correct_answer_text.value.trim();
    if (!correct_answer) {
      document.getElementById('addTaskMsg').textContent = '請輸入標準答案';
      return;
    }
  }

  document.getElementById('addTaskMsg').textContent = '';
  if (!photoFile) {
    document.getElementById('addTaskMsg').textContent = '請選擇任務照片';
    return;
  }
  
  // 客戶端檢查檔案大小
  if (photoFile.size > 5 * 1024 * 1024) {
    document.getElementById('addTaskMsg').textContent = '檔案大小超過 5MB 限制';
    return;
  }

  // 客戶端檢查檔案類型
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(photoFile.type)) {
    document.getElementById('addTaskMsg').textContent = '不支援的檔案類型。只允許 JPG、PNG、GIF、WebP';
    return;
  }

  try {
    // 1. 上傳圖片
    const fd = new FormData();
    fd.append('photo', photoFile);
    
    document.getElementById('addTaskMsg').textContent = '圖片上傳中...';
    
    const uploadRes = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'x-username': loginUser.username },
      body: fd,
      credentials: 'include' // 確保發送 cookies (JWT)
    });
    
    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      console.error('圖片上傳失敗:', uploadData);
      document.getElementById('addTaskMsg').textContent = uploadData.message || '圖片上傳失敗';
      return;
    }
    
    // 2. 上傳 AR 圖片（如果有）
    let arImageUrl = null;
    if (arImageFile) {
      document.getElementById('addTaskMsg').textContent = 'AR 圖片上傳中...';
      const arFd = new FormData();
      arFd.append('photo', arImageFile);
      const arUploadRes = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { 'x-username': loginUser.username },
        body: arFd,
        credentials: 'include'
      });
      const arUploadData = await arUploadRes.json();
      if (arUploadData.success) {
        arImageUrl = arUploadData.url;
      } else {
        document.getElementById('addTaskMsg').textContent = 'AR 圖片上傳失敗: ' + (arUploadData.message || '未知錯誤');
        return;
      }
    }
    
    // 3. 新增任務
    document.getElementById('addTaskMsg').textContent = '任務建立中...';
    const photoUrl = uploadData.url;
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-username': loginUser.username
      },
      body: JSON.stringify({ 
        name, lat, lng, radius, points, description, photoUrl, youtubeUrl, ar_image_url: arImageUrl, 
        task_type, options, correct_answer,
        type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants
      })
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
document.getElementById('editTaskForm').addEventListener('submit', async function(e) {
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
  let arImageUrl = form.ar_image_url.value.trim() || null;
  const editArImageFile = form.editArImage?.files[0]; // 選填
  
  // 處理任務分類與額外欄位
  const type = document.getElementById('editTaskCategorySelect').value;
  const quest_chain_id = document.getElementById('editQuestChainSelect').value || null;
  const quest_order = form.quest_order?.value || null;
  const time_limit_start = form.time_limit_start?.value || null;
  const time_limit_end = form.time_limit_end?.value || null;
  const max_participants = form.max_participants?.value || null;
  // 道具欄位
  const required_item_id = document.getElementById('editRequiredItemSelect').value || null;
  const reward_item_id = document.getElementById('editRewardItemSelect').value || null;

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
  } else if (task_type === 'number' || task_type === 'keyword') {
    correct_answer = form.correct_answer_text.value.trim();
    if (!correct_answer) {
      document.getElementById('editTaskMsg').textContent = '請輸入標準答案';
      return;
    }
    options = null; // 確保 options 為 null
  } else {
    // 如果不是選擇題或自動驗證題，確保 options 和 correct_answer 為 null
    options = null;
    correct_answer = null;
  }

  document.getElementById('editTaskMsg').textContent = '更新中...';
  
  // 如果有上傳新的 AR 圖片，先上傳
  (async () => {
    if (editArImageFile) {
      try {
        const arFd = new FormData();
        arFd.append('photo', editArImageFile);
        const arUploadRes = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          headers: { 'x-username': loginUser.username },
          body: arFd,
          credentials: 'include'
        });
        const arUploadData = await arUploadRes.json();
        if (arUploadData.success) {
          arImageUrl = arUploadData.url;
        } else {
          document.getElementById('editTaskMsg').textContent = 'AR 圖片上傳失敗: ' + (arUploadData.message || '未知錯誤');
          return;
        }
      } catch (err) {
        document.getElementById('editTaskMsg').textContent = 'AR 圖片上傳錯誤';
        return;
      }
    }
    
    // 更新任務
    fetch(`${API_BASE}/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-username': loginUser.username },
      body: JSON.stringify({ 
        name, lat, lng, radius, points, description, photoUrl, youtubeUrl, ar_image_url: arImageUrl, 
        task_type, options, correct_answer,
        type, quest_chain_id, quest_order, time_limit_start, time_limit_end, max_participants
      })
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
    })
    .catch(err => {
      console.error(err);
      document.getElementById('editTaskMsg').textContent = '更新失敗';
    });
  })();
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
