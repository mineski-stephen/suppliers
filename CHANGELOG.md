# Changelog

Every change and version update of Suppliers, newest first. The version is
`APP.version` in `js/config.js`; the top bar shows it beside the name ("v1.0.0").

**Releasing a change:** bump `APP.version` (semver: patch for fixes, minor for
new features or behaviour, major when people must relearn something or old data
or links stop working), add an entry here with the same number and the date,
and say what changed in the team's words. `npm run check:shell` fails if the
two numbers differ.

## 1.4.2 · Nov 12, 2026

- Shared design fixes from the design language, found while reworking Appraisal:
  - a side panel taller than the window now scrolls by itself (before, its end could only be reached at the bottom of the page);
  - on phones, a top bar with two or more nav links hides the name and the session pill a little sooner, so the avatar stays on screen;
  - "Clear local data" in Settings is an outlined button (as a borderless one its label sat indented from the text above it);
  - `npm run check:shell` now fails if an id is used twice in `index.html`.

## 1.4.1 · Nov 12, 2026

- The CE line items now load at the same time as the procurement records instead of after
  them, so the Line Items tab is ready sooner.

## 1.4.0 · Nov 12, 2026

- **Filters and sorting for Line Items.** On the Line Items tab, the funnel button opens
  filters made for CE lines: only lines in the final CE (or only other versions), the
  project outcome (won, lost…), the category, and whether a purchase order was matched.
  Sort by price date, unit cost, line cost, markup or project code, and group by
  project, category or business unit, each group with its total line cost. The count
  beside the tab and the "Not shown" note follow the filters, and a shared link keeps them.
- The purchase-order filters are unchanged and stay separate: switching tabs switches
  the panel.

## 1.3.1 · Nov 12, 2026

- While the CE line items load, a spinner shows with the count ("Reading CE line items
  (4,000 of 12,155)…") on the status line and in the Line Items tab, and the refresh button
  spins until they're in.

## 1.3.0 · Nov 12, 2026

- **Line Items tab.** Beside Projects, a new tab searches the lines of past cost
  estimates (CEs) with the same search box and rules. Its count shows as you type;
  click it to see CE lines instead of purchase orders. Each line shows what it
  budgeted (quantity, unit cost, line cost, markup, client price), which project,
  CE and tab it comes from, whether it's in the final CE, and what was actually
  paid. Click a purchase order number in a line to search for it.
- The line items come from the CE line item service on Cloudflare, as you, and only
  for people who can open the procurement table. They stay in this tab's memory and
  are never saved in the browser. The tab doesn't show while Suppliers is on the
  backup connection service (Render), or when the line item service can't be
  reached; everything else works as before. Settings > Connections says which.
- Filters and sorting stay for purchase orders; they don't apply to Line Items.

## 1.2.0 · Nov 6, 2026

- **A backup connection service.** The Lark connection service now runs in two
  places: Cloudflare (used first, and it never sleeps, so "Waking up the
  connection…" should rarely appear) and Render (the backup). If one can't be
  reached, Suppliers switches to the other on its own, and Settings > Connections
  says when it's using the backup. Nothing to do on your side.
- Suppliers only reads, so a read that can't reach one connection service is
  simply asked again through the other.
- The connection service must be version 2.0.0 or newer; an older one shows as
  "Out of date" in Settings.

## 1.1.0 · Nov 5, 2026

- **One login for Suppliers, Fetch and Polaris.** Log in to any of them and you're
  logged in to all three in this browser, in every tab, with one timer (the time
  left in the top bar is the same everywhere). Opening another tool, a new tab or a
  shared search link no longer asks you to log in again. The login also stays when
  you close the tab, until it ends about 2 hours after you logged in.
- **Log out logs you out of all three** in this browser (you're still logged in to
  Lark itself). An open Suppliers tab shows the login screen at once and drops the
  saved copy of the records, as Log out here does.
- **Logging in again anywhere renews every tab:** the "Your login ends at…" warning
  closes and the timer starts over. If someone else logs in, the records read for
  the previous person are dropped and read again.
- If you were logged in before this update, you stay logged in.

## 1.0.0 · Nov 5, 2026

- Initial release.
