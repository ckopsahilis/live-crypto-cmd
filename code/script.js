/* ═══════════════════════════════════════════════════════════
   Live Crypto Command Center 

   Features:
     Real-time prices via Binance WebSocket (miniTicker)
     Market Cap from CoinGecko REST API
     Chart.js sparklines with min/max markers
     OHLC candle rendering with timeframe selector
     Drag-to-reorder cards (persisted in localStorage)
     Fullscreen expand modal per coin
     Dark / Light theme toggle (persisted in localStorage)
   ═══════════════════════════════════════════════════════════ */


/* ── Configuration ──────────────────────────────────── */

const COINS = [
  { symbol: 'btcusdt', name: 'Bitcoin', short: 'BTC', pair: 'BTC / USDT', iconClass: 'btc', decimals: 2, chartColor: '#f7931a', rank: '#1', geckoId: 'bitcoin' },
  { symbol: 'ethusdt', name: 'Ethereum', short: 'ETH', pair: 'ETH / USDT', iconClass: 'eth', decimals: 2, chartColor: '#627eea', rank: '#2', geckoId: 'ethereum' },
  { symbol: 'bnbusdt', name: 'Binance Coin', short: 'BNB', pair: 'BNB / USDT', iconClass: 'bnb', decimals: 2, chartColor: '#f3ba2f', rank: '#4', geckoId: 'binancecoin' },
  { symbol: 'solusdt', name: 'Solana', short: 'SOL', pair: 'SOL / USDT', iconClass: 'sol', decimals: 3, chartColor: '#9945ff', rank: '#5', geckoId: 'solana' },
  { symbol: 'xrpusdt', name: 'Ripple', short: 'XRP', pair: 'XRP / USDT', iconClass: 'xrp', decimals: 4, chartColor: '#00aae4', rank: '#4', geckoId: 'ripple' },
  { symbol: 'suiusdt', name: 'Sui', short: 'SUI', pair: 'SUI / USDT', iconClass: 'sui', decimals: 4, chartColor: '#4da2ff', rank: '#10', geckoId: 'sui' },
];

const MAX_TICKS = 50;          // max data points for line sparkline
const MAX_CANDLES = 30;          // max candles shown in OHLC view
const GREEN = '#00dc82';
const RED = '#ef4468';
const startTime = Date.now();  // session start (for uptime counter)

// Reusable SVG arrow markup (avoids duplication across updateUI / modal)
const ARROW_UP = '<svg viewBox="0 0 10 10"><polygon points="5,2 9,8 1,8"/></svg>';
const ARROW_DN = '<svg viewBox="0 0 10 10"><polygon points="5,8 9,2 1,2"/></svg>';
const ARROW_UP_SIZED = '<svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,2 9,8 1,8" fill="currentColor"/></svg>';
const ARROW_DN_SIZED = '<svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,8 9,2 1,2" fill="currentColor"/></svg>';


/* ── Runtime State ──────────────────────────────────── */

const state = {};                // keyed by coin symbol
let ws = null;                   // active WebSocket instance
let reconnectTimer = null;       // reconnect delay timer
let modalCoin = null;            // currently expanded coin (or null)
let modalChartInstance = null;   // Chart.js instance inside modal
let draggedCard = null;          // card element being dragged

/* ── Theme Toggle ───────────────────────────────────── */

