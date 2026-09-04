import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { itemIcon } from '../icons.js';
import { animalPreview, itemModel } from '../preview.js';
import { Svg, cssColor } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

const NesEmulator = lazy(() => import('./NesEmulator.jsx').then((module) => ({ default: module.NesEmulator })));

const AIRLINE_CSS = `
  :root { color: #15283a; background: #edf3f2; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 300px; }
  button { font: inherit; }
  .site { min-height: 100vh; background: linear-gradient(135deg, #edf3f2 0 58%, #dce9e6 58%); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px clamp(18px, 5vw, 64px); color: #fff; background: #15394d; }
  .brand { font-weight: 900; font-size: clamp(20px, 3vw, 30px); letter-spacing: -.04em; }
  .brand span { color: #f3b94d; }
  .clock { color: #b9d6dc; font: 700 12px/1.5 ui-monospace, monospace; text-align: right; }
  main { width: min(1120px, 100%); margin: auto; padding: clamp(20px, 4vw, 48px); }
  .lead { margin-bottom: 26px; }
  h1 { margin: 0 0 8px; color: #15394d; font-size: clamp(28px, 5vw, 52px); line-height: .98; letter-spacing: -.055em; }
  .lead p { max-width: 650px; margin: 0; color: #587080; font-size: 14px; line-height: 1.6; }
  .board { overflow: hidden; background: #fff; border-radius: 14px; box-shadow: 0 16px 45px #17394d20; }
  .board-title, .flight { display: grid; grid-template-columns: 86px minmax(170px, 1.5fr) 105px 78px 105px 112px; align-items: center; gap: 12px; }
  .board-title { padding: 12px 18px; color: #78909c; background: #f6f9f8; border-bottom: 1px solid #d9e4e2; font-size: 10px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
  .flight { position: relative; padding: 18px; border-bottom: 1px solid #e4ecea; }
  .flight:last-child { border-bottom: 0; }
  .flight::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--route); }
  .number { font: 800 12px/1 ui-monospace, monospace; }
  .destination strong { display: block; color: #18364a; font-size: 17px; }
  .destination small { display: block; margin-top: 4px; color: #708793; line-height: 1.3; }
  .time strong { display: block; font-size: 18px; }
  .time small, .date, .gate { color: #6c818c; font-size: 11px; }
  .gate strong { display: block; color: #15394d; font-size: 20px; }
  .status { color: #24725c; font: 900 10px/1 ui-monospace, monospace; letter-spacing: .08em; }
  .status.boarding { color: #b26015; }
  .buy { padding: 10px 12px; color: #fff; background: #15394d; border: 0; border-radius: 7px; cursor: pointer; font-weight: 850; font-size: 11px; }
  .buy:hover:not(:disabled) { background: #235d75; }
  .buy:disabled { opacity: .45; cursor: default; }
  .message { min-height: 24px; margin: 14px 2px 0; color: #31586a; font-size: 12px; font-weight: 750; }
  .fine { margin-top: 22px; color: #70828b; font-size: 11px; line-height: 1.5; }
  @media (max-width: 760px) {
    header { padding: 16px; }
    main { padding: 18px 12px 30px; }
    .board-title { display: none; }
    .flight { grid-template-columns: 66px 1fr auto; gap: 10px; padding: 16px 13px 16px 18px; }
    .date { display: none; }
    .time { grid-column: 1; }
    .gate { grid-column: 2; }
    .status { grid-column: 3; }
    .buy { grid-column: 1 / -1; }
  }
`;

