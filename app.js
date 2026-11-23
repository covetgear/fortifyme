// FortifyMe prototype. Catalog comes from data/cosmetics.json (built by scripts/build-data.mjs).
// Favorites, wishlist and saved combos live in localStorage as a stand-in for real accounts.
// Today's shop comes from data/shop.json (built by scripts/record-shop.mjs).
// Layout follows the Figma "Fortnite Locker" designs (Item shop, Combo builder, Item detail pop-up, My account,
// Sign up, Log in). Privacy page and cookie banner have no Figma frame and reuse the same styles.
import { itemFacts, timeLeft, leavesAt } from './lib/alert-email.js';
import { SUPABASE_URL, SUPABASE_KEY, ADSENSE_CLIENT, AD_SLOTS, BILLING_ENABLED, PLANS } from './config.js';

const ICON = (name) => `assets/icons/${name}.svg`;
const SLOTS = [
  { key: 'outfit', label: 'Outfit', tab: 'Outfits', icon: 'plus', title: 'Choose an outfit', sub: 'The starting point for your next great combo.' },
  { key: 'backbling', label: 'Back bling', tab: 'Back bling', icon: 'bag', title: 'Choose a back bling', sub: 'Something to carry the look.' },
  { key: 'pickaxe', label: 'Pickaxe', tab: 'Pickaxes', icon: 'axe', title: 'Choose a pickaxe', sub: 'The tool that finishes the fit.' },
  { key: 'glider', label: 'Glider', tab: 'Gliders', icon: 'glider', title: 'Choose a glider', sub: 'Make the drop part of the look.' },
  { key: 'sidekick', label: 'Sidekick', tab: 'Sidekicks', icon: 'paw', title: 'Choose a sidekick', sub: 'A companion that tags along.' },
  { key: 'vehicle', label: 'Vehicle', tab: 'Vehicles', icon: 'car', title: 'Choose a vehicle', sub: 'Roll up in style.' },
];
const slotOf = (key) => SLOTS.find((s) => s.key === key);
const MAIN_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'transcendent'];
const PAGE = 48;
const STORE_KEY = 'comboLocker.v1';
const TYPE_LABEL = {
  outfit: 'Outfit', backpack: 'Back bling', pickaxe: 'Pickaxe', glider: 'Glider', emote: 'Emote', wrap: 'Wrap',
  shoe: 'Kicks', sidekick: 'Sidekick', pet: 'Back bling', petcarrier: 'Back bling', car: 'Car', instrument: 'Instrument',
  jamtrack: 'Jam Track', contrail: 'Contrail', aura: 'Aura', emoji: 'Emoticon', spray: 'Spray', loadingscreen: 'Loading screen',
  wheel: 'Wheels', decal: 'Decal', booster: 'Boost', body: 'Car body', backpack_carrier: 'Back bling',
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null && k !== false) n.append(k);
  return n;
};
const img = (src, w, h, cls = '') => el('img', { src, width: w, height: h, alt: '', className: cls });
const num = (n) => Number(n).toLocaleString();

let catalog = [];
let byId = new Map();
let imgPrefix = '';
let shop = { items: {} };

const state = {
  slot: 'outfit',
  search: '',
  rarity: '',
  sort: 'featured',
  inShop: false,
  favOnly: false,
  page: 0,
  results: [],
  combo: {}, // slot -> item id
  inspect: 'outfit', // which equipped item the big preview shows
};

// ---------- persistence ----------
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) {
      // Saved combos from before the Pet slot became Sidekick
      for (const c of s.combos || []) if (c.items?.pet) { c.items.sidekick ??= c.items.pet; delete c.items.pet; }
      // owner: the account this copy belongs to (null = a guest's own data, merged in on first log-in)
      return { likes: s.likes || [], wishlist: s.wishlist || [], combos: s.combos || [], alerts: s.alerts || null, owner: s.owner ?? null, account: null };
    }
  } catch {}
  return { likes: [], wishlist: [], combos: [], alerts: null, owner: null, account: null };
}
const store = loadStore();
// Saves to this browser, and to the account when signed in (see "Accounts" below).
function saveStore() {
  try {
    const { account: _signedIn, ...keep } = store;
    localStorage.setItem(STORE_KEY, JSON.stringify(keep));
  } catch {}
  if (store.account) schedulePush();
}
function toggleIn(list, id) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  saveStore();
  return i < 0;
}

// ---------- helpers ----------
const imgUrl = (item) => (item.i.startsWith('http') ? item.i : imgPrefix + item.i);
const rarityClass = (r) => `r-${MAIN_RARITIES.includes(r) ? r : 'other'}`;
const pretty = (r) => r.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const seriesLabel = (s) => s && s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const todayUTC = () => new Date().toISOString().slice(0, 10);
const isOn = (view) => !$(`#view-${view}`).classList.contains('hidden');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

// Clickable card that can still hold its own buttons (a <button> can't contain buttons).
function clickable(node, onClick) {
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.onclick = onClick;
  node.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === node) { e.preventDefault(); onClick(); } };
  return node;
}

// Heart = favorite, star = wishlist. `light` is the white heart used on shop cards.
function markButtons(id, light = false) {
  const fav = el('button', { type: 'button', className: 'fav-btn' }, img('', 14, 14));
  const wish = el('button', { type: 'button', className: 'wish-btn' }, img('', 28, 28));
  const sync = () => {
    const f = store.likes.includes(id);
    const w = store.wishlist.includes(id);
    fav.firstChild.src = ICON(f ? 'heart-on' : light ? 'heart-card' : 'heart-btn');
    wish.firstChild.src = ICON(w ? 'wish-on' : 'wish-btn');
    fav.title = f ? 'Remove from favorites' : 'Add to favorites';
    wish.title = w ? 'Remove from wishlist' : 'Add to wishlist (email alerts)';
    fav.setAttribute('aria-pressed', f);
    wish.setAttribute('aria-pressed', w);
  };
  fav.onclick = (e) => { e.stopPropagation(); toast(toggleIn(store.likes, id) ? 'Added to favorites' : 'Removed from favorites'); refreshMarks(); };
  wish.onclick = (e) => { e.stopPropagation(); toast(toggleIn(store.wishlist, id) ? 'Added to wishlist' : 'Removed from wishlist'); refreshMarks(); };
  fav._sync = sync;
  sync();
  return [fav, wish];
}
function refreshMarks() {
  document.querySelectorAll('.fav-btn').forEach((b) => b._sync?.());
  if (isOn('account')) renderAccount();
  if (isOn('shop') && shopState.wishOnly) renderShop();
  if (isOn('build') && state.favOnly) applyFilters(true);
}

// ================= Item shop =================
const shopState = { search: '', type: '', wishOnly: false, tracks: false, sort: 'featured', expanded: new Set(), allChips: false, active: '' };

const isTrackEntry = (e) => e.items.length > 0 && e.items.every((i) => i.t === 'jamtrack');
const entryWished = (e) => e.items.some((i) => store.wishlist.includes(i.id));
const tileWidth = (e) => Number(/Size_(\d)_x/.exec(e.tile || '')?.[1] || 1);
const mainItem = (e) => e.items.find((i) => i.t === 'outfit') || e.items[0];
const isBundle = (e) => e.items.length > 1 && !isTrackEntry(e);
const inShopNow = (e) => leavesAt(e.outDate) > Date.now();
const colorMix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, #151820)`;

const SORTS = {
  featured: (a, b) => tileWidth(b) - tileWidth(a) || b.sort - a.sort || b.price - a.price,
  'price-desc': (a, b) => b.price - a.price,
  'price-asc': (a, b) => a.price - b.price,
  leaving: (a, b) => Date.parse(a.outDate) - Date.parse(b.outDate) || b.price - a.price,
};

function shopSections() {
  const q = shopState.search.trim().toLowerCase();
  const entries = (shop.entries || []).filter((e) =>
    (shopState.tracks || shopState.type === 'jamtrack' || !isTrackEntry(e)) &&
    (!shopState.type || e.items.some((i) => i.t === shopState.type)) &&
    (!shopState.wishOnly || entryWished(e)) &&
    (!q || e.name.toLowerCase().includes(q) || e.section.toLowerCase().includes(q) ||
      e.items.some((i) => i.n?.toLowerCase().includes(q) || i.artist?.toLowerCase().includes(q))));

  const bySection = new Map();
  for (const e of entries) {
    if (!bySection.has(e.section)) bySection.set(e.section, []);
    bySection.get(e.section).push(e);
  }
  // Sections with new arrivals first; Jam Tracks, single-car sections and leftovers last.
  const weight = (name, list) =>
    name === 'More items' ? 3 : list.every(isTrackEntry) ? 4 : list.every((e) => e.items.every((i) => i.t === 'car')) ? 2 : 0;
  return [...bySection].map(([name, list]) => ({
    name,
    list: list.sort(SORTS[shopState.sort]),
    newest: Math.max(...list.map((e) => Date.parse(e.inDate))),
    rank: Math.min(...list.map((e) => e.rank)),
    weight: weight(name, list),
  })).sort((a, b) => a.weight - b.weight || b.newest - a.newest || a.rank - b.rank);
}

