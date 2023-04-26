import cli from "cli";
import fs from "fs/promises";
import random from "lodash/random";
import round from "lodash/round";
import { ethers, formatEther, parseEther } from "ethers";
import bridgeAbi from "./abi/bridge";
import quoterAbi from "./abi/quoter";
import oftAbi from "./abi/oft";
import { delay } from "./utils";

const RPC_URL = "https://arb1.arbitrum.io/rpc";

const FILENAME = "keys.txt";

const BRIDGE_ADDRESS = "0x0A9f824C05A74F577A536A8A0c673183a872Dff4";
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const OFT_ADDRESS = "0xdD69DB25F6D620A7baD3023c5d32761D353D3De9";
const WETH_ADDRESS = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const GOERLIETH_ADDRESS = "0xdd69db25f6d620a7bad3023c5d32761d353d3de9";
const SLIPPAGE = 5n; // 5%

const provider = new ethers.JsonRpcProvider(RPC_URL);

async function bridge(key: string) {
  const wallet = new ethers.Wallet(key, provider);

  const quoterContract = new ethers.Contract(QUOTER_ADDRESS, quoterAbi, wallet);
  const bridgeContract = new ethers.Contract(BRIDGE_ADDRESS, bridgeAbi, wallet);
  const oftContract = new ethers.Contract(OFT_ADDRESS, oftAbi, wallet);

  const poolFee = await bridgeContract.poolFee();

  // ETH в сети Arbitrum который будет обменен на GOERLIETH
  // случайное число от 0.001 до 0.0016
  const randomValue = random(0.0002, 0.00033);

  // округляем оставляя 4 знака после запятой,
  // чтобы значения 0.0013720921111392634 сделать 0.0013
  const value = round(randomValue, 5);

  const amount = parseEther(value.toString());

  const quotedAmountOut: bigint = await quoterContract.quoteExactInputSingle
    .staticCall(
      WETH_ADDRESS,
      GOERLIETH_ADDRESS,
      poolFee,
      amount,
      0,
    );

  const amountOutMin = quotedAmountOut - (quotedAmountOut * SLIPPAGE) / 100n;

  const oft = await oftContract.estimateSendFee(
    154,
    wallet.address,
    amount,
    false,
    "0x",
  );

  const [nativeFee] = oft;
  const valueAndFee = amount + nativeFee * 3n;

  const txArgs = [
    amount,
    amountOutMin,
    154,
    wallet.address,
    wallet.address,
    "0x0000000000000000000000000000000000000000",
    "0x",
  ];

  const gasLimit = await bridgeContract.swapAndBridge.estimateGas(...txArgs, {
    value: valueAndFee,
  });

  const unsignedTx = await bridgeContract.swapAndBridge.populateTransaction(...txArgs, {
    value: valueAndFee,
  });

  console.log(`Wallet address: ${wallet.address}`);
  console.log(`Swap ${formatEther(amount)} ETH for ${formatEther(amountOutMin)} GOERLIETH`);
  console.log(`Total (include bridge and swap fees): ${formatEther(valueAndFee)} ETH`);

  const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData();

  cli.spinner("Send transaction");
  const tx = await wallet.sendTransaction({
    ...unsignedTx,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
  });

  await provider.waitForTransaction(tx.hash);
  cli.spinner(`https://arbiscan.io/tx/${tx.hash}`, true);
  console.log(`https://layerzeroscan.com/tx/${tx.hash}`);
}

const file = await fs.readFile(FILENAME, { encoding: "utf8" });
const keys = file.split("\n").filter(Boolean).map((item) => item.trim());
const lastKey = [...keys].pop();

for (const key of keys) {
  await bridge(key);

  if (key !== lastKey) {
    // Интервал задержки между каждым бриджем, случайное число от 100 до 300 секунд
    const delayTimeout = random(400, 700);
    await delay(delayTimeout);
  }
}
