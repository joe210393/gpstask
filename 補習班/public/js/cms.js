(() => {
  function q(sel, parent = document) { return parent.querySelector(sel); }
  function qa(sel, parent = document) { return Array.from(parent.querySelectorAll(sel)); }
  async function fetchJson(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  function getQueryParam(name) { return new URLSearchParams(location.search).get(name); }
  function setBackground(url, color) {
    if (url) document.body.style.backgroundImage = `url(${url})`;
    else if (color) document.body.style.background = color;
  }

  function applyBackgroundFromSettings(pageKey, settings) {
    const urlKey = `bg_${pageKey}_url`;
    const colorKey = `bg_${pageKey}_color`;
    const bgUrl = settings[urlKey];
    const bgColor = settings[colorKey] || settings.default_bg_color;
    setBackground(bgUrl || null, bgUrl ? null : bgColor);
  }

  function applyTheme(name) {
    const theme = (name || 'default').toLowerCase();
    const selector = 'link[data-theme-link]';
    document.querySelector(selector)?.remove();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/css/theme-${theme}.css`;
    link.setAttribute('data-theme-link', 'true');
    document.head.appendChild(link);
  }

  async function loadSettings() {
    try {
      const settings = await fetchJson('/api/public/settings');
      applyTheme(settings.theme);
      const lineBtn = q('#line-float');
      if (lineBtn) {
        if (settings.line_url) { lineBtn.href = settings.line_url; lineBtn.style.display = 'flex'; }
        else lineBtn.style.display = 'none';
      }
      return settings;
    } catch {
      const settings = { site_name: 'Site', default_bg_color: '#f5f6f8', theme: 'default' };
      applyTheme('default');
      const lineBtn = q('#line-float'); if (lineBtn) lineBtn.style.display = 'none';
      return settings;
    }
  }

  async function loadPartial(el, url) {
    const res = await fetch(url);
    el.innerHTML = await res.text();
  }

  async function renderHeaderFooter() {
    const header = q('#site-header');
    const footer = q('#site-footer');
    if (header) await loadPartial(header, '/partials/header.html');
    if (footer) await loadPartial(footer, '/partials/footer.html');

    let settings = { site_name: 'Site', default_bg_color: '#f5f6f8' };
    try { settings = await fetchJson('/api/public/settings'); } catch {}
    const brand = q('#brand');
    if (brand) brand.textContent = settings.site_name || 'Site';
    const year = q('#footer-year');
    if (year) year.textContent = new Date().getFullYear();
    const fname = q('#footer-site-name');
    if (fname) fname.textContent = settings.site_name || 'Site';

    const navList = q('#nav-list');
    if (navList) {
      const original = navList.innerHTML;
      try {
        const menus = await fetchJson('/api/public/menus');
        if (Array.isArray(menus) && menus.length > 0) {
          navList.innerHTML = '';
          const roots = menus.filter(m => m.parent_id == null);
          const children = menus.filter(m => m.parent_id != null);
          roots.forEach(r => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = r.url || `/${r.slug || ''}.html`;
            a.textContent = r.title;
            li.appendChild(a);
            const subs = children.filter(c => c.parent_id === r.id);
            if (subs.length) {
              const ul = document.createElement('ul');
              subs.forEach(s => {
                const sli = document.createElement('li');
                const sa = document.createElement('a');
                sa.href = s.url || `/${s.slug || ''}.html`;
                sa.textContent = s.title;
                sli.appendChild(sa);
                ul.appendChild(sli);
              });
              li.appendChild(ul);
            }
            navList.appendChild(li);
          });
        } else {
          // keep static header items if DB has no menus
          navList.innerHTML = original;
        }
      } catch {
        navList.innerHTML = original;
      }
    }

    // Mobile nav toggle
    const toggle = q('#nav-toggle');
    const nav = q('#main-nav');
    toggle?.addEventListener('click', () => nav?.classList.toggle('open'));
    nav?.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      const li = a.parentElement;
      const hasSub = li && li.querySelector('ul');
      if (hasSub) {
        e.preventDefault();
        // toggle open without auto-close on mouseout
        li.classList.toggle('open');
      }
    });
    // Highlight active
    const currentPath = location.pathname.replace(/\/index\.html$/, '/');
    qa('#nav-list a').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      const url = new URL(href, location.origin);
      if (url.pathname === currentPath) a.classList.add('active');
    });

    // Language switch
    const dict = {
      zh: {
        home: '首頁', about: '關於', about_teacher: '關於院長', about_us: '關於我們', about_fund: '關於基金帳戶',
        blog: '部落格', news: '最新消息', leaderboard: '傳奇榜', plans: '課程方案', contact: '聯絡我們', trial: '課程試讀', login: '登入'
      },
      en: {
        home: 'Home', about: 'About', about_teacher: 'About Teacher', about_us: 'About Us', about_fund: 'About Funded Account',
        blog: 'Blog', news: 'News', leaderboard: 'Legends', plans: 'Plans', contact: 'Contact', trial: 'Trial', login: 'Login'
      },
      ja: {
        home: 'ホーム', about: '概要', about_teacher: '講師について', about_us: '私たちについて', about_fund: 'ファンド口座について',
        blog: 'ブログ', news: 'ニュース', leaderboard: 'レジェンド', plans: 'プラン', contact: 'お問い合わせ', trial: '体験講座', login: 'ログイン'
      }
    };
    function applyLang(lang) {
      const d = dict[lang] || dict.zh;
      qa('[data-i18n-key]').forEach(el => {
        const key = el.getAttribute('data-i18n-key');
        if (d[key]) el.textContent = d[key];
      });
      localStorage.setItem('site_lang', lang);
    }
    const langSel = q('#lang-select');
    if (langSel) {
      const saved = localStorage.getItem('site_lang') || 'zh';
      langSel.value = saved;
      applyLang(saved);
      langSel.addEventListener('change', () => applyLang(langSel.value));
    } else {
      applyLang(localStorage.getItem('site_lang') || 'zh');
    }

    // Account box: show member name/email and gear to backend info
    try {
      const me = await fetchJson('/api/public/members/me');
      const box = q('#account-box');
      if (box) {
        box.innerHTML = '';
        if (me && me.id) {
          const name = me.name || me.email || 'Member';
          const label = document.createElement('span');
          label.textContent = name;
          const gear = document.createElement('a');
          gear.href = '/user.html';
          gear.title = '會員中心';
          gear.className = 'btn ghost';
          gear.textContent = '⚙';
          const logout = document.createElement('button');
          logout.className = 'btn ghost';
          logout.textContent = '登出';
          logout.addEventListener('click', async () => {
            try {
              const csrfRes = await fetch('/api/public/csrf', { credentials: 'same-origin' });
              const { csrfToken } = await csrfRes.json();
              await fetch('/api/public/members/logout', { method:'POST', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin' });
            } catch {}
            location.href = '/';
          });
          box.appendChild(label);
          box.appendChild(gear);
          box.appendChild(logout);
        } else {
          const login = document.createElement('a');
          login.href = '/login.html';
          login.className = 'btn ghost';
          login.textContent = '登入';
          box.appendChild(login);
        }
      }
    } catch {}
  }

  function bindList(section, items, mapFn) {
    const tpl = q('#news-item-tpl');
    const target = q('[data-target="list"]', section) || section;
    target.innerHTML = '';
    items.forEach(item => {
      const node = document.importNode(tpl.content, true);
      qa('[data-prop]', node).forEach(el => {
        const [attr, path] = el.getAttribute('data-prop').split(':');
        const value = path.split('.').reduce((o, k) => (o ? o[k] : undefined), mapFn(item));
        if (attr === 'text') el.textContent = value ?? '';
        else el.setAttribute(attr, value ?? '');
      });
      target.appendChild(node);
    });
  }

  async function init() {
    // Render header/footer first so layout is visible even if settings API fails
    await renderHeaderFooter();
    const settings = await loadSettings();
    const page = document.body.dataset.page;
    if (page === 'home') {
      // Load slides
      try {
        const slides = await fetchJson('/api/public/slides');
        const holder = q('#slides');
        const dots = q('#dots');
        const prev = q('#prev');
        const next = q('#next');
        if (holder && slides.length) {
          holder.innerHTML = '';
          slides.forEach((s, idx) => {
            const a = document.createElement('a');
            a.href = s.link_url || '#';
            a.style.opacity = idx === 0 ? '1' : '0';
            a.innerHTML = `<img src="${s.image_url}" alt="${s.title || ''}">`;
            holder.appendChild(a);
          });
          let i = 0;
          function show(n){
            const all = qa('#slides > a');
            i = (n + all.length) % all.length;
            all.forEach((el, idx) => el.style.opacity = idx === i ? '1' : '0');
            qa('#dots button').forEach((d, di) => d.style.opacity = di === i ? '1' : '.4');
          }
          dots.innerHTML = '';
          slides.forEach((_s, di) => { const b=document.createElement('button'); b.className='btn ghost'; b.style.padding='4px 8px'; b.textContent='•'; b.style.opacity = di===0?'1':'.4'; b.addEventListener('click',()=>show(di)); dots.appendChild(b); });
          prev?.addEventListener('click',()=>show(i-1));
          next?.addEventListener('click',()=>show(i+1));
          setInterval(()=>show(i+1), 5000);
        }
      } catch {}
      const data = await fetchJson('/api/public/news?limit=10');
      const section = q('#latest-news');
      bindList(section, data.items, (item) => ({
        title: item.title,
        excerpt: item.excerpt || '',
        cover_url: item.cover_url || '',
        link: `/news-post.html?slug=${encodeURIComponent(item.slug)}`
      }));
      // latest posts top 3
      try {
        const posts = await fetchJson('/api/public/posts?limit=3');
        const sec = q('#latest-posts');
        const tpl = q('#post-item-tpl');
        const target = q('[data-target="list"]', sec);
        target.innerHTML = '';
        posts.items.forEach(item => {
          const node = document.importNode(tpl.content, true);
          qa('[data-prop]', node).forEach(el => {
            const [attr, path] = el.getAttribute('data-prop').split(':');
            let value;
            if (path === 'title') value = item.title;
            else if (path === 'excerpt') value = item.excerpt || '';
            else if (path === 'cover_url') value = item.cover_url || '';
            else if (path === 'link') value = `/blog-post.html?slug=${encodeURIComponent(item.slug)}`;
            if (attr === 'text') el.textContent = value ?? '';
            else el.setAttribute(attr, value ?? '');
          });
          target.appendChild(node);
        });
      } catch {}

      // Top 3 legends
      try {
        const legends = await fetchJson('/api/public/leaderboard');
        const sec = q('#latest-legend');
        const tpl = q('#legend-item-tpl');
        const target = q('[data-target="list"]', sec);
        target.innerHTML = '';
        legends.slice(0, 3).forEach(item => {
          const node = document.importNode(tpl.content, true);
          qa('[data-prop]', node).forEach(el => {
            const [attr, path] = el.getAttribute('data-prop').split(':');
            let value;
            if (path === 'title') value = item.title;
            else if (path === 'excerpt') value = item.excerpt || '';
            else if (path === 'cover_url') value = item.cover_url || '';
            else if (path === 'link') value = `/leaderboard.html`;
            if (attr === 'text') el.textContent = value ?? '';
            else el.setAttribute(attr, value ?? '');
          });
          target.appendChild(node);
        });
      } catch {}
      applyBackgroundFromSettings('home', settings);
    } else if (page === 'blog') {
      const params = new URLSearchParams(location.search);
      const pageNum = Number(params.get('page') || '1');
      const data = await fetchJson(`/api/public/posts?page=${pageNum}&limit=9`);
      const gridWrap = q('#post-list');
      const tpl = q('#post-item-tpl');
      const target = q('[data-target="list"]', gridWrap);
      target.innerHTML = '';
      data.items.forEach(item => {
        const node = document.importNode(tpl.content, true);
        qa('[data-prop]', node).forEach(el => {
          const [attr, path] = el.getAttribute('data-prop').split(':');
          let value;
          if (path === 'title') value = item.title;
          else if (path === 'excerpt') value = item.excerpt || '';
          else if (path === 'cover_url') value = item.cover_url || '';
          else if (path === 'link') value = `/blog-post.html?slug=${encodeURIComponent(item.slug)}`;
          if (attr === 'text') el.textContent = value;
          else el.setAttribute(attr, value);
        });
        target.appendChild(node);
      });
      // pager
      const pager = q('#pager');
      const totalPages = Math.ceil(data.total / data.limit);
      pager.innerHTML = '';
      for (let i = 1; i <= totalPages; i++) {
        const a = document.createElement('a');
        a.href = `?page=${i}`;
        a.textContent = i;
        a.style.marginRight = '8px';
        if (i === data.page) a.style.fontWeight = '700';
        pager.appendChild(a);
      }
      applyBackgroundFromSettings('blog', settings);
    } else if (page === 'blog-post') {
      const slug = getQueryParam('slug');
      const post = await fetchJson(`/api/public/posts/${encodeURIComponent(slug)}`);
      q('#post-title').textContent = post.title;
      q('#post-content').innerHTML = post.content_html;
      applyBackgroundFromSettings('blog_post', settings);
    } else if (page === 'news') {
      const params = new URLSearchParams(location.search);
      const pageNum = Number(params.get('page') || '1');
      const data = await fetchJson(`/api/public/news?page=${pageNum}&limit=9`);
      const gridWrap = q('#news-list');
      const tpl = q('#news-list-item-tpl');
      const target = q('[data-target="list"]', gridWrap);
      target.innerHTML = '';
      data.items.forEach(item => {
        const node = document.importNode(tpl.content, true);
        qa('[data-prop]', node).forEach(el => {
          const [attr, path] = el.getAttribute('data-prop').split(':');
          let value;
          if (path === 'title') value = item.title;
          else if (path === 'excerpt') value = item.excerpt || '';
          else if (path === 'cover_url') value = item.cover_url || '';
          else if (path === 'link') value = `/news-post.html?slug=${encodeURIComponent(item.slug)}`;
          if (attr === 'text') el.textContent = value ?? '';
          else el.setAttribute(attr, value ?? '');
        });
        target.appendChild(node);
      });
      const pager = q('#pager');
      const totalPages = Math.ceil(data.total / data.limit);
      pager.innerHTML = '';
      for (let i = 1; i <= totalPages; i++) {
        const a = document.createElement('a');
        a.href = `?page=${i}`;
        a.textContent = i;
        a.style.marginRight = '8px';
        if (i === data.page) a.style.fontWeight = '700';
        pager.appendChild(a);
      }
      applyBackgroundFromSettings('news', settings);
    } else if (page === 'news-post') {
      const slug = getQueryParam('slug');
      const item = await fetchJson(`/api/public/news/${encodeURIComponent(slug)}`);
      q('#news-title').textContent = item.title;
      q('#news-content').innerHTML = item.content_html;
      applyBackgroundFromSettings('news_post', settings);
    } else if (page === 'leaderboard') {
      async function load() {
        const rows = await fetchJson('/api/public/leaderboard');
        const target = q('#leaderboard-list');
        const tpl = q('#leaderboard-item-tpl');
        target.innerHTML = '';
        rows.forEach(item => {
          const node = document.importNode(tpl.content, true);
          qa('[data-prop]', node).forEach(el => {
            const [attr, path] = el.getAttribute('data-prop').split(':');
            let value;
            if (path === 'title') value = item.title;
            else if (path === 'excerpt') value = item.excerpt || '';
            else if (path === 'cover_url') value = item.cover_url || '';
            else if (path === 'link') value = `/leader.html?slug=${encodeURIComponent(item.slug)}`;
            if (attr === 'text') el.textContent = value ?? '';
            else el.setAttribute(attr, value ?? '#');
          });
          target.appendChild(node);
        });
      }
      await load();
      applyBackgroundFromSettings('leaderboard', settings);
    } else if (page === 'leader') {
      const slug = getQueryParam('slug');
      const item = await fetchJson(`/api/public/leaderboard/${encodeURIComponent(slug)}`);
      const cover = q('#leader-cover'); if (cover && item.cover_url) cover.src = item.cover_url;
      q('#leader-title').textContent = item.title || '';
      q('#leader-content').innerHTML = item.content_html || '';
      applyBackgroundFromSettings('leaderboard', settings);
    } else if (page === 'plans') {
      const perPage = 15;
      const params = new URLSearchParams(location.search);
      const currentPage = Math.max(1, Number(params.get('page') || 1));
      const rows = await fetchJson('/api/public/plans');
      const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
      const tpl = q('#plan-item-tpl');
      const target = q('#plans-list');
      const pager = q('#plans-pager');
      target.innerHTML = '';
      const safePage = Math.min(currentPage, totalPages);
      const paged = rows.slice((safePage - 1) * perPage, safePage * perPage);
      paged.forEach(p => {
        const node = document.importNode(tpl.content, true);
        const slug = (p.slug || '').trim();
        const detailHref = slug ? `/plan.html?slug=${encodeURIComponent(slug)}` : `/plan.html?id=${encodeURIComponent(p.id)}`;
        qa('[data-prop]', node).forEach(el => {
          const [attr, path] = el.getAttribute('data-prop').split(':');
          let value;
          if (path === 'preview') {
            const plain = (p.content_html || '').replace(/<[^>]+>/g, '').trim();
            value = plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
            if (attr === 'text') { el.textContent = value; return; }
          }
          if (attr === 'text' && path === 'price') value = `$${Number(p.price).toFixed(2)}`;
          else if (path === 'link') value = detailHref;
          else value = p[path];
          if (attr === 'text') el.textContent = value ?? '';
          else el.setAttribute(attr, value ?? '');
        });
        target.appendChild(node);
      });
      if (pager) {
        pager.innerHTML = '';
        for (let i = 1; i <= totalPages; i += 1) {
          const a = document.createElement('a');
          a.href = `?page=${i}`;
          a.textContent = i;
        if (i === safePage) a.classList.add('active-page');
          pager.appendChild(a);
        }
      }
      applyBackgroundFromSettings('plans', settings);
    } else if (page === 'plan') {
      const slug = getQueryParam('slug');
      const id = getQueryParam('id');
      const lookupValue = slug || id;
      if (!lookupValue) return;
      const url = slug
        ? `/api/public/plans/${encodeURIComponent(slug)}`
        : `/api/public/plans/${encodeURIComponent(id)}?by_id=1`;
      const p = await fetchJson(url);
      const cover = q('#plan-cover'); if (cover && p.cover_url) cover.src = p.cover_url;
      q('#plan-name').textContent = p.name || '';
      q('#plan-tagline').textContent = p.tagline || '';
      q('#plan-price').textContent = p.price != null ? `$${Number(p.price).toFixed(2)}` : '';
      q('#plan-content').innerHTML = p.content_html || '';
      applyBackgroundFromSettings('plans', settings);
    } else if (page === 'user') {
      // Slightly wider and larger text for dashboard readability
      const main = document.querySelector('main.container');
      if (main) main.style.maxWidth = '1200px';
      document.documentElement.style.fontSize = '17px';
      // Blank background for user center
      document.body.style.backgroundImage = 'none';
      document.body.style.background = '#fff';
    } else if (page === 'trial') {
      const rows = await fetchJson('/api/public/trial');
      const list = q('#trial-list');
      list.innerHTML = '';
      function toYouTubeEmbed(url) {
        try {
          const u = new URL(url, location.origin);
          const host = (u.hostname || '').replace(/^m\./, '');
          const base = 'https://www.youtube-nocookie.com';
          if (u.pathname.startsWith('/embed/') && (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com'))) {
            return url;
          }
          if (host === 'youtu.be') {
            const id = u.pathname.replace(/^\//, '').split('/')[0];
            return id ? `${base}/embed/${id}?rel=0&modestbranding=1` : url;
          }
          if (host.endsWith('youtube.com')) {
            if (u.pathname.startsWith('/shorts/')) {
              const id = u.pathname.split('/')[2];
              return id ? `${base}/embed/${id}?rel=0&modestbranding=1` : url;
            }
            if (u.pathname.startsWith('/live/')) {
              const id = u.pathname.split('/')[2];
              return id ? `${base}/embed/${id}?rel=0&modestbranding=1` : url;
            }
          const playlistId = u.searchParams.get('list');
          const videoId = u.searchParams.get('v');
          if (playlistId && !videoId) return `${base}/embed/videoseries?list=${encodeURIComponent(playlistId)}`;
          if (videoId) return `${base}/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1`;
          }
        } catch {}
        return url;
      }
      rows.forEach(it => {
        const card = document.createElement('div');
        card.className = 'card trial-card';
        const title = document.createElement('h3');
        title.className = 'trial-title';
        title.textContent = it.title || '';
        const desc = document.createElement('div');
        desc.className = 'trial-desc';
        if (it.type === 'video' && it.video_url) {
          const src = toYouTubeEmbed(it.video_url);
          const wrapper = document.createElement('div');
          wrapper.className = 'video-embed';
          const iframe = document.createElement('iframe');
          iframe.src = src;
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          iframe.allowFullscreen = true;
          iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          wrapper.appendChild(iframe);
          const fallback = document.createElement('p');
          fallback.style.marginTop = '10px';
          fallback.style.fontSize = '0.9rem';
          fallback.style.color = '#6b7280';
          fallback.innerHTML = `若影片無法播放，<a href="${it.video_url}" target="_blank" rel="noopener">點此開啟 YouTube</a>`;
          desc.appendChild(wrapper);
          desc.appendChild(fallback);
        } else {
          desc.innerHTML = it.content_html || '';
        }
        card.appendChild(title);
        card.appendChild(desc);
        list.appendChild(card);
      });
      applyBackgroundFromSettings('trial', settings);
    } else if (page === 'testimonials') {
      const params = new URLSearchParams(location.search);
      const pageNum = Number(params.get('page') || '1');
      const data = await fetchJson(`/api/public/testimonials?page=${pageNum}&limit=12`);
      const list = q('#testimonials-list');
      const tpl = q('#testimonial-item-tpl');
      const pager = q('#pager');
      list.innerHTML = '';
      
      function toYouTubeEmbed(url) {
        try {
          const u = new URL(url, location.origin);
          const host = (u.hostname || '').replace(/^m\./, '');
          if (host.includes('youtube.com') || host.includes('youtu.be')) {
            let id = '';
            if (host === 'youtu.be') id = u.pathname.slice(1);
            else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
            else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
            else id = u.searchParams.get('v');
            if (id) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
          }
        } catch {}
        return null;
      }

      data.items.forEach(item => {
        const node = document.importNode(tpl.content, true);
        const embedContainer = node.querySelector('.media-embed-container');
        const embedSrc = item.video_url ? toYouTubeEmbed(item.video_url) : null;
        
        if (embedSrc) {
          embedContainer.innerHTML = `<iframe src="${embedSrc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        } else if (item.cover_url) {
          embedContainer.innerHTML = `<img src="${item.cover_url}" alt="${item.title}">`;
        } else {
          embedContainer.style.background = '#eee';
        }

        qa('[data-prop]', node).forEach(el => {
          const [attr, path] = el.getAttribute('data-prop').split(':');
          let val = item[path];
          if (path === 'link') val = `/testimonial.html?slug=${encodeURIComponent(item.slug)}`;
          if (attr === 'text') el.textContent = val || '';
          else el.setAttribute(attr, val || '');
        });
        list.appendChild(node);
      });

      // Pager
      pager.innerHTML = '';
      const totalPages = Math.ceil(data.total / data.limit);
      for (let i = 1; i <= totalPages; i++) {
        const a = document.createElement('a');
        a.href = `?page=${i}`;
        a.textContent = i;
        if (i === data.page) a.classList.add('active-page');
        pager.appendChild(a);
      }
      applyBackgroundFromSettings('testimonials', settings);
    } else if (page === 'testimonial') {
      const slug = getQueryParam('slug');
      if (!slug) return;
      const t = await fetchJson(`/api/public/testimonials/${encodeURIComponent(slug)}`);
      q('#t-title').textContent = t.title || '';
      if (t.published_at) {
        try {
          q('#t-meta').textContent = new Date(t.published_at).toLocaleDateString('zh-TW');
        } catch {}
      }
      
      // Video?
      if (t.video_url) {
        try {
          const u = new URL(t.video_url);
          let id = '';
          if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
          else if (u.searchParams.get('v')) id = u.searchParams.get('v');
          
          if (id) {
            const wrapper = q('#t-video');
            wrapper.style.display = 'block';
            wrapper.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" allowfullscreen></iframe>`;
          }
        } catch {}
      }
      
      q('#t-content').innerHTML = t.content_html || '';
      applyBackgroundFromSettings('testimonials', settings);
    } else if (page === 'contact') {
      const form = q('#contact-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());
        const { csrfToken } = await fetchJson('/api/public/csrf');
        const res = await fetch('/api/public/contact', { method:'POST', headers:{ 'Content-Type':'application/json','CSRF-Token': csrfToken }, body: JSON.stringify(data) });
        const msg = q('#contact-msg');
        msg.textContent = res.ok ? '已送出' : '送出失敗';
        if (res.ok) form.reset();
      });
      applyBackgroundFromSettings('contact', settings);
    } else if (page === 'about-teacher') {
      try {
        const pageData = await fetchJson('/api/public/pages/about-teacher');
        const img = q('#teacher-photo');
        if (img && pageData.background_image_url) img.src = pageData.background_image_url;
        const cont = q('#teacher-content'); if (cont) cont.innerHTML = pageData.content_html || '';
        setBackground(pageData.background_image_url || null, settings.default_bg_color);
      } catch { applyBackgroundFromSettings('about', settings); }
    } else if (page === 'about-us') {
      try {
        const pageData = await fetchJson('/api/public/pages/about-us');
        const cont = q('#aboutus-content'); if (cont) cont.innerHTML = pageData.content_html || '';
        setBackground(pageData.background_image_url || null, settings.default_bg_color);
      } catch { applyBackgroundFromSettings('about', settings); }
    } else if (page === 'about-ftmo') {
      try {
        const pageData = await fetchJson('/api/public/pages/about-ftmo');
        const cont = q('#ftmo-content'); if (cont) cont.innerHTML = pageData.content_html || '';
        setBackground(pageData.background_image_url || null, settings.default_bg_color);
      } catch { applyBackgroundFromSettings('about', settings); }
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();