function renderShopDate() {
  if (!shop.date) return;
  const day = new Date(`${shop.date}T12:00:00Z`);
  const live = shop.date === todayUTC();
  $('#shop-date-main').textContent = day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  $('#shop-date-sub').textContent = `${day.getUTCFullYear()}  ·  ${live ? 'Live shop' : 'Archived shop'}`;
  if (live) {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const mins = Math.max(0, Math.round((next - now) / 6e4));
    const local = new Date(next).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    $('#shop-date-note').textContent = `Resets in ${Math.floor(mins / 60)}h ${mins % 60}m (${local} your time).`;
  } else {
    $('#shop-date-note').textContent = 'Prices and availability reflect this archived rotation.';
  }
}
setInterval(() => { if (isOn('shop')) renderShopDate(); }, 30000);

// Top-left feature: the bundle with the biggest saving today.
function featureBundle(entries) {
  const bundles = entries.filter((e) => isBundle(e) && e.items.some((i) => i.t === 'outfit'));
  const pool = bundles.length ? bundles : entries.filter((e) => !isTrackEntry(e));
  return pool.sort((a, b) => (b.regularPrice - b.price) - (a.regularPrice - a.price) || b.price - a.price)[0];
}
// Top-right feature: always a sidekick. New first, then customizable, then the priciest.
function featureSidekick(entries) {
  const score = (e) => (e.banner === 'New' ? 2 : e.banner === 'Customizable' ? 1 : 0);
  return entries
    .filter((e) => e.items.length > 0 && e.items.every((i) => i.t === 'sidekick'))
    .sort((a, b) => score(b) - score(a) || b.price - a.price)[0];
}

function renderFeatured() {
  const wrap = $('#featured');
  wrap.replaceChildren();
  const entries = shop.entries || [];
  if (!entries.length) return;

  const b = featureBundle(entries);
  if (b) {
    const save = b.regularPrice - b.price;
    const price = el('div', { className: 'price' }, el('strong', { textContent: num(b.price) }), el('span', { textContent: 'V-Bucks' }));
    if (save > 0) price.append(el('s', { textContent: num(b.regularPrice) }));
    const explore = el('button', { type: 'button', className: 'btn-primary' }, 'Explore bundle', img(ICON('arrow-dark'), 18, 18));
    explore.onclick = (ev) => { ev.stopPropagation(); openEntry(b); };
    wrap.append(clickable(el('div', { className: 'feature feature-bundle' },
      el('p', { className: 'kicker', textContent: `${b.section} / Featured bundle` }),
      el('img', { className: 'art', src: b.img, alt: '' }),
      save > 0 ? el('span', { className: 'save', textContent: `Save ${num(save)} V-Bucks` }) : null,
      el('div', { className: 'body' },
        el('div', { className: 'name', textContent: b.name }),
        el('div', { className: 'items', textContent: b.items.length > 1 ? `${b.items.length} items.` : TYPE_LABEL[mainItem(b)?.t] || '' }),
        price, explore)), () => openEntry(b)));
  }

  const s = featureSidekick(entries);
  const card = el('div', { className: 'feature feature-sidekick' }, el('p', { className: 'kicker', textContent: 'SMALL SIDEKICK. BIG PERSONALITY.' }));
  if (s) {
    card.append(el('img', { className: 'art', src: s.img, alt: '' }),
      el('div', { className: 'body' },
        el('div', { className: 'name', textContent: `Meet ${s.name}.` }),
        el('div', { className: 'sub', textContent: s.banner === 'Customizable' ? 'Customizable sidekick' : s.banner === 'New' ? 'New sidekick' : 'Sidekick' }),
        el('div', { className: 'price', textContent: `${num(s.price)} V-Bucks` })),
      el('span', { className: 'round' }, img(ICON('arrow-light'), 20, 20)));
    wrap.append(clickable(card, () => openEntry(s)));
  } else {
    // No sidekick in today's shop: show the newest one and say so.
    const k = catalog.find((x) => x.s === 'sidekick');
    if (!k) return;
    card.append(el('img', { className: 'art', src: imgUrl(k), alt: '' }),
      el('div', { className: 'body' },
        el('div', { className: 'name', textContent: `Meet ${k.n}.` }),
        el('div', { className: 'sub gone', textContent: 'Not in today’s shop' })),
      el('span', { className: 'round' }, img(ICON('arrow-light'), 20, 20)));
    wrap.append(clickable(card, () => tryOn(k)));
  }
}

function offerCard(e) {
  const main = mainItem(e);
  const art = el('div', { className: 'art' }, el('img', { className: 'render', src: e.img, alt: '', loading: 'lazy', decoding: 'async' }));
  if (e.colors?.[0]) {
    art.style.setProperty('--c1', colorMix(e.colors[0], 45));
    art.style.setProperty('--c2', colorMix(e.colors[1] || e.colors[0], 18));
  }
  if (main && byId.has(main.id)) art.append(el('div', { className: 'marks' }, ...markButtons(main.id, true)));
  if (e.banner) art.append(el('span', { className: 'tag', textContent: e.banner }));

  const sub = e.items.length > 1 ? `${e.items.length} items` : main?.artist || TYPE_LABEL[main?.t] || '';
  const price = el('div', { className: 'price-row' }, el('strong', { textContent: num(e.price) }), el('span', { textContent: 'V-Bucks' }));
  if (e.regularPrice > e.price) price.append(el('s', { textContent: num(e.regularPrice) }));
  const left = timeLeft(e.outDate);
  price.append(el('span', { className: 'view' + (/hour/.test(left) ? ' leaves-soon' : ''), textContent: /hour/.test(left) ? left : 'View item ↗' }));
  return clickable(el('div', { className: 'offer-card' }, art,
    el('div', { className: 'info' }, el('div', { className: 'name', textContent: e.name, title: e.name }), el('div', { className: 'sub', textContent: sub }), price)),
  () => openEntry(e));
}

function bundleCard(e, sectionCount, onExplore) {
  const card = el('div', { className: 'bundle-card' });
  if (e.colors?.[0]) card.style.setProperty('--c1', e.colors[0]);
  const price = el('div', { className: 'price' }, el('strong', { textContent: num(e.price) }), el('span', { textContent: 'V-Bucks' }));
  if (e.regularPrice > e.price) price.append(el('s', { textContent: num(e.regularPrice) }));
  const explore = el('button', { type: 'button', className: 'explore' }, `Explore all ${sectionCount} items`, img(ICON('arrow-accent-lg'), 20, 20));
  explore.onclick = (ev) => { ev.stopPropagation(); onExplore(); };
  card.append(el('div', { className: 'name', textContent: e.name }), el('div', { className: 'count-line', textContent: `${e.items.length} items` }), price, explore);
  return clickable(card, () => openEntry(e));
}

function renderShop() {
  renderShopDate();
  renderFeatured();
  const sections = shopSections();
  const chips = $('#collection-chips');
  const wrap = $('#shop-sections');
  chips.replaceChildren();
  wrap.replaceChildren();
  if (!shop.entries?.length) {
    wrap.append(el('p', { className: 'shop-empty', textContent: 'No shop data yet. Run: npm run shop' }));
    return;
  }
  if (!sections.length) {
    wrap.append(el('p', { className: 'shop-empty', textContent: shopState.wishOnly ? 'Nothing from your wishlist is in the shop today.' : 'Nothing matches your search.' }));
    return;
  }

  // Collection chips: the first six, then "More collections" to show the rest.
  if (!sections.some((s) => s.name === shopState.active)) shopState.active = sections[0].name;
  const CHIP_LIMIT = 6;
  sections.forEach((s, i) => {
    if (!shopState.allChips && i >= CHIP_LIMIT) return;
    const chip = el('button', { type: 'button', className: 'chip' + (s.name === shopState.active ? ' active' : ''), textContent: s.name });
    chip.onclick = () => {
      shopState.active = s.name;
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      document.getElementById(`sec-${i}`).scrollIntoView({ behavior: 'smooth' });
    };
    chips.append(chip);
  });
  if (sections.length > CHIP_LIMIT) {
    const more = el('button', { type: 'button', className: 'chip', textContent: shopState.allChips ? 'Fewer collections' : 'More collections' });
    more.onclick = () => { shopState.allChips = !shopState.allChips; renderShop(); };
    chips.append(more);
  }

  sections.forEach((s, i) => {
    const expanded = shopState.expanded.has(s.name);
    const toggle = () => { if (expanded) shopState.expanded.delete(s.name); else shopState.expanded.add(s.name); renderShop(); };
    // A section that contains a bundle leads with the bundle card.
    const lead = shopState.sort === 'featured' && s.list.length > 1 ? s.list.find(isBundle) : null;
    const rest = lead ? s.list.filter((e) => e !== lead) : s.list;
    const limit = lead ? 2 : 4;
    const grid = el('div', { className: 'shop-grid' + (lead ? ' lead-bundle' : '') });
    if (lead) grid.append(bundleCard(lead, s.list.length, () => { if (!expanded) toggle(); }));
    (expanded ? rest : rest.slice(0, limit)).forEach((e) => grid.append(offerCard(e)));

    const head = el('div', { className: 'section-head' },
      el('h2', {}, s.name, el('span', { className: 'count', textContent: s.list.length })));
    if (rest.length > limit) {
      const view = el('button', { type: 'button', className: 'link-accent' },
        expanded ? 'Show less' : el('span', {}, 'View ', el('span', { className: 'long', textContent: `${s.name} ` }), 'collection'), img(ICON('arrow-accent'), 18, 18));
      view.onclick = toggle;
      head.append(view);
    }
    wrap.append(el('section', { className: 'shop-section', id: `sec-${i}` }, head, grid));
  });
}

