# Suppliers

<img src="img/suppliers-icon.svg" alt="Suppliers logo" width="96" align="right">

**Suppliers** finds past procurement requests in seconds: what an item cost, who
supplied it, for which project, and the supplier's payment details. Project
managers and finance use it to price quotations from what Mineski actually paid
before. It reads the procurement table in Lark Base as the person who logged in,
so everyone sees exactly what Lark lets them see. It only reads; it never changes
anything in Lark.

> **Owner to do (once):**
> 1. On the Lark app (`cli_aab0716138b8ded3`), *Security Settings > Redirect URLs*: make sure
>    `http://127.0.0.1:9125/` and the hosted address (for example `https://<account>.github.io/suppliers/`)
>    are listed. (`http://127.0.0.1:9125/` already passes the page's own check.)
> 2. On the Lark proxy (on both Cloudflare and Render), add the hosted origin (for example `https://<account>.github.io`) and
>    `http://127.0.0.1:9125` to `ALLOWED_ORIGINS`, or every call from that address gets "origin not allowed".
> 3. Give everyone who should use Suppliers access to the procurement Base in Lark, and make sure they're
>    inside the Lark app's *Availability*. A login only sees what the person can open.

---

## Contents

- [Using it](#using-it)
- [Searching](#searching)
- [What it reads](#what-it-reads)
- [Settings](#settings)
- [How it's built](#how-its-built)
- [Running it locally](#running-it-locally)
- [Testing](#testing)
- [Deploying](#deploying)
- [Design decisions](#design-decisions)
- [What changed from the old page](#what-changed-from-the-old-page)
- [Security and privacy](#security-and-privacy)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Maintenance recipes](#maintenance-recipes)
- [Files](#files)

---

## Using it

1. Open Suppliers and press **Log in with Lark**. A login lasts about 2 hours and is shared
   with Fetch and Polaris: log in to any of them and you're logged in to all three in this
   browser, in every tab (a shared link included), with one timer. Closing the tab doesn't
   log you out.
2. The first time, wait a moment while it reads the procurement records ("Reading the
   records… 1,500 of 3,410"); the connection service may need up to a minute to wake up.
   After that, the records you had last time are on screen at once ("Saved copy from …")
   while the latest are read behind them, and replace them when they arrive.
3. Type what you're looking for: an item ("led wall"), a supplier, a project, a
   request number. Results come as you type, best matches first.
4. Use the tabs (**All**, **Particulars**, **Suppliers**, **Projects**) to search only
   one kind of field, and the funnel button to sort, filter or group the results.
   Only **Approved** requests are shown until you pick more statuses.
5. Click a result to see everything about it beside the list (a full-screen sheet on
   a phone). Click any value to copy it. **Open in Lark** opens the request itself.
6. Copy the address bar to share exactly what you see: the search, the tab, the
   filters and the open record are all in it.

With nothing typed, the page shows how many records and suppliers there are,
**Browse all** (every record, newest first, with the filters) and **Recent orders**:
the 20 newest requests, newest on the left (drag them, scroll sideways, or use the arrows),
ending in a card that opens Browse all.

## Searching

The same language as before; the **ⓘ** button in the search box explains it too.

| Type | Finds |
| ---- | ----- |
| `lighting rental` | records with either word; the best matches first; small typos still match |
| `"exact phrase"` | records with the whole phrase |
| `-word`, `-"a phrase"` | leaves out records that contain it |
| **Exact** (the switch in the box) | the text letter for letter. It turns on by itself for request numbers (6+ digits) and project codes (`2026TEG-P0290`) |
| `/` | the field list: pick a field, type a value, press Enter. Fields: `particular_item`, `business_unit`, `project_name`, `project_code`, `project_manager`, `supplier_account_name` |
| `project_code:'2026TEG'` | that field contains the text (single quotes) |
| `project_code:"2026TEG-P0290"` | that field is exactly the text (double quotes) |

Field filters become chips: click one to switch it off (it goes grey), double-click
(or **F2**) to edit it, × to remove it. **Backspace** in an empty box removes the last
chip; **Esc** closes the list, then cancels the chip being typed, then clears the
search. Press **/** anywhere on the page to jump to the search box.

Ranking: Orama's BM25 with typo tolerance; records that contain the words literally
come first; within about the same score, **Approved** comes before **Under Review**,
**Rejected** and **Recalled**. One search returns at most 500 matches per tab (the
page says so when it hits that).

**Filter and sort** (the funnel; the number on it counts what isn't default):
sort by date, total price, unit price or project code; status; outsourced (only, or
hidden); currency (PHP only, USD only); group by business unit, project or supplier,
each group with its total. Price sorts and group totals convert USD to PHP at your
exchange rate. Under the list, "Not shown: …" says what the filters leave out.

**Shareable links** keep the old page's format, so links shared before still open
the same view (after logging in): `?q=`, `?qoff=` (chips switched off), `?exact=true`,
`?tab=`, `?sort=`, `?status=`, `?outsource=`, `?currency=`, `?group=`, `?all=true`
(Browse all), `?exchangerate=`, `?showprice=`, `?theme=`. The open record is in the
hash: `#/r/<record id>`.

## What it reads

One table, read in full every time the page opens (never through a view), as the
person who logged in:

| | |
| - | - |
| Base | `NP7TbjwHNaTyLOsWafelN9wNgEd` on `mineskiglobal.larksuite.com` |
| Table | `tbl3ki9aAQsWCJuR` (`TABLES.live.procurement` in `js/config.js`) |
| Columns | the list in `js/schema.js`: Request No., Status, Submitted at, Completed at, the project columns, the `Particulars_…` columns and the `Supplier Details_…` columns |

Before reading the records it checks the columns. If **Request No.**, **Status**,
**Particulars_Item**, **Supplier Details_Supplier Name** or **Project Name** is missing,
it stops and says which. Any other missing column is left out, and Settings says so.
Dates are shown as Lark shows them (Manila time, UTC+8), "Oct 14, 2026".

Suppliers writes nothing to Lark.

## Settings

The gear in the top bar. It works logged out. Saved in this browser only.

| Card | What |
| ---- | ---- |
| Account | who's logged in and until when; **Log in again**; **Log out** (local only: you stay logged in to Lark itself) |
| Appearance | System, Light or Dark |
| Prices | **Exchange rate** (PHP per 1 USD, 57 unless you change it) and **Show prices in**: their own currency, PHP or USD |
| Connections | the connection service (Awake, Waking up…, Unreachable, Out of date) with **Wake up**; the Lark Base ("Connected · 3,410 records · newest Oct 30, 2026 · updated 4:44 PM") with **Refresh**; the table with **Open in Lark**. On this computer only: *Advanced: connection service address* |
| This browser | **Clear local data**: the saved copy of the records, the exchange rate and the price display (Undo in the toast). The login and theme are kept |

Browser storage (all JSON):

| Key | Where | Holds |
| --- | ----- | ----- |
| `suppliers.theme` | localStorage | `"light"` or `"dark"` (absent = System) |
| `suppliers.settings` | localStorage | `{ exchangeRate, showPrices, larkUrl }` (`larkUrl` only on a local page) |
| `mineski.auth.token` / `.user` | localStorage | the Lark login and your name and picture, **shared by every Mineski tool on this site** (through `js/session.js`, copied unedited from `design-ref/mineski-systems-design/assets/`) |
| `suppliers.auth.pending` | sessionStorage | a login in progress (it finishes in the tab that started it) |
| `suppliers.cache.<app>:<table>` | localStorage | the saved copy of the records: gzipped, without account numbers, bank names or addresses, tagged with who saved it. About 10% of the plain size |
| `suppliers.view` | sessionStorage | the search in the address bar while you're on Lark's login page |
| `suppliers.override.lark` | sessionStorage | a `?lark=` test address (local page only) |

See [Security and privacy](#security-and-privacy) for when the saved copy is deleted.

## How it's built

```
 Browser: index.html (static, no build step, ES modules)
   │  every Lark call carries the person's own login token
   └──────────────▶ Lark proxy ──▶ Lark Open API
                     Cloudflare (lark-proxy.stephen-lin.workers.dev, used first, never sleeps)
                     or Render (lark-proxy-dwiw.onrender.com, the backup): same code and settings;
                     adds the app secret only to the login exchange
 Lark Base is the database. Search runs in the page (Orama, js/vendor/orama.js).
```

1. **Login** (`js/auth.js`): OAuth with PKCE, as in Fetch and Polaris. Lark sends the
   person back with a code; the page removes it from the address bar, wakes the proxy
   and swaps the code once (45 s) for a user token, kept as the login shared by every
   Mineski tool on the site (`js/session.js`): every other open tab, of any tool, hears
   about it, and a logout in any of them ends it everywhere. A session clock warns 5
   minutes before the end and ends the session on time.
2. **Loading** (`js/app.js` `load`): wake the proxy (it sleeps when idle), read the
   columns and check them (`js/schema.js`), read every record 500 at a time
   (`js/tables.js`: a list Lark cuts short throws instead of looking complete), turn
   them into rows (`js/rows.js`), build the search index (`js/search.js`). Reads are
   retried while the proxy wakes; two instant failures mean an ad blocker, and the page
   says which address to allow.
3. **Searching** (`js/query.js` the language and the list rules, `js/search.js` the
   ranking) and the views: `js/searchbar.js` (the box and chips), `js/filters.js`,
   `js/results.js`, `js/detail.js`, `js/carousel.js`, `js/settings-view.js`.
4. **Errors** become one sentence each in `js/errors.js` (`describe`).
5. **Refreshing**: **Refresh** reads the table again and shows it at once. Coming back
   to the tab after 30 minutes refreshes quietly; if results or a record are on screen,
   they stay put and the status line offers **Show them** instead of moving them under you.

The look is the Mineski design language (`.claude/skills/mineski-design-language`):
`css/mineski-base.css`, `js/ui.js` and `js/icons.js` are the skill's files, unedited;
`css/theme.css` is the Suppliers hue (Berry, `#C2256F`); `css/app.css` holds the few
styles of its own, tokens only.

## Running it locally

```bash
python tools/serve.py
```

Open http://127.0.0.1:9125/ (always `127.0.0.1`, never `localhost`: they are different
addresses for Lark and for the browser's storage). `npm run serve` does the same, and
Claude Code's preview uses `.claude/launch.json`. Plain `python -m http.server` can serve
JavaScript with the wrong type on Windows; use `tools/serve.py`.

**Preview mode** (this computer only): http://127.0.0.1:9125/?preview runs the whole
page on `tests/fixture.json`, 420 made-up records, with a fake login and nothing sent
anywhere. A red badge says "Preview mode: sample data, nothing is sent anywhere".
Use its own tab. `npm run preview:fixture` makes the sample again.

**Another connection service** (for example a local proxy on port 8001): open
`http://127.0.0.1:9125/?lark=http://127.0.0.1:8001` (this tab; `?reset` clears it) or set
it under Settings > Advanced. A red **Overridden** badge shows while it's on.

## Testing

`package.json` has no dependencies. Node 20 or later.

| Script | What it does | Needs |
| ------ | ------------ | ----- |
| `npm test` | offline tests of every pure module: row mapping, the search language, ranking on the sample, filters, groups, prices, the address bar, error sentences, full-table paging against a fake Lark | nothing |
| `npm run check:shell` | the import map lists every module; the shared files are the skill's; the watchdog, CSP and referrer metas; the version matches this CHANGELOG; `node --check` on every file; no secrets, no em dashes, no data files | nothing |
| `npm run check:proxy` | asks the Lark proxy who it is (name, version, CORS headers), and fails while it still lists a public `/token` | the internet |
| `npm run check:live` | reads the live table with the Lark app's own token: the column check, every record read and mapped. Prints counts only, never a record | `LARK_APP_SECRET` in a git-ignored `.env` (copy `.env.example`) |
| `npm run preview:fixture` | writes `tests/fixture.json`, the made-up sample | nothing |
| `npm run serve` | the dev server on 9125 | Python 3 |

## Deploying

It's a static folder: publish it as it is (GitHub Pages or any https host). Then:

1. Add the page's address, with the trailing slash, to the Lark app's Redirect URLs.
2. Add its origin to the Lark proxy's `ALLOWED_ORIGINS`, on both Cloudflare and Render.
3. Open it, log in, and check Settings > Connections says "Awake" and "Connected".

Bump `APP.version` and add a `CHANGELOG.md` entry with every release (`npm run check:shell`
checks they match). Host it on an origin that serves nothing else if you can: every
site on one `github.io` account shares the browser's storage.

## Design decisions

- **Lark is the only source, read as the person.** No copy of the data lives anywhere
  else, so there's nothing to re-encrypt or redeploy when the table changes, and Lark's
  own permissions decide who sees what.
- **The search language and ranking are unchanged**, so people's habits and shared links
  keep working. Orama is pinned at 3.1.18 and vendored, so a library release can't change
  results.
- **A saved copy shows at once; the live read replaces it.** Reading the whole table takes a
  while, so the last read is kept in the browser and shown first. The saved copy is replaced as
  soon as the live read arrives (the search, filters and open record stay); a later quiet
  refresh over live records waits for "Show them" while results are on screen.
- **A record has its own address** (`#/r/<id>`), so it can be shared and the browser's
  Back closes it.
- **A quiet refresh never moves what you're reading.** It applies at once only when no
  results are on screen; otherwise "Show them".

## What changed from the old page

Before 1.0.0, Suppliers opened an encrypted spreadsheet snapshot, unlocked with a
shared password, and then refreshed it from Lark with an app token.

Removed, because Lark login replaces them:

- the password modal, the `?debugkey=` link and `config.json`'s `debugKey`
- the encrypted snapshots (`data/*.enc`, and a plaintext `.xlsx` that was in `data/`), the
  "Encrypt Database File" tool in Settings, the encrypt-offer dialog, `js/crypto.js`,
  `tools/convert_and_encrypt.py`, and PapaParse and SheetJS (only used to read and
  encrypt those files)
- the secret "godmode" keyword (and its console hint): **Browse all** shows every record
  instead, for everyone who can open the table
- `server.py` and its self-signed certificate (`http://127.0.0.1` can log in)
- the background "Fetching latest data" toast, its cold-start countdown, the
  "Reload database?" prompt, the full-screen reload overlay and the **Auto-apply latest
  data** setting: the first load is simply the load (with a staged loader), Refresh is a
  button, and the rule above decides how a quiet refresh applies, so the setting has
  nothing left to choose
- `js/transformers.min.js` (never loaded: the "hybrid vector search" in the old README
  wasn't in the code) and the "Related" tag it once fed
- the Mineski logo above the search (the Suppliers icon is in the top bar)
- a copy of the Lark API test tool (`tech/lark-api-test/`) that held the app secret
- the auto-scroll of Recent orders and its endless loop (the newest stays on the left; it
  ends in a Browse all card), and the fade at the strip's edges
- the "Esports Business Unit" detail field: the Lark table has no such column, so it was
  always empty

Kept: the animations (cards rise in one after another on each new search, tab or filter, and
again when a group opens; the search moves up from the middle of the landing when results come;
the record panel grows open beside the list and folds away in reverse; a record shows as a
shimmering skeleton for half a second, then fades in; a copied value flashes), the old card layout, and
the 480 px record panel with labels above values.

Changed: copying shows a toast at the bottom of the page like every other message (not a bubble
by the value); Settings is a page (the gear) with the family's cards; Search help is the ⓘ in the
search box; dates read "Oct 14, 2026"; the status filter, outsourced and currency choices
are chips; "Show more" draws long lists 100 at a time; editing a chip keeps the words you'd
typed; rich text with a link inside no longer shows stray commas.

## Security and privacy

- **No secret in the page or the folder.** The app secret lives on the Lark proxy; the page
  sends people's own tokens, only to the proxy, only in an `Authorization` header (the
  CSP lets the page talk to nothing else).
- **One login for every Mineski tool on this site** (localStorage `mineski.auth.token`),
  lasting about 2 hours; closing the tab doesn't log you out, so on a shared computer use
  **Log out**. Every page on `mineski-stephen.github.io` can read that storage, so only
  Mineski tools are published there. **Log out** forgets the token for Suppliers, Fetch and
  Polaris in this browser (an open Suppliers tab also deletes the saved copy when you log out
  in another tool); Lark has no "revoke", so you stay logged in to Lark itself.
- **The saved copy of the records** (`suppliers.cache.…`) holds no account numbers, bank names
  or addresses, and only the person who saved it can open it: another login drops it. **Log out**
  and **Clear local data** delete it. A login that simply runs out keeps it, so the next login starts
  fast: on a shared computer, use Log out. (The systems standard drops cached data at every session
  end; Suppliers keeps it on purpose, at the team's request.) The records on screen are dropped from
  memory the moment a login ends.
- The Lark proxy still has a public `/token` endpoint that hands out app tokens
  (`npm run check:proxy` fails on it). Suppliers doesn't use it; it should be removed.

## Known limits

- A search returns at most 500 matches per tab; Browse all has no limit.
- The whole table is read on every visit (about 7 pages per 3,500 records). Past about
  100,000 records it stops and says so.
- Lark's own permissions apply: someone who can't open the Base gets "Lark says your account
  can't open the procurement Base".

## Troubleshooting

| You see | What to do |
| ------- | ---------- |
| "Suppliers couldn't start. Reload the page." | Reload. If it stays, open it from its web address, not a saved file. |
| "This address (…) isn't registered on the Lark app." | The owner adds that address under the Lark app's Redirect URLs. |
| "This address (…) isn't allowed to use the Lark connection yet." | The owner adds the page's origin to the Lark proxy's `ALLOWED_ORIGINS`. |
| "Login cancelled. Suppliers needs your OK on Lark's page to read the procurement records." | Log in again and press Authorize on Lark's page. |
| "Your Lark account isn't allowed to use this app yet. Ask the app admin to add you." | The owner adds you to the Lark app's Availability. |
| "Lark says your account can't open the procurement Base. Ask its owner to give you access." | Ask the Base owner to share it with you. |
| "Suppliers can't use the procurement table." + "Procurement: column “Status” is missing." | Someone renamed or removed a column in Lark. Rename it back, or update `js/schema.js`. |
| "Waking up the connection…" | Wait: the free Render service sleeps when idle and takes up to a minute. |
| "Unreachable (no answer for 3 minutes)" | Neither copy of the Lark proxy answered (Cloudflare, then Render). Try again later; check Settings > Connections. |
| "Suppliers can't reach its connection service." (red banner) | An ad blocker or privacy extension is blocking `lark-proxy.stephen-lin.workers.dev` (and `lark-proxy-dwiw.onrender.com`, the backup). Allow it, then reload. |
| Settings > Connections: "… (the backup: the usual one can't be reached)" | The connection service on Cloudflare didn't answer, so Suppliers is using the copy on Render. Everything works; the first call after a while may wait for Render to wake up. If it lasts, check the Worker on Cloudflare (its Logs say why). |
| "Out of date (…). Ask the admin to redeploy it." | The owner redeploys the Lark proxy. |
| "Your login ends at 4:30 PM." | Press **Log in again** to keep going without a break. |
| "Your login ended after about 2 hours. Log in again to keep going." | Log in again; your search comes back. |
| "Your login ended in another tab. Log in again to keep going." | You (or someone at this computer) logged out of Suppliers, Fetch or Polaris in another tab, or Lark ended the login there. They share one login, so log in again in any of them. |
| "Lark counted … records but … came back" | Someone changed the table while it was read. Press Refresh. |
| "Showing the best 500 matches." | Add a word, a field filter or a filter to narrow it down. |
| "No records match “…” with these filters." | Press **Reset filters**, or pick more statuses (only Approved is shown by default). |
| A red **Overridden** badge | A test address is set on this computer: Settings > Advanced, or open the page with `?reset`. |
| "Preview mode: sample data, nothing is sent anywhere" | You opened `?preview`. Open the page without it, in a new tab. |
| People see an old version | The top bar shows the version. Every load fetches fresh files; if it's still old, the host hasn't published the new one yet. |

## Maintenance recipes

- **A column was renamed in Lark:** change its name in `js/schema.js` (`COLUMNS`), and in
  `js/detail.js` (`GROUPS`), `js/search.js` (`PROPS`) or `js/query.js` (`FILTER_FIELDS`)
  if it's used there. Run `npm test` and `npm run check:live`.
- **Show another column in the detail panel:** add it to `COLUMNS` in `js/schema.js`, then
  to a group in `js/detail.js`.
- **Add a field filter:** add it to `FILTER_FIELDS` in `js/query.js` (name, column, label,
  description); the slash list, the filter panel and the help pick it up.
- **The table moved:** paste its new link into `TABLES.live.procurement` in `js/config.js`.
- **A new status:** add it to `RULES.statuses` and `RULES.statusPriority`, spelled as in Lark.
- **Release:** bump `APP.version`, add a `CHANGELOG.md` entry, run `npm test` and
  `npm run check:shell`.

## Files

| Path | What |
| ---- | ---- |
| `index.html` | the page: views, dialogs, the cache-busting loader and import map, CSP, boot watchdog |
| `css/theme.css` | the Suppliers theme (Berry), generated by the design language's `make_theme.py` |
| `css/mineski-base.css`, `js/ui.js`, `js/icons.js` | the design language's shared files, unedited |
| `css/app.css` | Suppliers' own styles (tokens only) |
| `js/config.js` | name, version, the proxy, the Lark app, the table link, the rules |
| `js/app.js` | state, routes, login, loading, the address bar |
| `js/auth.js`, `js/net.js`, `js/errors.js`, `js/settings.js` | login and session, the proxy, error sentences, per-browser settings |
| `js/session.js` | the login shared by every Mineski tool on the site (copied unedited from `design-ref/mineski-systems-design/assets/`) |
| `js/tables.js`, `js/schema.js`, `js/rows.js` | reading the table, its columns, records to rows |
| `js/cache.js` | the saved copy of the records |
| `js/query.js`, `js/search.js`, `js/vendor/orama.js` | the search language and list rules, ranking, Orama 3.1.18 |
| `js/searchbar.js`, `js/filters.js`, `js/results.js`, `js/detail.js`, `js/carousel.js`, `js/present.js`, `js/settings-view.js` | the views |
| `img/suppliers-icon.svg` + `-32/-180/-512.png` | the app icon |
| `manifest.webmanifest` | home-screen install |
| `tools/serve.py` | the dev server (the design language's, port 9125) |
| `tools/check-shell.mjs`, `tools/check-proxy.mjs` | `npm run check:shell`, `npm run check:proxy` |
| `tests/` | the offline tests, the live check, the made-up sample and the preview shim |
| `.claude/launch.json`, `.claude/skills/` | Claude Code's preview, and copies of both design skills |
| `CHANGELOG.md` | every release, newest first |
