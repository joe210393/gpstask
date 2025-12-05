(() => {
  async function getCsrf() {
    const res = await fetch('/api/public/csrf');
    const j = await res.json();
    return j.csrfToken;
  }

  // handle delete of member uploaded files from expanded view
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-file-del]');
    if (!btn) return;
    e.preventDefault();
    const mid = btn.getAttribute('data-mid');
    const name = btn.getAttribute('data-name');
    if (!mid || !name) return;
    if (!confirm('確定刪除此檔案？')) return;
    await api('DELETE', `/api/admin/members/${mid}/files/${name}`);
    // reload that member's files list (without collapsing)
    const tbody = document.querySelector('#members-table')?.querySelector('tbody');
    const detailRow = tbody && tbody.querySelector(`tr[data-detail-for="${mid}"]`);
    if (detailRow) {
      const filesBox = detailRow.querySelector('[data-files-box]');
      if (filesBox) {
        const files = await api('GET', `/api/admin/members/${mid}/files`);
        filesBox.innerHTML = (files.items||[]).map(f=>
          `<span class="chip">
            <a class="btn ghost" href="${f.url}" download>${f.name}</a>
            <button class="btn ghost" data-file-del data-name="${encodeURIComponent(f.name)}" data-mid="${mid}" style="color:#c00;border-color:#fecaca;">刪除</button>
          </span>`
        ).join('') || '—';
      }
    }
  });

  async function api(method, url, data) {
    const headers = {};
    const options = { method, headers, credentials: 'same-origin' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['CSRF-Token'] = await getCsrf();
      options.body = JSON.stringify(data || {});
    } else {
      headers['Cache-Control'] = 'no-cache';
      headers['Pragma'] = 'no-cache';
    }
    let res = await fetch(url, options);
    if (res.status === 304) {
      res = await fetch(url, { ...options, cache: 'no-store' });
    }
    if (!res.ok) throw new Error(await res.text());
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
  }

  async function guard() {
    const page = getPage();
    if (page === 'login.html') return null;
    const res = await fetch('/api/admin/me');
    const me = await res.json();
    if ((!me || !me.id) && page !== 'login.html') location.href = '/admin/login.html';
    if (me && me.must_change_password && page !== 'change-password.html') {
      location.href = '/admin/change-password.html';
    }
    // 非 admin 的 editor：隱藏使用者管理，且若直接進入 users.html 則導回首頁
    if (me && me.role === 'editor') {
      const usersLink = document.querySelector('a[href="/admin/users.html"]');
      if (usersLink) usersLink.style.display = 'none';
      if (page === 'users.html') location.href = '/admin/index.html';
    }
    return me || null;
  }

  async function injectAdminHeader() {
    const page = getPage();
    if (page === 'login.html') return;
    const host = document.getElementById('admin-header');
    if (!host) return;
    try {
      const res = await fetch('/admin/_layout.html');
      host.innerHTML = await res.text();
    } catch {}
    bindLogout();
  }

  function getPage() {
    const p = location.pathname.split('/').pop();
    return p;
  }

  // SETTINGS
  function normalizeLineUrl(value) {
    const raw = String(value || '');
    if (!raw.trim()) return '';
    let clean = raw.replace(/^@+/, '').trim();
    if (!clean) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) {
      clean = `https://${clean.replace(/^\/+/, '')}`;
    }
    return clean;
  }

  async function initSettings() {
    const settings = await api('GET', '/api/admin/settings');
    const dict = Object.fromEntries(settings.map(s => [s.key, s.value]));
    const site = document.getElementById('site_name');
    const line = document.getElementById('line_url');
    const bg = document.getElementById('default_bg_color');
    const themeSelect = document.getElementById('theme_selector');
    if (site) site.value = dict.site_name || '';
    if (line) line.value = normalizeLineUrl(dict.line_url);
    if (themeSelect) themeSelect.value = dict.theme || 'default';
    if (bg) bg.value = dict.default_bg_color || '#f7f7f7';
    // Per-page BG URLs
    const keys = [
      'bg_home_url','bg_blog_url','bg_blog_post_url','bg_news_url','bg_news_post_url','bg_leaderboard_url','bg_plans_url','bg_trial_url','bg_contact_url','bg_about_url'
    ];
    keys.forEach(k => { const el = document.getElementById(k); if (el) el.value = dict[k] || ''; });
    document.getElementById('save-settings')?.addEventListener('click', async () => {
      const payload = {
        site_name: site.value,
        line_url: normalizeLineUrl(line.value),
        default_bg_color: bg.value,
        theme: themeSelect?.value || 'default'
      };
      keys.forEach(k => payload[k] = document.getElementById(k)?.value || '');
      await api('POST', '/api/admin/settings', payload);
      alert('已儲存');
    });

    // Media picker for background fields
    const picker = document.getElementById('picker');
    const pickerGrid = document.getElementById('picker-grid');
    const pickerPager = document.getElementById('picker-pager');
    let targetInputId = null;
    const uploadInput = document.getElementById('bg-upload-file');

    async function loadMedia(page=1) {
      const data = await api('GET', `/api/admin/media?page=${page}&limit=24`);
      pickerGrid.innerHTML = '';
      data.items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.padding = '0';
        card.style.overflow = 'hidden';
        card.style.border = '1px solid #e5e7eb';
        card.style.borderRadius = '12px';
        card.innerHTML = `
          <img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px;color:#374151;gap:8px;">
            <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.file_name}</span>
            <div style="display:flex;gap:6px;">
              <button class="btn ghost" data-action="pick" data-id="${it.id}">選擇</button>
              <button class="btn ghost" data-action="usage" data-id="${it.id}">詳情</button>
              <button class="btn ghost" data-action="del" data-id="${it.id}" style="color:#c00;border-color:#fecaca;">刪除</button>
            </div>
          </div>`;
        pickerGrid.appendChild(card);
      });
      // pager
      pickerPager.innerHTML = '';
      const totalPages = Math.ceil(data.total / data.limit);
      for (let i=1;i<=totalPages;i++) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = i;
        a.className = 'btn ghost';
        a.style.padding = '6px 10px';
        a.style.borderRadius = '8px';
        if (i === data.page) a.style.background = '#111827', a.style.color = '#fff';
        a.addEventListener('click', (e) => { e.preventDefault(); loadMedia(i); });
        pickerPager.appendChild(a);
      }
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
        e.preventDefault();
        targetInputId = btn.getAttribute('data-pick');
        picker.style.display = 'block';
        loadMedia(1);
    });
    // picker actions: pick or delete
    pickerGrid?.addEventListener('click', async (e) => {
      const pickBtn = e.target.closest('button[data-action="pick"]');
      const delBtn = e.target.closest('button[data-action="del"]');
      const usageBtn = e.target.closest('button[data-action="usage"]');
      if (!pickBtn && !delBtn && !usageBtn) return;
      e.preventDefault();
      const id = Number((pickBtn||delBtn||usageBtn).dataset.id);
      if (pickBtn) {
        // set selected file path to target input
        const card = pickBtn.closest('.card');
        const img = card?.querySelector('img');
        if (targetInputId && img?.src) {
          const input = document.getElementById(targetInputId);
          if (input) input.value = img.src.replace(location.origin, '');
        }
        picker.style.display = 'none';
      } else if (usageBtn) {
        const detail = await api('GET', `/api/admin/media/${id}/usage`);
        const lines = [];
        const push = (arr, label) => { if (Array.isArray(arr) && arr.length) lines.push(`${label}: ${arr.map(x=>x.title||x.slug||x.id).join(', ')}`); };
        push(detail.posts, '部落格封面');
        push(detail.news, '最新消息封面');
        push(detail.leaderboard, '傳奇榜封面');
        push(detail.plans, '方案封面');
        push(detail.pages, '頁面背景');
        push(detail.slides, '首頁輪播');
        alert(lines.length ? lines.join('\n') : '此圖片目前未被使用');
      } else if (delBtn) {
        if (!confirm('確定刪除這張圖片？此動作無法復原')) return;
        await api('DELETE', `/api/admin/media/${id}`);
        await loadMedia(1);
      }
    });
    document.getElementById('picker-close')?.addEventListener('click', (e) => { e.preventDefault(); picker.style.display = 'none'; });

    // Direct upload from computer
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-upload]');
      if (!btn) return;
      e.preventDefault();
      targetInputId = btn.getAttribute('data-upload');
      if (!uploadInput) return;
      uploadInput.value = '';
      uploadInput.click();
    });
    uploadInput?.addEventListener('change', async () => {
      if (!uploadInput.files || !uploadInput.files[0]) return;
      const csrf = await getCsrf();
      const fd = new FormData();
      fd.append('file', uploadInput.files[0]);
      const res = await fetch('/api/admin/media/upload', { method: 'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j && j.path && targetInputId) {
        const input = document.getElementById(targetInputId);
        if (input) input.value = j.path;
      }
    });
  }

  // MENUS with drag reorder
  function renderMenusList(listEl, menus) {
    listEl.innerHTML = '';
    menus.forEach(item => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.id = item.id;
      li.textContent = `${item.title} (${item.slug || item.url || ''})`;
      li.className = 'menu-item';
      listEl.appendChild(li);
    });
    let drag;
    listEl.addEventListener('dragstart', (e) => { drag = e.target; e.dataTransfer.effectAllowed = 'move'; });
    listEl.addEventListener('dragover', (e) => { e.preventDefault(); const t = e.target.closest('li'); if (!t || t === drag) return; const rect = t.getBoundingClientRect(); const after = (e.clientY - rect.top) / rect.height > 0.5; listEl.insertBefore(drag, after ? t.nextSibling : t); });
  }
  async function initMenus() {
    const listEl = document.getElementById('menus-list');
    const menus = await api('GET', '/api/admin/menus');
    renderMenusList(listEl, menus);
    document.getElementById('save-order')?.addEventListener('click', async () => {
      const orders = Array.from(listEl.querySelectorAll('li')).map((li, idx) => ({ id: Number(li.dataset.id), order_index: idx }));
      await api('POST', '/api/admin/menus/reorder', { orders });
      alert('排序已更新');
    });
    // create/update
    const form = document.getElementById('menu-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.visible = fd.get('visible') ? 1 : 0;
      data.parent_id = data.parent_id || null;
      data.order_index = Number(data.order_index || 0);
      if (data.id) await api('PUT', `/api/admin/menus/${data.id}`, data);
      else await api('POST', '/api/admin/menus', data);
      location.reload();
    });
    listEl?.addEventListener('click', async (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const id = li.dataset.id;
      const m = menus.find(x => String(x.id) === String(id));
      if (!m) return;
      for (const [k, v] of Object.entries(m)) {
        const el = document.querySelector(`#menu-form [name="${k}"]`);
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = !!Number(v);
        else el.value = v ?? '';
      }
      document.querySelector('#menu-form [name="id"]').value = m.id;
    });
    document.getElementById('menu-delete')?.addEventListener('click', async () => {
      const id = document.querySelector('#menu-form [name="id"]').value;
      if (!id) return;
      if (!confirm('確定刪除？')) return;
      await api('DELETE', `/api/admin/menus/${id}`);
      location.reload();
    });
  }

  // PAGES (similar for posts/news)
  async function bindCrudList(resource) {
    const listEl = document.getElementById(`${resource}-list`);
    const table = document.getElementById(`${resource}-table`);
    const form = document.getElementById(`${resource}-form`);
    const rows = await api('GET', `/api/admin/${resource}`);
    if (table) {
      const tbody = table.querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.id}</td><td>${r.title || r.name || r.slug || ''}</td><td>${r.slug || ''}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
        tbody.appendChild(tr);
      });
      tbody.addEventListener('click', async (e) => {
        const id = e.target.dataset.edit || e.target.dataset.del;
        if (!id) return;
        if (e.target.dataset.edit) {
          const r = rows.find(x => String(x.id) === String(id));
          for (const [k, v] of Object.entries(r)) {
            const el = form.querySelector(`[name="${k}"]`);
            if (!el) continue;
            if (el.type === 'checkbox') el.checked = !!Number(v);
            else el.value = v ?? '';
          }
          form.querySelector('[name="id"]').value = r.id;
        } else if (e.target.dataset.del) {
          if (!confirm('確定刪除？')) return;
          await api('DELETE', `/api/admin/${resource}/${id}`);
          location.reload();
        }
      });
    }
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      for (const el of form.querySelectorAll('input[type="checkbox"]')) {
        data[el.name] = el.checked ? 1 : 0;
      }
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/${resource}/${id}`, data);
      else await api('POST', `/api/admin/${resource}`, data);
      location.reload();
    });
  }

  // CONTACTS
  async function initContacts() {
    const rows = await api('GET', '/api/admin/contacts');
    const tbody = document.querySelector('#contacts-table tbody');
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.name}</td><td>${r.email}</td><td>${r.phone}</td><td>${r.created_at || ''}</td><td>${r.processed ? '✔' : '—'}</td><td>${r.message || ''}</td><td>${r.processed ? '' : `<button data-id="${r.id}">標示處理</button>`}</td>`;
      tbody.appendChild(tr);
    });
    tbody.addEventListener('click', async (e) => {
      const id = e.target.dataset.id; if (!id) return;
      await api('PUT', `/api/admin/contacts/${id}/process`, {});
      location.reload();
    });
  }

  // TRIAL (課程試讀)
  async function initTrial() {
    const table = document.getElementById('trial-table');
    const form = document.getElementById('trial-form');
    if (!table || !form) return;
    async function load() {
      const rows = await api('GET', '/api/admin/trial');
      const tbody = table.querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.id}</td><td>${r.title || ''}</td><td>${r.type || ''}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
        tbody.appendChild(tr);
      });
      tbody.addEventListener('click', async (e) => {
        const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
        if (e.target.dataset.edit) {
          const rows = await api('GET', '/api/admin/trial');
          const r = rows.find(x => String(x.id) === String(id)); if (!r) return;
          form.querySelector('[name="id"]').value = r.id;
          form.querySelector('[name="title"]').value = r.title || '';
          form.querySelector('[name="type"]').value = r.type || 'article';
          form.querySelector('[name="content_html"]').value = r.content_html || '';
          form.querySelector('[name="video_url"]').value = r.video_url || '';
          form.querySelector('[name="is_public"]').checked = !!r.is_public;
        } else if (e.target.dataset.del) {
          if (!confirm('確定刪除？')) return;
          await api('DELETE', `/api/admin/trial/${id}`);
          location.reload();
        }
      });
    }
    await load();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.is_public = form.querySelector('[name="is_public"]').checked ? 1 : 0;
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/trial/${id}`, data);
      else await api('POST', '/api/admin/trial', data);
      location.reload();
    });
  }

  // NEWS rich editor
  async function initNewsEditor() {
    const table = document.getElementById('news-table');
    const form = document.getElementById('news-form');
    const editor = document.getElementById('news-editor');
    const toolbar = document.getElementById('news-toolbar');
    if (!table || !form || !editor) return;
    const rows = await api('GET', '/api/admin/news');
    const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
    rows.forEach(r => { const tr=document.createElement('tr'); tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.slug}</td><td>${r.is_published ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`; tbody.appendChild(tr); });
    toolbar?.addEventListener('click', (e) => { const btn=e.target.closest('[data-cmd]'); if (!btn) return; const cmd=btn.getAttribute('data-cmd'); const val=btn.getAttribute('data-value')||null; document.execCommand(cmd,false,val); });
    document.getElementById('news-insert-img')?.addEventListener('click', ()=> document.getElementById('news-insert-file').click());
    document.getElementById('news-insert-file')?.addEventListener('change', async (e) => { const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.path){ const img=document.createElement('img'); img.src=j.path; img.alt=''; editor.appendChild(img);} });
    // picker/upload cover
    const picker = document.getElementById('news-picker'); const pickerGrid=document.getElementById('news-picker-grid'); const pickerPager=document.getElementById('news-picker-pager');
    async function loadMedia(page=1){ const data=await api('GET', `/api/admin/media?page=${page}&limit=24`); pickerGrid.innerHTML=''; data.items.forEach(it=>{ const btn=document.createElement('button'); btn.className='btn ghost'; btn.style.display='block'; btn.style.padding='0'; btn.style.borderRadius='12px'; btn.style.overflow='hidden'; btn.style.border='1px solid #e5e7eb'; btn.style.background='#fff'; btn.innerHTML=`<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style=\"padding:8px 10px;font-size:12px;color:#374151;\">${it.file_name}</div>`; btn.addEventListener('click',()=>{ document.getElementById('news-cover').value = it.id || ''; picker.style.display='none'; }); pickerGrid.appendChild(btn); }); pickerPager.innerHTML=''; const totalPages=Math.ceil(data.total/data.limit); for(let i=1;i<=totalPages;i++){ const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px'; if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; } a.addEventListener('click',(e)=>{e.preventDefault(); loadMedia(i);}); pickerPager.appendChild(a);} }
    document.getElementById('news-picker-close')?.addEventListener('click',(e)=>{e.preventDefault(); picker.style.display='none';});
    document.getElementById('news-cover-pick')?.addEventListener('click',()=>{ picker.style.display='block'; loadMedia(1); });
    document.getElementById('news-cover-upload')?.addEventListener('click',()=> document.getElementById('news-cover-file').click());
    document.getElementById('news-cover-file')?.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.media_id) document.getElementById('news-cover').value=j.media_id; });
    // edit/delete/save
    tbody.addEventListener('click', async (e)=>{ const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return; if (e.target.dataset.edit){ const r=rows.find(x=> String(x.id)===String(id)); if (!r) return; document.getElementById('news-title').value=r.title||''; document.getElementById('news-slug').value=r.slug||''; document.getElementById('news-excerpt').value=r.excerpt||''; editor.innerHTML=r.content_html||''; document.getElementById('news-cover').value=r.cover_media_id||''; document.getElementById('news-published').value=r.published_at||''; document.getElementById('news-published-flag').checked=!!r.is_published; form.querySelector('[name="id"]').value=r.id; } else if (e.target.dataset.del){ if (!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/news/${id}`); location.reload(); } });
    form.addEventListener('submit', async (e)=>{ e.preventDefault(); const fd=new FormData(form); const data=Object.fromEntries(fd.entries()); data.excerpt=document.getElementById('news-excerpt').value; data.content_html=editor.innerHTML; data.cover_media_id=document.getElementById('news-cover').value||null; data.published_at=document.getElementById('news-published').value||null; data.is_published=document.getElementById('news-published-flag').checked?1:0; const id=data.id; delete data.id; if (id) await api('PUT', `/api/admin/news/${id}`, data); else await api('POST', '/api/admin/news', data); location.reload(); });
  }
  // MEDIA
  async function initMedia() {
    const file = document.getElementById('file');
    const btn = document.getElementById('upload-btn');
    const q = document.getElementById('media-q');
    const searchBtn = document.getElementById('media-search');
    const table = document.getElementById('media-table');
    const deleteSelected = document.getElementById('media-delete-selected');
    const selectAll = document.getElementById('media-select-all');
    const pager = document.getElementById('media-pager');
    const selected = new Set();

    function updateDeleteButton() {
      if (!deleteSelected) return;
      deleteSelected.disabled = selected.size === 0;
      deleteSelected.textContent = selected.size
        ? `刪除選取 (${selected.size})`
        : '刪除選取';
    }
    function clearSelection() {
      selected.clear();
      if (selectAll) selectAll.checked = false;
      table?.querySelectorAll('[data-media-check]').forEach(cb => cb.checked = false);
      updateDeleteButton();
    }
    async function load(page=1){
      const qp = q && q.value.trim() ? `&q=${encodeURIComponent(q.value.trim())}` : '';
      const limit = 50; // Fixed limit per page
      const data = await api('GET', `/api/admin/media?page=${page}&limit=${limit}${qp}`);
      if (table){
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        clearSelection();
        data.items.forEach(it => {
          const tr = document.createElement('tr');
          const thumb = it.file_path ? `<img class="media-thumb" src="${it.file_path}" alt="${it.file_name || 'thumb'}">` : '—';
          tr.innerHTML = `<td><input type="checkbox" data-media-check data-id="${it.id}"></td><td>${thumb}</td><td>${it.id}</td><td>${it.file_name}</td><td>${it.mime_type}</td><td>${it.created_at || ''}</td><td><button class="btn ghost" data-media-del data-id="${it.id}">刪除</button></td>`;
          tbody.appendChild(tr);
        });
        
        // Pager
        if (pager) {
          pager.innerHTML = '';
          const totalPages = Math.ceil(data.total / data.limit);
          if (totalPages > 1) {
            for (let i=1; i<=totalPages; i++) {
               const btn = document.createElement('button');
               btn.textContent = i;
               btn.className = 'btn ghost';
               if (i === Number(data.page)) {
                 btn.style.background = '#111827';
                 btn.style.color = '#fff';
               }
               btn.addEventListener('click', () => load(i));
               pager.appendChild(btn);
            }
          }
        }
      }
    }
    await load(1);
    searchBtn?.addEventListener('click', ()=> load(1));
    btn?.addEventListener('click', async () => {
      if (!file.files[0]) return alert('請選擇檔案');
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', file.files[0]);
      await fetch('/api/admin/media/upload', { method:'POST', headers: { 'CSRF-Token': csrf }, body: fd });
      await load(1);
      alert('已上傳');
    });
    table?.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-media-del]');
      if (del) {
        const id = del.dataset.id;
        if (!id) return;
        if (!confirm('確定刪除此媒體檔案？這會連同實體檔一併刪除')) return;
        await api('DELETE', `/api/admin/media/${id}`);
        await load(1);
        alert('媒體已刪除');
        return;
      }
      const checkbox = e.target.closest('[data-media-check]');
      if (checkbox) {
        const id = checkbox.dataset.id;
        if (checkbox.checked) selected.add(id);
        else selected.delete(id);
        updateDeleteButton();
        if (selectAll) selectAll.checked = table?.querySelectorAll('[data-media-check]').length === selected.size;
      }
    });
    selectAll?.addEventListener('change', () => {
      const checkboxes = table?.querySelectorAll('[data-media-check]') || [];
      checkboxes.forEach(cb => {
        const id = cb.dataset.id;
        cb.checked = selectAll.checked;
        if (selectAll.checked) selected.add(id);
        else selected.delete(id);
      });
      updateDeleteButton();
    });
    deleteSelected?.addEventListener('click', async () => {
      if (!selected.size) return;
      if (!confirm(`確定刪除 ${selected.size} 個檔案？此操作會一併移除實體檔案`)) return;
      for (const id of Array.from(selected)) {
        await api('DELETE', `/api/admin/media/${id}`);
      }
      await load(1);
      alert('選取媒體已刪除');
    });
  }

  // USERS (admin only)
  async function initUsers() {
    const table = document.getElementById('users-table');
    const form = document.getElementById('users-form');
    if (!table || !form) return;
    async function load() {
      const rows = await api('GET', '/api/admin/users');
      const tbody = table.querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.id}</td>
          <td>${u.username}</td>
          <td>
            <select data-role data-id="${u.id}">
              <option value="admin" ${u.role==='admin'?'selected':''}>admin</option>
              <option value="editor" ${u.role==='editor'?'selected':''}>editor</option>
            </select>
          </td>
          <td>
            <label style="display:inline-flex;align-items:center;gap:6px">
              <input type="checkbox" data-mustchange data-id="${u.id}" ${u.must_change_password? 'checked':''}>
              <span>需改密碼</span>
            </label>
          </td>
          <td>
            <button class="btn" data-save data-id="${u.id}">儲存</button>
            <button class="btn ghost" data-resetpw data-id="${u.id}">改密碼</button>
            <button class="btn ghost" data-del data-id="${u.id}" style="color:#c00;border-color:#fecaca;">刪除</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
    await load();
    table.addEventListener('click', async (e) => {
      const saveBtn = e.target.closest('[data-save]');
      const delBtn = e.target.closest('[data-del]');
      const pwBtn = e.target.closest('[data-resetpw]');
      if (saveBtn) {
        const id = saveBtn.getAttribute('data-id');
        const row = saveBtn.closest('tr');
        const roleSel = row.querySelector('[data-role]');
        const must = row.querySelector('[data-mustchange]');
        await api('PUT', `/api/admin/users/${id}`, { role: roleSel.value, must_change_password: must.checked ? 1 : 0 });
        alert('已更新');
      } else if (pwBtn) {
        const id = pwBtn.getAttribute('data-id');
        const newpw = prompt('輸入新密碼（至少 4 碼）');
        if (!newpw) return;
        await api('POST', `/api/admin/users/${id}/password`, { new_password: newpw });
        alert('密碼已更新');
      } else if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        if (!confirm('確定刪除此使用者？')) return;
        await api('DELETE', `/api/admin/users/${id}`);
        await load();
        alert('已刪除');
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      await api('POST', '/api/admin/users', data);
      form.reset();
      await load();
      alert('已新增');
    });
  }

  async function initMembers() {
    const table = document.getElementById('members-table');
    const form = document.getElementById('members-form');
    if (!table || !form) return;
    let rows = await api('GET', '/api/admin/members');
    const tbody = table.querySelector('tbody');
    function render() {
      tbody.innerHTML = '';
      rows.forEach(m => {
        const displayName = m.chinese_name || m.english_name || m.name || m.email;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${m.id}</td><td>${m.email}</td><td>${displayName}</td><td>${m.tier}</td><td>${m.is_active?'✔':'—'}</td><td><button data-edit="${m.id}">編輯</button> <button data-del="${m.id}">刪除</button> <button data-expand="${m.id}">展開</button></td>`;
        tbody.appendChild(tr);
        const exp = document.createElement('tr');
        exp.className = 'hidden';
        exp.dataset.detailFor = m.id;
        exp.innerHTML = `<td colspan="6" style="background:#fafafa">
          <div data-detail-box style="padding:8px">載入中...</div>
        </td>`;
        tbody.appendChild(exp);
      });
    }
    render();
    document.getElementById('m-search')?.addEventListener('click', async () => {
      const q = document.getElementById('m-q').value.trim();
      rows = await api('GET', `/api/admin/members${q?`?q=${encodeURIComponent(q)}`:''}`);
      render();
    });
    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.edit || btn.dataset.del || btn.dataset.expand; if (!id) return;
      if (btn.dataset.edit) {
        rows = await api('GET', '/api/admin/members');
        const m = rows.find(x => String(x.id) === String(id)); if (!m) return;
        form.querySelector('[name="id"]').value = m.id;
        document.getElementById('m-email').value = m.email || '';
        document.getElementById('m-name').value = m.chinese_name || m.name || '';
        document.getElementById('m-tier').value = m.tier || 'free';
        document.getElementById('m-active').checked = !!m.is_active;
      } else if (btn.dataset.del) {
        if (!confirm('確定刪除？')) return;
        await api('DELETE', `/api/admin/members/${id}`);
        rows = await api('GET', '/api/admin/members');
        render();
      } else if (btn.dataset.expand) {
        const detailRow = tbody.querySelector(`tr[data-detail-for="${id}"]`);
        if (detailRow) {
          detailRow.classList.toggle('hidden');
          // toggle button text 展開/收起
          btn.textContent = detailRow.classList.contains('hidden') ? '展開' : '收起';
          const box = detailRow.querySelector('[data-detail-box]');
          if (box && !box.dataset.loaded) {
            const prof = await api('GET', `/api/admin/members/${id}`);
            const files = await api('GET', `/api/admin/members/${id}/files`);
            const labels = {
              email: '電子郵件',
              username: '帳號',
              name: '姓名',
              chinese_name: '中文姓名',
              english_name: '英文姓名',
              gender: '性別',
              birth_date: '出生日期',
              id_number: '身分證字號',
              phone_mobile: '行動電話',
              phone_landline: '市話',
              address: '通訊地址',
              line_id: 'LINE ID',
              special_needs: '特殊需求',
              referrer: '推薦人/介紹人',
              tier: '等級',
              created_at: '建立時間'
            };
            function fmtVal(key, val){
              if (val == null) return '';
              if (key === 'gender') return val === 'male' ? '男' : (val === 'female' ? '女' : '其他');
              if (key === 'birth_date' || key === 'created_at') {
                try {
                  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false }).format(new Date(val));
                } catch { return String(val); }
              }
              return String(val);
            }
            const order = ['email','username','chinese_name','english_name','name','gender','birth_date','id_number','phone_mobile','phone_landline','address','line_id','special_needs','referrer','tier','created_at'];
            box.innerHTML = `
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-bottom:12px;font-size:16px">
                ${order.map(k=>`<div><strong>${labels[k]||k}</strong><div>${fmtVal(k, prof?.[k])}</div></div>`).join('')}
              </div>
              <div><strong>上傳檔案</strong>
                <div data-files-box style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
                  ${(files.items||[]).map(f=>`
                    <span class="chip">
                      <a class="btn ghost" href="${f.url}" download>${f.name}</a>
                      <button class="btn ghost" data-file-del data-name="${encodeURIComponent(f.name)}" data-mid="${id}" style="color:#c00;border-color:#fecaca;">刪除</button>
                    </span>
                  `).join('') || '—'}
                </div>
              </div>`;
            box.dataset.loaded = '1';
          }
        }
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form); const data = Object.fromEntries(fd.entries());
      data.is_active = document.getElementById('m-active').checked ? 1 : 0;
      const id = data.id; delete data.id; delete data.email;
      await api('PUT', `/api/admin/members/${id}`, data);
      rows = await api('GET', '/api/admin/members');
      render();
      alert('已儲存');
    });
  }

  async function initLegendPicker() {
    const picker = document.getElementById('legend-picker'); if (!picker) return;
    const grid = document.getElementById('legend-picker-grid'); const pager=document.getElementById('legend-picker-pager');
    async function loadMedia(page=1){ const data=await api('GET', `/api/admin/media?page=${page}&limit=24`); grid.innerHTML=''; data.items.forEach(it=>{ const btn=document.createElement('button'); btn.className='btn ghost'; btn.style.display='block'; btn.style.padding='0'; btn.style.borderRadius='12px'; btn.style.overflow='hidden'; btn.style.border='1px solid #e5e7eb'; btn.style.background='#fff'; btn.innerHTML=`<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style=\"padding:8px 10px;font-size:12px;color:#374151;\">${it.file_name}</div>`; btn.addEventListener('click',()=>{ const input=document.getElementById('legend-cover'); if (input) input.value = it.id || ''; picker.style.display='none'; }); grid.appendChild(btn); }); pager.innerHTML=''; const totalPages=Math.ceil(data.total/data.limit); for(let i=1;i<=totalPages;i++){ const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px'; if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; } a.addEventListener('click',(e)=>{e.preventDefault(); loadMedia(i);}); pager.appendChild(a);} }
    document.getElementById('legend-picker-close')?.addEventListener('click',(e)=>{e.preventDefault(); picker.style.display='none';});
    document.getElementById('legend-cover-pick')?.addEventListener('click',()=>{ picker.style.display='block'; loadMedia(1); });
    document.getElementById('legend-cover-upload')?.addEventListener('click',()=> document.getElementById('legend-cover-file').click());
    document.getElementById('legend-cover-file')?.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.media_id){ const input=document.getElementById('legend-cover'); if (input) input.value=j.media_id; } });
  }

  // LEGEND rich editor (傳奇榜)
  async function initLegendEditor() {
    const table = document.getElementById('leaderboard-table');
    const form = document.getElementById('leaderboard-form');
    const editor = document.getElementById('legend-editor');
    const toolbar = document.getElementById('legend-toolbar');
    if (!table || !form || !editor) return;

    let rows = await api('GET', '/api/admin/leaderboard');
    const tbody = table.querySelector('tbody');
    function renderList() {
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.slug}</td><td>${r.is_published ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
        tbody.appendChild(tr);
      });
    }
    renderList();

    toolbar?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      const cmd = btn.getAttribute('data-cmd');
      const val = btn.getAttribute('data-value') || null;
      document.execCommand(cmd, false, val);
    });
    document.getElementById('legend-insert-img')?.addEventListener('click', ()=> document.getElementById('legend-insert-file').click());
    document.getElementById('legend-insert-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch('/api/admin/media/upload', { method:'POST', headers:{ 'CSRF-Token': csrf }, body: fd, credentials:'same-origin' });
      const j = await res.json();
      if (j?.path) { const img = document.createElement('img'); img.src = j.path; img.alt=''; editor.appendChild(img); }
    });

    // cover pick/upload
    const picker = document.getElementById('legend-picker');
    const pickerGrid = document.getElementById('legend-picker-grid');
    const pickerPager = document.getElementById('legend-picker-pager');
    async function loadLegendMedia(page=1){
      const data = await api('GET', `/api/admin/media?page=${page}&limit=24`);
      pickerGrid.innerHTML = '';
      data.items.forEach(it => {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.style.display = 'block';
        btn.style.padding = '0';
        btn.style.borderRadius = '12px';
        btn.style.overflow = 'hidden';
        btn.style.border = '1px solid #e5e7eb';
        btn.style.background = '#fff';
        btn.innerHTML = `<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style=\"padding:8px 10px;font-size:12px;color:#374151;\">${it.file_name}</div>`;
        btn.addEventListener('click',()=>{ document.getElementById('legend-cover').value = it.id || ''; picker.style.display='none'; });
        pickerGrid.appendChild(btn);
      });
      pickerPager.innerHTML='';
      const totalPages = Math.ceil(data.total / data.limit);
      for (let i=1;i<=totalPages;i++){
        const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px';
        if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; }
        a.addEventListener('click',(e)=>{ e.preventDefault(); loadLegendMedia(i); });
        pickerPager.appendChild(a);
      }
    }
    document.getElementById('legend-picker-close')?.addEventListener('click',(e)=>{ e.preventDefault(); picker.style.display='none'; });
    document.getElementById('legend-cover-pick')?.addEventListener('click',()=>{ picker.style.display='block'; loadLegendMedia(1); });
    document.getElementById('legend-cover-upload')?.addEventListener('click',()=> document.getElementById('legend-cover-file').click());
    document.getElementById('legend-cover-file')?.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.media_id) document.getElementById('legend-cover').value=j.media_id; });

    // edit/delete/save
    tbody.addEventListener('click', async (e) => {
      const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
      if (e.target.dataset.edit) {
        rows = await api('GET', '/api/admin/leaderboard');
        const r = rows.find(x => String(x.id) === String(id)); if (!r) return;
        document.getElementById('legend-title').value = r.title || '';
        document.getElementById('legend-slug').value = r.slug || '';
        document.getElementById('legend-excerpt').value = r.excerpt || '';
        editor.innerHTML = r.content_html || '';
        document.getElementById('legend-cover').value = r.cover_media_id || '';
        document.getElementById('legend-published').value = r.published_at || '';
        document.getElementById('legend-published-flag').checked = !!r.is_published;
        form.querySelector('[name="id"]').value = r.id;
      } else if (e.target.dataset.del) {
        if (!confirm('確定刪除？')) return;
        await api('DELETE', `/api/admin/leaderboard/${id}`);
        rows = await api('GET', '/api/admin/leaderboard');
        renderList();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form); const data = Object.fromEntries(fd.entries());
      data.excerpt = document.getElementById('legend-excerpt').value;
      data.content_html = editor.innerHTML;
      data.cover_media_id = document.getElementById('legend-cover').value || null;
      data.published_at = document.getElementById('legend-published').value || null;
      data.is_published = document.getElementById('legend-published-flag').checked ? 1 : 0;
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/leaderboard/${id}`, data);
      else await api('POST', '/api/admin/leaderboard', data);
      rows = await api('GET', '/api/admin/leaderboard');
      renderList();
      alert('已儲存');
    });
  }

  // LOGIN
  async function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const csrf = await getCsrf();
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrf }, body: JSON.stringify(data) });
      const msg = document.getElementById('msg');
      if (res.ok) {
        const user = await res.json();
        if (user.must_change_password) location.href = '/admin/change-password.html';
        else location.href = '/admin/index.html';
      } else {
        msg && (msg.textContent = '登入失敗');
      }
    });
  }

  // CHANGE PASSWORD
  async function initChangePassword() {
    const form = document.getElementById('cp-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const csrf = await getCsrf();
      const res = await fetch('/api/admin/users/me/password', { method:'POST', headers: { 'Content-Type':'application/json','CSRF-Token': csrf }, body: JSON.stringify(data) });
      if (res.ok) {
        location.href = '/admin/index.html';
      } else {
        const msg = document.getElementById('msg');
        let err = '更新失敗';
        try {
          const j = await res.json();
          if (j && j.error) err = j.error;
        } catch {}
        if (msg) msg.textContent = err;
      }
    });
  }

  // SLIDES
  async function initSlides() {
    const table = document.getElementById('slides-table');
    const form = document.getElementById('slides-form');
    if (!table || !form) return;
    const rows = await api('GET', '/api/admin/slides');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.title || ''}</td><td>${r.order_index}</td><td>${r.is_active ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.addEventListener('click', async (e) => {
      const id = e.target.dataset.edit || e.target.dataset.del;
      if (!id) return;
      if (e.target.dataset.edit) {
        const r = rows.find(x => String(x.id) === String(id));
        for (const [k, v] of Object.entries(r)) {
          const el = form.querySelector(`[name="${k}"]`);
          if (!el) continue;
          if (el.type === 'checkbox') el.checked = !!Number(v);
          else el.value = v ?? '';
        }
        form.querySelector('[name="id"]').value = r.id;
      } else if (e.target.dataset.del) {
        if (!confirm('確定刪除？')) return;
        await api('DELETE', `/api/admin/slides/${id}`);
        location.reload();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.is_active = form.querySelector('[name="is_active"]').checked ? 1 : 0;
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/slides/${id}`, data);
      else await api('POST', `/api/admin/slides`, data);
      location.reload();
    });
    document.getElementById('slides-delete')?.addEventListener('click', async () => {
      const id = form.querySelector('[name="id"]').value; if (!id) return;
      if (!confirm('確定刪除？')) return;
      await api('DELETE', `/api/admin/slides/${id}`);
      location.reload();
    });

    // Direct upload for slide media
    const uploadBtn = document.getElementById('slide-upload-btn');
    const uploadInput = document.getElementById('slide-upload-file');
    uploadBtn?.addEventListener('click', (e) => { e.preventDefault(); uploadInput?.click(); });
    uploadInput?.addEventListener('change', async () => {
      if (!uploadInput.files || !uploadInput.files[0]) return;
      const csrf = await getCsrf();
      const fd = new FormData();
      fd.append('file', uploadInput.files[0]);
      const res = await fetch('/api/admin/media/upload', { method:'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j && j.media_id) {
        form.querySelector('[name="media_id"]').value = j.media_id;
      }
    });
  }

  // COURSES & MATERIALS on dashboard
  async function initCoursesMaterials() {
    // Courses
    const cTable = document.getElementById('courses-table');
    const cForm = document.getElementById('courses-form');
    if (cTable && cForm) {
      async function loadCourses(){
        const rows = await api('GET','/api/admin/courses');
        const tbody = cTable.querySelector('tbody'); tbody.innerHTML='';
        rows.forEach(r=>{
          const tr=document.createElement('tr');
          tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.category||''}</td><td>${r.min_tier}</td><td>${r.is_active?'✔':'—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
          tbody.appendChild(tr);
        });
        tbody.addEventListener('click', async (e)=>{
          const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
          if (e.target.dataset.edit){
            const rows = await api('GET','/api/admin/courses'); const r = rows.find(x=> String(x.id)===String(id)); if (!r) return;
            cForm.querySelector('[name="id"]').value = r.id;
            cForm.querySelector('[name="title"]').value = r.title || '';
            cForm.querySelector('[name="video_url"]').value = r.video_url || '';
            cForm.querySelector('[name="category"]').value = r.category || '';
            cForm.querySelector('[name="min_tier"]').value = r.min_tier || 'free';
            cForm.querySelector('[name="is_active"]').checked = !!r.is_active;
          } else if (e.target.dataset.del){
            if (!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/courses/${id}`); location.reload();
          }
        });
      }
      await loadCourses();
      cForm.addEventListener('submit', async (e)=>{
        e.preventDefault(); const fd=new FormData(cForm); const data=Object.fromEntries(fd.entries()); data.is_active=cForm.querySelector('[name="is_active"]').checked?1:0; const id=data.id; delete data.id; if (id) await api('PUT', `/api/admin/courses/${id}`, data); else await api('POST','/api/admin/courses', data); location.reload();
      });
      document.getElementById('courses-delete')?.addEventListener('click', async ()=>{ const id=cForm.querySelector('[name="id"]').value; if(!id) return; if (!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/courses/${id}`); location.reload(); });
    }
    // Materials
    const mTable = document.getElementById('materials-table');
    const mForm = document.getElementById('materials-form');
    if (mTable && mForm) {
      async function loadMaterials(){
        const rows = await api('GET','/api/admin/materials');
        const tbody = mTable.querySelector('tbody'); tbody.innerHTML='';
        rows.forEach(r=>{
          const tr=document.createElement('tr');
          tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.file_name}</td><td>${r.min_tier}</td><td>${r.is_active?'✔':'—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
          tbody.appendChild(tr);
        });
        tbody.addEventListener('click', async (e)=>{
          const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
          if (e.target.dataset.edit){
            const rows = await api('GET','/api/admin/materials'); const r = rows.find(x=> String(x.id)===String(id)); if (!r) return;
            mForm.querySelector('[name="id"]').value = r.id;
            mForm.querySelector('[name="title"]').value = r.title || '';
            mForm.querySelector('[name="media_id"]').value = r.media_id || '';
            mForm.querySelector('[name="min_tier"]').value = r.min_tier || 'free';
            mForm.querySelector('[name="is_active"]').checked = !!r.is_active;
          } else if (e.target.dataset.del){ if (!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/materials/${id}`); location.reload(); }
        });
      }
      await loadMaterials();
      mForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const fd=new FormData(mForm); const data=Object.fromEntries(fd.entries()); data.is_active=mForm.querySelector('[name="is_active"]').checked?1:0; const id=data.id; delete data.id; if (id) await api('PUT', `/api/admin/materials/${id}`, data); else await api('POST', '/api/admin/materials', data); location.reload(); });
      document.getElementById('materials-delete')?.addEventListener('click', async ()=>{ const id=mForm.querySelector('[name="id"]').value; if(!id) return; if(!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/materials/${id}`); location.reload(); });
      // pick
      document.getElementById('materials-pick')?.addEventListener('click', ()=>{ window.open('/admin/media.html','_blank'); alert('請在媒體庫取得檔案的 ID 後填入'); });
      // direct upload
      const upBtn = document.getElementById('materials-upload');
      const upFile = document.getElementById('materials-file');
      upBtn?.addEventListener('click', ()=> upFile?.click());
      upFile?.addEventListener('change', async ()=>{
        if (!upFile.files || !upFile.files[0]) return;
        const csrf = await getCsrf();
        const fd = new FormData(); fd.append('file', upFile.files[0]);
        const res = await fetch('/api/admin/media/upload', { method:'POST', headers:{ 'CSRF-Token': csrf }, body: fd, credentials:'same-origin' });
        const j = await res.json();
        if (j?.media_id) mForm.querySelector('[name="media_id"]').value = j.media_id;
        else alert('上傳失敗');
      });
    }
  }

  function bindLogout() {
    const btn = document.getElementById('logout');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const csrf = await getCsrf();
      await fetch('/api/admin/logout', { method: 'POST', headers: { 'CSRF-Token': csrf } });
      location.href = '/admin/login.html';
    });
  }

  async function init() {
    const page = getPage();
    await guard();
    await injectAdminHeader();
    if (page === 'login.html') { await initLogin(); return; }
    if (page === 'settings.html') await initSettings();
    if (page === 'menus.html') await initMenus();
    if (page === 'pages.html') await bindCrudList('pages');
    if (page === 'posts.html') { await initPostsEditor(); }
    if (page === 'news.html') await bindCrudList('news');
    if (page === 'news.html') await initNewsEditor();
    if (page === 'leaderboard.html') { await initLegendEditor(); await initLegendPicker(); }
    if (page === 'plans.html') await initPlansEditor();
    if (page === 'trial.html') await initTrial();
    if (page === 'contacts.html') await initContacts();
    if (page === 'media.html') await initMedia();
    if (page === 'users.html') await initUsers();
    if (page === 'members.html') await initMembers();
    if (page === 'change-password.html') await initChangePassword();
    if (page === 'index.html') await initSlides();
    if (page === 'courses.html' || page === 'materials.html') await initCoursesMaterials();
    if (page === 'about.html') await initAboutEditors();
    if (page === 'testimonials.html') await initTestimonials();
  }

  window.addEventListener('DOMContentLoaded', init);

  // TESTIMONIALS (實例見證)
  async function initTestimonials() {
    const table = document.getElementById('testimonials-table');
    const form = document.getElementById('testimonials-form');
    const editor = document.getElementById('testimonials-editor');
    const toolbar = document.getElementById('testimonials-toolbar');
    if (!table || !form || !editor) return;

    // List
    async function renderList() {
      const rows = await api('GET', '/api/admin/testimonials');
      const tbody = table.querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.slug}</td><td>${r.is_published ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
        tbody.appendChild(tr);
      });
    }
    await renderList();

    // Editor toolbar
    toolbar?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      const cmd = btn.getAttribute('data-cmd');
      const val = btn.getAttribute('data-value') || null;
      document.execCommand(cmd, false, val);
    });
    document.getElementById('testimonials-insert-img')?.addEventListener('click', () => document.getElementById('testimonials-insert-file').click());
    document.getElementById('testimonials-insert-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch('/api/admin/media/upload', { method:'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j?.path) { const img = document.createElement('img'); img.src = j.path; img.alt = ''; editor.appendChild(img); }
    });

    // Cover picker
    const picker = document.getElementById('testimonials-picker');
    const pickerGrid = document.getElementById('testimonials-picker-grid');
    const pickerPager = document.getElementById('testimonials-picker-pager');
    async function loadMedia(page=1) {
      const data = await api('GET', `/api/admin/media?page=${page}&limit=24`);
      pickerGrid.innerHTML = '';
      data.items.forEach(it => {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.style.display = 'block';
        btn.style.padding = '0';
        btn.style.borderRadius = '12px';
        btn.style.overflow = 'hidden';
        btn.style.border = '1px solid #e5e7eb';
        btn.style.background = '#fff';
        btn.innerHTML = `<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style="padding:8px 10px;font-size:12px;color:#374151;">${it.file_name}</div>`;
        btn.addEventListener('click', () => { document.getElementById('testimonials-cover').value = it.id || ''; picker.style.display='none'; });
        pickerGrid.appendChild(btn);
      });
      // Pager
      pickerPager.innerHTML = '';
      const totalPages = Math.ceil(data.total / data.limit);
      for (let i = 1; i <= totalPages; i++) {
        const a = document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost';
        if (i === data.page) { a.style.background='#111827'; a.style.color='#fff'; }
        a.addEventListener('click', (e) => { e.preventDefault(); loadMedia(i); });
        pickerPager.appendChild(a);
      }
    }
    document.getElementById('testimonials-picker-close')?.addEventListener('click', (e) => { e.preventDefault(); picker.style.display='none'; });
    document.getElementById('testimonials-cover-pick')?.addEventListener('click', () => { picker.style.display='block'; loadMedia(1); });
    document.getElementById('testimonials-cover-upload')?.addEventListener('click', () => document.getElementById('testimonials-cover-file').click());
    document.getElementById('testimonials-cover-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch('/api/admin/media/upload', { method: 'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j?.media_id) document.getElementById('testimonials-cover').value = j.media_id;
    });

    // Form actions
    table.addEventListener('click', async (e) => {
      const id = e.target.dataset.edit || e.target.dataset.del;
      if (!id) return;
      if (e.target.dataset.edit) {
        const rows = await api('GET', '/api/admin/testimonials');
        const r = rows.find(x => String(x.id) === String(id));
        if (!r) return;
        form.querySelector('[name="title"]').value = r.title || '';
        form.querySelector('[name="slug"]').value = r.slug || '';
        form.querySelector('[name="excerpt"]').value = r.excerpt || '';
        form.querySelector('[name="video_url"]').value = r.video_url || '';
        form.querySelector('[name="id"]').value = r.id;
        document.getElementById('testimonials-cover').value = r.cover_media_id || '';
        document.getElementById('testimonials-published').value = r.published_at || '';
        document.getElementById('testimonials-published-flag').checked = !!r.is_published;
        editor.innerHTML = r.content_html || '';
      } else if (e.target.dataset.del) {
        if (!confirm('確定刪除？')) return;
        await api('DELETE', `/api/admin/testimonials/${id}`);
        await renderList();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.content_html = editor.innerHTML;
      data.cover_media_id = document.getElementById('testimonials-cover').value || null;
      data.is_published = document.getElementById('testimonials-published-flag').checked ? 1 : 0;
      
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/testimonials/${id}`, data);
      else await api('POST', '/api/admin/testimonials', data);
      
      form.reset();
      editor.innerHTML = '';
      await renderList();
      alert('已儲存');
    });
  }

  // POSTS rich editor
  async function initPostsEditor() {
    const table = document.getElementById('posts-table');
    const form = document.getElementById('posts-form');
    const editor = document.getElementById('post-editor');
    const toolbar = document.getElementById('post-toolbar');
    if (!table || !form || !editor) return;
    // load list
    const rows = await api('GET', '/api/admin/posts');
    const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
    rows.forEach(r => { const tr=document.createElement('tr'); tr.innerHTML = `<td>${r.id}</td><td>${r.title}</td><td>${r.slug}</td><td>${r.is_published ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`; tbody.appendChild(tr); });
    // toolbar
    toolbar?.addEventListener('click', (e) => { const btn=e.target.closest('[data-cmd]'); if (!btn) return; const cmd=btn.getAttribute('data-cmd'); const val=btn.getAttribute('data-value')||null; document.execCommand(cmd,false,val); });
    document.getElementById('post-insert-img')?.addEventListener('click', ()=> document.getElementById('post-insert-file').click());
    document.getElementById('post-insert-file')?.addEventListener('change', async (e) => { const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.path){ const img=document.createElement('img'); img.src=j.path; img.alt=''; editor.appendChild(img);} });
    // pick/upload cover
    const picker = document.getElementById('posts-picker'); const pickerGrid=document.getElementById('posts-picker-grid'); const pickerPager=document.getElementById('posts-picker-pager');
    async function loadMedia(page=1){ const data=await api('GET', `/api/admin/media?page=${page}&limit=24`); pickerGrid.innerHTML=''; data.items.forEach(it=>{ const btn=document.createElement('button'); btn.className='btn ghost'; btn.style.display='block'; btn.style.padding='0'; btn.style.borderRadius='12px'; btn.style.overflow='hidden'; btn.style.border='1px solid #e5e7eb'; btn.style.background='#fff'; btn.innerHTML=`<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style="padding:8px 10px;font-size:12px;color:#374151;">${it.file_name}</div>`; btn.addEventListener('click',()=>{ document.getElementById('post-cover').value = it.id || ''; picker.style.display='none'; }); pickerGrid.appendChild(btn); }); pickerPager.innerHTML=''; const totalPages=Math.ceil(data.total/data.limit); for(let i=1;i<=totalPages;i++){ const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px'; if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; } a.addEventListener('click',(e)=>{e.preventDefault(); loadMedia(i);}); pickerPager.appendChild(a);} }
    document.getElementById('posts-picker-close')?.addEventListener('click',(e)=>{e.preventDefault(); picker.style.display='none';});
    document.getElementById('post-cover-pick')?.addEventListener('click',()=>{ picker.style.display='block'; loadMedia(1); });
    document.getElementById('post-cover-upload')?.addEventListener('click',()=> document.getElementById('post-cover-file').click());
    document.getElementById('post-cover-file')?.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.media_id) document.getElementById('post-cover').value=j.media_id; });
    // edit/delete
    tbody.addEventListener('click', async (e)=>{
      const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
      if (e.target.dataset.edit){ const r = rows.find(x=> String(x.id)===String(id)); if (!r) return; document.getElementById('post-title').value=r.title||''; document.getElementById('post-slug').value=r.slug||''; document.getElementById('post-excerpt').value=r.excerpt||''; editor.innerHTML=r.content_html||''; document.getElementById('post-cover').value=r.cover_media_id||''; document.getElementById('post-published').value=r.published_at||''; document.getElementById('post-published-flag').checked=!!r.is_published; form.querySelector('[name="id"]').value=r.id; }
      else if (e.target.dataset.del){ if (!confirm('確定刪除？')) return; await api('DELETE', `/api/admin/posts/${id}`); location.reload(); }
    });
    form.addEventListener('submit', async (e)=>{ e.preventDefault(); const fd=new FormData(form); const data=Object.fromEntries(fd.entries()); data.excerpt=document.getElementById('post-excerpt').value; data.content_html=editor.innerHTML; data.cover_media_id=document.getElementById('post-cover').value||null; data.published_at=document.getElementById('post-published').value||null; data.is_published=document.getElementById('post-published-flag').checked?1:0; const id=data.id; delete data.id; if (id) await api('PUT', `/api/admin/posts/${id}`, data); else await api('POST', '/api/admin/posts', data); location.reload(); });
  }

  // PLANS rich editor (same UX as posts/news)
  async function initPlansEditor() {
    const table = document.getElementById('plans-table');
    const form = document.getElementById('plans-form');
    const editor = document.getElementById('plan-editor');
    const toolbar = document.getElementById('plan-toolbar');
    if (!table || !form || !editor) return;
    const rows = await api('GET', '/api/admin/plans');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.name || ''}</td><td>${r.slug || ''}</td><td>${r.is_published ? '✔' : '—'}</td><td><button data-edit="${r.id}">編輯</button> <button data-del="${r.id}">刪除</button></td>`;
      tbody.appendChild(tr);
    });
    toolbar?.addEventListener('click', (e) => { const btn=e.target.closest('[data-cmd]'); if (!btn) return; const cmd=btn.getAttribute('data-cmd'); const val=btn.getAttribute('data-value')||null; document.execCommand(cmd,false,val); });
    document.getElementById('plan-insert-img')?.addEventListener('click', ()=> document.getElementById('plan-insert-file').click());
    document.getElementById('plan-insert-file')?.addEventListener('change', async (e) => { const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.path){ const img=document.createElement('img'); img.src=j.path; img.alt=''; editor.appendChild(img);} });
    // cover pick/upload
    const picker = document.createElement('div'); picker.id='plans-picker'; picker.className='modal'; picker.style.display='none'; picker.innerHTML = `<div class="modal-card"><header><strong>選擇封面</strong><button id="plans-picker-close" class="btn ghost">✕</button></header><div id="plans-picker-grid" class="grid horizontal-cards"></div><footer id="plans-picker-pager"></footer></div>`; document.body.appendChild(picker);
    const pickerGrid = picker.querySelector('#plans-picker-grid'); const pickerPager = picker.querySelector('#plans-picker-pager');
    async function loadMedia(page=1){ const data=await api('GET', `/api/admin/media?page=${page}&limit=24`); pickerGrid.innerHTML=''; data.items.forEach(it=>{ const btn=document.createElement('button'); btn.className='btn ghost'; btn.style.display='block'; btn.style.padding='0'; btn.style.borderRadius='12px'; btn.style.overflow='hidden'; btn.style.border='1px solid #e5e7eb'; btn.style.background='#fff'; btn.innerHTML=`<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style="padding:8px 10px;font-size:12px;color:#374151;">${it.file_name}</div>`; btn.addEventListener('click',()=>{ document.getElementById('plan-cover').value = it.id || ''; picker.style.display='none'; }); pickerGrid.appendChild(btn); }); pickerPager.innerHTML=''; const totalPages=Math.ceil(data.total/data.limit); for(let i=1;i<=totalPages;i++){ const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px'; if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; } a.addEventListener('click',(e)=>{e.preventDefault(); loadMedia(i);}); pickerPager.appendChild(a);} }
    picker.querySelector('#plans-picker-close')?.addEventListener('click',(e)=>{e.preventDefault(); picker.style.display='none';});
    document.getElementById('plan-cover-pick')?.addEventListener('click',()=>{ picker.style.display='block'; loadMedia(1); });
    document.getElementById('plan-cover-upload')?.addEventListener('click',()=> document.getElementById('plan-cover-file').click());
    document.getElementById('plan-cover-file')?.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if (!f) return; const csrf=await getCsrf(); const fd=new FormData(); fd.append('file', f); const res=await fetch('/api/admin/media/upload',{method:'POST', headers:{'CSRF-Token': csrf}, body: fd, credentials:'same-origin'}); const j=await res.json(); if (j?.media_id) document.getElementById('plan-cover').value=j.media_id; });
    // edit/delete
    tbody.addEventListener('click', async (e) => {
      const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
      if (e.target.dataset.edit) {
        const r = rows.find(x => String(x.id) === String(id)); if (!r) return;
        form.querySelector('[name="name"]').value = r.name || '';
        form.querySelector('[name="price"]').value = r.price || '';
        form.querySelector('[name="tagline"]').value = r.tagline || '';
        // features removed
        form.querySelector('[name="is_active"]').checked = !!r.is_active;
        document.getElementById('plan-slug').value = r.slug || '';
        editor.innerHTML = r.content_html || '';
        document.getElementById('plan-cover').value = r.cover_media_id || '';
        document.getElementById('plan-published').value = r.published_at || '';
        document.getElementById('plan-published-flag').checked = !!r.is_published;
        form.querySelector('[name="id"]').value = r.id;
      } else if (e.target.dataset.del) {
        if (!confirm('確定刪除？')) return;
        await api('DELETE', `/api/admin/plans/${id}`);
        location.reload();
      }
    });
    // save
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form); const data = Object.fromEntries(fd.entries());
      // features removed
      data.slug = document.getElementById('plan-slug').value;
      data.content_html = editor.innerHTML;
      data.cover_media_id = document.getElementById('plan-cover').value || null;
      data.published_at = document.getElementById('plan-published').value || null;
      data.is_published = document.getElementById('plan-published-flag').checked ? 1 : 0;
      const id = data.id; delete data.id;
      if (id) await api('PUT', `/api/admin/plans/${id}`, data);
      else await api('POST', '/api/admin/plans', data);
      location.reload();
    });
  }
  async function initAboutEditors() {
    function bindToolbar(scope) {
      scope.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cmd]'); if (!btn) return;
        const cmd = btn.getAttribute('data-cmd'); const value = btn.getAttribute('data-value') || null;
        document.execCommand(cmd, false, value);
      });
    }
    try {
      const data = await api('GET', '/api/admin/about');
      if (data?.teacher) document.getElementById('teacher-editor').innerHTML = data.teacher.content_html || '';
      if (data?.aboutus) document.getElementById('aboutus-editor').innerHTML = data.aboutus.content_html || '';
      if (data?.ftmo) document.getElementById('ftmo-editor').innerHTML = data.ftmo.content_html || '';
      if (data?.teacher) document.getElementById('teacher-bg').value = data.teacher.background_image_id || '';
      if (data?.aboutus) document.getElementById('aboutus-bg').value = data.aboutus.background_image_id || '';
      if (data?.ftmo) document.getElementById('ftmo-bg').value = data.ftmo.background_image_id || '';
    } catch {}

    async function uploadAndInsert(file, editorEl) {
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/admin/media/upload', { method:'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j?.path) { const img = document.createElement('img'); img.src = j.path; img.alt = ''; editorEl.appendChild(img); }
    }

    const tToolbar = document.querySelector('#teacher-editor')?.previousElementSibling;
    const aToolbar = document.querySelector('#aboutus-editor')?.previousElementSibling;
    const fToolbar = document.querySelector('#ftmo-editor')?.previousElementSibling;
    tToolbar && bindToolbar(tToolbar); aToolbar && bindToolbar(aToolbar); fToolbar && bindToolbar(fToolbar);

    document.getElementById('teacher-insert-img')?.addEventListener('click', () => document.getElementById('teacher-file').click());
    document.getElementById('aboutus-insert-img')?.addEventListener('click', () => document.getElementById('aboutus-file').click());
    document.getElementById('ftmo-insert-img')?.addEventListener('click', () => document.getElementById('ftmo-file').click());
    document.getElementById('teacher-file')?.addEventListener('change', (e) => e.target.files[0] && uploadAndInsert(e.target.files[0], document.getElementById('teacher-editor')));
    document.getElementById('aboutus-file')?.addEventListener('change', (e) => e.target.files[0] && uploadAndInsert(e.target.files[0], document.getElementById('aboutus-editor')));
    document.getElementById('ftmo-file')?.addEventListener('change', (e) => e.target.files[0] && uploadAndInsert(e.target.files[0], document.getElementById('ftmo-editor')));

    // BG pickers (simple modal-less picker using the settings picker style)
    // Picker like settings
    const picker = document.getElementById('about-picker');
    const pickerGrid = document.getElementById('about-picker-grid');
    const pickerPager = document.getElementById('about-picker-pager');
    let pickerTarget = null;
    async function loadAboutMedia(page=1){
      const data = await api('GET', `/api/admin/media?page=${page}&limit=24`);
      pickerGrid.innerHTML = '';
      data.items.forEach(it => {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.style.display = 'block'; btn.style.padding = '0'; btn.style.borderRadius = '12px'; btn.style.overflow = 'hidden'; btn.style.border = '1px solid #e5e7eb'; btn.style.background = '#fff';
        btn.innerHTML = `<img src="${it.file_path}" alt="" style="width:100%;height:120px;object-fit:cover"><div style="padding:8px 10px;font-size:12px;color:#374151;">${it.file_name}</div>`;
        btn.addEventListener('click', () => { if (pickerTarget) document.getElementById(pickerTarget).value = it.id || ''; picker.style.display='none'; });
        pickerGrid.appendChild(btn);
      });
      pickerPager.innerHTML = '';
      const totalPages = Math.ceil(data.total / data.limit);
      for (let i=1;i<=totalPages;i++){
        const a=document.createElement('a'); a.href='#'; a.textContent=i; a.className='btn ghost'; a.style.padding='6px 10px'; a.style.borderRadius='8px'; if (i===data.page){ a.style.background='#111827'; a.style.color='#fff'; }
        a.addEventListener('click',(e)=>{e.preventDefault(); loadAboutMedia(i);});
        pickerPager.appendChild(a);
      }
    }
    document.getElementById('about-picker-close')?.addEventListener('click', (e)=>{e.preventDefault(); picker.style.display='none';});
    function pickBg(targetInputId){ pickerTarget = targetInputId; picker.style.display='block'; loadAboutMedia(1); }
    document.getElementById('teacher-bg-pick')?.addEventListener('click', () => pickBg('teacher-bg'));
    document.getElementById('aboutus-bg-pick')?.addEventListener('click', () => pickBg('aboutus-bg'));
    document.getElementById('ftmo-bg-pick')?.addEventListener('click', () => pickBg('ftmo-bg'));

    async function uploadBg(file, targetInputId) {
      const csrf = await getCsrf();
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/admin/media/upload', { method:'POST', headers: { 'CSRF-Token': csrf }, body: fd, credentials: 'same-origin' });
      const j = await res.json();
      if (j?.media_id) document.getElementById(targetInputId).value = j.media_id;
    }
    document.getElementById('teacher-bg-upload')?.addEventListener('click', () => document.getElementById('teacher-bg-file').click());
    document.getElementById('aboutus-bg-upload')?.addEventListener('click', () => document.getElementById('aboutus-bg-file').click());
    document.getElementById('ftmo-bg-upload')?.addEventListener('click', () => document.getElementById('ftmo-bg-file').click());
    document.getElementById('teacher-bg-file')?.addEventListener('change', (e) => e.target.files[0] && uploadBg(e.target.files[0], 'teacher-bg'));
    document.getElementById('aboutus-bg-file')?.addEventListener('change', (e) => e.target.files[0] && uploadBg(e.target.files[0], 'aboutus-bg'));
    document.getElementById('ftmo-bg-file')?.addEventListener('change', (e) => e.target.files[0] && uploadBg(e.target.files[0], 'ftmo-bg'));

    document.getElementById('teacher-save')?.addEventListener('click', async () => {
      await api('POST', '/api/admin/pages', { slug: 'about-teacher', title: '關於院長', content_html: document.getElementById('teacher-editor').innerHTML, background_image_id: document.getElementById('teacher-bg').value || null, is_published: 1 });
      alert('已儲存：關於院長');
    });
    document.getElementById('aboutus-save')?.addEventListener('click', async () => {
      await api('POST', '/api/admin/pages', { slug: 'about-us', title: '關於我們', content_html: document.getElementById('aboutus-editor').innerHTML, background_image_id: document.getElementById('aboutus-bg').value || null, is_published: 1 });
      alert('已儲存：關於我們');
    });
    document.getElementById('ftmo-save')?.addEventListener('click', async () => {
      await api('POST', '/api/admin/pages', { slug: 'about-ftmo', title: '關於 FTMO', content_html: document.getElementById('ftmo-editor').innerHTML, background_image_id: document.getElementById('ftmo-bg').value || null, is_published: 1 });
      alert('已儲存：關於 FTMO');
    });
  }
})();


