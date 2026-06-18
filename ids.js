// Утилита: выводит в консоль воронки/этапы и кастомные поля сделок,
// чтобы найти ID для .env (AMO_PIPELINE_ID, AMO_STATUS_ID, AMO_FIELD_MK_ID).
// Запуск: node ids.js  (нужны заполненные AMO_SUBDOMAIN и AMO_TOKEN в .env)

require('dotenv').config();

const SUBDOMAIN = process.env.AMO_SUBDOMAIN;
const TOKEN = process.env.AMO_TOKEN;

if (!SUBDOMAIN || !TOKEN) {
  console.error('Заполните AMO_SUBDOMAIN и AMO_TOKEN в .env перед запуском node ids.js');
  process.exit(1);
}

async function amoFetch(path) {
  const res = await fetch(`https://${SUBDOMAIN}.amocrm.ru${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`amoCRM ${res.status} ${res.statusText} (${path}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function printPipelines() {
  const data = await amoFetch('/api/v4/leads/pipelines');
  const pipelines = (data && data._embedded && data._embedded.pipelines) || [];
  console.log('\n=== ВОРОНКИ И ЭТАПЫ ===');
  for (const p of pipelines) {
    console.log(`\nВоронка: "${p.name}"  AMO_PIPELINE_ID=${p.id}`);
    const statuses = (p._embedded && p._embedded.statuses) || [];
    for (const s of statuses) {
      console.log(`  - Этап: "${s.name}"  AMO_STATUS_ID=${s.id}`);
    }
  }
}

async function printFields() {
  console.log('\n=== ПОЛЯ СДЕЛОК (содержащие "мк", "дата" или "время") ===');
  let page = 1;
  const keywords = ['мк', 'дата', 'время'];
  while (true) {
    const data = await amoFetch(`/api/v4/leads/custom_fields?page=${page}&limit=250`);
    const fields = (data && data._embedded && data._embedded.custom_fields) || [];
    if (!fields.length) break;
    for (const f of fields) {
      const nameLower = f.name.toLowerCase();
      if (keywords.some((k) => nameLower.includes(k))) {
        console.log(`  - "${f.name}" (${f.type})  AMO_FIELD_MK_ID=${f.id}`);
      }
    }
    if (!data._links || !data._links.next) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  try {
    await printPipelines();
    await printFields();
    console.log('\nГотово. Скопируйте нужные ID в .env.\n');
  } catch (err) {
    console.error('\nОшибка:', err.message);
    process.exit(1);
  }
})();
