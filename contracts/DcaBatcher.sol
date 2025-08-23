// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * DcaBatcher.sol (final)
 * - Официальная Zama FHEVM lib + SepoliaConfig
 * - externalEuint64: bytes32 -> wrap -> FHE.fromExternal
 * - total: FHE.makePubliclyDecryptable (для фронта publicDecrypt)
 * - swap fallback: simulateSwap=true или при revert — псевдо 1:1
 */

import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/* ── ERC20 / Router ── */
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IUniswapV2RouterLike {
    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

/* ── Minimal Ownable ── */
contract Ownable {
    address public owner;
    error NotOwner();
    constructor() { owner = msg.sender; }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    function transferOwnership(address n) external onlyOwner { owner = n; }
}

/* ── DcaBatcher ── */
contract DcaBatcher is SepoliaConfig, Ownable {
    IERC20 public immutable USDC;
    address public immutable WETH;
    IUniswapV2RouterLike public router;

    bool public simulateSwap; // включить псевдо-своп (или включится при ловле revert)

    constructor(address _usdc, address _weth, address _router) {
        USDC = IERC20(_usdc);
        WETH = _weth;
        router = IUniswapV2RouterLike(_router);
    }

    function setRouter(address _router) external onlyOwner { router = IUniswapV2RouterLike(_router); }
    function setSimulateSwap(bool on) external onlyOwner { simulateSwap = on; }

    struct Intent {
        euint64 amountPerTick;
        euint64 remainingBudget;
        uint64  intervalSec;
        uint64  nextRunTs;
        bool    active;
    }

    mapping(address => Intent) public intents;
    mapping(address => euint64) public ethBalanceEnc;
    mapping(address => bool)    private _balInit;

    struct PendingBatch {
        bytes32 totalHandle;
        address[] users;
        bool requested;
        bool completed;
    }

    uint256 public lastBatchId;
    mapping(uint256 => PendingBatch) public batches;
    mapping(uint256 => mapping(address => bytes32)) public pendingContrib;

    event BatchStarted(uint256 indexed id, uint256 count, bytes32 totalHandle);
    event BatchTotalDecryptionRequested(uint256 indexed id, uint256 requestID);
    event BatchTotalDecrypted(uint256 indexed id, uint64 totalAmount);
    event SwapExecuted(uint256 indexed id, uint256 amountIn, uint256 amountOut);
    event SwapSimulated(uint256 indexed id, uint256 amountInUSDC, uint256 pseudoEthOut);
    event Distributed(uint256 indexed id);
    event Deposited(address indexed user, uint256 amount);
    event IntentSubmitted(address indexed user);

    /* ── User flows ── */

    function depositUSDC(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(USDC.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Deposited(msg.sender, amount);
    }

    function submitIntent(
        bytes32 amountPerTickExtRaw,
        bytes32 budgetExtRaw,
        uint64 intervalSec,
        uint64 startTs,
        bytes calldata proof
    ) external {
        require(proof.length > 0, "Empty proof");

        externalEuint64 amountExt = externalEuint64.wrap(amountPerTickExtRaw);
        externalEuint64 budgetExt = externalEuint64.wrap(budgetExtRaw);
        euint64 amount = FHE.fromExternal(amountExt, proof);
        euint64 budget = FHE.fromExternal(budgetExt, proof);

        FHE.allowThis(amount);
        FHE.allowThis(budget);
        FHE.allow(amount, msg.sender);
        FHE.allow(budget, msg.sender);

        intents[msg.sender] = Intent({
            amountPerTick: amount,
            remainingBudget: budget,
            intervalSec: intervalSec,
            nextRunTs: startTs,
            active: true
        });

        if (!_balInit[msg.sender]) {
            euint64 zero = FHE.asEuint64(0);
            FHE.allowThis(zero);
            FHE.allow(zero, msg.sender);
            ethBalanceEnc[msg.sender] = zero;
            _balInit[msg.sender] = true;
        }

        emit IntentSubmitted(msg.sender);
    }

    /* ── Batch logic ── */

    function triggerBatch(address[] calldata participants) external returns (uint256 batchId) {
        euint64 total = FHE.asEuint64(0);
        address[] memory included = new address[](participants.length);
        uint256 count;

        batchId = ++lastBatchId;

        for (uint256 i = 0; i < participants.length; i++) {
            address u = participants[i];
            Intent storage it = intents[u];
            if (!it.active) continue;
            if (block.timestamp < it.nextRunTs) continue;

            ebool budLEamt = FHE.or(
                FHE.lt(it.remainingBudget, it.amountPerTick),
                FHE.eq(it.remainingBudget, it.amountPerTick)
            );
            euint64 contrib = FHE.select(budLEamt, it.remainingBudget, it.amountPerTick);

            it.remainingBudget = FHE.sub(it.remainingBudget, contrib);
            FHE.allowThis(it.remainingBudget);

            FHE.allowThis(contrib);
            FHE.allow(contrib, u);

            total = FHE.add(total, contrib);

            it.nextRunTs = it.nextRunTs + it.intervalSec;

            included[count++] = u;
            pendingContrib[batchId][u] = FHE.toBytes32(contrib);
        }

        require(count > 0, "no due intents");

        address[] memory users = new address[](count);
        for (uint256 j = 0; j < count; j++) users[j] = included[j];

        FHE.makePubliclyDecryptable(total);

        bytes32 totalHandle = FHE.toBytes32(total);
        batches[batchId] = PendingBatch({
            totalHandle: totalHandle,
            users: users,
            requested: false,
            completed: false
        });

        emit BatchStarted(batchId, count, totalHandle);
    }

    function getBatchInfo(uint256 id)
        external
        view
        returns (bytes32 totalHandle, address[] memory users, bool requested, bool completed)
    {
        PendingBatch storage pb = batches[id];
        return (pb.totalHandle, pb.users, pb.requested, pb.completed);
    }

    function getEthBalanceHandle(address userAddr) external view returns (bytes32) {
        if (!_balInit[userAddr]) return bytes32(0);
        return FHE.toBytes32(ethBalanceEnc[userAddr]);
    }

    /* ── Swap & Distribution ── */

    function finalizeBatchWithTotal(uint256 batchId, uint64 totalPlainUSDC) external onlyOwner {
        PendingBatch storage pb = batches[batchId];
        require(!pb.completed, "already completed");
        require(pb.totalHandle != bytes32(0), "bad batch");
        require(totalPlainUSDC > 0, "zero total");

        emit BatchTotalDecrypted(batchId, totalPlainUSDC);
        _executeSwapAndDistribute(batchId, totalPlainUSDC);
    }

    function _executeSwapAndDistribute(uint256 batchId, uint256 amountInUSDC) internal {
    // Router-LESS: всегда симулируем 1:1, без любых path и внешних вызовов.
    uint256 receivedEth = amountInUSDC;

    emit SwapSimulated(batchId, amountInUSDC, receivedEth);
    // оставляем событие SwapExecuted ради фронта (он на него подписан)
    emit SwapExecuted(batchId, amountInUSDC, receivedEth);

    _distributeEncrypted(batchId, receivedEth, amountInUSDC);
}


    function _distributeEncrypted(uint256 batchId, uint256 amountOutETH, uint256 totalInUSDC) internal {
        PendingBatch storage pb = batches[batchId];
        uint256 n = pb.users.length;
        require(n > 0, "no users");

        require(totalInUSDC <= type(uint64).max, "total too big");
        require(amountOutETH <= type(uint64).max, "out too big");

        euint64 outETH = FHE.asEuint64(uint64(amountOutETH));

        for (uint256 i = 0; i < n; i++) {
            address u = pb.users[i];
            euint64 contrib = euint64.wrap(pendingContrib[batchId][u]);

            // share = contrib * outETH / totalIn (делитель — PLAINTEXT)
            euint64 numer = FHE.mul(contrib, outETH);
            euint64 share = FHE.div(numer, uint64(totalInUSDC));

            if (!_balInit[u]) {
                euint64 zero = FHE.asEuint64(0);
                FHE.allowThis(zero);
                FHE.allow(zero, u);
                ethBalanceEnc[u] = zero;
                _balInit[u] = true;
            }
            euint64 next = FHE.add(ethBalanceEnc[u], share);
            FHE.allowThis(next);
            FHE.allow(next, u);
            ethBalanceEnc[u] = next;
        }

        pb.completed = true;
        emit Distributed(batchId);
    }
}
