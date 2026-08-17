# Wayfinder Changelog

## v0.5.0 — 2026-08-16

### Overview

Activities stop scheduling themselves. Anything you add on the Activities tab now collects in a
staging list on that tab instead of silently landing on Day 1 of your itinerary, so you can gather
options without committing to when you'll do them. Browsing moved behind a button, giving the tab
over to your own list, and a "Build out itinerary" action is in place for the AI scheduling that
lands next.

### Updates

#### Bug Fixes

**Adding an activity dropped it straight into the itinerary**

- _Technical:_ Every add path sent a concrete `day_index` — the browse cards computed one from the
  event date, and the manual form defaulted to `0` — and `ItineraryPanel` further coerced
  `day_index ?? 0`, so even a null landed on Day 1. Activities now stage with `day_index: null`,
  and the itinerary drops null-day rows rather than defaulting them. The discriminator is the null
  day index rather than `category`, which activity rows already use for their own taxonomy; since
  `trip_items.day_index` was already nullable this needed no migration. `committedItems()` filters
  staged activities alongside lodging candidates, keeping one chokepoint for everything that totals
  money or lists itinerary rows.
- _For everyone:_ Adding an activity used to put it on the first day of your trip whether or not
  that made any sense, and you'd have to drag it somewhere better. Now it goes into a list on the
  Activities tab and your itinerary stays exactly as you left it.

#### Changes

**Activities tab leads with your own list**

- _Technical:_ Added activities render in a table (name, category, date, location, cost, remove)
  with no cap. The always-on browse section moved into a dialog opened on demand, so no
  Places/Ticketmaster call fires until asked. A "Build out itinerary" button appears once at least
  one activity is staged, wired to AI scheduling in the next release. The Trip Details task list
  now counts activities whether staged or scheduled, so staging still satisfies "Add activities".
- _For everyone:_ The tab now opens on what you've actually chosen rather than a wall of
  suggestions. Browse when you want it, and once you've gathered a few things, "Build out
  itinerary" will arrange them into days for you.

#### New Features

**Build out itinerary — AI schedules your activities into days**

- _Technical:_ New `buildItinerary` server fn. Activities missing a location or coordinates are
  resolved against Google Places first (new `lookupPlaceDetails`), so grouping has real geography
  to work with, and the result is written back onto the activity's `details` — filling `location`
  and `coords` only when absent, never overwriting traveler input. The enriched list then goes to
  Gemini for sequencing, which returns a day, an order, an optional time, and a one-line reason per
  activity. The model is not trusted with correctness: `day_index` is clamped to the trip's length,
  duplicates are dropped, anything it omits is appended rather than lost, and every row on each
  affected day is renumbered client-side — the planner only sees *staged* activities, so its
  `sort_order` would otherwise collide with items already scheduled there, including the booked
  stay. `updateTripItem` now accepts `details`, and a new `updateTripItems` applies the whole plan
  in one request instead of N.
- _For everyone:_ Once you've gathered activities, hit "Build out itinerary" and they're arranged
  into a day-by-day plan — things near each other on the same day, meals and nightlife at sensible
  times, and any date you asked for respected. If you added something without a location, we look
  it up and save it so you don't have to. Each item shows a short note on why it landed where it
  did, and you can still drag anything afterwards.

**Itinerary chat — tell it what to change**

- _Technical:_ New `chatItinerary` server fn returning **operations** (`move`, `remove`, `add`,
  `swap_days`, `retime`) rather than prose, so edits apply deterministically. Same guardrails as
  the planner: operations naming an unknown row are dropped, days are clamped, and operations per
  turn are capped. `swap_days` moves every kind on both days, not just activities, so a booked
  stay isn't stranded. Added activities go through the same Places enrichment as build-out. Every
  path that places rows on a day now shares `renumberDay()` — both AI paths compute positions
  without seeing what's already on the day, which collides otherwise. Each batch snapshots the
  rows it touches, so the confirmation toast can offer Undo.
