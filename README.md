# Live Crypto Command Center

A real-time cryptocurrency dashboard built with vanilla HTML, CSS, and JavaScript — no frameworks, no build tools. Prices stream live via Binance WebSocket.

## Demo Video

<video src="https://raw.githubusercontent.com/ckopsahilis/live-crypto-cmd/main/Crypto_Cmd_UI.mp4" controls="controls" width="100%"></video>

If the embedded player doesn’t load in your viewer, open the video directly: [Crypto_Cmd_UI.mp4](./Crypto_Cmd_UI.mp4)

---

## Features

- **Real-time prices** — sub-second updates via Binance WebSocket with green/red flash animations
- **Market cap** — fetched from CoinGecko, refreshed every 5 minutes
- **Sparkline charts** — live area charts powered by Chart.js with min/max markers
- **OHLC candles** — toggle between line and candlestick view per coin
- **Timeframe selector** — switch between 1M, 5M, and 15M candle intervals
- **Drag-to-reorder** — rearrange cards via a grip handle, order persisted in localStorage
- **Fullscreen modal** — expand any coin to a detailed live-updating view
- **Dark / Light theme** — one-click toggle, saved across sessions
- **Summary strip** — scrollable price ribbon below the topbar
- **Connection indicator** — live/offline status with automatic reconnect
- **Clock & uptime** — local time in the topbar, session duration in the footer
- **Responsive grid** — 3 → 2 → 1 column layout across breakpoints
- **Clean UI** — simple, readable, low-noise styling

---

## Tracked Coins

| Coin          | Pair       | Rank |
|---------------|------------|------|
| Bitcoin       | BTC / USDT | #1   |
| Ethereum      | ETH / USDT | #2   |
| Binance Coin  | BNB / USDT | #4   |
| Solana        | SOL / USDT | #5   |
| Ripple        | XRP / USDT | #4   |
| Sui           | SUI / USDT | #10  |

---

## Tech Stack

| Technology   | Purpose                                | Source          |
|--------------|----------------------------------------|-----------------|
| HTML / CSS / JS | UI, styling, logic (vanilla, no frameworks) | Local files |
| Chart.js 4.4 | Sparkline & candlestick charts        | jsDelivr CDN   |
| Google Fonts | Inter (UI) + JetBrains Mono (numerals) | Google Fonts CDN |

**No build step. No package manager. No server.**

---

## Getting Started

1. Clone the repository.
2. Open `code/index.html` in any modern browser.
3. An internet connection is required for live data and CDN assets.

```
live_crypto_project/
├── code/
│   ├── index.html      HTML shell
│   ├── style.css       Design system & themes
│   └── script.js       Application logic
├── Crypto_Cmd_UI.mp4   UI video
├── README.md           This file
├── LICENSE             MIT License
└── DOCUMENTATION.md    Detailed technical reference
```

---

## Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for in-depth technical details: API contracts, Chart.js plugin internals, localStorage keys, and a guide for adding or removing coins.

---

## APIs

| API | Purpose | Auth |
|-----|---------|------|
| [Binance WebSocket](https://binance-docs.github.io/apidocs/spot/en/#mini-ticker-stream) | Live price streaming (`miniTicker`) | None |
| [CoinGecko REST](https://www.coingecko.com/en/api) | Market cap data | None (free tier) |

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
