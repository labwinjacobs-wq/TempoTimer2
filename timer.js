/*
 * Tempo timer: Pomodoro (focus / short break / long break) and stopwatch.
 *
 * Time is always computed from the clock (an end timestamp), never by counting
 * ticks, so it stays accurate in background tabs and survives a page reload.
 * Pure helpers live in timer-core.js.
 */
(function () {
  'use strict';

  const C = window.TempoCore;
  const q = s => document.querySelector(s);
  const qa = s => document.querySelectorAll(s);

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
    }
  };

  const KEY = {
    settings: 'tempo-settings',
    timer: 'tempo-timer',
    stopwatch: 'tempo-stopwatch',
    history: 'tempo-history',
    view: 'tempo-view',
    task: 'tempo-task'
  };

  const LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break', stopwatch: 'Stopwatch' };
  const IDLE_TITLE = 'Tempo – a small day planner';

  /* ---------- state ---------- */

  let settings = C.sanitize(store.get(KEY.settings, {}));

  const modeMs = m => settings[m] * 60000;

  function loadTimer() {
    const today = C.dayKey(Date.now());
    const base = { mode: 'focus', running: false, endAt: 0, left: modeMs('focus'), total: modeMs('focus'), done: 0, day: today };
    const s = store.get(KEY.timer, null);
    if (!s || !['focus', 'short', 'long'].includes(s.mode)) return base;
    const out = {
      mode: s.mode,
      running: !!s.running,
      endAt: Number(s.endAt) || 0,
      left: Number(s.left) > 0 ? Number(s.left) : modeMs(s.mode),
      total: Number(s.total) > 0 ? Number(s.total) : modeMs(s.mode),
      done: Math.max(0, Number(s.done) || 0),
      day: s.day || today
    };
    if (out.day !== today) { out.done = 0; out.day = today; }
    return out;
  }

  function loadStopwatch() {
    const s = store.get(KEY.stopwatch, null);
    if (!s) return { running: false, startAt: 0, base: 0, laps: [] };
    return {
      running: !!s.running,
      startAt: Number(s.startAt) || 0,
      base: Math.max(0, Number(s.base) || 0),
      laps: Array.isArray(s.laps) ? s.laps.filter(Number.isFinite) : []
    };
  }

  let st = loadTimer();
  const sw = loadStopwatch();

  let view = store.get(KEY.view, st.mode);
  if (!['focus', 'short', 'long', 'stopwatch'].includes(view)) view = st.mode;
  if (view !== 'stopwatch') view = st.mode;

  let ticker = null;
  let titleOverride = '';
  let history = [];
  let selectedTaskId = String(store.get(KEY.task, '') || '');
  let statusText = 'Ready when you are.';

  const persistTimer = () => store.set(KEY.timer, st);
  const persistSw = () => store.set(KEY.stopwatch, sw);
  const persistView = () => store.set(KEY.view, view);

  const swElapsed = now => sw.base + (sw.running ? now - sw.startAt : 0);

  /* ---------- tasks (fed by script.js) ---------- */

  function allTasks() { return Array.isArray(window.TempoTasks) ? window.TempoTasks : []; }
  function taskLabel(t) { return t.title || t.name || ''; }
  function taskDone(t) { return !!(t.completed ?? t.done); }

  function currentTask() {
    if (!selectedTaskId) return null;
    const t = allTasks().find(x => String(x.id) === String(selectedTaskId));
    return t ? { id: t.id, label: taskLabel(t), guest: !('title' in t) } : null;
  }

  function taskTitleById(id) {
    if (!id) return '';
    const t = allTasks().find(x => String(x.id) === String(id));
    return t ? taskLabel(t) : '';
  }

  let taskListReady = false;

  function fillTaskPicker() {
    if (Array.isArray(window.TempoTasks)) taskListReady = true;
    const sel = q('#taskPick');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Nothing in particular';
    sel.appendChild(none);
    allTasks().filter(t => !taskDone(t)).forEach(t => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = taskLabel(t);
      sel.appendChild(o);
    });
    const stillThere = [...sel.options].some(o => o.value === String(selectedTaskId));
    // Don't forget the choice while tasks are still loading from the account.
    if (!stillThere && selectedTaskId && taskListReady) { selectedTaskId = ''; store.set(KEY.task, ''); }
    else if (!stillThere) { /* keep id, nothing to show yet */ }
    sel.value = selectedTaskId;
  }

  document.addEventListener('tempo:tasks', fillTaskPicker);
  q('#taskPick').addEventListener('change', e => { selectedTaskId = e.target.value; store.set(KEY.task, selectedTaskId); });

  /* ---------- sound and notifications ---------- */

  let audioCtx = null;

  // Browsers only allow audio after a user gesture, so this is called from clicks.
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (A) audioCtx = new A();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* no audio available */ }
  }

  function beep(freq, startOffset, length) {
    const t0 = audioCtx.currentTime + startOffset;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, settings.volume * 0.5), t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }

  function chime() {
    if (!settings.sound || !audioCtx || settings.volume <= 0) return;
    try {
      beep(880, 0, 0.35);
      beep(880, 0.4, 0.35);
      beep(1175, 0.8, 0.6);
    } catch (e) { /* ignore */ }
  }

  function notify(title, body) {
    if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body }); } catch (e) { /* some mobile browsers block this */ }
  }

  document.addEventListener('pointerdown', unlockAudio, { once: true });

  /* ---------- core timer actions ---------- */

  function ensureTicker() {
    if (ticker) return;
    ticker = setInterval(tick, 100);
  }

  function stopTickerIfIdle() {
    if (ticker && !st.running && !sw.running) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function setStatus(text) {
    statusText = text;
    q('#timerStatus').textContent = text;
  }

  function start() {
    unlockAudio();
    if (view === 'stopwatch') {
      if (sw.running) return;
      sw.running = true;
      sw.startAt = Date.now();
      persistSw();
      setStatus('Running.');
    } else {
      if (st.running) return;
      if (st.left <= 0) st.left = st.total;
      st.running = true;
      st.endAt = Date.now() + st.left;
      persistTimer();
      const t = st.mode === 'focus' ? currentTask() : null;
      setStatus(t ? `Working on: ${t.label}` : (st.mode === 'focus' ? 'One thing at a time.' : 'Break time. Step away from the screen.'));
    }
    ensureTicker();
    renderAll();
  }

  function pause() {
    const now = Date.now();
    if (view === 'stopwatch') {
      if (!sw.running) return;
      sw.base = swElapsed(now);
      sw.running = false;
      persistSw();
    } else {
      if (!st.running) return;
      st.left = C.remaining(st, now);
      st.running = false;
      st.endAt = 0;
      persistTimer();
    }
    setStatus('Paused.');
    stopTickerIfIdle();
    renderAll();
  }

  function toggle() {
    const running = view === 'stopwatch' ? sw.running : st.running;
    if (running) pause(); else start();
  }

  function reset() {
    if (view === 'stopwatch') {
      sw.running = false;
      sw.base = 0;
      sw.startAt = 0;
      sw.laps = [];
      persistSw();
    } else {
      st.running = false;
      st.endAt = 0;
      st.total = st.left = modeMs(st.mode);
      persistTimer();
    }
    setStatus('Ready when you are.');
    stopTickerIfIdle();
    renderAll();
  }

  function lap() {
    if (view !== 'stopwatch') return;
    const e = swElapsed(Date.now());
    if (e <= 0) return;
    sw.laps.push(e);
    persistSw();
    renderLaps();
  }

  function setPomodoroMode(m) {
    st.mode = m;
    st.running = false;
    st.endAt = 0;
    st.total = st.left = modeMs(m);
    persistTimer();
  }

  // Move on without logging anything (the "Skip" button).
  function skip() {
    if (view === 'stopwatch') return;
    if (st.running && !confirm('Skip this one? It won’t be counted.')) return;
    setPomodoroMode(st.mode === 'focus' ? 'short' : 'focus');
    view = st.mode;
    persistView();
    setStatus('Skipped.');
    stopTickerIfIdle();
    renderAll();
  }

  function switchView(m) {
    if (m === view) return;
    if (view === 'stopwatch') {
      if (sw.running) pause();
    } else if (st.running) {
      if (m === 'stopwatch') {
        pause();
      } else if (!confirm('Switch mode? The running timer will be reset.')) {
        return;
      }
    }
    view = m;
    if (m !== 'stopwatch' && m !== st.mode) setPomodoroMode(m);
    persistView();
    setStatus(m === 'stopwatch' ? (sw.base ? 'Paused.' : 'Ready when you are.') : (st.left < st.total ? 'Paused.' : 'Ready when you are.'));
    stopTickerIfIdle();
    renderAll();
  }

  // A pomodoro reached zero. silent is used when it finished while the page was closed.
  function complete(endedAt, silent) {
    const finished = st.mode;
    const mins = Math.max(1, Math.round(st.total / 60000));

    if (finished === 'focus') {
      st.done++;
      logSession(endedAt, mins);
    }

    const next = C.nextMode(finished, st.done, settings.every);
    const auto = finished === 'focus' ? settings.autoBreak : settings.autoFocus;

    st.mode = next;
    st.total = st.left = modeMs(next);
    st.running = false;
    st.endAt = 0;
    if (view !== 'stopwatch') { view = next; persistView(); }
    persistTimer();

    const doneMsg = finished === 'focus'
      ? `Focus session done. ${LABEL[next]} is next.`
      : 'Break over. Ready for the next focus session.';

    if (silent) {
      setStatus('Finished while you were away. ' + doneMsg);
    } else {
      setStatus(doneMsg);
      chime();
      notify(finished === 'focus' ? 'Focus session done' : 'Break over', doneMsg);
      if (document.hidden) titleOverride = finished === 'focus' ? 'Done – take a break' : 'Back to it';
      if (auto) { start(); return; }
    }
    stopTickerIfIdle();
    renderAll();
  }

  function tick() {
    const now = Date.now();
    if (st.running && C.remaining(st, now) <= 0) {
      complete(st.endAt, false);
      return;
    }
    paint(now);
  }

  /* ---------- rendering ---------- */

  function paint(now) {
    const display = q('#timerDisplay');
    let text;
    if (view === 'stopwatch') {
      text = C.fmtStopwatch(swElapsed(now));
      q('#timerBar').style.width = '0%';
    } else {
      const r = C.remaining(st, now);
      text = C.fmt(r);
      q('#timerBar').style.width = (st.total ? Math.min(100, Math.max(0, 100 * (1 - r / st.total))) : 0).toFixed(1) + '%';
    }
    if (display.textContent !== text) display.textContent = text;

    const running = view === 'stopwatch' ? sw.running : st.running;
    if (titleOverride && document.hidden) document.title = titleOverride;
    else document.title = running ? `${text} – ${LABEL[view]}` : IDLE_TITLE;
  }

  function renderLaps() {
    const list = q('#lapList');
    list.innerHTML = '';
    for (let i = sw.laps.length - 1; i >= 0; i--) {
      const split = sw.laps[i] - (i > 0 ? sw.laps[i - 1] : 0);
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = `Lap ${i + 1}`;
      const b = document.createElement('span');
      b.textContent = C.fmtStopwatch(split);
      const c = document.createElement('span');
      c.textContent = C.fmtStopwatch(sw.laps[i]);
      li.append(a, b, c);
      list.appendChild(li);
    }
  }

  function renderAll() {
    const isSw = view === 'stopwatch';
    const running = isSw ? sw.running : st.running;
    const started = isSw ? sw.base > 0 : st.left < st.total;

    qa('[data-mode]').forEach(b => {
      const on = b.dataset.mode === view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    q('#timerToggle').textContent = running ? 'Pause' : (started ? 'Resume' : 'Start');
    q('#lapBtn').hidden = !isSw;
    q('#timerSkip').hidden = isSw;
    q('#taskPickRow').hidden = isSw || st.mode !== 'focus';
    q('#presetRow').hidden = isSw;
    q('#lapList').hidden = !isSw;
    q('#cycleInfo').hidden = isSw;
    q('.progress').hidden = isSw;

    if (!isSw) {
      q('#cycleInfo').textContent = st.mode === 'focus'
        ? `Focus ${(st.done % settings.every) + 1} of ${settings.every} before a long break`
        : (st.mode === 'long' ? 'Long break. You earned it.' : `${st.done} focus session${st.done === 1 ? '' : 's'} done today`);
    }

    qa('.preset').forEach(b => {
      const on = Number(b.dataset.minutes) === settings.focus;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    q('#timerStatus').textContent = statusText;
    renderLaps();
    paint(Date.now());
  }

  /* ---------- history and stats ---------- */

  async function currentUser() {
    try { return typeof user === 'function' ? await user() : null; } catch (e) { return null; }
  }

  function localHistory() {
    const raw = store.get(KEY.history, []);
    return Array.isArray(raw) ? raw.filter(h => h && Number.isFinite(h.t) && Number.isFinite(h.min)) : [];
  }

  async function logSession(endedAt, mins) {
    const sel = currentTask();
    const entry = { t: endedAt, min: mins, task: sel ? sel.label : '' };
    const u = await currentUser();
    let saved = false;

    if (u && typeof supabaseClient !== 'undefined' && supabaseClient) {
      const row = {
        user_id: u.id,
        duration_minutes: Math.min(480, mins),
        completed: true,
        started_at: new Date(endedAt - mins * 60000).toISOString(),
        ended_at: new Date(endedAt).toISOString()
      };
      // Guest tasks have random ids that don't exist in the database.
      if (sel && !sel.guest) row.task_id = sel.id;
      const { error } = await supabaseClient.from('focus_sessions').insert(row);
      if (error) console.error('Could not save session:', error.message);
      else saved = true;
    }

    if (!saved) {
      const local = localHistory();
      local.push(entry);
      store.set(KEY.history, local.slice(-2000));
    }

    history.push(entry);
    refreshStats();
  }

  async function loadHistory() {
    let remote = [];
    const u = await currentUser();
    const note = q('#histNote');

    if (u && typeof supabaseClient !== 'undefined' && supabaseClient) {
      const since = new Date(Date.now() - 60 * 864e5).toISOString();
      const { data, error } = await supabaseClient
        .from('focus_sessions')
        .select('ended_at,duration_minutes,task_id')
        .eq('completed', true)
        .gte('ended_at', since)
        .order('ended_at');
      if (!error) {
        remote = (data || [])
          .filter(r => r.ended_at)
          .map(r => ({ t: Date.parse(r.ended_at), min: r.duration_minutes, task: taskTitleById(r.task_id) }));
      }
      note.textContent = 'Saved to your account.';
    } else {
      note.textContent = 'Saved in this browser only. Sign in to keep it across devices.';
    }

    history = localHistory().concat(remote);
    refreshStats();
  }

  const fmtMin = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

  function refreshStats() {
    const s = C.computeStats(history, Date.now());
    q('#statToday').textContent = fmtMin(s.todayMin);
    q('#statSessions').textContent = String(s.todaySessions);
    q('#statStreak').textContent = `${s.streak} day${s.streak === 1 ? '' : 's'}`;
    q('#statWeek').textContent = fmtMin(s.weekMin);

    const bars = q('#weekBars');
    bars.innerHTML = '';
    const max = Math.max(30, ...s.days.map(d => d.min));
    s.days.forEach(d => {
      const col = document.createElement('div');
      col.className = 'bar' + (d.today ? ' today' : '');
      const val = document.createElement('span');
      val.className = 'bar-val';
      val.textContent = d.min ? String(d.min) : '';
      const fill = document.createElement('i');
      fill.style.height = Math.max(d.min ? 4 : 1, (d.min / max) * 100) + '%';
      const lab = document.createElement('small');
      lab.textContent = d.label;
      col.append(val, fill, lab);
      bars.appendChild(col);
    });
    bars.setAttribute('aria-label', 'Focus minutes, last 7 days: ' + s.days.map(d => `${d.label} ${d.min}`).join(', '));
  }

  q('#exportCsv').addEventListener('click', () => {
    if (!history.length) { alert('No sessions to export yet.'); return; }
    const blob = new Blob([C.toCSV(history)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tempo-focus-${C.dayKey(Date.now())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  q('#clearHistory').addEventListener('click', async () => {
    if (!history.length || !confirm('Delete your whole focus history? This can’t be undone.')) return;
    store.set(KEY.history, []);
    const u = await currentUser();
    if (u && typeof supabaseClient !== 'undefined' && supabaseClient) {
      await supabaseClient.from('focus_sessions').delete().eq('user_id', u.id);
    }
    history = [];
    refreshStats();
  });

  /* ---------- settings ---------- */

  function writeSettings() {
    q('#setFocus').value = settings.focus;
    q('#setShort').value = settings.short;
    q('#setLong').value = settings.long;
    q('#setEvery').value = settings.every;
    q('#setAutoBreak').checked = settings.autoBreak;
    q('#setAutoFocus').checked = settings.autoFocus;
    q('#setSound').checked = settings.sound;
    q('#setVolume').value = settings.volume;
    q('#setNotify').checked = settings.notify;
  }

  // Apply new lengths to the current mode, unless it is paused partway through.
  function applyLengths() {
    if (st.running || st.left < st.total) return;
    st.total = st.left = modeMs(st.mode);
    persistTimer();
  }

  function readSettings() {
    settings = C.sanitize({
      focus: q('#setFocus').value,
      short: q('#setShort').value,
      long: q('#setLong').value,
      every: q('#setEvery').value,
      autoBreak: q('#setAutoBreak').checked,
      autoFocus: q('#setAutoFocus').checked,
      sound: q('#setSound').checked,
      volume: q('#setVolume').value,
      notify: q('#setNotify').checked
    });
    store.set(KEY.settings, settings);
    applyLengths();
    renderAll();
  }

  qa('#settingsBody input').forEach(el => el.addEventListener('change', readSettings));
  // Re-show the clamped value once the user leaves a number field.
  qa('#settingsBody input[type="number"]').forEach(el => el.addEventListener('blur', writeSettings));

  q('#setNotify').addEventListener('change', async e => {
    if (!e.target.checked) return;
    if (!('Notification' in window)) {
      e.target.checked = false;
      alert('This browser doesn’t support notifications.');
      readSettings();
      return;
    }
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (err) { /* ignore */ }
    }
    if (Notification.permission !== 'granted') {
      e.target.checked = false;
      alert('Notifications are blocked for this site. Allow them in your browser’s site settings to use this.');
    }
    readSettings();
  });

  q('#testSound').addEventListener('click', () => {
    unlockAudio();
    chime();
  });

  q('#resetSettings').addEventListener('click', () => {
    settings = C.sanitize({});
    store.set(KEY.settings, settings);
    writeSettings();
    applyLengths();
    renderAll();
  });

  /* ---------- controls ---------- */

  q('#timerToggle').addEventListener('click', toggle);
  q('#timerReset').addEventListener('click', reset);
  q('#timerSkip').addEventListener('click', skip);
  q('#lapBtn').addEventListener('click', lap);

  qa('[data-mode]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.mode)));

  qa('.preset').forEach(b => b.addEventListener('click', () => {
    settings = C.sanitize(Object.assign({}, settings, { focus: Number(b.dataset.minutes) }));
    store.set(KEY.settings, settings);
    q('#setFocus').value = settings.focus;
    applyLengths();
    renderAll();
  }));

  const fsBtn = q('#timerFull');
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else q('#timerPanel').requestFullscreen().catch(() => {});
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target;
    const tag = el && el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || (el && el.isContentEditable)) return;
    const k = e.key.toLowerCase();

    if (k === ' ' || k === 'spacebar') {
      if (tag === 'BUTTON' || tag === 'A') return; // let the focused control handle it
      e.preventDefault();
      toggle();
    } else if (k === 'r') reset();
    else if (k === 's') skip();
    else if (k === 'l') lap();
    else if (k === 'f' && document.fullscreenEnabled) fsBtn.click();
    else if (k === '1') switchView('focus');
    else if (k === '2') switchView('short');
    else if (k === '3') switchView('long');
    else if (k === '4') switchView('stopwatch');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) titleOverride = '';
    if (ticker) tick(); else paint(Date.now());
  });

  /* ---------- start up ---------- */

  writeSettings();
  fillTaskPickerSafe();

  function fillTaskPickerSafe() {
    // script.js may already have rendered the tasks before this file loaded.
    fillTaskPicker();
  }

  if (st.running) {
    if (st.endAt <= Date.now()) {
      complete(st.endAt, true);
    } else {
      setStatus('Still running.');
      ensureTicker();
    }
  }
  if (sw.running) ensureTicker();

  renderAll();
  loadHistory();
  setInterval(refreshStats, 60000); // roll the "today" numbers over at midnight
})();