// ================= Item details pop-up =================
function openEntry(e) {
  const body = $('#entry-body');
  body.replaceChildren();
  const items = e.items;
  const main = mainItem(e);
  const imageFor = (it) => {
    const cat = byId.get(it.id);
    return items.length === 1 || !cat ? e.img : imgUrl(cat);
  };

  // Left: big artwork with a thumbnail per included item
  const big = el('img', { className: 'big', src: imageFor(main), alt: '' });
  const thumbs = el('div', { className: 'entry-thumbs' });
  if (items.length > 1) {
    items.forEach((it) => {
      const t = el('button', { type: 'button', className: it === main ? 'on' : '', title: it.n }, el('img', { src: imageFor(it), alt: it.n }));
      t.onclick = () => { big.src = imageFor(it); thumbs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t)); };
      thumbs.append(t);
    });
  }
  const preview = el('div', { className: 'entry-preview' },
    el('p', { className: 'kicker', textContent: `${TYPE_LABEL[main?.t] || 'Item'} preview` }), big, thumbs,
    el('p', { className: 'caption', textContent: `${e.name}  /  ${items.length} included item${items.length === 1 ? '' : 's'}` }));

  // Right: details
  const close = el('button', { type: 'button', className: 'close', title: 'Close' }, img(ICON('x'), 18, 18));
  close.onclick = () => $('#entry-dialog').close();
  const types = [...new Set(items.map((i) => TYPE_LABEL[i.t] || i.t || 'Item'))];
  const typeLine = types.map((t, i) => (i ? t.toLowerCase() : t)).join(' + ');
  const live = inShopNow(e);
  const price = el('div', { className: 'entry-price' }, el('strong', { textContent: num(e.price) }), el('span', { textContent: 'V-Bucks' }));
  if (e.regularPrice > e.price) price.append(el('s', { textContent: num(e.regularPrice) }));
  // Only one of these shows: the leave date while it's in the shop, the pill once it has left.
  if (!live) price.append(el('span', { className: 'pill', textContent: 'No longer in the shop' }));
  const leaves = leavesAt(e.outDate).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const list = el('div', { className: 'included' });
  for (const it of items) {
    const cat = byId.get(it.id);
    const offer = shop.items[it.id];
    const text = el('div', {}, el('strong', { textContent: it.n }), el('div', { className: 't', textContent: it.artist || TYPE_LABEL[it.t] || it.t || '' }));
    if (offer && it.t !== 'jamtrack') {
      if (!offer.bundle && items.length > 1) text.append(el('div', { className: 'note', textContent: `Also sold separately: ${num(offer.price)} V-Bucks` }));
      const last = itemFacts({ name: it.n, released: cat?.a, ...offer }, { timeZone }).at(-1)[1];
      if (last !== 'Unknown') text.append(el('div', { className: 'note', textContent: `Last time in the shop: ${last}` }));
    }
    const acts = el('div', { className: 'inc-acts' });
    if (cat) {
      acts.append(el('div', { className: 'pair' }, ...markButtons(it.id)));
      if (slotOf(cat.s)) {
        const use = el('button', { type: 'button', className: 'btn-primary', textContent: 'Use in combo' });
        use.onclick = () => { $('#entry-dialog').close(); tryOn(cat); };
        acts.append(use);
      }
    }
    list.append(el('div', { className: 'inc-row' },
      el('div', { className: 'inc-thumb' }, el('img', { src: cat ? imgUrl(cat) : e.img, alt: '' })), text, acts));
  }

  const copy = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Copy link' });
  copy.onclick = async () => {
    const url = `${location.origin}${location.pathname}?view=shop&item=${encodeURIComponent(main?.id || '')}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
  };

  const info = el('div', { className: 'entry-info' }, close,
    el('p', { className: 'kicker', textContent: 'Item details' }),
    el('h3', { textContent: e.name }),
    el('p', { className: 'types', textContent: typeLine }),
    price,
    live ? el('p', { className: 'entry-until', textContent: `In the shop until ${leaves} (${timeLeft(e.outDate)})` }) : null,
    el('hr', { className: 'divider' }),
    el('div', { className: 'included-head' }, el('h4', { textContent: 'Included items' }), el('span', { textContent: `${items.length} item${items.length === 1 ? '' : 's'}` })),
    list,
    el('p', { className: 'entry-history', innerHTML: `Shop history on this site starts ${shop.trackingSince};<br>earlier appearances aren’t shown.` }),
    el('div', { className: 'entry-foot' }, copy, el('span', { textContent: 'Combine items in the combo builder.' })));

  body.append(el('div', { className: 'entry' }, preview, info));
  $('#entry-dialog').showModal();
}

// ================= Combo builder =================
function tryOn(item) {
  state.combo[item.s] = item.id;
  state.slot = item.s;
  state.inspect = 'outfit';
  showView('build');
  renderSlotTabs();
  applyFilters();
}

function renderSlotTabs() {
  const tabs = $('#slot-tabs');
  tabs.replaceChildren();
  for (const s of SLOTS) {
    const b = el('button', { type: 'button', className: 'tab' + (s.key === state.slot ? ' active' : ''), textContent: s.tab, role: 'tab' });
    b.setAttribute('aria-selected', s.key === state.slot);
    b.onclick = () => pickSlot(s.key, false);
    tabs.append(b);
  }
  const s = slotOf(state.slot);
  $('#browser-title').textContent = s.title;
  $('#browser-sub').textContent = s.sub;
  $('#search').placeholder = 'Search by name or set…';
}

function pickSlot(key, scroll = true) {
  if (state.slot !== key) {
    state.slot = key;
    renderSlotTabs();
    applyFilters();
    renderStage();
  }
  if (scroll && matchMedia('(max-width: 900px)').matches) $('.browser').scrollIntoView({ behavior: 'smooth' });
}

function applyFilters(keepPage = false) {
  const q = state.search.trim().toLowerCase();
  let r = catalog.filter((x) =>
    x.s === state.slot &&
    (!state.rarity || x.r === state.rarity) &&
    (!state.inShop || shop.items[x.id]) &&
    (!state.favOnly || store.likes.includes(x.id)) &&
    (!q || x.n.toLowerCase().includes(q) || (x.set && x.set.toLowerCase().includes(q))));
  // Catalog is newest first. "Featured" puts what's in the shop today first.
  if (state.sort === 'featured') r = [...r.filter((x) => shop.items[x.id]), ...r.filter((x) => !shop.items[x.id])];
  if (state.sort === 'old') r = r.slice().reverse();
  if (state.sort === 'az') r = r.slice().sort((a, b) => a.n.localeCompare(b.n));
  state.results = r;
  if (!keepPage) state.page = 0;
  state.page = Math.min(state.page, Math.max(0, Math.ceil(r.length / PAGE) - 1));
  const label = slotOf(state.slot).tab.toLowerCase();
  $('#result-count').textContent = `${num(r.length)} ${r.length === 1 ? slotOf(state.slot).label.toLowerCase() : label === 'back bling' ? 'back blings' : label}`;
  $('#result-hint').textContent = `Select ${/^[aeiou]/i.test(slotOf(state.slot).label) ? 'an' : 'a'} ${slotOf(state.slot).label.toLowerCase()} to equip it`;
  renderGrid();
}

function itemCard(item) {
  const equipped = state.combo[item.s] === item.id;
  const offer = shop.items[item.id];
  const art = el('div', { className: 'art' },
    el('img', { className: 'pic', src: imgUrl(item), alt: '', loading: 'lazy', decoding: 'async' }),
    el('div', { className: 'marks' }, ...markButtons(item.id)));
  if (equipped) art.append(el('span', { className: 'badge' }, img(ICON('check'), 15, 15), 'Equipped'));
  else if (offer) art.append(el('span', { className: 'badge', textContent: 'In shop' }));
  const meta = offer
    ? el('div', { className: 'meta price', textContent: `${num(offer.price)} V-Bucks` })
    : el('div', { className: 'meta', textContent: slotOf(item.s).label });
  const card = el('div', { className: `item-card ${rarityClass(item.r)}${equipped ? ' equipped' : ''}`, title: `${item.n} · ${pretty(item.r)}${item.set ? ' · ' + item.set : ''}` },
    art, el('div', { className: 'name', textContent: item.n }), meta);
  return clickable(card, () => equip(item));
}

function renderGrid() {
  const grid = $('#grid');
  grid.replaceChildren();
  const total = state.results.length;
  const start = state.page * PAGE;
  state.results.slice(start, start + PAGE).forEach((item) => grid.append(itemCard(item)));
  if (!total) grid.append(el('p', { className: 'muted', textContent: state.favOnly ? 'No favorites here yet. Tap ♥ on any item.' : 'Nothing matches your filters.' }));

  $('#pager-text').textContent = total ? `Showing ${num(start + 1)}–${num(Math.min(start + PAGE, total))} of ${num(total)}` : '';
  const pages = Math.ceil(total / PAGE);
  const pager = $('#pager');
  pager.replaceChildren();
  if (pages <= 1) return;
  const go = (p) => { state.page = p; renderGrid(); $('.browser').scrollIntoView({ behavior: 'smooth' }); };
  const prev = el('button', { type: 'button', className: 'edge', title: 'Previous page', disabled: state.page === 0 }, img(ICON('left'), 16, 16));
  prev.onclick = () => go(state.page - 1);
  pager.append(prev);
  // 1 … 4 5 6 … 63
  const shown = new Set([0, pages - 1, state.page - 1, state.page, state.page + 1].filter((p) => p >= 0 && p < pages));
  if (state.page <= 1) shown.add(2);
  let last = -1;
  for (const p of [...shown].sort((a, b) => a - b)) {
    if (p - last > 1) pager.append(el('span', { className: 'gap', textContent: '…' }));
    const b = el('button', { type: 'button', className: p === state.page ? 'on' : '', textContent: p + 1 });
    b.onclick = () => go(p);
    pager.append(b);
    last = p;
  }
  const next = el('button', { type: 'button', className: 'edge', title: 'Next page', disabled: state.page === pages - 1 }, img(ICON('right'), 16, 16));
  next.onclick = () => go(state.page + 1);
  pager.append(next);
}

function equip(item) {
  state.combo[item.s] = state.combo[item.s] === item.id ? undefined : item.id;
  if (state.inspect === item.s && !state.combo[item.s]) state.inspect = 'outfit';
  renderStage();
  renderGrid();
}

const sameCombo = (a, b) => SLOTS.every((s) => (a[s.key] || '') === (b[s.key] || ''));

function renderStage() {
  const equipped = SLOTS.filter((s) => byId.get(state.combo[s.key]));
  if (!state.combo[state.inspect]) state.inspect = 'outfit';
  const shown = byId.get(state.combo[state.inspect]);

  // Heading text and saved status
  $('#build-lead').textContent = equipped.length === SLOTS.length
    ? 'All six pieces selected. Fine-tune your look or save your combo.'
    : 'Start with an outfit. Find the pieces that make it you.';
  const saved = equipped.length && store.combos.some((c) => sameCombo(c.items, state.combo));
  const status = $('#combo-status');
  status.textContent = saved ? 'Saved combo' : 'Unsaved combo';
  status.classList.toggle('saved', !!saved);

  // ----- Combo preview: outfit large, other items as thumbnails -----
  const preview = $('#preview');
  preview.replaceChildren();
  const stage = el('div', { className: 'preview-stage' },
    el('span', { className: 'label', textContent: 'Combo preview' }),
    el('span', { className: 'count-pill', textContent: `${equipped.length} / ${SLOTS.length} items` }));
  if (shown) {
    stage.append(el('img', { className: 'art' + (state.inspect === 'outfit' ? '' : ' item'), src: imgUrl(shown), alt: shown.n }));
    if (state.inspect !== 'outfit' && state.combo.outfit) {
      const back = el('button', { type: 'button', className: 'back', textContent: '← Back to outfit' });
      back.onclick = () => { state.inspect = 'outfit'; renderStage(); };
      stage.append(back);
    }
  } else {
    const start = el('button', { type: 'button', className: 'preview-empty' },
      el('span', { className: 'slot-icon' }, img(ICON('plus'), 20, 20)), 'Choose an outfit to start your combo');
    start.onclick = () => pickSlot('outfit');
    stage.append(start);
  }
  preview.append(stage);

  const others = equipped.filter((s) => s.key !== 'outfit');
  if (others.length) {
    const strip = el('div', { className: 'thumb-strip' });
    for (const s of others) {
      const it = byId.get(state.combo[s.key]);
      const t = el('button', { type: 'button', className: 'thumb' + (state.inspect === s.key ? ' on' : ''), title: `${s.label}: ${it.n}` },
        el('img', { src: imgUrl(it), alt: '' }), el('span', { textContent: s.label }));
      t.onclick = () => { state.inspect = state.inspect === s.key ? 'outfit' : s.key; renderStage(); };
      strip.append(t);
    }
    preview.append(strip);
  }
  if (shown) {
    const offer = shop.items[shown.id];
    preview.append(el('div', { className: 'preview-info' },
      el('div', { style: 'min-width:0' },
        el('div', { className: 'name', textContent: shown.n, title: shown.n }),
        el('div', { className: 'type', textContent: slotOf(state.inspect).label })),
      offer ? el('span', { className: 'shop-chip', textContent: `In shop · ${num(offer.price)} V-Bucks` }) : null));
  }

  // ----- Your loadout: one row per slot -----
  const count = $('#loadout-count');
  count.textContent = `${equipped.length} of ${SLOTS.length} equipped`;
  count.classList.toggle('full', equipped.length === SLOTS.length);
  const list = $('#loadout');
  list.replaceChildren();
  for (const s of SLOTS) {
    const item = byId.get(state.combo[s.key]);
    const thumb = el('span', { className: 'slot-thumb' });
    thumb.append(item ? el('img', { className: 'item', src: imgUrl(item), alt: '', loading: 'lazy' }) : img(ICON(s.icon), 22, 22));
    const acts = el('span', { className: 'slot-acts' });
    if (item) {
      const replace = el('button', { type: 'button', className: 'replace', textContent: 'Replace' });
      replace.onclick = (e) => { e.stopPropagation(); pickSlot(s.key); };
      const remove = el('button', { type: 'button', className: 'icon', title: `Remove ${s.label.toLowerCase()}` }, img(ICON('x'), 18, 18));
      remove.onclick = (e) => { e.stopPropagation(); state.combo[s.key] = undefined; renderStage(); renderGrid(); };
      acts.append(replace, remove);
    } else {
      const add = el('button', { type: 'button', className: 'icon', title: `Choose ${s.label.toLowerCase()}` }, img(ICON('plus'), 20, 20));
      add.onclick = (e) => { e.stopPropagation(); pickSlot(s.key); };
      acts.append(add);
    }
    const li = el('li', { className: 'slot-row' + (state.slot === s.key ? ' active' : '') }, thumb,
      el('div', { style: 'min-width:0' },
        el('div', { className: 'slot-label', textContent: s.label }),
        el('div', { className: 'slot-name' + (item ? '' : ' empty'), textContent: item ? item.n : `Choose ${/^[aeiou]/i.test(s.label) ? 'an' : 'a'} ${s.label.toLowerCase()}` })),
      acts);
    list.append(clickable(li, () => pickSlot(s.key)));
  }
  writeHash();
}

function comboToHash(combo) {
  return SLOTS.filter((s) => combo[s.key]).map((s) => `${s.key}=${encodeURIComponent(combo[s.key])}`).join('&');
}
function writeHash() {
  const h = comboToHash(state.combo);
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}
function readHash(params = new URLSearchParams(location.hash.slice(1))) {
  const combo = {};
  for (const s of SLOTS) {
    // Links made before the Pet slot became Sidekick use "pet".
    const id = params.get(s.key) || (s.key === 'sidekick' ? params.get('pet') : null);
    if (id && byId.get(id)?.s === s.key) combo[s.key] = id;
  }
  return combo;
}

function randomCombo() {
  const pick = (slot) => {
    const pool = catalog.filter((x) => x.s === slot);
    return pool[Math.floor(Math.random() * pool.length)].id;
  };
  state.combo = Object.fromEntries(SLOTS.map((s) => [s.key, pick(s.key)]));
  state.inspect = 'outfit';
  renderStage();
  renderGrid();
}

// Share links put the combo in the query string (not the #hash) so the server can see it and give
// the link a preview picture in Discord, iMessage, X and so on (see server.mjs and the combo-card function).
// Older #outfit=… links still open in the builder.
const shareUrl = (combo) => `${new URL('./', document.baseURI).href}?view=build&${comboToHash(combo)}`;
async function copyLink(combo) {
  const url = shareUrl(combo);
  // Phones and tablets: the system share sheet. Elsewhere: copy to the clipboard.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    const outfit = byId.get(combo.outfit);
    try { await navigator.share({ title: outfit ? `${outfit.n} combo` : 'My combo', url }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch { prompt('Copy this link:', url); }
}

// ================= My account =================
function miniCard(item) {
  const art = el('div', { className: 'art' },
    el('img', { className: 'pic', src: imgUrl(item), alt: '', loading: 'lazy' }),
    el('div', { className: 'marks' }, ...markButtons(item.id)));
  const meta = [seriesLabel(item.sr), slotOf(item.s)?.label].filter(Boolean).join(' · ');
  return clickable(el('div', { className: `mini-card ${rarityClass(item.r)}` }, art,
    el('div', { className: 'name', textContent: item.n }), el('div', { className: 'meta', textContent: meta })), () => tryOn(item));
}

function renderAccount() {
  const wish = store.wishlist.map((id) => byId.get(id)).filter(Boolean);
  const favs = store.likes.map((id) => byId.get(id)).filter(Boolean);
  const plural = (n, one, many) => (n === 1 ? one : many);
  $('#stat-combos').textContent = store.combos.length;
  $('#stat-combos-l').textContent = plural(store.combos.length, 'Saved combo', 'Saved combos');
  $('#stat-wish').textContent = wish.length;
  $('#stat-wish-l').textContent = plural(wish.length, 'Wishlisted item', 'Wishlisted items');
  $('#stat-fav').textContent = favs.length;
  $('#combo-count').textContent = `${store.combos.length} ${plural(store.combos.length, 'combo', 'combos')}`;

  // Saved combos
  const combos = $('#saved-combos');
  combos.replaceChildren();
  if (!store.combos.length) {
    const build = el('button', { type: 'button', className: 'btn-primary' }, 'Build a combo', img(ICON('arrow-build'), 12, 11));
    build.onclick = () => showView('build');
    combos.append(el('div', { className: 'panel empty-state' },
      el('p', { className: 'eyebrow small', textContent: 'Your next great look starts here' }),
      el('h3', { textContent: 'A little mixing. A lot of you.' }),
      el('p', { className: 'muted', textContent: 'No saved combos yet. Build one and press “Save combo”.' }),
      build));
  } else {
    const grid = el('div', { className: 'combo-cards' });
    for (const c of store.combos) {
      const thumbs = el('div', { className: 'thumbs' });
      for (const s of SLOTS) {
        const it = byId.get(c.items[s.key]);
        if (it) thumbs.append(el('img', { src: imgUrl(it), alt: it.n, title: `${s.label}: ${it.n}`, loading: 'lazy' }));
      }
      const open = el('button', { type: 'button', className: 'btn-primary', textContent: 'Open' });
      open.onclick = () => { state.combo = { ...c.items }; state.inspect = 'outfit'; $('#combo-name').value = c.name; showView('build'); applyFilters(); };
      const share = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Copy link' });
      share.onclick = () => copyLink(c.items);
      const del = el('button', { type: 'button', className: 'text-btn clear', textContent: 'Delete' });
      del.onclick = () => { store.combos = store.combos.filter((x) => x.id !== c.id); saveStore(); renderAccount(); };
      grid.append(el('div', { className: 'panel combo-card' }, el('h3', { textContent: c.name }), thumbs, el('div', { className: 'acts' }, open, share, del)));
    }
    combos.append(grid);
  }

  const fill = (sel, countSel, items, emptyText) => {
    const g = $(sel);
    g.replaceChildren();
    $(countSel).textContent = items.length;
    if (!items.length) g.append(el('p', { className: 'empty-msg', textContent: emptyText }));
    items.forEach((it) => g.append(miniCard(it)));
  };
  fill('#wishlist-grid', '#wish-count', wish, 'Your wishlist is empty. Tap ☆ on any item to get shop alerts.');
  fill('#liked-grid', '#fav-count', favs, 'No favorites yet. Tap ♡ on any item.');

  renderAlerts(wish);
}

function renderAlerts(wish) {
  const a = store.alerts;
  const email = store.account?.email || '';
  $('#alert-email').textContent = email;
  $('#account-email').textContent = email && `Signed in as ${email}`;
  $('#alert-on').checked = !!a?.on;
  $('#alert-status').textContent = a?.on ? 'Alerts are on.' : 'Alerts are off.';

  // Shop check for today's (or the latest recorded) rotation
  const date = shop.date ? new Date(`${shop.date}T12:00:00Z`) : null;
  $('#check-date').textContent = `Shop check · ${date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'no data'}`;
  const inShop = wish.filter((it) => shop.items[it.id]);
  if (!wish.length) {
    $('#check-title').textContent = 'Nothing to check yet';
    $('#check-text').textContent = 'Add items to your wishlist and we’ll check every shop for them.';
  } else if (inShop.length) {
    $('#check-title').textContent = `${inShop.length} wishlist ${inShop.length === 1 ? 'item' : 'items'} in the shop`;
    $('#check-text').textContent = `${inShop.length} of your ${wish.length} wishlisted items ${inShop.length === 1 ? 'is' : 'are'} in the shop (${shop.date}).`;
  } else {
    $('#check-title').textContent = 'Not in this rotation';
    $('#check-text').textContent = `None of your ${wish.length} wishlisted items are in today’s shop (${shop.date}).`;
  }
}

// ================= Sign up & Log in =================
// Prototype only: there is no server-side account yet. "Signing in" just remembers the email in
// localStorage; the real site will use Supabase Auth (passwords never touch our own code).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST = { signup: ['Already have an account?', 'Log in', 'login'], login: ['New to FortifyMe?', 'Sign up', 'signup'] };
const SIGNUP_PREVIEWS = [ // fixed artwork backgrounds from the Figma sign-up frame
  ['CID_844_Athena_Commando_F_HightowerMango', '#214c59'],
  ['Character_OpenEnded', '#2a3245'],
  ['CID_665_Athena_Commando_F_NeonGraffiti', '#443055'],
];
let afterLogin = 'account';

function renderSignupPreviews() {
  const box = $('#signup-previews');
  box.replaceChildren();
  for (const [id, bg] of SIGNUP_PREVIEWS) {
    const item = byId.get(id);
    if (!item) continue;
    const meta = [seriesLabel(item.sr), slotOf(item.s)?.label].filter(Boolean).join(' · ');
    const art = el('div', { className: 'art' }, el('img', { src: imgUrl(item), alt: item.n, loading: 'lazy' }));
    art.style.background = bg;
    box.append(el('div', { className: 'auth-preview' }, art,
      el('div', { className: 'name', textContent: item.n }),
      el('div', { className: 'meta', textContent: meta })));
  }
}

// ================= Accounts (Supabase Auth) =================
// Sign-in is Supabase Auth. Each account's locker (favorites, wishlist, saved combos, alert settings)
// is a row in public.lockers; Row Level Security lets people read and write only their own.
// localStorage keeps a copy, so guests can use everything and signed-in pages load instantly.
const SITE_ROOT = new URL('./', document.baseURI).href; // e.g. http://localhost:5173/
const authRedirect = (view) => `${SITE_ROOT}?view=${view}`;

// Email links (confirm sign-up, reset password) come back with the session in the URL hash,
// which the builder also uses for combos. Take it before anything rewrites the hash.
const AUTH_LINK = (() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error_description')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return Object.fromEntries(h);
})();

let sb = null;
const sbReady = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
  .then(({ createClient }) => (sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })))
  .catch((err) => { console.error('Sign-in unavailable:', err); return null; });
let authSettled = false;

// Restores the saved session (or the one from an email link). Resolves to { recovery } when the
// visitor arrived from a reset-password email.
async function authInit() {
  const client = await sbReady;
  let recovery = false;
  if (client && AUTH_LINK?.access_token) {
    const { error } = await client.auth.setSession({ access_token: AUTH_LINK.access_token, refresh_token: AUTH_LINK.refresh_token });
    if (error) toast('That link didn’t work. It may have expired.');
    else recovery = AUTH_LINK.type === 'recovery';
  } else if (AUTH_LINK?.error_description) {
    toast(AUTH_LINK.error_description.replace(/\+/g, ' ')); // e.g. "Email link is invalid or has expired"
  }
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session) await onSignedIn(data.session.user);
    if (AUTH_LINK?.type === 'signup' && data.session) toast('Email confirmed. Welcome to your locker!');
    // Other tabs logging in or out. (Never await Supabase calls inside this callback.)
    client.auth.onAuthStateChange((event, session) => setTimeout(() => {
      if (event === 'SIGNED_OUT') onSignedOut();
      else if (event === 'SIGNED_IN' && session && session.user.id !== store.account?.id) onSignedIn(session.user);
      else if (event === 'USER_UPDATED' && session && store.account) store.account.email = session.user.email;
    }));
  }
  authSettled = true;
  syncAuth();
  return { recovery };
}
const authDone = authInit();

function syncAuth() {
  document.body.classList.toggle('signed-in', !!store.account);
}

const union = (a, b) => [...new Set([...a, ...b])];
function mergeCombos(remote, local) {
  const ids = new Set(remote.map((c) => c.id));
  return [...remote, ...local.filter((c) => !ids.has(c.id))].slice(0, 200);
}

// Loads the account's locker. The first time a browser's guest data meets an account, it's merged in;
// after that the account is the source of truth and this browser just keeps a copy.
async function onSignedIn(user) {
  store.account = { id: user.id, email: user.email };
  syncAuth();
  subscriptionCheck = refreshSubscription();
  const { data, error } = await sb.from('lockers').select('likes,wishlist,combos,alerts_on,time_zone').eq('user_id', user.id).maybeSingle();
  if (error) {
    toast('Couldn’t load your locker. Check your connection and refresh.');
    return;
  }
  const remote = { likes: data?.likes ?? [], wishlist: data?.wishlist ?? [], combos: data?.combos ?? [] };
  const guest = store.owner == null;
  const next = guest
    ? { likes: union(remote.likes, store.likes), wishlist: union(remote.wishlist, store.wishlist), combos: mergeCombos(remote.combos, store.combos) }
    : remote; // this copy was another visit's (or another account's): the account wins
  const grew = !data || next.likes.length !== remote.likes.length || next.wishlist.length !== remote.wishlist.length || next.combos.length !== remote.combos.length;
  Object.assign(store, next, { owner: user.id, alerts: { on: !!data?.alerts_on, email: user.email, timeZone: data?.time_zone || timeZone } });
  saveStore();
  if (!grew) clearTimeout(pushTimer); // nothing new to upload
  if (guest && grew && (store.likes.length || store.wishlist.length || store.combos.length)) toast('Your saved items were added to your account');
  refreshMarks();
  if (isOn('account')) renderAccount();
  if (isOn('build')) renderStage();
}

function onSignedOut() {
  if (!store.account) return;
  clearTimeout(pushTimer);
  // The locker lives in the account now; don't leave a copy for the next person on this device.
  Object.assign(store, { account: null, owner: null, likes: [], wishlist: [], combos: [], alerts: null });
  saveStore();
  syncAuth();
  subscription = null;
  if (adFree) setAdFree(false);
  refreshMarks();
  if (isOn('account') || isOn('reset')) showView('shop');
}

// Favorites, wishlist and combos upload a moment after each change. Alert settings are saved only
// from the Save preferences button, so a stale tab can't switch alerts back on after an unsubscribe.
let pushTimer;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushLocker, 700);
}
async function pushLocker() {
  clearTimeout(pushTimer);
  if (!sb || !store.account) return;
  const row = { likes: store.likes, wishlist: store.wishlist, combos: store.combos };
  const { data, error } = await sb.from('lockers').update(row).eq('user_id', store.account.id).select('user_id');
  let err = error;
  if (!err && !data.length) ({ error: err } = await sb.from('lockers').insert({ user_id: store.account.id, ...row }));
  if (err) {
    console.error(err);
    toast('Couldn’t save to your account. Check your connection.');
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && pushTimer) pushLocker(); });

// Plain-English versions of Supabase Auth errors.
function authMessage(err) {
  const m = err?.message || '';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Log in instead.';
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match.';
  if (/not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent when you signed up.';
  if (err?.status === 429 || /rate limit|too many|security purposes/i.test(m)) return 'Too many tries. Wait a few minutes, then try again.';
  if (/not authorized/i.test(m)) return 'We can’t send email to that address yet. Please try again later.';
  if (/different from the old/i.test(m)) return 'Choose a password you haven’t used here before.';
  if (/password/i.test(m) && /(least|weak|short|pwned|guess)/i.test(m)) return 'Choose a longer, harder-to-guess password.';
  if (/fetch|network/i.test(m)) return 'Couldn’t reach the server. Check your connection.';
  return m || 'Something went wrong. Please try again.';
}

// Shows (or clears, with no msg) the form's message line and marks the bad field.
// ok = a confirmation rather than an error. action = optional { label, onClick } button after the text.
function formError(form, input, msg, { ok = false, action } = {}) {
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  const line = form.querySelector('.auth-error');
  line.textContent = msg || '';
  line.classList.toggle('ok', ok);
  if (action) {
    const b = el('button', { type: 'button', className: 'link-btn', textContent: action.label });
    b.onclick = action.onClick;
    line.append(b);
  }
  if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
}

function busy(form, on, label) {
  const btn = form.querySelector('.auth-submit');
  btn.dataset.label ??= btn.textContent;
  btn.disabled = on;
  btn.textContent = on ? label : btn.dataset.label;
}

function resetPasswordToggles(scope = document) {
  scope.querySelectorAll('.pw-toggle').forEach((b) => {
    $(`#${b.getAttribute('aria-controls')}`).type = 'password';
    b.textContent = 'Show';
    b.setAttribute('aria-pressed', 'false');
  });
}

