# Changelog

Every change and version update of Suppliers, newest first. The version is
`APP.version` in `js/config.js`; the top bar shows it beside the name ("v1.0.0").

**Releasing a change:** bump `APP.version` (semver: patch for fixes, minor for
new features or behaviour, major when people must relearn something or old data
or links stop working), add an entry here with the same number and the date,
and say what changed in the team's words. `npm run check:shell` fails if the
two numbers differ.

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
