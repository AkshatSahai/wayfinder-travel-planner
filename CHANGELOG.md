# Wayfinder Changelog

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
