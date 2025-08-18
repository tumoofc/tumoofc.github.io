/* ===== i18n ===== */
const I18N = {
  en: {
    title: "TUMO Web Mining (MVP)",
    status_disconnected: "Wallet disconnected",
    status_connected: "Connected: ",
    connect: "Connect Wallet",
    start: "Start",
    stop: "Stop",
    today_earned_label: "Today:",
    pts: "pts",
    claim_today: "Claim today",
    fee_note: "Gas for the claim transaction is paid by the user's wallet.",
    login_fail: "Login failed",
    need_wallet: "Please connect your wallet.",
    claim_done: "Claimed: "
  },
  ko: {
    title: "TUMO 웹 채굴 (MVP)",
    status_disconnected: "지갑 미연결",
    status_connected: "연결됨: ",
    connect: "지갑 연결",
    start: "Start",
    stop: "Stop",
    today_earned_label: "오늘 적립:",
    pts: "pts",
    claim_today: "오늘분 수령",
    fee_note: "수령 트랜잭션의 가스는 사용자 지갑이 지불됩니다.",
    login_fail: "로그인 실패",
    need_wallet: "지갑 연결이 필요합니다.",
    claim_done: "수령 완료: "
  }
};

function detectLang() {
  const url = new URL(location.href);
  const q = (url.searchParams.get("lang") || "").toLowerCase();
  if (q === "en" || q === "ko") return q;
  const saved = localStorage.getItem("tumo_lang");
  if (saved === "en" || saved === "ko") return saved;
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("ko")) return "ko";
  return "en";
}
let CUR_LANG = detectLang();

function applyI18n() {
  const dict = I18N[CUR_LANG] || I18N.en;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  document.title = dict.title;

  const enBtn = document.getElementById("lang-en");
  const koBtn = document.getElementById("lang-ko");
  if (enBtn && koBtn) {
    enBtn.classList.toggle("active", CUR_LANG === "en");
    koBtn.classList.toggle("active", CUR_LANG === "ko");
  }
}

function setLang(lang) {
  CUR_LANG = (lang === "ko" ? "ko" : "en");
  localStorage.setItem("tumo_lang", CUR_LANG);
  applyI18n();
}

// ✅ 전역 노출 (mining.html의 onclick이 이걸 직접 호출)
window.setLang = setLang;

/* ===== Core mining logic ===== */
const SOL = solanaWeb3;

// >>> Replace with YOUR Cloudflare Worker URL <<<
const API_BASE = "https://YOUR-WORKER.workers.dev";

let walletPubkey = null;
let ticking = false;
let earned = 0;

const $ = (q) => document.querySelector(q);

async function connect() {
  if (!window.solana || !window.solana.isPhantom) {
    alert("Phantom wallet is required.");
    return;
  }
  const resp = await window.solana.connect();
  walletPubkey = resp.publicKey.toBase58();

  // SIWS
  const nonce = await (await fetch(API_BASE + "/siws/nonce?pk=" + walletPubkey)).text();
  const encoded = new TextEncoder().encode("Sign-In With Solana: " + nonce);
  const signed = await window.solana.signMessage(encoded, "utf8");
  const ok = await fetch(API_BASE + "/siws/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pk: walletPubkey, sig: Array.from(signed.signature), nonce })
  }).then(r => r.ok);

  if (!ok) {
    alert(I18N[CUR_LANG].login_fail);
    walletPubkey = null;
    $("#status").textContent = I18N[CUR_LANG].status_disconnected;
    return;
  }
  $("#status").textContent = I18N[CUR_LANG].status_connected + walletPubkey;
}

async function start() {
  if (!walletPubkey) return alert(I18N[CUR_LANG].need_wallet);
  if (ticking) return;
  ticking = true;
  loop();
}
function stop() { ticking = false; }

async function loop() {
  if (!ticking) return;
  try {
    await fetch(API_BASE + "/mine/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: walletPubkey, points: 1 })
    });
    earned += 1;
    $("#earned").textContent = earned;
  } catch (e) { console.error(e); }
  setTimeout(loop, 1000);
}

async function claimToday() {
  if (!walletPubkey) return alert(I18N[CUR_LANG].need_wallet);
  const day = new Date().toISOString().slice(0, 10);
  const res = await fetch(API_BASE + "/claim/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletPubkey, day })
  });
  if (!res.ok) {
    const t = await res.text();
    alert("Prepare failed: " + t);
    return;
  }
  const b64 = await res.text();
  const txBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const tx = SOL.Transaction.from(txBytes);
  const { signature } = await window.solana.signAndSendTransaction(tx);
  await fetch(API_BASE + "/claim/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletPubkey, day, sig: signature })
  });
  alert(I18N[CUR_LANG].claim_done + signature);
}

/* ===== Init + 안전장치 ===== */
document.addEventListener("DOMContentLoaded", () => {
  // (1) 번역 적용
  applyI18n();
  $("#status").textContent = I18N[CUR_LANG].status_disconnected;

  // (2) 버튼 핸들러
  const enBtn = document.getElementById("lang-en");
  const koBtn = document.getElementById("lang-ko");
  // mining.html에서 onclick을 이미 달았지만, 혹시 몰라 이벤트도 추가
  if (enBtn) enBtn.addEventListener("click", () => setLang("en"));
  if (koBtn) koBtn.addEventListener("click", () => setLang("ko"));

  $("#btnConnect")?.addEventListener("click", connect);
  $("#btnStart")?.addEventListener("click", start);
  $("#btnStop")?.addEventListener("click", stop);
  $("#btnClaim")?.addEventListener("click", claimToday);

  // (3) 자가진단 로그
  console.log("[TUMO] app.js loaded. setLang =", typeof window.setLang, "CUR_LANG =", CUR_LANG);
  if (API_BASE.includes("YOUR-WORKER")) {
    console.warn("[TUMO] API_BASE not set! Replace with your Cloudflare Worker URL.");
  }
});
