(function () {
  'use strict';

  const API_BASE = '';
  const HOLD_MS = 3000;
  const ONBOARD_SKIP_KEY = 'safetyEmergencyContactsSkippedAt';
  const ONBOARD_DONE_KEY = 'safetyEmergencyContactsDone';

  let settings = { sos_enabled: false, emergency_phone: '', sos_instructions: '' };
  let fabWrap = null;
  let holdTimer = null;
  let holdStart = 0;
  let holdRaf = null;
  let initialized = false;

  function getLoginUser() {
    try {
      return JSON.parse(localStorage.getItem('loginUser') || 'null');
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchJson(url, options = {}) {
    const user = getLoginUser();
    const res = await fetch(`${API_BASE}${url}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(user?.username ? { 'x-username': user.username } : {}),
        ...(options.headers || {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
  }

  async function loadSettings() {
    try {
      const data = await fetchJson('/api/safety/settings');
      settings = data.settings || settings;
    } catch (err) {
      console.warn('SOS 設定載入失敗:', err);
    }
  }

  function shouldShowFab() {
    const user = getLoginUser();
    if (!user || user.role !== 'user') return false;
    return !!settings.sos_enabled;
  }

  function createFab() {
    if (fabWrap || !shouldShowFab()) return;
    fabWrap = document.createElement('div');
    fabWrap.className = 'sos-fab-wrap';
    fabWrap.innerHTML = `
      <div class="sos-fab-hint">長按 3 秒<br>緊急 SOS</div>
      <button type="button" class="sos-fab" id="sosFabBtn" aria-label="緊急 SOS">
        <span class="sos-fab-progress" aria-hidden="true"></span>
        SOS
      </button>
    `;
    document.body.appendChild(fabWrap);
    bindFabEvents(fabWrap.querySelector('#sosFabBtn'));
  }

  function removeFab() {
    if (fabWrap) {
      fabWrap.remove();
      fabWrap = null;
    }
  }

  function bindFabEvents(btn) {
    if (!btn) return;
    const startHold = (e) => {
      e.preventDefault();
      const user = getLoginUser();
      if (!user || user.role !== 'user') {
        alert('請先登入玩家帳號才能使用 SOS');
        window.location.href = '/login.html';
        return;
      }
      btn.classList.add('is-holding');
      holdStart = Date.now();
      holdTimer = setTimeout(() => {
        btn.classList.remove('is-holding');
        showConfirmOverlay();
      }, HOLD_MS);
    };
    const cancelHold = () => {
      btn.classList.remove('is-holding');
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      if (holdRaf) cancelAnimationFrame(holdRaf);
    };
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchstart', startHold, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((evt) => {
      btn.addEventListener(evt, cancelHold);
    });
  }

  function showOverlay(innerHtml) {
    let overlay = document.getElementById('sosOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sosOverlay';
      overlay.className = 'sos-overlay';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
      });
    }
    overlay.innerHTML = innerHtml;
    overlay.classList.remove('hidden');
  }

  function closeOverlay() {
    document.getElementById('sosOverlay')?.classList.add('hidden');
  }

  function showConfirmOverlay() {
    showOverlay(`
      <div class="sos-panel" role="dialog" aria-labelledby="sosConfirmTitle">
        <h2 id="sosConfirmTitle">確認 SOS？</h2>
        <p class="sos-confirm-text">這會通知活動緊急專線人員，並記錄您的位置。若只是誤觸請取消。</p>
        <div class="sos-actions">
          <button type="button" class="sos-btn sos-btn-119" id="sosConfirmBtn">確認 SOS</button>
          <button type="button" class="sos-btn sos-btn-cancel" id="sosCancelBtn">取消</button>
        </div>
      </div>
    `);
    document.getElementById('sosCancelBtn')?.addEventListener('click', closeOverlay);
    document.getElementById('sosConfirmBtn')?.addEventListener('click', () => {
      triggerSos().catch((err) => alert(err.message || 'SOS 失敗'));
    });
  }

  function getCurrentPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ status: 'failed', lat: null, lng: null, accuracy: null });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          status: 'success',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        (err) => resolve({
          status: err.code === 1 ? 'denied' : 'failed',
          lat: null,
          lng: null,
          accuracy: null
        }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  async function triggerSos() {
    const user = getLoginUser();
    if (!user || user.role !== 'user') {
      alert('請先登入');
      window.location.href = '/login.html';
      return;
    }

    const loc = await getCurrentPosition();
    const payload = {
      lat: loc.lat,
      lng: loc.lng,
      location_accuracy: loc.accuracy,
      location_status: loc.status
    };

    let eventData = {};
    try {
      const data = await fetchJson('/api/safety/sos', { method: 'POST', body: payload });
      eventData = data.event || {};
      if (eventData.emergency_phone) settings.emergency_phone = eventData.emergency_phone;
    } catch (err) {
      throw err;
    }

    showSosActionPanel(loc, eventData.id);
  }

  function telHref(phone) {
    const cleaned = String(phone || '').replace(/[^\d+]/g, '');
    return cleaned ? `tel:${cleaned}` : '';
  }

  function showSosActionPanel(loc, eventId) {
    const phone = settings.emergency_phone || '';
    const locText = loc.lat != null && loc.lng != null
      ? `${Number(loc.lat).toFixed(6)}, ${Number(loc.lng).toFixed(6)}`
      : '定位失敗（仍可撥打電話）';
    const hotlineBtn = phone
      ? `<a class="sos-btn sos-btn-hotline" href="${telHref(phone)}">📞 活動緊急專線<br>${escapeHtml(phone)}</a>`
      : `<div class="sos-location-box">活動緊急專線尚未設定，請直接撥打 119</div>`;

    showOverlay(`
      <div class="sos-panel" role="dialog" aria-labelledby="sosActionTitle">
        <h2 id="sosActionTitle">SOS 已送出${eventId ? ` #${eventId}` : ''}</h2>
        <p class="sos-panel-desc">${escapeHtml(settings.sos_instructions || '請保持電話暢通，必要時撥打以下號碼。')}</p>
        <div class="sos-location-box">
          <strong>您的位置</strong><br>${escapeHtml(locText)}
          ${loc.accuracy ? `<br>精度 ±${Math.round(loc.accuracy)} 公尺` : ''}
        </div>
        <div class="sos-actions">
          <a class="sos-btn sos-btn-119" href="tel:119">🚑 撥打 119</a>
          ${hotlineBtn}
          <button type="button" class="sos-btn sos-btn-cancel" id="sosClosePanelBtn">關閉</button>
        </div>
      </div>
    `);
    document.getElementById('sosClosePanelBtn')?.addEventListener('click', closeOverlay);
  }

  function shouldShowOnboarding() {
    const user = getLoginUser();
    if (!user || user.role !== 'user') return false;
    if (localStorage.getItem(ONBOARD_DONE_KEY) === '1') return false;
    const skipped = localStorage.getItem(ONBOARD_SKIP_KEY);
    if (skipped && Date.now() - Number(skipped) < 7 * 24 * 60 * 60 * 1000) return false;
    return true;
  }

  function showEmergencyOnboarding() {
    if (!shouldShowOnboarding()) return;
    showOverlay(`
      <div class="sos-onboard-panel" role="dialog" aria-labelledby="sosOnboardTitle">
        <h2 id="sosOnboardTitle">設定緊急聯絡人（選填）</h2>
        <p>出發前可先填寫 1～2 位家人或朋友電話，供活動緊急專線必要時參考。也可以稍後在個人主頁設定。</p>
        <div class="sos-contact-row">
          <input type="text" id="ecName1" placeholder="聯絡人 1 姓名" />
          <input type="tel" id="ecPhone1" placeholder="聯絡人 1 電話" />
        </div>
        <div class="sos-contact-row">
          <input type="text" id="ecName2" placeholder="聯絡人 2 姓名" />
          <input type="tel" id="ecPhone2" placeholder="聯絡人 2 電話" />
        </div>
        <div class="sos-onboard-actions">
          <button type="button" class="sos-btn sos-btn-hotline" id="ecSaveBtn" style="flex:1;">儲存並開始</button>
          <button type="button" class="sos-btn sos-btn-cancel" id="ecSkipBtn">稍後再填</button>
        </div>
        <div id="ecOnboardMsg" class="sos-onboard-msg"></div>
      </div>
    `);

    document.getElementById('ecSkipBtn')?.addEventListener('click', () => {
      localStorage.setItem(ONBOARD_SKIP_KEY, String(Date.now()));
      closeOverlay();
    });

    document.getElementById('ecSaveBtn')?.addEventListener('click', async () => {
      const msg = document.getElementById('ecOnboardMsg');
      const contacts = [];
      const n1 = document.getElementById('ecName1').value.trim();
      const p1 = document.getElementById('ecPhone1').value.trim();
      const n2 = document.getElementById('ecName2').value.trim();
      const p2 = document.getElementById('ecPhone2').value.trim();
      if (p1) contacts.push({ name: n1, phone: p1 });
      if (p2) contacts.push({ name: n2, phone: p2 });
      if (!contacts.length) {
        localStorage.setItem(ONBOARD_SKIP_KEY, String(Date.now()));
        closeOverlay();
        return;
      }
      try {
        await fetchJson('/api/user/emergency-contacts', { method: 'PUT', body: { contacts } });
        localStorage.setItem(ONBOARD_DONE_KEY, '1');
        msg.textContent = '已儲存';
        msg.className = 'sos-onboard-msg ok';
        setTimeout(closeOverlay, 600);
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'sos-onboard-msg err';
      }
    });
  }

  async function init(options = {}) {
    if (initialized && !options.force) return;
    await loadSettings();
    removeFab();
    if (shouldShowFab()) createFab();
    initialized = true;
    if (options.onboarding) showEmergencyOnboarding();
  }

  window.sosWidget = {
    init,
    loadSettings,
    closeOverlay,
    saveEmergencyContacts: async (contacts) => fetchJson('/api/user/emergency-contacts', {
      method: 'PUT',
      body: { contacts }
    }),
    loadEmergencyContacts: async () => fetchJson('/api/user/emergency-contacts')
  };
})();
