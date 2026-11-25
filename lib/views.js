// Address, title and description of each page. Shared by the server (lib/page.mjs routes by path and puts
// the tags in the HTML so search engines see them) and app.js (switches pages and updates the tab title).
// path: the page's address (also its canonical link). noindex: kept out of search results (personal or
// one-off pages). Old ?view=<name> links redirect to the path (lib/page.mjs route()).
const SITE = 'FortifyMe';
const DEFAULT_DESCRIPTION = 'Browse the daily Fortnite Item Shop, build outfit combos, and get an email when your wishlist items return.';

export const VIEW_META = {
  shop: {
    path: '/',
    title: `Today’s Fortnite Item Shop & Combo Builder · ${SITE}`,
    description: DEFAULT_DESCRIPTION,
  },
  build: {
    path: '/combo-builder',
    title: `Fortnite Combo Builder: Mix Outfits, Back Blings & Pickaxes · ${SITE}`,
    description: 'Try outfits, back blings, pickaxes, gliders, sidekicks and cars together, save your combos, and share them with a link.',
  },
  contact: {
    path: '/contact',
    title: `Contact · ${SITE}`,
    description: 'Report a bug or wrong shop data, suggest a feature, or ask about sponsorships and privacy.',
  },
  privacy: {
    path: '/privacy',
    title: `Privacy Policy · ${SITE}`,
    description: `What ${SITE} stores, why, and how to see, export or delete your data.`,
  },
  terms: {
    path: '/terms',
    title: `Terms of Service · ${SITE}`,
    description: `The rules for using ${SITE}, accounts, the ad-free subscription and refunds.`,
  },
  account: { path: '/account', title: `My account · ${SITE}`, noindex: true },
  signup: { path: '/signup', title: `Sign up · ${SITE}`, noindex: true },
  login: { path: '/login', title: `Log in · ${SITE}`, noindex: true },
  reset: { path: '/reset-password', title: `Set a new password · ${SITE}`, noindex: true },
  'alerts-off': { path: '/alerts-off', title: `Wishlist alerts · ${SITE}`, noindex: true },
  notfound: { title: `Page not found · ${SITE}`, noindex: true },
};

// Other addresses that lead to a page (redirected to its path).
export const PATH_ALIASES = { '/shop': 'shop', '/index.html': 'shop', '/builder': 'build' };

// The page at a path ('/contact' -> 'contact'), or null if there is none.
export function viewOfPath(path) {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return Object.keys(VIEW_META).find((v) => VIEW_META[v].path === p) ?? null;
}

export const SITE_NAME = SITE;
export { DEFAULT_DESCRIPTION };
