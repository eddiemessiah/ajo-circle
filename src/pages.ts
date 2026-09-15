import type { TokenInfo } from "./chain.js";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// System fonts only: these pages open on budget Android over slow connections.
const CSS = `
:root{--ground:#F3F5F0;--surface:#FFFFFF;--ink:#13201A;--muted:#5A675F;--rule:#D5DCD4;--accent:#0D6A53;--on-accent:#FFFFFF;
--ok:#1F7A4A;--ok-bg:#DFF0E5;--err:#A33B2B;--err-bg:#F6E0DC;--info-bg:#E6ECF2}
@media (prefers-color-scheme:dark){:root{--ground:#0E1411;--surface:#151D19;--ink:#E3EAE5;--muted:#9AA8A0;--rule:#2A3630;--accent:#5CC6A5;--on-accent:#06130E;
--ok:#7FD4A2;--ok-bg:#16311F;--err:#F09A8B;--err-bg:#3A1C17;--info-bg:#1B2530}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:0 16px}
main{max-width:420px;margin:0 auto;padding-block:32px;display:flex;flex-direction:column;gap:16px}
.eyebrow{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0}
h1{font-size:1.6rem;line-height:1.2;margin:0;text-wrap:balance}
p{margin:0}.sub{color:var(--muted)}
.status{border-radius:10px;padding:14px 16px;background:var(--info-bg);display:flex;gap:10px;align-items:flex-start}
.status::before{content:"";width:10px;height:10px;border-radius:50%;margin-top:7px;flex:none;background:var(--muted)}
.status[data-state=pending]::before{animation:pulse 1s ease-in-out infinite alternate}
.status[data-state=success]{background:var(--ok-bg);color:var(--ok)}.status[data-state=success]::before{background:var(--ok)}
.status[data-state=error]{background:var(--err-bg);color:var(--err)}.status[data-state=error]::before{background:var(--err)}
@keyframes pulse{to{opacity:.25}}
@media (prefers-reduced-motion:reduce){.status::before{animation:none!important}}
.btn{display:block;width:100%;text-align:center;border:0;border-radius:10px;padding:15px 16px;font:600 1rem/1.2 inherit;background:var(--accent);color:var(--on-accent);text-decoration:none;cursor:pointer}
.btn:disabled{opacity:.55;cursor:default}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--rule)}
.btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.stack{display:flex;flex-direction:column;gap:10px}
.fine{font-size:.85rem;color:var(--muted)}
`;

// Shared wallet helpers. The user's address is kept in memory only and never written to the page.
const WALLET_JS = `
const CHAIN_ID="0xa4ec";
const eth=window.ethereum;
const isMiniPay=!!(eth&&eth.isMiniPay);
const $=(id)=>document.getElementById(id);
function show(state,text){const s=$("status");s.dataset.state=state;$("status-text").textContent=text;}
async function connect(){
  const accounts=await eth.request({method:"eth_requestAccounts"});
  if(!isMiniPay){
    const chainId=await eth.request({method:"eth_chainId"});
    if(chainId!==CHAIN_ID){
      try{await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_ID}]});}
      catch(e){
        if(e&&e.code===4902){await eth.request({method:"wallet_addEthereumChain",params:[{chainId:CHAIN_ID,chainName:"Celo",nativeCurrency:{name:"CELO",symbol:"CELO",decimals:18},rpcUrls:["https://forno.celo.org"],blockExplorerUrls:["https://celoscan.io"]}]});}
        else throw e;
      }
    }
  }
  return accounts[0];
}
function errorText(e){
  const code=e&&e.code;
  if(code===4001)return "You cancelled, so nothing was sent.";
  if(code===4100)return "Your wallet hasn't allowed this page yet. Approve the connection and try again.";
  if(code===-32002)return "Your wallet already has a request waiting. Open your wallet app to finish it.";
  return "That didn't go through, and nothing was sent. Try again in a moment.";
}
function showNoWallet(){
  show("error","Open this page inside your wallet app to continue.");
  $("nowallet").hidden=false;
  $("mm").href="https://metamask.app.link/dapp/"+location.host+location.pathname;
  $("copy").onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$("copy").textContent="Page link copied";}catch{$("copy").textContent="Copy failed. Long-press the address bar instead";}};
}
`;

const NO_WALLET = `
<div id="nowallet" class="stack" hidden>
  <a id="mm" class="btn">Open in MetaMask</a>
  <button id="copy" class="btn ghost" type="button">Copy page link</button>
  <p class="fine">Using MiniPay, Valora or another Celo wallet? Paste the page link into its built-in browser.</p>
</div>`;

