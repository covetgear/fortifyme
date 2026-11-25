// Title, description and address of each page (?view=…). Shared by the server (lib/page.mjs puts them
// in the HTML so search engines see them) and app.js (updates the tab title when you switch pages).
// path: the page's canonical address. noindex: kept out of search results (personal or one-off pages).
const SITE = 'FortifyMe';
const DEFAULT_DESCRIPTION = 'Browse the daily Fortnite Item Shop, build outfit combos, and get an email when your wishlist items return.';

export const VIEW_META = {
  shop: {
    path: '/',
    title: `Today’s Fortnite Item Shop & Combo Builder · ${SITE}`,
    description: DEFAULT_DESCRIPTION,
  },
  build: {
    path: '/?view=build',
    title: `Fortnite Combo Builder: Mix Outfits, Back Blings & Pickaxes · ${SITE}`,
    description: 'Try outfits, back blings, pickaxes, gliders, sidekicks and cars together, save your combos, and share them with a link.',
  },
  contact: {
    path: '/?view=contact',
    title: `Contact · ${SITE}`,
    description: 'Report a bug or wrong shop data, suggest a feature, or ask about sponsorships and privacy.',
  },
  privacy: {
    path: '/?view=privacy',
    title: `Privacy Policy · ${SITE}`,
    description: `What ${SITE} stores, why, and how to see, export or delete your data.`,
  },
  terms: {
    path: '/?view=terms',
    title: `Terms of Service · ${SITE}`,
    description: `The rules for using ${SITE}, accounts, the ad-free subscription and refunds.`,
  },
  account: { title: `My account · ${SITE}`, noindex: true },
  signup: { title: `Sign up · ${SITE}`, noindex: true },
  login: { title: `Log in · ${SITE}`, noindex: true },
  reset: { title: `Set a new password · ${SITE}`, noindex: true },
  'alerts-off': { title: `Wishlist alerts · ${SITE}`, noindex: true },
  notfound: { title: `Page not found · ${SITE}`, noindex: true },
};

export const SITE_NAME = SITE;
export { DEFAULT_DESCRIPTION };
