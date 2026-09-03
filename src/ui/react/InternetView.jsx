import { lazy, Suspense, useEffect, useState } from 'react';
import { UiButton } from './UiButton.jsx';

const NesEmulator = lazy(() => import('./NesEmulator.jsx').then((module) => ({ default: module.NesEmulator })));

export function InternetView({ controller }) {
  const [address, setAddress] = useState(controller.url);
  const [mode, setMode] = useState('browser');
  useEffect(() => { setAddress(controller.url); }, [controller.url, controller.open]);
  const go = (event) => {
    event.preventDefault();
    controller.navigate(address);
  };
  return <div className="internet-view" hidden={!controller.open}>
    <section className="internet-terminal" role="dialog" aria-modal="false" aria-label="Internet terminal">
      <header className="internet-head">
        <span className="internet-mark">TW<span>NET</span></span>
        <nav className="internet-tabs" aria-label="Terminal mode">
          <UiButton className={mode === 'browser' ? 'active' : ''} onClick={() => setMode('browser')}>Web</UiButton>
          <UiButton className={mode === 'nes' ? 'active' : ''} onClick={() => setMode('nes')}>NES</UiButton>
        </nav>
        <form onSubmit={go} hidden={mode !== 'browser'}>
          <label className="sr-only" htmlFor="internet-address">Web address or search</label>
          <input id="internet-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Web address or search" autoFocus />
          <UiButton type="submit">Go</UiButton>
        </form>
        {mode === 'browser' && <UiButton onClick={() => controller.openExternal()}>Open externally</UiButton>}
        <UiButton className="internet-close" onClick={() => controller.close()}>Close</UiButton>
      </header>
      <div className="internet-screen">
        {mode === 'browser'
          ? <iframe key={controller.url} src={controller.url} title="Internet browser" sandbox="allow-forms allow-popups allow-same-origin allow-scripts" referrerPolicy="no-referrer" />
          : <Suspense fallback={<div className="nes-loading">Warming up the console...</div>}><NesEmulator active={controller.open && mode === 'nes'} /></Suspense>}
      </div>
      <footer>{mode === 'browser' ? <>Some websites block in-game embedding. Use <b>Open externally</b> when a page refuses to display. </> : <>Use a legally obtained NES ROM from your device. </>}<b>Esc</b> closes the terminal.</footer>
    </section>
  </div>;
}
