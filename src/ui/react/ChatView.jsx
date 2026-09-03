import { useEffect, useMemo, useRef } from 'react';
import { itemIcon } from '../icons.js';
import { itemModel } from '../preview.js';
import { itemBlurb } from '../dialogue.js';
import { Svg, cssColor } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

function Art({ row }) {
  const html = useMemo(() => itemModel(row.type) ?? itemIcon(row.typeId), [row.type, row.typeId]);
  return html ? <Svg html={html} /> : <span className="chip" style={{ background: cssColor(row.type.swatch) }} />;
}
function Card({ row, controller }) {
  if (!row) return <div className="card-none">Nothing here to look at.</div>;
  const { inventory, purse } = controller.ctx, buying = controller.tab === 'buy';
  const after = buying ? purse.coins - row.price : purse.coins + row.price;
  const facts = [[buying ? 'Price' : 'They pay', `${row.price} coin`, 'coin'], [buying ? 'On the shelf' : 'This slot', buying ? row.stock : row.count], ['In your bag', inventory.count(row.typeId)], ['Coins after', after, after < 0 ? 'warn' : 'coin']];
  return <><div className="card-art"><Art row={row} /></div><div className="card-name">{row.type.label}</div><div className="card-kind">{itemBlurb(row.type)}</div><dl className="card-facts">{facts.map(([key, value, cls]) => <div key={key}><dt>{key}</dt><dd className={cls}>{value}</dd></div>)}</dl>{row.why && <div className="card-why">{row.why}</div>}</>;
}
function ShopRows({ controller, rows, shelf }) {
  const selected = controller.rowSel[controller.tab], refs = useRef([]);
  const content = useMemo(() => rows.map((row, index) => <UiButton ref={(node) => { refs.current[index] = node; }} className={`shop-row${row.ok ? '' : ' no'}${index === selected ? ' on' : ''}`} key={`${row.typeId}-${row.slot ?? index}`} onClick={() => controller.chooseRow(index)}><span className="shop-art"><Art row={row} /></span><span className="shop-label">{row.label}</span><span className="shop-qty">{row.qty}</span><span className="shop-price">{row.price}</span></UiButton>), [shelf, selected]);
  useEffect(() => { refs.current[selected]?.scrollIntoView({ block: 'nearest' }); }, [controller.tab, selected]);
  return content;
}
function Shop({ controller }) {
  const d = controller.dialogue, rows = controller._rows, selected = controller.rowSel[controller.tab];
  const shelf = `${controller.tab}|${d.shop.version}|${controller.ctx.inventory.version}|${controller.ctx.purse.version}`;
  return <div className="shop" id="shop"><div className="shop-head"><span className="shop-name">{d.shop.name}</span><span className="shop-coins"><b>{controller.ctx.purse.coins}</b> coin</span></div><div className="shop-tabs"><UiButton className={`shop-tab${controller.tab === 'buy' ? ' on' : ''}`} onClick={() => controller.setTab('buy')}>Buy</UiButton><UiButton className={`shop-tab${controller.tab === 'sell' ? ' on' : ''}`} onClick={() => controller.setTab('sell')}>Sell</UiButton></div><div className="shop-body"><div className="shop-rows">{rows.length ? <ShopRows controller={controller} rows={rows} shelf={shelf} /> : <div className="shop-empty">{controller.tab === 'buy' ? 'The shelves are bare.' : 'Nothing here they want to buy.'}</div>}</div><aside className="shop-card"><Card row={rows[selected]} controller={controller} /></aside></div><div className="shop-foot"><span className={controller.note?.startsWith("Can't") ? 'shop-warn' : ''}>{controller.note}</span><span className="dim"><b>↑↓</b> pick · <b>←→</b> buy/sell · <b>E</b> trade · <b>Esc</b> done</span></div></div>;
}
export function ChatView({ controller }) {
  const d = controller.dialogue;
  const choices = d && !d.trading && controller.revealed ? d.choices : [];
  return <div className="chat" hidden={!controller.active} onPointerDown={(event) => event.stopPropagation()}><div className={`chat-box${controller.trading ? ' dim' : ''}`} onClick={(event) => { if (event.target.closest('[data-choice]')) return; if (!controller.trading) controller.confirm(); }}><div className="chat-who"><span className="chat-name">{d?.speaker}</span>{d?.npc.title && <span className="chat-title">{d.npc.title}</span>}</div><div className="chat-text" ref={controller.attachText} />
    <div className="chat-choices">{choices.map((choice, index) => <UiButton data-choice={index} className={`choice${index === controller.sel ? ' on' : ''}`} key={choice.index} onClick={(event) => { event.stopPropagation(); controller.pick(index); }}><span className="choice-key">{index + 1}</span>{choice.text}</UiButton>)}</div>
    <div className="chat-more" hidden={!d || d.trading || !controller.revealed || choices.length > 0}>▾</div></div>{d?.trading && <Shop controller={controller} />}</div>;
}