const PORTAL_CSS = `
  :root { color: #242728; background: #f2efe7; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 300px; }
  button, input, select { font: inherit; }
  .portal { min-height: 100vh; }
  .portal-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px clamp(16px, 4vw, 48px); color: #fff; background: var(--brand, #29485d); }
  .portal-brand { font-size: clamp(19px, 3vw, 28px); font-weight: 950; letter-spacing: -.04em; }
  .portal-head small { opacity: .75; font-weight: 700; }
  .portal-main { width: min(1180px, 100%); margin: auto; padding: clamp(18px, 3vw, 38px); }
  .portal-title { margin: 0 0 6px; color: var(--brand, #29485d); font-size: clamp(27px, 4vw, 44px); letter-spacing: -.045em; }
  .portal-lead { margin: 0 0 20px; color: #667071; font-size: 13px; line-height: 1.5; }
  .filters { display: flex; gap: 8px; margin-bottom: 18px; }
  .filters input, .filters select { min-width: 0; padding: 10px 12px; color: #263237; background: #fff; border: 1px solid #c9ceca; border-radius: 7px; }
  .filters input { flex: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .card { display: grid; grid-template-rows: 112px auto auto 1fr auto; min-width: 0; padding: 13px; background: #fff; border: 1px solid #dddcd5; border-radius: 10px; box-shadow: 0 5px 18px #293a4020; }
  .art { display: grid; place-items: center; overflow: hidden; border-radius: 7px; background: #f0f1ec; }
  .art > svg, .art > span > svg { width: 96px; height: 96px; }
  .art-swatch { width: 58px; height: 58px; border-radius: 50%; }
  .card h2 { margin: 11px 0 2px; color: #293b42; font-size: 15px; line-height: 1.15; }
  .meta { color: #89908e; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .detail { margin: 8px 0 12px; color: #687170; font-size: 11px; line-height: 1.4; }
  .action { width: 100%; padding: 9px; color: #fff; background: var(--brand, #29485d); border: 0; border-radius: 6px; cursor: pointer; font-weight: 850; font-size: 11px; }
  .action:hover:not(:disabled) { filter: brightness(1.18); }
  .action:disabled { opacity: .48; cursor: default; }
  .message { min-height: 22px; margin: 14px 2px 0; color: var(--brand, #29485d); font-size: 12px; font-weight: 800; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 18px; }
  .pager button { padding: 8px 14px; background: #fff; border: 1px solid #c9ceca; border-radius: 6px; cursor: pointer; }
  .empty { padding: 40px; color: #77807d; background: #fff; border-radius: 10px; text-align: center; }
  .reserved { border-color: #d29445; box-shadow: 0 0 0 2px #e6b66755; }
  .collected .art { background: #e5f2e9; }
  .missing .art { filter: grayscale(1); opacity: .42; }
  .progress { height: 8px; margin: 15px 0 22px; overflow: hidden; background: #d6d9d3; border-radius: 5px; }
  .progress span { display: block; height: 100%; background: var(--brand, #29485d); }
  .home { min-height: 100vh; color: #e9f8f4; background: #09141c; }
  .home-hero { padding: clamp(30px, 8vw, 88px) clamp(20px, 7vw, 80px) 34px; background: radial-gradient(circle at 78% 12%, #264d58 0, transparent 37%), linear-gradient(145deg, #112b38, #09141c 70%); }
  .home-kicker { color: #55d9e8; font: 850 11px/1 ui-monospace, monospace; letter-spacing: .18em; }
  .home h1 { max-width: 760px; margin: 16px 0 12px; font-size: clamp(42px, 8vw, 88px); line-height: .88; letter-spacing: -.075em; }
  .home-hero p { max-width: 570px; margin: 0; color: #9db5ba; font-size: 14px; line-height: 1.65; }
  .home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0 clamp(20px, 7vw, 80px) 70px; }
  .home-link { position: relative; min-height: 170px; padding: 22px; overflow: hidden; color: #fff; background: var(--tile); border: 0; border-radius: 12px; cursor: pointer; text-align: left; box-shadow: inset 0 0 0 1px #ffffff1c; }
  .home-link::after { content: attr(data-mark); position: absolute; right: 12px; bottom: -24px; color: #ffffff19; font-size: 112px; font-weight: 950; }
  .home-link:hover { filter: brightness(1.15); transform: translateY(-2px); }
  .home-link strong { display: block; margin-bottom: 8px; font-size: 24px; letter-spacing: -.035em; }
  .home-link span { display: block; max-width: 290px; color: #ffffffb8; font-size: 12px; line-height: 1.5; }
  @media (max-width: 560px) {
    .portal-head { align-items: flex-start; }
    .filters { flex-wrap: wrap; }
    .filters input { flex-basis: 100%; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .home-grid { grid-template-columns: 1fr; padding-inline: 12px; }
    .home-hero { padding-inline: 18px; }
    .card { grid-template-rows: 88px auto auto 1fr auto; padding: 9px; }
    .art > svg, .art > span > svg { width: 76px; height: 76px; }
  }
`;

