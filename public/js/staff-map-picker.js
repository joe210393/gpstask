(function () {
  'use strict';

  const DEFAULT_CENTER = [24.757, 121.753];
  const DEFAULT_ZOOM = 16;

  function parseCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function createPicker(options) {
    const mapEl = typeof options.mapEl === 'string'
      ? document.getElementById(options.mapEl)
      : options.mapEl;
    const latInput = options.latInput;
    const lngInput = options.lngInput;
    const radiusInput = options.radiusInput || null;
    const locateBtn = options.locateBtn || null;

    let map = null;
    let marker = null;
    let circle = null;
    let syncing = false;
    let initialized = false;

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

    function setMarkerPosition(lat, lng, options = {}) {
      if (!map || !marker) return;
      const { updateFields = true, pan = true } = options;
      marker.setLatLng([lat, lng]);
      if (updateFields) {
        syncing = true;
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
        syncing = false;
      }
      updateCircle(lat, lng);
      if (pan) map.panTo([lat, lng], { animate: false });
    }

    function onInputChange() {
      if (syncing || !map || !marker) return;
      const lat = parseCoord(latInput.value);
      const lng = parseCoord(lngInput.value);
      if (lat === null || lng === null) return;
      setMarkerPosition(lat, lng, { updateFields: false, pan: true });
    }

    function onRadiusChange() {
      if (!map || !marker) return;
      const pos = marker.getLatLng();
      updateCircle(pos.lat, pos.lng);
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
        setMarkerPosition(center[0], center[1]);
      } else {
        updateCircle(lat, lng);
      }

      if (locateBtn) {
        locateBtn.addEventListener('click', () => {
          locateBtn.disabled = true;
          locateCurrentPosition()
            .finally(() => { locateBtn.disabled = false; });
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
          if (marker) {
            const pos = marker.getLatLng();
            map.panTo(pos, { animate: false });
          }
        }, 80);
      },
      refreshFromInputs() {
        onInputChange();
      }
    };
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
        locateBtn: document.getElementById('addTaskLocateBtn')
      }),
      edit: createPicker({
        mapEl: 'editTaskMap',
        latInput: editForm.elements.lat,
        lngInput: editForm.elements.lng,
        radiusInput: editForm.elements.radius,
        locateBtn: document.getElementById('editTaskLocateBtn')
      })
    };

    pickers.add.init();

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
    return pickers;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