/** Restore saved theme preference from localStorage. */
function initTheme() {
  const saved = localStorage.getItem('crypto-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

/** Flip between dark ↔ light and persist the choice. */
function toggleTheme() {
  const html = document.documentElement;
  const next = (html.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('crypto-theme', next);
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
initTheme();

/* ── Summary Strip (mini price ribbon) ──────────────── */

const summaryStrip = document.getElementById('summaryStrip');
COINS.forEach(coin => {
  const item = document.createElement('div');
  item.className = 'summary-item';
  item.innerHTML = `
    <span class="summary-symbol">${coin.short}</span>
    <span class="summary-price" id="sp-${coin.symbol}">—</span>
    <span class="summary-change" id="sc-${coin.symbol}">0.00%</span>`;
  summaryStrip.appendChild(item);
});

/* ── Build Cards (respects saved drag order) ────────── */

const grid = document.getElementById('grid');

/** @returns {string[]} Ordered coin symbols from localStorage, or default COINS order. */
function getCardOrder() {
  try {
    const saved = localStorage.getItem('crypto-card-order');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore corrupt data */ }
  return COINS.map(c => c.symbol);
}

/** Persist current grid card order to localStorage. */
function saveCardOrder() {
  const order = Array.from(grid.children).map(card => card.id.replace('card-', ''));
  localStorage.setItem('crypto-card-order', JSON.stringify(order));
}

const orderedCoins = getCardOrder()
  .map(sym => COINS.find(c => c.symbol === sym)).filter(Boolean);
COINS.forEach(c => { if (!orderedCoins.find(o => o.symbol === c.symbol)) orderedCoins.push(c); });

orderedCoins.forEach(coin => {
  // Initialise per-coin runtime state
  state[coin.symbol] = {
    price: null,
    prevPrice: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    change: 0,
    ticks: [],            // price-only array for line sparkline
    rawTicks: [],         // { time, price } for candle aggregation
    candles: [],          // completed candles { time, o, h, l, c }
    currentCandle: null,  // in-progress candle
    chart: null,          // Chart.js instance
    chartType: 'line',    // 'line' | 'candle'
    timeframe: 60,        // candle bucket in seconds (60 = 1m)
    msgCount: 0,          // total WS messages received
    marketCap: null,      // from CoinGecko
  };

  const card = document.createElement('div');
  card.className = 'card';
  card.id = `card-${coin.symbol}`;
  card.innerHTML = `
    <div class="card-accent" style="--accent-color:${coin.chartColor}"></div>
    <div class="card-body">
      <div class="card-header">
        <div class="card-header-left">
          <div class="drag-handle" title="Drag to reorder"><span></span></div>
          <div class="coin-icon ${coin.iconClass}">${coin.short}</div>
          <div class="coin-info">
            <span class="coin-name">${coin.name}</span>
            <span class="coin-pair">${coin.pair}</span>
          </div>
        </div>
        <div class="card-header-right">
          <span class="rank-badge">${coin.rank}</span>
          <button class="expand-btn" data-symbol="${coin.symbol}" title="Expand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"></polyline>
              <polyline points="9 21 3 21 3 15"></polyline>
              <line x1="21" y1="3" x2="14" y2="10"></line>
              <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="price-section">
        <div class="price" id="price-${coin.symbol}">$—</div>
        <div class="price-meta">
          <span class="change-badge" id="badge-${coin.symbol}">
            <svg viewBox="0 0 10 10"><polygon points="5,2 9,8 1,8"/></svg> 0.00%
          </span>
          <span class="mcap-label" id="mcap-${coin.symbol}"></span>
        </div>
      </div>
    </div>
    <div class="stats">
      <div class="stat-item"><div class="stat-label">24h High</div><div class="stat-value" id="high-${coin.symbol}">—</div></div>
      <div class="stat-item"><div class="stat-label">24h Low</div><div class="stat-value" id="low-${coin.symbol}">—</div></div>
      <div class="stat-item"><div class="stat-label">24h Vol</div><div class="stat-value" id="vol-${coin.symbol}">—</div></div>
      <div class="stat-item"><div class="stat-label">Mkt Cap</div><div class="stat-value" id="mcapstat-${coin.symbol}">—</div></div>
    </div>
    <div class="chart-section">
      <div class="chart-header">
        <div class="chart-controls">
          <button class="chart-btn active" data-coin="${coin.symbol}" data-type="line">LINE</button>
          <button class="chart-btn" data-coin="${coin.symbol}" data-type="candle">OHLC</button>
          <span class="chart-btn-sep"></span>
          <button class="chart-btn tf-btn active" data-coin="${coin.symbol}" data-tf="60">1M</button>
          <button class="chart-btn tf-btn" data-coin="${coin.symbol}" data-tf="300">5M</button>
          <button class="chart-btn tf-btn" data-coin="${coin.symbol}" data-tf="900">15M</button>
        </div>
        <span class="chart-ticks" id="ticks-${coin.symbol}">0 / ${MAX_TICKS}</span>
      </div>
      <div class="chart-wrap">
        <canvas id="chart-${coin.symbol}"></canvas>
      </div>
    </div>`;
  grid.appendChild(card);
});

/* ── Chart-Type & Timeframe Click Delegation ────────── */

document.addEventListener('click', e => {
  /* ── Chart type toggle ── */
  const typeBtn = e.target.closest('[data-type]');
  if (typeBtn && typeBtn.dataset.coin) {
    const sym = typeBtn.dataset.coin;
    state[sym].chartType = typeBtn.dataset.type;
    const card = document.getElementById(`card-${sym}`);
    card.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
    typeBtn.classList.add('active');
    refreshChart(COINS.find(c => c.symbol === sym));
    return;
  }
  /* ── Timeframe selector ── */
  const tfBtn = e.target.closest('[data-tf]');
  if (tfBtn && tfBtn.dataset.coin) {
    const sym = tfBtn.dataset.coin;
    state[sym].timeframe = parseInt(tfBtn.dataset.tf);
    rebuildCandles(sym);
    const card = document.getElementById(`card-${sym}`);
    card.querySelectorAll('[data-tf]').forEach(b => b.classList.remove('active'));
    tfBtn.classList.add('active');
    refreshChart(COINS.find(c => c.symbol === sym));
    return;
  }
  /* ── Expand button ── */
  const expandBtn = e.target.closest('.expand-btn');
  if (expandBtn) {
    openModal(COINS.find(c => c.symbol === expandBtn.dataset.symbol));
    return;
  }
});

/* ── Candle Aggregation ─────────────────────────────── */

/** Rebuild all candles from rawTicks using the current timeframe. */
function rebuildCandles(sym) {
  const s = state[sym];
  const tf = s.timeframe * 1000;
  s.candles = [];
  s.currentCandle = null;
  for (const t of s.rawTicks) {
    const bucket = Math.floor(t.time / tf) * tf;
    if (!s.currentCandle || s.currentCandle.time !== bucket) {
      if (s.currentCandle) s.candles.push(s.currentCandle);
      s.currentCandle = { time: bucket, o: t.price, h: t.price, l: t.price, c: t.price };
    } else {
      s.currentCandle.h = Math.max(s.currentCandle.h, t.price);
      s.currentCandle.l = Math.min(s.currentCandle.l, t.price);
      s.currentCandle.c = t.price;
    }
  }
  if (s.candles.length > MAX_CANDLES) s.candles = s.candles.slice(-MAX_CANDLES);
}

/** Append a live price tick and bucket it into the active candle. */
function addTickToCandles(sym, price) {
  const s = state[sym];
  const now = Date.now();
  const tf = s.timeframe * 1000;
  const bucket = Math.floor(now / tf) * tf;

  s.rawTicks.push({ time: now, price });
  if (s.rawTicks.length > 2000) s.rawTicks = s.rawTicks.slice(-1500);

  if (!s.currentCandle || s.currentCandle.time !== bucket) {
    if (s.currentCandle) {
      s.candles.push(s.currentCandle);
      if (s.candles.length > MAX_CANDLES) s.candles.shift();
    }
    s.currentCandle = { time: bucket, o: price, h: price, l: price, c: price };
  } else {
    s.currentCandle.h = Math.max(s.currentCandle.h, price);
    s.currentCandle.l = Math.min(s.currentCandle.l, price);
    s.currentCandle.c = price;
  }
}

/* ── Chart.js Plugins ───────────────────────────────── */

/**
 * Min/Max Markers — draws a dot + label at the highest
 * and lowest values on line sparklines.
 */
const minMaxPlugin = {
  id: 'minMaxMarkers',
  afterDatasetsDraw(chart) {
    const ds = chart.data.datasets[0];
    if (!ds || !ds.data.length) return;
    if (chart._candleMode) return;              // skip in candle view
    const data = ds.data;
    let minV = Infinity, maxV = -Infinity, minI = 0, maxI = 0;
    data.forEach((v, i) => { if (v < minV) { minV = v; minI = i; } if (v > maxV) { maxV = v; maxI = i; } });
    if (minV === maxV) return;
    const { ctx } = chart;
    const xS = chart.scales.x, yS = chart.scales.y;
    const area = chart.chartArea;
    function mark(idx, val, isMax) {
      const x = xS.getPixelForValue(idx), y = yS.getPixelForValue(val);
      const c = isMax ? GREEN : RED;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
      ctx.font = '600 9px "JetBrains Mono",monospace'; ctx.fillStyle = c; ctx.textAlign = 'center';
      /* Clamp label inside chart area */
      let ly = isMax ? y - 8 : y + 14;
      if (ly < area.top + 10) ly = y + 14;          /* flip below if too close to top */
      if (ly > area.bottom - 2) ly = y - 8;          /* flip above if too close to bottom */
      ctx.fillText((isMax ? '▲ ' : '▼ ') + fmtShort(val), x, ly);
    }
    mark(maxI, maxV, true);
    mark(minI, minV, false);
  },
};

/**
 * Candle Renderer — draws OHLC candlestick bars
 * when a card is in candle mode (chart._candleData is set).
 */
const candlePlugin = {
  id: 'candleDraw',
  afterDatasetsDraw(chart) {
    if (!chart._candleData || !chart._candleData.length) return;

    const { ctx } = chart;
    const candles = chart._candleData;
    const yScale = chart.scales.y;
    const area = chart.chartArea;
    const count = candles.length;
    if (!count) return;

    const totalWidth = area.right - area.left;
    const barWidth = Math.max(3, Math.floor(totalWidth / count * 0.6));
    const spacing = (totalWidth - barWidth * count) / (count + 1);

    candles.forEach((candle, i) => {
      const x = area.left + spacing + i * (barWidth + spacing) + barWidth / 2;
      const oY = yScale.getPixelForValue(candle.o);
      const cY = yScale.getPixelForValue(candle.c);
      const hY = yScale.getPixelForValue(candle.h);
      const lY = yScale.getPixelForValue(candle.l);
      const isUp = candle.c >= candle.o;
      const color = isUp ? GREEN : RED;

      // Wick
      ctx.beginPath();
      ctx.moveTo(x, hY);
      ctx.lineTo(x, lY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Body
      const bodyTop = Math.min(oY, cY);
      const bodyHeight = Math.max(1, Math.abs(oY - cY));
      ctx.globalAlpha = isUp ? 0.85 : 0.95;
      ctx.fillStyle = color;
      ctx.fillRect(x - barWidth / 2, bodyTop, barWidth, bodyHeight);
      ctx.globalAlpha = 1;
    });
  },
};

Chart.register(minMaxPlugin, candlePlugin);

/* ── Create Chart.js Instances ──────────────────────── */
COINS.forEach(coin => {
  const ctx = document.getElementById(`chart-${coin.symbol}`).getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 110);
  grad.addColorStop(0, coin.chartColor + '30');
  grad.addColorStop(1, coin.chartColor + '00');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [], datasets: [{
        data: [], borderColor: coin.chartColor, borderWidth: 1.5,
        backgroundColor: grad, fill: true, tension: 0.4,
        pointRadius: 0, pointHitRadius: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { left: 0, right: 0, top: 14, bottom: 14 } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: false } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      interaction: { enabled: false },
    },
  });
  chart._candleMode = false;
  chart._candleData = null;
  state[coin.symbol].chart = chart;
});

/* ── Format Helpers ─────────────────────────────────── */

/** Format a number with fixed decimal places and thousand separators. */
function fmt(value, decimals) {
  if (value == null) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a large dollar value: $1.23T / $4.56B / $789.00M / $12.3K */
function fmtCompact(value) {
  if (value == null) return '—';
  const n = Number(value);
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

/** Format volume without dollar sign: 1.23B / 4.56M / 789.0K */
function fmtVol(value) {
  if (value == null) return '—';
  const n = Number(value);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

/** Adaptive short format for chart min/max labels. */
function fmtShort(value) {
  if (value >= 10000) return Math.round(value).toLocaleString();
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

/** Format elapsed time as "1h 23m 45s". */
function fmtUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/* ── Refresh Card Chart (line or candle) ────────────── */

/** Update the Chart.js instance for a coin based on its current chartType. */
function refreshChart(coin) {
  const s = state[coin.symbol];
  const chart = s.chart;

  if (s.chartType === 'candle') {
    const all = [...s.candles]; if (s.currentCandle) all.push(s.currentCandle);
    chart.data.labels = all.map((_, i) => i);
    // invisible mid-point data so y-axis scales to candle range
    chart.data.datasets[0].data = all.map(c => (c.h + c.l) / 2);
    chart.data.datasets[0].borderColor = 'transparent';
    chart.data.datasets[0].backgroundColor = 'transparent';
    chart.data.datasets[0].fill = false;
    // Compute y-range from candle extremes
    if (all.length) {
      const minY = Math.min(...all.map(c => c.l));
      const maxY = Math.max(...all.map(c => c.h));
      const pad = (maxY - minY) * 0.08 || 0.001;
      chart.options.scales.y.min = minY - pad;
      chart.options.scales.y.max = maxY + pad;
    }
    chart._candleMode = true;
    chart._candleData = all;
  } else {
    chart.data.labels = s.ticks.map((_, i) => i);
    chart.data.datasets[0].data = [...s.ticks];
    chart._candleMode = false;
    chart._candleData = null;
    // trend colouring
    const ctx = chart.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, 110);
    const up = s.ticks.length >= 2 && s.ticks[s.ticks.length - 1] >= s.ticks[0];
    const tc = up ? GREEN : RED;
    grad.addColorStop(0, tc + '25'); grad.addColorStop(1, tc + '00');
    chart.data.datasets[0].borderColor = tc;
    chart.data.datasets[0].backgroundColor = grad;
    chart.data.datasets[0].fill = true;
    chart.data.datasets[0].borderWidth = 1.5;
    // reset manual y bounds
    chart.options.scales.y.min = undefined;
    chart.options.scales.y.max = undefined;
  }
  chart.update('none');
}

/* ── DOM Update (called on every WebSocket message) ─── */

/** Push latest state for a coin into all DOM elements (card + summary + modal). */
function updateUI(coin) {
  const s = state[coin.symbol];
  const sign = s.change >= 0 ? '+' : '';

  /* summary strip */
  document.getElementById(`sp-${coin.symbol}`).textContent = '$' + fmt(s.price, coin.decimals);
  const scEl = document.getElementById(`sc-${coin.symbol}`);
  scEl.textContent = sign + s.change.toFixed(2) + '%';
  scEl.className = 'summary-change ' + (s.change >= 0 ? 'up' : 'down');

  /* price + flash */
  const priceEl = document.getElementById(`price-${coin.symbol}`);
  priceEl.textContent = '$' + fmt(s.price, coin.decimals);
  priceEl.classList.remove('flash-up', 'flash-down');
  void priceEl.offsetWidth;
  if (s.prevPrice !== null && s.price !== s.prevPrice)
    priceEl.classList.add(s.price > s.prevPrice ? 'flash-up' : 'flash-down');

  /* change badge */
  const badgeEl = document.getElementById(`badge-${coin.symbol}`);
  badgeEl.innerHTML = (s.change >= 0 ? ARROW_UP : ARROW_DN) + ' ' + sign + s.change.toFixed(2) + '%';
  badgeEl.className = 'change-badge ' + (s.change >= 0 ? 'up' : 'down');

  /* market cap inline label */
  const mcapEl = document.getElementById(`mcap-${coin.symbol}`);
  if (s.marketCap && mcapEl) mcapEl.textContent = 'MCap ' + fmtCompact(s.marketCap);

  /* stat cells */
  document.getElementById(`high-${coin.symbol}`).textContent = '$' + fmt(s.high, coin.decimals);
  document.getElementById(`low-${coin.symbol}`).textContent = '$' + fmt(s.low, coin.decimals);
  document.getElementById(`vol-${coin.symbol}`).textContent = fmtVol(s.volume);
  const mcStat = document.getElementById(`mcapstat-${coin.symbol}`);
  if (s.marketCap && mcStat) mcStat.textContent = fmtCompact(s.marketCap);

  /* tick counter */
  const cnt = s.chartType === 'candle'
    ? (s.candles.length + (s.currentCandle ? 1 : 0))
    : s.ticks.length;
  const mx = s.chartType === 'candle' ? MAX_CANDLES : MAX_TICKS;
  document.getElementById(`ticks-${coin.symbol}`).textContent = cnt + ' / ' + mx;

  /* chart */
  refreshChart(coin);

  /* live-update modal if it's open for this coin */
  if (modalCoin && modalCoin.symbol === coin.symbol) updateModalUI();
}

/* ── Market Cap (CoinGecko REST API, no key required) ── */

/** Fetch market cap data for all tracked coins and update the UI. */
async function fetchMarketCaps() {
  try {
    const ids = COINS.map(c => c.geckoId).join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true`);
    if (!r.ok) return;
    const data = await r.json();
    COINS.forEach(coin => {
      const entry = data[coin.geckoId];
      if (entry && entry.usd_market_cap) {
        state[coin.symbol].marketCap = entry.usd_market_cap;
        const el1 = document.getElementById(`mcap-${coin.symbol}`);
        if (el1) el1.textContent = 'MCap ' + fmtCompact(entry.usd_market_cap);
        const el2 = document.getElementById(`mcapstat-${coin.symbol}`);
        if (el2) el2.textContent = fmtCompact(entry.usd_market_cap);
      }
    });
  } catch { /* silent — non-critical */ }
}

/* ── Drag & Drop (HTML5 native, handle-only) ────────── */

/** Attach drag-and-drop listeners scoped to .drag-handle elements. */
function initDragAndDrop() {
  /* Only allow drag when initiated from the handle */
  grid.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    const card = handle && handle.closest('.card');
    if (card) card.setAttribute('draggable', 'true');
  });
  grid.addEventListener('mouseup', () => {
    grid.querySelectorAll('.card[draggable]').forEach(c => c.removeAttribute('draggable'));
  });
  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    draggedCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  });
  grid.addEventListener('dragend', e => {
    const card = e.target.closest('.card');
    if (card) { card.classList.remove('dragging'); card.removeAttribute('draggable'); }
    grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    draggedCard = null;
  });
  grid.addEventListener('dragover', e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.card');
    if (card && card !== draggedCard) {
      grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    }
  });
  grid.addEventListener('dragleave', e => {
    const card = e.target.closest('.card');
    if (card) card.classList.remove('drag-over');
  });
  grid.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.card');
    if (!target || !draggedCard || target === draggedCard) return;
    target.classList.remove('drag-over');
    const cards = Array.from(grid.children);
    if (cards.indexOf(draggedCard) < cards.indexOf(target))
      grid.insertBefore(draggedCard, target.nextSibling);
    else
      grid.insertBefore(draggedCard, target);
    saveCardOrder();
  });
}

/* ── Fullscreen Modal ───────────────────────────────── */

const modalOverlay = document.getElementById('modalOverlay');

/** Open the full-screen detail modal for a given coin. */
function openModal(coin) {
  if (!coin) return;
  modalCoin = coin;
  const s = state[coin.symbol];

  document.getElementById('modalTitle').innerHTML = `
    <div class="coin-icon ${coin.iconClass}" style="width:32px;height:32px;font-size:0.75rem">${coin.short}</div>
    <span>${coin.name} <span style="color:var(--text-tertiary);font-weight:400">${coin.pair}</span></span>`;

  document.getElementById('modalStats').innerHTML = `
    <div class="modal-stat-item"><div class="modal-stat-label">24h High</div><div class="modal-stat-value" id="mhigh">$${fmt(s.high, coin.decimals)}</div></div>
    <div class="modal-stat-item"><div class="modal-stat-label">24h Low</div><div class="modal-stat-value" id="mlow">$${fmt(s.low, coin.decimals)}</div></div>
    <div class="modal-stat-item"><div class="modal-stat-label">24h Volume</div><div class="modal-stat-value" id="mvol">${fmtVol(s.volume)}</div></div>
    <div class="modal-stat-item"><div class="modal-stat-label">Market Cap</div><div class="modal-stat-value" id="mmcap">${s.marketCap ? fmtCompact(s.marketCap) : '—'}</div></div>`;

  updateModalUI();

  /* modal chart */
  if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
  const ctx = document.getElementById('modalChart').getContext('2d');
  const up = s.ticks.length >= 2 && s.ticks[s.ticks.length - 1] >= s.ticks[0];
  const tc = up ? GREEN : RED;
  const grad = ctx.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, tc + '25'); grad.addColorStop(1, tc + '00');

  modalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: s.ticks.map((_, i) => i), datasets: [{
        data: [...s.ticks], borderColor: tc, borderWidth: 2,
        backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 16 } },
      scales: {
        x: { display: false },
        y: {
          display: true, position: 'right',
          grid: { color: 'rgba(128,128,128,0.08)' },
          ticks: {
            font: { family: 'JetBrains Mono', size: 10 },
            color: '#888', callback: v => '$' + fmtShort(v)
          }
        },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });

  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function updateModalUI() {
  if (!modalCoin) return;
  const s = state[modalCoin.symbol];
  const sign = s.change >= 0 ? '+' : '';

  document.getElementById('modalPrice').textContent = '$' + fmt(s.price, modalCoin.decimals);
  const badge = document.getElementById('modalBadge');
  badge.innerHTML = (s.change >= 0 ? ARROW_UP_SIZED : ARROW_DN_SIZED) + ' ' + sign + s.change.toFixed(2) + '%';
  badge.className = 'change-badge ' + (s.change >= 0 ? 'up' : 'down');

  const mh = document.getElementById('mhigh'), ml = document.getElementById('mlow'),
    mv = document.getElementById('mvol'), mm = document.getElementById('mmcap');
  if (mh) mh.textContent = '$' + fmt(s.high, modalCoin.decimals);
  if (ml) ml.textContent = '$' + fmt(s.low, modalCoin.decimals);
  if (mv) mv.textContent = fmtVol(s.volume);
  if (mm) mm.textContent = s.marketCap ? fmtCompact(s.marketCap) : '—';

  if (modalChartInstance && s.ticks.length) {
    const up = s.ticks[s.ticks.length - 1] >= s.ticks[0];
    const tc = up ? GREEN : RED;
    const ctx = modalChartInstance.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, tc + '25'); grad.addColorStop(1, tc + '00');
    modalChartInstance.data.labels = s.ticks.map((_, i) => i);
    modalChartInstance.data.datasets[0].data = [...s.ticks];
    modalChartInstance.data.datasets[0].borderColor = tc;
    modalChartInstance.data.datasets[0].backgroundColor = grad;
    modalChartInstance.update('none');
  }
}

/** Close the modal and clean up its chart instance. */
function closeModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  modalCoin = null;
  if (modalChartInstance) {
    modalChartInstance.destroy();
    modalChartInstance = null;
  }
}

document.getElementById('modalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── Market Status ──────────────────────────────────── */

/** Update the "OPEN / —" label in the topbar based on message count. */
function updateMarketStatus() {
  const el = document.getElementById('marketStatus');
  const total = COINS.reduce((n, c) => n + state[c.symbol].msgCount, 0);
  el.textContent = total > 0 ? 'OPEN' : '—';
}

/* ── WebSocket Connection ───────────────────────────── */

/** Open a combined miniTicker WebSocket stream for all coins. */
function connect() {
  const streams = COINS.map(c => `${c.symbol}@miniTicker`).join('/');
  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  ws.onopen = () => setStatus(true);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const d = msg.data;
    if (!d || !d.s) return;
    const key = d.s.toLowerCase();
    const coin = COINS.find(c => c.symbol === key);
    if (!coin) return;

    const s = state[key];
    const price = parseFloat(d.c);
    s.prevPrice = s.price;
    s.price = price;
    s.open = parseFloat(d.o);
    s.high = parseFloat(d.h);
    s.low = parseFloat(d.l);
    s.volume = parseFloat(d.v);
    s.change = s.open ? ((price - s.open) / s.open) * 100 : 0;
    s.msgCount++;

    s.ticks.push(price);
    if (s.ticks.length > MAX_TICKS) s.ticks.shift();

    addTickToCandles(key, price);
    updateUI(coin);
    updateMarketStatus();
  };

  ws.onerror = () => { };
  ws.onclose = () => { setStatus(false); scheduleReconnect(); };
}

/** Schedule a reconnection attempt after 3 seconds. */
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);
}

/** Toggle the connection indicator between Live / Offline states. */
function setStatus(connected) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const ind = document.getElementById('connectionIndicator');
  if (connected) {
    dot.classList.add('connected'); text.textContent = 'Live'; ind.classList.add('live');
  } else {
    dot.classList.remove('connected'); text.textContent = 'Offline'; ind.classList.remove('live');
  }
}

/* ── Clock & Uptime Counter ─────────────────────────── */

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB');
  document.getElementById('uptimeDisplay').textContent = 'Uptime: ' + fmtUptime(Date.now() - startTime);
}
setInterval(tick, 1000);
tick();

/* ── Initialise ─────────────────────────────────────── */

initDragAndDrop();
connect();
fetchMarketCaps();
setInterval(fetchMarketCaps, 300_000);  // refresh market caps every 5 min