function InternalFrame({ title, css, children }) {
  const frame = useRef(null);
  const [body, setBody] = useState(null);
  const ready = () => setBody(frame.current?.contentDocument?.body ?? null);
  return <>
    <iframe ref={frame} srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={ready}
      title={title} sandbox="allow-same-origin" />
    {body && createPortal(<><style>{css}</style>{children}</>, body)}
  </>;
}

function ProductArt({ row, animal = false }) {
  const html = animal ? animalPreview(row.typeId, row.type) : itemModel(row.type) ?? itemIcon(row.typeId);
  return <div className="art">{html
    ? <Svg html={html} />
    : <span className="art-swatch" style={{ background: cssColor(row.swatch ?? 0x82908c) }} />}</div>;
}

function HomeSite({ open }) {
  const sites = [
    ['shop', 'Everything Shop', 'Search every registered product and put purchases directly in your bag.', '#9d4932', '$'],
    ['market', 'Town Classifieds', 'See what neighbors are selling, reserve it, then meet them to collect.', '#536d38', '+'],
    ['museum', 'Museum Archive', 'Track every fish and wildlife species in the living collection.', '#31677a', 'M'],
    ['flights', 'Wayfarer Air', 'Check live departures, buy tickets, and plan the next trip out of town.', '#6b4f87', '>'],
  ];
  return <div className="home">
    <section className="home-hero">
      <div className="home-kicker">TWNET LOCAL SERVICES · ONLINE</div>
      <h1>Your town,<br />on one screen.</h1>
      <p>Browse local services without an address bar. Purchases, reservations, museum records, and plane tickets connect directly to the world outside the cafe.</p>
    </section>
    <nav className="home-grid" aria-label="TWNET sites">
      {sites.map(([id, label, detail, color, mark]) => <button key={id} className="home-link" style={{ '--tile': color }} data-mark={mark} onClick={() => open(id)}>
        <strong>{label}</strong><span>{detail}</span>
      </button>)}
    </nav>
  </div>;
}

