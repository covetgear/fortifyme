// Public settings shared by the browser (app.js) and the local server (server.mjs).
// The publishable key is meant to be public: Row Level Security in the database decides what
// each visitor can read or write. Never put the service-role (secret) key here.
export const SUPABASE_URL = 'https://zirktoidxwdivbztzyhg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_0mSGapzYccG5tiIhw7ArsA_nSyP5wpj';

// Google AdSense. Empty = no ads and no ad code anywhere. Once approved, fill in the publisher ID
// (ca-pub-…) and an ad unit ID per placement (AdSense > Ads > By ad unit > Display ads).
// The build also writes /ads.txt from ADSENSE_CLIENT.
export const ADSENSE_CLIENT = '';
export const AD_SLOTS = {
  shop: '',  // Shop page, below the featured tiles
  build: '', // Build page, below the item browser
};

// Ad-free subscription (Stripe, via the billing Edge Function). Turn on after the Stripe secrets
// are set in Supabase. The prices shown here must match the Stripe prices.
export const BILLING_ENABLED = true;
export const PLANS = {
  monthly: { label: 'Monthly', price: '$2.99', per: '/month' },
  yearly: { label: 'Yearly', price: '$24.99', per: '/year' },
};
