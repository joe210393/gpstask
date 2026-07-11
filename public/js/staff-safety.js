(function () {
  'use strict';

  const API_BASE = '';
  const SUPPLY_CATALOG = {
    medical: ['AED', '急救箱', '輪椅', '冰袋', '生理食鹽水', '繃帶/OK繃', '退燒貼', '專人值守'],
    water: ['飲用水', '一次性水杯', '補充電站'],
    supply: ['毛巾', '防曬用品', '小點心', '簡易地圖', '雨具']
  };
  const TYPE_LABELS = { medical: '🏥 救護站', water: '💧 補水站', supply: '📦 補給站' };

  let facilities = [];
  let facilityMap = null;
  let facilityMarker = null;
  let initialized = false;

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-username': window.loginUser?.username || ''
    };
  }

  function fetchJson(url, options = {}) {
    return fetch(`${API_BASE}${url}`, {
      credentials: 'include',
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || '請求失敗');
      return data;
    });
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadSettings() {
    const data = await fetchJson('/api/admin/safety/settings');
    const form = document.getElementById('safetySettingsForm');
    if (!form) return;
    form.sos_enabled.checked = !!data.settings.sos_enabled;
    form.emergency_phone.value = data.settings.emergency_phone || '';
    form.sos_instructions.value = data.settings.sos_instructions || '';
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.target;
    const msg = document.getElementById('safetySettingsMsg');
    try {
      await fetchJson('/api/admin/safety/settings', {
        method: 'PUT',
        body: JSON.stringify({
          sos_enabled: form.sos_enabled.checked,
          emergency_phone: form.emergency_phone.value.trim(),
          sos_instructions: form.sos_instructions.value.trim()
        })
      });
      msg.textContent = '設定已儲存';
      msg.className = 'sd-safety-msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'sd-safety-msg err';
    }
  }

  function renderFacilities() {
    const container = document.getElementById('safetyFacilityList');
    if (!container) return;
    if (!facilities.length) {
      container.innerHTML = '<div class="sd-safety-empty">尚未建立安全設施，請按「新增設施」</div>';
      return;
    }
    container.innerHTML = facilities.map((item) => {
      const supplies = (item.supplies || []).map((s) => `<span class="sd-safety-tag">${escapeHtml(s)}</span>`).join('');
      return `
        <article class="sd-safety-card">
          <div class="sd-safety-card-head">
            <div>
              <div class="sd-safety-type">${TYPE_LABELS[item.facility_type] || item.facility_type}</div>
              <h4>${escapeHtml(item.name)}</h4>
            </div>
            <div class="sd-safety-card-actions">
              <button type="button" class="btn btn-primary btn-sm" data-edit-facility="${item.id}">編輯</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-facility="${item.id}">刪除</button>
            </div>
          </div>
          <div class="sd-safety-meta">📍 ${item.lat}, ${item.lng}${item.open_hours ? ` · 🕐 ${escapeHtml(item.open_hours)}` : ''}</div>
          ${item.description ? `<p class="sd-safety-desc">${escapeHtml(item.description)}</p>` : ''}
          ${supplies ? `<div class="sd-safety-tags">${supplies}</div>` : ''}
          ${item.notes ? `<div class="sd-safety-note">${escapeHtml(item.notes)}</div>` : ''}
        </article>
      `;
    }).join('');
  }

  async function loadFacilities() {
    const data = await fetchJson('/api/admin/safety/facilities');
    facilities = data.facilities || [];
    renderFacilities();
  }

  function renderSupplyCheckboxes(type, selected) {
    const catalog = SUPPLY_CATALOG[type] || [];
    const selectedSet = new Set(selected || []);
    return catalog.map((label) => `
      <label class="sd-safety-check">
        <input type="checkbox" name="supplies" value="${escapeHtml(label)}" ${selectedSet.has(label) ? 'checked' : ''} />
        <span>${escapeHtml(label)}</span>
      </label>
    `).join('');
  }

  function openFacilityModal(facility) {
    const modal = document.getElementById('safetyFacilityModal');
    const form = document.getElementById('safetyFacilityForm');
    if (!modal || !form) return;
    form.reset();
    form.elements.id.value = facility?.id || '';
    form.elements.facility_type.value = facility?.facility_type || 'medical';
    form.elements.name.value = facility?.name || '';
    form.elements.lat.value = facility?.lat ?? '';
    form.elements.lng.value = facility?.lng ?? '';
    form.elements.description.value = facility?.description || '';
    form.elements.open_hours.value = facility?.open_hours || '';
    form.elements.notes.value = facility?.notes || '';
    form.elements.is_active.checked = facility ? facility.is_active !== false : true;
    form.elements.sort_order.value = facility?.sort_order ?? 0;
    document.getElementById('safetySuppliesBox').innerHTML = renderSupplyCheckboxes(
      form.elements.facility_type.value,
      facility?.supplies || []
    );
    modal.classList.add('show');
    initFacilityMap(parseFloat(form.elements.lat.value), parseFloat(form.elements.lng.value));
    setTimeout(() => facilityMap?.invalidateSize(), 120);
  }

  function closeFacilityModal() {
    document.getElementById('safetyFacilityModal')?.classList.remove('show');
  }

  function initFacilityMap(lat, lng) {
    const mapEl = document.getElementById('safetyFacilityMap');
    const form = document.getElementById('safetyFacilityForm');
    if (!mapEl || !form || typeof L === 'undefined') return;
    const center = Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : [24.599, 121.529];
    if (!facilityMap) {
      facilityMap = L.map(mapEl).setView(center, 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(facilityMap);
      facilityMarker = L.marker(center, { draggable: true }).addTo(facilityMap);
      facilityMarker.on('dragend', () => {
        const pos = facilityMarker.getLatLng();
        form.elements.lat.value = pos.lat.toFixed(6);
        form.elements.lng.value = pos.lng.toFixed(6);
      });
      facilityMap.on('click', (e) => {
        facilityMarker.setLatLng(e.latlng);
        form.elements.lat.value = e.latlng.lat.toFixed(6);
        form.elements.lng.value = e.latlng.lng.toFixed(6);
      });
    } else {
      facilityMap.setView(center, facilityMap.getZoom() || 16);
      facilityMarker.setLatLng(center);
    }
    form.elements.lat.value = center[0].toFixed(6);
    form.elements.lng.value = center[1].toFixed(6);
  }

  async function saveFacility(event) {
    event.preventDefault();
    const form = event.target;
    const msg = document.getElementById('safetyFacilityMsg');
    const supplies = Array.from(form.querySelectorAll('input[name="supplies"]:checked')).map((el) => el.value);
    const payload = {
      facility_type: form.facility_type.value,
      name: form.name.value.trim(),
      lat: Number(form.lat.value),
      lng: Number(form.lng.value),
      description: form.description.value.trim(),
      supplies,
      open_hours: form.open_hours.value.trim(),
      notes: form.notes.value.trim(),
      is_active: form.is_active.checked,
      sort_order: Number(form.sort_order.value) || 0
    };
    try {
      const id = form.id.value;
      if (id) {
        await fetchJson(`/api/admin/safety/facilities/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await fetchJson('/api/admin/safety/facilities', { method: 'POST', body: JSON.stringify(payload) });
      }
      msg.textContent = '已儲存';
      msg.className = 'sd-safety-msg ok';
      await loadFacilities();
      setTimeout(closeFacilityModal, 500);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'sd-safety-msg err';
    }
  }

  async function deleteFacility(id) {
    if (!confirm('確定刪除此安全設施？')) return;
    await fetchJson(`/api/admin/safety/facilities/${id}`, { method: 'DELETE' });
    await loadFacilities();
  }

  function bindEvents() {
    document.getElementById('safetySettingsForm')?.addEventListener('submit', saveSettings);
    document.getElementById('btnAddSafetyFacility')?.addEventListener('click', () => openFacilityModal(null));
    document.getElementById('closeSafetyFacilityModal')?.addEventListener('click', closeFacilityModal);
    document.getElementById('safetyFacilityForm')?.addEventListener('submit', saveFacility);
    document.getElementById('safetyFacilityForm')?.elements.facility_type?.addEventListener('change', (e) => {
      const selected = Array.from(document.querySelectorAll('#safetySuppliesBox input:checked')).map((el) => el.value);
      document.getElementById('safetySuppliesBox').innerHTML = renderSupplyCheckboxes(e.target.value, selected);
    });

    document.getElementById('safetyFacilityList')?.addEventListener('click', (e) => {
      const editId = e.target.closest('[data-edit-facility]')?.dataset.editFacility;
      const deleteId = e.target.closest('[data-delete-facility]')?.dataset.deleteFacility;
      if (editId) {
        const facility = facilities.find((item) => String(item.id) === String(editId));
        if (facility) openFacilityModal(facility);
      }
      if (deleteId) deleteFacility(deleteId).catch((err) => alert(err.message));
    });
  }

  async function init() {
    if (!window.loginUser || window.loginUser.role !== 'admin') return;
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    await Promise.all([loadSettings(), loadFacilities()]);
  }

  window.staffSafetyAdmin = { init, loadFacilities, loadSettings };
})();
