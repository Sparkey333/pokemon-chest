# DenZ — business wargame

How this actually becomes a product people pay for. Written as a plan to
argue with, not a pitch: every number is an assumption you can falsify, and the
places where it probably breaks are called out rather than smoothed over.

> **Naming.** The app is **Pokémon DenZ** on your machine. It ships as **DenZ**.
> This is not a style preference — "Pokémon" in a public product name gets the
> listing rejected by Apple and Google and is the single most likely thing to
> attract a takedown from Nintendo, who enforce aggressively. Every store-facing
> string is already `DenZ`. Keep the working name locally as long as you like.

---

## 1 · What is actually being sold

Not "a collection tracker." There are a dozen of those and most are free.

**DenZ sells decisions.** Every competitor tells you what your cards are worth.
DenZ tells you what to *do*: which card to sell this week and where, whether
grading clears its own cost, whether the trade in front of you is fair after the
fees you'd have paid selling instead, and what's missing from the set you're
one card from finishing.

That's the whole positioning. The 3D Den and VR are the thing people screenshot;
the sell/grade/trade math is the thing they keep it for.

**Second, quieter wedge:** it's *yours*. No account, no subscription, no cloud
holding your collection hostage. That's a real and growing objection to every
competitor, and it's the one thing a VC-funded app structurally cannot copy.

---

## 2 · The competitive read

| Who | Their strength | Where DenZ wins |
|---|---|---|
| **Collectr** | Multi-TCG breadth, polish, mobile-first | They price; we advise. No fee-adjusted net, no grade break-even, no trade verdict. |
| **CollX** | Huge scan volume, social, marketplace | Free tier is an ad funnel and they want your data. We're local-first and quiet. |
| **PriceCharting** | The price data itself | We *consume* it. Their app is a lookup tool with no portfolio reasoning. |
| **Dex / pkmn.gg** | Set completion, collector-native | Ours runs offline off a bundled 31.6k-card codex and adds cost-to-complete. |
| **PullVault** | Bulk binder scanning | We match it and add what to do with the results. |
| **Slabfy** | Graded/slab focus | We carry raw + graded + the ladder between them. |

**Honest weakness:** we're macOS-desktop-first in a mobile-first hobby. The PWA
and Pocket file mitigate it; they don't erase it. A native iOS app is the single
highest-leverage build left, and it's the gap a competitor would attack.

---

## 3 · SEO and discovery

Nobody searches "DenZ". They search problems. The content is the funnel, and
the app already computes most of it.

**Tier 1 — high intent, low competition. Own these first.**

| Query cluster | Page to build | Why it converts |
|---|---|---|
| "is it worth grading my pokemon card" | Grading break-even calculator + explainer | Highest intent in the hobby. The app already does this math. |
| "psa vs cgc vs beckett cost 2026" | Living comparison table | Ranks for years, updates cheaply. |
| "how much are my pokemon cards worth" | Portfolio guide + free Pocket download | Broadest top-of-funnel. |
| "pokemon card fees ebay vs tcgplayer vs whatnot" | Fee calculator | We have the fee model already. |
| "is this pokemon trade fair" | Trade checker landing page | Exact match to the Trade tab. |

**Tier 2 — long tail that compounds.** One page per set: "How many cards are in
Evolving Skies?" / "…complete set value". You have 395 sets in the codex. That's
395 pages generatable from data you already ship, each with genuine utility.
This is the single cheapest durable traffic source available to you — and the
one your competitors can't easily match because they don't have the codex
offline.

**Do not** chase "pokemon card app" head terms. Collectr and CollX have spend
and domain authority; you'd lose expensively.

**Technical SEO:** `public-vault.html` and the Pages workflow already exist —
that's the site. Needs: a real domain, `Product` + `FAQPage` structured data,
OG images (the Den screenshots are the asset), and a sitemap. Static, fast, no
framework — which is already an advantage.

**Channels that actually move TCG software:**
- **YouTube** is the hobby's real search engine. "I tracked my whole collection
  in 3D" is a watchable video in a way a spreadsheet app never is. The Den and
  VR earn their keep here as marketing, not just features.
- **Reddit** r/PKMNTCGDeals, r/pkmntcgcollections, r/PokeInvesting — these
  communities are hostile to promotion and receptive to free tools. Lead with
  the free Pocket file, never with a purchase link.
- **Whatnot / live sellers** are your highest-value users and they talk. One
  streamer using the Best-Sell Board on camera is worth more than any ad.
- **TikTok** for the VR Den. It's the only genuinely novel visual you have.

---

## 4 · Pricing and monetization

**Recommendation: one-time purchase, $29, with the source free.**

