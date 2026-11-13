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
    const title=document.createElement('h2'); title.textContent='语音文本';
    const controls=document.createElement('div'); controls.className='elrc-transcript-actions';
    const original=document.createElement('button'); original.type='button'; original.className='elrc-copy'; original.textContent='原站工具';
    original.addEventListener('click',()=>{const open=panel.classList.toggle('elrc-original-transcript'); original.textContent=open?'返回阅读':'原站工具';});
    const close=document.createElement('button'); close.type='button'; close.className='elrc-directory-close'; close.textContent='×'; close.setAttribute('aria-label','关闭语音文本');
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
    const transcript=document.createElement('button'); transcript.type='button'; transcript.className='elrc-copy'; transcript.textContent='语音文本';
    transcript.addEventListener('click',()=>{ installTranscriptHeader(); document.documentElement.classList.add('elrc-open-overview'); const tabs=[...document.querySelectorAll('.fast_view_tabs_sufe .tab')]; tabs.find(x=>x.textContent.includes('语音文本'))?.click(); document.querySelector('.left_overview_container')?.scrollIntoView({behavior:'smooth'}); });
    const close=document.createElement('button'); close.type='button'; close.className='elrc-directory-close'; close.setAttribute('aria-label','关闭课程时间线'); close.textContent='×'; close.addEventListener('click',()=>panel.querySelector('.ppt_close_btn')?.click());
    actions.append(transcript,close); head.append(heading,actions);
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
    for (const element of document.querySelectorAll('.header_box .menu_btn, .menu_drawer .drawer_title')) {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('目录')) {
          node.textContent = node.textContent.replace('目录', '课次');
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
    const columns = [document.createElement('div'), document.createElement('div')];
    columns.forEach(column => { column.className='elrc-week-column'; list.append(column); });
    let weekIndex = 0;
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
      row.append(links); columns[weekIndex++ % 2].append(row);
    }
    if (previous) previous.replaceWith(wrap); else body.append(wrap);
  }
  function togglePanel(name) {
    const root = document.documentElement;
    if (name === 'menu') buildDirectory();
    const cls = 'elrc-open-' + name;
    const opening = !root.classList.contains(cls);
    root.classList.toggle(cls, opening);
    const selectors = { menu: '.menu_drawer', overview: '.left_overview_container', companion: '.right_panel_container' };
    const panel = document.querySelector(selectors[name]);
    if (opening && panel) {
      if (name === 'companion') {
        const tab = panel.querySelector('.tab_icon_btn');
        if (panel.classList.contains('state-collapsed') && tab) tab.click();
      }
      requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
    const close = event.target.closest('.menu_drawer .el-icon-circle-close');
    if (!menu && !overview && !close) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (overview) { const panel=document.querySelector('.ppt_list_section_container'); if (panel && getComputedStyle(panel).display === 'none') document.querySelector('.tool_bar .pptList')?.click(); requestAnimationFrame(()=>panel?.scrollIntoView({behavior:'smooth',block:'start'})); } else togglePanel('menu');
  }, true);
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
  function hideCourseReminders() {
    // The site can append several reminders with the same ID.
    for (const reminder of document.querySelectorAll('[id="course-summary-reminder"]')) {
      reminder.style.setProperty('display', 'none', 'important');
    }
  }
  function installButton() {
    hideCourseReminders();
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
    button.className = 'elrc-copy';
    button.textContent = '复制语音文本';
    const status = document.createElement('span');
    status.className = 'elrc-status';
    status.setAttribute('role', 'status');
    const companion = document.createElement('button');
    companion.type = 'button';
    companion.className = 'elrc-copy elrc-companion';
    companion.textContent = '智能学伴';
    companion.addEventListener('click', () => togglePanel('companion'));
    toolbar.append(label, status, companion, button);
    middle.prepend(toolbar);
    button.addEventListener('click', async () => {
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
