import { ethers } from 'ethers';
import { Pool } from '@uniswap/v3-sdk';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';

const provider = new ethers.providers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/');

// Define the token addresses and pool fee
const tokenAddress1 = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // DAI token address
const tokenAddress2 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH token address
const poolFee = 3000; // 0.3% pool fee

async function main() {
  const token1 = new Token(1, tokenAddress1, 18, 'DAI', 'Dai Stablecoin');
  const token2 = new Token(1, tokenAddress2, 18, 'WETH', 'Wrapped Ether');

  const poolAddress = Pool.getAddress(token1, token2, poolFee);
  const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider);

  const immutables = await getPoolImmutables();
  const state = await getPoolState();

  const pool = new Pool(
    token1,
    token2,
    immutables.fee,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick
  );

  poolContract.on('Swap', async (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick) => {
    // Determine the direction of the swap
    const zeroForOne = amount0 !== '0';
    const amountIn = zeroForOne ? amount0 : amount1;
    const amountOut = zeroForOne ? amount1 : amount0;

    // Create CurrencyAmount instances for the input and output amounts
    const currencyAmountIn = CurrencyAmount.fromRawAmount(zeroForOne ? token1 : token2, amountIn);
    const currencyAmountOut = CurrencyAmount.fromRawAmount(zeroForOne ? token2 : token1, amountOut);

    // Log the details of the swap
    console.log('Swap detected:');
    console.log('  Sender:', sender);
    console.log('  Recipient:', recipient);
    console.log('  Input amount:', currencyAmountIn.toSignificant(6));
    console.log('  Output amount:', currencyAmountOut.toSignificant(6));
    console.log('  Price:', pool.token0Price.toSignificant(6));
  });

  console.log('Monitoring swaps on Uniswap V3 pool...');

  async function getPoolImmutables() {
    const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
      poolContract.factory(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.tickSpacing(),
      poolContract.maxLiquidityPerTick(),
    ]);

    return {
      factory: factory,
      token0: token0,
      token1: token1,
      fee: fee,
      tickSpacing: tickSpacing,
      maxLiquidityPerTick: maxLiquidityPerTick,
    };
  }

  async function getPoolState() {
    const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);

    return {
      liquidity: liquidity,
      sqrtPriceX96: slot[0],
      tick: slot[1],
      observationIndex: slot[2],
      observationCardinality: slot[3],
      observationCardinalityNext: slot[4],
      feeProtocol: slot[5],
      unlocked: slot[6],
    };
  }
}

main().catch((error) => {
  console.error('Error monitoring swaps:', error);
  process.exit(1);
});
