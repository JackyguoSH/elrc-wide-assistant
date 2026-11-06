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
  function installTranscriptHeader() {
    const panel=document.querySelector('.left_overview_container');
    if (!panel || panel.querySelector('.elrc-transcript-head')) return;
    const header=document.createElement('div'); header.className='elrc-transcript-head';
    const title=document.createElement('h2'); title.textContent='语音文本';
    const close=document.createElement('button'); close.type='button'; close.className='elrc-directory-close'; close.textContent='×'; close.setAttribute('aria-label','关闭语音文本');
    close.addEventListener('click',()=>document.documentElement.classList.remove('elrc-open-overview'));
    header.append(title,close); panel.prepend(header);
  }
  function buildSlides() {
    const panel = document.querySelector('.ppt_list_section_container');
    const source = panel?.querySelector('.courseware_screenshoot_panel_sufe .list');
    const cards = source?.querySelectorAll(':scope > .screenshot_card_wrapper');
    const notes = document.querySelectorAll('.knowledge_card_wrapper');
    if (!panel || !source || !cards?.length || !notes.length || panel.querySelector('.elrc-slides')) return;
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
    shell.append(head,list); panel.append(shell); panel.classList.add('elrc-slides-ready');
    if (getComputedStyle(panel).display !== 'none') panel.querySelector('.ppt_close_btn')?.click();
  }
  function buildDirectory() {
    const body = document.querySelector('.menu_drawer_body');
    const source = body?.querySelector('.left_menu_sufe > .el-menu');
    if (!body || !source || !source.querySelector(':scope > .el-submenu') || body.querySelector('.elrc-directory')) return;
    const wrap = document.createElement('section');
    wrap.className = 'elrc-directory';
    wrap.innerHTML = '<div class="elrc-directory-head"><div><h2>课程目录</h2></div><button type="button" class="elrc-directory-close" aria-label="关闭目录">×</button></div><div class="elrc-week-list"></div>';
    wrap.querySelector('.elrc-directory-close').addEventListener('click', () => togglePanel('menu'));
    const list = wrap.querySelector('.elrc-week-list');
    const columns = [document.createElement('div'), document.createElement('div')];
    columns.forEach(column => { column.className='elrc-week-column'; list.append(column); });
    let weekIndex = 0;
    for (const item of source.querySelectorAll(':scope > .el-submenu')) {
      const title = item.querySelector(':scope > .el-submenu__title');
      if (!title) continue;
      const week = title.querySelector('.week')?.textContent.trim() || title.textContent.trim();
      const date = title.querySelector('.date')?.textContent.trim() || '';
      const row = document.createElement('details');
      row.className = 'elrc-week';
      const summary = document.createElement('summary');
      const main = document.createElement('span'); main.className = 'elrc-week-main';
      const num = document.createElement('strong'); num.textContent = week;
      const dates = document.createElement('span'); dates.textContent = date;
      main.append(num, dates);
      const arrow = document.createElement('span'); arrow.className='elrc-arrow'; arrow.textContent='⌄';
      summary.append(main, arrow); row.append(summary);
      const links = document.createElement('div'); links.className = 'elrc-lessons';
      const lessons = item.querySelectorAll(':scope > .el-menu > .el-menu-item');
      for (const lesson of lessons) {
        const btn = document.createElement('button'); btn.type='button'; btn.className='elrc-lesson';
        const name = lesson.querySelector('.section_name_section')?.textContent.trim() || lesson.textContent.trim();
        const day = lesson.querySelector('.section_name_date')?.textContent.trim() || '';
        const n = document.createElement('span'); n.textContent=name;
        const d = document.createElement('small'); d.textContent=day;
        const icon = document.createElement('span'); icon.className='elrc-play'; icon.textContent='▶';
        btn.append(icon,n,d); btn.addEventListener('click', () => lesson.click()); links.append(btn);
      }
      if (!lessons.length) { const empty=document.createElement('span'); empty.className='elrc-empty'; empty.textContent='暂无课程'; links.append(empty); }
      row.append(links); columns[weekIndex++ % 2].append(row);
    }
    body.append(wrap);
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
  function installButton() {
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
  const start = () => { installButton(); new MutationObserver(installButton).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
