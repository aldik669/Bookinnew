// Логика работы с amoCRM API v4: сделки этапа "Назначено пробное" -> слоты МК.

const WEEKDAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function getConfig() {
  return {
    subdomain: process.env.AMO_SUBDOMAIN,
    token: process.env.AMO_TOKEN,
    pipelineId: process.env.AMO_PIPELINE_ID,
    statusId: process.env.AMO_STATUS_ID,
    fieldMkId: process.env.AMO_FIELD_MK_ID,
    slotLimit: Number(process.env.SLOT_LIMIT || 16),
  };
}

function assertConfig(cfg) {
  const missing = ['subdomain', 'token', 'pipelineId', 'statusId', 'fieldMkId'].filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`Не заполнены переменные .env: ${missing.join(', ')}`);
  }
}

async function amoFetch(cfg, path) {
  const url = `https://${cfg.subdomain}.amocrm.ru${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`amoCRM ${res.status} ${res.statusText} (${path}): ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllLeads(cfg) {
  const leads = [];
  let page = 1;
  while (true) {
    const path =
      `/api/v4/leads?filter[statuses][0][pipeline_id]=${cfg.pipelineId}` +
      `&filter[statuses][0][status_id]=${cfg.statusId}` +
      `&with=contacts&page=${page}&limit=250`;
    const data = await amoFetch(cfg, path);
    if (!data || !data._embedded || !data._embedded.leads) break;
    leads.push(...data._embedded.leads);
    if (!data._links || !data._links.next) break;
    page += 1;
    await sleep(200);
  }
  return leads;
}

function getCustomFieldById(lead, fieldId) {
  const fields = lead.custom_fields_values || [];
  return fields.find((f) => String(f.field_id) === String(fieldId)) || null;
}

function getCustomFieldByNameContains(lead, substr) {
  const fields = lead.custom_fields_values || [];
  return fields.find((f) => f.field_name && f.field_name.toLowerCase().includes(substr.toLowerCase())) || null;
}

// Часовой пояс бизнеса — Asia/Almaty, фиксированный UTC+5 (Казахстан с 2024 года
// живёт в одном поясе без перехода на летнее время). Все даты ниже хранятся не как
// настоящие моменты времени, а как "гражданское" время Алматы, упакованное в Date
// через UTC-методы — это даёт одинаковый результат независимо от часового пояса
// хоста, на котором запущен сервер (важно для деплоя, где TZ контейнера может быть UTC).
const BUSINESS_TZ_OFFSET_MIN = 5 * 60;

function toBusinessRepresentation(absoluteDate) {
  const shifted = new Date(absoluteDate.getTime() + BUSINESS_TZ_OFFSET_MIN * 60 * 1000);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds()
    )
  );
}

function nowInBusinessTz() {
  return toBusinessRepresentation(new Date());
}

// Значение бывает unix-таймстампом (число/строка-число, абсолютный момент времени)
// или строкой вида "18.06.2026 17:00:00" / ISO без смещения (уже гражданское время
// Алматы, как его ввели в amoCRM) / ISO со смещением (абсолютный момент времени).
function parseMkDate(rawValue) {
  if (rawValue == null) return null;

  if (typeof rawValue === 'number') {
    return toBusinessRepresentation(new Date(rawValue * 1000));
  }

  const str = String(rawValue).trim();
  if (/^\d+$/.test(str)) {
    return toBusinessRepresentation(new Date(Number(str) * 1000));
  }

  const ddmmyyyy = str.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T]?(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy, hh, min, ss] = ddmmyyyy;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss || 0)));
  }

  const isoNoOffset = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  if (isoNoOffset) {
    const [, yyyy, mm, dd, hh, min, ss] = isoNoOffset;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)));
  }

  const isoLike = new Date(str);
  if (!Number.isNaN(isoLike.getTime())) {
    return toBusinessRepresentation(isoLike);
  }

  return null;
}

function getSlotType(lead) {
  const field = getCustomFieldByNameContains(lead, 'время мк');
  const value = field && field.values && field.values[0] && field.values[0].value;
  const str = value == null ? '' : String(value).toLowerCase();
  return str.includes('индивид') ? 'Индив' : 'Группа';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function formatTime(d) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function slotKey(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

async function fetchContactsByIds(cfg, ids) {
  const contactsById = new Map();
  const batchSize = 50;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const filterParams = batch.map((id, idx) => `filter[id][${idx}]=${id}`).join('&');
    const data = await amoFetch(cfg, `/api/v4/contacts?${filterParams}&limit=250`);
    const contacts = (data && data._embedded && data._embedded.contacts) || [];
    for (const contact of contacts) {
      const phoneField = (contact.custom_fields_values || []).find((f) => f.field_code === 'PHONE');
      const phone = phoneField && phoneField.values && phoneField.values[0] && phoneField.values[0].value;
      contactsById.set(contact.id, { name: contact.name || '', phone: phone || '' });
    }
    if (i + batchSize < ids.length) await sleep(200);
  }
  return contactsById;
}

async function buildSlotsData() {
  const cfg = getConfig();
  assertConfig(cfg);

  const leads = await fetchAllLeads(cfg);
  const now = nowInBusinessTz();

  const slotsMap = new Map();

  for (const lead of leads) {
    const field = getCustomFieldById(lead, cfg.fieldMkId);
    const rawValue = field && field.values && field.values[0] && field.values[0].value;
    const mkDate = parseMkDate(rawValue);
    if (!mkDate || mkDate < now) continue;

    const key = slotKey(mkDate);
    if (!slotsMap.has(key)) {
      slotsMap.set(key, {
        date: mkDate,
        types: [],
        leadContactIds: [],
      });
    }
    const slot = slotsMap.get(key);
    slot.types.push(getSlotType(lead));

    const mainContact =
      lead._embedded && lead._embedded.contacts && lead._embedded.contacts[0];
    slot.leadContactIds.push(mainContact ? mainContact.id : null);
  }

  const allContactIds = [...new Set([...slotsMap.values()].flatMap((s) => s.leadContactIds).filter(Boolean))];
  const contactsById = await fetchContactsByIds(cfg, allContactIds);

  const slots = [...slotsMap.entries()]
    .map(([key, slot]) => {
      const booked = slot.leadContactIds.length;
      const free = Math.max(cfg.slotLimit - booked, 0);
      const status = classifyStatus(booked, cfg.slotLimit);
      const typeCounts = slot.types.reduce((acc, t) => {
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});
      const type = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

      const people = slot.leadContactIds.map((id) => {
        const contact = id ? contactsById.get(id) : null;
        return { name: (contact && contact.name) || 'Без имени', phone: (contact && contact.phone) || '' };
      });

      return {
        key,
        datetime: `${slot.date.getUTCFullYear()}-${pad2(slot.date.getUTCMonth() + 1)}-${pad2(
          slot.date.getUTCDate()
        )}T${pad2(slot.date.getUTCHours())}:${pad2(slot.date.getUTCMinutes())}:00`,
        date: formatDate(slot.date),
        weekday: WEEKDAYS_RU[slot.date.getUTCDay()],
        time: formatTime(slot.date),
        type,
        booked,
        free,
        status,
        people,
      };
    })
    .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));

  return {
    updated_at: new Date().toISOString(),
    limit: cfg.slotLimit,
    slots,
  };
}

function classifyStatus(booked, limit) {
  if (booked === 0) return 'empty';
  const ratio = booked / limit;
  if (booked > limit) return 'over';
  if (booked === limit) return 'full';
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

module.exports = { buildSlotsData, getConfig, parseMkDate };