function shell(title: string, body: string, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

export function homePage() {
  return shell(
    "Ajo Circle",
    `<p class="eyebrow">Ajo Circle</p>
<h1>Your savings circle, run for you in Telegram</h1>
<p class="sub">Add the Ajo Circle bot to your group and send <b>/newcircle 20 USDT Friday Ajo</b>. Each week one member receives the pot, and everyone else pays them directly from their own wallet. The bot tracks who has paid, reminds whoever hasn't, and never holds the money.</p>
<p class="fine">Pays in USDT, USA₮ or cNGN on Celo.</p>`,
  );
}

export function linkPage(p: { token: string; circleName: string | null }) {
  if (!p.circleName) {
    return shell(
      "Link expired · Ajo Circle",
      `<p class="eyebrow">Ajo Circle</p><h1>This link has expired</h1><p class="sub">Send /join in your circle's Telegram group to get a fresh one.</p>`,
    );
  }
  return shell(
    `Connect wallet · ${p.circleName}`,
    `<p class="eyebrow">${esc(p.circleName)}</p>
<h1>Connect the wallet you'll use for this circle</h1>
<p class="sub">You'll pay from it each round and receive the pot into it on your turn. Nothing is charged to connect.</p>
<div id="status" class="status" data-state="idle" role="status" aria-live="polite"><span id="status-text">Ready when you are.</span></div>
<button id="go" class="btn" type="button">Connect wallet</button>
${NO_WALLET}`,
    `${WALLET_JS}
const TOKEN=${json(p.token)};
const LINK_ERRORS={link_expired:"This link has expired. Send /join in your group to get a fresh one.",wallet_in_use:"Another member already uses this wallet. Connect a different one.",member_not_found:"We couldn't find you in this circle. Send /join in the group."};
async function run(){
  if(!eth)return showNoWallet();
  $("go").disabled=true;show("pending","Connecting your wallet…");
  try{
    const address=await connect();
    const res=await fetch("/api/link",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:TOKEN,address})});
    const out=await res.json().catch(()=>({}));
    if(res.ok){$("go").hidden=true;show("success","Wallet connected. You can go back to Telegram now.");}
    else{$("go").disabled=false;show("error",LINK_ERRORS[out.error]||"We couldn't connect this wallet. Send /join in your group to get a fresh link.");}
  }catch(e){$("go").disabled=false;show("error",errorText(e));}
}
$("go").onclick=run;
if(!eth)showNoWallet();else if(isMiniPay){$("go").hidden=true;run();}`,
  );
}

type PayOpen = {
  state: "open";
  circleId: string;
  round: number;
  rounds: number;
  circleName: string;
  recipientName: string;
  amount: string;
  amountBase: string;
  token: TokenInfo;
  suffix: string | null;
};

export function payPage(p: PayOpen | { state: "closed" }) {
  if (p.state === "closed") {
    return shell(
      "Round closed · Ajo Circle",
      `<p class="eyebrow">Ajo Circle</p><h1>This round is closed</h1><p class="sub">Check your group for the current round's payment button, or send /status.</p>`,
    );
  }
  const label = `${p.amount} ${p.token.symbol}`;
  const config = {
    circleId: p.circleId,
    round: p.round,
    amountBase: p.amountBase,
    label,
    recipientName: p.recipientName,
    suffix: p.suffix,
    token: { address: p.token.address, decimals: p.token.decimals, symbol: p.token.symbol, minipay: p.token.minipay, feeCurrency: p.token.feeCurrency ?? null },
  };
  return shell(
    `Pay ${label} · ${p.circleName}`,
    `<p class="eyebrow">${esc(p.circleName)} · round ${p.round} of ${p.rounds}</p>
<h1>Pay ${esc(label)} to ${esc(p.recipientName)}</h1>
<p class="sub">It goes straight from your wallet to theirs. Ajo Circle never holds the money.</p>
<div id="status" class="status" data-state="pending" role="status" aria-live="polite"><span id="status-text">Getting things ready…</span></div>
<button id="pay" class="btn" type="button" hidden>Pay ${esc(label)}</button>
${NO_WALLET}`,
    `${WALLET_JS}
const P=${json(config)};
let from,payTo,hash;
const pad=(h)=>h.toLowerCase().replace(/^0x/,"").padStart(64,"0");
const transferData=(to,amount)=>"0xa9059cbb"+pad(to)+BigInt(amount).toString(16).padStart(64,"0");
function fmtUp(v){const d=10n**BigInt(P.token.decimals);const cents=(v*100n+d-1n)/d;return (cents/100n)+"."+(cents%100n).toString().padStart(2,"0");}
async function feeInToken(data){
  try{
    const gas=BigInt(await eth.request({method:"eth_estimateGas",params:[{from,to:P.token.address,data,feeCurrency:P.token.feeCurrency}]}));
    const price=BigInt(await eth.request({method:"eth_gasPrice",params:[P.token.feeCurrency]}));
    const scale=10n**BigInt(18-P.token.decimals); // the adapter prices in 18 decimals
    return (gas*price+scale-1n)/scale;
  }catch{return 10n**BigInt(P.token.decimals)/100n;} // fall back to 0.01
}
async function prepare(){
  if(!P.suffix)return show("error","Payments for this circle aren't open yet. The organiser is still finishing setup.");
  if(!eth)return showNoWallet();
  if(isMiniPay&&!P.token.minipay)return show("error","This circle pays in "+P.token.symbol+", which MiniPay doesn't hold. Open this link in another Celo wallet, such as MetaMask or Valora.");
  try{from=await connect();}catch(e){return show("error",errorText(e));}
  const res=await fetch("/api/pay-check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:P.circleId,round:P.round,address:from})});
  const ctx=await res.json().catch(()=>({state:"closed"}));
  if(ctx.state==="not_member")return show("error","This wallet isn't connected to the circle. Send /join in the group to connect the wallet you pay with.");
  if(ctx.state==="recipient")return show("success","It's your round. You're receiving this time, so there's nothing to pay.");
  if(ctx.state==="paid")return show("success","You've already paid this round. Thank you!");
  if(ctx.state!=="owes")return show("error","This round is closed. Check your group for the current round.");
  payTo=ctx.payTo;
  const balance=BigInt(await eth.request({method:"eth_call",params:[{to:P.token.address,data:"0x70a08231"+pad(from)},"latest"]}));
  let need=BigInt(P.amountBase);
  if(isMiniPay&&P.token.feeCurrency)need+=await feeInToken(transferData(payTo,P.amountBase));
  if(balance<need){
    if(isMiniPay){show("error","You need "+fmtUp(need)+" "+P.token.symbol+", including the network fee. Taking you to Deposit…");setTimeout(()=>{location.href="https://link.minipay.xyz/add_cash?tokens=USDT";},1800);}
    else show("error","You need "+fmtUp(need)+" "+P.token.symbol+" in this wallet to pay your share.");
    return;
  }
  show("idle","Ready. You'll confirm in your wallet.");
  $("pay").hidden=false;
}
async function waitReceipt(h){
  for(let i=0;i<60;i++){
    const r=await eth.request({method:"eth_getTransactionReceipt",params:[h]}).catch(()=>null);
    if(r)return r;
    await new Promise((ok)=>setTimeout(ok,1500));
  }
  return null;
}
async function notifyGroup(){
  for(let i=0;i<3;i++){
    const res=await fetch("/api/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:P.circleId,round:P.round,txHash:hash})}).catch(()=>null);
    if(res&&res.ok)return true;
    await new Promise((ok)=>setTimeout(ok,2000));
  }
  return false;
}
async function finish(){
  show("pending","Payment confirmed. Letting your group know…");
  if(await notifyGroup()){
    $("pay").hidden=true;
    show("success","Paid. "+P.recipientName+" has your "+P.label+".");
    if(isMiniPay)setTimeout(()=>{location.href="https://link.minipay.xyz/receipt?tx="+hash+"&celebrate";},1500);
  }else{
    $("pay").textContent="Tell my group";$("pay").disabled=false;$("pay").onclick=finish;
    show("error","Your payment is confirmed, but we couldn't reach your group. Tap below to try again. Your money has already arrived.");
  }
}
async function pay(){
  $("pay").disabled=true;
  show("pending","Confirm the payment in your wallet…");
  const tx={from,to:P.token.address,data:transferData(payTo,P.amountBase)+P.suffix.slice(2)};
  if(isMiniPay&&P.token.feeCurrency)tx.feeCurrency=P.token.feeCurrency;
  try{hash=await eth.request({method:"eth_sendTransaction",params:[tx]});}
  catch(e){$("pay").disabled=false;return show("error",errorText(e));}
  show("pending","Payment sent. Waiting for the network to confirm…");
  const receipt=await waitReceipt(hash);
  if(!receipt){$("pay").disabled=false;return show("error","The network hasn't confirmed this yet. Check your wallet's activity before paying again.");}
  if(receipt.status!=="0x1"){$("pay").disabled=false;return show("error","The network rejected this payment, so your "+P.token.symbol+" didn't move. Only the network fee was charged. Try again.");}
  await finish();
}
$("pay").onclick=pay;
prepare().catch((e)=>show("error",errorText(e)));`,
  );
}
