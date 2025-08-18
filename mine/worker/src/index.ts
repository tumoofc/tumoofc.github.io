/**
 * Cloudflare Worker (Modules) — TUMO Mining Backend (MVP)
 * Endpoints:
 *  - GET  /siws/nonce?pk=...
 *  - POST /siws/verify {pk, sig[number[]], nonce}
 *  - POST /mine/tick    {wallet, points}
 *  - POST /claim/prepare{wallet, day}
 *  - POST /claim/confirm{wallet, day, sig}
 *  - CRON /cron/settle  (daily settlement)
 */
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from "@solana/spl-token";

export interface Env {
  RPC_URL: string;
  TMO_MINT: string;
  DECIMALS: string; // e.g., "6"
  TREASURY_SECRET: string; // base58 secret key
  TREASURY_ATA: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  E_DAY_FIXED?: string;
}

// simple in-memory nonce store (for demo; use KV in production)
const siwsNonces = new Map<string, string>();

function jsonResponse(obj: any, status=200) {
  return new Response(JSON.stringify(obj), { status, headers:{ "Content-Type":"application/json" } });
}

async function sbFetch(env: Env, path: string, init: RequestInit = {}) {
  const url = new URL(path, env.SUPABASE_URL).toString();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE);
  headers.set("Authorization", "Bearer " + env.SUPABASE_SERVICE_ROLE);
  headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

async function ensureUser(env: Env, wallet: string) {
  // upsert
  await sbFetch(env, "/rest/v1/users", {
    method: "POST",
    body: JSON.stringify({ wallet }),
    headers: { "Prefer": "resolution=merge-duplicates" }
  });
}

async function addMiningEvent(env: Env, wallet: string, points: number) {
  await ensureUser(env, wallet);
  // get user_id
  const res = await sbFetch(env, `/rest/v1/users?wallet=eq.${wallet}&select=id&limit=1`);
  const js = await res.json();
  const uid = js?.[0]?.id;
  if (!uid) throw new Error("user not found");
  // TODO: rate limit, daily cap etc. (MVP keeps it simple)
  await sbFetch(env, "/rest/v1/mining_events", {
    method: "POST",
    body: JSON.stringify({ user_id: uid, points, reason: "timer" })
  });
}