- _For everyone:_ The Itinerary tab has a chat box. Say "move the aquarium to day 3", "remove the
  candy shop", "swap days 2 and 3", or "add dinner at Lou Malnati's on day 2", and the plan
  changes — it doesn't just suggest. If it picks the wrong thing, hit Undo on the confirmation.
  Anything it adds shows up on your Activities tab too.

**Activities tab now shows everything**

- _Technical:_ The tab lists all activities rather than only unscheduled ones, with a day badge on
  scheduled rows; "Build out itinerary" keys off the unscheduled count.
- _For everyone:_ Your activity list no longer empties once you build the itinerary — it shows
  what's scheduled and what still needs a day, in one place.

**A second opinion when you rearrange things yourself**

- _Technical:_ New pure heuristic pass (`src/lib/itinerary-advice.ts`) runs client-side after a
  drag — day length, longest hop via `haversineMiles` on stored coords, timed items out of order,
  and per-day cost against the trip average. **Only a fired heuristic spends a Gemini call**
  (`adviseItineraryChange`), which may still decline to surface; a benign drag makes no network
  request at all, verified by counting requests off the wire. Anti-nag rules are enforced in code
  rather than asked of the prompt: one visible note, no consecutive notes on the same item, a
  dismissed item never returns, and a per-session call budget. The advisor assesses the projected
  post-drag arrangement rather than the query cache, which still holds pre-drag state. Fire and
  forget throughout — the drag persists first and is never blocked or failed by advice.
- _For everyone:_ Move something to a different day and, occasionally, a short note appears
  explaining why it might not work — a day that's become impossible to fit, a long detour, a
  timing clash. It stays quiet the rest of the time, and you can dismiss any note.

#### Upcoming

- A day-by-day itinerary map with routes.
- Realtime sync for shared trips, change notifications, and an activity feed.
- Realtime sync for shared trips, change notifications, and an activity feed.
- Replacement live hotel data source (TravelPayouts is discontinued).

## v0.4.0 — 2026-08-05

### Overview

Trips stop being single-player. Anyone with an invite link can join a trip as a full
collaborator and edit lodging, activities, transport, and the itinerary alongside the owner
(refresh to see their changes — live sync is next). Lodging comparisons end in one click: the
table's Source column is now a Book button, wired to the same booking logic as the detail
dialog. And Activities gets a real "add your own" path — a manual form, plus a paste-a-link
button that pulls in a title, description, and price to review before adding.

### Updates

#### New Features

**Trip sharing (invite links)**

- _Technical:_ New `trip_collaborators` and `trip_invites` tables, with `trips`/`trip_items`
  RLS rewritten from sole-owner (`auth.uid() = user_id`) to membership-based. Invite links are
  opaque tokens redeemed at `/join/:tripId`, using the previously-unused `supabaseAdmin`
  service-role client since the invitee has no row access to the invite before joining. This
  round is Phase 1 only — refresh-to-see-changes. Realtime sync (no refresh needed) and a
  "who's viewing" presence indicator are deferred; neither needs a schema change later.
  Verified end-to-end in production with two real accounts (invite → join → collaborator
  write access visible to the owner) — see `context.md` §3 for two RLS subtleties this
  surfaced (a self-referencing SELECT policy breaking `INSERT ... RETURNING`, and an
  unqualified column name resolving to the wrong table) worth knowing before touching these
  policies again.
- _For everyone:_ Open a trip, hit Share, and copy the link. Anyone who opens it (signing in
  first if needed) joins as a full collaborator — same access as you, including booking stays
  and editing the itinerary. Refresh to see what they've added.

**Book directly from the comparison table**

- _Technical:_ The Lodging table's Source column is replaced with a Book action per row,
  calling the same `onBook` prop the detail dialog's "Book this stay" button already used —
  one mutation, two entry points.
