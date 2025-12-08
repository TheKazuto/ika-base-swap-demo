import { useState, useEffect } from 'react';
import { useWallet } from '@mysten/wallet-kit';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { JsonRpcProvider, getFullnodeUrl } from '@mysten/sui.js';
import { Zap, Loader2, CheckCircle2, Copy, ExternalLink, AlertCircle } from 'lucide-react';
import { IkaSDK, DWallet } from '@ika.xyz/sdk'; // SDK oficial da Ika
import { ethers } from 'ethers';
import { Token, TradeType, Route, Fetcher, Percent } from '@uniswap/sdk-core';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'; // Para deploy, defina no Vercel
const IKA_TOKEN_TYPE = '0x2::ika::IKA'; // Tipo oficial do token IKA na Sui mainnet (confirme em docs)
const BASE_RPC = 'https://mainnet.base.org';
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'; // Uniswap V3 Base
const WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH');
const USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC');

function App() {
  const { account } = useWallet();
  const [baseAddress, setBaseAddress] = useState('');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasIka, setHasIka] = useState<boolean | null>(null);
  const [step, setStep] = useState<'idle' | 'creating' | 'ready' | 'swapping'>('idle');

  // Verifica saldo IKA
  const checkIkaBalance = async () => {
    if (!account?.address) return;
    try {
      const provider = new JsonRpcProvider(getFullnodeUrl('mainnet'));
      const balance = await provider.getBalance({ owner: account.address, coinType: IKA_TOKEN_TYPE });
      const ikaAmount = Number(balance.totalBalance) / 1e9; // Assumindo 9 decimais; ajuste se necessário
      setHasIka(ikaAmount >= 0.05); // Mínimo ~0.05 IKA para taxas
    } catch {
      setHasIka(false);
    }
  };

  useEffect(() => {
    if (account) checkIkaBalance();
  }, [account]);

  const createDWallet = async () => {
    setLoading(true);
    setStep('creating');
    try {
      // Simula keypair para demo; em prod, use signer real da wallet
      const keypair = new Ed25519Keypair();
      const ika = new IkaSDK({
        network: 'mainnet',
        suiProvider: new JsonRpcProvider(getFullnodeUrl('mainnet')),
        signer: keypair,
      });
      const dwallet = await DWallet.create(ika, {
        name: 'BaseSwapDWallet',
        chains: ['BASE'],
        threshold: 2,
        guardians: [],
      });
      await dwallet.initiateDKG({ numSigners: 3, timeout: 5000 });
      setBaseAddress(dwallet.addresses['BASE']);
      setStep('ready');
    } catch (error) {
      console.error(error);
      alert('Error creating dWallet. Check IKA balance and try again.');
    } finally {
      setLoading(false);
    }
  };

  const doSwap = async () => {
    setLoading(true);
    setStep('swapping');
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC);
      const pair = await Fetcher.fetchPairData(WETH, USDC, provider);
      const route = new Route([pair], WETH);
      const amountIn = ethers.parseEther('0.001');
      const trade = new Trade(route, amountIn, TradeType.EXACT_INPUT);
      const slippage = new Percent(50, 10000); // 0.5%
      const amountOutMin = trade.minimumAmountOut(slippage);

      // Encode tx (simplificado; use full ABI em prod)
      const iface = new ethers.Interface(['function exactInputSingle(tuple(address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256)']);
      const params = {
        tokenIn: WETH.address,
        fee: 3000,
        tokenOut: USDC.address,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin.raw.toString(),
        sqrtPriceLimitX96: 0,
      };
      const data = iface.encodeFunctionData('exactInputSingle', [params]);

      // Assina via dWallet (simulado; integre full SDK)
      // const signedTx = await dwallet.signTransaction({ chain: 'BASE', to: UNISWAP_ROUTER, data, value: amountIn });
      // const tx = await provider.broadcastTransaction(signedTx);
      // setTxHash(tx.hash);

      setTxHash('0xsimulated_hash_for_demo'); // Substitua por real em backend
    } catch (error) {
      console.error(error);
      alert('Swap failed. Ensure ETH in Base address.');
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = () => navigator.clipboard.writeText(baseAddress);

  if (!account) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white flex items-center justify-center">
        <div className="text-center">
          <Zap className="w-16 h-16 mx-auto mb-4 text-yellow-400" />
          <h1 className="text-4xl font-bold mb-4">Ika × Base Swap</h1>
          <p className="text-xl mb-8">Connect your Sui wallet to start</p>
          <button className="bg-gradient-to-r from-purple-600 to-blue-600 px-8 py-4 rounded-xl font-bold">Connect Sui Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-4">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Ika × Base Swap</h1>
        <p className="text-center text-gray-300 mb-6">Use your Sui wallet for swaps on Base L2 — no bridges needed.</p>

        {!hasIka && hasIka !== null && (
          <div className="bg-orange-500/20 border border-orange-500 rounded-2xl p-6 mb-6 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-orange-400" />
            <h3 className="text-xl font-bold mb-2">IKA Tokens Required</h3>
            <p className="text-sm opacity-90">
              You need a small amount of IKA tokens in your Sui wallet to use Ika's MPC network.<br />
              This pays the decentralized nodes that sign your cross-chain transactions.
            </p>
            <button 
              onClick={() => window.open("https://ika.xyz", "_blank")}
              className="mt-4 text-sm underline hover:text-orange-300"
            >
              Learn where to get IKA tokens →
            </button>
          </div>
        )}

        {baseAddress ? (
          <div>
            <div className="bg-white/10 rounded-2xl p-4 mb-4">
              <p className="text-sm opacity-75 mb-2">Your Base Address</p>
              <div className="flex items-center">
                <code className="flex-1 font-mono text-sm break-all">{baseAddress}</code>
                <button onClick={copyAddress} className="ml-2 p-2 hover:bg-white/20 rounded">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button
              onClick={doSwap}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 py-4 rounded-2xl font-bold mb-4 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Zap className="w-5 h-5" />}
              {loading ? 'Swapping...' : 'Swap 0.001 ETH → USDC'}
            </button>
            {txHash && (
              <div className="bg-green-500/20 rounded-2xl p-4 text-center">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
                <p>Swap completed!</p>
                <a href={`https://basescan.org/tx/${txHash}`} target="_blank" className="text-sm underline flex items-center justify-center gap-1">
                  View Tx <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={createDWallet}
            disabled={loading || hasIka === false}
            className="w-full bg-blue-600 hover:bg-blue-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Zap className="w-5 h-5" />}
            {loading ? 'Creating dWallet...' : 'Create dWallet + Base Address'}
          </button>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">Powered by Ika MPC — Fast, secure, cross-chain.</p>
      </div>
    </div>
  );
}

export default App;