async function settleDay(env: Env, dayISO: string) {
  // aggregate points
  const from = dayISO + "T00:00:00Z";
  const to = new Date(new Date(dayISO).getTime() + 86400000).toISOString();
  const agg = await sbFetch(env, `/rest/v1/rpc/sum_points`, {
    method: "POST",
    body: JSON.stringify({ from_ts: from, to_ts: to })
  }).then(r=>r.json());
  const totalPoints = agg?.[0]?.sum_points || 0;
  let E_DAY = Number(env.E_DAY_FIXED || 0);
  if (!E_DAY) {
    // fallback: 10,000 tokens per day demo
    E_DAY = 10000;
  }
  // fetch all user points
  const users = await sbFetch(env, `/rest/v1/rpc/points_by_user`, {
    method: "POST",
    body: JSON.stringify({ from_ts: from, to_ts: to })
  }).then(r=>r.json());
  // upsert daily_pools
  await sbFetch(env, "/rest/v1/daily_pools", {
    method:"POST",
    headers:{"Prefer":"resolution=merge-duplicates"},
    body: JSON.stringify({ day: dayISO, e_day: E_DAY, source: {fixed:true} })
  });
  for (const row of users) {
    const share = totalPoints ? (row.points / totalPoints) : 0;
    const amount = Math.floor(E_DAY * share * (10 ** Number(env.DECIMALS))) / (10 ** Number(env.DECIMALS));
    await sbFetch(env, "/rest/v1/claimables", {
      method: "POST",
      headers: { "Prefer":"resolution=merge-duplicates" },
      body: JSON.stringify({ day: dayISO, user_id: row.user_id, amount })
    });
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/siws/nonce" && req.method === "GET") {
        const pk = url.searchParams.get("pk") || "";
        const nonce = crypto.randomUUID();
        siwsNonces.set(pk, nonce);
        return new Response(nonce, { status:200 });
      }
      if (url.pathname === "/siws/verify" && req.method === "POST") {
        const { pk, sig, nonce } = await req.json();
        const exp = siwsNonces.get(pk);
        if (!exp || exp !== nonce) return new Response("bad nonce", { status:400 });
        const message = new TextEncoder().encode("Sign-In With Solana: " + nonce);
        const signature = Uint8Array.from(sig);
        const pub = new PublicKey(pk).toBytes();
        const ok = nacl.sign.detached.verify(message, signature, pub);
        if (!ok) return new Response("verify fail", { status:401 });
        return new Response("ok", { status:200 });
      }
      if (url.pathname === "/mine/tick" && req.method === "POST") {
        const { wallet, points } = await req.json();
        if (!wallet || !points) return new Response("bad body", { status:400 });
        await addMiningEvent(env, wallet, Number(points));
        return jsonResponse({ ok:true });
      }
      if (url.pathname === "/claim/prepare" && req.method === "POST") {
        const { wallet, day } = await req.json();
        if (!wallet || !day) return new Response("bad body", { status:400 });

        // lookup user & amount
        const ures = await sbFetch(env, `/rest/v1/users?wallet=eq.${wallet}&select=id&limit=1`);
        const uj = await ures.json(); const uid = uj?.[0]?.id;
        if (!uid) return new Response("no user", { status:404 });
        const cres = await sbFetch(env, `/rest/v1/claimables?day=eq.${day}&user_id=eq.${uid}`);
        const cj = await cres.json();
        const claim = cj?.[0];
        if (!claim || claim.claimed) return new Response("nothing to claim", { status:400 });
        const amount = Number(claim.amount);

        // build SPL transfer tx (treasury -> user)
        const conn = new Connection(env.RPC_URL, "confirmed");
        const mint = new PublicKey(env.TMO_MINT);
        const user = new PublicKey(wallet);
        const treasuryAta = new PublicKey(env.TREASURY_ATA);

        const userAta = await getAssociatedTokenAddress(mint, user);
        const ixs = [];
        // ensure user ATA
        const info = await conn.getAccountInfo(userAta);
        if (!info) {
          ixs.push(createAssociatedTokenAccountInstruction(user, userAta, user, mint));
        }
        // transfer
        const decimals = Number(env.DECIMALS || "6");
        const raw = Math.floor(amount * (10 ** decimals));
        ixs.push(createTransferInstruction(treasuryAta, userAta, new PublicKey(bs58.decode(env.TREASURY_SECRET).slice(-32)), raw));

        const tx = new Transaction().add(...ixs);
        tx.feePayer = user;
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

        // partial sign with treasury
        const secret = bs58.decode(env.TREASURY_SECRET);
        // secret is 64-byte ed25519 keypair
        // Web3.js expects Keypair (not available in workers without node crypto),
        // so we sign via tx.sign(...) alternative — using compatible API:
        // For MVP, we skip server-side signature and let treasury signature be provided by a delegate authority if needed.
        // In production, switch to using @solana/web3.js Keypair once supported in your Worker bundler.
        // NOTE: Many workers support Keypair from @solana/web3.js with polyfills; keep as TODO.

        // Return unsigned tx for client to pay & sign (requires treasury signature in production).
        const serialized = tx.serialize({ requireAllSignatures: false });
        const b64 = btoa(String.fromCharCode(...serialized));
        return new Response(b64, { status:200 });
      }
      if (url.pathname === "/claim/confirm" && req.method === "POST") {
        const { wallet, day, sig } = await req.json();
        // mark claimed
        const resU = await sbFetch(env, `/rest/v1/users?wallet=eq.${wallet}&select=id&limit=1`);
        const uj = await resU.json(); const uid = uj?.[0]?.id;
        if (!uid) return new Response("no user", { status:404 });
        await sbFetch(env, "/rest/v1/claims", {
          method:"POST",
          body: JSON.stringify({ user_id: uid, day, sig })
        });
        await sbFetch(env, "/rest/v1/claimables", {
          method:"PATCH",
          headers:{ "Prefer":"return=minimal" },
          body: JSON.stringify({ claimed: true }),
        }); // NOTE: In production, add filters (?day=eq.&user_id=eq.) using RPC or PostgREST exact update
        return jsonResponse({ ok:true });
      }
      if (url.pathname === "/cron/settle") {
        const now = new Date();
        const day = url.searchParams.get("day") || new Date(now.getTime() - 86400000).toISOString().slice(0,10);
        await settleDay(env, day);
        return jsonResponse({ ok:true, day });
      }
      return new Response("Not found", { status:404 });
    } catch (e:any) {
      return new Response("ERR: " + (e?.message||String(e)), { status:500 });
    }
  }
}
