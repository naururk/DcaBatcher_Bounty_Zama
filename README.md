# Private DCA Bot (FHEVM)

An FHE-powered Dollar-Cost Averaging (DCA) bot for **Sepolia**. Users deposit testnet **USDC**, submit **private DCA intents** (amount per tick & total budget encrypted on-chain), and periodically trigger batches. Each batch produces an **encrypted total** that the UI can publicly decrypt via Zama’s Relayer/Gateway. After decryption, the front-end can **finalize** the batch (swap USDC→ETH through a Uniswap V2 router) and **distribute ETH proportionally** to all participants—balances stay encrypted.

> **Contract:** `DcaBatcher`
> **Frontend:** `index.html` + `js/app.js` (Ethers v6, Zama Relayer SDK 0.1.2)

---

## ✨ Features

* **Private intents** — `amountPerTick` and `remainingBudget` are stored as encrypted `euint64`.
* **Scheduling** — each intent holds `intervalSec` and `nextRunTs`; `triggerBatch()` includes only due users.
* **Encrypted aggregation** — the batch total is computed as an encrypted sum; UI can **publicly decrypt** it.
* **Swap & distribution** — `finalizeBatchWithTotal(id, total)` swaps USDC→ETH and distributes ETH **proportionally** to encrypted contributions.
* **User decrypt UX** — a user can decrypt **only their own** encrypted ETH handle via Relayer (EIP-712 flow).
* **Clean UI** — one-page app, tooltips, and a debug console.

---

## 🧩 Contract quick tour

**File:** `contracts/DcaBatcher.sol`

* **Key types:** `euint64`, `ebool`, `externalEuint64` from Zama FHEVM.
* **Storage:**

  * `intents[user]` → `{ amountPerTick (enc), remainingBudget (enc), intervalSec, nextRunTs, active }`
  * `ethBalanceEnc[user]` → encrypted ETH balance
  * `batches[id]` → `{ totalHandle, users[], requested, completed }`
* **Core functions:**

  * `depositUSDC(uint amount)` — pull approved USDC from sender
  * `submitIntent(bytes32 amountExt, bytes32 budgetExt, uint64 intervalSec, uint64 startTs, bytes proof)` — store/update encrypted DCA intent
  * `triggerBatch(address[] participants) → id` — includes due users, aggregates encrypted total, marks it publicly decryptable, stores `totalHandle`
  * `getBatchInfo(uint id) → (bytes32 totalHandle, address[] users, bool requested, bool completed)` — UI reads `totalHandle`
  * `getEthBalanceHandle(address user) → bytes32` — user can decrypt their own handle via Relayer
  * `finalizeBatchWithTotal(uint256 id, uint64 totalPlainUSDC)` — swap & distribute using plaintext total from public decryption

**Distribution math:** for each user, `share = contrib * totalETH / totalUSDC`. The divisor is the plaintext total; all shares remain encrypted on-chain.

---

## 🖥️ Frontend

**Tech:** Ethers v6 (CDN ESM), Zama Relayer SDK 0.1.2 (CDN), vanilla HTML/CSS.
**Files:** `index.html`, `js/app.js` (tooltips, connect, encrypt/decrypt, contract calls).

### Typical flow in the UI

1. **Connect** MetaMask (auto-switches to Sepolia).
2. **Approve USDC** for the contract.
3. **Deposit USDC** (moves test USDC into the contract).
4. **Submit Intent** (encrypts amount-per-tick & total budget; sets interval & start).
5. **Trigger Batch** (provide a candidate list; contract picks only due users).
6. **Get Batch Info** and **Public Decrypt Total** (Relayer returns total in USDC units).
7. **Finalize Batch** (front-end calls contract with the decrypted total).
8. *(Optional)* **User Decrypt** encrypted ETH balance handle to view locally.

---

## 📦 Project structure

```
frontend/
  public/
    index.html
    js/
      app.js            # UI + Ethers + Relayer SDK
contracts/
  DcaBatcher.sol        # FHEVM DCA contract
deploy/
  deploy.ts             # Hardhat deploy (reads .env)
hardhat.config.ts
.env.example
```

---

## 🔧 Requirements

* Node.js 18+ (for local static server or Hardhat tasks)
* MetaMask (or compatible wallet)
* Sepolia ETH (gas)
* Zama FHEVM **KMS**, **Relayer**, and **Gateway** endpoints

---

## 🔑 Sepolia addresses (defaults in UI)

* **DcaBatcher:** `0x099FCB85Dbc8eBAC2BF5DF8d14d9F91092804D55`
* **USDC:** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
* **WETH:** `0xfff9976782d46cc05630d1f6ebab18b2324d6b14`
* **Uniswap V2 Router:** `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`
* **KMS:** `0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC`
* **Relayer:** `https://relayer.testnet.zama.cloud`
* **Gateway:** `https://gateway.sepolia.zama.ai/`

---

## 🚀 Install → Deploy → Run

### 1) Clone & install

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
npm install
```

### 2) Configure environment

Create `.env` (copy `.env.example`) and fill:

```ini
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<project-id>
DEPLOYER_PRIVATE_KEY=0xYourDeployerPrivateKey

USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
WETH_ADDRESS=0xfff9976782d46cc05630d1f6ebab18b2324d6b14
ROUTER_ADDRESS=0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3
```

> You can also hard-code addresses in the UI (`index.html` / `js/app.js`) if you prefer.

### 3) Deploy (optional)

```bash
npx hardhat compile
npx hardhat deploy --network sepolia
```

The script prints the deployed `DcaBatcher` address.

### 4) Run the app

Serve `frontend/public` with any static server (or open `index.html` directly):

```bash
npx http-server frontend/public -p 3002
```

Open `http://localhost:3002` and follow the flow: Connect → Approve → Deposit → Submit Intent → Trigger Batch → Get Batch Info → Public Decrypt → **Finalize**.

---

## 🧪 Troubleshooting

* **`ERC20: transfer amount exceeds balance` on Deposit** — get Sepolia test **USDC**, then Approve and Deposit a small amount.
* **Finalize reverts** — ensure a batch was triggered, you fetched `totalHandle`, publicly decrypted the total, and you’re finalizing the **correct batch id**.
* **Wrong network** — UI attempts to switch to Sepolia; add it to MetaMask if needed.
* **Relayer/Gateway** — make sure URLs are reachable and cross-origin isolation headers (COOP/COEP) are not blocked.

---

## 🗺️ Roadmap

* Job/automation for periodic finalize
* UI slippage settings for the swap
* Additional settlement tokens (WETH/ERC‑20 pairs)
* More intent types (end date, skip ticks)

---

## 🔒 Security

This is experimental testnet code and **not audited**. Do **not** use with mainnet funds.

---

## 🙌 Acknowledgements

* **Zama FHEVM & Relayer SDK**
* **Ethers.js**

---

## 📄 License

MIT — see `LICENSE`.

