import { ethers } from "ethers";
import { Pool } from "@uniswap/v3-sdk";
import { CurrencyAmount, Token } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";

interface SwapData {
  sender: string;
  recipient: string;
  amountIn: ethers.BigNumberish; // Using BigintIsh type for compatibility with ethers and Uniswap SDK types
  amountOut: ethers.BigNumberish; // Using BigintIsh
  transactionHash: string;
  zeroForOne: boolean; // Indicates the direction of the swap
  price: string; // The price after the swap, represented as a string for simplicity
  currencySymbolIn: string; // Symbol of the input currency
  currencySymbolOut: string; // Symbol of the output currency
}

const provider = new ethers.providers.WebSocketProvider(
  "wss://eth-mainnet.g.alchemy.com/v2/"
);
const tokenAddress1 = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // DAI token address
const tokenAddress2 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH token address
const poolFee = 3000; // 0.3% pool fee

const token1 = new Token(1, tokenAddress1, 18, "DAI", "Dai Stablecoin");
const token2 = new Token(1, tokenAddress2, 18, "WETH", "Wrapped Ether");
const poolAddress = Pool.getAddress(token1, token2, poolFee);
const poolContract = new ethers.Contract(
  poolAddress,
  IUniswapV3PoolABI,
  provider
);

async function findApproxBlockByTimestamp(timestamp: number): Promise<number> {
  const currentBlockNumber = await provider.getBlockNumber();
  const currentBlock = await provider.getBlock(currentBlockNumber);
  const currentTimestamp = currentBlock.timestamp;

  // Estimate the difference in blocks based on the average block time of ~14 seconds
  const secondsDifference = currentTimestamp - timestamp;
  const estimatedBlocksAgo = Math.floor(secondsDifference / 14);

  // Calculate the estimated block number
  return Math.max(currentBlockNumber - estimatedBlocksAgo, 0);
}

async function* handleSwaps(
  fromBlock: number,
  toBlock: string | number = "latest"
) {
    console.time('FetchAllHistoricalSwaps'); // Start timer
  let currentFetchingBlock = fromBlock;
  let currentBlock = await provider.getBlockNumber();
  let isCatchingUp = true;

  // Adjust if 'toBlock' is less than the current latest block
  if (toBlock !== "latest" && typeof toBlock === "number" && toBlock < currentBlock) {
    currentBlock = toBlock;
  }

  while (isCatchingUp) {
    // If 'toBlock' is 'latest' or a specific number, keep updating 'currentBlock' to catch up to the blockchain's current state
    if (toBlock === "latest" || currentFetchingBlock <= toBlock) {
      currentBlock = await provider.getBlockNumber();
    }
    
    // Fetch and yield swaps up to 'currentBlock'
    for await (const swap of getHistoricalSwaps(poolAddress, currentFetchingBlock, currentBlock)) {
      yield swap;
    }

    // After catching up to the most recent block, transition to real-time monitoring
    if (currentFetchingBlock > currentBlock || currentFetchingBlock === toBlock) {
      isCatchingUp = false; // Stop the loop if caught up or reached the 'toBlock' limit
    } else {
      // Prepare to fetch the next set of blocks
      currentFetchingBlock = currentBlock + 1;
    }
  }

    console.timeEnd('FetchAllHistoricalSwaps'); // End timer and log the time

  // Monitor real-time swaps after catching up
  for await (const swap of monitorRealTimeSwaps()) {
    yield swap;
  }
}

