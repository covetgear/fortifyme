// Builds the "your wishlist item is in the shop" email.
// Shared by the browser (preview on My Account) and scripts/send-alerts.mjs (real sends).

const DAY = 864e5;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vbucks = (n) => `${Number(n).toLocaleString('en-US')} V-Bucks`;

// Epic's outDate is the last millisecond the item is on sale (e.g. 23:59:59.999Z),
// so the item leaves at the next shop reset.
export function leavesAt(outDate) {
  return new Date(Date.parse(outDate) + 1);
}

export function timeLeft(outDate, now = Date.now()) {
  const ms = leavesAt(outDate) - now;
  if (ms <= 0) return 'gone';
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.max(1, Math.floor(ms / 36e5));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}

function fmtDate(d, timeZone, withTime) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: withTime ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: withTime ? undefined : 'numeric',
    hour: withTime ? 'numeric' : undefined,
    minute: withTime ? '2-digit' : undefined,
    timeZoneName: withTime ? 'short' : undefined,
  }).format(d);
}

// One line per fact, used in both the HTML and plain-text versions.
export function itemFacts(item, { timeZone = 'UTC', trackingSince, now = Date.now() } = {}) {
  const price = item.regularPrice && item.regularPrice > item.price
    ? `${vbucks(item.price)} (normally ${vbucks(item.regularPrice)})`
    : vbucks(item.price);
  const until = `${fmtDate(leavesAt(item.outDate), timeZone, true)} (${timeLeft(item.outDate, now)})`;
  let last;
  if (item.lastSeen) {
    const ago = Math.round((now - Date.parse(item.lastSeen)) / DAY);
    last = `${fmtDate(new Date(item.lastSeen), timeZone, false)} (${ago.toLocaleString('en-US')} days ago)`;
  } else if (item.released && Date.parse(item.released) >= Date.parse(item.inDate) - 7 * DAY) {
    // Released within a week of this listing: this is its first time in the shop.
    last = 'Never — this is a new item';
  } else {
    last = trackingSince
      ? `Not in our records (we started tracking on ${fmtDate(new Date(trackingSince), 'UTC', false)})`
      : 'Unknown';
  }
  return [
    ['Price', price + (item.bundle === true ? ' · sold as a bundle' : item.bundle ? ` · in the ${item.bundle} bundle` : '')],
    ['In the shop until', until],
    ['Last time in the shop', last],
  ];
}

// unsubscribeUrl: one-click link that turns alerts off (also sent as the List-Unsubscribe header).
export function buildAlertEmail({ items, timeZone = 'UTC', trackingSince, siteUrl = '', siteName = 'FortifyMe', unsubscribeUrl = '', now = Date.now() }) {
  const names = items.map((i) => i.name);
  const subject = items.length === 1
    ? `${names[0]} is in the Item Shop now`
    : `${items.length} items from your wishlist are in the Item Shop`;

  const blocks = items.map((item) => {
    const facts = itemFacts(item, { timeZone, trackingSince, now });
    const rows = facts.map(([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#111827;font-weight:600">${esc(v)}</td></tr>`).join('');
    return `
      <table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:12px;margin:0 0 16px;border-collapse:separate">
        <tr>
          <td width="120" style="padding:12px;vertical-align:top"><img src="${esc(item.image)}" width="110" height="110" alt="${esc(item.name)}" style="display:block;border-radius:8px;background:#1b2150"></td>
          <td style="padding:12px 12px 12px 0;vertical-align:top">
            <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:6px">${esc(item.name)}</div>
            <table role="presentation" style="font-size:14px;border-collapse:collapse">${rows}</table>
          </td>
        </tr>
      </table>`;
  }).join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;padding:24px">
      <tr><td>
        <div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.5px;text-transform:uppercase">${esc(siteName)} · Wishlist alert</div>
        <h1 style="font-size:22px;color:#111827;margin:8px 0 16px">${esc(subject)}</h1>
        ${blocks}
        <p style="font-size:13px;color:#6b7280;margin:16px 0 0">Buy it in Fortnite before it leaves. Times are shown in ${esc(timeZone)}.</p>
        <p style="font-size:12px;color:#9ca3af;margin:16px 0 0">You're getting this because these items are on your wishlist${siteUrl ? ` at <a href="${esc(siteUrl)}" style="color:#9ca3af">${esc(siteName)}</a>` : ''}. ${unsubscribeUrl ? `<a href="${esc(unsubscribeUrl)}" style="color:#6b7280">Turn off wishlist alerts</a>, or remove items from your wishlist on My Account.` : 'Remove them from your wishlist or turn off alerts on My Account to stop these emails.'}<br>
        Fortnite is a trademark of Epic Games, Inc. This site is not official and is not endorsed by Epic Games.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    subject, '',
    ...items.flatMap((item) => [item.name, ...itemFacts(item, { timeZone, trackingSince, now }).map(([k, v]) => `  ${k}: ${v}`), '']),
    'Buy it in Fortnite before it leaves.',
    unsubscribeUrl
      ? `To stop these emails, turn off wishlist alerts: ${unsubscribeUrl}`
      : 'To stop these emails, remove the item from your wishlist or turn off alerts on My Account.',
  ].join('\n');

  return { subject, html, text };
}
