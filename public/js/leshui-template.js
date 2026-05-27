(function () {
  'use strict';

  const template = {
    title: '樂水部落有機米食農體驗',
    description: '從稻田入口出發，沿著水圳、生態、稻穗、日曬與碾米的路線走到餐桌，認識樂水有機米與支持部落農產的行動。',
    badgeName: '樂水有機米小達人',
    badgeImageUrl: '/images/leshui-completion-badge.svg',
    coverUrl: '/images/leshui-quest-cover.svg',
    cardImageUrl: '/images/leshui-learning-card.svg',
    tasks: [
      {
        order: 1,
        location: '樂水有機米入口',
        name: '第 1 關｜找到有機米的家',
        card: '有機米產地學習卡',
        description: '你的有機米旅程從稻田入口開始。請觀察周圍的田地、水源、土壤、山林與田埂生態。題目：下列哪一組都是與有機米生產密切相關的自然環境元素？',
        options: [
          '水源、土壤、田埂生物',
          '柏油路、汽車、路燈',
          '電視、冷氣、冰箱',
          '招牌、插座、手機'
        ],
        answer: '水源、土壤、田埂生物'
      },
      {
        order: 2,
        location: '稻米成長步道',
        name: '第 2 關｜一粒米的生命旅程',
        card: '稻米生命學習卡',
        description: '一粒米從種子到餐桌，需要經歷農民長時間的照顧。題目：下列哪一個順序正確描述了稻米從田間到碗中的生產歷程？',
        options: [
          '育苗 → 插秧 → 分蘗 → 抽穗 → 成熟 → 收割 → 乾燥 → 碾米',
          '插秧 → 育苗 → 收割 → 抽穗 → 成熟 → 分蘗 → 碾米 → 乾燥',
          '育苗 → 抽穗 → 插秧 → 成熟 → 分蘗 → 乾燥 → 收割 → 碾米',
          '收割 → 育苗 → 插秧 → 碾米 → 抽穗 → 分蘗 → 乾燥 → 成熟'
        ],
        answer: '育苗 → 插秧 → 分蘗 → 抽穗 → 成熟 → 收割 → 乾燥 → 碾米'
      },
      {
        order: 3,
        location: '有機農法觀察點',
        name: '第 3 關｜有機田裡不能做什麼',
        card: '有機農法學習卡',
        description: '有機栽培重視土地健康、水源保護與田間生態平衡。題目：下列哪一項行為不符合有機栽培精神？',
        options: [
          '使用化學農藥快速消滅田間昆蟲',
          '保護灌溉水源，避免污染',
          '保留田埂生物的棲息空間',
          '以友善環境方式管理田間'
        ],
        answer: '使用化學農藥快速消滅田間昆蟲'
      },
      {
        order: 4,
        location: '田埂生態區',
        name: '第 4 關｜稻田小偵探',
        card: '稻田生態學習卡',
        description: '請在田埂附近找找蜻蜓、青蛙、蜘蛛、鳥類或其他生態痕跡。題目：田間觀察到多種生物活動，最可能代表什麼意義？',
        options: [
          '田間具有生物多樣性與一定生態活力',
          '稻田一定無法生產稻米',
          '水圳已經完全乾涸',
          '農作物立刻就能收成'
        ],
        answer: '田間具有生物多樣性與一定生態活力'
      },
      {
        order: 5,
        location: '水圳灌溉點',
        name: '第 5 關｜水從哪裡來',
        card: '水源守護學習卡',
        description: '請觀察水圳的水流方向以及水如何接近田區。題目：灌溉水圳對稻田最重要的幫助是什麼？',
        options: [
          '供應稻子生長所需水分並維持田間濕潤',
          '讓稻穀在田裡直接變成白米',
          '將所有田間生物完全隔離',
          '取代收割與碾米的工作'
        ],
        answer: '供應稻子生長所需水分並維持田間濕潤'
      },
      {
        order: 6,
        location: '稻穗觀察區',
        name: '第 6 關｜稻穗成熟判斷員',
        card: '稻穗成熟學習卡',
        description: '開啟 AR 可查看稻米生長階段比較圖，再觀察現場稻穗。題目：若稻穗多已轉為金黃、穀粒飽滿且因重量自然低垂，最可能屬於哪個階段？',
        options: [
          '幼苗期',
          '生長期',
          '抽穗期',
          '成熟期'
        ],
        answer: '成熟期',
        arImageUrl: '/images/leshui-rice-growth-guide.svg'
      },
      {
        order: 7,
        location: '日曬米產區',
        name: '第 7 關｜陽光與米香的秘密',
        card: '日曬米學習卡',
        description: '稻穀收成後必須妥善乾燥，才能維持保存品質。題目：下列哪一組條件最有助於稻穀乾燥？',
        options: [
          '陽光、通風與適時翻動',
          '大雨、積水與厚厚堆放',
          '高濕度、完全不通風',
          '浸泡在水中並遮住陽光'
        ],
        answer: '陽光、通風與適時翻動'
      },
      {
        order: 8,
        location: '碾米展示區',
        name: '第 8 關｜從稻穀到白米',
        card: '碾米知識學習卡',
        description: '請觀察稻殼、米糠、糙米與白米的展示內容。題目：稻穀去掉外層稻殼後，首先會成為什麼？',
        options: [
          '糙米',
          '白飯',
          '麵粉',
          '稻苗'
        ],
        answer: '糙米'
      },
      {
        order: 9,
        location: '品米體驗區',
        name: '第 9 關｜米香味覺任務',
        card: '樂水米風味學習卡',
        description: '請慢慢品嘗樂水有機米飯，感受它入口後的特色。題目：品米時，哪一組最適合用來描述米飯風味與口感？',
        options: [
          '香氣、黏性、甜味與咀嚼口感',
          '招牌顏色、桌子高度與燈光',
          '車流聲、路面寬度與手機訊號',
          '包裝條碼、店門方向與座位數'
        ],
        answer: '香氣、黏性、甜味與咀嚼口感'
      },
      {
        order: 10,
        location: 'LeLeLand 樂樂園終點站',
        name: '第 10 關｜有機米旅程的慶典',
        card: '有機米旅程完成卡',
        taskType: 'keyword',
        description: '恭喜走到旅程終點！請想一想你想用樂水有機米做成什麼料理，和同行夥伴分享料理名稱與一句介紹。完成分享後，請輸入終點通關語「支持樂水有機米」，領取完成獎勵。',
        answer: '支持樂水有機米'
      }
    ]
  };

  const openButton = document.getElementById('btnCreateLeShuiTemplate');
  const modal = document.getElementById('leshuiTemplateModal');
  const closeButton = document.getElementById('closeLeShuiTemplateModal');
  const form = document.getElementById('leshuiTemplateForm');
  const locationRows = document.getElementById('leshuiLocationRows');
  const message = document.getElementById('leshuiTemplateMsg');
  const submitButton = document.getElementById('leshuiTemplateSubmit');

  if (!openButton || !modal || !form || !locationRows) return;

  function setMessage(text, color) {
    message.textContent = text;
    message.style.color = color || '#1d4ed8';
  }

  function renderLocationRows() {
    if (locationRows.children.length) return;

    template.tasks.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'leshui-location-row';

      const title = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${task.order}. ${task.location}`;
      const detail = document.createElement('small');
      detail.textContent = task.name.replace(/^第 \d+ 關｜/, '');
      title.appendChild(strong);
      title.appendChild(detail);

      const lat = document.createElement('input');
      lat.className = 'form-input';
      lat.type = 'number';
      lat.step = 'any';
      lat.placeholder = '緯度，例如 24.678222';
      lat.dataset.field = 'lat';
      lat.dataset.order = String(task.order);
      lat.required = true;

      const lng = document.createElement('input');
      lng.className = 'form-input';
      lng.type = 'number';
      lng.step = 'any';
      lng.placeholder = '經度，例如 121.760361';
      lng.dataset.field = 'lng';
      lng.dataset.order = String(task.order);
      lng.required = true;

      row.appendChild(title);
      row.appendChild(lat);
      row.appendChild(lng);
      locationRows.appendChild(row);
    });
  }

  function headers(contentType) {
    const result = { 'x-username': window.loginUser.username };
    if (contentType) result['Content-Type'] = contentType;
    return result;
  }

  async function requestJson(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error('伺服器回傳格式錯誤');
    }
    if (!response.ok || !data.success) {
      throw new Error(data.message || `請求失敗 (HTTP ${response.status})`);
    }
    return data;
  }

  async function ensureQuestChain(chainPoints) {
    let data = await requestJson('/api/quest-chains', { headers: headers() });
    let chain = data.questChains.find((entry) => entry.title === template.title);
    if (chain) return chain;

    const fields = new FormData();
    fields.append('title', template.title);
    fields.append('description', template.description);
    fields.append('chain_points', String(chainPoints));
    fields.append('badge_name', template.badgeName);
    fields.append('badge_image_url', template.badgeImageUrl);
    await requestJson('/api/quest-chains', {
      method: 'POST',
      headers: headers(),
      body: fields
    });

    data = await requestJson('/api/quest-chains', { headers: headers() });
    chain = data.questChains.find((entry) => entry.title === template.title);
    if (!chain) throw new Error('劇情建立後無法取得資料');
    return chain;
  }

  async function ensureLearningCards() {
    const existing = await requestJson('/api/items', { headers: headers() });
    const knownNames = new Set(existing.items.map((item) => item.name));

    for (const task of template.tasks) {
      if (knownNames.has(task.card)) continue;
      setMessage(`建立學習卡：${task.card}...`);
      const fields = new FormData();
      fields.append('name', task.card);
      fields.append('description', `完成「${task.name}」後獲得的樂水食農體驗學習卡。`);
      fields.append('image_url', template.cardImageUrl);
      await requestJson('/api/items', {
        method: 'POST',
        headers: headers(),
        body: fields
      });
      knownNames.add(task.card);
    }

    const updated = await requestJson('/api/items', { headers: headers() });
    return new Map(updated.items.map((item) => [item.name, item.id]));
  }

  function readLocations() {
    return template.tasks.map((task) => {
      const latValue = form.querySelector(`[data-order="${task.order}"][data-field="lat"]`).value.trim();
      const lngValue = form.querySelector(`[data-order="${task.order}"][data-field="lng"]`).value.trim();
      const lat = Number(latValue);
      const lng = Number(lngValue);
      if (!latValue || !lngValue || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error(`請填寫第 ${task.order} 關「${task.location}」的 GPS 座標`);
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new Error(`第 ${task.order} 關的 GPS 座標超出有效範圍`);
      }
      return { lat, lng };
    });
  }

  async function createMissingTasks(chain, itemIds, locations, points, radius) {
    const adminTasks = await requestJson('/api/tasks/admin', { headers: headers() });
    const existingOrders = new Set(
      adminTasks.tasks
        .filter((task) => Number(task.quest_chain_id) === Number(chain.id))
        .map((task) => Number(task.quest_order))
    );
    let createdCount = 0;

    for (const task of template.tasks) {
      if (existingOrders.has(task.order)) continue;
      setMessage(`建立任務：第 ${task.order} 關 / ${template.tasks.length}...`);
      const location = locations[task.order - 1];
      await requestJson('/api/tasks', {
        method: 'POST',
        headers: headers('application/json'),
        body: JSON.stringify({
          name: task.name,
          lat: location.lat,
          lng: location.lng,
          radius,
          description: task.description,
          photoUrl: template.coverUrl,
          points,
          task_type: task.taskType || 'multiple_choice',
          options: task.options || null,
          correct_answer: task.answer,
          type: 'quest',
          quest_chain_id: chain.id,
          quest_order: task.order,
          is_final_step: task.order === template.tasks.length,
          reward_item_id: itemIds.get(task.card) || null,
          ar_image_url: task.arImageUrl || null,
          ar_order_image: task.arImageUrl ? 1 : null
        })
      });
      createdCount += 1;
    }

    return createdCount;
  }

  openButton.addEventListener('click', () => {
    renderLocationRows();
    setMessage('');
    modal.classList.add('show');
  });

  if (closeButton) {
    closeButton.addEventListener('click', () => modal.classList.remove('show'));
  }

  modal.querySelector('.task-modal-overlay').addEventListener('click', () => {
    modal.classList.remove('show');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    let locations;
    try {
      locations = readLocations();
    } catch (err) {
      setMessage(err.message, '#dc2626');
      return;
    }

    const points = Number(document.getElementById('leshuiPoints').value);
    const chainPoints = Number(document.getElementById('leshuiChainPoints').value);
    const radius = Number(document.getElementById('leshuiRadius').value);
    if (!Number.isFinite(points) || !Number.isFinite(chainPoints) || !Number.isFinite(radius) || radius < 5) {
      setMessage('請確認積分與觸發半徑設定正確', '#dc2626');
      return;
    }
    if (!window.confirm('確定要建立樂水部落 10 關活動嗎？建立後仍可逐關編輯座標、圖片與題目。')) return;

    submitButton.disabled = true;
    try {
      setMessage('建立劇情任務線...');
      const chain = await ensureQuestChain(chainPoints);
      const itemIds = await ensureLearningCards();
      const createdCount = await createMissingTasks(chain, itemIds, locations, points, radius);

      if (typeof loadQuestChains === 'function') await loadQuestChains();
      if (typeof loadItems === 'function') await loadItems();
      if (typeof loadTasks === 'function') loadTasks();

      if (createdCount === 0) {
        setMessage('此活動的 10 關已存在；需要調整 GPS 時，請使用下方任務卡片的編輯功能。', '#166534');
      } else {
        setMessage(`建立完成！已新增 ${createdCount} 關；活動已可使用，之後仍可替換現場照片。`, '#166534');
      }
    } catch (err) {
      console.error('建立樂水活動範本失敗:', err);
      setMessage(`建立中斷：${err.message}。保留已完成內容，再按一次即可補建未完成關卡。`, '#dc2626');
    } finally {
      submitButton.disabled = false;
    }
  });
})();