async function needClient(form) {
  const client = await sbReady;
  if (!client) formError(form, null, 'Accounts aren’t available right now. Check your connection and refresh.');
  return client;
}

function afterSignIn() {
  const next = afterLogin;
  afterLogin = 'account';
  showView(next);
}

async function submitSignup(ev) {
  ev.preventDefault();
  const form = ev.target;
  const email = $('#signup-email').value.trim();
  const password = $('#signup-password').value;
  if (!EMAIL_RE.test(email)) return formError(form, $('#signup-email'), 'Enter a valid email address.');
  if (password.length < 12) return formError(form, $('#signup-password'), 'Your password needs at least 12 characters.');
  formError(form);
  const client = await needClient(form);
  if (!client) return;
  const alerts = $('#signup-alerts').checked;
  busy(form, true, 'Creating account…');
  const { data, error } = await client.auth.signUp({
    email,
    password,
    // The database turns these into the new locker's alert setting and time zone.
    options: { emailRedirectTo: authRedirect('account'), data: { alerts, time_zone: timeZone } },
  });
  busy(form, false);
  if (error) return formError(form, null, authMessage(error));
  form.reset();
  resetPasswordToggles(form);
  if (data.session) { // email confirmation is switched off in Supabase
    await onSignedIn(data.user);
    toast(alerts ? 'Account created. Wishlist alerts are on.' : 'Account created');
    return afterSignIn();
  }
  showSignupSent(email);
}

