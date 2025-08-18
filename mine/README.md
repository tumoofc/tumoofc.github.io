# TUMO Web Mining — MVP Pack

This is an MVP implementation for "web mining → daily settlement → user-paid claim" on Solana,
designed for GitHub Pages frontend + Cloudflare Workers backend + Supabase(Postgres).

## Structure
- `mine/` — static frontend to be placed under `https://tumoofc.github.io/mine/`
- `worker/` — Cloudflare Workers (Modules + TypeScript)
- `supabase/schema.sql` — DB schema

## Quick Start

### 1) Frontend (GitHub Pages)
Copy the `mine/` folder to your repo (`tumoofc/tumoofc.github.io`).
Edit `API_BASE` in `mine/app.js` to your Worker URL (e.g., `https://tumo-miner.your-subdomain.workers.dev`).

### 2) Backend (Cloudflare Workers)
- Create a new Worker (Modules, TypeScript)
- Set **Environment Variables**:
  - `RPC_URL` — your Solana RPC (e.g., https://api.mainnet-beta.solana.com or a provider)
  - `TMO_MINT` — `B9VQ1WGsnQzYXruK2vSSTJc7NdPkszRQQhwXTGqZ1xdk` (1T supply main token) or your reward token
  - `DECIMALS` — `6` (for the 1T TMO)
  - `TREASURY_SECRET` — base58-encoded secret key for the treasury wallet (server-side only)
  - `TREASURY_ATA` — pre-created ATA for `TMO_MINT` owned by the treasury wallet
  - `SUPABASE_URL` — your Supabase project URL
  - `SUPABASE_SERVICE_ROLE` — service role key (server-side only)
  - `E_DAY_FIXED` — optional; if set, use this number of tokens as daily pool (fallback if no oracle)
- Bind a **Cron Trigger** (e.g., `0 15 * * *` for 00:00 KST daily settlement) to call `CRON /cron/settle` automatically.

### 3) Supabase
Run `supabase/schema.sql` in SQL editor to create tables.

### 4) Test Flow
1) Connect Phantom on `/mine/index.html`
2) Click `Start` to accumulate points (1 pt/sec demo)
3) After the daily CRON runs, click **Claim today** to receive rewards
   - The transaction fee is paid by the user wallet; the treasury partially signs the transfer.

### Security Notes
- Keep `TREASURY_SECRET` and `SUPABASE_SERVICE_ROLE` **server-only** in Worker secrets.
- Consider hCaptcha, rate limits, IP/device checks to mitigate abuse.
- This MVP uses Supabase REST from the Worker for simplicity. You can swap to D1/DO/KV if preferred.

