(() => {
  async function getProfile(){
    const res = await fetch('/api/public/members/profile');
    if (!res.ok) throw new Error('auth');
    return res.json();
  }
  function showTab(id){
    document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`tab-${id}`)?.classList.remove('hidden');
  }
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const m = await getProfile();
      const box = document.getElementById('tab-profile');
      if (box) {
        const labels = {
          email: '電子郵件',
          username: '帳號',
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
        const order = ['email','username','chinese_name','english_name','gender','birth_date','id_number','phone_mobile','phone_landline','address','line_id','special_needs','referrer','tier','created_at'];
        box.innerHTML = `
          <div class="card profile-card">
            <h2 class="mb-4" style="font-size:22px">基本資料</h2>
            <div class="info-list">
              ${order.map(k=>`<div class="info-row"><div class="label">${labels[k]||k}</div><div class="value">${fmtVal(k, m?.[k])}</div></div>`).join('')}
            </div>
          </div>`;
      }
      document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab'))));
      // Load course contents (YouTube list) per member tier, grouped by category, with disclaimer modal
      try {
        const resC = await fetch('/api/public/courses', { credentials: 'same-origin' });
        if (resC.ok) {
          const rows = await resC.json();
          const host = document.getElementById('tab-courses');
          if (host) {
            const byCat = rows.reduce((acc, r) => { const k=r.category||'未分類'; (acc[k]=acc[k]||[]).push(r); return acc; }, {});
            let html = `<div class="card"><h2 class="mb-2">上課內容</h2>`;
            for (const [cat, list] of Object.entries(byCat)) {
              html += `<section class="course-section"><h3 class="course-title">${cat}</h3>`;
              html += list.map(r=>`
                <div class="course-item">
                  <div class="course-item-title"><strong>${r.title}</strong><span class="tier">(${r.min_tier})</span></div>
                  <div class="course-item-actions"><a class="btn ghost course-link" data-href="${r.video_url}" href="#">觀看</a></div>
                </div>
              `).join('');
              html += `</section>`;
            }
            html += `</div>`;
            host.innerHTML = html;
            // disclaimer modal (text only)
            const modal = document.createElement('div');
            modal.className = 'modal'; modal.style.display='none';
            modal.innerHTML = `<div class="modal-card" style="max-width:560px">
              <header><strong>注意事項</strong><button id="disc-close" class="btn ghost">✕</button></header>
              <div style="max-height:60vh;overflow:auto">
                <ol style="padding-left:20px;line-height:1.6">
                  <li>乙方年齡應達成年方能使用本平台，若經法定代理人同意者，不在此限。</li>
                  <li>若乙方於本平台上觀看有關投資技術、觀念教學之課程，相關課程中不得實際帶領學員操作股票、有價證券、期貨或其他投資標的買賣，抑或報牌、代單、帶進帶出或代為操作服務，亦不得給予學員進出場訊息。</li>
                  <li>本平台上所載有關投資技術、觀念教學之課程，與證券投資顧問事業、期貨顧問事業或其他需經核准之顧問事業無涉，僅為投資觀念教學、過往投資經驗分享。</li>
                  <li>若有違反前二條規定之情，或有私下為證券投資顧問事業、期貨顧問事業或其他需經核准之顧問事業行為，其行為係與本平台無涉，學員應於知悉時通知平台協助處理違反本平台使用規範之行為。</li>
                </ol>
              </div>
              <footer style="display:flex;justify-content:flex-end;gap:8px"><button id="disc-ok" class="btn">我同意</button><button id="disc-cancel" class="btn ghost">取消</button></footer>
            </div>`;
            document.body.appendChild(modal);
            let pendingHref = null;
            host.querySelectorAll('.course-link').forEach(a => a.addEventListener('click', (e)=>{ e.preventDefault(); pendingHref = a.getAttribute('data-href'); modal.style.display='block'; }));
            modal.querySelector('#disc-close')?.addEventListener('click', ()=>{ modal.style.display='none'; pendingHref=null; });
            modal.querySelector('#disc-cancel')?.addEventListener('click', ()=>{ modal.style.display='none'; pendingHref=null; });
            modal.querySelector('#disc-ok')?.addEventListener('click', ()=>{ const url=pendingHref; pendingHref=null; modal.style.display='none'; if (url) window.open(url,'_blank'); });
          }
        }
      } catch {}
      // Load materials list per member tier
      try {
        const resM = await fetch('/api/public/materials', { credentials: 'same-origin' });
        if (resM.ok) {
          const rows = await resM.json();
          const host = document.getElementById('tab-materials');
          if (host) {
            host.innerHTML = `<div class="card"><h2 class="mb-2">教材下載</h2><ul>${rows.map(r=>`<li class="mb-1"><a href="${r.file_path}" download>${r.title || r.file_name}</a> <span style="color:#6b7280">(${r.min_tier})</span></li>`).join('')}</ul></div>`;
          }
        }
      } catch {}
      async function getCsrf(){ const r = await fetch('/api/public/csrf', { credentials: 'same-origin' }); const j = await r.json(); return j?.csrfToken; }
      async function refreshMyFiles(){
        try {
          const r = await fetch('/api/public/members/files', { credentials: 'same-origin' });
          const j = await r.json();
          const list = document.getElementById('upload-list');
          if (list) list.innerHTML = (j.items||[]).map(it=>`<li><a href="${it.url}" target="_blank">${it.name}</a></li>`).join('');
        } catch {}
      }
      document.getElementById('upload-contract')?.addEventListener('click', async () => {
        const input = document.getElementById('contract-file');
        const files = input.files;
        if (!files || !files.length) return;
        const msg = document.getElementById('upload-msg');
        const progList = document.getElementById('upload-progress-list');
        const resultList = document.getElementById('upload-list');
        msg.textContent = '';
        progList.innerHTML = '';
        resultList.innerHTML = '';
        const csrf = await getCsrf();
        // per-file XHR with progress
        const uploads = Array.from(files).map((file) => new Promise((resolve) => {
          const wrap = document.createElement('div');
          wrap.style.marginBottom = '8px';
          wrap.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="flex:0 0 220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${file.name}">${file.name}</span><div class="progress" style="flex:1"><div class="bar"></div></div><span class="pct" style="width:48px;text-align:right;font-variant-tabular-nums;">0%</span></div>`;
          const bar = wrap.querySelector('.bar');
          const pct = wrap.querySelector('.pct');
          progList.appendChild(wrap);
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/public/members/upload');
          xhr.withCredentials = true;
          xhr.setRequestHeader('CSRF-Token', csrf);
          const fd = new FormData(); fd.append('files', file);
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const p = Math.round((e.loaded / e.total) * 100);
            if (bar) bar.style.width = `${p}%`;
            if (pct) pct.textContent = `${p}%`;
          };
          xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
              try {
                const resp = JSON.parse(xhr.responseText || '{}');
                if (xhr.status >= 200 && xhr.status < 300 && resp?.ok && Array.isArray(resp.items) && resp.items.length) {
                  const it = resp.items[0];
                  const li = document.createElement('li');
                  const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.textContent = it.name || file.name; li.appendChild(a);
                  resultList.appendChild(li);
                } else {
                  const li = document.createElement('li'); li.textContent = `${file.name} 上傳失敗`; resultList.appendChild(li);
                }
              } catch {
                const li = document.createElement('li'); li.textContent = `${file.name} 上傳失敗`; resultList.appendChild(li);
              }
              resolve();
            }
          };
          xhr.send(fd);
        }));
        await Promise.all(uploads);
        msg.textContent = '全部上傳完成';
        input.value = '';
        await refreshMyFiles();
      });
      // initial load of my files
      await refreshMyFiles();
    } catch {
      location.href = '/login.html';
    }
  });
})();


