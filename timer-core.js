/*
 * Pure helpers for the Tempo timer. No DOM access in here so the logic
 * can be tested with plain Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TempoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULTS = {
    focus: 25,
    short: 5,
    long: 15,
    every: 4,
    autoBreak: false,
    autoFocus: false,
    sound: true,
    volume: 0.6,
    notify: false
  };

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // Accepts whatever came out of storage or the form and returns safe settings.
  function sanitize(input) {
    const s = Object.assign({}, DEFAULTS, input || {});
    const vol = Number(s.volume);
    return {
      focus: clampInt(s.focus, 1, 180, DEFAULTS.focus),
      short: clampInt(s.short, 1, 60, DEFAULTS.short),
      long: clampInt(s.long, 1, 120, DEFAULTS.long),
      every: clampInt(s.every, 2, 12, DEFAULTS.every),
      autoBreak: s.autoBreak === true || s.autoBreak === 'true',
      autoFocus: s.autoFocus === true || s.autoFocus === 'true',
      sound: !(s.sound === false || s.sound === 'false'),
      volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : DEFAULTS.volume,
      notify: s.notify === true || s.notify === 'true'
    };
  }

  const pad = n => String(n).padStart(2, '0');

  // Countdown display. Rounds up so 00:00 only shows when time is truly up.
  function fmt(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // Stopwatch display with tenths of a second. Rounds down.
  function fmtStopwatch(ms) {
    const tenthsTotal = Math.max(0, Math.floor(ms / 100));
    const tenths = tenthsTotal % 10;
    const t = Math.floor(tenthsTotal / 10);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return (h > 0 ? `${h}:${pad(m)}` : pad(m)) + `:${pad(s)}.${tenths}`;
  }

  // What comes after the mode that just finished.
  // focusDone is the number of focus sessions finished, including this one.
  function nextMode(mode, focusDone, every) {
    if (mode === 'focus') return focusDone > 0 && focusDone % every === 0 ? 'long' : 'short';
    return 'focus';
  }

  // Time left, from the clock rather than from counting ticks.
  function remaining(state, now) {
    return state.running ? Math.max(0, state.endAt - now) : state.left;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function computeStats(history, now) {
    const minutes = {};
    const sessions = {};
    let totalMin = 0;

    (history || []).forEach(h => {
      if (!h || !Number.isFinite(h.t) || !Number.isFinite(h.min)) return;
      const k = dayKey(h.t);
      minutes[k] = (minutes[k] || 0) + h.min;
      sessions[k] = (sessions[k] || 0) + 1;
      totalMin += h.min;
    });

    const base = new Date(now);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      // Noon avoids daylight-saving edge cases when stepping back by days.
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12);
      const key = dayKey(d.getTime());
      days.push({
        key,
        label: d.toLocaleDateString('en', { weekday: 'short' }),
        min: minutes[key] || 0,
        today: i === 0
      });
    }

    const todayKey = dayKey(now);
    // A streak survives until the end of today: if nothing is logged yet today,
    // count back from yesterday.
    let streak = 0;
    let i = minutes[todayKey] ? 0 : 1;
    for (; i < 3650; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12);
      if (minutes[dayKey(d.getTime())]) streak++;
      else break;
    }

    return {
      todayMin: minutes[todayKey] || 0,
      todaySessions: sessions[todayKey] || 0,
      weekMin: days.reduce((n, d) => n + d.min, 0),
      totalMin,
      streak,
      days
    };
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // Stop spreadsheet apps from running task names that start like formulas.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(history) {
    const rows = (history || [])
      .filter(h => h && Number.isFinite(h.t) && Number.isFinite(h.min))
      .slice()
      .sort((a, b) => a.t - b.t)
      .map(h => {
        const d = new Date(h.t);
        return [dayKey(h.t), `${pad(d.getHours())}:${pad(d.getMinutes())}`, h.min, h.task || ''].map(csvCell).join(',');
      });
    return ['date,time,minutes,task'].concat(rows).join('\n') + '\n';
  }

  return { DEFAULTS, sanitize, fmt, fmtStopwatch, nextMode, remaining, dayKey, computeStats, toCSV };
});
