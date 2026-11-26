(() => {
  const defaults = { wide: true, watermark: true, panels: true, autoHideHeader: false };
  let current = defaults;
  let webFullscreen;
  function apply(settings) {
    current = { ...defaults, ...settings };
    if (!current.wide) webFullscreen?.close();
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('elrc-wide', current.wide);
    root.classList.toggle('elrc-hide-watermark', current.watermark);
    root.classList.toggle('elrc-hide-panels', current.panels);
    window.dispatchEvent(new Event('resize'));
    if (document.body) installButton();
  }
  let allowPlayerPlayback = () => {};
  function preventUnrequestedPlayback() {
    const playingByRequest = new WeakSet();
    let requestedPlayer;
    let requestExpires = 0;

    function allowPlayback(player) {
      requestedPlayer = player;
      requestExpires = performance.now() + 1500;
    }
    allowPlayerPlayback = allowPlayback;
    document.addEventListener('click', event => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const player = event.target.closest('.multi_view_player_container');
      if (!player || event.target.closest('.elrc-focus-float')) return;
      const control = event.target.closest('.tool_bar > span');
      const isPlaybackToggle = control?.nextElementSibling?.matches('.multi_view_player_time');
      if (isPlaybackToggle || event.target.closest('.elrc-play-toggle') ||
          event.target.closest('.player_group .video_container')) allowPlayback(player);
    }, true);
    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.repeat || event.altKey || event.metaKey || event.ctrlKey ||
          ![' ', 'MediaPlayPause'].includes(event.key)) return;
      if (event.target instanceof Element &&
          event.target.closest('button, input, select, textarea, a, [contenteditable], [role="button"]')) return;
      const player = document.querySelector('.review_student .multi_view_player_container');
      if (player) allowPlayback(player);
    }, true);
    document.addEventListener('visibilitychange', () => { requestExpires = 0; }, true);
    window.addEventListener('blur', () => { requestExpires = 0; });
    document.addEventListener('play', event => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      const player = video.closest('.review_student .multi_view_player_container');
      if (!player || !video.closest('.player_group')) return;
      // Additional feeds can join a recording that is already playing by request.
      const continuing = [...player.querySelectorAll('.player_group video')].some(other =>
        other !== video && playingByRequest.has(other) && !other.paused && !other.ended);
      if (continuing || (player === requestedPlayer && performance.now() <= requestExpires && !document.hidden)) {
        playingByRequest.add(video);
      } else {
        video.pause();
      }
    }, true);
    document.addEventListener('pause', event => playingByRequest.delete(event.target), true);
    document.addEventListener('ended', event => playingByRequest.delete(event.target), true);
  }
  preventUnrequestedPlayback();

  const recordingSelector = '.player_group .player_item video';
  const playbackToggles = new WeakMap();
  let cancelResume = () => {};

  function seekRecording(player, time) {
    if (!Number.isFinite(time)) return;
    cancelResume();
    for (const video of player.querySelectorAll(recordingSelector)) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) continue;
      const target = Math.max(0, Math.min(video.duration, time));
      if (Math.abs(video.currentTime - target) > 0.001) video.currentTime = target;
    }
  }

  function installPlaybackKeys() {
    let pendingSeek;
    let seekFrame = 0;
    let rightHold;
    let leftHandled = false;
    let spaceHandled = false;

    function seek(player, delta) {
      const videos = [...player.querySelectorAll(recordingSelector)]
        .filter(video => Number.isFinite(video.duration) && video.duration > 0);
      const clock = videos.find(video => !video.paused && !video.ended) || videos[0];
      if (!clock) return;
      const url = location.href;
      const base = pendingSeek?.player === player && pendingSeek.url === url
        ? pendingSeek.time : clock.currentTime;
      const time = Math.min(clock.duration, Math.max(0, base + delta));
      cancelResume();
      pendingSeek = {player, url, time};
      if (seekFrame) return;
      seekFrame = requestAnimationFrame(() => {
        seekFrame = 0;
        const request = pendingSeek;
        pendingSeek = null;
        if (!request?.player.isConnected || request.url !== location.href) return;
        seekRecording(request.player, request.time);
      });
    }

    function finishRight(tap) {
      const hold = rightHold;
      if (!hold) return;
      rightHold = null;
      clearTimeout(hold.timer);
      hold.indicator?.remove();
      for (const [video, rate] of hold.rates) {
        if (video.playbackRate === 3) video.playbackRate = rate;
      }
      if (tap && !hold.rates.size && hold.url === location.href && hold.player.isConnected) {
        seek(hold.player, 10);
      }
    }

    function startRight(player) {
      const hold = {player, url: location.href, rates: new Map()};
      rightHold = hold;
      hold.timer = setTimeout(() => {
        if (rightHold !== hold || hold.url !== location.href || !player.isConnected) return;
        const videos = [...player.querySelectorAll(recordingSelector)];
        if (!videos.some(video => !video.paused && !video.ended)) return;
        cancelResume();
        for (const video of videos) {
          hold.rates.set(video, video.playbackRate);
          video.playbackRate = 3;
        }
        hold.indicator = document.createElement('span');
        hold.indicator.className = 'elrc-fast-rate';
        hold.indicator.setAttribute('role', 'status');
        hold.indicator.textContent = '3×';
        player.append(hold.indicator);
      }, 400);
    }

    function consume(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    window.addEventListener('keydown', event => {
      if (!event.isTrusted || event.isComposing || event.altKey || event.ctrlKey ||
          event.metaKey || event.shiftKey) return;
      const space = event.key === ' ' || event.code === 'Space';
      if (!space && !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && (target.isContentEditable || target.closest(
        'input, select, textarea, [role="textbox"], [role="slider"], .elrc-float-handle, .elrc-float-resize, .elrc-popover, .elrc-playback-menu'
      ))) return;
      const player = document.querySelector('.review_student .multi_view_player_container');
      if (!player?.querySelector(recordingSelector)) return;
      if (space) {
        const toggle = current.wide && playbackToggles.get(player);
        if (!toggle) return;
        if (target?.closest('button:focus-visible, a:focus-visible, summary:focus-visible, [role="button"]:focus-visible') &&
            !target.closest('.elrc-play-toggle')) return;
        consume(event);
        spaceHandled = true;
        if (!event.repeat) toggle(event);
        return;
      }
      consume(event);
      if (event.key === 'ArrowRight') {
        if (!event.repeat && !rightHold) startRight(player);
      } else {
        leftHandled = true;
        seek(player, -10);
      }
    }, true);
    window.addEventListener('keyup', event => {
      if (!event.isTrusted) return;
      if (spaceHandled && (event.key === ' ' || event.code === 'Space')) {
        spaceHandled = false;
        consume(event);
      } else if (event.key === 'ArrowRight' && rightHold) {
        consume(event);
        finishRight(true);
      } else if (event.key === 'ArrowLeft' && leftHandled) {
        consume(event);
        leftHandled = false;
      }
    }, true);
    window.addEventListener('blur', () => { spaceHandled = false; finishRight(false); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) finishRight(false);
    });
    window.addEventListener('pointerdown', event => {
      if (event.target instanceof Element && event.target.closest('.multi_view_player_container')) {
        pendingSeek = null;
        finishRight(false);
      }
    }, true);
  }
  installPlaybackKeys();

  function resumeRecord(value) {
    if (typeof value === 'number') return {position: value, duration: 0, completed: false};
    return value || {position: 0, duration: 0, completed: false};
  }

  function setupResume() {
    let currentKey = '';
    let generation = 0;
    let lastSaved = 0;
    let watchedInVisit = false;
    let savedTime = 0;
    let restoring = false;
    let restored = new WeakSet();
    const attached = new WeakSet();
    const videos = () => [...document.querySelectorAll(recordingSelector)];

    function keyForPage() {
      const url = new URL(location.href);
      const fields = ['id', 'week', 'weekDay', 'realSection'].map(key =>
        `${key}=${encodeURIComponent(url.searchParams.get(key) || '')}`).join('&');
      return `resume:${url.pathname}?${fields}`;
    }

    cancelResume = () => {
      restoring = false;
      savedTime = 0;
    };

    function seekSavedPosition(video) {
      if (!restoring || restored.has(video) || !Number.isFinite(video.duration) ||
          savedTime <= 10 || savedTime >= video.duration - 10) return;
      restored.add(video);
      video.currentTime = savedTime;
    }

    function bind() {
      const key = keyForPage();
      if (key !== currentKey) {
        const run = ++generation;
        currentKey = key;
        lastSaved = 0;
        watchedInVisit = false;
        savedTime = 0;
        restoring = true;
        restored = new WeakSet();
        chrome.storage.local.get(key, data => {
          if (run !== generation || !restoring) return;
          savedTime = Number(resumeRecord(data[key]).position) || 0;
          if (savedTime <= 10 || resumeRecord(data[key]).completed) cancelResume();
          videos().forEach(seekSavedPosition);
        });
      }
      for (const video of videos()) {
        if (attached.has(video)) continue;
        attached.add(video);
        video.addEventListener('loadedmetadata', () => seekSavedPosition(video));
        video.addEventListener('play', () => {
          if (video.paused) return;
          watchedInVisit = true;
          cancelResume();
        });
        const save = (force = false) => {
          if (!video.isConnected || videos()[0] !== video || keyForPage() !== currentKey ||
              !Number.isFinite(video.duration) || video.duration <= 0) return;
          if (restoring && !restored.has(video)) return;
          const now = Date.now();
          if (!force && (video.paused || now - lastSaved < 10000)) return;
          const position = video.currentTime;
          if (!watchedInVisit && position === 0) return;
          watchedInVisit = true;
          lastSaved = now;
          chrome.storage.local.set({
            [currentKey]: {position, duration: video.duration, completed: position >= video.duration - 10, updatedAt: now}
          });
        };
        video.addEventListener('timeupdate', () => save());
        video.addEventListener('pause', () => save(true));
        video.addEventListener('seeked', () => save(true));
        video.addEventListener('ended', () => save(true));
      }
    }
    document.addEventListener('pointerdown', event => {
      if (event.isTrusted && event.target instanceof Element &&
          event.target.closest('.multi_view_player_container')) cancelResume();
    }, true);
    bind();
    new MutationObserver(bind).observe(document.body, {childList: true, subtree: true});
  }
  function chapterSeconds(text) {
    const match = text.match(/\d+(?::\d{1,2}){1,2}/);
    return match ? match[0].split(':').reduce((total, part) => total * 60 + Number(part), 0) : null;
  }

  function jumpToChapter(middle, seconds) {
    const player = middle.querySelector('.multi_view_player_container');
    if (player && seconds !== null) seekRecording(player, seconds);
  }

  async function copyTranscript(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      return `已复制 ${text.length.toLocaleString()} 字`;
    } catch {
      return '复制失败';
    }
  }

  function makeStudyPanel(middle, className, title) {
    const panel = document.createElement('section');
    panel.className = `elrc-study-panel ${className}`;
    const header = document.createElement('header');
    header.className = 'elrc-study-head';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'elrc-study-actions';
    header.append(heading, actions);
    panel.append(header);
    middle.append(panel);
    return {panel, actions};
  }

  function studyButton(icon, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'elrc-study-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    setPlayerIcon(button, icon);
    return button;
  }

  const transcriptPanels = new WeakMap();
  const initializedTranscriptTabs = new WeakMap();
  function renderTranscript(middle) {
    let state = transcriptPanels.get(middle);
    if (!state) {
      const {panel, actions} = makeStudyPanel(middle, 'elrc-permanent-transcript', '逐字稿');
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = '搜索逐字稿';
      search.setAttribute('aria-label', '搜索逐字稿');
      const copy = studyButton('copy', '复制逐字稿');
      const status = document.createElement('span');
      status.className = 'elrc-study-status';
      status.setAttribute('role', 'status');
      const list = document.createElement('div');
      list.className = 'elrc-study-transcript';
      list.tabIndex = 0;
      list.setAttribute('aria-label', '逐字稿正文');
      const copyAction = document.createElement('span');
      copyAction.className = 'elrc-transcript-copy-action';
      const toast = document.createElement('span');
      toast.className = 'elrc-transcript-copy-toast';
      toast.setAttribute('role', 'status');
      copyAction.append(copy, toast);
      actions.append(search, copyAction, status);
      panel.append(list);

      state = {list, status, copy, text: '', signature: ''};
      state.filter = () => {
        const query = search.value.trim().toLocaleLowerCase();
        let count = 0;
        for (const row of list.querySelectorAll('.elrc-transcript-cue')) {
          row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
          if (!row.hidden) count++;
        }
        status.textContent = query ? `${count} 条结果` : '';
      };
      search.addEventListener('input', state.filter);
      let toastTimer;
      let toastAnimation;
      copy.addEventListener('click', async () => {
        const message = await copyTranscript(state.text);
        if (!message) return;
        clearTimeout(toastTimer);
        toastAnimation?.cancel();
        toast.textContent = message;
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const start = reducedMotion ? 'none' : 'translateY(-4px)';
        toastAnimation = toast.animate?.([
          {opacity: 0, transform: start, offset: 0},
          {opacity: 1, transform: 'none', offset: .12},
          {opacity: 1, transform: 'none', offset: .85},
          {opacity: 0, transform: start, offset: 1},
        ], {duration: 1500, easing: 'ease-out', fill: 'both'});
        toastTimer = setTimeout(() => {
          toast.textContent = '';
          toastAnimation?.cancel();
        }, 1500);
      });
      transcriptPanels.set(middle, state);
    }
    const native = document.querySelector('.left_overview_container');
    const tab = [...native?.querySelectorAll('.fast_view_tabs_sufe .tab') || []]
      .find(node => /语音文本|逐字稿/.test(node.textContent));
    const rows = [...native?.querySelectorAll('.paragraph') || []].map(paragraph => ({
      time: paragraph.querySelector('.point_in')?.textContent.trim() || '',
      text: [...paragraph.querySelectorAll('span[slot="reference"]')]
        .map(span => span.textContent.trim()).filter(Boolean).join(' '),
    })).filter(row => row.text);
    if (!rows.length && tab && initializedTranscriptTabs.get(tab) !== location.href) {
      initializedTranscriptTabs.set(tab, location.href);
      tab.click();
    }
    const signature = JSON.stringify([location.href, rows]);
    if (state.signature === signature) return;
    state.signature = signature;
    state.text = rows.map(row => row.text).join('\n\n');
    state.copy.disabled = !state.text;
    const body = document.createDocumentFragment();
    for (const row of rows) {
      const cue = document.createElement('article');
      cue.className = 'elrc-transcript-cue';
      const time = document.createElement('button');
      time.type = 'button';
      time.className = 'elrc-cue-time';
      time.textContent = row.time || '—';
      const seconds = chapterSeconds(row.time);
      time.disabled = seconds === null;
      time.addEventListener('click', () => jumpToChapter(middle, seconds));
      const text = document.createElement('p');
      text.textContent = row.text;
      cue.append(time, text);
      body.append(cue);
    }
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'elrc-study-empty';
      empty.textContent = '暂无逐字稿';
      body.append(empty);
    }
    state.list.replaceChildren(body);
    state.filter();
  }

  const timelinePanels = new WeakMap();
  const initializedPptControls = new WeakMap();
  function renderTimeline(middle) {
    let state = timelinePanels.get(middle);
    if (!state) {
      const {panel, actions} = makeStudyPanel(middle, 'elrc-permanent-timeline', '课程时间线');
      const track = document.createElement('div');
      track.className = 'elrc-chapter-track';
      track.tabIndex = 0;
      track.setAttribute('aria-label', '按时间浏览课程内容');
      const previous = studyButton('previous', '往前浏览');
      const next = studyButton('next', '往后浏览');
      previous.addEventListener('click', () => track.scrollBy({left: -track.clientWidth * 0.85, behavior: 'smooth'}));
      next.addEventListener('click', () => track.scrollBy({left: track.clientWidth * 0.85, behavior: 'smooth'}));
      state = {track, signature: ''};
      state.updateButtons = () => {
        previous.disabled = track.scrollLeft <= 1;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
      };
      track.addEventListener('scroll', state.updateButtons, {passive: true});
      new ResizeObserver(state.updateButtons).observe(track);
      actions.append(previous, next);
      panel.append(track);
      timelinePanels.set(middle, state);
    }

    const source = middle.querySelector('.ppt_list_section_container .courseware_screenshoot_panel_sufe .list');
    const ppt = middle.querySelector('.tool_bar .pptList');
    if (!source && ppt && initializedPptControls.get(ppt) !== location.href) {
      initializedPptControls.set(ppt, location.href);
      ppt.click();
    }
    const entries = [
      ...[...source?.querySelectorAll(':scope > .screenshot_card_wrapper') || []].map(card => ({
        kind: '课件',
        time: card.querySelector('.time_text')?.textContent.replace('（进行中）', '').trim() || '',
        title: card.querySelector('.item_label')?.textContent.trim() || '课件',
        text: card.querySelector('.desc')?.textContent.trim() || '',
        image: card.querySelector('img')?.getAttribute('src'),
      })),
      ...[...document.querySelectorAll('.knowledge_card_wrapper')].map(card => ({
        kind: '知识点',
        time: card.querySelector('.card_time')?.textContent.trim() || '',
        title: card.querySelector('.card_title')?.textContent.trim() || '知识点',
        text: card.querySelector('.card_desc')?.textContent.trim() || '',
      })),
    ];
    entries.sort((a, b) => (chapterSeconds(a.time) ?? Infinity) - (chapterSeconds(b.time) ?? Infinity));
    const signature = JSON.stringify([location.href, entries]);
    if (state.signature === signature) return;
    const samePage = state.page === location.href;
    state.signature = signature;
    state.page = location.href;
    const track = document.createDocumentFragment();
    for (const entry of entries) {
      const chapter = document.createElement('button');
      chapter.type = 'button';
      chapter.className = 'elrc-chapter';
      const seconds = chapterSeconds(entry.time);
      chapter.disabled = seconds === null;
      const meta = document.createElement('span');
      meta.className = 'elrc-chapter-meta';
      const kind = document.createElement('span');
      kind.textContent = entry.kind;
      const time = document.createElement('time');
      time.textContent = seconds === null ? '—' : mediaClock(seconds);
      meta.append(kind, time);
      const title = document.createElement('strong');
      title.textContent = entry.title;
      chapter.append(meta, title);
      if (entry.text) {
        const description = document.createElement('span');
        description.textContent = entry.text;
        chapter.append(description);
      }
      if (entry.image) {
        const image = document.createElement('img');
        image.src = entry.image;
        image.alt = '';
        image.loading = 'lazy';
        chapter.append(image);
      }
      chapter.addEventListener('click', () => jumpToChapter(middle, seconds));
      track.append(chapter);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'elrc-study-empty';
      empty.textContent = '暂无课程时间线';
      track.append(empty);
    }
    const offset = samePage ? state.track.scrollLeft : 0;
    state.track.replaceChildren(track);
    state.track.scrollLeft = offset;
    state.updateButtons();
  }

  const studySources = new WeakMap();
  function watchStudySources(middle) {
    const native = [
      middle.closest('.review_student')?.querySelector('.left_overview_container'),
      middle.querySelector('.ppt_list_section_container'),
    ];
    const previous = studySources.get(middle);
    if (previous?.page === location.href && native.every((node, index) => node === previous.native[index])) return;
    previous?.observer.disconnect();
    const render = () => {
      if (!current.wide || !middle.isConnected) return;
      renderTimeline(middle);
      renderTranscript(middle);
    };
    // The visible panels are separate from the source DOM, so rendering cannot trigger this observer.
    const observer = new MutationObserver(render);
    for (const node of native.filter(Boolean)) {
      observer.observe(node, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src']});
    }
    studySources.set(middle, {native, observer, page: location.href});
    render();
  }

  function isCurrentWeek(dateRange, today) {
    const dates = [...dateRange.matchAll(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/g)]
      .map(match => `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
    return dates.length === 2 && dates[0] <= today && today <= dates[1];
  }
  function lessonSlot(week, day, section) {
    const normalized = (section || '').replace(/\s/g, '').replace(/^(\d+)-\1$/, '$1');
    return week && day && normalized ? [week, day.replace('周天', '周日'), normalized].join('|') : '';
  }

  function lessonSlotFromParams(params) {
    return lessonSlot(params.get('week'), params.get('weekDay'), params.get('realSection'));
  }

  const progressByQueue = new WeakMap();

  function showEpisodeProgress(episodes) {
    const prefix = `resume:${location.pathname}?`;
    const records = new Map();
    function update(key, value) {
      if (key.startsWith(prefix)) {
        if (value === undefined) records.delete(key);
        else records.set(key, resumeRecord(value));
      }
    }
    function render() {
      const bySlot = new Map();
      for (const [key, record] of records) {
        const slot = lessonSlotFromParams(new URLSearchParams(key.slice(prefix.length)));
        const previous = bySlot.get(slot);
        if (!slot || previous && (previous.updatedAt || 0) > (record.updatedAt || 0)) continue;
        if (previous && !record.updatedAt && previous.position > record.position) continue;
        bySlot.set(slot, record);
      }
      for (const row of episodes.querySelectorAll('.elrc-lesson[data-slot]')) {
        const record = bySlot.get(row.dataset.slot);
        const bar = row.querySelector('.elrc-episode-progress');
        const position = Number(record?.position);
        const duration = Number(record?.duration);
        const ratio = record?.completed ? 1 : duration > 0 && position > 0 ? Math.min(1, position / duration) : 0;
        bar.hidden = !ratio;
        if (ratio && bar.value !== ratio) bar.value = ratio;
      }
    }
    const changed = new Set();
    progressByQueue.set(episodes, changes => {
      let relevant = false;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(prefix)) continue;
        changed.add(key);
        update(key, change.newValue);
        relevant = true;
      }
      if (relevant) render();
    });
    chrome.storage.local.get(null, data => {
      if (!episodes.isConnected) return;
      for (const [key, value] of Object.entries(data)) {
        if (!changed.has(key)) update(key, value);
      }
      changed.clear();
      render();
    });
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
  function locateCurrentEpisode(episodes) {
    const list = episodes.querySelector('.elrc-week-list');
    const active = list.querySelector('[aria-current="true"]');
    if (!active?.closest('details')?.open || episodes.hidden || !list.clientHeight) return;
    const row = active.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (row.top < viewport.top || row.bottom > viewport.bottom) {
      list.scrollTop += row.top - viewport.top - (list.clientHeight - row.height) / 2;
    }
  }

  function watchSidebar(middle) {
    let sidebar = middle.querySelector(':scope > .elrc-watch-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.className = 'elrc-watch-sidebar';
      middle.append(sidebar);
    }
    return sidebar;
  }

  function buildDirectory() {
    const review = document.querySelector('.review_student');
    const middle = review?.querySelector('.middle_content');
    const source = review?.querySelector('.menu_drawer_body .left_menu_sufe > .el-menu');
    const items = source ? [...source.querySelectorAll(':scope > .el-submenu')] : [];
    if (!middle || !items.length) return;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const params = new URL(location.href).searchParams;
    const activeSlot = lessonSlotFromParams(params);
    const sidebar = watchSidebar(middle);
    const previous = sidebar.querySelector(':scope > .elrc-episodes');
    const signature = [location.href, today, ...items.map(item =>
      item.textContent + ':' + [...item.querySelectorAll('.el-menu-item')].map(lesson => lesson.className).join(',')
    )].join('|');
    if (previous?.dataset.signature === signature) return;

    const openWeeks = new Map([...previous?.querySelectorAll('.elrc-week') || []]
      .map(row => [row.dataset.week, row.open]));
    const episodes = document.createElement('aside');
    episodes.id = 'elrc-episodes';
    episodes.className = 'elrc-episodes';
    episodes.dataset.signature = signature;
    episodes.setAttribute('aria-labelledby', 'elrc-episodes-title');
    const wrap = document.createElement('div');
    wrap.className = 'elrc-directory';
    wrap.innerHTML = `
      <div class="elrc-directory-head">
        <div>
          <h2 id="elrc-episodes-title">课次</h2>
          <p class="elrc-episode-position"></p>
        </div>
      </div>
      <div class="elrc-week-list"></div>`;
    episodes.append(wrap);
    const list = wrap.querySelector('.elrc-week-list');
    const badge = (text, className) => {
      const node = document.createElement('span');
      node.className = className;
      node.textContent = text;
      return node;
    };

    let count = 0;
    let activeIndex = 0;
    for (const item of items) {
      const title = item.querySelector(':scope > .el-submenu__title');
      const lessons = [...item.querySelectorAll(':scope > .el-menu > .el-menu-item')]
        .filter(lesson => lesson.querySelector('.section_name_section')?.textContent.trim());
      if (!title || !lessons.length) continue;
      const week = title.querySelector('.week')?.textContent.trim() || title.textContent.trim();
      const date = title.querySelector('.date')?.textContent.trim() || '';
      const row = document.createElement('details');
      row.className = 'elrc-week';
      row.dataset.week = week;
      const summary = document.createElement('summary');
      const arrow = badge('', 'elrc-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      summary.append(arrow, badge(week, 'elrc-week-name'));
      if (isCurrentWeek(date, today)) summary.append(badge('本周', 'elrc-week-badge'));
      if (date) summary.title = date;
      row.append(summary);
      const links = document.createElement('div');
      links.className = 'elrc-lessons';
      let activeWeek = false;
      for (const lesson of lessons) {
        const name = lesson.querySelector('.section_name_section').textContent.trim();
        const date = lesson.querySelector('.section_name_date')?.textContent.trim() || '';
        const slot = lessonSlot(week.match(/\d+/)?.[0], name.match(/周[一二三四五六日天]/)?.[0],
          name.match(/第\s*(\d+(?:\s*-\s*\d+)?)\s*节/)?.[1]);
        const active = activeSlot ? slot === activeSlot : lesson.classList.contains('is-active');
        const index = ++count;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'elrc-lesson';
        const number = badge(String(index).padStart(2, '0'), 'elrc-episode-number');
        number.setAttribute('aria-hidden', 'true');
        const info = document.createElement('span');
        info.className = 'elrc-episode-info';
        info.append(badge(name, 'elrc-lesson-name'));
        if (date) info.append(badge(date, 'elrc-episode-date'));
        if (slot) {
          button.dataset.slot = slot;
          const bar = document.createElement('progress');
          bar.className = 'elrc-episode-progress';
          bar.hidden = true;
          bar.max = 1;
          bar.value = 0;
          bar.setAttribute('aria-label', '观看进度');
          info.append(bar);
        }
        button.append(number, info);
        if (active) {
          activeIndex = index;
          activeWeek = true;
          button.setAttribute('aria-current', 'true');
          setPlayerIcon(number, 'play');
        }
        button.addEventListener('click', () => lesson.click());
        links.append(button);
      }
      row.open = openWeeks.get(week) ?? true;
      if (activeWeek && previous?.dataset.page !== location.href) row.open = true;
      row.append(links);
      list.append(row);
    }
    if (!count) return;
    wrap.querySelector('.elrc-episode-position').textContent =
      activeIndex ? `第 ${activeIndex} 节 / 共 ${count} 节` : `共 ${count} 节`;
    episodes.dataset.page = location.href;
    const oldScroll = previous?.querySelector('.elrc-week-list').scrollTop || 0;
    if (previous) previous.replaceWith(episodes); else sidebar.append(episodes);
    list.scrollTop = oldScroll;
    showEpisodeProgress(episodes);
    if (previous?.dataset.page !== location.href) requestAnimationFrame(() => locateCurrentEpisode(episodes));
  }

  const companionDrawers = new WeakMap();

  function copyChatContent(source, target) {
    const tags = new Set('a b blockquote br caption code dd del div dl dt em h1 h2 h3 h4 h5 h6 hr i li ol p pre s span strong sub sup table tbody td th thead tr ul'.split(' '));
    function copy(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.data));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script,style,svg,[hidden],.katex-mathml')) return;
      const name = node.localName;
      const element = tags.has(name) ? document.createElement(name) : parent;
      if (name === 'a' && node.hasAttribute('href')) {
        const href = node.getAttribute('href');
        const url = URL.canParse(href, node.baseURI) ? new URL(href, node.baseURI) : null;
        if (url && ['http:', 'https:'].includes(url.protocol)) {
          element.href = url.href;
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        }
      }
      for (const child of node.childNodes) copy(child, element);
      if (element !== parent) parent.append(element);
      if (name === 'img' && node.alt) parent.append(document.createTextNode(node.alt));
    }
    for (const node of source.childNodes) copy(node, target);
  }

  function chatRole(item, body, submitted) {
    const user = /(?:^|[\s_-])(user|human|student|learner|question|self)(?:$|[\s_-])/i;
    const assistant = /(?:^|[\s_-])(assistant|agent|bot|ai|answer)(?:$|[\s_-])/i;
    const metadata = item.getAttribute('data-message-author-role') || item.getAttribute('data-author-role') ||
      item.getAttribute('data-role') || '';
    if (user.test(metadata)) return 'user';
    if (assistant.test(metadata)) return 'assistant';
    const classes = item.className.replace(/([a-z])([A-Z])/g, '$1-$2');
    if (user.test(classes)) return 'user';
    if (submitted.has(body.textContent.trim().replace(/\s+/g, ' '))) return 'user';
    return 'assistant';
  }

  function prepareCompanionDrawer(source) {
    const installed = companionDrawers.get(source);
    if (installed) return installed;

    const panel = document.createElement('section');
    panel.id = 'elrc-ask-ai';
    panel.className = 'elrc-ai-drawer';
    panel.inert = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'elrc-ask-ai-title');
    panel.innerHTML = `
      <header class="elrc-ai-heading">
        <h2 id="elrc-ask-ai-title"><span class="elrc-ai-mark"></span>询问 AI</h2>
        <button class="elrc-ai-close" type="button" aria-label="关闭询问 AI" title="关闭询问 AI"></button>
      </header>
      <div class="elrc-ai-thread" role="log" aria-label="问答记录" tabindex="0"></div>
      <div class="elrc-ai-entry">
        <div class="elrc-ai-suggestions" role="group" aria-label="建议问题"></div>
        <form class="elrc-ai-form">
          <textarea rows="1" aria-label="输入课程问题" placeholder="问问这节课"></textarea>
          <button class="elrc-ai-send" type="submit" aria-label="发送问题" title="发送问题" disabled></button>
        </form>
        <p class="elrc-ai-status" role="status"></p>
      </div>`;
    const close = panel.querySelector('.elrc-ai-close');
    const thread = panel.querySelector('.elrc-ai-thread');
    const suggestions = panel.querySelector('.elrc-ai-suggestions');
    const status = panel.querySelector('.elrc-ai-status');
    const editor = panel.querySelector('textarea');
    const send = panel.querySelector('.elrc-ai-send');
    setPlayerIcon(panel.querySelector('.elrc-ai-mark'), 'sparkle');
    setPlayerIcon(close, 'close');
    setPlayerIcon(send, 'send');
    source.classList.add('elrc-ai-source');

    const drawer = {panel, open: false, trigger: null, show, dismiss};
    const rendered = [];
    const submitted = new Set();
    let frameDocument;
    let frameObserver;
    let suggestionSignature = '';
    let pending;
    let connectTimeout;
    let sendTimeout;
    const nativeEditor = () => frameDocument?.querySelector('.chat-input-container [contenteditable="true"]');
    const nativeSend = () => frameDocument?.querySelector('.input-wrp button.submit_template_btn');

    function updateSend() {
      send.disabled = !nativeEditor() || !nativeSend() || Boolean(pending) || !editor.value.trim();
    }

    function resizeEditor() {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
      updateSend();
    }

    function nearEnd() {
      return thread.scrollHeight - thread.clientHeight - thread.scrollTop < 48;
    }

    function followThread(atEnd) {
      if (atEnd && rendered.length) thread.scrollTop = thread.scrollHeight;
    }

    const blockRevealTimes = new WeakMap();

    function revealBlock(block, readyAt, reducedMotion) {
      const delay = readyAt - performance.now();
      function appear() {
        if (!block.isConnected) return;
        const atEnd = nearEnd();
        block.hidden = false;
        blockRevealTimes.delete(block);
        block.animate?.([
          {opacity: 0, transform: reducedMotion ? 'none' : 'translateY(4px)'},
          {opacity: 1, transform: 'none'}
        ], {duration: reducedMotion ? 125 : 225, easing: 'ease-out'});
        followThread(atEnd);
      }
      if (delay > 2) {
        block.hidden = true;
        blockRevealTimes.set(block, readyAt);
        setTimeout(appear, delay);
      } else {
        appear();
      }
    }

    function writeMessage(entry, body, reveal, completeOnly = false) {
      const fragment = document.createDocumentFragment();
      copyChatContent(body, fragment);
      const blocks = [];
      function collectBlocks(parent) {
        for (const node of parent.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) continue;
          const wrapsBlocks = node.localName === 'div' &&
            [...node.children].some(child => child.matches('div,p,ul,ol,blockquote,pre,table,hr,h1,h2,h3,h4,h5,h6'));
          if (wrapsBlocks) collectBlocks(node);
          else blocks.push(node);
        }
      }
      collectBlocks(fragment);
      if (completeOnly) blocks.pop();
      const atEnd = nearEnd();
      const freshBlocks = Math.max(1, blocks.length - entry.content.children.length);
      const batchSize = Math.ceil(freshBlocks / 5);
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      let revealed = 0;
      for (const [index, block] of blocks.entries()) {
        const previous = entry.content.children[index];
        if (previous?.firstChild?.isEqualNode(block)) continue;
        const child = document.createElement('div');
        child.append(block);
        if (previous) {
          const readyAt = blockRevealTimes.get(previous);
          previous.replaceWith(child);
          if (readyAt) revealBlock(child, readyAt, reducedMotion);
        } else {
          entry.content.append(child);
          if (reveal) {
            const batch = Math.floor(revealed++ / batchSize);
            revealBlock(child, performance.now() + batch * (reducedMotion ? 65 : 95), reducedMotion);
          }
        }
      }
      if (!completeOnly) {
        while (entry.content.children.length > blocks.length) entry.content.lastElementChild.remove();
        entry.row.removeAttribute('data-buffering');
      }
      followThread(atEnd);
    }

    function render(existingConversation = false) {
      const atEnd = nearEnd();
      const messages = Array.from(frameDocument?.querySelectorAll('.chat-ls-wrp .chat-item-wrp:not(.recommendation_problems)') || [])
        .map(item => {
          const body = item.querySelector('.chat-message-content');
          return body && {kind: chatRole(item, body, submitted), body};
        }).filter(Boolean);
      for (const [index, {kind, body}] of messages.entries()) {
        let entry = rendered[index];
        const lastReply = kind === 'assistant' && index === messages.length - 1;
        const signature = body.innerHTML;
        if (entry?.signature === signature && entry.kind === kind && (lastReply || !entry.timer)) continue;
        clearTimeout(entry?.timer);
        if (!entry || entry.kind !== kind) {
          const row = document.createElement('article');
          row.className = `elrc-ai-message elrc-ai-${kind}`;
          const label = document.createElement('span');
          label.className = 'elrc-ai-message-label';
          label.textContent = kind === 'user' ? '你' : '课程 AI';
          const content = document.createElement('div');
          content.className = 'elrc-ai-message-content';
          row.append(label, content);
          if (entry) entry.row.replaceWith(row);
          else thread.append(row);
          entry = rendered[index] = {row, content, kind, lastBatch: 0};
        }
        entry.signature = signature;
        entry.timer = null;
        if (lastReply && !existingConversation) {
          entry.row.dataset.buffering = 'true';
          const now = performance.now();
          if (now - entry.lastBatch >= 220) {
            writeMessage(entry, body, true, true);
            entry.lastBatch = now;
          }
          entry.timer = setTimeout(() => {
            entry.timer = null;
            writeMessage(entry, body, true);
          }, 600);
        } else {
          writeMessage(entry, body, !existingConversation && kind === 'user');
        }
      }
      while (rendered.length > messages.length) {
        const entry = rendered.pop();
        clearTimeout(entry.timer);
        entry.row.remove();
      }
      panel.classList.toggle('elrc-ai-has-messages', !!rendered.length);
      followThread(atEnd);

      const sitePrompts = Array.from(frameDocument?.querySelectorAll('.recommendation_problems .bot-advice a') || [],
        node => node.textContent.trim()).filter(Boolean);
      const prompts = [...new Set([...sitePrompts, '概括这节课的主要知识点', '用一个例子解释本节课的核心概念'])].slice(0, 2);
      const signature = JSON.stringify(prompts);
      if (signature !== suggestionSignature) {
        suggestionSignature = signature;
        suggestions.replaceChildren(...prompts.map(text => {
          const button = document.createElement('button');
          button.type = 'button';
          setPlayerIcon(button, 'next');
          button.append(document.createTextNode(text));
          button.addEventListener('click', () => {
            editor.value = text;
            resizeEditor();
            editor.focus();
          });
          return button;
        }));
      }

      if (pending?.sent && (messages.filter(item => item.kind === 'user').length > pending.count ||
          nativeEditor()?.textContent.trim() === '')) {
        if (editor.value.trim() === pending.text) editor.value = '';
        stopSubmission('');
        resizeEditor();
      }
      updateSend();
    }

    function connect() {
      const frame = [...source.querySelectorAll('.right_panel_shanghaiTech iframe[src]')].find(item => {
        const url = new URL(item.getAttribute('src'), location.href);
        return url.origin === location.origin && url.pathname === '/terminator/resource/chat';
      });
      const nextDocument = frame?.contentDocument;
      const newConversation = nextDocument !== frameDocument;
      if (newConversation) {
        frameObserver?.disconnect();
        for (const entry of rendered.splice(0)) {
          clearTimeout(entry.timer);
          entry.row.remove();
        }
        submitted.clear();
        frameDocument = nextDocument;
        if (nextDocument) {
          frameObserver = new MutationObserver(connect);
          frameObserver.observe(nextDocument, {
            childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled']
          });
        }
      }
      panel.classList.toggle('elrc-ai-connected', Boolean(nativeEditor() && nativeSend()));
      if (panel.classList.contains('elrc-ai-connected') && !pending && status.dataset.connection) {
        clearTimeout(connectTimeout);
        delete status.dataset.connection;
        status.textContent = '';
      }
      render(newConversation);
    }

    function stopSubmission(message) {
      clearTimeout(sendTimeout);
      pending = null;
      status.textContent = message;
      updateSend();
    }

    panel.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      if (send.disabled) return;
      const input = nativeEditor();
      if (!input) return;
      const text = editor.value.trim();
      pending = {text, count: rendered.filter(item => item.kind === 'user').length, sent: false};
      status.textContent = '正在发送…';
      updateSend();
      input.textContent = text;
      input.dispatchEvent(new frameDocument.defaultView.InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      sendTimeout = setTimeout(() => {
        if (nativeEditor() !== input) {
          stopSubmission('课程问答已重新连接，请再次发送。');
          return;
        }
        const button = nativeSend();
        if (!button || button.disabled || button.classList.contains('disabled_submit_template_btn')) {
          stopSubmission('目前无法发送，请稍后再试。');
          return;
        }
        pending.sent = true;
        submitted.add(text.replace(/\s+/g, ' '));
        sendTimeout = setTimeout(() => stopSubmission('发送未确认，已保留草稿。'), 4000);
        button.click();
        render();
      }, 0);
    });
    editor.addEventListener('input', resizeEditor);
    editor.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!send.disabled) send.click();
    });
    close.addEventListener('click', dismiss);
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.stopPropagation();
      dismiss();
    });

    function show(trigger) {
      drawer.trigger = trigger;
      drawer.open = true;
      trigger.setAttribute('aria-expanded', 'true');
      panel.inert = false;
      panel.classList.add('elrc-ai-open');
      if (source.classList.contains('state-collapsed')) source.querySelector('.tab_icon_btn')?.click();
      const tab = [...source.querySelectorAll('.panel_tab_buttons .tab_icon_btn')].find(button => button.textContent.includes('问答'));
      if (tab && !tab.classList.contains('active')) tab.click();
      if (!nativeEditor()) {
        status.dataset.connection = 'true';
        status.textContent = '正在连接课程问答…';
        clearTimeout(connectTimeout);
        connectTimeout = setTimeout(() => { status.textContent = '课程问答暂时无法连接，请重新打开。'; }, 12000);
      }
      connect();
      resizeEditor();
      editor.focus({preventScroll: true});
    }

    function dismiss() {
      drawer.open = false;
      panel.classList.remove('elrc-ai-open');
      panel.inert = true;
      drawer.trigger?.setAttribute('aria-expanded', 'false');
      drawer.trigger?.focus({preventScroll: true});
    }

    source.addEventListener('load', connect, true);
    new MutationObserver(connect).observe(source, {childList: true, subtree: true});
    companionDrawers.set(source, drawer);
    return drawer;
  }

  function toggleCompanion(event) {
    const source = document.querySelector('.review_student .right_panel_container');
    if (!source) return;
    if (!current.wide) {
      if (source.classList.contains('state-collapsed')) source.querySelector('.tab_icon_btn')?.click();
      source.scrollIntoView({block: 'nearest'});
      return;
    }
    const middle = source.closest('.review_student').querySelector('.middle_content');
    if (!middle) return;
    const drawer = prepareCompanionDrawer(source);
    const sidebar = watchSidebar(middle);
    if (drawer.panel.parentElement !== sidebar) sidebar.prepend(drawer.panel);
    event.currentTarget.setAttribute('aria-haspopup', 'dialog');
    event.currentTarget.setAttribute('aria-controls', drawer.panel.id);
    if (drawer.open) drawer.dismiss();
    else drawer.show(event.currentTarget);
  }
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target instanceof Element) {
      const ppt = event.target.closest('.tool_bar .pptList');
      if (ppt) { event.preventDefault(); event.stopImmediatePropagation(); ppt.click(); return; }
      if (event.target.matches('.multi_view_player_container .tool_bar')) { event.stopImmediatePropagation(); return; }
    }
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
      if (open) {
        const host = (toolbar.closest('.header_box') || toolbar).getBoundingClientRect();
        const trigger = button.getBoundingClientRect();
        panel.style.left = `${Math.max(0, Math.min(trigger.left - host.left, host.width - panel.offsetWidth))}px`;
        const viewport = toolbar.closest('.review_student')?.getBoundingClientRect();
        const below = Math.min(innerHeight, viewport?.bottom ?? innerHeight) - host.bottom - 8;
        const above = host.top - Math.max(0, viewport?.top ?? 0) - 8;
        const opensAbove = below < panel.scrollHeight && above > below;
        panel.classList.toggle('elrc-popover-above', opensAbove);
        panel.style.maxHeight = `${Math.max(80, opensAbove ? above : below)}px`;
      }
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
  const pictureSettingsByMiddle = new WeakMap();
  function getPictureSettings(middle) {
    return pictureSettingsByMiddle.get(middle);
  }
  function createFocusMode(middle) {
    const panel = document.createElement('section');
    panel.className = 'elrc-picture-settings';
    panel.hidden = true;
    pictureSettingsByMiddle.set(middle, panel);
    middle.append(panel);
    const state = {enabled: true, mainId: '', floatId: '', x: 1, y: 0, width: 0, sizing: 'fit', fixedWidth: 0, customized: false};
    let group;
    let floatItem;
    let handle;
    let drag;
    let signature = '';
    let positionFrame = 0;
    let dragController;
    let swapOnClick = false;
    let nativeMain;
    let nativeFloat;
    const mode = document.createElement('div');
    mode.className = 'elrc-layout-options';
    mode.setAttribute('role', 'group');
    mode.setAttribute('aria-label', '播放器布局');
    const original = document.createElement('button');
    original.type = 'button'; original.textContent = '多视图';
    const floating = document.createElement('button');
    floating.type = 'button'; floating.textContent = '悬浮小窗';
    for (const [button, icon] of [[original, 'frames'], [floating, 'pip']]) {
      const label = button.textContent;
      button.className = 'elrc-layout-choice';
      setPlayerIcon(button, icon);
      const check = document.createElement('span');
      check.className = 'elrc-layout-check';
      setPlayerIcon(check, 'check');
      button.append(document.createTextNode(label), check);
    }
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
    sizing.parentElement.classList.add('elrc-size-field');
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
      refreshFocusMode();
    });
    widthInput.addEventListener('change', () => {
      const width = Number(widthInput.value);
      if (Number.isFinite(width) && width >= 320 && width <= 7680) state.fixedWidth = width;
      refreshFocusMode();
    });
    const swap = document.createElement('button');
    swap.type = 'button'; swap.className = 'elrc-focus-swap';
    setPlayerIcon(swap, 'swap');
    swap.append(document.createTextNode('交换画面'));
    const status = document.createElement('p');
    status.className = 'elrc-focus-status'; status.setAttribute('role', 'status'); status.hidden = true;
    panel.append(mode, fields, swap, status);

    function fitMainPlayer() {
      if (document.fullscreenElement || webFullscreen) return;
      const host = group.closest('.player_box_container');
      const review = group.closest('.review_student');
      const mainVideo = group.querySelector('.elrc-focus-main video');
      if (!host || !review || !mainVideo) return;
      const area = review.getBoundingClientRect();
      const naturalTop = host.getBoundingClientRect().top + review.scrollTop;
      const viewportBottom = Math.min(window.visualViewport?.height ?? innerHeight, area.bottom);
      const bottomSpacing = parseFloat(getComputedStyle(review).paddingBottom) +
        parseFloat(getComputedStyle(host).marginBottom);
      const controlSpace = current.wide ? Math.min(116, (viewportBottom - area.top) * 0.23) : 0;
      const availableHeight = Math.max(1, viewportBottom - naturalTop - bottomSpacing - controlSpace);
      const ratio = mainVideo.videoWidth && mainVideo.videoHeight ? mainVideo.videoWidth / mainVideo.videoHeight : 16 / 9;
      const width = state.sizing === 'fixed' ? Math.min(host.clientWidth, state.fixedWidth || host.clientWidth) : host.clientWidth;
      const height = Math.floor(Math.min(width / ratio, availableHeight));
      const root = document.documentElement;
      root.style.setProperty('--elrc-focus-width', `${width}px`);
      root.style.setProperty('--elrc-focus-height', `${height}px`);
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
      drag = null;
      swapOnClick = false;
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
        if (!event.isPrimary || event.button !== 0) return;
        swapOnClick = false;
        if (event.target.closest('button') && !corner) return;
        swapOnClick = !corner && Boolean(event.target.closest('.video_container'));
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
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= 3) return;
        drag.moved = true;
        swapOnClick = false;
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
        if (event.target.closest('button')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const shouldSwap = swapOnClick;
        swapOnClick = false;
        if (shouldSwap) exchange();
      }, dragOptions);
      const endDrag = () => { drag = null; handle?.classList.remove('elrc-dragging'); };
      floatItem.addEventListener('pointerup', endDrag, dragOptions);
      floatItem.addEventListener('pointercancel', () => {
        swapOnClick = false;
        endDrag();
      }, dragOptions);
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
      const active = state.enabled && available;
      original.setAttribute('aria-pressed', String(!active));
      floating.setAttribute('aria-pressed', String(active));
      floating.disabled = !available;
      fields.hidden = !active; swap.hidden = !active;
      sizing.value = state.sizing;
      widthLabel.hidden = state.sizing !== 'fixed';
      if (document.activeElement !== widthInput) widthInput.value = String(state.fixedWidth || Math.round(group?.clientWidth || 960));
      status.hidden = available;
      const statusText = available ? '' : '加载两个机位后可开启小窗';
      if (status.textContent !== statusText) status.textContent = statusText;
      document.documentElement.classList.toggle('elrc-focus-mode', active);
      panel.dataset.mode = active ? '悬浮小窗' : '多视图';
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
      state.enabled = true; refreshFocusMode();
    });
    mainSelect.addEventListener('change', () => changeCamera('main', mainSelect.value));
    floatSelect.addEventListener('change', () => changeCamera('float', floatSelect.value));
    swap.addEventListener('click', exchange);
    document.addEventListener('loadedmetadata', refreshFocusMode, true);
    document.addEventListener('fullscreenchange', schedulePosition);
    window.addEventListener('resize', schedulePosition);
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
    setPlayerIcon(popover.button, 'download');
    popover.button.append(document.createTextNode('下载视频'));
    popover.button.title = '选择要下载的视频机位';
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
  let autoHideHeader;
  function installAutoHideHeader() {
    const header = current.autoHideHeader && document.querySelector('#head_container')?.closest('.tabs_view_9_vision_1');
    if (autoHideHeader?.header === header) return;
    autoHideHeader?.remove();
    autoHideHeader = undefined;
    if (!header) return;
    const controller = new AbortController();
    const events = {signal: controller.signal};
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
    trigger.addEventListener('pointerenter', show, events);
    trigger.addEventListener('focus', show, events);
    trigger.addEventListener('click', show, events);
    header.addEventListener('pointerenter', show, events);
    header.addEventListener('pointerleave', hideSoon, events);
    header.addEventListener('focusin', show, events);
    header.addEventListener('focusout', hideSoon, events);
    document.addEventListener('pointermove', event => {
      if (event.clientY <= 10) show();
      else if (event.clientY > header.getBoundingClientRect().bottom + 12 &&
        document.documentElement.classList.contains('elrc-header-visible')) hideSoon();
    }, events);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { clearTimeout(hideTimer); hide(); }
    }, events);
    autoHideHeader = {header, remove() {
      clearTimeout(hideTimer);
      controller.abort();
      trigger.remove();
      document.documentElement.classList.remove('elrc-autohide-header', 'elrc-header-visible');
    }};
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
  let directorySource;
  let directoryPage;
  const directoryObserver = new MutationObserver(() => {
    if (current.wide) buildDirectory();
  });

  function refreshEpisodeQueue() {
    const source = document.querySelector('.review_student .menu_drawer_body .left_menu_sufe > .el-menu');
    if (source === directorySource && location.href === directoryPage) return;
    directorySource = source;
    directoryPage = location.href;
    directoryObserver.disconnect();
    if (!source) return;
    directoryObserver.observe(source, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']
    });
    buildDirectory();
  }

  // Lucide 0.468.0. See LUCIDE-LICENSE.txt.
  const playerIcons = {
    play: "<polygon points=\"6 3 20 12 6 21 6 3\" />",
    pause: "<rect x=\"14\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" /><rect x=\"6\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" />",
    volume: "<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z\" /><path d=\"M16 9a5 5 0 0 1 0 6\" /><path d=\"M19.364 18.364a9 9 0 0 0 0-12.728\" />",
    mute: "<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z\" /><line x1=\"22\" x2=\"16\" y1=\"9\" y2=\"15\" /><line x1=\"16\" x2=\"22\" y1=\"9\" y2=\"15\" />",
    captions: "<rect width=\"18\" height=\"14\" x=\"3\" y=\"5\" rx=\"2\" ry=\"2\" /><path d=\"M7 15h4M15 15h2M7 11h2M13 11h4\" />",
    frames: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M3 9h18\" /><path d=\"M9 21V9\" />",
    timeline: "<path d=\"M12 12H3\" /><path d=\"M16 6H3\" /><path d=\"M12 18H3\" /><path d=\"m16 12 5 3-5 3v-6Z\" />",
    settings: "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
    theater: "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\" />",
    viewport: "<rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\" /><path d=\"M6 11V8h3m6 0h3v3M6 13v3h3m6 0h3v-3\" />",
    fullscreen: "<path d=\"M8 3H5a2 2 0 0 0-2 2v3\" /><path d=\"M21 8V5a2 2 0 0 0-2-2h-3\" /><path d=\"M3 16v3a2 2 0 0 0 2 2h3\" /><path d=\"M16 21h3a2 2 0 0 0 2-2v-3\" />",
    exit: "<path d=\"M8 3v3a2 2 0 0 1-2 2H3\" /><path d=\"M21 8h-3a2 2 0 0 1-2-2V3\" /><path d=\"M3 16h3a2 2 0 0 1 2 2v3\" /><path d=\"M16 21v-3a2 2 0 0 1 2-2h3\" />",
    previous: "<path d=\"m15 18-6-6 6-6\" />",
    next: "<path d=\"m9 18 6-6-6-6\" />",
    copy: "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
    speed: "<path d=\"m12 14 4-4\" /><path d=\"M3.34 19a10 10 0 1 1 17.32 0\" />",
    audio: "<path d=\"M2 10v3\" /><path d=\"M6 6v11\" /><path d=\"M10 3v18\" /><path d=\"M14 8v7\" /><path d=\"M18 5v13\" /><path d=\"M22 10v3\" />",
    mark: "<path d=\"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z\" />",
    adjust: "<line x1=\"21\" x2=\"14\" y1=\"4\" y2=\"4\" /><line x1=\"10\" x2=\"3\" y1=\"4\" y2=\"4\" /><line x1=\"21\" x2=\"12\" y1=\"12\" y2=\"12\" /><line x1=\"8\" x2=\"3\" y1=\"12\" y2=\"12\" /><line x1=\"21\" x2=\"16\" y1=\"20\" y2=\"20\" /><line x1=\"12\" x2=\"3\" y1=\"20\" y2=\"20\" /><line x1=\"14\" x2=\"14\" y1=\"2\" y2=\"6\" /><line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\" /><line x1=\"16\" x2=\"16\" y1=\"18\" y2=\"22\" />",
    pip: "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\" /><rect x=\"12\" y=\"11\" width=\"6\" height=\"5\" rx=\"1\" />",
    swap: "<path d=\"M3 7h17m-4-4 4 4-4 4M21 17H4m4 4-4-4 4-4\" />",
    send: "<path d=\"M12 19V5m-6 6 6-6 6 6\" />",
    close: "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
    check: "<path d=\"M20 6 9 17l-5-5\" />",
    reset: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /> <path d=\"M3 3v5h5\" />",
    download: "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <polyline points=\"7 10 12 15 17 10\" /> <line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />",
    sparkle: "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\" /> <path d=\"M20 3v4\" /> <path d=\"M22 5h-4\" /> <path d=\"M4 17v2\" /> <path d=\"M5 18H3\" />",
  };

  function setPlayerIcon(button, icon) {
    if (button.dataset.icon === icon) return;
    button.dataset.icon = icon;
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${playerIcons[icon]}</svg>`;
  }

  function mediaClock(seconds) {
    const time = Math.max(0, Math.floor(seconds || 0));
    const min = Math.floor(time / 60);
    const sec = String(time % 60).padStart(2, '0');
    return min < 60 ? `${min}:${sec}` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}:${sec}`;
  }

  function updateCurrentLesson(middle) {
    const title = middle.querySelector('.header_title .title_text');
    if (!title) return;
    const breadcrumb = title.querySelector('.breadcrumb_nav');
    const course = (breadcrumb?.querySelector('.course_node') || breadcrumb)?.textContent.trim().replace(/[>›»＞\s]+$/, '');
    if (course) {
      let heading = title.querySelector(':scope > .elrc-course-heading');
      if (!heading) {
        heading = document.createElement('h1');
        heading.className = 'elrc-course-heading';
        breadcrumb.before(heading);
      }
      if (heading.textContent !== course) heading.textContent = course;
    }
    let label = title.querySelector(':scope > .elrc-current-lesson');
    const selected = middle.querySelector('.elrc-lesson[aria-current="true"]');
    const name = selected?.querySelector('.elrc-lesson-name')?.textContent.trim();
    const params = new URL(location.href).searchParams;
    const day = params.get('weekDay');
    const section = params.get('realSection');
    const lesson = name || (day && section ? `${day} 第${section}节` : '');
    const date = selected?.querySelector('.elrc-episode-date')?.textContent.trim();
    title.classList.toggle('elrc-has-current-lesson', Boolean(lesson));
    if (!lesson) {
      label?.remove();
      return;
    }
    if (!label) {
      label = document.createElement('div');
      label.className = 'elrc-current-lesson';
      const info = title.querySelector('.course_info');
      if (info) info.after(label); else title.append(label);
    }
    const text = [date, lesson].filter(Boolean).join(' · ');
    if (label.textContent !== text) label.textContent = text;
  }

  function installPlayerControls(middle) {
    const player = middle.querySelector('.multi_view_player_container');
    const native = player?.querySelector(':scope > .tool_bar');
    if (!native || player.querySelector(':scope > .elrc-playback-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'elrc-playback-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '播放控件');
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'elrc-seek';
    seek.min = '0';
    seek.step = '0.1';
    seek.value = '0';
    seek.setAttribute('aria-label', '播放进度');
    const seekTrack = document.createElement('div');
    seekTrack.className = 'elrc-seek-track';
    const markerLayer = document.createElement('div');
    markerLayer.className = 'elrc-seek-markers';
    markerLayer.setAttribute('aria-hidden', 'true');
    seekTrack.append(seek, markerLayer);

    const row = document.createElement('div');
    row.className = 'elrc-playback-row';
    const leading = document.createElement('div');
    leading.className = 'elrc-playback-group';
    const trailing = document.createElement('div');
    trailing.className = 'elrc-playback-group';
    const clock = document.createElement('span');
    clock.className = 'elrc-playback-time';

    const menu = document.createElement('section');
    menu.className = 'elrc-playback-menu';
    menu.setAttribute('aria-label', '播放设置');
    menu.hidden = true;
    const feedback = document.createElement('div');
    feedback.className = 'elrc-player-feedback';
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    controls.append(seekTrack, row, menu);
    row.append(leading, clock, trailing);

    const controller = new AbortController();
    const events = {signal: controller.signal};
    let view = '';
    let origin;
    let mountedPicture;
    let nativePopup;
    let refreshChoices;
    let lastAudio;
    let feedbackTimer;
    let feedbackAnimation;
    let scrubbing = false;
    let idleTimer;
    let pendingChoice;
    let pendingChoiceTimer = 0;
    let markerSignature = '';
    const adjustmentValues = [
      {name: '亮度', filter: 'brightness', min: 50, max: 150, value: 100},
      {name: '对比度', filter: 'contrast', min: 50, max: 150, value: 100},
      {name: '饱和度', filter: 'saturate', min: 0, max: 200, value: 100},
    ];
    const speedRates = [0.5, 1, 1.25, 1.5, 2, 2.5];
    const settingPages = [
      {id: 'layout', name: '画面模式', icon: 'frames'},
      {id: 'camera', name: '机位选择', icon: 'frames', selector: '.frame'},
      {id: 'audio', name: '音源', icon: 'audio', selector: '.sound_source'},
      {id: 'mark', name: '标记', icon: 'mark', selector: '.point_mark'},
      {id: 'adjust', name: '画面调节', icon: 'adjust'},
    ];
    const liveFeeds = () => [...player.querySelectorAll(recordingSelector)];
    const getNative = selector => player.querySelector(`:scope > .tool_bar > ${selector}`);
    const nativeProgress = () => player.querySelector(':scope > .tool_bar .progress');

    function labelButton(button, label) {
      if (button.getAttribute('aria-label') === label) return;
      button.dataset.tooltip = label;
      button.setAttribute('aria-label', label);
    }

    function makeButton(parent, icon, label, activate) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'elrc-player-button';
      labelButton(button, label);
      if (icon) setPlayerIcon(button, icon);
      button.addEventListener('click', event => {
        event.stopPropagation();
        activate(button, event);
      });
      parent.append(button);
      return button;
    }

    function notify(message, icon) {
      clearTimeout(feedbackTimer);
      feedbackAnimation?.cancel();
      const content = document.createElement('span');
      content.className = 'elrc-feedback-content';
      if (icon) {
        const symbol = document.createElement('span');
        setPlayerIcon(symbol, icon);
        content.append(symbol);
      }
      if (message) content.append(document.createTextNode(message));
      feedback.replaceChildren(content);
      feedback.classList.toggle('elrc-feedback-playback', !message);
      feedback.hidden = false;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration = message ? 1450 : reducedMotion ? 220 : 390;
      if (!reducedMotion) {
        const frames = message ? [
          {opacity: 0, scale: '.96', offset: 0},
          {opacity: 1, scale: '1', offset: .12},
          {opacity: 1, scale: '1', offset: .87},
          {opacity: 0, scale: '.98', offset: 1},
        ] : [
          {opacity: 0, scale: '.82', offset: 0, easing: 'cubic-bezier(.17,.84,.38,1)'},
          {opacity: 1, scale: '1', offset: .24},
          {opacity: 1, scale: '1.02', offset: .42},
          {opacity: 0, scale: '1.17', offset: 1, easing: 'ease-out'},
        ];
        feedbackAnimation = content.animate?.(frames, {duration, fill: 'forwards'});
      }
      feedbackTimer = setTimeout(() => { feedback.hidden = true; feedbackAnimation?.cancel(); }, duration);
    }

    function stopPendingChoice() {
      clearTimeout(pendingChoiceTimer);
      pendingChoice = null;
    }

    function clearMenuContent() {
      if (mountedPicture) {
        const {section, home} = mountedPicture;
        section.hidden = true;
        home?.append(section);
        mountedPicture = null;
      }
      if (nativePopup) {
        const {panel, home, next} = nativePopup;
        home.insertBefore(panel, next?.parentNode === home ? next : null);
        nativePopup = null;
      }
      refreshChoices = null;
    }

    function closeMenu(restoreFocus = false) {
      clearMenuContent();
      view = '';
      menu.hidden = true;
      for (const button of row.querySelectorAll('[aria-expanded="true"]')) button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) origin?.focus({preventScroll: true});
      origin = null;
    }

    function makeMenuPage(id, title, back) {
      const motion = !view ? 'enter' : id === 'settings' ? 'back' : 'forward';
      clearMenuContent();
      const header = document.createElement('div');
      header.className = 'elrc-menu-header';
      if (back) {
        const button = makeButton(header, 'previous', '返回', back);
        button.classList.add('elrc-menu-back');
      }
      const heading = document.createElement('strong');
      heading.textContent = title;
      header.append(heading);
      const body = document.createElement('div');
      body.className = 'elrc-menu-body';
      body.dataset.motion = motion;
      menu.replaceChildren(header, body);
      menu.dataset.view = id;
      menu.hidden = false;
      if (id === 'speed' && origin) {
        const area = controls.getBoundingClientRect();
        const trigger = origin.getBoundingClientRect();
        const offset = area.right - (trigger.left + trigger.width / 2 + menu.offsetWidth / 2);
        menu.style.right = `${Math.max(12, Math.min(offset, area.width - menu.offsetWidth - 12))}px`;
      } else menu.style.removeProperty('right');
      view = id;
      const top = Math.max(0, player.getBoundingClientRect().top);
      const available = controls.getBoundingClientRect().top - top - 8;
      menu.style.setProperty('--elrc-menu-room', `${Math.max(96, available)}px`);
      return body;
    }

    function beginMenu(button, viewId, show) {
      if (origin === button && view === viewId) {
        closeMenu();
        return;
      }
      closeMenu();
      origin = button;
      button.setAttribute('aria-expanded', 'true');
      show();
    }

    function showUnavailable(body, message = '暂无可用选项') {
      const empty = document.createElement('p');
      empty.className = 'elrc-menu-empty';
      empty.textContent = message;
      body.append(empty);
    }

    function makeChoice(body, label, activate) {
      const button = makeButton(body, null, label, activate);
      button.classList.add('elrc-menu-choice');
      const text = document.createElement('span');
      text.textContent = label;
      const check = document.createElement('span');
      check.className = 'elrc-menu-check';
      setPlayerIcon(check, 'check');
      button.append(text, check);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      return button;
    }

    function activeClass(node) {
      return node?.matches('.active,.selected,.checked,.is-active,.is-selected,.is-checked,.current,[aria-checked="true"],[aria-selected="true"],[data-selected="true"]');
    }

    function nativeChoices(selector) {
      const popup = getNative(selector)?.querySelector('.modal');
      if (!popup) return [];
      const entries = [...popup.querySelectorAll('p, label, [role="option"], [role="radio"], [role="menuitemradio"]')];
      return entries.filter(node => !node.closest('.elrc-focus-native-menu') && !entries.some(parent => parent !== node && parent.contains(node)))
        .flatMap(node => {
          const input = node.querySelector('input[type=checkbox], input[type=radio]');
          const label = node.textContent.replace(/\s+/g, ' ').trim();
          if (!label) return [];
          const checked = Boolean(input?.checked || activeClass(node) || activeClass(node.parentElement) && node.parentElement !== popup ||
            node.querySelector('.is-checked,[aria-checked="true"],.el-icon-check'));
          return [{label, checked, action: () => (input || node).click()}];
        });
    }

    function normalizedAudio(label) {
      return label.replace(/[\s·]/g, '').replace(/(?:画面|音源|音频)/g, '');
    }

    function currentAudio(choices = nativeChoices('.sound_source')) {
      const active = choices.find(choice => choice.checked);
      if (active) return active.label;
      const trigger = getNative('.sound_source');
      const selected = trigger?.querySelector(':scope > [title], :scope > .selected');
      const sourceLabel = selected?.getAttribute('title') || selected?.textContent.trim();
      if (sourceLabel) {
        const byTitle = choices.find(choice => normalizedAudio(choice.label) === normalizedAudio(sourceLabel));
        if (byTitle) return byTitle.label;
      }
      const audible = liveFeeds().filter(video => !video.muted);
      if (audible.length === 1) {
        const camera = videoCameras().find(item => item.video === audible[0]);
        if (camera) {
          const byFeed = choices.find(choice => normalizedAudio(choice.label) === normalizedAudio(camera.name));
          if (byFeed) return byFeed.label;
        }
      }
      if (lastAudio && choices.some(choice => choice.label === lastAudio)) return lastAudio;
      return '';
    }

    function settingsValue(id) {
      if (id === 'audio') return currentAudio() || '未识别';
      if (id === 'layout') return getPictureSettings(middle)?.dataset.mode || '';
      if (id === 'camera') {
        const names = getPictureSettings(middle)?.dataset.mode === '悬浮小窗'
          ? videoCameras().filter(camera => player.contains(camera.item) &&
            camera.item.matches('.elrc-focus-main,.elrc-focus-float')).map(camera => camera.name)
          : nativeChoices('.frame').filter(choice => choice.checked).map(choice => choice.label);
        return names.length > 1 ? String(names.length) : names[0] || '';
      }
      if (id === 'mark') return nativeChoices('.point_mark').filter(choice => choice.checked).map(choice => choice.label).join('、');
      if (id === 'adjust' && adjustmentValues.some(item => item.value !== 100)) return '已调整';
      return '';
    }

    function showSettings(focusItem) {
      const body = makeMenuPage('settings', '播放设置');
      const entries = [];
      for (const item of settingPages) {
        const entry = makeButton(body, item.icon, item.name, () => showSetting(item));
        entry.classList.add('elrc-menu-row');
        entry.dataset.setting = item.id;
        const text = document.createElement('span');
        text.textContent = item.name;
        const value = document.createElement('small');
        value.className = 'elrc-menu-value';
        const arrow = document.createElement('span');
        setPlayerIcon(arrow, 'next');
        entry.append(text, value, arrow);
        entries.push({id: item.id, entry, value});
      }
      refreshChoices = () => {
        for (const {id, value} of entries) {
          const text = settingsValue(id);
          if (value.textContent !== text) value.textContent = text;
        }
      };
      refreshChoices();
      (entries.find(entry => entry.id === focusItem) || entries[0])?.entry.focus({preventScroll: true});
    }

    function showSetting(item) {
      const back = () => showSettings(item.id);
      const body = makeMenuPage(item.id, item.name, back);
      if (item.id === 'layout' || item.id === 'camera' && getPictureSettings(middle)?.dataset.mode === '悬浮小窗') {
        const section = getPictureSettings(middle);
        if (!section) showUnavailable(body, '画面模式正在加载');
        else {
          mountedPicture = {section, home: middle};
          body.append(section);
          section.hidden = false;
        }
      } else if (item.id === 'adjust') {
        renderAdjustments(body);
      } else {
        renderNativePage(body, item.selector, item.id);
      }
      menu.querySelector('.elrc-menu-back')?.focus({preventScroll: true});
    }

    function renderNativePage(body, selector, id) {
      const entries = nativeChoices(selector);
      if (!entries.length) {
        const host = getNative(selector);
        const panel = host?.querySelector(':scope > .modal');
        if (panel) {
          nativePopup = {panel, home: panel.parentNode, next: panel.nextSibling};
          const bridge = document.createElement('div');
          bridge.className = 'elrc-menu-site-content';
          body.append(bridge);
          bridge.append(panel);
        } else {
          if (id === 'mark') host?.click();
          showUnavailable(body);
        }
        return;
      }
      const multiple = ['camera', 'captions', 'mark'].includes(id);
      body.setAttribute('role', multiple ? 'group' : 'radiogroup');
      body.setAttribute('aria-label', id === 'audio' ? '音源' : id === 'captions' ? '字幕' : '选项');
      const buttons = [];
      for (const entry of entries) {
        const choice = makeChoice(body, entry.label, () => {
          const current = nativeChoices(selector).find(item => item.label === entry.label);
          if (!current) return;
          const before = id === 'audio' ? currentAudio() : '';
          if (id === 'audio') {
            stopPendingChoice();
            pendingChoice = {label: entry.label, before};
          }
          current.action();
          synchronizeMenu();
          requestAnimationFrame(synchronizeMenu);
          if (id === 'audio' && pendingChoice) {
            pendingChoiceTimer = setTimeout(() => {
              synchronizeMenu();
              if (pendingChoice) {
                stopPendingChoice();
                notify('音源切换未确认');
              }
            }, 650);
          }
        });
        if (multiple) choice.setAttribute('role', 'checkbox');
        buttons.push({label: entry.label, choice});
      }
      refreshChoices = () => {
        const fresh = nativeChoices(selector);
        const active = id === 'audio' ? currentAudio(fresh) : null;
        for (const {label, choice} of buttons) {
          const checked = active !== null ? label === active : fresh.some(item => item.label === label && item.checked);
          if (choice.getAttribute('aria-checked') !== String(checked)) choice.setAttribute('aria-checked', String(checked));
        }
      };
      refreshChoices();
    }

    function showCaptions() {
      const body = makeMenuPage('captions', '字幕');
      renderNativePage(body, '.text_track', 'captions');
      const selected = body.querySelector('[aria-checked="true"]') || body.querySelector('.elrc-menu-choice');
      (selected || menu.querySelector('.elrc-menu-back'))?.focus({preventScroll: true});
    }

    function selectedRate() {
      const video = liveFeeds().find(item => !item.muted) || liveFeeds()[0];
      return video?.playbackRate || 1;
    }

    function chooseRate(rate) {
      const choice = nativeChoices('.speed').find(item => Number(item.label.match(/\d+(?:\.\d+)?/)?.[0]) === rate ||
        rate === 1 && /正常|标准|normal/i.test(item.label));
      if (choice) choice.action();
      else for (const video of liveFeeds()) video.playbackRate = rate;
      synchronizeMenu();
      requestAnimationFrame(synchronizeMenu);
      if (selectedRate() === rate) notify(`播放速度 ${rate}×`);
    }

    function showSpeed() {
      const body = makeMenuPage('speed', '播放速度');
      body.setAttribute('role', 'radiogroup');
      body.setAttribute('aria-label', '播放速度');
      const buttons = speedRates.map(rate => ({
        rate, option: makeChoice(body, rate === 1 ? '1× 正常' : `${rate}×`, () => chooseRate(rate)),
      }));
      refreshChoices = () => {
        for (const {rate, option} of buttons) {
          const checked = String(selectedRate() === rate);
          if (option.getAttribute('aria-checked') !== checked) option.setAttribute('aria-checked', checked);
        }
      };
      refreshChoices();
      (body.querySelector('[aria-checked="true"]') || body.querySelector('.elrc-menu-choice'))?.focus({preventScroll: true});
    }

    function applyImageAdjustments() {
      const changed = adjustmentValues.some(item => item.value !== 100);
      player.classList.toggle('elrc-picture-adjusted', changed);
      if (changed) {
        const filter = adjustmentValues.map(item => `${item.filter}(${item.value}%)`).join(' ');
        player.style.setProperty('--elrc-picture-filter', filter);
      } else {
        player.style.removeProperty('--elrc-picture-filter');
      }
    }

    function renderAdjustments(body) {
      const sliders = [];
      for (const item of adjustmentValues) {
        const label = document.createElement('label');
        label.className = 'elrc-adjust-row';
        const name = document.createElement('span');
        name.textContent = item.name;
        const slider = document.createElement('input');
        slider.className = 'elrc-adjust-slider';
        slider.type = 'range';
        slider.min = String(item.min);
        slider.max = String(item.max);
        slider.step = '1';
        slider.value = String(item.value);
        slider.setAttribute('aria-label', item.name);
        const value = document.createElement('output');
        value.textContent = `${item.value}%`;
        label.append(name, slider, value);
        slider.addEventListener('input', () => {
          item.value = Number(slider.value);
          value.textContent = `${item.value}%`;
          applyImageAdjustments();
        });
        body.append(label);
        sliders.push({item, slider, value});
      }
      const reset = makeButton(body, 'reset', '恢复默认', () => {
        for (const {item, slider, value} of sliders) {
          item.value = 100;
          slider.value = '100';
          value.textContent = '100%';
        }
        applyImageAdjustments();
      });
      reset.classList.add('elrc-adjust-reset');
      reset.append(document.createTextNode('恢复默认'));
    }

    function synchronizeMarkers() {
      const positions = new Set();
      if (nativeChoices('.point_mark').some(choice => choice.checked)) {
        for (const item of nativeProgress()?.querySelectorAll('.point_mark_item') || []) {
          const left = item.style.left;
          const position = Number.parseFloat(left);
          if (left.endsWith('%') && position >= 0 && position <= 100) positions.add(position);
        }
      }
      const signature = [...positions].join(',');
      if (signature === markerSignature) return;
      markerSignature = signature;
      markerLayer.replaceChildren(...[...positions].map(position => {
        const marker = document.createElement('span');
        marker.style.left = `${position}%`;
        return marker;
      }));
    }

    function synchronizeMenu() {
      refreshChoices?.();
      synchronizeMarkers();
      const rate = `${selectedRate()}×`;
      if (speed.textContent !== rate) speed.textContent = rate;
      const captionActive = nativeChoices('.text_track').some(choice => choice.checked && !/关闭|off/i.test(choice.label));
      if (captions.getAttribute('aria-pressed') !== String(captionActive)) captions.setAttribute('aria-pressed', String(captionActive));
      const audio = currentAudio();
      if (audio) lastAudio = audio;
      if (pendingChoice && audio === pendingChoice.label) {
        const changed = pendingChoice.before !== audio;
        stopPendingChoice();
        if (changed) notify(`已切换至${audio}`, 'check');
      }
    }

    const play = makeButton(leading, 'play', '播放', (_, event) => togglePlayback(event));
    play.classList.add('elrc-play-toggle');
    playbackToggles.set(player, togglePlayback);
    function togglePlayback(event) {
      const feeds = liveFeeds();
      const playing = feeds.some(video => !video.paused && !video.ended);
      if (event.isTrusted) allowPlayerPlayback(player);
      const nativePlay = getNative('span:has(+ .multi_view_player_time)') ||
        getNative('.play_btn') || getNative('.play_button') || getNative('.play');
      if (nativePlay) nativePlay.click();
      else if (playing) feeds.forEach(video => video.pause());
      else if (event.isTrusted) feeds.forEach(video => video.play().catch(() => {}));
      notify('', playing ? 'pause' : 'play');
    }

    const audioSelector = '.drag_bar:last-of-type';
    const volumeControl = document.createElement('div');
    volumeControl.className = 'elrc-volume-control';
    leading.append(volumeControl);
    const mute = makeButton(volumeControl, 'volume', '静音', () => getNative(`${audioSelector} > span`)?.click());
    const volume = document.createElement('input');
    let preferredVolume = 0.6;
    let volumeAdjusted = false;
    function applyVolume() {
      for (const video of liveFeeds()) {
        if (Math.abs(video.volume - preferredVolume) > 0.001) video.volume = preferredVolume;
      }
    }
    volume.type = 'range';
    volume.className = 'elrc-volume';
    volume.min = '0'; volume.max = '1'; volume.step = '0.01';
    volume.setAttribute('aria-label', '音量');
    volume.addEventListener('input', () => {
      volumeAdjusted = true;
      preferredVolume = Number(volume.value);
      applyVolume();
    });
    volume.addEventListener('change', () => chrome.storage.local.set({playbackVolume: preferredVolume}));
    chrome.storage.local.get('playbackVolume', data => {
      if (!player.isConnected || volumeAdjusted) return;
      const saved = data.playbackVolume;
      if (typeof saved === 'number' && Number.isFinite(saved)) preferredVolume = Math.min(1, Math.max(0, saved));
      applyVolume();
      volume.value = String(preferredVolume);
    });
    player.addEventListener('loadedmetadata', applyVolume, true);
    volumeControl.append(volume);
    volumeControl.addEventListener('pointerenter', () => volumeControl.classList.add('elrc-volume-open'));
    volumeControl.addEventListener('pointerleave', () => volumeControl.classList.remove('elrc-volume-open'));

    const captions = makeButton(trailing, 'captions', '字幕', button => beginMenu(button, 'captions', showCaptions));
    const speed = makeButton(trailing, null, '播放速度', button => beginMenu(button, 'speed', showSpeed));
    speed.classList.add('elrc-speed-button');
    makeButton(trailing, 'settings', '播放设置', button => {
      if (origin === button) closeMenu();
      else beginMenu(button, 'settings', showSettings);
    }).setAttribute('aria-expanded', 'false');
    const theater = makeButton(trailing, 'theater', '切换宽屏布局', () => {
      document.documentElement.classList.toggle('elrc-standard-view');
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => {
        const episodes = middle.querySelector('.elrc-episodes');
        if (episodes) locateCurrentEpisode(episodes);
      });
      update();
    });
    const web = makeButton(trailing, 'viewport', '网页全屏', () => {
      if (webFullscreen?.player === player) {
        webFullscreen.close(true);
        return;
      }
      if (document.fullscreenElement) {
        const exit = document.exitFullscreen();
        exit.then(() => { if (player.isConnected && current.wide) openWebFullscreen(); }).catch(() => {});
      } else {
        openWebFullscreen();
      }
    });

    function openWebFullscreen() {
      webFullscreen?.close();
      closeMenu();
      const root = document.documentElement;
      const inertNodes = [];
      const host = player.closest('.player_box_container');
      if (host) {
        host.style.setProperty('--elrc-web-host-height', `${host.getBoundingClientRect().height}px`);
        host.classList.add('elrc-web-fullscreen-host');
      }
      // Keep focus in the player while the web viewport is occupied.
      for (let branch = player; branch && branch !== document.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement?.children || []) {
          if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.inert) continue;
          sibling.inert = true;
          inertNodes.push(sibling);
        }
      }
      webFullscreen = {player, close(returnFocus = false) {
        webFullscreen = null;
        player.classList.remove('elrc-web-fullscreen-player');
        root.classList.remove('elrc-web-fullscreen');
        host?.classList.remove('elrc-web-fullscreen-host');
        host?.style.removeProperty('--elrc-web-host-height');
        for (const node of inertNodes) node.inert = false;
        if (player.isConnected) {
          window.dispatchEvent(new Event('resize'));
          update();
          if (returnFocus) web.focus({preventScroll: true});
        }
      }};
      player.classList.add('elrc-web-fullscreen-player');
      root.classList.add('elrc-web-fullscreen');
      window.dispatchEvent(new Event('resize'));
      update();
      showControls();
      web.focus({preventScroll: true});
    }

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || webFullscreen?.player !== player) return;
      event.preventDefault();
      webFullscreen.close(true);
    }, events);
    const fullscreen = makeButton(trailing, 'fullscreen', '全屏', () => {
      if (webFullscreen?.player === player) webFullscreen.close();
      const control = getNative('.full_screen_btn');
      if (control) control.click();
      else if (document.fullscreenElement) document.exitFullscreen();
      else player.requestFullscreen();
    });
    captions.setAttribute('aria-expanded', 'false');
    speed.setAttribute('aria-expanded', 'false');

    function hideControls() {
      if (scrubbing || view || controls.querySelector(':focus-visible') || controls.matches(':hover')) return;
      controls.classList.add('elrc-controls-idle');
    }

    function showControls() {
      controls.classList.remove('elrc-controls-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(hideControls, 2200);
    }

    player.addEventListener('pointerenter', showControls);
    player.addEventListener('pointermove', showControls);
    player.addEventListener('pointerleave', () => {
      clearTimeout(idleTimer);
      hideControls();
    });
    controls.addEventListener('focusin', showControls);
    controls.addEventListener('focusout', () => requestAnimationFrame(hideControls));
    player.addEventListener('play', showControls, true);
    player.addEventListener('pause', showControls, true);

    player.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element) || event.button !== 0 || event.defaultPrevented || !current.wide) return;
      if (target.closest('.elrc-playback-controls,.tool_bar,.elrc-focus-float,.item_tool_bar,.elrc-float-handle,.elrc-float-resize')) return;
      const namedPlayback = target.closest('.center_play_btn,.play_btn,.play_button,[aria-label="播放"],[aria-label="暂停"],[title="播放"],[title="暂停"]');
      if (!namedPlayback && target.closest('a,button,input,label,select,textarea,[contenteditable],[role="button"]')) return;
      const bounds = player.getBoundingClientRect();
      const centralOverlay = event.clientX >= bounds.left + bounds.width * .38 &&
        event.clientX <= bounds.right - bounds.width * .38 && event.clientY >= bounds.top + bounds.height * .38 &&
        event.clientY <= bounds.bottom - bounds.height * .38;
      if (target !== player && !target.closest('.player_group') && !centralOverlay && !namedPlayback) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePlayback(event);
    }, true);
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    seek.addEventListener('pointercancel', () => { scrubbing = false; update(); });
    seek.addEventListener('input', () => displayTime(Number(seek.value), Number(seek.max)));
    seek.addEventListener('change', () => {
      scrubbing = false;
      seekRecording(player, Number(seek.value));
      update();
    });
    seek.addEventListener('pointerup', () => { scrubbing = false; });
    controls.addEventListener('pointerdown', event => event.stopPropagation());
    document.addEventListener('pointerdown', event => {
      if (!view || controls.contains(event.target)) return;
      closeMenu();
      hideControls();
    }, events);
    player.addEventListener('keydown', event => {
      if (!view) return;
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && menu.contains(event.target) &&
          !event.target.closest('input,select,textarea')) {
        const choices = [...menu.querySelectorAll('.elrc-menu-choice, .elrc-menu-row')];
        if (!choices.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = choices.indexOf(event.target.closest('button'));
        const next = event.key === 'ArrowDown' ? current + 1 : current < 0 ? choices.length - 1 : current - 1;
        choices[(choices.length + next) % choices.length].focus();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (settingPages.some(item => item.id === view)) showSettings(view);
      else closeMenu(true);
      hideControls();
    });

    function displayTime(time, duration) {
      const text = `${mediaClock(time)} / ${mediaClock(duration)}`;
      if (clock.textContent !== text) clock.textContent = text;
      seek.style.setProperty('--elrc-played', `${duration ? time / duration * 100 : 0}%`);
      seek.setAttribute('aria-valuetext', text);
    }

    function update() {
      const feeds = liveFeeds();
      const source = feeds.find(video => video.readyState && !video.muted) || feeds.find(video => video.readyState);
      const playing = feeds.some(video => !video.paused && !video.ended);
      const duration = Number.isFinite(source?.duration) ? source.duration : 0;
      const time = Math.min(duration, source?.currentTime || 0);
      const muted = !source || feeds.every(video => video.muted || video.volume === 0);
      setPlayerIcon(play, playing ? 'pause' : 'play');
      labelButton(play, playing ? '暂停' : '播放');
      setPlayerIcon(mute, muted ? 'mute' : 'volume');
      labelButton(mute, muted ? '取消静音' : '静音');
      if (document.activeElement !== volume) volume.value = String(source?.volume ?? 1);
      const theaterOn = !document.documentElement.classList.contains('elrc-standard-view');
      theater.setAttribute('aria-pressed', String(theaterOn));
      labelButton(theater, theaterOn ? '退出宽屏布局' : '宽屏布局');
      const webOn = webFullscreen?.player === player;
      web.setAttribute('aria-pressed', String(webOn));
      labelButton(web, webOn ? '退出网页全屏' : '网页全屏');
      const expanded = Boolean(document.fullscreenElement?.contains(player) || document.fullscreenElement === player);
      setPlayerIcon(fullscreen, expanded ? 'exit' : 'fullscreen');
      labelButton(fullscreen, expanded ? '退出全屏' : '全屏');
      if (!scrubbing) {
        seek.disabled = duration <= 0;
        seek.max = String(duration);
        seek.value = String(time);
        displayTime(time, duration);
      }
    }

    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'play', 'pause', 'volumechange', 'ended', 'seeked', 'ratechange']) {
      player.addEventListener(event, update, true);
    }
    for (const event of ['ratechange', 'volumechange', 'loadedmetadata']) player.addEventListener(event, synchronizeMenu, true);
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement && webFullscreen?.player === player) webFullscreen.close();
      else update();
    }, events);
    const observer = new MutationObserver(records => {
      if (!player.isConnected) {
        if (webFullscreen?.player === player) webFullscreen.close();
        closeMenu();
        stopPendingChoice();
        clearTimeout(idleTimer);
        clearTimeout(feedbackTimer);
        controller.abort();
        observer.disconnect();
        return;
      }
      if (records.some(record => getNative('.sound_source')?.contains(record.target) ||
        getNative('.text_track')?.contains(record.target) || getNative('.frame')?.contains(record.target) ||
        getNative('.point_mark')?.contains(record.target))) {
        synchronizeMenu();
        update();
      } else if (records.some(record => record.type === 'childList'
        ? record.target === native || nativeProgress()?.contains(record.target)
        : record.target.matches('.point_mark_item'))) {
        synchronizeMarkers();
      }
    });
    // Observe the native controls for site-selected state and the player host for remounts.
    observer.observe(middle, {childList: true, subtree: true});
    observer.observe(native, {subtree: true, attributes: true, attributeFilter: ['class', 'checked', 'aria-checked', 'aria-selected', 'style']});
    player.classList.add('elrc-has-custom-controls');
    player.append(controls, feedback);
    update();
    synchronizeMenu();
    showControls();
  }

  function installButton() {
    if (webFullscreen && !webFullscreen.player.isConnected) webFullscreen.close();
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
    if (current.wide) refreshEpisodeQueue();
    const middle = document.querySelector('.review_student .middle_content');
    if (!middle) return;
    const header = middle.querySelector('.header_box');
    let toolbar = middle.querySelector('.elrc-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'elrc-toolbar';
      const companion = document.createElement('button');
      companion.type = 'button';
      companion.className = 'elrc-copy elrc-companion';
      companion.title = '针对这节课询问 AI';
      setPlayerIcon(companion, 'sparkle');
      companion.append(document.createTextNode('询问 AI'));
      companion.addEventListener('click', toggleCompanion);
      toolbar.append(companion);
      (header || middle).append(toolbar);
      createFocusMode(middle);
      createVideoDownloads(toolbar);
    } else if (header && toolbar.parentNode !== header) {
      header.append(toolbar);
    }
    if (current.wide) {
      installPlayerControls(middle);
      updateCurrentLesson(middle);
      watchStudySources(middle);
    }
  }
  chrome.storage.local.get(defaults, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(defaults).some(key => key in changes)) chrome.storage.local.get(defaults, apply);
    const episodes = document.querySelector('.elrc-episodes');
    if (episodes) progressByQueue.get(episodes)?.(changes);
  });
  setInterval(() => { if (current.wide) buildDirectory(); }, 60000);
  const start = () => { setupResume(); installButton(); new MutationObserver(installButton).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
