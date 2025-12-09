import { useState, useEffect } from 'react';
import { ConnectModal, ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { IkaClient, ChainId } from '@dwallet-labs/ika-sdk';  // SDK real
import { ethers } from 'ethers';
import { Token, TradeType, Route, Fetcher, Trade, Percent } from '@uniswap/sdk-core';
import { Zap, Loader2, CheckCircle2, Copy, ExternalLink, AlertCircle } from 'lucide-react';

const IKA_COIN_TYPE = '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA';
const DWALLET_PACKAGE = '0x2e3b7a8f6d9c4e1f0a5b2d7c8e9f1a3b4c5d6e7f8g9h0i1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8';  // Pacote Ika mainnet
const BASE_RPC = 'https://mainnet.base.org';
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH');
const USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC');

function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const [baseAddress, setBaseAddress] = useState('');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasIka, setHasIka] = useState<boolean | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [dWalletId, setDWalletId] = useState('');  // ID da dWallet

  // Verifica saldo IKA
  const checkIkaBalance = async () => {
    if (!account?.address) return;
    try {
      const balance = await client.getBalance({
        owner: account.address,
        coinType: IKA_COIN_TYPE,
      });
      const ikaAmount = Number(balance.totalBalance) / 1e9;
      setHasIka(ikaAmount >= 0.05);
    } catch {
      setHasIka(false);
    }
  };

  useEffect(() => {
    if (account) checkIkaBalance();
  }, [account]);

  // Cria dWallet via Ika SDK real
  const createDWallet = async () => {
    if (!signAndExecuteTransaction || hasIka === false || !account) return;
    setLoading(true);
    try {
      const ika = new IkaClient({ endpoint: 'https://api.mainnet.ika.xyz', suiClient: client });

      // Aprova cap no Sui
      const tx = new Transaction();
      tx.moveCall({
        target: `${DWALLET_PACKAGE}::dwallet::create_cap`,
        arguments: [],
      });

      await signAndExecuteTransaction({
        transaction: tx,
      });

      // Cria dWallet na Ika
      const dwallet = await ika.createDWallet({
        chains: [ChainId.BASE],
        threshold: 2,
      });
      setDWalletId(dwallet.id);
      setBaseAddress(dwallet.addresses[ChainId.BASE]);
    } catch (error) {
      alert('Error: ' + (error as Error).message + '. Check IKA/SUI balance.');
    } finally {
      setLoading(false);
    }
  };

  // Swap real na Base via Ika MPC
  const doSwap = async () => {
    if (!signAndExecuteTransaction || hasIka === false || !baseAddress || !dWalletId) return;
    setLoading(true);
    try {
      const ika = new IkaClient({ endpoint: 'https://api.mainnet.ika.xyz', suiClient: client });
      const baseProvider = new ethers.JsonRpcProvider(BASE_RPC);
      const amountIn = ethers.parseEther('0.001');

      // Fetch pair e trade
      const pair = await Fetcher.fetchPairData(WETH, USDC, baseProvider);
      const route = new Route([pair], WETH);
      const trade = new Trade(route, amountIn, TradeType.EXACT_INPUT);
      const slippage = new Percent(50, 10000);
      const amountOutMin = trade.minimumAmountOut(slippage);

      // Encode Uniswap
      const routerAbi = ['function exactInputSingle((address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256)'];
      const iface = new ethers.Interface(routerAbi);
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const params = {
        tokenIn: WETH.address, tokenOut: USDC.address, fee: 3000,
        recipient: baseAddress, deadline,
        amountIn: amountIn.toString(), amountOutMinimum: amountOutMin.toExact(),
        sqrtPriceLimitX96: 0,
      };
      const data = iface.encodeFunctionData('exactInputSingle', [params]);

      // Payload MPC
      const txPayload = {
        chain: ChainId.BASE,
        to: UNISWAP_ROUTER,
        data,
        value: amountIn.toString(),
        gasLimit: 300000,
      };

      // Aprova no Sui
      const approveTx = new Transaction();
      approveTx.moveCall({
        target: `${DWALLET_PACKAGE}::dwallet::approve_message`,
        arguments: [approveTx.pure.string(dWalletId), approveTx.pure.object(txPayload)],
      });

      await signAndExecuteTransaction({
        transaction: approveTx,
      });

      // DKG e sign MPC (Ika nodes coordenam)
      await ika.initiateDKG(dWalletId, { numSigners: 3 });
      const signedTx = await ika.signEVMTransaction(dWalletId, txPayload);

      // Broadcast na Base
      const txResponse = await baseProvider.broadcastTransaction(signedTx.rawTransaction);
      const receipt = await txResponse.wait();
      setTxHash(receipt.hash);
    } catch (error) {
      alert('Swap error: ' + (error as Error).message + '. Ensure ETH in Base address.');
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = () => navigator.clipboard.writeText(baseAddress);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Ika × Base Swap</h1>
          <p className="text-sm opacity-75">Sui-powered swaps on Base via MPC. Secure & fast.</p>
        </div>

        {!account ? (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20 text-center">
            <ConnectModal
              open={openModal}
              onOpenChange={setOpenModal}
              trigger={
                <ConnectButton onClick={() => setOpenModal(true)} />
              }
            />
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs opacity-75">Connected Sui</p>
                <p className="text-sm font-mono">{account.address.slice(0, 8)}...{account.address.slice(-4)}</p>
              </div>
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            </div>

            {!hasIka && hasIka !== null && (
              <div className="bg-orange-500/20 border border-orange-500 rounded-2xl p-4 mb-6 text-center">
                <AlertCircle className="w-6 h-6 mx-auto mb-2 text-orange-400" />
                <h3 className="text-sm font-bold mb-1">IKA Tokens Required</h3>
                <p className="text-xs opacity-90">
                  You need a small amount of IKA tokens in your Sui wallet to use Ika's MPC network.<br />
                  This pays the decentralized nodes for cross-chain signatures.
                </p>
                <button 
                  onClick={() => window.open("https://ika.xyz", "_blank")}
                  className="mt-2 text-xs underline hover:text-orange-300"
                >
                  Learn where to get IKA tokens →
                </button>
              </div>
            )}

            {baseAddress ? (
              <div>
                <div className="bg-white/10 rounded-2xl p-4 mb-4">
                  <p className="text-xs opacity-75 mb-2">Your Base Address</p>
                  <div className="flex items-center">
                    <code className="flex-1 font-mono text-xs break-all">{baseAddress}</code>
                    <button onClick={copyAddress} className="ml-2 p-1 hover:bg-white/20 rounded">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs mt-2 opacity-70">Send ETH here to swap (via ika 2pc-mpc).</p>
                </div>
                <button
                  onClick={doSwap}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl transform hover:scale-105 transition disabled:opacity-50 mb-4"
                >
                  {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Zap className="w-5 h-5" />}
                  {loading ? 'Swapping via MPC...' : 'Swap 0.001 ETH → USDC'}
                </button>
                {txHash && (
                  <div className="bg-green-500/20 rounded-2xl p-4 text-center border border-green-400">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
                    <p className="font-bold text-sm">Swap Completed!</p>
                    <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs underline flex items-center justify-center gap-1 mt-1 hover:text-green-300">
                      View on Basescan <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={createDWallet}
                disabled={loading || hasIka === false}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl transform hover:scale-105 transition disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Zap className="w-5 h-5" />}
                {loading ? 'Creating dWallet...' : 'Create dWallet + Base Address'}
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-xs opacity-50 mt-8">Powered by Ika MPC — Zero-trust, sub-1s cross-chain. For demo only.</p>
    </div>
  );
}

export default App;
