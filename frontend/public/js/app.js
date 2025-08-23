// app.js — DCA Bot frontend (EN UI). LOGIC UNCHANGED.
// Imports
import { BrowserProvider, Contract, getAddress } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import { initSDK, createInstance, SepoliaConfig, generateKeypair } from "https://cdn.zama.ai/relayer-sdk-js/0.1.2/relayer-sdk-js.js";

/* ======= Defaults ======= */
const DEFAULTS = {
  CONTRACT: "0x42DaD6cD2A720383340A23d80119C165d56853C7",
  USDC:     "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  RELAYER:  "https://relayer.testnet.zama.cloud",
  GATEWAY:  "https://gateway.sepolia.zama.ai/",
  KMS:      "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
};

/* ======= ABIs ======= */
const erc20Abi = [
  { inputs:[{name:"spender",type:"address"},{name:"value",type:"uint256"}], name:"approve", outputs:[{type:"bool"}], stateMutability:"nonpayable", type:"function" },
  { inputs:[{name:"owner",type:"address"}], name:"balanceOf", outputs:[{type:"uint256"}], stateMutability:"view", type:"function" },
  { inputs:[], name:"decimals", outputs:[{type:"uint8"}], stateMutability:"view", type:"function" }
];

const dcaAbi = [
  { inputs:[{name:"amount",type:"uint256"}], name:"depositUSDC", outputs:[], stateMutability:"nonpayable", type:"function" },
  { inputs:[{name:"amountPerTickExt",type:"bytes32"},{name:"budgetExt",type:"bytes32"},{name:"intervalSec",type:"uint64"},{name:"startTs",type:"uint64"},{name:"proof",type:"bytes"}], name:"submitIntent", outputs:[], stateMutability:"nonpayable", type:"function" },
  { inputs:[{name:"participants",type:"address[]"}], name:"triggerBatch", outputs:[{type:"uint256"}], stateMutability:"nonpayable", type:"function" },
  { inputs:[{name:"user",type:"address"}], name:"getEthBalanceHandle", outputs:[{type:"bytes32"}], stateMutability:"view", type:"function" },
  { inputs:[{name:"id",type:"uint256"}], name:"getBatchInfo", outputs:[{name:"totalHandle",type:"bytes32"},{name:"users",type:"address[]"},
    {name:"requested",type:"bool"},{name:"completed",type:"bool"}], stateMutability:"view", type:"function" },
  { inputs:[{name:"id",type:"uint256"},{name:"totalInUSDC",type:"uint64"}], name:"finalizeBatchWithTotal", outputs:[], stateMutability:"nonpayable", type:"function" },
  { anonymous:false, inputs:[{indexed:true,name:"id",type:"uint256"},{indexed:false,name:"count",type:"uint256"},{indexed:false,name:"totalHandle",type:"bytes32"}], name:"BatchStarted", type:"event" },
  { anonymous:false, inputs:[{indexed:true,name:"id",type:"uint256"},{indexed:false,name:"requestID",type:"uint256"}], name:"BatchTotalDecryptionRequested", type:"event" },
  { anonymous:false, inputs:[{indexed:true,name:"id",type:"uint256"},{indexed:false,name:"totalAmount",type:"uint64"}], name:"BatchTotalDecrypted", type:"event" },
  { anonymous:false, inputs:[{indexed:true,name:"id",type:"uint256"},{indexed:false,name:"amountIn",type:"uint256"},{indexed:false,name:"amountOut",type:"uint256"}], name:"SwapExecuted", type:"event" },
  { anonymous:false, inputs:[{indexed:true,name:"id",type:"uint256"}], name:"Distributed", type:"event" }
];

/* ======= DOM ======= */
const $ = (id) => document.getElementById(id);
let logEl, step = 0;
const log = (m) => {
  if (!logEl) logEl = $("log");
  const txt = `[${++step}] ${m}\n`;
  if (logEl) { logEl.textContent += txt; logEl.scrollTop = logEl.scrollHeight; }
  console.log(m);
};

let ctrI, usdcI, relI, gwI, kmsI, meI, statusEl;
let amtI, budI, intvI, startI, partsI;
let btnConn, btnAppr, btnDep, btnSub, btnTrig, btnGetBal, btnUsr, btnGetBatch, btnPub, btnFin;
let myH, myP, batchI, totH;

/* ======= State ======= */
let provider, signer, user, relayer, dca, usdc;
let lastTotalPublic = null;

