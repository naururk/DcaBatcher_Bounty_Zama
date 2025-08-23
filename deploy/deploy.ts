import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/** +30% к рекомендации или фолбек (gwei → wei) */
const bump = (v: bigint | null | undefined, fallbackGwei: number) =>
  v && v > 0n ? (v * 13n) / 10n : BigInt(Math.floor(fallbackGwei)) * 10n ** 9n;

const requireAddress = (name: string): string => {
  const v = process.env[name];
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) {
    throw new Error(
      `ENV ${name} is required and must be a valid address (got: ${v ?? "undefined"})`
    );
  }
  return v;
};

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts, artifacts, ethers, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  // ---- параметры конструктора ----
  const USDC_ADDRESS   = requireAddress("USDC_ADDRESS");
  const WETH_ADDRESS   = requireAddress("WETH_ADDRESS");
  const ROUTER_ADDRESS = requireAddress("ROUTER_ADDRESS");

  // Просто для наглядного лога (как у тебя)
  const art = await artifacts.readArtifact("DcaBatcher");
  const ctor = (art.abi as any[]).find((x) => x.type === "constructor");
  log(`Contract: DcaBatcher | Constructor inputs: ${ctor?.inputs?.length ?? 0}`);
  log(`Args: [USDC=${USDC_ADDRESS}, WETH=${WETH_ADDRESS}, Router=${ROUTER_ADDRESS}]`);
  log(`Network: ${network.name}`);

  // 1) газовые рекомендации
  const fee = await ethers.provider.getFeeData(); // { maxFeePerGas, maxPriorityFeePerGas }

  // 2) оверрайды + pending nonce
  const overrides = {
    maxFeePerGas: bump(fee.maxFeePerGas, 60),       // ~60 gwei фолбек
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas, 3), // ~3 gwei фолбек
    nonce: await ethers.provider.getTransactionCount(deployer, "pending"),
    // type: 2, // hardhat сам поставит 1559
  } as const;

  // 3) деплой
  const d = await deploy("DcaBatcher", {
    from: deployer,
    args: [USDC_ADDRESS, WETH_ADDRESS, ROUTER_ADDRESS],
    log: true,
    waitConfirmations: 2,
    ...overrides,
  });

  log(`✅ DcaBatcher deployed at: ${d.address}`);
};

export default func;
func.id = "deploy_DcaBatcher";
func.tags = ["DcaBatcher"];