- _For everyone:_ You no longer have to open a stay's details just to book it — Book is right
  there in the table.

**Add your own activities, with a paste-a-link shortcut**

- _Technical:_ A new manual-add form (name, category, optional date/time/duration/cost/
  location/notes/source link) sits above the browse section in Activities, using the same
  `PlaceAutocomplete` component as Lodging. A new `fetchLinkMetadata` server fn and
  `url-metadata.server.ts` provider fetch a pasted link and parse Open Graph tags
  (title/description/image/price) with a small regex — no scraping library added, since OG
  tags are designed to be trivially readable and a full HTML parser would be overkill for a
  handful of `<meta>` tags. Fetched fields only prefill empty inputs and are never added
  without the traveler reviewing and confirming.
- _For everyone:_ Know exactly where you want to go? Add it directly. Have a link to a
  restaurant or listing? Paste it and we'll try to pull in the details for you to check over
  before adding — location isn't reliably guessable from a link, so that one's still on you.

#### Upcoming

- Realtime sync for shared trips (no refresh needed), then a "who's viewing" presence
  indicator.
- Owner vs. shared badge in the trip list.
- Smart paste for Airbnb/VRBO/Amtrak links in Lodging and Transport (Activities' version
  ships this round; the shared abstraction wasn't built preemptively).
- Replacement live hotel data source (TravelPayouts is discontinued).

## v0.3.0 — 2026-08-05

### Overview

Two ways in, and a workspace built around decisions rather than lists. Trips can now be created without any AI involvement — enter origin, destination, and dates and go straight to planning. Lodging becomes a real comparison tool: added stays sit side by side in a sortable table and on a map, and only an explicit "Book this stay" commits one to your itinerary and budget. The Destination tab is replaced by a Trip Details dashboard with a countdown, travel-time estimates, booking status, and a derived task list; AI destination curation moves into a dialog opened from it.

### Updates

#### New Features

**Manual trip entry**

- _Technical:_ The landing page gained an entry-mode toggle. Manual mode collects origin/destination through a new `PlaceAutocomplete` component (Places Autocomplete over the shadcn `Input`, with fallbacks to a plain text field when `VITE_GOOGLE_MAPS_KEY` is missing, rejected, or the library throws) plus native date inputs. On submit, a new `resolvePlaces` server fn geocodes both strings and the trip is created with `destination` already set and `entry_mode: "manual"` in `parsed_params` — which is what makes `DestinationPanel`'s `picking` gate skip curation, so no Gemini call happens anywhere in the path.
- _For everyone:_ If you already know where you're going, you no longer have to describe your trip to an AI first. Pick "Plan it myself", enter where you're leaving from, where you're headed, and your dates, and you land straight in the planner.

**Lodging is a comparison tool, not an auto-itinerary**

- _Technical:_ Stays are stored as `trip_items` rows with `category: "candidate"`; booking flips one to `"booked"` and demotes any previously booked stay in the same mutation. A shared `committedItems()` helper filters candidates out of the itinerary and every budget total, so comparison entries stay visible without ever counting as spend. The panel adds a sortable comparison table (name, city, distance from origin via haversine, total, nights, source), a map of every stay, and a detail dialog carrying the "Book this stay" action. Live hotel results feed the same list instead of a separate section.
- _For everyone:_ Adding a place you're considering no longer silently drops it into your itinerary and budget. Everything you add lines up in one table and on one map so you can compare distance and price, and only "Book this stay" makes it official.

**Trip Details dashboard**

- _Technical:_ New first tab replacing Destination. A new `estimateTravelTime` server fn returns per-mode estimates — OSRM for car, cheapest live Duffel offer for flight, and a labelled road-distance heuristic for train (50 mph plus an hour of station overhead) since no rail API is wired up. Booking status, the pending-task checklist, and the countdown are all derived from live trip and itinerary state; nothing is hand-maintained.
- _For everyone:_ The first thing you see is where your trip actually stands: days until departure, how long it takes to get there by car, flight, or train, what's booked, and what still needs doing.

**Drag and drop itinerary**

- _Technical:_ dnd-kit with a dedicated drag handle, empty-day droppables, and keyboard sensor support. A drop writes the moved item plus every sibling whose order shifted through `updateTripItem`.
- _For everyone:_ Drag anything in your itinerary to reorder it within a day or move it to a different day.

#### Bug Fixes

**Activities were pre-populated on manual trips**

- _Technical:_ The Activities query now runs only when `autoBrowse` is set, which manually-created trips leave off. (The pre-filled cards were live Google Places and Ticketmaster browse results rather than AI curation, and were never written to the trip — but they made an intentionally empty trip look pre-planned.)
- _For everyone:_ Trips you create yourself start genuinely empty. Suggestions appear only when you press "Browse activities".

#### Changes

**Budget moved out of the right rail**

- _Technical:_ The sidebar budget card and the AI tips card are both gone; the tall rail is removed entirely. Budget is now a live chip in the meta bar on every tab, with the category breakdown and edit field in its popover. The now-unused `getRecommendations` server fn was deleted.
- _For everyone:_ Your running total is always visible at the top of every tab instead of taking up a whole column. AI trip tips have been retired.

**AI destination curation moved to a dialog**

- _Technical:_ The candidate grid and refinement chat moved wholesale into `DestinationPickerDialog`, opened from Trip Details. Its query is gated on the dialog being open, so no AI call fires until you ask for one. `?tab=destination` links fall through to the dashboard rather than 404ing.
- _For everyone:_ "Change destination" opens the ranked suggestions and chat in a popup, so re-curating stays available without costing a whole tab.

#### Upcoming

- Replacement live hotel data source (TravelPayouts is discontinued).
- Smart paste for Airbnb/VRBO/Amtrak links.

## v0.2.1 — 2026-07-17

### Overview

Infrastructure patch: Wayfinder's AI now runs on a properly billed, server-side Gemini API key instead of the free tier, eliminating the "AI service hit its rate limit" errors that interrupted trip curation during normal use.

### Updates

#### Bug Fixes

**AI rate-limit errors during normal use**

- _Technical:_ The original Gemini key was HTTP-referrer-restricted — a browser-key restriction type that Google never allows to carry Gemini billing — so all AI calls silently ran on the free tier's small daily quota (~20 requests/day on `gemini-3-flash-preview`). Replaced with a new server-side key (application restriction "None", API-restricted to Gemini only, service-account-bound, billing linked). The temporary `AI_MODEL=gemini-flash-latest` override, added only to stretch free-tier quota, was removed — the app is back on the default newest model.
- _For everyone:_ Planning a trip could stall with a "wait a minute and try again" message after surprisingly little use, because the AI was running on a tiny free allowance. The app now uses a paid AI account, so those interruptions should stop. (One follow-up: the billing account is prepaid and needs credits added before the AI responds again.)

#### Upcoming

- Replacement live hotel data source (TravelPayouts is discontinued).
- Smart paste for Airbnb/VRBO/Amtrak links; Itinerary and Activities redesigns.

## v0.2.0 — 2026-07-17

### Overview

Smarter destination selection. Creating a trip now lands you on a researched, ranked set of real candidate towns — each one cross-checked against Google Places to confirm it actually offers what the AI claims — with a clearly called-out top recommendation explaining why it fits your stated criteria. The chat panel refines this same candidate set, and choosing any candidate (not just the top pick) flows into the map, waypoints, and downstream tabs unchanged.

### Updates

#### New Features

**Grounded destination curation with a top pick**

- _Technical:_ The candidate schema gained `feature_claims` (≤3 concrete, checkable claims per candidate tied to the traveler's interests) and `why_top`. A new `verifyCandidates` pipeline fans out Places text searches (`"${claim} in ${place}"`, minimal field mask) per claim, annotates each candidate with `verified_features`, sorts verified candidates first, and drops candidates with zero confirmed claims (unless that leaves fewer than 3). Both `suggestDestinations` and `chatDestinations` route through the same pipeline, so the initial curation and every chat re-rank return the identical `{ why_top, destinations }` grounded shape.
- _For everyone:_ Suggestions are no longer just AI opinion. Before you see a town, Wayfinder checks with Google that the beach, trails, or restaurants the AI promised actually exist there — confirmed features get a green check, unconfirmed ones are shown crossed out rather than hidden.

**Top-recommendation-first presentation**

- _Technical:_ The picker renders candidate #1 as a hero card ("Top pick" badge, `why_top` copy referencing the parsed criteria, verified-feature chips) with all remaining candidates permanently visible in a comparison grid below — no click-to-reveal. Selection semantics are untouched: any card fires the existing `onPick` → `updateTrip` flow into the map/waypoints/downstream tabs.
- _For everyone:_ Instead of five equal-looking cards, you get one clear "here's our best match and why" plus the runners-up side by side, so you can compare and pick any of them with one click.

#### Bug Fixes

**Region prompts skipped the candidate picker entirely**

- _Technical:_ The parser stored broad regions ("Michigan") in `trip.destination`, putting the workspace into confirmed-destination mode and bypassing curation. The parse schema gained `destination_is_specific`; the landing flow now sets `trip.destination` only for concrete towns/cities, so region prompts open in curation mode (region as hint) while specific-city prompts keep the fast path. The redundant Destination input was removed from the missing-details banner — the curated picker (with manual entry) is the canonical selection path.
- _For everyone:_ Typing "Michigan beaches" used to lock "Michigan" in as if it were a destination and skip the suggestions step. Now the app understands the difference between a region and a town: regions get you a curated shortlist to choose from, and naming an exact city still takes you straight there.

#### Upcoming

- Replacement live hotel data source (TravelPayouts is discontinued).
- Smart paste for Airbnb/VRBO/Amtrak links; Itinerary and Activities redesigns.

## v0.1.1 — 2026-07-17

### Overview

Live-data enablement release: the Destination map, live regional gas prices, and hotel search were switched on with real API credentials. During verification we confirmed that TravelPayouts has discontinued its hotel API entirely, so hotel search now reports its status honestly while manual "Add your stay" remains the primary lodging flow.

### Updates

#### New Features

**Live Google Map on the Destination tab**

- _Technical:_ `VITE_GOOGLE_MAPS_KEY` (browser key, referrer-restricted, Maps JavaScript + Places + Directions APIs) is now configured in Vercel and local env, activating the `@vis.gl/react-google-maps` panel: floating card markers, primary + alternate routes, and clickable waypoints.
- _For everyone:_ The map on the Destination tab is now a real, interactive Google Map instead of a placeholder — suggestions appear as cards on the map, and your driving route (with stops) draws right on it.

**Live regional gas prices**

- _Technical:_ `EIA_API_KEY` configured; the Drive comparison card now pulls the current week's regular-gasoline retail price for the origin's PADD region from the EIA v2 API (verified live: PADD 2 pricing), with the manual $/gal input as an override.
- _For everyone:_ Driving cost estimates now use this week's actual pump prices for your part of the country, updated automatically.

#### Bug Fixes

**Hotel search reports the real provider status**

- _Technical:_ Verification with a valid partner token confirmed every Hotellook/TravelPayouts hotel endpoint returns 404 — the API has been discontinued upstream, not misconfigured. With the token present, the panel now correctly shows the "unavailable + Retry" state rather than a missing-key setup card.
- _For everyone:_ The hotel-search section now tells the truth: the hotel data supplier shut down their service. Adding your own stay (Airbnb, VRBO, hotels) is the main flow and works fully; a replacement live hotel source is on the roadmap.

#### Upcoming

- **Replacement hotel data source** (e.g. Booking.com via RapidAPI or Amadeus) now that TravelPayouts is confirmed discontinued.
- Smart paste for Airbnb/VRBO/Amtrak links; Itinerary and Activities redesigns.

## v0.1.0 — 2026-07-17

### Overview

The first tracked release of Wayfinder. This update delivers a full visual redesign (forest-green sidebar shell, pill-based trip bar, floating map cards), a map-driven Destination tab with an AI refinement chat and route planning, manual-first flows for Lodging and Train travel, a three-way transport cost comparison with live gas prices and richer flight details, an animated trip-curation screen, and this changelog with its in-app "What's New" viewer. It also rolls up all the reliability fixes shipped while moving Wayfinder onto its own infrastructure (Vercel hosting, self-owned Supabase, direct Gemini AI).

### Updates

#### New Features

**Three-pane app shell with forest-green sidebar**

- _Technical:_ The trip workspace was re-housed from a tab-strip layout into a persistent `sidebar | center | right-panel` CSS grid. New `AppSidebar` component (dark `#123526` rail, active-item pill `#1d5a41`, account footer with sign-out) drives navigation via a `?tab=` search param on the trip route, making tabs deep-linkable. A `TripMetaBar` renders destination/dates/travelers/budget as icon chips wired to the existing `updateTrip` mutation.
- _For everyone:_ The app now looks and navigates like a modern travel product: a dark green menu on the left, your trip's key facts (where, when, who, budget) always visible as small pills at the top, and the content in the middle. Nothing about your data changed — it's the same trip, presented much more clearly.

**Map-driven Destination tab with AI chat**

- _Technical:_ New Google Maps panel (`@vis.gl/react-google-maps`, browser key `VITE_GOOGLE_MAPS_KEY`) renders candidate destinations as custom floating-card markers. New server functions: `topPlaces` (Google Places text search for top attractions) and `chatDestinations` (multi-turn Gemini chat that returns a conversational reply plus a re-ranked destination list). After a destination is locked, the Directions service draws the primary route with up to 3 alternates; waypoints added from the UI persist in `trips.parsed_params.waypoints` and feed the Transport tab's driving calculation.
- _For everyone:_ Picking where to go is now a conversation. The app shows top places on a real map, you can tell the AI things like "somewhere more secluded" or "closer to Chicago" and watch the suggestions update, and once you choose, you see your driving route with alternates — and you can pin stops along the way.

**Manual-first Lodging with token-based hotel search**

- _Technical:_ The "Add your stay" form (name, URL, price, dates) is promoted to the primary flow since Airbnb/VRBO expose no public API. TravelPayouts moved to token-authenticated endpoints (`TRAVELPAYOUTS_API_KEY`) after their keyless API was retired; failures now render a typed provider-error card with a retry action instead of a raw HTTP error string.
- _For everyone:_ Found a place on Airbnb or VRBO? Paste its details in directly — that's now the main flow, front and center. Hotel search results still appear below it when the hotel data service is connected, and if that service has a hiccup you get a clear message and a retry button instead of an error code.

**Three-way transport comparison (Drive / Fly / Train)**

- _Technical:_ A comparison card row tops the Transport tab. Drive: OSRM routing now chains waypoints from the Destination tab, and gas cost uses live EIA v2 weekly regional retail prices (`EIA_API_KEY`, PADD region resolved from the origin, national fallback, 6h cache) with the manual $/gal input as override. Fly: Duffel offers now surface `fare_brand_name`/cabin class and per-slice stop counts (previously parsed out). Train: manual-add form (route, price, times) replaces the dead-end placeholder.
- _For everyone:_ One glance now compares driving, flying, and taking the train. Driving costs use this week's actual gas prices for your region and account for any stops you added to your route. Flights show what tier the fare is (basic economy vs. economy) and how many stops. Train prices don't exist in any public data source, so you can type in what you find on Amtrak — same as adding a stay.

**Animated trip-curation screen**

- _Technical:_ Full-screen overlay (Framer Motion) during the landing-page "Plan my trip" mutation: five steps (understanding request → destinations → lodging → transport → activities) animate pending → spinner → checkmark while the AI parse and trip creation run.
- _For everyone:_ Instead of a frozen button while Wayfinder thinks, you now see a step-by-step "planning your trip" screen that shows the work happening.

**Changelog + What's New**

- _Technical:_ Root `CHANGELOG.md` is the single source of truth; the sidebar's "What's New" dialog imports it with Vite's `?raw` and renders it with `react-markdown`, so the app and repo can never drift. `localStorage.lastSeenVersion` drives an unread indicator.
- _For everyone:_ Every update to Wayfinder is now written down in one place, in both technical and plain language — and you can read it right inside the app via the What's New button.

#### Bug Fixes

**AI prompt parsing silently failed, producing empty trips**

- _Technical:_ Gemini's OpenAI-compatible endpoint ignores JSON-schema response enforcement, so the model omitted nullable fields and strict zod validation rejected otherwise-valid output; the failure was swallowed and an all-null trip was created. Fixed by switching to the official `@ai-sdk/google` provider (native structured outputs) and adding a `parse_failed` recovery flag that surfaces an editable trip-details banner instead of a dead end.
- _For everyone:_ Typing a trip request used to sometimes create a blank trip with no explanation. Now the AI reads your prompt reliably, and in the rare case it can't, the app tells you and lets you fill in the details by hand.

**"Continue with Google" showed a 404 outside Lovable hosting**

- _Technical:_ The Lovable OAuth broker path `/~oauth/initiate` only exists behind Lovable's proxy; on Vercel it fell through to the router's not-found page. Google sign-in now routes through native Supabase OAuth on non-Lovable hosts, with the broker retained on `*.lovable.app` domains.
- _For everyone:_ Clicking "Continue with Google" on the new site used to show a "page not found" error. It now takes you through Google's real sign-in and back into the app.

**Successful sign-in looked like a failure**

- _Technical:_ The landing header rendered a static "Sign in" regardless of session state, and the post-auth redirect honored `redirect=/`, returning users to that same header. The header now subscribes to Supabase auth state (Sign in ↔ Sign out), and all auth paths land on the homepage ready to prompt (deep-linked redirects still honored; new signups under auto-confirm navigate immediately).
- _For everyone:_ After signing in — including with Google — the app used to still say "Sign in" as if nothing happened. Now it clearly shows you're signed in and drops you on the homepage, ready to plan a trip.

**Free-tier AI rate limit caused cascading failures with a wall of error text**

- _Technical:_ Compounding retries (AI SDK ×3, schema-retry ×2, React Query ×3) could turn one failed call into ~12 requests against Gemini's 20-req/min free tier. `generateText` now runs with `maxRetries: 1`, quota errors abort immediately with a friendly message, and provider-backed queries no longer auto-retry (all have manual refresh buttons).
- _For everyone:_ Curating a trip could fail with a screen full of technical error text and then keep failing. Now the app backs off gracefully and simply asks you to wait a minute.

**Live hotel search returned a raw "lookup failed: 404"**

- _Technical:_ TravelPayouts retired its keyless public endpoints. The provider now uses token-authenticated endpoints and reports unavailability through the typed provider-status card with a retry action.
- _For everyone:_ The hotels section used to show a cryptic error. It now either shows real hotels (when the data service is connected) or a clear explanation with a retry button.

#### Upcoming

- **Smart paste:** paste an Airbnb/VRBO/Amtrak link and Wayfinder pre-fills the manual-add form from the page's metadata.
- **Itinerary redesign:** drag-to-reorder day planner with time blocks.
- **Activities redesign:** richer filtering, multi-day suggestions, and interest-based ranking.