/* ======= UI ======= */
function setStatus(txt){ if(!statusEl) statusEl = $("status"); if(statusEl) statusEl.textContent = txt; }
function setDefaults(){
  ctrI.value ||= DEFAULTS.CONTRACT;
  usdcI.value ||= DEFAULTS.USDC;
  relI.value ||= DEFAULTS.RELAYER;
  gwI.value  ||= DEFAULTS.GATEWAY;
  kmsI.value ||= DEFAULTS.KMS;
  startI.value ||= Math.floor(Date.now()/1000);
}

/* ======= Actions ======= */
async function connect(){
  try{
    if(!window.ethereum) throw new Error("MetaMask not found");
    provider = new BrowserProvider(window.ethereum);
    await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId:"0xaa36a7" }] });
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    user   = await signer.getAddress();
    if (meI) meI.value = user;

    await initSDK();
    const relCfg = { ...SepoliaConfig, network: window.ethereum, relayerUrl: relI.value, gatewayUrl: gwI.value, debug: true };
    relayer = await createInstance(relCfg);

    const codeK = await provider.getCode(kmsI.value);
    if(codeK === "0x") throw new Error("KMS not found at the provided address");

    dca  = new Contract(ctrI.value, dcaAbi, signer);
    usdc = new Contract(usdcI.value, erc20Abi, signer);

    setStatus(`✅ Connected: ${user.slice(0,6)}…${user.slice(-4)}`);
    [btnAppr,btnDep,btnSub,btnTrig,btnGetBal,btnUsr,btnGetBatch,btnPub,btnFin].forEach(b=>b && (b.disabled=false));

    dca?.on?.("BatchStarted", (id,count,th)=>{ log(`BatchStarted id=${id} users=${count} handle=${th}`); });
    dca?.on?.("BatchTotalDecryptionRequested", (id,req)=>{ log(`Public total decryption requested id=${id} req=${req}`); });
    dca?.on?.("BatchTotalDecrypted", (id,total)=>{ log(`Public total decrypted id=${id} = ${total}`); });
    dca?.on?.("SwapExecuted", (id,ain,aout)=>{ log(`SwapExecuted id=${id} in=${ain} out=${aout}`); });
    dca?.on?.("Distributed", (id)=>{ log(`Distributed id=${id}`); });

  }catch(e){ setStatus(`❌ ${e.message}`); log(`connect: ${e.message}`); }
}

async function approve(){
  try{
    const dec = await usdc.decimals().catch(()=>6);
    const amt = 10n ** BigInt(dec) * 1_000_000n; // approve 1M
    const tx = await usdc.approve(ctrI.value, amt);
    log(`approve tx=${tx.hash}`); await tx.wait(); log(`approve: done`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`approve: ${e.message}`); }
}

async function deposit(){
  try{
    const v = BigInt(budI.value || "0");
    const tx = await dca.depositUSDC(v);
    log(`deposit tx=${tx.hash}`); await tx.wait(); log(`deposit: done`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`deposit: ${e.message}`); }
}

async function submitIntent(){
  try{
    const amount = BigInt(amtI.value), budget = BigInt(budI.value);
    const interval = BigInt(intvI.value), start = BigInt(startI.value);

    const buf = relayer.createEncryptedInput(getAddress(ctrI.value), getAddress(user));
    buf.add64(amount); buf.add64(budget);
    const { handles, inputProof } = await buf.encrypt();

    const tx = await dca.submitIntent(handles[0], handles[1], interval, start, inputProof, { gasLimit: 3_000_000 });
    log(`submitIntent tx=${tx.hash}`); await tx.wait(); log(`intent stored`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`submitIntent: ${e.message}`); }
}

async function triggerBatch(){
  try{
    const list = (partsI.value||"").split(",").map(s=>s.trim()).filter(Boolean);
    const tx = await dca.triggerBatch(list);
    log(`triggerBatch tx=${tx.hash}`); await tx.wait(); log(`batch triggered`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`trigger: ${e.message}`); }
}

async function getMyBalance(){
  try{
    const h = await dca.getEthBalanceHandle(user);
    if (myH) myH.value = h;
    log(`my balance handle: ${h}`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`getBal: ${e.message}`); }
}

async function userDecrypt(){
  try{
    if(!myH?.value) throw new Error("no balance handle — click “Get My Balance” first");
    const kp = await generateKeypair();
    const startTs = Math.floor(Date.now()/1000).toString();
    const days = "7";
    const eip = relayer.createEIP712(kp.publicKey, [ctrI.value], startTs, days);
    const sig = await signer.signTypedData(
      eip.domain,
      { UserDecryptRequestVerification: eip.types.UserDecryptRequestVerification },
      eip.message
    );
    const out = await relayer.userDecrypt(
      [{ handle: myH.value, contractAddress: ctrI.value }],
      kp.privateKey,
      kp.publicKey,
      sig.replace("0x",""),
      [ctrI.value],
      user,
      startTs,
      days
    );
    const val = Array.isArray(out) ? out[0] : (out[myH.value] ?? out[String(myH.value)]);
    if (myP) myP.value = typeof val === "bigint" ? val.toString() : String(val);
    log(`user decrypt = ${myP?.value}`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`userDecrypt: ${e.message}`); }
}

