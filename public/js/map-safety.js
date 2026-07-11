(function () {
  'use strict';

  const API_BASE = '';
  const HOLD_MS = 3000;
  const TYPE_META = {
    medical: { emoji: '🏥', label: '救護站', className: 'medical' },
    water: { emoji: '💧', label: '補水站', className: 'water' },
    supply: { emoji: '📦', label: '補給站', className: 'supply' }
  };

  let safetyLayer = null;
  let facilities = [];
  let layerVisible = true;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getMap() {
    return window.gpsTaskMap || null;
  }

  function createIcon(type) {
    const meta = TYPE_META[type] || TYPE_META.medical;
    return L.divIcon({
      className: 'safety-marker-wrap',
      html: `<div class="safety-marker-badge ${meta.className}">${meta.emoji}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function buildPopup(facility, distanceM) {
    const meta = TYPE_META[facility.facility_type] || TYPE_META.medical;
    const supplies = (facility.supplies || [])
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join('');
    const dist = Number.isFinite(distanceM) ? `<div>📏 約 ${Math.round(distanceM)} 公尺</div>` : '';
    return `
      <div class="safety-popup">
        <h4>${meta.emoji} ${escapeHtml(facility.name)}</h4>
        <div style="font-size:0.82rem;color:#64748b;">${meta.label}</div>
        ${dist}
        ${facility.open_hours ? `<div>🕐 ${escapeHtml(facility.open_hours)}</div>` : ''}
        ${facility.description ? `<div style="margin-top:0.35rem;">${escapeHtml(facility.description)}</div>` : ''}
        ${supplies ? `<div class="safety-popup-tags">${supplies}</div>` : ''}
        ${facility.notes ? `<div style="margin-top:0.35rem;font-size:0.82rem;color:#64748b;">${escapeHtml(facility.notes)}</div>` : ''}
      </div>
    `;
  }

  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function renderMarkers() {
    const map = getMap();
    if (!map || typeof L === 'undefined') return;
    if (!safetyLayer) safetyLayer = L.layerGroup();
    safetyLayer.clearLayers();
    if (!layerVisible) {
      if (map.hasLayer(safetyLayer)) map.removeLayer(safetyLayer);
      return;
    }

    const userLat = window.lastUserLat;
    const userLng = window.lastUserLng;

    facilities.forEach((facility) => {
      const distanceM = Number.isFinite(userLat) && Number.isFinite(userLng)
        ? haversineM(userLat, userLng, facility.lat, facility.lng)
        : null;
      const marker = L.marker([facility.lat, facility.lng], {
        icon: createIcon(facility.facility_type)
      });
      marker.bindPopup(buildPopup(facility, distanceM));
      marker.addTo(safetyLayer);
    });

    if (!map.hasLayer(safetyLayer)) safetyLayer.addTo(map);
  }

  function ensureToggle() {
    if (document.getElementById('mapSafetyToggle')) return;
    const wrap = document.createElement('label');
    wrap.id = 'mapSafetyToggle';
    wrap.className = 'map-safety-toggle';
    wrap.innerHTML = `
      <input type="checkbox" id="mapSafetyToggleInput" checked />
      <span>安全設施</span>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('#mapSafetyToggleInput').addEventListener('change', (e) => {
      layerVisible = e.target.checked;
      renderMarkers();
    });

    const nearestBtn = document.createElement('button');
    nearestBtn.type = 'button';
    nearestBtn.className = 'safety-nearest-btn';
    nearestBtn.textContent = '找最近救護站';
    nearestBtn.style.position = 'fixed';
    nearestBtn.style.left = '12px';
    nearestBtn.style.bottom = '58px';
    nearestBtn.style.zIndex = '1100';
    nearestBtn.addEventListener('click', focusNearestMedical);
    document.body.appendChild(nearestBtn);
  }

  function focusNearestMedical() {
    const map = getMap();
    const userLat = window.lastUserLat;
    const userLng = window.lastUserLng;
    const medical = facilities.filter((f) => f.facility_type === 'medical');
    if (!map || !medical.length) {
      alert('目前沒有救護站資料');
      return;
    }
    let target = medical[0];
    if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
      target = medical.reduce((best, item) => {
        const d = haversineM(userLat, userLng, item.lat, item.lng);
        const bestD = haversineM(userLat, userLng, best.lat, best.lng);
        return d < bestD ? item : best;
      }, medical[0]);
      map.setView([target.lat, target.lng], Math.max(map.getZoom(), 16));
    } else {
      map.setView([target.lat, target.lng], 16);
    }
    L.popup()
      .setLatLng([target.lat, target.lng])
      .setContent(buildPopup(target, Number.isFinite(userLat) ? haversineM(userLat, userLng, target.lat, target.lng) : null))
      .openOn(map);
  }

  async function loadFacilities() {
    try {
      const res = await fetch(`${API_BASE}/api/safety/facilities`);
      const data = await res.json();
      if (!data.success) return;
      facilities = data.facilities || [];
      ensureToggle();
      renderMarkers();
    } catch (err) {
      console.warn('載入安全設施失敗:', err);
    }
  }

  function init() {
    loadFacilities();
    setInterval(loadFacilities, 60000);
  }

  window.mapSafety = {
    init,
    refresh: loadFacilities,
    renderMarkers
  };
})();
