(() => {
  const defaults = { wide: true, watermark: true, panels: true };
  let current = defaults;
  function apply(settings) {
    current = { ...defaults, ...settings };
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('elrc-wide', current.wide);
    root.classList.toggle('elrc-hide-watermark', current.watermark);
    root.classList.toggle('elrc-hide-panels', current.panels);
    window.dispatchEvent(new Event('resize'));
  }
  function setupResume() {
    let currentKey=''; let generation=0; let lastSaved=0; let savedTime=0; let restoring=false;
    const attached=new WeakSet();
    const keyForPage=() => {
      const url=new URL(location.href);
      const fields=['id','week','weekDay','realSection'].map(k=>`${k}=${encodeURIComponent(url.searchParams.get(k)||'')}`).join('&');
      return `resume:${url.pathname}?${fields}`;
    };
    function videos() { return [...document.querySelectorAll('.player_group .player_item video')]; }
    function seekVideo(video) {
      if (!restoring || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (savedTime > 10 && savedTime < video.duration - 10) {
        try { video.currentTime=savedTime; } catch (_) { /* Wait for the player to load. */ }
      }
    }
    function bind() {
      const key=keyForPage();
      if (key!==currentKey) {
        currentKey=key; const run=++generation; lastSaved=0; savedTime=0; restoring=true;
        chrome.storage.local.get(key, data => {
          if (run!==generation) return;
          savedTime=Number(data[key]) || 0;
          if (savedTime <= 10) restoring=false;
          videos().forEach(seekVideo);
          setTimeout(()=>{ if(run===generation){videos().forEach(seekVideo); restoring=false;} },10000);
        });
      }
      for (const video of videos()) {
        if (attached.has(video)) continue;
        attached.add(video);
        video.addEventListener('loadedmetadata',()=>seekVideo(video));
        const save = (force=false) => {
          if (restoring || !Number.isFinite(video.duration) || video.duration<=0) return;
          const now=Date.now();
          if (!force && (video.paused || now-lastSaved<10000)) return;
          lastSaved=now;
          const position=video.currentTime;
          chrome.storage.local.set({[currentKey]: position < video.duration-10 ? position : 0});
        };
        video.addEventListener('timeupdate',()=>save());
        video.addEventListener('pause',()=>save(true));
        video.addEventListener('seeked',()=>save(true));
        video.addEventListener('ended',()=>chrome.storage.local.set({[currentKey]:0}));
      }
    }
    document.addEventListener('pointerdown', event=>{ if (event.isTrusted && event.target instanceof Element && event.target.closest('.multi_view_player_container')) restoring=false; }, true);
    bind();
    new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});
  }
  function installTranscriptHeader() {
    const panel=document.querySelector('.left_overview_container');
    if (!panel || panel.querySelector('.elrc-transcript-head')) return;
    const header=document.createElement('div'); header.className='elrc-transcript-head';
    const title=document.createElement('h2'); title.textContent='逐字稿';
    const controls=document.createElement('div'); controls.className='elrc-transcript-actions';
    const original=document.createElement('button'); original.type='button'; original.className='elrc-copy'; original.textContent='原站工具';
    original.addEventListener('click',()=>{const open=panel.classList.toggle('elrc-original-transcript'); original.textContent=open?'返回阅读':'原站工具';});
    const close=document.createElement('button'); close.type='button'; close.className='elrc-directory-close'; close.textContent='×'; close.setAttribute('aria-label','关闭逐字稿');
    close.addEventListener('click',()=>document.documentElement.classList.remove('elrc-open-overview'));
    controls.append(original,close); header.append(title,controls); panel.prepend(header);
    const reader=document.createElement('div'); reader.className='elrc-transcript-reader';
    const bar=document.createElement('div'); bar.className='elrc-transcript-bar';
    const search=document.createElement('input'); search.type='search'; search.placeholder='搜索语音文本'; search.setAttribute('aria-label','搜索语音文本');
    const count=document.createElement('span'); count.className='elrc-transcript-count'; count.setAttribute('role','status'); bar.append(search,count);
    const list=document.createElement('div'); list.className='elrc-transcript-list';
    const paragraphs=[...panel.querySelectorAll('.paragraph')];
    for (const paragraph of paragraphs) {
      const text=[...paragraph.querySelectorAll('span[slot="reference"]')].map(x=>x.textContent.trim()).filter(Boolean).join(' ');
      if (!text) continue;
      const article=document.createElement('article'); article.className='elrc-transcript-row';
      const time=document.createElement('span'); time.className='elrc-transcript-time'; time.textContent=paragraph.querySelector('.point_in')?.textContent.trim()||'';
      const body=document.createElement('p'); body.textContent=text; article.append(time,body); list.append(article);
    }
    function filter() { const q=search.value.trim().toLocaleLowerCase(); let shown=0; for(const row of list.children) { const visible=!q || row.textContent.toLocaleLowerCase().includes(q); row.hidden=!visible; if(visible) shown++; } count.textContent=q ? `${shown} 条结果` : ''; }
    search.addEventListener('input',filter); reader.append(bar,list); panel.append(reader);
  }
  function buildSlides() {
    const panel = document.querySelector('.ppt_list_section_container');
    const source = panel?.querySelector('.courseware_screenshoot_panel_sufe .list');
    const cards = source?.querySelectorAll(':scope > .screenshot_card_wrapper');
    const notes = document.querySelectorAll('.knowledge_card_wrapper');
    if (!panel || !source || (!cards?.length && !notes.length)) return;
    const previous = panel.querySelector('.elrc-slides');
    const signature = [cards.length, notes.length, ...[...cards, ...notes].map(card => card.textContent.trim() + (card.querySelector('img')?.getAttribute('src') || ''))].join('|');
    if (previous?.dataset.signature === signature) return;
    const seconds = text => text.trim().split(':').reduce((n, part) => n * 60 + (Number(part) || 0), 0);
    const events = [];
    for (const card of cards) {
      const time = card.querySelector('.time_text')?.textContent.replace('（进行中）','').trim() || '';
      events.push({kind:'课件', time, seconds:seconds(time), card,
        title:card.querySelector('.item_label')?.textContent.trim() || '课件',
        desc:card.querySelector('.desc')?.textContent.trim() || '',
        src:card.querySelector('img')?.getAttribute('src')});
    }
    for (const card of notes) {
      const time=card.querySelector('.card_time')?.textContent.trim() || '';
      events.push({kind:'知识要点', time, seconds:seconds(time), card,
        title:card.querySelector('.card_title')?.textContent.trim() || '知识要点',
        desc:card.querySelector('.card_desc')?.textContent.trim() || ''});
    }
    events.sort((a,b) => a.seconds - b.seconds);
    const shell=document.createElement('section'); shell.className='elrc-slides elrc-timeline';
    const head=document.createElement('div'); head.className='elrc-slides-head';
    const heading=document.createElement('div'); heading.innerHTML='<h2>课程时间线</h2>';
    const actions=document.createElement('div'); actions.className='elrc-timeline-actions';
    const close=document.createElement('button'); close.type='button'; close.className='elrc-directory-close'; close.setAttribute('aria-label','关闭课程时间线'); close.textContent='×'; close.addEventListener('click',()=>panel.querySelector('.ppt_close_btn')?.click());
    actions.append(close); head.append(heading,actions);
    const list=document.createElement('div'); list.className='elrc-timeline-list';
    for (const event of events) {
      const row=document.createElement('button'); row.type='button'; row.className='elrc-timeline-row';
      const time=document.createElement('span'); time.className='elrc-timeline-time'; time.textContent=event.time;
      const dot=document.createElement('span'); dot.className='elrc-timeline-dot';
      const content=document.createElement('span'); content.className='elrc-timeline-content';
      const tag=document.createElement('span'); tag.className='elrc-timeline-tag'; tag.textContent=event.kind;
      const title=document.createElement('strong'); title.textContent=event.title;
      const desc=document.createElement('span'); desc.className='elrc-timeline-desc'; desc.textContent=event.desc;
      content.append(title,desc); row.append(time,dot,tag,content);
      if (event.src) {const image=document.createElement('img'); image.src=event.src; image.alt=''; image.loading='lazy'; row.append(image);}
      row.addEventListener('click',()=> (event.kind==='课件' ? event.card.querySelector('.courseware_screenshoot_item') : event.card.querySelector('.knowledge_card'))?.click());
      list.append(row);
    }
    shell.append(head,list); shell.dataset.signature = signature;
    if (previous) previous.replaceWith(shell); else panel.append(shell);
    panel.classList.add('elrc-slides-ready');
    if (!previous && getComputedStyle(panel).display !== 'none') panel.querySelector('.ppt_close_btn')?.click();
  }
  function isCurrentWeek(dateRange, today) {
    const dates = [...dateRange.matchAll(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/g)]
      .map(match => `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
    return dates.length === 2 && dates[0] <= today && today <= dates[1];
  }
  function lessonMatchesPage(week, name, params) {
    const weekNumber = week.match(/\d+/)?.[0];
    const day = name.match(/周[一二三四五六日天]/)?.[0];
    const section = name.match(/第\s*(\d+(?:\s*-\s*\d+)?)\s*节/)?.[1]?.replace(/\s/g,'');
    const normalize = value => (value || '').replace(/^(\d+)-\1$/, '$1');
    return !!weekNumber && !!day && !!section && weekNumber === params.get('week') &&
      day === params.get('weekDay') && normalize(section) === normalize(params.get('realSection'));
  }
  function renameDirectory() {
    for (const element of document.querySelectorAll('.header_box .menu_btn, .menu_drawer .drawer_title, .header_box .overview_toggle_btn')) {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /目录|本节概要/.test(node.textContent)) {
          node.textContent = node.textContent.replace('目录', '课次').replace('本节概要', '知识点');
        }
      }
    }
  }
  function buildDirectory() {
    const body = document.querySelector('.menu_drawer_body');
    const source = body?.querySelector('.left_menu_sufe > .el-menu');
    const items = source ? [...source.querySelectorAll(':scope > .el-submenu')] : [];
    if (!body || !items.length) return;
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
    const params = new URL(location.href).searchParams;
    const previous = body.querySelector('.elrc-directory');
    const signature = [location.href, today, ...items.map(item => item.textContent + ':' + [...item.querySelectorAll('.el-menu-item')].map(lesson=>lesson.className).join(','))].join('|');
    if (previous?.dataset.signature === signature) return;
    const openWeeks = new Map([...previous?.querySelectorAll('.elrc-week') || []].map(row => [row.dataset.week, row.open]));
    const wrap = document.createElement('section');
    wrap.className = 'elrc-directory';
    wrap.dataset.signature = signature;
    wrap.innerHTML = '<div class="elrc-directory-head"><div><h2>课次</h2></div><button type="button" class="elrc-directory-close" aria-label="关闭课次">×</button></div><div class="elrc-week-list"></div>';
    wrap.querySelector('.elrc-directory-close').addEventListener('click', () => togglePanel('menu'));
    const list = wrap.querySelector('.elrc-week-list');
    const badge = (text, className) => { const node=document.createElement('span'); node.className=className; node.textContent=text; return node; };
    for (const item of items) {
      const title = item.querySelector(':scope > .el-submenu__title');
      if (!title) continue;
      const week = title.querySelector('.week')?.textContent.trim() || title.textContent.trim();
      const date = title.querySelector('.date')?.textContent.trim() || '';
      const currentWeek = isCurrentWeek(date, today);
      const row = document.createElement('details');
      row.className = 'elrc-week'; row.dataset.week=week;
      row.classList.toggle('elrc-current-week', currentWeek);
      const summary = document.createElement('summary');
      const main = document.createElement('span'); main.className = 'elrc-week-main';
      const num = document.createElement('strong'); num.textContent = week;
      const dates = document.createElement('span'); dates.className='elrc-week-dates'; dates.textContent = date;
      main.append(num, dates);
      const trailing=document.createElement('span'); trailing.className='elrc-week-trailing';
      if (currentWeek) trailing.append(badge('本周','elrc-week-badge'));
      const arrow = document.createElement('span'); arrow.className='elrc-arrow'; arrow.textContent='⌄';
      trailing.append(arrow); summary.append(main, trailing); row.append(summary);
      const links = document.createElement('div'); links.className = 'elrc-lessons';
      const lessons = item.querySelectorAll(':scope > .el-menu > .el-menu-item');
      let playingWeek=false;
      for (const lesson of lessons) {
        const name = lesson.querySelector('.section_name_section')?.textContent.trim();
        if (!name) continue;
        const btn = document.createElement('button'); btn.type='button'; btn.className='elrc-lesson';
        const day = lesson.querySelector('.section_name_date')?.textContent.trim() || '';
        const playing = params.has('week') && params.has('weekDay') && params.has('realSection')
          ? lessonMatchesPage(week, name, params) : lesson.classList.contains('is-active');
        const n = document.createElement('span'); n.className='elrc-lesson-name'; n.textContent=name;
        const d = document.createElement('small'); d.textContent=day;
        const icon = document.createElement('span'); icon.className='elrc-play'; icon.textContent='▶'; icon.setAttribute('aria-hidden','true');
        btn.append(icon,n,d);
        if (playing) {
          playingWeek=true; btn.classList.add('elrc-lesson-playing'); btn.setAttribute('aria-current','true');
          btn.append(badge('正在播放','elrc-playing-badge'));
        }
        btn.addEventListener('click', () => lesson.click()); links.append(btn);
      }
      if (!links.children.length) { const empty=document.createElement('span'); empty.className='elrc-empty'; empty.textContent='暂无课程'; links.append(empty); }
      row.open = openWeeks.has(week) ? openWeeks.get(week) : (playingWeek || currentWeek);
      row.append(links); list.append(row);
    }
    if (previous) previous.replaceWith(wrap); else body.append(wrap);
  }
  function togglePanel(name) {
    const root = document.documentElement;
    if (name === 'menu') buildDirectory();
    const cls = 'elrc-open-' + name;
    const opening = !root.classList.contains(cls);
    root.classList.toggle(cls, opening);
    if (name === 'menu' && !opening) document.querySelector('.header_box .menu_btn')?.focus({preventScroll:true});
    const selectors = { menu: '.menu_drawer', overview: '.left_overview_container', companion: '.right_panel_container' };
    const panel = document.querySelector(selectors[name]);
    if (opening && panel) {
      if (name === 'companion') {
        const tab = panel.querySelector('.tab_icon_btn');
        if (panel.classList.contains('state-collapsed') && tab) tab.click();
      }
      if (name === 'menu') {
        requestAnimationFrame(() => panel.querySelector('.elrc-directory-close')?.focus({preventScroll:true}));
      } else {
        requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    }
  }
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target instanceof Element) {
      const ppt = event.target.closest('.tool_bar .pptList');
      if (ppt) { event.preventDefault(); event.stopImmediatePropagation(); ppt.click(); return; }
      if (event.target.matches('.multi_view_player_container .tool_bar')) { event.stopImmediatePropagation(); return; }
    }
    const menu = event.target.closest('.header_box .menu_btn');
    const overview = event.target.closest('.header_box .overview_toggle_btn');
    const close = event.target.closest('.menu_drawer .el-icon-circle-close, .menu_drawer .mask');
    if (!menu && !overview && !close) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (overview) { const panel=document.querySelector('.ppt_list_section_container'); if (panel && getComputedStyle(panel).display === 'none') document.querySelector('.tool_bar .pptList')?.click(); requestAnimationFrame(()=>panel?.scrollIntoView({behavior:'smooth',block:'start'})); } else togglePanel('menu');
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.documentElement.classList.contains('elrc-open-menu')) togglePanel('menu');
  });
  let subtitleConfigured = false;
  function setDefaultSubtitle() {
    if (subtitleConfigured) return;
    const choices = [...document.querySelectorAll('.text_track .modal p')];
    const source = choices.find(node => node.textContent.trim() === '源语言');
    if (!source) return;
    subtitleConfigured = true;
    const english = choices.find(node => node.textContent.trim() === '英文');
    if (!source.classList.contains('active')) source.click();
    if (english && english.classList.contains('active')) english.click();
  }
  function videoCameras() {
    const seen = new Set();
    return [...document.querySelectorAll('.player_group .player_item')].flatMap((item, index) => {
      const video = item.querySelector('video');
      const source = video?.currentSrc || video?.getAttribute('src') || video?.querySelector('source')?.src;
      if (!source || seen.has(source)) return [];
      seen.add(source);
      // Hidden cameras lose their selected label, but keep their original option order.
      const originalIndex = Number(item.id.match(/player_(\d+)$/)?.[1] ?? index);
      const name = item.querySelector('.screen_select .selected')?.textContent.trim() ||
        item.querySelectorAll('.screen_select .select_item')[originalIndex]?.textContent.trim() || `机位 ${index + 1}`;
      return [{id: item.id, item, video, source, name}];
    });
  }
  function createToolbarPopover(toolbar, text, id) {
    const control = document.createElement('div');
    control.className = 'elrc-popover-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'elrc-copy';
    button.textContent = text;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', id);
    const panel = document.createElement('section');
    panel.id = id;
    panel.className = 'elrc-popover';
    panel.hidden = true;
    panel.setAttribute('aria-label', text);
    function setOpen(open, returnFocus = false) {
      if (open) {
        document.dispatchEvent(new CustomEvent('elrc-close-popovers'));
        control.dispatchEvent(new Event('elrc-popover-open'));
      }
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (returnFocus) button.focus();
    }
    button.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('elrc-close-popovers', () => setOpen(false));
    document.addEventListener('pointerdown', event => {
      if (!panel.hidden && !control.contains(event.target)) setOpen(false);
    });
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false, true); }
    });
    control.append(button, panel);
    toolbar.append(control);
    return {control, button, panel, setOpen};
  }
  let refreshFocusMode = () => {};
  function createFocusMode(toolbar) {
    const popover = createToolbarPopover(toolbar, '画面模式', 'elrc-picture-mode');
    popover.panel.classList.add('elrc-focus-options');
    const state = {enabled: true, mainId: '', floatId: '', x: 1, y: 0, width: 0, sizing: 'fit', fixedWidth: 0, customized: false};
    let group;
    let floatItem;
    let handle;
    let drag;
    let signature = '';
    let positionFrame = 0;
    let ensureVisible = true;
    let dragController;
    let suppressDragClick = false;
    let nativeMain;
    let nativeFloat;
    const mode = document.createElement('div');
    mode.className = 'elrc-mode-choices';
    mode.setAttribute('role', 'group');
    mode.setAttribute('aria-label', '播放器布局');
    const original = document.createElement('button');
    original.type = 'button'; original.textContent = '原始布局';
    const floating = document.createElement('button');
    floating.type = 'button'; floating.textContent = '悬浮小窗';
    mode.append(original, floating);
    const fields = document.createElement('div');
    fields.className = 'elrc-focus-fields';
    function cameraSelect(text, parent = fields) {
      const label = document.createElement('label');
      label.append(document.createTextNode(text));
      const select = document.createElement('select');
      label.append(select); parent.append(label);
      return select;
    }
    const mainSelect = cameraSelect('主画面');
    const floatSelect = cameraSelect('小窗');
    const sizing = cameraSelect('视频大小');
    for (const [value, text] of [['fit', '适应窗口'], ['fixed', '固定宽度']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; sizing.append(option);
    }
    const widthLabel = document.createElement('label');
    widthLabel.className = 'elrc-fixed-width-field'; widthLabel.hidden = true;
    widthLabel.append(document.createTextNode('宽度'));
    const widthInput = document.createElement('input');
    widthInput.type = 'number'; widthInput.min = '320'; widthInput.max = '7680'; widthInput.step = '16';
    widthInput.setAttribute('aria-label', '视频宽度（像素）');
    widthLabel.append(widthInput); fields.append(widthLabel);
    sizing.addEventListener('change', () => {
      state.sizing = sizing.value;
      if (!state.fixedWidth) state.fixedWidth = Math.round(group?.clientWidth || 960);
      ensureVisible = true; refreshFocusMode();
    });
    widthInput.addEventListener('change', () => {
      const width = Number(widthInput.value);
      if (Number.isFinite(width) && width >= 320 && width <= 7680) state.fixedWidth = width;
      ensureVisible = true; refreshFocusMode();
    });
    const swap = document.createElement('button');
    swap.type = 'button'; swap.className = 'elrc-focus-swap'; swap.textContent = '交换画面';
    const status = document.createElement('p');
    status.className = 'elrc-focus-status'; status.setAttribute('role', 'status'); status.hidden = true;
    popover.panel.append(mode, fields, swap, status);

    function fitMainPlayer() {
      if (document.fullscreenElement) return;
      const host = group.closest('.player_box_container');
      const review = group.closest('.review_student');
      const mainVideo = group.querySelector('.elrc-focus-main video');
      if (!host || !review || !mainVideo) return;
      const area = review.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      const naturalTop = box.top - area.top + review.scrollTop;
      const viewportBottom = Math.min(innerHeight, area.bottom);
      const availableHeight = Math.max(1, viewportBottom - area.top - 24);
      const ratio = mainVideo.videoWidth && mainVideo.videoHeight ? mainVideo.videoWidth / mainVideo.videoHeight : 16 / 9;
      const width = state.sizing === 'fixed' ? Math.min(host.clientWidth, state.fixedWidth || host.clientWidth) : host.clientWidth;
      const height = Math.floor(state.sizing === 'fixed' ? width / ratio : Math.min(width / ratio, availableHeight));
      const root = document.documentElement;
      root.style.setProperty('--elrc-focus-width', `${width}px`);
      const value = `${height}px`;
      if (root.style.getPropertyValue('--elrc-focus-height') !== value) {
        root.style.setProperty('--elrc-focus-height', value);
      }
      if (ensureVisible) {
        ensureVisible = false;
        const fitted = host.getBoundingClientRect();
        if (fitted.top < area.top || fitted.bottom > viewportBottom) {
          review.scrollTop = Math.max(0, naturalTop - 12);
        }
      }
    }
    function positionFloat() {
      positionFrame = 0;
      if (!state.enabled || !group || !floatItem) return;
      fitMainPlayer();
      const bounds = group.getBoundingClientRect();
      const maxWidth = Math.max(64, Math.min(bounds.width - 32, (bounds.height - 104) * 16 / 9));
      const minWidth = Math.min(140, maxWidth);
      const width = Math.max(minWidth, Math.min(maxWidth, state.width ? state.width * bounds.width : Math.min(bounds.width * 0.25, 360)));
      floatItem.style.setProperty('--elrc-float-width', `${width}px`);
      const small = floatItem.getBoundingClientRect();
      const margin = Math.min(16, bounds.width / 30);
      const maxX = Math.max(margin, bounds.width - small.width - margin);
      const maxY = Math.max(margin, bounds.height - small.height - 88);
      floatItem.style.setProperty('--elrc-float-left', `${margin + state.x * (maxX - margin)}px`);
      floatItem.style.setProperty('--elrc-float-top', `${margin + state.y * (maxY - margin)}px`);
    }
    function schedulePosition() {
      if (!positionFrame) positionFrame = requestAnimationFrame(positionFloat);
    }
    function exchange() {
      state.customized = true;
      [state.mainId, state.floatId] = [state.floatId, state.mainId];
      refreshFocusMode();
    }
    function attachHandle(camera) {
      if (floatItem === camera.item && handle?.isConnected) return;
      dragController?.abort();
      dragController = new AbortController();
      const dragOptions = {capture: true, signal: dragController.signal};
      handle?.remove();
      floatItem?.querySelectorAll('.elrc-float-resize').forEach(corner => corner.remove());
      floatItem = camera.item;
      handle = document.createElement('div');
      handle.className = 'elrc-float-handle'; handle.tabIndex = 0;
      handle.setAttribute('role', 'group');
      handle.setAttribute('aria-label', '拖动小窗，或使用方向键移动');
      const name = document.createElement('span'); name.className = 'elrc-float-name';
      const exchangeButton = document.createElement('button');
      exchangeButton.type = 'button'; exchangeButton.textContent = '交换';
      exchangeButton.setAttribute('aria-label', '交换主画面与小窗');
      exchangeButton.addEventListener('click', event => { event.stopPropagation(); exchange(); });
      handle.append(name, exchangeButton);
      handle.addEventListener('click', event => event.stopPropagation());
      floatItem.addEventListener('pointerdown', event => {
        const corner = event.target.closest('.elrc-float-resize');
        if (event.button !== 0 || (event.target.closest('button') && !corner)) return;
        suppressDragClick = false;
        event.preventDefault(); event.stopPropagation();
        const bounds = group.getBoundingClientRect();
        const small = floatItem.getBoundingClientRect();
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY,
          left: small.left - bounds.left, top: small.top - bounds.top,
          width: small.width, height: small.height, corner: corner?.dataset.corner};
        floatItem.setPointerCapture(event.pointerId);
        handle.classList.add('elrc-dragging');
      }, dragOptions);
      floatItem.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) suppressDragClick = true;
        const bounds = group.getBoundingClientRect();
        const small = floatItem.getBoundingClientRect();
        const margin = Math.min(16, bounds.width / 30);
        if (drag.corner) {
          const fromLeft = drag.corner.includes('w');
          const fromTop = drag.corner.includes('n');
          const dx = (event.clientX - drag.x) * (fromLeft ? -1 : 1);
          const dy = (event.clientY - drag.y) * (fromTop ? -1 : 1) * 16 / 9;
          const change = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
          const anchorX = fromLeft ? drag.left + drag.width : drag.left;
          const anchorY = fromTop ? drag.top + drag.height : drag.top;
          const horizontalRoom = fromLeft ? anchorX - margin : bounds.width - anchorX - margin;
          const verticalRoom = fromTop ? anchorY - margin : bounds.height - anchorY - 88;
          const maxWidth = Math.max(64, Math.min(horizontalRoom, verticalRoom * 16 / 9));
          const width = Math.max(Math.min(140, maxWidth), Math.min(maxWidth, drag.width + change));
          const height = width * 9 / 16;
          const left = fromLeft ? anchorX - width : anchorX;
          const top = fromTop ? anchorY - height : anchorY;
          state.width = width / bounds.width;
          state.x = Math.max(0, Math.min(1, (left - margin) / Math.max(1, bounds.width - width - margin * 2)));
          state.y = Math.max(0, Math.min(1, (top - margin) / Math.max(1, bounds.height - height - 88 - margin)));
          positionFloat();
          return;
        }
        const rangeX = Math.max(0, bounds.width - small.width - margin * 2);
        const rangeY = Math.max(0, bounds.height - small.height - 88 - margin);
        const clamp = value => Math.max(0, Math.min(1, value));
        state.x = rangeX ? clamp((drag.left + event.clientX - drag.x - margin) / rangeX) : 0;
        state.y = rangeY ? clamp((drag.top + event.clientY - drag.y - margin) / rangeY) : 0;
        positionFloat();
      }, dragOptions);
      floatItem.addEventListener('click', event => {
        if (suppressDragClick) {
          event.preventDefault(); event.stopImmediatePropagation(); suppressDragClick = false;
        }
      }, dragOptions);
      const endDrag = () => { drag = null; handle?.classList.remove('elrc-dragging'); };
      floatItem.addEventListener('pointerup', endDrag, dragOptions);
      floatItem.addEventListener('pointercancel', endDrag, dragOptions);
      floatItem.addEventListener('lostpointercapture', endDrag, dragOptions);
      handle.addEventListener('keydown', event => {
        if (event.target !== handle || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 0.1 : 0.025;
        state.x = Math.max(0, Math.min(1, state.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
        state.y = Math.max(0, Math.min(1, state.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)));
        positionFloat();
      });
      floatItem.append(handle);
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const grip = document.createElement('button');
        grip.type = 'button'; grip.className = `elrc-float-resize elrc-resize-${corner}`;
        grip.dataset.corner = corner; grip.setAttribute('aria-label', '调整小窗大小');
        grip.title = '拖动调整大小';
        grip.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
        grip.addEventListener('keydown', event => {
          if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const width = floatItem.getBoundingClientRect().width;
          const direction = ['ArrowRight','ArrowUp'].includes(event.key) ? 1 : -1;
          state.width = (width + direction * 16) / group.getBoundingClientRect().width;
          positionFloat();
        });
        floatItem.append(grip);
      }
    }
    const resizeObserver = new ResizeObserver(schedulePosition);
    refreshFocusMode = () => {
      const cameras = videoCameras();
      const nextGroup = document.querySelector('.player_group');
      if (nextGroup !== group) {
        resizeObserver.disconnect(); group = nextGroup;
        if (group) resizeObserver.observe(group);
      }
      if (!state.customized) {
        state.mainId = (cameras.find(camera => /屏幕|课件/.test(camera.name)) || cameras[0])?.id || '';
        state.floatId = (cameras.find(camera => camera.id !== state.mainId && /近景/.test(camera.name)) ||
          cameras.find(camera => camera.id !== state.mainId))?.id || '';
      }
      if (!cameras.some(camera => camera.id === state.mainId)) {
        state.mainId = (cameras.find(camera => /屏幕|课件/.test(camera.name)) || cameras[0])?.id || '';
      }
      if (!cameras.some(camera => camera.id === state.floatId && camera.id !== state.mainId)) {
        state.floatId = (cameras.find(camera => camera.id !== state.mainId && /近景/.test(camera.name)) ||
          cameras.find(camera => camera.id !== state.mainId))?.id || '';
      }
      const nativeMenu = document.querySelector('.multi_view_player_container .tool_bar .frame .modal');
      if (nativeMenu && !nativeMenu.querySelector('.elrc-focus-native-menu')) {
        const controls = document.createElement('div');
        controls.className = 'elrc-focus-native-menu elrc-focus-fields';
        nativeMain = cameraSelect('主画面', controls);
        nativeFloat = cameraSelect('小窗', controls);
        nativeMain.addEventListener('change', () => changeCamera('main', nativeMain.value));
        nativeFloat.addEventListener('change', () => changeCamera('float', nativeFloat.value));
        nativeMenu.append(controls);
        signature = '';
      }
      const available = cameras.length >= 2;
      const nextSignature = JSON.stringify(cameras.map(camera => [camera.id, camera.name]));
      if (signature !== nextSignature) {
        signature = nextSignature;
        for (const select of [mainSelect, floatSelect, nativeMain, nativeFloat].filter(Boolean)) {
          select.replaceChildren(...cameras.map(camera => {
            const option = document.createElement('option'); option.value = camera.id; option.textContent = camera.name; return option;
          }));
        }
      }
      mainSelect.value = state.mainId; floatSelect.value = state.floatId;
      if (nativeMain) nativeMain.value = state.mainId;
      if (nativeFloat) nativeFloat.value = state.floatId;
      original.setAttribute('aria-pressed', String(!state.enabled));
      floating.setAttribute('aria-pressed', String(state.enabled));
      floating.disabled = !available;
      fields.hidden = !state.enabled; swap.hidden = !state.enabled;
      sizing.value = state.sizing;
      widthLabel.hidden = state.sizing !== 'fixed';
      if (document.activeElement !== widthInput) widthInput.value = String(state.fixedWidth || Math.round(group?.clientWidth || 960));
      status.hidden = available;
      const statusText = available ? '' : '加载两个机位后可开启小窗';
      if (status.textContent !== statusText) status.textContent = statusText;
      const active = state.enabled && available;
      document.documentElement.classList.toggle('elrc-focus-mode', active);
      popover.button.classList.toggle('elrc-mode-active', active);
      for (const camera of cameras) {
        camera.item.classList.toggle('elrc-focus-main', active && camera.id === state.mainId);
        camera.item.classList.toggle('elrc-focus-float', active && camera.id === state.floatId);
      }
      if (active) {
        const main = cameras.find(camera => camera.id === state.mainId);
        const small = cameras.find(camera => camera.id === state.floatId);
        const ratio = main.video.videoWidth && main.video.videoHeight ? `${main.video.videoWidth} / ${main.video.videoHeight}` : '16 / 9';
        document.documentElement.style.setProperty('--elrc-focus-ratio', ratio);
        attachHandle(small);
        const name = handle.querySelector('.elrc-float-name');
        if (name.textContent !== small.name) name.textContent = small.name;
        schedulePosition();
      } else {
        dragController?.abort();
        handle?.remove();
        floatItem?.querySelectorAll('.elrc-float-resize').forEach(corner => corner.remove());
        handle = null; floatItem = null;
      }
    };
    function changeCamera(target, value) {
      state.customized = true;
      if (target === 'main') {
        if (value === state.floatId) state.floatId = state.mainId;
        state.mainId = value;
      } else {
        if (value === state.mainId) state.mainId = state.floatId;
        state.floatId = value;
      }
      refreshFocusMode();
    }
    original.addEventListener('click', () => { state.enabled = false; refreshFocusMode(); });
    floating.addEventListener('click', () => {
      state.enabled = true; ensureVisible = true; refreshFocusMode(); popover.setOpen(false);
    });
    mainSelect.addEventListener('change', () => changeCamera('main', mainSelect.value));
    floatSelect.addEventListener('change', () => changeCamera('float', floatSelect.value));
    swap.addEventListener('click', exchange);
    popover.control.addEventListener('elrc-popover-open', refreshFocusMode);
    document.addEventListener('loadedmetadata', refreshFocusMode, true);
    document.addEventListener('fullscreenchange', schedulePosition);
    window.addEventListener('resize', () => {
      if (group) {
        const bounds = group.getBoundingClientRect();
        ensureVisible = bounds.bottom > 0 && bounds.top < innerHeight;
      }
      schedulePosition();
    });
    window.visualViewport?.addEventListener('resize', schedulePosition);
    refreshFocusMode();
  }
  function updateVideoDownloads() {
    const panel = document.querySelector('.elrc-download-panel');
    if (!panel || panel.hidden) return;
    const cameras = videoCameras();
    const signature = JSON.stringify([location.href, document.title, cameras.map(camera => [camera.source, camera.name])]);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    const list = panel.querySelector('.elrc-download-list');
    list.replaceChildren();
    const params = new URL(location.href).searchParams;
    const course = document.title.replace(/-上海科技大学.*$/, '').trim() || '课程回放';
    const lesson = [params.get('week') && `第${params.get('week')}周`, params.get('weekDay'),
      params.get('realSection') && `第${params.get('realSection')}节`].filter(Boolean).join('_');
    for (const camera of cameras) {
      const row = document.createElement('div');
      row.className = 'elrc-download-camera';
      const name = document.createElement('strong');
      name.textContent = camera.name;
      const url = new URL(camera.source, location.href);
      if (url.origin === location.origin && /\.mp4$/i.test(url.pathname)) {
        const link = document.createElement('a');
        link.className = 'elrc-copy elrc-download-link';
        link.textContent = '下载';
        link.href = url.href;
        link.download = [course, lesson, camera.name].filter(Boolean).join('_')
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) + '.mp4';
        link.setAttribute('aria-label', `下载${camera.name}`);
        row.append(name, link);
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'elrc-download-unavailable';
        unavailable.textContent = '当前格式暂不支持下载';
        row.append(name, unavailable);
      }
      list.append(row);
    }
    if (!cameras.length) {
      const empty = document.createElement('p');
      empty.className = 'elrc-download-empty';
      empty.textContent = '视频加载后可选择机位下载';
      list.append(empty);
    }
  }
  function createVideoDownloads(toolbar) {
    const popover = createToolbarPopover(toolbar, '下载视频', 'elrc-video-downloads');
    popover.panel.classList.add('elrc-download-panel');
    const list = document.createElement('div');
    list.className = 'elrc-download-list';
    popover.panel.append(list);
    popover.control.addEventListener('elrc-popover-open', () => {
      // Make the list readable while the popover is being opened.
      popover.panel.hidden = false;
      updateVideoDownloads();
    });
    popover.panel.addEventListener('click', event => {
      if (event.target.closest('.elrc-download-link')) popover.setOpen(false);
    });
    document.addEventListener('loadedmetadata', updateVideoDownloads, true);
  }
  function installAutoHideHeader() {
    const header = document.querySelector('#head_container')?.closest('.tabs_view_9_vision_1');
    if (!header || header.dataset.elrcAutoHide) return;
    header.dataset.elrcAutoHide = 'true';
    document.documentElement.classList.add('elrc-autohide-header');
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'elrc-header-reveal';
    trigger.setAttribute('aria-label', '显示顶部导航');
    trigger.setAttribute('aria-expanded', 'false');
    const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true');
    trigger.append(mark); document.body.append(trigger);
    let hideTimer;
    function show() {
      clearTimeout(hideTimer); hideTimer = null;
      document.documentElement.classList.add('elrc-header-visible');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function hide() {
      hideTimer = null;
      if (header.contains(document.activeElement)) return;
      document.documentElement.classList.remove('elrc-header-visible');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function hideSoon() {
      if (!hideTimer) hideTimer = setTimeout(hide, 350);
    }
    trigger.addEventListener('pointerenter', show);
    trigger.addEventListener('focus', show);
    trigger.addEventListener('click', show);
    header.addEventListener('pointerenter', show);
    header.addEventListener('pointerleave', hideSoon);
    header.addEventListener('focusin', show);
    header.addEventListener('focusout', hideSoon);
    document.addEventListener('pointermove', event => {
      if (event.clientY <= 10) show();
      else if (event.clientY > header.getBoundingClientRect().bottom + 12 &&
        document.documentElement.classList.contains('elrc-header-visible')) hideSoon();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { clearTimeout(hideTimer); hide(); }
    });
    window.dispatchEvent(new Event('resize'));
  }
  function hideCourseReminders() {
    // The site can append several reminders with the same ID.
    for (const reminder of document.querySelectorAll('[id="course-summary-reminder"]')) {
      if (reminder.style.getPropertyValue('display') !== 'none' || reminder.style.getPropertyPriority('display') !== 'important') {
        reminder.style.setProperty('display', 'none', 'important');
      }
    }
  }
  function installButton() {
    hideCourseReminders();
    installAutoHideHeader();
    updateVideoDownloads();
    refreshFocusMode();
    const page=document.querySelector('.review_student');
    if (page) {
      const rgb=getComputedStyle(page).backgroundColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) document.documentElement.classList.toggle('elrc-light', 0.2126*Number(rgb[0])+0.7152*Number(rgb[1])+0.0722*Number(rgb[2]) > 155);
    }
    renameDirectory();
    setDefaultSubtitle();
    buildSlides();
    if (document.documentElement.classList.contains('elrc-open-menu')) buildDirectory();
    const middle = document.querySelector('.review_student .middle_content');
    if (!middle || middle.querySelector('.elrc-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'elrc-toolbar';
    const label = document.createElement('div');
    label.className = 'elrc-toolbar-label';
    label.textContent = '课程回放';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'elrc-popover-action';
    button.textContent = '复制文本';
    const status = document.createElement('span');
    status.className = 'elrc-status';
    status.setAttribute('role', 'status');
    const companion = document.createElement('button');
    companion.type = 'button';
    companion.className = 'elrc-copy elrc-companion';
    companion.textContent = '智能学伴';
    companion.addEventListener('click', () => togglePanel('companion'));
    toolbar.append(label, status, companion);
    middle.prepend(toolbar);
    const transcriptPopover = createToolbarPopover(toolbar, '语音文本', 'elrc-transcript-menu');
    const viewTranscript = document.createElement('button');
    viewTranscript.type = 'button'; viewTranscript.className = 'elrc-popover-action';
    viewTranscript.textContent = '查看逐字稿';
    transcriptPopover.panel.append(viewTranscript, button);
    viewTranscript.addEventListener('click', () => {
      transcriptPopover.setOpen(false);
      const tab = [...document.querySelectorAll('.fast_view_tabs_sufe .tab')].find(node => node.textContent.includes('语音文本'));
      tab?.click();
      installTranscriptHeader();
      document.documentElement.classList.add('elrc-open-overview');
      document.querySelector('.left_overview_container')?.scrollIntoView({behavior:'smooth', block:'start'});
    });
    createFocusMode(toolbar);
    createVideoDownloads(toolbar);
    button.addEventListener('click', async () => {
      transcriptPopover.setOpen(false);
      const text = Array.from(document.querySelectorAll('.paragraph')).map(p =>
        Array.from(p.querySelectorAll('span[slot="reference"]')).map(s => s.textContent.trim()).filter(Boolean).join(' ')
      ).filter(Boolean).join('\n\n');
      if (!text) {
        status.textContent = '暂无语音文本，等待加载后重试';
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = `已复制 ${text.length.toLocaleString()} 字`;
      } catch (_) {
        status.textContent = '复制失败，请检查剪贴板权限';
      }
    });
  }
  chrome.storage.local.get(defaults, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(defaults).some(key => key in changes)) chrome.storage.local.get(defaults, apply);
  });
  setInterval(() => { if (document.documentElement.classList.contains('elrc-open-menu')) buildDirectory(); }, 60000);
  const start = () => { setupResume(); installButton(); new MutationObserver(installButton).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