async function getBatchInfo(){
  try{
    const id = Number(batchI.value); if(!id) throw new Error("batch id is required");
    const info = await dca.getBatchInfo(id);
    if (totH) totH.value = info.totalHandle;
    log(`batch #${id}: users=${info.users.length} requested=${info.requested} completed=${info.completed}`);
  }catch(e){ setStatus(`❌ ${e.message}`); log(`getBatch: ${e.message}`); }
}

async function publicDecryptTotal(){
  try{
    if(!totH?.value) throw new Error("no total handle — click “Get Batch Info” first");
    const out = await relayer.publicDecrypt([totH.value]);
    const v = Array.isArray(out) ? out[0] : (out[totH.value] ?? out[String(totH.value)]);
    const vv = (typeof v === "bigint") ? v : BigInt(v);
    lastTotalPublic = vv;
    alert(`Decrypted totalIn (USDC units): ${vv.toString()}`);
    log(`publicDecrypt total=${vv}`);

    if (!btnFin || btnFin instanceof HTMLElement && btnFin.offsetParent === null) {
      if (confirm("Finalize this batch now?")) {
        await finalizeBatchFromFrontend();
      }
    }
  }catch(e){ setStatus(`❌ ${e.message}`); log(`publicDecrypt: ${e.message}`); }
}

async function finalizeBatchFromFrontend(){
  try{
    const id = Number(batchI.value);
    if(!id) throw new Error("batch id is required");
    let total = lastTotalPublic;

    if (total == null) {
      if(!totH?.value) throw new Error("no total handle — click “Get Batch Info” first");
      const out = await relayer.publicDecrypt([totH.value]);
      const v = Array.isArray(out) ? out[0] : (out[totH.value] ?? out[String(totH.value)]);
      total = (typeof v === "bigint") ? v : BigInt(v);
    }

    if (total < 0n || total > 18446744073709551615n) throw new Error("total does not fit into uint64");

    const tx = await dca.finalizeBatchWithTotal(id, total, { gasLimit: 3_000_000 });
    log(`finalize tx=${tx.hash}`);
    await tx.wait();
    log("finalization done ✅");
    setStatus(`✅ Finalized batch #${id}`);

    const info = await dca.getBatchInfo(id);
    log(`batch #${id}: users=${info.users.length} requested=${info.requested} completed=${info.completed}`);
  }catch(e){
    setStatus(`❌ ${e.message}`);
    log(`finalize: ${e.message}`);
  }
}

/* ======= Wiring ======= */
function bind(){
  ctrI = $("ctr"); usdcI = $("usdc"); relI = $("relayer"); gwI = $("gateway"); kmsI = $("kms"); meI = $("me");
  statusEl = $("status");
  amtI = $("amt"); budI = $("bud"); intvI = $("intv"); startI = $("start"); partsI = $("parts");
  btnConn = $("btnConnect"); btnAppr = $("btnApprove"); btnDep = $("btnDeposit"); btnSub = $("btnSubmit"); btnTrig = $("btnTrigger");
  btnGetBal = $("btnGetBal"); btnUsr = $("btnUserDecrypt"); btnGetBatch = $("btnGetBatch"); btnPub = $("btnPublicDecrypt");
  btnFin = $("btnFinalize");
  myH = $("myHandle"); myP = $("myPlain"); batchI = $("batchId"); totH = $("totalHandle");
  logEl = $("log");

  btnConn?.addEventListener?.("click", connect);
  btnAppr?.addEventListener?.("click", approve);
  btnDep ?.addEventListener?.("click", deposit);
  btnSub ?.addEventListener?.("click", submitIntent);
  btnTrig?.addEventListener?.("click", triggerBatch);
  btnGetBal?.addEventListener?.("click", getMyBalance);
  btnUsr?.addEventListener?.("click", userDecrypt);
  btnGetBatch?.addEventListener?.("click", getBatchInfo);
  btnPub?.addEventListener?.("click", publicDecryptTotal);
  btnFin?.addEventListener?.("click", finalizeBatchFromFrontend);
}

function hydrate(){
  try { bind(); setDefaults(); setStatus("Waiting…"); }
  catch (e) { console.error("hydrate error:", e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hydrate, { once: true });
} else {
  hydrate();
}
