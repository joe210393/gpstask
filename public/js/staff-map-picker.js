(function () {
  'use strict';

  const DEFAULT_CENTER = [24.757, 121.753];
  const DEFAULT_ZOOM = 16;
  const QUEST_STEP_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6'
  ];

  function parseCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getStepColor(order) {
    const index = Math.max(0, (Number(order) || 1) - 1) % QUEST_STEP_COLORS.length;
    return QUEST_STEP_COLORS[index];
  }

  function createStepIcon(order, color, isActive) {
    const label = Number(order) || '?';
    return L.divIcon({
      className: 'sd-quest-step-marker-wrap',
      html: `<div class="sd-quest-step-badge${isActive ? ' active' : ''}" style="--step-color:${color}">${label}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  async function ensureAdminTasks() {
    if (Array.isArray(window.staffAdminTasks)) return window.staffAdminTasks;
    if (!window.loginUser?.username) return [];
    try {
      const res = await fetch('/api/tasks/admin', {
        credentials: 'include',
        headers: { 'x-username': window.loginUser.username }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        window.staffAdminTasks = data.tasks;
        return data.tasks;
      }
    } catch (err) {
      console.warn('載入劇情任務資料失敗:', err);
    }
    return [];
  }

  function getChainTasks(chainId) {
    return (window.staffAdminTasks || [])
      .filter((task) => task.type === 'quest' && Number(task.quest_chain_id) === Number(chainId))
      .sort((a, b) => (Number(a.quest_order) || 0) - (Number(b.quest_order) || 0));
  }

  function buildTaskUpdatePayload(task, overrides = {}) {
    const merged = { ...task, ...overrides };
    let options = merged.options;
    if (typeof options === 'string') {
      try { options = JSON.parse(options); } catch { options = null; }
    }
    return {
      name: merged.name,
      lat: merged.lat,
      lng: merged.lng,
      radius: merged.radius,
      description: merged.description,
      photoUrl: merged.photoUrl,
      points: merged.points || 0,
      task_type: merged.task_type || 'qa',
      options,
      correct_answer: merged.correct_answer,
      type: merged.type || 'single',
      quest_chain_id: merged.quest_chain_id,
      quest_order: merged.quest_order,
      time_limit_start: merged.time_limit_start,
      time_limit_end: merged.time_limit_end,
      max_participants: merged.max_participants,
      required_item_id: merged.required_item_id,
      reward_item_id: merged.reward_item_id,
      is_final_step: merged.is_final_step,
      ar_model_id: merged.ar_model_id,
      ar_order_model: merged.ar_order_model,
      ar_order_image: merged.ar_order_image,
      ar_order_youtube: merged.ar_order_youtube,
      youtubeUrl: merged.youtubeUrl,
      ar_image_url: merged.ar_image_url,
      bgm_url: merged.bgm_url
    };
  }

  function createPicker(options) {
    const mapEl = typeof options.mapEl === 'string'
      ? document.getElementById(options.mapEl)
      : options.mapEl;
    const latInput = options.latInput;
    const lngInput = options.lngInput;
    const radiusInput = options.radiusInput || null;
    const locateBtn = options.locateBtn || null;
    const legendEl = options.legendEl
      ? (typeof options.legendEl === 'string' ? document.getElementById(options.legendEl) : options.legendEl)
      : null;
    const toolbarHintEl = options.toolbarHintEl
      ? (typeof options.toolbarHintEl === 'string' ? document.getElementById(options.toolbarHintEl) : options.toolbarHintEl)
      : null;
    const getQuestContext = options.getQuestContext || (() => ({}));

    let map = null;
    let marker = null;
    let circle = null;
    let questLayer = null;
    let syncing = false;
    let initialized = false;
    let questStatusTimer = null;
    const defaultIcon = typeof L !== 'undefined' ? new L.Icon.Default() : null;

    function setToolbarHint(text) {
      if (toolbarHintEl) toolbarHintEl.textContent = text;
    }

    function setLegend(html, visible) {
      if (!legendEl) return;
      legendEl.innerHTML = html;
      legendEl.classList.toggle('hidden', !visible);
    }

    function setQuestStatus(message, isError) {
      if (!legendEl) return;
      const status = legendEl.querySelector('.sd-quest-status');
      if (!status) return;
      status.textContent = message || '';
      status.classList.toggle('error', !!isError);
      if (questStatusTimer) clearTimeout(questStatusTimer);
      if (message) {
        questStatusTimer = setTimeout(() => {
          status.textContent = '';
          status.classList.remove('error');
        }, 3200);
      }
    }

    function updateCircle(lat, lng) {
      if (!map) return;
      if (circle) {
        map.removeLayer(circle);
        circle = null;
      }
      const radius = radiusInput ? parseCoord(radiusInput.value) : null;
      if (!radius || radius <= 0) return;
      circle = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.14,
        weight: 2
      }).addTo(map);
    }

    function applyMainMarkerIcon(order, questMode) {
      if (!marker) return;
      if (questMode && order) {
        marker.setIcon(createStepIcon(order, getStepColor(order), true));
      } else if (defaultIcon) {
        marker.setIcon(defaultIcon);
      }
    }

    function setMarkerPosition(lat, lng, opts = {}) {
      if (!map || !marker) return;
      const { updateFields = true, pan = true, refreshQuest = true } = opts;
      marker.setLatLng([lat, lng]);
      if (updateFields) {
        syncing = true;
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
        syncing = false;
      }
      updateCircle(lat, lng);
      if (pan) map.panTo([lat, lng], { animate: false });
      if (refreshQuest) updateQuestMarkers();
    }

    function onInputChange() {
      if (syncing || !map || !marker) return;
      const lat = parseCoord(latInput.value);
      const lng = parseCoord(lngInput.value);
      if (lat === null || lng === null) return;
      setMarkerPosition(lat, lng, { updateFields: false, pan: true, refreshQuest: true });
    }

    function onRadiusChange() {
      if (!map || !marker) return;
      const pos = marker.getLatLng();
      updateCircle(pos.lat, pos.lng);
    }

    function isCurrentStep(task, ctx) {
      if (ctx.taskId && Number(task.id) === Number(ctx.taskId)) return true;
      if (!ctx.taskId && ctx.order && Number(task.quest_order) === Number(ctx.order)) return true;
      return false;
    }

    async function saveTaskLocation(task, lat, lng) {
      const payload = buildTaskUpdatePayload(task, { lat, lng });
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-username': window.loginUser?.username || ''
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '更新失敗');
      }
      Object.assign(task, { lat, lng });
      if (Array.isArray(window.staffAdminTasks)) {
        const idx = window.staffAdminTasks.findIndex((entry) => Number(entry.id) === Number(task.id));
        if (idx >= 0) window.staffAdminTasks[idx] = { ...window.staffAdminTasks[idx], lat, lng };
      }
    }

    async function updateQuestMarkers() {
      if (!map) return;
      const ctx = getQuestContext();
      const questMode = ctx.type === 'quest' && ctx.chainId;
      const currentOrder = ctx.order || null;

      applyMainMarkerIcon(currentOrder, questMode);
      setToolbarHint(
        questMode
          ? '劇情路線模式：彩色數字為各關位置；目前關卡可拖曳，其他關卡拖曳後會自動儲存'
          : '拖曳標記或點擊地圖設定 GPS'
      );

      if (questLayer) {
        map.removeLayer(questLayer);
        questLayer = null;
      }

      if (!questMode) {
        setLegend('', false);
        return;
      }

      await ensureAdminTasks();
      const chainTasks = getChainTasks(ctx.chainId);

      const currentLat = parseCoord(latInput.value);
      const currentLng = parseCoord(lngInput.value);

      const routeEntries = chainTasks.map((task) => {
        const order = Number(task.quest_order) || 0;
        const current = isCurrentStep(task, ctx);
        let lat = parseCoord(task.lat);
        let lng = parseCoord(task.lng);
        if (current && currentLat !== null && currentLng !== null) {
          lat = currentLat;
          lng = currentLng;
        }
        return { task, order, lat, lng, current };
      }).filter((entry) => entry.lat !== null && entry.lng !== null);

      if (currentLat !== null && currentLng !== null && ctx.order && !routeEntries.some((entry) => entry.current)) {
        routeEntries.push({
          task: null,
          order: ctx.order,
          lat: currentLat,
          lng: currentLng,
          current: true
        });
      }

      routeEntries.sort((a, b) => a.order - b.order);

      if (routeEntries.length < 2) {
        setLegend('', false);
        return;
      }

      questLayer = L.layerGroup().addTo(map);
      const routePoints = routeEntries.map((entry) => [entry.lat, entry.lng]);
      const bounds = [];

      routeEntries.forEach((entry) => {
        bounds.push([entry.lat, entry.lng]);
        if (entry.current) return;

        const { task, order, lat, lng } = entry;
        const color = getStepColor(order);
        const stepMarker = L.marker([lat, lng], {
          icon: createStepIcon(order, color, false),
          draggable: true
        }).addTo(questLayer);

        stepMarker.bindTooltip(`第 ${order} 關：${task.name}`, { direction: 'top', offset: [0, -16] });
        stepMarker.on('dragend', async () => {
          const pos = stepMarker.getLatLng();
          stepMarker.dragging?.disable();
          setQuestStatus(`正在儲存第 ${order} 關位置...`);
          try {
            await saveTaskLocation(task, pos.lat, pos.lng);
            setQuestStatus(`第 ${order} 關位置已更新`);
            updateQuestMarkers();
          } catch (err) {
            console.warn(err);
            stepMarker.setLatLng([lat, lng]);
            setQuestStatus(err.message || '儲存失敗', true);
          } finally {
            stepMarker.dragging?.enable();
          }
        });
      });

      if (currentLat !== null && currentLng !== null) {
        bounds.push([currentLat, currentLng]);
      }

      if (routePoints.length >= 2) {
        L.polyline(routePoints, {
          color: '#64748b',
          weight: 2,
          dashArray: '7 8',
          opacity: 0.85
        }).addTo(questLayer);
      }

      const legendItems = routeEntries.map((entry) => {
        const order = entry.order;
        const color = getStepColor(order);
        const name = entry.task ? String(entry.task.name || '').replace(/^第 \d+ 關｜/, '') : '（新關卡）';
        return `<span class="sd-quest-legend-item${entry.current ? ' current' : ''}"><i style="background:${color}"></i>第 ${order} 關${entry.current ? '（目前）' : ''}${name ? ` · ${name}` : ''}</span>`;
      }).join('');

      setLegend(
        `<div class="sd-quest-legend-title">劇情路線（共 ${routeEntries.length} 關）</div>
         <div class="sd-quest-legend-items">${legendItems}</div>
         <div class="sd-quest-status"></div>`,
        true
      );

      if (bounds.length >= 2) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], Math.max(map.getZoom(), 16));
      }
    }

    function init() {
      if (initialized || !mapEl || typeof L === 'undefined') return;
      initialized = true;

      const lat = parseCoord(latInput.value);
      const lng = parseCoord(lngInput.value);
      const center = lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER;

      map = L.map(mapEl, { scrollWheelZoom: true }).setView(center, DEFAULT_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      marker = L.marker(center, { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setMarkerPosition(pos.lat, pos.lng);
      });

      map.on('click', (event) => {
        setMarkerPosition(event.latlng.lat, event.latlng.lng);
      });

      latInput.addEventListener('input', onInputChange);
      latInput.addEventListener('change', onInputChange);
      lngInput.addEventListener('input', onInputChange);
      lngInput.addEventListener('change', onInputChange);
      if (radiusInput) {
        radiusInput.addEventListener('input', onRadiusChange);
        radiusInput.addEventListener('change', onRadiusChange);
      }

      if (lat === null || lng === null) {
        setMarkerPosition(center[0], center[1], { refreshQuest: false });
      } else {
        updateCircle(lat, lng);
      }

      updateQuestMarkers();

      if (locateBtn) {
        locateBtn.addEventListener('click', () => {
          locateBtn.disabled = true;
          locateCurrentPosition().finally(() => { locateBtn.disabled = false; });
        });
      }
    }

    function locateCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          alert('此裝置不支援 GPS 定位');
          reject(new Error('unsupported'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!map) init();
            setMarkerPosition(pos.coords.latitude, pos.coords.longitude);
            map.setZoom(Math.max(map.getZoom(), 17));
            resolve();
          },
          (err) => {
            console.warn('GPS 定位失敗:', err);
            alert('無法取得目前位置，請確認已允許定位權限。');
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      });
    }

    return {
      init,
      setLatLng(lat, lng) {
        if (!initialized) init();
        const parsedLat = parseCoord(lat);
        const parsedLng = parseCoord(lng);
        if (parsedLat === null || parsedLng === null) return;
        setMarkerPosition(parsedLat, parsedLng);
      },
      invalidateSize() {
        if (!map) return;
        setTimeout(() => {
          map.invalidateSize();
          updateQuestMarkers();
        }, 80);
      },
      refreshFromInputs() {
        onInputChange();
        updateQuestMarkers();
      },
      updateQuestMarkers
    };
  }

  function readQuestContext(form) {
    if (!form) return {};
    const type = form.elements.type?.value || 'single';
    const chainEl = form.elements.quest_chain_id || form.querySelector('[name="quest_chain_id"]');
    const chainId = chainEl?.value ? Number(chainEl.value) : null;
    const order = form.elements.quest_order?.value ? Number(form.elements.quest_order.value) : null;
    const taskId = form.elements.id?.value ? Number(form.elements.id.value) : null;
    return { type, chainId, order, taskId };
  }

  function bindQuestRefresh(form, picker) {
    if (!form || !picker) return;
    const watched = [
      form.elements.type,
      form.elements.quest_chain_id,
      form.querySelector('#questChainSelect'),
      form.querySelector('#editQuestChainSelect'),
      form.elements.quest_order
    ].filter(Boolean);

    watched.forEach((el) => {
      el.addEventListener('change', () => picker.updateQuestMarkers());
      el.addEventListener('input', () => picker.updateQuestMarkers());
    });
  }

  function initAll() {
    const addForm = document.getElementById('addTaskForm');
    const editForm = document.getElementById('editTaskForm');
    if (!addForm || !editForm || typeof L === 'undefined') return null;

    const pickers = {
      add: createPicker({
        mapEl: 'addTaskMap',
        latInput: addForm.elements.lat,
        lngInput: addForm.elements.lng,
        radiusInput: addForm.elements.radius,
        locateBtn: document.getElementById('addTaskLocateBtn'),
        legendEl: 'addTaskMapLegend',
        toolbarHintEl: 'addTaskMapHint',
        getQuestContext: () => readQuestContext(addForm)
      }),
      edit: createPicker({
        mapEl: 'editTaskMap',
        latInput: editForm.elements.lat,
        lngInput: editForm.elements.lng,
        radiusInput: editForm.elements.radius,
        locateBtn: document.getElementById('editTaskLocateBtn'),
        legendEl: 'editTaskMapLegend',
        toolbarHintEl: 'editTaskMapHint',
        getQuestContext: () => readQuestContext(editForm)
      })
    };

    pickers.add.init();
    bindQuestRefresh(addForm, pickers.add);
    bindQuestRefresh(editForm, pickers.edit);

    const addLocationSection = document.getElementById('addTaskLocationSection');
    if (addLocationSection) {
      addLocationSection.addEventListener('toggle', () => {
        if (addLocationSection.open) pickers.add.invalidateSize();
      });
    }

    const editModal = document.getElementById('editModal');
    if (editModal) {
      const observer = new MutationObserver(() => {
        if (editModal.classList.contains('show')) {
          pickers.edit.init();
          pickers.edit.refreshFromInputs();
          pickers.edit.invalidateSize();
        }
      });
      observer.observe(editModal, { attributes: true, attributeFilter: ['class'] });
    }

    window.staffMapPickers = pickers;
    window.refreshStaffQuestMaps = () => {
      pickers.add.updateQuestMarkers();
      pickers.edit.updateQuestMarkers();
    };
    return pickers;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