function showSignupSent(email) {
  $('#sent-email').textContent = email;
  $('#sent-error').textContent = '';
  $('#signup-form').classList.add('hidden');
  $('#signup-sent').classList.remove('hidden');
  $('#signup-sent').dataset.email = email;
}
function hideSignupSent() {
  $('#signup-form').classList.remove('hidden');
  $('#signup-sent').classList.add('hidden');
}

async function resendConfirmation(email, where) {
  const client = await sbReady;
  if (!client) return;
  const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirect('account') } });
  where(error ? authMessage(error) : `Sent. Check ${email} for the new link.`, !error);
}

async function submitLogin(ev) {
  ev.preventDefault();
  const form = ev.target;
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!EMAIL_RE.test(email)) return formError(form, $('#login-email'), 'Enter a valid email address.');
  if (!password) return formError(form, $('#login-password'), 'Enter your password.');
  formError(form);
  const client = await needClient(form);
  if (!client) return;
  busy(form, true, 'Logging in…');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  busy(form, false);
  if (error) {
    const unconfirmed = /not confirmed/i.test(error.message);
    return formError(form, null, authMessage(error), unconfirmed ? {
      action: { label: 'Send the link again', onClick: () => resendConfirmation(email, (msg, ok) => formError(form, null, msg, { ok })) },
    } : {});
  }
  form.reset();
  resetPasswordToggles(form);
  await onSignedIn(data.user);
  toast('Welcome back');
  afterSignIn();
}

