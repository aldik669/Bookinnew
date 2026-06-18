require('dotenv').config();

const express = require('express');
const path = require('path');
const { buildSlotsData } = require('./amo');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 30 * 1000;

let cache = { data: null, fetchedAt: 0 };
let lastError = null;
let inFlight = null;

async function getSlotsCached() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  if (inFlight) return inFlight;

  inFlight = buildSlotsData()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      lastError = null;
      return data;
    })
    .catch((err) => {
      lastError = err.message;
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/slots', async (req, res) => {
  try {
    const data = await getSlotsCached();
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: true,
      message: err.message || 'Не удалось получить данные из amoCRM',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Календарь МК запущен: http://localhost:${PORT}`);
});
