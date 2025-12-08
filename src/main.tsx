import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SuiClientProvider, getFullnodeUrl, WalletProvider } from '@mysten/dapp-kit';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuiClientProvider networks={{ mainnet: { url: getFullnodeUrl('mainnet') } }}>
      <WalletProvider autoConnect>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </React.StrictMode>,
);
