(function () {
  'use strict';

  const API_BASE = '';
  const POLL_MS = 8000;
  const STATUS_LABELS = { pending: '待處理', handling: '處理中', resolved: '已結案' };

  let events = [];
  let selectedId = null;
  let lastSeenMaxId = 0;
  let map = null;
  let markersLayer = null;
  let pollTimer = null;

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-username': window.loginUser.username };
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(`${API_BASE}${url}`, {
      credentials: 'include',
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || '請求失敗');
    return data;
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-TW');
  }

  function createMarkerIcon(label) {
    return L.divIcon({
      className: 'sos-marker-wrap',
      html: `<div class="sos-marker-icon">${label}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function initMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('sosMap').setView([24.599, 121.529], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    const bounds = [];
    events.forEach((event) => {
      if (event.lat == null || event.lng == null) return;
      const marker = L.marker([event.lat, event.lng], {
        icon: createMarkerIcon('!')
      });
      marker.bindTooltip(`#${event.id} ${event.username}`, { direction: 'top' });
      marker.on('click', () => selectEvent(event.id));
      marker.addTo(markersLayer);
      bounds.push([event.lat, event.lng]);
    });
    if (selectedId) {
      const selected = events.find((event) => Number(event.id) === Number(selectedId));
      if (selected?.lat != null && selected?.lng != null) {
        map.setView([selected.lat, selected.lng], Math.max(map.getZoom(), 16));
      }
    } else if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }

  function renderList() {
    const listEl = document.getElementById('sosEventList');
    if (!listEl) return;
    if (!events.length) {
      listEl.innerHTML = '<div class="sos-empty">目前沒有 SOS 事件</div>';
      return;
    }
    listEl.innerHTML = events.map((event) => {
      const isNew = !!event._isNew;
      const loc = event.lat != null && event.lng != null
        ? `${Number(event.lat).toFixed(5)}, ${Number(event.lng).toFixed(5)}`
        : '位置未知';
      return `
        <article class="sos-event-item ${selectedId === event.id ? 'active' : ''} ${isNew ? 'is-new' : ''}" data-event-id="${event.id}">
          <div class="sos-event-top">
            <span class="sos-event-id">SOS #${event.id}</span>
            <span class="sos-event-status ${event.status}">${STATUS_LABELS[event.status] || event.status}</span>
          </div>
          <div class="sos-event-meta">
            <div>🕐 ${formatTime(event.created_at)}</div>
            <div>👤 ${escapeHtml(event.username)}</div>
            <div>📍 ${loc} (${event.location_status || 'unknown'})</div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderDetail(event) {
    const card = document.getElementById('sosDetailCard');
    const body = document.getElementById('sosDetailBody');
    const notes = document.getElementById('sosAdminNotes');
    if (!card || !body || !event) {
      card?.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    document.getElementById('sosDetailTitle').textContent = `SOS #${event.id}`;
    const contacts = (event.emergency_contacts_snapshot || [])
      .map((c) => `${escapeHtml(c.name || '聯絡人')} ${escapeHtml(c.phone)}`)
      .join('<br>') || '（玩家未填寫）';
    body.innerHTML = `
      <div class="sos-event-meta">
        <div>玩家：${escapeHtml(event.username)}</div>
        <div>時間：${formatTime(event.created_at)}</div>
        <div>座標：${event.lat != null ? `${event.lat}, ${event.lng}` : '未知'}</div>
        <div>定位：${escapeHtml(event.location_status)}${event.location_accuracy ? ` · ±${Math.round(event.location_accuracy)}m` : ''}</div>
        <div>玩家緊急聯絡人：<br>${contacts}</div>
        ${event.admin_notes ? `<div>備註：${escapeHtml(event.admin_notes)}</div>` : ''}
      </div>
    `;
    notes.value = event.admin_notes || '';
  }

  function selectEvent(id) {
    selectedId = Number(id);
    renderList();
    const event = events.find((item) => Number(item.id) === Number(selectedId));
    renderDetail(event);
    renderMapMarkers();
  }

  async function loadEvents() {
    const status = document.getElementById('sosStatusFilter')?.value || '';
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await fetchJson(`/api/admin/safety/sos-events${query}`);
    const incoming = data.events || [];
    const prevMaxId = lastSeenMaxId;
    const maxIncomingId = incoming.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0);
    events = incoming.map((event) => ({
      ...event,
      _isNew: prevMaxId > 0 && Number(event.id) > prevMaxId
    }));
    lastSeenMaxId = Math.max(lastSeenMaxId, maxIncomingId);
    renderList();
    renderMapMarkers();
    if (selectedId) {
      const selected = events.find((event) => Number(event.id) === Number(selectedId));
      renderDetail(selected || null);
    }
    document.getElementById('sosPollStatus').textContent = `已更新 ${new Date().toLocaleTimeString('zh-TW')}`;
  }

  async function updateStatus(status) {
    if (!selectedId) return;
    await fetchJson(`/api/admin/safety/sos-events/${selectedId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        admin_notes: document.getElementById('sosAdminNotes')?.value.trim() || null
      })
    });
    await loadEvents();
  }

  function bindEvents() {
    document.getElementById('sosStatusFilter')?.addEventListener('change', () => {
      selectedId = null;
      loadEvents().catch(showError);
    });
    document.getElementById('sosRefreshBtn')?.addEventListener('click', () => loadEvents().catch(showError));
    document.getElementById('sosEventList')?.addEventListener('click', (e) => {
      const id = e.target.closest('[data-event-id]')?.dataset.eventId;
      if (id) selectEvent(id);
    });
    document.querySelectorAll('[data-set-status]').forEach((btn) => {
      btn.addEventListener('click', () => updateStatus(btn.dataset.setStatus).catch(showError));
    });
    document.getElementById('sosSaveNotesBtn')?.addEventListener('click', () => {
      if (!selectedId) return;
      fetchJson(`/api/admin/safety/sos-events/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ admin_notes: document.getElementById('sosAdminNotes').value.trim() })
      }).then(loadEvents).catch(showError);
    });
  }

  function showError(err) {
    document.getElementById('sosPollStatus').textContent = err.message || '載入失敗';
    document.getElementById('sosPollStatus').style.color = '#fca5a5';
  }

  async function init() {
    window.loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
    if (!window.loginUser || window.loginUser.role !== 'admin') {
      alert('僅限管理員使用');
      window.location.href = '/login.html';
      return;
    }
    initMap();
    bindEvents();
    await loadEvents();
    pollTimer = setInterval(() => loadEvents().catch(() => {}), POLL_MS);
  }

  init().catch(showError);
})();
