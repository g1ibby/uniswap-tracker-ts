import { ethers } from 'ethers';
import { Pool } from '@uniswap/v3-sdk';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';

const provider = new ethers.providers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/');

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

async function getHistoricalSwaps(poolAddress: string, fromBlock: number, toBlock: number, chunkSize: number = 2000) {
  console.time('FetchAllHistoricalSwaps'); // Start timer
  console.log('Fetching historical swaps from block:', fromBlock, 'to block:', toBlock);

  const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider);
  const filter = poolContract.filters.Swap();
  let allSwaps = [];

  for (let block = fromBlock; block < toBlock; block += chunkSize) {
    const endBlock = Math.min(block + chunkSize - 1, toBlock);

    try {
      const logs = await provider.getLogs({
        fromBlock: block,
        toBlock: endBlock,
        address: poolAddress,
        topics: filter.topics,
      });

      const swaps = logs.map(log => {
        const parsedLog = poolContract.interface.parseLog(log);
        return {
          sender: parsedLog.args.sender,
          recipient: parsedLog.args.recipient,
          amount0: parsedLog.args.amount0.toString(),
          amount1: parsedLog.args.amount1.toString(),
          transactionHash: log.transactionHash,
        };
      });

      allSwaps.push(...swaps);
      console.log(`Fetched ${swaps.length} swaps from blocks ${block} to ${endBlock}.`);
    } catch (error) {
      console.error(`Error fetching swaps from blocks ${block} to ${endBlock}:`, error);
      // Optional: Implement retry logic here
    }
  }

        console.timeEnd('FetchAllHistoricalSwaps'); // End timer and log the time

  return allSwaps;
}

// Define the token addresses and pool fee
const tokenAddress1 = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // DAI token address
const tokenAddress2 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH token address
const poolFee = 3000; // 0.3% pool fee

const token1 = new Token(1, tokenAddress1, 18, 'DAI', 'Dai Stablecoin');
const token2 = new Token(1, tokenAddress2, 18, 'WETH', 'Wrapped Ether');
const poolAddress = Pool.getAddress(token1, token2, poolFee);
console.log('Pool Address:', poolAddress);

const fromTimestamp = Math.floor(Date.now() / 1000) - 60 * 60 * 48; // 2 hours ago
const fromBlock = await findApproxBlockByTimestamp(fromTimestamp);
const currentBlockNumber = await provider.getBlockNumber();

// test
const fromBlockTest = 19577616 
const currentBlockNumberTest = 19589958

getHistoricalSwaps(poolAddress, fromBlockTest, currentBlockNumberTest)
  .then((swaps) => {
        console.log("finished")
    /* console.log('Historical Swaps:', swaps); */
  })
  .catch((error) => {
    console.error('Error retrieving historical swaps:', error);
  });

