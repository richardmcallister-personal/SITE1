# Should I Go? — seat refresh

Refreshes block availability and sale status in `static/should-i-go/index.html` from
tickets.manutd.com, using a dedicated Chrome profile where you are signed in, then
commits and pushes so Cloudflare republishes.

Requires Node 18+ and Google Chrome on the Mac.

**First time** (once): double-click `Refresh.command`. It installs Playwright, opens a Chrome
window, you sign in to your Man Utd account, press Enter in the Terminal window, and it runs.
The login is saved in `~/.should-i-go-chrome` (a separate Chrome profile; your normal Chrome is untouched).

**Every time after**: double-click `Refresh.command`. Headless, about a minute, pushes only
if something changed. Or from Terminal: `npm run refresh` (or `npm run dry` to patch without pushing).

Flights and hotels are not refreshed here: the Book links on the page open live prices.
