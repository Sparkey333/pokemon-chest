# Legal & Credits

**Pokémon Den** is an unofficial, fan-made tool for cataloging, valuing, and selling
trading cards **you personally own**. It is not affiliated with, endorsed, sponsored,
or approved by Nintendo, The Pokémon Company, Creatures Inc., GAME FREAK inc., or
PriceCharting.

## Trademarks & copyrights

- **Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.** Pokémon and all
  respective character names, card artwork, and logos are trademarks and
  copyrights of Nintendo / The Pokémon Company. They appear here only to
  identify cards in your own collection (nominative use).
- **Card images** are loaded from [TCGdex](https://tcgdex.dev), a free open card
  API, and belong to their respective owners.
- **Prices** come from your own PriceCharting collection export and, with your own
  API token, PriceCharting's API. PriceCharting is a trademark of its owner.
- Marketplace names (eBay, TCGplayer, Mercari, Whatnot, Facebook) are trademarks
  of their respective owners; links open their public sites.

## Privacy

- **No accounts, no analytics, no tracking.** Pokémon Den doesn't know who you
  are and doesn't want to. There is no sign-up, no telemetry, and no ads.
- **Your collection data — cards, notes, sales, photos, prices you've
  entered — never leaves this computer**, full stop. It's stored in your
  browser's local storage and in local files inside this app's own folder.
- **The only network calls this app ever makes** are: (1) card artwork from
  [TCGdex](https://tcgdex.dev), a free open card API; (2) the comp/marketplace
  links *you* click, which open their own sites; and (3) — only if you've
  pasted your own key into ⚙ Live — requests to that one provider
  (PriceCharting, a comps API, or Claude/OpenAI), sent straight from your
  machine to theirs. Nothing passes through any third-party server of ours,
  because there is no server of ours.
- **BYOK keys** live only in `settings.local.json` on your own disk —
  gitignored, never bundled into a shipped build, never logged.
- **Error log (optional, off by default):** you can turn on a local-only log
  of JS errors in ⚙ Live, to make bug reports easier to fix. It's stored
  exactly like everything else above — on this computer only — and is never
  transmitted anywhere automatically. You choose if/when to copy or send a
  report, and you can clear it any time from the Admin tab.

## What this app deliberately does NOT do

- It does not redistribute card artwork, game assets, or scans beyond your own
  machine — everything is local to your computer.
- It does not sell, bundle, or monetize any Nintendo/Pokémon intellectual
  property. Selling **genuine physical cards you own** is protected resale
  (first-sale doctrine); this app is a private inventory tool for that.
- The default build ships with no API keys and calls no paid services.

## If this app is ever distributed publicly

The working name "Pokémon Den" is for **personal use only**. A public release
must (a) use an original name without "Pokémon" in it (see
`ROADMAP-TO-PUBLISH.md` for candidates), (b) drop or license any Pokémon-IP
visuals it displays by default, and (c) keep this credits file visible in-app.
