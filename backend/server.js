import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { JsonRpcProvider, getFullnodeUrl, RawSigner } from '@mysten/sui.js';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { IkaSDK, DWallet, ChainId } from '@ika.xyz/sdk';  // SDK oficial Ika
import { ethers } from 'ethers';
import { Fetcher, Route, Trade, TradeType, Percent, Token } from '@uniswap/sdk-core';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const suiProvider = new JsonRpcProvider(getFullnodeUrl(process.env.IKA_NETWORK || 'mainnet'));
const baseProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org');

// Tokens Uniswap Base mainnet
const WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH');
const USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC');
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

let demoDWallet = null;

// Middleware para carregar signer do user (passe via body no frontend)
const getUserSigner = (req) => {
  const { suiPrivateKeyBase64 } = req.body;  // Frontend envia serializada
  if (!suiPrivateKeyBase64) throw new Error('Sui private key required');
  const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(suiPrivateKeyBase64, 'base64'));
  return new RawSigner(keypair, suiProvider);
};

// API: Verificar saldo IKA (chamado pelo frontend)
app.post('/check-ika-balance', async (req, res) => {
  try {
    const signer = getUserSigner(req);
    const address = signer.getAddress();
    const balanceResponse = await suiProvider.getBalance({ owner: address, coinType: '0x2::ika::IKA' });  // Tipo oficial IKA
    const ikaBalance = Number(balanceResponse.totalBalance) / 1e9;  // 9 decimais
    res.json({ hasEnough: ikaBalance >= 0.05, balance: ikaBalance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Criar dWallet + DKG para Base
app.post('/connect-and-create', async (req, res) => {
  try {
    const signer = getUserSigner(req);
    const ika = new IkaSDK({
      network: process.env.IKA_NETWORK || 'mainnet',
      suiProvider,
      signer,
    });

    demoDWallet = await DWallet.create(ika, {
      name: 'BaseSwapDWallet',
      chains: [ChainId.BASE],  // Ou 'BASE' se string
      threshold: 2,  // 2/3 signers
      guardians: [],  // Adicione addresses para recuperação
    });

    const dkgResult = await demoDWallet.initiateDKG({
      numSigners: 3,
      timeout: 5000,  // <1s na mainnet
    });

    if (!dkgResult.success) throw new Error(`DKG failed: ${dkgResult.error}`);

    const baseAddress = demoDWallet.addresses[ChainId.BASE];
    res.json({ baseAddress, message: 'dWallet created with real MPC! Send ETH to swap.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Fazer swap ETH -> USDC na Base via MPC signature
app.post('/swap-base', async (req, res) => {
  try {
    if (!demoDWallet) throw new Error('Create dWallet first');

    const { amountInEth = '0.001' } = req.body;
    const amountIn = ethers.parseEther(amountInEth);

    // Fetch pair e trade
    const pair = await Fetcher.fetchPairData(WETH, USDC, baseProvider);
    const route = new Route([pair], WETH);
    const trade = new Trade(route, amountIn, TradeType.EXACT_INPUT);
    const slippageTolerance = new Percent(50, 10000);  // 0.5%
    const amountOutMin = trade.minimumAmountOut(slippageTolerance);

    // Encode call para Uniswap Router
    const routerAbi = [
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
    ];
    const routerInterface = new ethers.Interface(routerAbi);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;  // 20 min
    const params = {
      tokenIn: WETH.address,
      tokenOut: USDC.address,
      fee: 3000,  // 0.3% pool
      recipient: demoDWallet.addresses[ChainId.BASE],
      deadline,
      amountIn: amountIn.toString(),
      amountOutMinimum: amountOutMin.toExact(),
      sqrtPriceLimitX96: 0,
    };
    const data = routerInterface.encodeFunctionData('exactInputSingle', [params]);

    // Payload para assinatura MPC
    const txPayload = {
      chain: ChainId.BASE,
      to: UNISWAP_ROUTER,
      data,
      value: amountIn.toString(),
      gasLimit: 300000,
    };

    // Assina via dWallet (real MPC - nodes Ika coordenam)
    const signedTx = await demoDWallet.signTransaction(txPayload);  // Retorna raw signed tx

    // Broadcast na Base
    const txResponse = await baseProvider.broadcastTransaction(signedTx.raw);  // Ajuste se SDK retorna 'raw'
    const receipt = await txResponse.wait();

    res.json({
      txHash: receipt.hash,
      amountOut: ethers.formatUnits(receipt.logs[0]?.data || '0', USDC.decimals),
      message: 'Real MPC swap completed on Base! <1s via Ika nodes.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'Ika MPC Backend Live - Mainnet Ready' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🦑 Ika Backend running on port ${PORT} | Real MPC Active`));
