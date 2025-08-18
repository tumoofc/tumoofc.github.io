/* Minimal front-end mining widget (vanilla JS) */
const SOL = solanaWeb3;

// TODO: set your Worker endpoint here
const API_BASE = "https://tumo-mining.myworker.workers.dev";

let walletPubkey = null;
let ticking = false;
let earned = 0;

const $ = (q)=>document.querySelector(q);

async function connect() {
  if (!window.solana || !window.solana.isPhantom) {
    alert("Phantom 지갑을 설치해 주세요.");
    return;
  }
  const resp = await window.solana.connect();
  walletPubkey = resp.publicKey.toBase58();
  $("#status").textContent = "Connected: " + walletPubkey;

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
    alert("로그인 실패");
    walletPubkey = null;
    return;
  }
}

async function start() {
  if (!walletPubkey) return alert("지갑 연결 필요");
  if (ticking) return;
  ticking = true;
  loop();
}
function stop(){ ticking = false; }

async function loop(){
  if (!ticking) return;
  try {
    await fetch(API_BASE + "/mine/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: walletPubkey, points: 1 })
    });
    earned += 1;
    $("#earned").textContent = earned;
  } catch(e) {
    console.error(e);
  }
  setTimeout(loop, 1000);
}

async function claimToday(){
  if (!walletPubkey) return alert("지갑 연결 필요");
  const day = new Date().toISOString().slice(0,10);
  const res = await fetch(API_BASE + "/claim/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletPubkey, day })
  });
  if (!res.ok) {
    const t = await res.text();
    alert("준비 실패: " + t);
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
  alert("수령 완료: " + signature);
}

document.addEventListener("DOMContentLoaded", () => {
  $("#btnConnect").onclick = connect;
  $("#btnStart").onclick = start;
  $("#btnStop").onclick = stop;
  $("#btnClaim").onclick = claimToday;
});
