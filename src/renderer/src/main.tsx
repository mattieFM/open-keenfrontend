import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import { queryClient } from './lib/query/queryClient';

const publicBoot = window.location.hash.startsWith('#/public/');

// A fresh private/editor renderer boot always begins at credential entry. The
// public viewer is a separate lazy bootstrap and never initializes workspaces.
if (!publicBoot) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/connect`);
}

const Root = lazy(async () => {
  if (publicBoot) {
    const module = await import('./app/PublicApp');
    return { default: module.PublicApp };
  }
  const module = await import('./app/App');
  return { default: module.App };
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="splash" role="status"><div className="brand-mark">K</div><p>Opening Keen Key Console…</p></div>}>
        <Root />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);
