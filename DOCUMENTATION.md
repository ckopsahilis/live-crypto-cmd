# Technical Documentation

Detailed technical reference for the Live Crypto Command Center.
For a project overview, features list, and setup instructions see [README.md](README.md).

---

## Table of Contents

1. [Feature Details](#feature-details)
2. [API Contracts](#api-contracts)
3. [localStorage Persistence](#localstorage-persistence)
4. [Adding / Removing Coins](#adding--removing-coins)

---

## Feature Details

### Real-Time Price Streaming

- **Source**: Binance combined WebSocket stream (`wss://stream.binance.com:9443/stream`)
- **Stream type**: `miniTicker` — lightweight push updates for each trading pair
- **Update frequency**: Sub-second; every tick from Binance triggers a DOM update
- **Data received per tick**: Close price (`c`), Open (`o`), High (`h`), Low (`l`), Volume (`v`)
- **Percent change**: Calculated client-side as `((close - open) / open) × 100`
- **Price flash animation**: Green/red color flash on increase/decrease (0.5s CSS animation)

### Market Cap Display

- **Source**: CoinGecko REST API (free tier, no API key required)
- **Endpoint**: `/api/v3/simple/price?ids=...&vs_currencies=usd&include_market_cap=true`
- **Refresh interval**: Every 5 minutes
- **Shown in**: Inline label next to change badge ("MCap $1.23T") and in the stats grid row
- **Format**: Compact notation — T (trillion), B (billion), M (million), K (thousand)

### Live Sparkline Charts

- **Library**: Chart.js 4.4.7 (loaded via CDN)
- **Type**: Area line chart with gradient fill
- **Max data points**: 50 ticks (configurable via `MAX_TICKS`)
- **Trend colouring**: Green when latest tick ≥ first tick, red otherwise
- **Updates**: Redrawn on every WebSocket message (animation disabled for performance)

### Min / Max Markers

- **Plugin**: Custom Chart.js plugin (`minMaxMarkers`)
- **Behaviour**: Draws a coloured dot and label at the highest (▲ green) and lowest (▼ red) data points
- **Label clamping**: Automatically flips labels inside the chart area when too close to the top or bottom edge
- **Only active in line mode** — disabled when viewing candles

### OHLC Candle Toggle

- **Buttons**: `LINE` / `OHLC` per card
- **Plugin**: Custom Chart.js plugin (`candleDraw`) renders candlestick bars with wicks
- **Aggregation**: Incoming ticks are bucketed into candles based on the selected timeframe
- **Max candles**: 30 (configurable via `MAX_CANDLES`)
- **Y-axis**: Manually scaled to candle high/low range with 8% padding

### Timeframe Selector

- **Buttons**: `1M` (1 minute), `5M` (5 minutes), `15M` (15 minutes) per card
- **Effect**: Changes the candle bucket duration; rebuilds all candles from stored raw ticks
- **Raw tick buffer**: Up to 2,000 ticks retained for re-bucketing
- **Independent per card** — each coin can have a different timeframe selected

### Drag-to-Reorder Cards

- **Trigger**: A 3-dot vertical grip handle at the top-left of each card
- **Mechanism**: HTML5 native Drag and Drop API
- **Visual feedback**: Dragged card becomes semi-transparent (50% opacity, 97% scale); drop target gets a cyan border highlight
- **Persistence**: Card order is saved to `localStorage` and restored on page reload
- **Handle-only**: Dragging from any other part of the card does NOT initiate a drag — only the dot handle

### Fullscreen Expand Modal

- **Trigger**: Expand button (↗ icon) in the top-right of each card
- **Content**: Larger coin icon, live-updating price, change badge, 4-stat grid (High, Low, Volume, Market Cap), full-width Chart.js sparkline with visible Y-axis labels
- **Closing**: Click the × button, click the overlay backdrop, or press `Escape`
- **Live updates**: While the modal is open, price/badge/stats/chart continue to update in real time
- **Scroll lock**: Body scrolling is disabled while the modal is open

### Dark / Light Theme Toggle

- **Trigger**: Sun/moon icon button in the topbar
- **Implementation**: Swaps `data-theme` attribute on `<html>` between `"dark"` and `"light"`
- **CSS architecture**: Full design token system via CSS custom properties
- **Persistence**: Saved to `localStorage`; restored on page load before first paint
- **Default**: Light mode when no saved preference exists
- **Dark theme**: Deep navy/charcoal backgrounds, light text, green/red accents
- **Light theme**: Clean white/grey backgrounds, dark text, muted green/red accents

### Summary Price Strip

- **Location**: Horizontal ribbon below the topbar
- **Content**: Each coin's symbol, current price, and percent change (colour-coded green/red)
- **Sticky**: Remains pinned below the topbar while scrolling
- **Scrollable**: Horizontally scrollable on small screens
- **Updates**: Refreshed on every WebSocket tick

### Connection Indicator & Auto-Reconnect

- **Location**: Topbar, right side
- **States**: Green dot + "Live" when connected; red dot + "Offline" when disconnected
- **Auto-reconnect**: Attempts reconnection every 3 seconds after a disconnect
- **Visual cue**: Dot and pill background switch color based on connection state

### Clock & Uptime Counter

- **Clock**: Displays current local time in HH:MM:SS format (24h), updated every second
- **Uptime**: Shows session duration since page load in `Xh Xm Xs` format
- **Location**: Clock in topbar; uptime in the fixed footer

### Responsive Layout

- **Grid breakpoints**:
  - `> 1100px`: 3-column grid
  - `768px – 1100px`: 2-column grid
  - `< 768px`: 1-column grid (topbar center stats hidden, brand tag hidden)
  - `< 480px`: Compact mode (smaller padding, connection text hidden)
- **Footer**: Fixed to viewport bottom
- **Summary strip**: Scrollable on small screens

### Visual Design

- **Style**: Clean, minimal UI with solid backgrounds and simplified contrast
- **Accent lines**: Gradient top border line coloured to each coin's brand colour
- **Focus**: Prioritizes readability and low visual noise

---

## API Contracts

### Binance WebSocket API

- **Endpoint**: `wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/...`
- **Stream**: Combined `miniTicker` (one connection for all coins)
- **Data fields**: `s` (symbol), `c` (close), `o` (open), `h` (high), `l` (low), `v` (volume)
- **Authentication**: None required (public endpoint)
- **Rate limits**: No per-message limit on read-only streams

### CoinGecko REST API

- **Endpoint**: `https://api.coingecko.com/api/v3/simple/price`
- **Parameters**: `ids`, `vs_currencies=usd`, `include_market_cap=true`
- **Authentication**: None required (free tier)
- **Refresh**: Every 5 minutes
- **Fallback**: If the request fails, market cap fields simply show "—"

---

## localStorage Persistence

| Key                 | Type   | Description                            |
|---------------------|--------|----------------------------------------|
| `crypto-theme`      | string | `"dark"` or `"light"` — active theme   |
| `crypto-card-order` | JSON   | Array of coin symbols in display order |

---

## Adding / Removing Coins

To add or remove a coin, edit the `COINS` array at the top of `code/script.js`:

```javascript
const COINS = [
  {
    symbol: 'btcusdt',       // Binance trading pair (lowercase)
    name: 'Bitcoin',         // Display name
    short: 'BTC',            // Abbreviation shown in icon + summary
    pair: 'BTC / USDT',      // Pair label shown below the name
    iconClass: 'btc',        // CSS class for icon colours (must match style.css)
    decimals: 2,             // Price decimal places
    chartColor: '#f7931a',   // Chart line / accent colour
    rank: '#1',              // CoinMarketCap rank badge label
    geckoId: 'bitcoin',      // CoinGecko API coin ID (for market cap)
  },
  // ...
];
```

Then add a matching CSS icon class in `code/style.css`:

```css
.coin-icon.btc { background: rgba(247, 147, 26, 0.12); color: #f7931a; }
```

No other changes are needed — the card, summary item, chart, and state are all auto-generated from the `COINS` array.