| Model | Verdict |
|---|---|
| **One-time $29** ⭐ | Matches the "you own it" promise that is the whole differentiator. No churn, no support burden from lapsed subs, no App Store subscription review friction. |
| Subscription $4/mo | Fights the positioning head-on. Only justifiable if you run cloud sync — and then you're funding servers and inheriting a data-breach surface you currently don't have. |
| Free + BYOK forever | Where it is today. Great for adoption, zero revenue, and it makes the paid tier harder to introduce later. |
| Freemium | Splitting features cheapens the product and doubles the QA matrix across 19 tabs. |

**Why $29 and not $10 or $99.** Below ~$20 you're competing with free apps on
impulse and signalling "toy". Above ~$50 a hobbyist wants a trial and a track
record you don't have yet. $29 is a single binder's worth of sleeves — trivial
against a $14k collection, which is exactly the framing the vault hero should
make.

**The honest revenue math.** This is a niche tool for serious collectors, not a
consumer app.

| Scenario | Units/yr | Gross | Net after 30% store cut |
|---|---|---|---|
| Slow (word of mouth only) | 100 | $2,900 | ~$2,030 |
| Working (one good video + SEO) | 1,000 | $29,000 | ~$20,300 |
| Strong (a real audience) | 5,000 | $145,000 | ~$101,500 |

Direct sales (Gumroad/Lemon Squeezy, ~5%) keep far more than the 30% store cut.
**Sell direct as the primary channel and use the Mac App Store for discovery,**
not the other way round. The `store/` kit already lays this out.

**Later, only if earned:** a paid cloud-sync tier is the one thing collectors
repeatedly ask for and would pay recurring money for. Don't build it before the
one-time product sells, because it converts a zero-liability local app into a
service with uptime, backups and breach exposure.

---

## 5 · Testing before launch

The riskiest untested assumption is not technical — it's whether anyone but you
wants this. Test that first and cheaply.

1. **Ten collectors, free Pocket file, one question:** "what would you have paid
   for the full app?" Costs nothing, no build required, answers the pricing
   question with real numbers.
2. **Landing page before the store listing.** Put up the vault page with a
   "notify me" field. If a hundred people don't sign up, a store listing won't
   save it.
3. **Beta the DMG with 5–10 people who own real collections.** Watch the first
   run over a call. The PriceCharting-export requirement is the likeliest place
   people bounce, and you cannot see that from your own machine where the file
   already exists.
4. **Then** TestFlight, then the store.

**Instrument nothing without consent.** The opt-in local error log is the
correct and only telemetry. Breaking that promise to get funnel data would
destroy the exact thing being sold.

---

## 6 · Launch sequence

| Phase | Gate | Do |
|---|---|---|
| **0 · Now** | — | Ship name applied ✅. Direct DMG with checksums ✅. Beta list from §5. |
| **1 · Direct** | Apple Developer membership | Notarized DMG, Gumroad checkout, landing page live. First revenue with no store cut and no review queue. |
| **2 · Content** | 5 SEO pages + 1 video | Grading calculator, fee calculator, trade checker pages. Set pages generated from the codex. |
| **3 · Mac App Store** | Sandboxing resolved | Discovery channel. Same $29. Expect 2–3 review rounds on the bundled server. |
| **4 · iOS** | Native build | The real unlock. Scanning belongs on a phone. |
| **5 · Steam** | Only if the Den lands | "A cozy 3D den for your collection", any TCG. Different audience entirely. |

---

## 7 · What will actually go wrong

Named so they're decisions, not surprises.

- **IP.** Even as DenZ, the app displays Pokémon card art and names. Fan tools
  are broadly tolerated; *paid* fan tools are tolerated less. `publicArt` exists
  precisely for this — a ship build can carry zero external art. Expect to have
  to use it, and price the risk in before taking money.
- **PriceCharting dependency.** Their terms may not permit a commercial app on
  their API. Email them before charging, not after. Fallback is the user's own
  export, which is already the default path.
- **Apple review on the bundled Python server.** The likeliest rejection. The
  §6 ordering deliberately puts direct distribution first so revenue doesn't
  depend on clearing it.
- **The mobile gap.** Desktop-first in a phone-first hobby. Known, mitigated,
  not solved.
- **You are the only maintainer.** Nineteen tabs is a lot of surface. The parity
  ledger and headless suites exist so that's tractable — keep them current.

---

## 8 · The one-sentence version

**DenZ is a $29 one-time, local-first vault that tells serious collectors what
to sell, grade and trade — sold direct, discovered through grading-calculator
SEO and a 3D den nobody else has.**