async function forgotPassword() {
  const form = $('#login-form');
  const email = $('#login-email').value.trim();
  if (!EMAIL_RE.test(email)) return formError(form, $('#login-email'), 'Enter your email address above, then press “Forgot password?” again.');
  const client = await needClient(form);
  if (!client) return;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: authRedirect('reset') });
  if (error) return formError(form, null, authMessage(error));
  formError(form, null, `If there’s an account for ${email}, we’ve emailed it a link to reset the password.`, { ok: true });
}

async function submitReset(ev) {
  ev.preventDefault();
  const form = ev.target;
  const password = $('#reset-password').value;
  if (password.length < 12) return formError(form, $('#reset-password'), 'Your password needs at least 12 characters.');
  formError(form);
  const client = await needClient(form);
  if (!client) return;
  busy(form, true, 'Saving…');
  const { error } = await client.auth.updateUser({ password });
  busy(form, false);
  if (error) return formError(form, null, authMessage(error));
  form.reset();
  resetPasswordToggles(form);
  toast('Password updated');
  showView('account');
}

async function logOut() {
  if (pushTimer) await pushLocker(); // don't lose the last change
  await sb?.auth.signOut();
  onSignedOut();
  showView('shop');
  toast('Logged out. Your locker is saved to your account.');
}

// ================= Ads and the ad-free subscription =================
// Ads load only when config.js has an AdSense ID, and never for ad-free subscribers: the AdSense
// script isn't added at all for them (hiding ads that were loaded would break AdSense policy).
// We wait for the sign-in check first, and remember the answer so subscribers don't see a flash of ads.
const AD_FREE_KEY = 'comboLocker.adFree';
const AD_FREE_STATUSES = ['active', 'trialing', 'past_due']; // past_due: Stripe is still retrying the card
let adFree = (() => { try { return BILLING_ENABLED && localStorage.getItem(AD_FREE_KEY) === '1'; } catch { return false; } })();
let subscription = null; // the account's row in public.subscriptions
let subscriptionCheck = Promise.resolve();
let adsLoaded = false;