function ShopSite({ controller }) {
  const info = controller.catalogueInfo();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  if (!info) return <div className="empty">The catalogue is unavailable.</div>;
  const search = query.trim().toLowerCase();
  const rows = info.rows.filter((row) => (category === 'All' || row.category === category)
    && (!search || row.label.toLowerCase().includes(search) || row.typeId.toLowerCase().includes(search)));
  const pageSize = 32;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice(Math.min(page, pages - 1) * pageSize, (Math.min(page, pages - 1) + 1) * pageSize);
  const buy = (id) => setMessage(controller.purchaseCatalogueItem(id).message);
  return <div className="portal" style={{ '--brand': '#a4482f' }}>
    <header className="portal-head"><div className="portal-brand">EVERYTHING, DELIVERED NOW</div><small>{info.coins} coins · {info.rows.length} products</small></header>
    <main className="portal-main">
      <h1 className="portal-title">The whole catalogue.</h1>
      <p className="portal-lead">Tools, clothes, furniture, food, seeds, and goods. Purchases are placed directly in your inventory.</p>
      <div className="filters">
        <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search every product" aria-label="Search catalogue" />
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }} aria-label="Product category">
          <option>All</option>{info.categories.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div>
      {shown.length ? <div className="grid">{shown.map((row) => <article className="card" key={row.typeId}>
        <ProductArt row={row} />
        <h2>{row.label}</h2><div className="meta">{row.category}</div>
        <p className="detail">{row.owned ? `${row.owned} already in your bag.` : 'Ready to order.'}</p>
        <button className="action" disabled={!row.canBuy} onClick={() => buy(row.typeId)}>BUY · {row.price} COINS</button>
      </article>)}</div> : <div className="empty">No products match that search.</div>}
      {pages > 1 && <div className="pager"><button disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</button><span>{Math.min(page, pages - 1) + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button></div>}
      <div className="message" role="status">{message}</div>
    </main>
  </div>;
}

function MarketplaceSite({ controller }) {
  const info = controller.marketplaceInfo();
  const [message, setMessage] = useState('');
  if (!info) return <div className="empty">The classifieds are unavailable.</div>;
  const act = (listing) => {
    const result = listing.reserved ? controller.cancelListing(listing.id) : controller.reserveListing(listing.id);
    setMessage(result.message);
  };
  return <div className="portal" style={{ '--brand': '#546c35' }}>
    <header className="portal-head"><div className="portal-brand">TOWN CLASSIFIEDS</div><small>{info.town} · day {info.day}</small></header>
    <main className="portal-main">
      <h1 className="portal-title">For sale by neighbor.</h1>
      <p className="portal-lead">Reserve an item here, then find and talk to its seller. You pay only when they hand it over.</p>
      {info.listings.length ? <div className="grid">{info.listings.map((listing) => <article className={`card ${listing.reserved ? 'reserved' : ''}`} key={listing.id}>
        <ProductArt row={listing} />
        <h2>{listing.quantity > 1 ? `${listing.quantity} × ` : ''}{listing.label}</h2><div className="meta">Sold by {listing.seller}</div>
        <p className="detail">{listing.reserved ? `${listing.seller} is holding this for you.` : 'Local pickup. Cash when you meet.'}</p>
        <button className="action" onClick={() => act(listing)}>{listing.reserved ? 'CANCEL RESERVATION' : `RESERVE · PAY ${listing.price} AT PICKUP`}</button>
      </article>)}</div> : <div className="empty">No neighbors have posted today.</div>}
      <div className="message" role="status">{message}</div>
    </main>
  </div>;
}

function MuseumSite({ controller }) {
  const info = controller.museumInfo();
  const [gallery, setGallery] = useState('All');
  const [show, setShow] = useState('All');
  if (!info) return <div className="empty">The museum catalogue is unavailable.</div>;
  const rows = info.rows.filter((row) => (gallery === 'All' || row.gallery === gallery)
    && (show === 'All' || (show === 'Collected') === row.collected));
  return <div className="portal" style={{ '--brand': '#315f72' }}>
    <header className="portal-head"><div className="portal-brand">MUNICIPAL MUSEUM ARCHIVE</div><small>{info.collected} / {info.total} species · {info.fish} fish · {info.wildlife} wildlife</small></header>
    <main className="portal-main">
      <h1 className="portal-title">Living collection.</h1>
      <p className="portal-lead">Every species you land or take is recorded here and appears as a permanent museum exhibit.</p>
      <div className="progress" aria-label={`${info.collected} of ${info.total} species collected`}><span style={{ width: `${info.total ? info.collected / info.total * 100 : 0}%` }} /></div>
      <div className="filters">
        <select value={gallery} onChange={(event) => setGallery(event.target.value)}><option>All</option><option>Fish</option><option>Wildlife</option></select>
        <select value={show} onChange={(event) => setShow(event.target.value)}><option>All</option><option>Collected</option><option>Missing</option></select>
      </div>
      <div className="grid">{rows.map((row) => <article className={`card ${row.collected ? 'collected' : 'missing'}`} key={row.typeId}>
        <ProductArt row={row} animal />
        <h2>{row.label}</h2><div className="meta">{row.gallery}</div>
        <p className="detail">{row.collected ? `Recorded ${row.count} time${row.count === 1 ? '' : 's'} · first on ${row.firstSeen}.` : 'Not yet recorded.'}</p>
        <div className="meta">{row.collected ? 'IN COLLECTION' : 'MISSING'}</div>
      </article>)}</div>
    </main>
  </div>;
}

function AirlineSite({ controller }) {
  const info = controller.flightInfo();
  const [message, setMessage] = useState('');
  if (!info) return <div className="site"><main>Flight information is unavailable.</main></div>;
  const buy = (id) => {
    const result = controller.purchaseTicket(id);
    setMessage(result.message);
  };
  return <div className="site">
    <header>
      <div className="brand">WAYFARER <span>AIR</span></div>
      <div className="clock">{info.date}<br />{info.time} local · {info.coins} coins</div>
    </header>
    <main>
      <div className="lead">
        <h1>Departures beyond town.</h1>
        <p>Tickets are open-ended for their route. Bring yours to the listed airport gate from one hour before departure until thirty minutes after.</p>
      </div>
      <section className="board" aria-label="Flight schedule">
        <div className="board-title"><span>Flight</span><span>Destination</span><span>Departure</span><span>Gate</span><span>Status</span><span>Fare</span></div>
        {info.flights.map((flight) => <article className="flight" key={flight.id} style={{ '--route': `#${flight.swatch.toString(16).padStart(6, '0')}` }}>
          <div className="number">{flight.flight}</div>
          <div className="destination"><strong>{flight.name} <small>{flight.code}</small></strong><small>{flight.note}</small></div>
          <div className="time"><strong>{flight.time}</strong><small>arrives {flight.arrival}</small></div>
          <div className="gate">GATE<strong>{flight.gate}</strong></div>
          <div><span className={`status ${flight.boarding ? 'boarding' : ''}`}>{flight.status}</span><div className="date">{flight.date}</div></div>
          <button className="buy" onClick={() => buy(flight.id)} disabled={!flight.canBuy}>BUY · {flight.price} COINS{flight.owned ? ` · ${flight.owned} OWNED` : ''}</button>
        </article>)}
      </section>
      <div className="message" role="status">{message}</div>
      <p className="fine">Schedules repeat daily. Missed flights do not void a ticket. Airport operations use game time, which continues while this terminal is open.</p>
    </main>
  </div>;
}

function AirlineFrame({ controller }) {
  return <InternalFrame title="Wayfarer Air booking website" css={AIRLINE_CSS}>
    <AirlineSite controller={controller} />
  </InternalFrame>;
}

export function InternetView({ controller }) {
  const [mode, setMode] = useState(controller.mode);
  useEffect(() => { if (controller.open) setMode(controller.mode); }, [controller.mode, controller.open]);
  const chooseMode = (next) => { setMode(next); controller.mode = next; };
  const nes = mode === 'nes';
  return <div className="internet-view" hidden={!controller.open}>
    <section className="internet-terminal" role="dialog" aria-modal="false" aria-label={nes ? 'NES game station' : 'Internet terminal'}>
      <header className="internet-head">
        <span className="internet-mark">{nes ? <>TW<span>PLAY</span></> : <>TW<span>NET</span></>}</span>
        {!nes && <nav className="internet-tabs" aria-label="TWNET sites">
          <UiButton className={mode === 'home' ? 'active' : ''} onClick={() => chooseMode('home')}>Home</UiButton>
          <UiButton className={mode === 'shop' ? 'active' : ''} onClick={() => chooseMode('shop')}>Shop</UiButton>
          <UiButton className={mode === 'market' ? 'active' : ''} onClick={() => chooseMode('market')}>Classifieds</UiButton>
          <UiButton className={mode === 'museum' ? 'active' : ''} onClick={() => chooseMode('museum')}>Museum</UiButton>
          <UiButton className={mode === 'flights' ? 'active' : ''} onClick={() => chooseMode('flights')}>Flights</UiButton>
        </nav>}
        <UiButton className="internet-close" onClick={() => controller.close()}>Close</UiButton>
      </header>
      <div className="internet-screen">
        {mode === 'home' ? <InternalFrame title="TWNET home" css={PORTAL_CSS}><HomeSite open={chooseMode} /></InternalFrame>
          : mode === 'shop' ? <InternalFrame title="Everything catalogue" css={PORTAL_CSS}><ShopSite controller={controller} /></InternalFrame>
          : mode === 'market' ? <InternalFrame title="Town classifieds" css={PORTAL_CSS}><MarketplaceSite controller={controller} /></InternalFrame>
            : mode === 'museum' ? <InternalFrame title="Museum catalogue" css={PORTAL_CSS}><MuseumSite controller={controller} /></InternalFrame>
              : mode === 'flights' ? <AirlineFrame controller={controller} />
                : <Suspense fallback={<div className="nes-loading">Warming up the console...</div>}><NesEmulator active={controller.open && nes} /></Suspense>}
      </div>
      <footer>{mode === 'home' ? <>Choose a site from the TWNET <b>home page</b>. </>
        : mode === 'shop' ? <>Catalogue orders go directly into your <b>inventory</b>. </>
        : mode === 'market' ? <>Reserve online, then <b>talk to the seller</b> to pay and collect. </>
          : mode === 'museum' ? <>New catches and wildlife are recorded <b>automatically</b>. </>
            : mode === 'flights' ? <>Tickets go into your bag. Present one at its gate during <b>BOARDING</b>. </>
              : <>NES Starter Kit is open source under the <b>MIT License</b>. </>}<b>Esc</b> closes the terminal.</footer>
    </section>
  </div>;
}