async function* getHistoricalSwaps(
  poolAddress: string,
  fromBlock: number,
  toBlock: number,
  chunkSize: number = 2000
) {
  console.log(
    "Fetching historical swaps from block:",
    fromBlock,
    "to block:",
    toBlock
  );

  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI,
    provider
  );
  const filter = poolContract.filters.Swap();

  for (let block = fromBlock; block <= toBlock; block += chunkSize) {
    const endBlock = Math.min(block + chunkSize - 1, toBlock);

    try {
      const logs = await provider.getLogs({
        fromBlock: block,
        toBlock: endBlock,
        address: poolAddress,
        topics: filter.topics,
      });

      for (const log of logs) {
        const parsedLog = poolContract.interface.parseLog(log);
        const amount0 = parsedLog.args.amount0;
        const amount1 = parsedLog.args.amount1;

        const zeroForOne = parsedLog.args.amount0.gt(0);

        const amountIn: ethers.BigNumberish = zeroForOne ? amount0 : amount1;
        const amountOut: ethers.BigNumberish = zeroForOne ? amount1 : amount0;

        // Create CurrencyAmount instances for the input and output amounts
        const currencyAmountIn = CurrencyAmount.fromRawAmount(
          zeroForOne ? token1 : token2,
          amountIn
        );
        const currencyAmountOut = CurrencyAmount.fromRawAmount(
          zeroForOne ? token2 : token1,
          amountOut
        );
        // Assuming you have a method to calculate the price or you may leave it as a placeholder
        const price = zeroForOne
          ? currencyAmountOut.divide(currencyAmountIn)
          : currencyAmountIn.divide(currencyAmountOut);

        const swapData: SwapData = {
          sender: parsedLog.args.sender,
          recipient: parsedLog.args.recipient,
          amountIn: amountIn,
          amountOut: amountOut,
          transactionHash: log.transactionHash,
          zeroForOne: zeroForOne,
          price: price.toSignificant(6), // Ensure this is converted to a string appropriately
          currencySymbolIn: zeroForOne ? token1.symbol : token2.symbol,
          currencySymbolOut: zeroForOne ? token2.symbol : token1.symbol,
        };

        yield swapData; // Yielding each swap as SwapData
      }

      console.log(
        `Fetched ${logs.length} swaps from blocks ${block} to ${endBlock}.`
      );
    } catch (error) {
      console.error(
        `Error fetching swaps from blocks ${block} to ${endBlock}:`,
        error
      );
    }
  }
}

async function* monitorRealTimeSwaps() {
  console.log("Monitoring real-time swaps");
  let queue = [];
  poolContract.on(
    "Swap",
    async (
      sender,
      recipient,
      amount0,
      amount1,
      sqrtPriceX96,
      liquidity,
      tick,
      event
    ) => {
      const transactionHash = event.transactionHash;

      const zeroForOne = amount0.gt(0);
      const amountIn: ethers.BigNumberish = zeroForOne ? amount0 : amount1;
      const amountOut: ethers.BigNumberish = zeroForOne ? amount1 : amount0;

      // Create CurrencyAmount instances for the input and output amounts
      const currencyAmountIn = CurrencyAmount.fromRawAmount(
        zeroForOne ? token1 : token2,
        amountIn
      );
      const currencyAmountOut = CurrencyAmount.fromRawAmount(
        zeroForOne ? token2 : token1,
        amountOut
      );

      // Assuming you have a way to convert BigNumberish to a string that represents the price
      // This could be more complex depending on how you calculate the price
      const price = zeroForOne
        ? currencyAmountOut.divide(currencyAmountIn)
        : currencyAmountIn.divide(currencyAmountOut);

      const swapData: SwapData = {
        sender: sender,
        recipient: recipient,
        amountIn: amountIn,
        amountOut: amountOut,
        transactionHash: transactionHash,
        zeroForOne: zeroForOne,
        price: price.toSignificant(6),
        currencySymbolIn: zeroForOne ? token1.symbol : token2.symbol,
        currencySymbolOut: zeroForOne ? token2.symbol : token1.symbol,
      };

      queue.push(event);
    }
  );

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift(); // Yield events one by one as they come
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for new events
      }
    }
  } finally {
    poolContract.off("Swap", listener); // Clean up listener when done
  }
}

async function main() {
  const fromBlock = await findApproxBlockByTimestamp(
    Math.floor(Date.now() / 1000) - 60 * 60 * 24 // 24 hours ago
  ); // 1 hours ago
  for await (const swap of handleSwaps(fromBlock, "latest")) {
    console.log("Swap detected:", swap.transactionHash);
  }
}

main().catch(console.error);
