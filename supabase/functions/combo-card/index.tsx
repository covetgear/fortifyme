/** @jsx React.createElement */
// Share-preview image (1200x630 PNG) for a combo link, used as og:image / twitter:image.
// GET ?outfit=<id>&backbling=<id>&pickaxe=<id>&glider=<id>&sidekick=<id>&vehicle=<id>
// Only item IDs are accepted; names and pictures come from fortnite-api.com, so nobody can put
// their own text or images on a card. Deployed with verify_jwt off: Discord, X and iMessage
// fetch it without a login.
import React from 'https://esm.sh/react@18.2.0';
import { ImageResponse } from 'https://deno.land/x/og_edge@0.0.6/mod.ts';

const SLOTS: [string, string][] = [
  ['outfit', 'Outfit'], ['backbling', 'Back bling'], ['pickaxe', 'Pickaxe'],
  ['glider', 'Glider'], ['sidekick', 'Sidekick'], ['vehicle', 'Vehicle'],
];
const ID = /^[A-Za-z0-9_.\-]{1,100}$/;
// Card artwork backgrounds by rarity (same family as the site's rarity colours)
const RARITY_BG: Record<string, string> = {
  common: '#3a3f48', uncommon: '#2f4a2a', rare: '#20405f', epic: '#3d3054', legendary: '#57391f',
  mythic: '#55491f', marvel: '#5a1f22', dc: '#1f3355', icon: '#1f4a4d', gaminglegends: '#2c2a55',
  starwars: '#2a2a2a', dark: '#3b1f4f', frozen: '#28485c', lava: '#5a2a1f', shadow: '#2a2a2f', slurp: '#1f4f4a',
};

type Item = { slot: string; label: string; name: string; image: string; rarity: string };

const font = (w: number) =>
  fetch(`https://cdn.jsdelivr.net/fontsource/fonts/inter@5.0.18/latin-${w}-normal.woff`).then((r) => r.arrayBuffer());
const fonts = Promise.all([font(500), font(700), font(800)]);
let cars: Promise<Map<string, any>> | null = null;

async function lookup(slot: string, label: string, id: string): Promise<Item | null> {
  try {
    if (slot === 'vehicle') {
      cars ??= fetch('https://fortnite-api.com/v2/cosmetics/cars')
        .then((r) => r.json())
        .then((j) => new Map(j.data.map((c: any) => [c.id.toLowerCase(), c])));
      const c = (await cars).get(id.toLowerCase());
      return c ? { slot, label, name: c.name, image: c.images?.large || c.images?.small, rarity: c.rarity?.value || 'common' } : null;
    }
    const r = await fetch(`https://fortnite-api.com/v2/cosmetics/br/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const d = (await r.json()).data;
    const image = slot === 'outfit' ? d.images?.featured || d.images?.icon : d.images?.icon || d.images?.smallIcon;
    return image ? { slot, label, name: d.name, image, rarity: d.rarity?.value || 'common' } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const asked = SLOTS.map(([slot, label]) => [slot, label, params.get(slot) ?? ''] as const).filter(([, , id]) => ID.test(id));
  const found = (await Promise.all(asked.map(([s, l, id]) => lookup(s, l, id)))).filter(Boolean) as Item[];
  const hero = found.find((i) => i.slot === 'outfit') ?? found[0];
  const rest = found.filter((i) => i !== hero);
  const [f500, f700, f800] = await fonts;

  const brand = (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 12, background: '#d7fb76', color: '#0b0d12', fontSize: 20, fontWeight: 800, alignItems: 'center', justifyContent: 'center' }}>FM</div>
      <div style={{ display: 'flex', marginLeft: 14, fontSize: 28, fontWeight: 700, color: '#f5f6fa' }}>FortifyMe</div>
    </div>
  );

  const card = !hero ? (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: 80, background: '#0b0d12', fontFamily: 'Inter' }}>
      {brand}
      <div style={{ display: 'flex', marginTop: 40, fontSize: 64, fontWeight: 800, color: '#f5f6fa' }}>Build your next combo.</div>
      <div style={{ display: 'flex', marginTop: 16, fontSize: 28, fontWeight: 500, color: '#969caa' }}>Mix outfits, back blings, pickaxes and more.</div>
    </div>
  ) : (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0b0d12', fontFamily: 'Inter' }}>
      <div style={{ display: 'flex', width: 470, height: 630, background: RARITY_BG[hero.rarity] ?? '#2a3245', alignItems: 'flex-end', justifyContent: 'center' }}>
        <img src={hero.image} width={450} height={600} style={{ objectFit: 'contain' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '48px 56px 44px' }}>
        {brand}
        <div style={{ display: 'flex', marginTop: 36, fontSize: 20, fontWeight: 700, color: '#d7fb76', letterSpacing: 2 }}>
          {rest.length ? `${hero.label.toUpperCase()} COMBO · ${found.length} PIECES` : hero.label.toUpperCase()}
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: hero.name.length > 18 ? 48 : 60, fontWeight: 800, color: '#f5f6fa', lineHeight: 1.1 }}>{hero.name}</div>
        <div style={{ display: 'flex', flexWrap: 'nowrap', marginTop: 'auto' }}>
          {rest.slice(0, 5).map((i) => (
            <div key={i.slot} style={{ display: 'flex', flexDirection: 'column', width: 110, marginRight: 12 }}>
              <div style={{ display: 'flex', width: 110, height: 110, borderRadius: 12, background: RARITY_BG[i.rarity] ?? '#20242e', alignItems: 'center', justifyContent: 'center', border: '1px solid #292d38' }}>
                <img src={i.image} width={98} height={98} style={{ objectFit: 'contain' }} />
              </div>
              <div style={{ display: 'flex', marginTop: 10, fontSize: 15, fontWeight: 700, color: '#f5f6fa' }}>{i.name.length > 11 ? i.name.slice(0, 10).trim() + '…' : i.name}</div>
              <div style={{ display: 'flex', marginTop: 2, fontSize: 14, fontWeight: 500, color: '#969caa' }}>{i.label}</div>
            </div>
          ))}
          {!rest.length && <div style={{ display: 'flex', fontSize: 26, fontWeight: 500, color: '#969caa' }}>Mix it with your favorite pieces on FortifyMe.</div>}
        </div>
      </div>
    </div>
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: f500, weight: 500, style: 'normal' },
      { name: 'Inter', data: f700, weight: 700, style: 'normal' },
      { name: 'Inter', data: f800, weight: 800, style: 'normal' },
    ],
    headers: {
      // Same IDs always give the same picture; let crawlers and CDNs keep it.
      'Cache-Control': found.length ? 'public, max-age=604800' : 'public, max-age=300',
    },
  });
});
