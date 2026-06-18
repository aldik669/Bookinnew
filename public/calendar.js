(function () {
  const POLL_MS = 30000;

  const els = {
    grid: document.getElementById('calendar-grid'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    periodLabel: document.getElementById('period-label'),
    viewWeekBtn: document.getElementById('view-week'),
    viewDayBtn: document.getElementById('view-day'),
    navPrev: document.getElementById('nav-prev'),
    navNext: document.getElementById('nav-next'),
    navToday: document.getElementById('nav-today'),
    sumTotal: document.getElementById('sum-total'),
    sumHigh: document.getElementById('sum-high'),
    sumFull: document.getElementById('sum-full'),
    sumFree: document.getElementById('sum-free'),
    panel: document.getElementById('side-panel'),
    panelOverlay: document.getElementById('side-panel-overlay'),
    panelClose: document.getElementById('panel-close'),
    panelDate: document.getElementById('panel-date'),
    panelType: document.getElementById('panel-type'),
    panelFree: document.getElementById('panel-free'),
    panelPeople: document.getElementById('panel-people'),
  };

  const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  const state = {
    viewMode: 'week', // 'week' | 'day'
    weekStart: getMonday(new Date()),
    selectedDay: stripTime(new Date()),
    slots: [],
    limit: 16,
  };

  function stripTime(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  function getMonday(d) {
    const c = stripTime(d);
    const day = c.getDay(); // 0 = Sunday
    const diff = day === 0 ? -6 : 1 - day;
    c.setDate(c.getDate() + diff);
    return c;
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatShort(d) {
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
  }

  function isSameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  function parseSlotDate(slot) {
    return new Date(slot.datetime);
  }

  async function fetchSlots() {
    try {
      const res = await fetch('/api/slots');
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.message || `Ошибка ${res.status}`);
      }
      state.slots = json.slots || [];
      state.limit = json.limit || 16;
      setStatus(true, `обновлено в ${new Date(json.updated_at).toLocaleTimeString('ru-RU')}`);
      render();
    } catch (err) {
      setStatus(false, `ошибка связи: ${err.message}`);
    }
  }

  function setStatus(ok, text) {
    els.statusDot.className = 'status-dot ' + (ok ? 'status-ok' : 'status-error');
    els.statusText.textContent = text;
  }

  function classifyVirtual() {
    return { booked: 0, free: state.limit, status: 'empty', type: '', people: [] };
  }

  function render() {
    if (state.viewMode === 'week') renderWeek();
    else renderDay();
  }

  function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    const weekEnd = addDays(state.weekStart, 7);
    const today = stripTime(new Date());

    const relevant = state.slots.filter((s) => {
      const d = parseSlotDate(s);
      return d >= state.weekStart && d < weekEnd;
    });

    els.periodLabel.textContent = `${formatShort(days[0])} – ${formatShort(days[6])}.${days[6].getFullYear()}`;

    const times = [...new Set(relevant.map((s) => s.time))].sort();

    const lookup = new Map();
    relevant.forEach((s) => lookup.set(`${dateKey(parseSlotDate(s))}_${s.time}`, s));

    buildGrid(days, times, lookup, today);
    updateSummary(days, times, lookup);
  }

  function renderDay() {
    const day = state.selectedDay;
    const today = stripTime(new Date());
    const dayEnd = addDays(day, 1);

    const relevant = state.slots.filter((s) => {
      const d = parseSlotDate(s);
      return d >= day && d < dayEnd;
    });

    els.periodLabel.textContent = `${WEEKDAYS_RU[(day.getDay() + 6) % 7]}, ${formatShort(day)}.${day.getFullYear()}`;

    const times = [...new Set(relevant.map((s) => s.time))].sort();
    const lookup = new Map();
    relevant.forEach((s) => lookup.set(`${dateKey(day)}_${s.time}`, s));

    buildGrid([day], times, lookup, today);
    updateSummary([day], times, lookup);
  }

  function buildGrid(days, times, lookup, today) {
    els.grid.innerHTML = '';
    els.grid.style.gridTemplateColumns = `70px repeat(${days.length}, 1fr)`;
    els.grid.style.gridTemplateRows = `48px repeat(${times.length}, auto)`;

    const corner = document.createElement('div');
    corner.className = 'grid-header-cell corner';
    els.grid.appendChild(corner);

    days.forEach((d) => {
      const cell = document.createElement('div');
      const isToday = isSameDay(d, today);
      const dow = (d.getDay() + 6) % 7; // 0 = Mon
      const isWeekend = dow >= 5;
      cell.className =
        'grid-header-cell' + (isToday ? ' is-today' : '') + (isWeekend ? ' is-weekend' : '');
      const dayTotal = times.reduce((sum, time) => {
        const slot = lookup.get(`${dateKey(d)}_${time}`);
        return sum + (slot ? slot.booked : 0);
      }, 0);
      cell.innerHTML = `<div class="hdr-top"><span class="wd">${WEEKDAYS_RU[dow]}</span><span class="day-total">${dayTotal}</span></div><div class="dd">${formatShort(d)}</div>`;
      els.grid.appendChild(cell);
    });

    if (times.length === 0) {
      const empty = document.createElement('div');
      empty.style.gridColumn = `1 / span ${days.length + 1}`;
      empty.style.padding = '40px';
      empty.style.textAlign = 'center';
      empty.style.color = 'var(--text-dim)';
      empty.textContent = 'Нет запланированных МК в этом периоде';
      els.grid.appendChild(empty);
      return;
    }

    times.forEach((time) => {
      const timeCell = document.createElement('div');
      timeCell.className = 'grid-time-cell';
      timeCell.textContent = time;
      els.grid.appendChild(timeCell);

      days.forEach((d) => {
        const key = `${dateKey(d)}_${time}`;
        const slot = lookup.get(key);
        const data = slot || classifyVirtual();
        els.grid.appendChild(buildSlotCell(d, time, data));
      });
    });
  }

  function buildSlotCell(date, time, data) {
    const cell = document.createElement('div');
    cell.className = `slot-cell slot-${data.status}`;

    const count = document.createElement('div');
    count.className = 'slot-count';
    count.textContent = data.status === 'empty' ? 'свободно' : `${data.booked} / ${state.limit}`;
    cell.appendChild(count);

    if (data.status !== 'empty') {
      const meta = document.createElement('div');
      meta.className = 'slot-meta';
      meta.textContent = `${data.type || ''} · ${time}`;
      cell.appendChild(meta);
    } else {
      const meta = document.createElement('div');
      meta.className = 'slot-meta';
      meta.textContent = time;
      cell.appendChild(meta);
    }

    if (data.status === 'over') {
      const tag = document.createElement('div');
      tag.className = 'slot-over-tag';
      tag.textContent = 'ПЕРЕБОР';
      cell.appendChild(tag);
    }

    if (data.status !== 'empty') {
      const pct = Math.min(100, Math.round((data.booked / state.limit) * 100));
      const bar = document.createElement('div');
      bar.className = 'slot-progress';
      bar.style.width = pct + '%';
      cell.appendChild(bar);
    }

    cell.addEventListener('click', () => openPanel(date, time, data));
    return cell;
  }

  function updateSummary(days, times, lookup) {
    let total = 0,
      high = 0,
      full = 0,
      free = 0;

    days.forEach((d) => {
      times.forEach((time) => {
        const slot = lookup.get(`${dateKey(d)}_${time}`);
        const data = slot || classifyVirtual();
        total += data.booked;
        if (data.status === 'high') high += 1;
        if (data.status === 'full' || data.status === 'over') full += 1;
        if (data.status === 'empty') free += 1;
      });
    });

    els.sumTotal.textContent = total;
    els.sumHigh.textContent = high;
    els.sumFull.textContent = full;
    els.sumFree.textContent = free;
  }

  function openPanel(date, time, data) {
    const dow = (date.getDay() + 6) % 7;
    els.panelDate.textContent = `${WEEKDAYS_RU[dow]}, ${formatShort(date)}.${date.getFullYear()} · ${time}`;
    els.panelType.textContent = data.type || 'Тип не указан';
    els.panelFree.textContent = `Свободно: ${data.free} мест`;

    els.panelPeople.innerHTML = '';
    if (data.people && data.people.length) {
      data.people.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'person-row';
        row.innerHTML = `<div class="person-name">${escapeHtml(p.name)}</div><div class="person-phone">${escapeHtml(p.phone || 'нет телефона')}</div>`;
        els.panelPeople.appendChild(row);
      });
    } else {
      const none = document.createElement('div');
      none.className = 'no-people';
      none.textContent = 'Никто не записан';
      els.panelPeople.appendChild(none);
    }

    els.panel.classList.add('open');
    els.panelOverlay.classList.add('open');
  }

  function closePanel() {
    els.panel.classList.remove('open');
    els.panelOverlay.classList.remove('open');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  els.panelClose.addEventListener('click', closePanel);
  els.panelOverlay.addEventListener('click', closePanel);

  els.viewWeekBtn.addEventListener('click', () => {
    state.viewMode = 'week';
    els.viewWeekBtn.classList.add('active');
    els.viewDayBtn.classList.remove('active');
    render();
  });

  els.viewDayBtn.addEventListener('click', () => {
    state.viewMode = 'day';
    els.viewDayBtn.classList.add('active');
    els.viewWeekBtn.classList.remove('active');
    if (state.selectedDay < state.weekStart || state.selectedDay >= addDays(state.weekStart, 7)) {
      state.selectedDay = state.weekStart;
    }
    render();
  });

  els.navPrev.addEventListener('click', () => {
    if (state.viewMode === 'week') {
      state.weekStart = addDays(state.weekStart, -7);
    } else {
      state.selectedDay = addDays(state.selectedDay, -1);
    }
    render();
  });

  els.navNext.addEventListener('click', () => {
    if (state.viewMode === 'week') {
      state.weekStart = addDays(state.weekStart, 7);
    } else {
      state.selectedDay = addDays(state.selectedDay, 1);
    }
    render();
  });

  els.navToday.addEventListener('click', () => {
    const today = stripTime(new Date());
    state.weekStart = getMonday(today);
    state.selectedDay = today;
    render();
  });

  fetchSlots();
  setInterval(fetchSlots, POLL_MS);
})();