function setAdFree(on) {
  adFree = on;
  try { on ? localStorage.setItem(AD_FREE_KEY, '1') : localStorage.removeItem(AD_FREE_KEY); } catch {}
  document.body.classList.toggle('ad-free', on);
  if (on) document.querySelectorAll('.ad-slot').forEach((s) => { s.classList.add('hidden'); s.querySelector('.ad-box').replaceChildren(); });
  else if (authSettled) maybeLoadAds();
}

async function refreshSubscription() {
  if (!BILLING_ENABLED || !sb || !store.account) return;
  const { data, error } = await sb.from('subscriptions')
    .select('status,current_period_end,cancel_at_period_end').eq('user_id', store.account.id).maybeSingle();
  if (error) return; // keep the remembered answer
  subscription = data;
  setAdFree(!!data && AD_FREE_STATUSES.includes(data.status));
  if (isOn('account')) renderBilling();
}

function maybeLoadAds() {
  if (!ADSENSE_CLIENT || adFree || adsLoaded) return;
  adsLoaded = true;
  // Personalized ads only with a "yes" in the cookie banner (and no Global Privacy Control signal).
  // In the EEA, UK and Switzerland, Google's own consent message (set up in AdSense) also applies.
  (window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = window.comboConsent().ads ? 0 : 1;
  document.head.append(el('script', {
    async: true, crossOrigin: 'anonymous',
    src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`,
  }));
  fillAds();
}

// Adds an ad unit to each slot on the page being shown (AdSense can't fill a hidden slot).
function fillAds() {
  if (!adsLoaded || adFree) return;
  for (const slot of document.querySelectorAll('.ad-slot')) {
    const id = AD_SLOTS[slot.dataset.ad];
    if (!id || slot.closest('.view.hidden')) continue;
    slot.classList.remove('hidden');
    slot.querySelector('.ad-remove').classList.toggle('hidden', !BILLING_ENABLED);
    const box = slot.querySelector('.ad-box');
    if (box.firstChild) continue;
    const ins = el('ins', { className: 'adsbygoogle' });
    Object.assign(ins.dataset, { adClient: ADSENSE_CLIENT, adSlot: id, adFormat: 'auto', fullWidthResponsive: 'true' });
    ins.style.display = 'block';
    box.append(ins);
    try { window.adsbygoogle.push({}); } catch (e) { console.warn('Ad slot:', e); }
  }
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function renderBilling() {
  $('#adfree-section').classList.toggle('hidden', !BILLING_ENABLED);
  if (!BILLING_ENABLED) return;
  const s = subscription;
  const active = !!s && AD_FREE_STATUSES.includes(s.status);
  $('#adfree-title').textContent = active ? 'You’re ad-free.' : 'Hide every ad.';
  $('#adfree-text').textContent = !active
    ? 'Browse without ads on every device you log in to, and help keep FortifyMe running. Every feature stays free either way.'
    : s.status === 'past_due' ? 'Your last payment didn’t go through. Update your card under Manage subscription to stay ad-free.'
    : s.cancel_at_period_end && s.current_period_end ? `Canceled. You stay ad-free until ${fmtDay(s.current_period_end)}.`
    : s.current_period_end ? `Thanks for supporting the site! Renews on ${fmtDay(s.current_period_end)}.`
    : 'Thanks for supporting the site!';
  const plans = $('#adfree-plans');
  plans.classList.toggle('hidden', active);
  if (!plans.firstChild) {
    for (const [key, p] of Object.entries(PLANS)) {
      plans.append(el('button', { className: key === 'monthly' ? 'btn-primary wide' : 'btn-secondary wide', onclick: (e) => startBilling(e.currentTarget, 'checkout', key) },
        `${p.label} · ${p.price}`, el('span', { className: 'per', textContent: p.per })));
    }
  }
  // Anyone who has been a customer can see invoices or resubscribe through the portal.
  $('#btn-billing-portal').classList.toggle('hidden', !s || s.status === 'none');
}

async function startBilling(btn, action, plan) {
  const { data } = (await sb?.auth.getSession()) ?? {};
  const token = data?.session?.access_token;
  if (!token) return showView('login');
  btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/billing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, plan }),
    });
    const out = await res.json().catch(() => ({}));
    if (out.url) { location.href = out.url; return; } // off to Stripe
    toast(out.error || 'Billing is unavailable right now. Try again later.');
  } catch {
    toast('Couldn’t reach billing. Check your connection.');
  }
  btn.disabled = false;
}

// Back from Stripe Checkout (?billing=success|cancel). The webhook can take a few seconds,
// so check the subscription a few times before giving up.
async function billingReturn(result) {
  const params = new URLSearchParams(location.search);
  params.delete('billing');
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
  if (result === 'cancel') return toast('Checkout canceled. Nothing was charged.');
  if (result !== 'success') return;
  toast('Thanks! Turning off ads…');
  for (let i = 0; i < 8 && !adFree; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    await refreshSubscription();
  }
  toast(adFree ? 'You’re ad-free. Thanks for supporting the site!' : 'Payment received. Ads will turn off in a minute; refresh if they don’t.');
}

// ================= Cookie consent =================
// Essential storage (the locker, the consent choice, sign-in) is always on. Analytics and
// personalized ads must wait for a "yes": future loaders should check window.comboConsent()
// and listen for the "consentchange" event before adding any tag.
const CONSENT_KEY = 'comboLocker.consent';
const CONSENT_VERSION = 1;
const gpc = navigator.globalPrivacyControl === true;
let consent = null;
try {
  const c = JSON.parse(localStorage.getItem(CONSENT_KEY));
  if (c?.v === CONSENT_VERSION) consent = c;
} catch {}
window.comboConsent = () => ({
  decided: !!consent,
  analytics: !!consent?.analytics,
  ads: !!consent?.ads && !gpc, // Global Privacy Control means no personalized ads
});

function setConsent(analytics, ads) {
  consent = { v: CONSENT_VERSION, analytics, ads, date: new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch {}
  window.dispatchEvent(new CustomEvent('consentchange', { detail: window.comboConsent() }));
  $('#consent').classList.add('hidden');
  toast('Cookie choices saved');
}
function setManaging(on) {
  $('#consent').classList.toggle('managing', on);
  $('#consent-opts').classList.toggle('hidden', !on);
  $('#consent-manage').textContent = on ? 'Save choices' : 'Customize';
}
function openConsent(manage = false) {
  $('#consent-analytics').checked = !!consent?.analytics;
  $('#consent-ads').checked = !!consent?.ads && !gpc;
  $('#consent').classList.remove('hidden');
  setManaging(manage);
}

// ================= Views =================
const VIEWS = ['shop', 'build', 'account', 'contact', 'signup', 'login', 'privacy', 'terms', 'notfound', 'reset', 'alerts-off'];
// The server marks a missing page (e.g. /shopp) with this meta tag and a 404 status.
let badPath = !!document.querySelector('meta[name="http-status"][content="404"]');
const SITE_TITLE = document.title;
function showView(name) {
  document.title = name === 'notfound' ? `Page not found · ${SITE_TITLE}` : SITE_TITLE;
  // My account (and setting a new password) need a sign-in; come back afterwards.
  if ((name === 'account' || name === 'reset') && !store.account) {
    if (!authSettled) { authDone.then(() => showView(name)); return; } // still checking for a saved session
    afterLogin = 'account';
    name = 'login';
  }
  if (name === 'signup') hideSignupSent();
  if (name === 'reset') $('#reset-username').value = store.account?.email || '';
  const guest = GUEST[name];
  document.body.classList.toggle('guest', !!guest);
  if (guest) {
    $('#guest-q').textContent = guest[0];
    $('#guest-btn').textContent = guest[1];
    $('#guest-btn').dataset.view = guest[2];
  }
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  for (const v of VIEWS) $(`#view-${v}`).classList.toggle('hidden', v !== name);
  fillAds();
  if (name === 'account') { renderAccount(); renderBilling(); }
  else if (name === 'shop') renderShop();
  else if (name === 'build') renderStage();
  else if (name === 'contact' && !$('#contact-email').value && store.alerts?.email) $('#contact-email').value = store.alerts.email;
  else if (guest) document.querySelectorAll('.auth-error').forEach((e) => (e.textContent = ''));
  // Keep the view in the address (?view=shop) so links and refreshes land on the same page.
  // The 404 page keeps the bad address visible; leaving it goes back to the site's real path.
  if (name !== 'notfound') {
    const params = new URLSearchParams(location.search);
    if (params.get('view') !== name) params.delete('item');
    params.set('view', name);
    const path = badPath ? document.baseURI.replace(location.origin, '') : location.pathname;
    badPath = false;
    history.replaceState(null, '', `${path}?${params}${name === 'build' ? location.hash : ''}`);
  }
  window.scrollTo(0, 0);
}

// ---------- contact ----------
// Posts to the local server (server.mjs saves it to out/messages/). The real site will send it on by email.
async function sendContact(ev) {
  ev.preventDefault();
  const form = ev.target;
  const msg = Object.fromEntries(new FormData(form));
  msg.name = msg.name.trim(); msg.email = msg.email.trim(); msg.message = msg.message.trim();
  const status = $('#contact-status');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email)) { $('#contact-email').focus(); return toast('Enter a valid email'); }
  if (msg.message.length < 10) { $('#contact-message').focus(); return toast('Add a bit more to your message'); }
  const btn = $('#contact-send');
  btn.disabled = true;
  status.textContent = 'Sending…';
  try {
    const res = await fetch('api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...msg, page: location.href }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    form.reset();
    if (store.alerts?.email) $('#contact-email').value = store.alerts.email;
    status.textContent = "Thanks! Your message was sent. We'll reply by email if it needs an answer.";
    toast('Message sent');
  } catch (err) {
    status.textContent = `Couldn't send your message (${err.message}). Please try again.`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- wiring ----------
function pressToggle(btn, on) { btn.setAttribute('aria-pressed', on); }

function wire() {
  document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  document.querySelectorAll('.view-link').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showView(a.dataset.view); }));
  document.querySelectorAll('.soon').forEach((a) => (a.onclick = (e) => { e.preventDefault(); toast('Coming soon'); }));
  $('#nav-wishlist').onclick = () => { showView('account'); if (store.account) $('#wishlist-section').scrollIntoView(); };
  $('#contact-form').onsubmit = sendContact;

  // Sign up, log in, log out
  $('#signup-form').onsubmit = submitSignup;
  $('#login-form').onsubmit = submitLogin;
  document.querySelectorAll('.pw-toggle').forEach((b) => (b.onclick = () => {
    const input = $(`#${b.getAttribute('aria-controls')}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', show);
  }));
  $('#reset-form').onsubmit = submitReset;
  $('#btn-forgot').onclick = forgotPassword;
  $('#btn-logout').onclick = logOut;
  $('#btn-resend').onclick = () => resendConfirmation($('#signup-sent').dataset.email, (msg, ok) => {
    $('#sent-error').textContent = msg;
    $('#sent-error').classList.toggle('ok', ok);
  });
  $('#sent-restart').onclick = (e) => { e.preventDefault(); hideSignupSent(); $('#signup-email').focus(); };

  // Privacy page contents: scroll without touching location.hash (the hash holds the shared combo)
  document.querySelectorAll('.legal-toc a').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    $(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth' });
  }));

  // Cookie consent
  $('#consent-accept').onclick = () => setConsent(true, true);
  $('#consent-reject').onclick = () => setConsent(false, false);
  $('#consent-manage').onclick = () => {
    if ($('#consent').classList.contains('managing')) setConsent($('#consent-analytics').checked, $('#consent-ads').checked);
    else setManaging(true);
  };
  document.querySelectorAll('.consent-link').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openConsent(true); }));

  // Builder
  let t;
  $('#search').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value; applyFilters(); }, 150); };
  $('#rarity').onchange = (e) => { state.rarity = e.target.value; applyFilters(); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; applyFilters(); };
  $('#in-shop').onclick = (e) => { state.inShop = !state.inShop; pressToggle(e.currentTarget, state.inShop); applyFilters(); };
  $('#favorites-only').onclick = (e) => { state.favOnly = !state.favOnly; pressToggle(e.currentTarget, state.favOnly); applyFilters(); };
  $('#btn-random').onclick = randomCombo;
  $('#btn-clear').onclick = () => { state.combo = {}; state.inspect = 'outfit'; $('#combo-name').value = ''; renderStage(); renderGrid(); };
  $('#btn-share').onclick = () => {
    if (!Object.values(state.combo).some(Boolean)) return toast('Pick something first');
    copyLink(state.combo);
  };
  $('#btn-save').onclick = () => {
    if (!state.combo.outfit) return toast('Pick an outfit first');
    const name = $('#combo-name').value.trim() || `${byId.get(state.combo.outfit).n} combo`;
    const items = Object.fromEntries(Object.entries(state.combo).filter(([, v]) => v));
    store.combos.unshift({ id: Date.now().toString(36), name, items, saved: new Date().toISOString() });
    saveStore();
    renderStage();
    toast(store.account ? 'Combo saved to My account' : 'Combo saved on this device. Log in to keep it everywhere.');
  };
  window.addEventListener('hashchange', () => { state.combo = readHash(); renderStage(); renderGrid(); });

  // Account
  // Alerts always go to the account's own (confirmed) email. Saved straight to the account.
  $('#btn-billing-portal').onclick = (e) => startBilling(e.currentTarget, 'portal');

  $('#btn-alert-save').onclick = async (e) => {
    if (!store.account || !sb) return;
    const on = $('#alert-on').checked;
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await sb.from('lockers').update({ alerts_on: on, time_zone: timeZone }).eq('user_id', store.account.id);
    btn.disabled = false;
    if (error) return toast('Couldn’t save your alert settings. Try again.');
    store.alerts = { email: store.account.email, on, timeZone };
    saveStore();
    renderAccount();
    toast(on ? `Alerts on. We’ll email ${store.account.email}.` : 'Alerts turned off');
  };

  // Shop
  let st;
  $('#shop-search').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { shopState.search = e.target.value; renderShop(); }, 150); };
  $('#shop-type').onchange = (e) => { shopState.type = e.target.value; renderShop(); };
  $('#shop-sort').onchange = (e) => { shopState.sort = e.target.value; renderShop(); };
  $('#shop-wish').onclick = (e) => { shopState.wishOnly = !shopState.wishOnly; pressToggle(e.currentTarget, shopState.wishOnly); renderShop(); };
  $('#shop-tracks').onclick = (e) => { shopState.tracks = !shopState.tracks; pressToggle(e.currentTarget, shopState.tracks); renderShop(); };
  $('#all-collections').onclick = () => { shopState.allChips = !shopState.allChips; renderShop(); };
  // Close the item pop-up when clicking the dark backdrop
  $('#entry-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}

async function init() {
  wire();
  syncAuth();
  if (!consent) openConsent();
  $('#result-count').textContent = 'Loading catalog…';
  const params = new URLSearchParams(location.search);
  // Combo share links: ?view=build&outfit=…  Move the combo into the #hash like the builder uses.
  const sharedCombo = SLOTS.some((s) => params.has(s.key) || params.has('pet'));
  if (sharedCombo) {
    const combo = new URLSearchParams();
    for (const key of [...SLOTS.map((s) => s.key), 'pet']) {
      if (params.has(key)) combo.set(key, params.get(key));
      params.delete(key);
    }
    history.replaceState(null, '', `${location.pathname}?${params}#${combo}`);
  }
  let requested = params.get('view');
  if (AUTH_LINK?.type === 'recovery') requested = 'reset';
  // A missing page or an unknown ?view= shows the 404 page instead of quietly landing on the shop.
  const landing = badPath || (requested && !VIEWS.includes(requested)) ? 'notfound'
    : VIEWS.includes(requested) ? requested : location.hash.includes('=') ? 'build' : 'shop';
  if (landing === 'notfound') showView('notfound');

  // Ads wait for the sign-in and subscription check, so subscribers never get the ad code.
  document.body.classList.toggle('ad-free', adFree);
  const billingResult = params.get('billing');
  authDone.then(() => subscriptionCheck).then(() => {
    maybeLoadAds();
    if (billingResult) billingReturn(billingResult);
  });
  if (landing === 'alerts-off' && params.get('bad')) {
    $('#alerts-off-title').textContent = 'That link didn’t work.';
    $('#alerts-off-text').textContent = 'It may be old or already used. Log in and switch off wishlist alerts in My account instead.';
  }

  // Start both downloads; the small shop file usually lands first, so show the shop without
  // waiting for the large catalog.
  // Live data from the site's API first; the copies deployed with the site are the fallback.
  const getJson = async (...urls) => {
    for (const u of urls) {
      try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { /* try the next one */ }
    }
    throw new Error(`Could not load ${urls.join(' or ')}`);
  };
  const catalogReq = getJson('api/cosmetics', 'data/cosmetics.json');
  try { shop = await getJson('api/shop', 'data/shop.json'); } catch { /* shop data is optional */ }
  if (landing === 'shop') showView('shop');

  let data;
  try {
    data = await catalogReq;
  } catch {
    $('#result-count').textContent = 'Could not load the item catalog. Try refreshing the page.';
    return;
  }
  catalog = data.items;
  imgPrefix = data.imgPrefix;
  byId = new Map(catalog.map((x) => [x.id, x]));
  $('#data-date').textContent = `(updated ${data.updated})`;

  const rarities = [...new Set(catalog.map((x) => x.r))].sort((a, b) => {
    const ia = MAIN_RARITIES.indexOf(a), ib = MAIN_RARITIES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const r of rarities) $('#rarity').append(el('option', { value: r, textContent: pretty(r) }));

  state.combo = readHash();
  renderSignupPreviews();
  renderSlotTabs();
  applyFilters();
  renderStage();
  // Landing page: the requested view, else the builder when opening a shared combo link, else the shop.
  // (The shop was already shown above; re-render it now that favorites, wishlist and "Use in combo" can work.)
  showView(landing);

  // ?view=shop&item=<cosmetic id> opens that item's shop offer (shareable "it's in the shop" link)
  const itemId = params.get('item');
  const offer = itemId && shop.entries?.find((e) => e.items.some((i) => i.id === itemId));
  if (offer && requested === 'shop') openEntry(offer);
}

init();
