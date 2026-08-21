# Feature Tracking

Living doc. Update this whenever we decide to hold a feature, scope something out, scope it
back in later, or ship something that needs real manual testing. Unlike `CHANGELOG.md` (what
shipped) and `context.md` (architecture/decision log), this file exists so nothing falls through
the cracks between "built" and "verified," or between "discussed" and "actually scheduled."

## Needs manual testing
(Built, but can't be verified without a real account, real API keys, or real usage — needs a
human run-through.)

- [ ] **Flight travel estimates (Duffel)** — confirm live flight search/pricing returns sane
      results end-to-end. Untested locally (no local Duffel key). Added 2026-08-17.
- [ ] **Places autocomplete suggestions in-browser** — confirm destination/activity search
      suggestions behave correctly while typing. Untested locally. Added 2026-08-17.
- [ ] **Ticketmaster events** — confirm event search/results in the Activities browse dialog.
      Untested locally. Added 2026-08-17.
- [ ] **Live gas prices (EIA)** — confirm drive-cost estimates reflect real current prices.
      Untested locally. Added 2026-08-17.
- [ ] **Live maps in local dev** — maps are reported to only work in production; confirm
      whether this is still true and why. Added 2026-08-17.
- [x] **Per-item pinned arrival time + conflict check** — **VERIFIED 2026-08-19.** Pinning the
      3rd item on a day to 00:15 produced: `"Field Museum (legacy flat coords)" is pinned for
      00:15, but the stops before it need until roughly 03:33.` The chip then read `12:15 AM`.
      Now surfaces as a toast, not the inline pill (that pill was shared with the removed drag
      advisor). Not yet checked for false positives on a reasonable schedule.
- [x] **"Remove from itinerary" unschedules instead of deleting** — **VERIFIED 2026-08-19.**
      Unscheduling from the day column returned the row to the activities panel as
      "Unscheduled" with toast "Moved back to your activities list"; the row was not deleted.
      The Activities tab's own delete button is still untested.
- [x] **Draggable activities panel** — **VERIFIED 2026-08-19.** Dragged "Unscheduled Art Walk"
      from the panel onto Day 4: panel badge changed Unscheduled → Day 4 and the row appeared in
      the day column. The collapse toggle is still untested.
- [ ] **Manually-added activities now get geocoded** — still open; needs `GOOGLE_API_KEY`, which
      was not available for this pass. Added 2026-08-17.
- [ ] **Existing coordinate-less activities** — for any activity added before the v0.7.2 fix (e.g.
      the reported "Albanese Candy Factory"), the workaround has changed with v0.9.0: "re-run
      Build out itinerary" is no longer available, so the remaining path is to delete and re-add
      it from the Activities tab, which routes through `enrichActivityLocation`. Confirm that
      works. Updated 2026-08-19.
- [ ] **Itinerary Day 1 date fix** — confirm in a real US-timezone browser that Day 1's header and
      tab now match the trip's `start_date` exactly (was showing one day early). Added 2026-08-20.
- [ ] **Transport tab removal** — confirm the Transport nav item/route are fully gone, Trip
      Details no longer shows a travel-time estimate or "Sort out transport" task, and a trip
      with pre-existing `kind: transport` items still totals its budget correctly. Added
      2026-08-20.
- [ ] **Activities: distance-from-lodging sort** — confirm the Distance column and sort-by-distance
      only appear once a stay is booked, sort correctly nearest-to-farthest, and degrade cleanly
      with no lodging booked. Added 2026-08-20.
- [ ] **Activity edit dialog** — confirm clicking a row in the Activities tab and a card in the
      Itinerary tab both open the same edit dialog, saved changes persist, and the Date field is
      correctly locked (with an explanation) for already-scheduled activities. Added 2026-08-20.
- [ ] **Deeper URL-fetch extraction (JSON-LD + Places hours)** — confirm pasting a real ticketed
      event URL and a real venue URL pull in ticket price/reservation/hours/address only when
      actually present in the page's JSON-LD or Google Places, never fabricated, with "auto-filled"
      badges shown correctly. Added 2026-08-20.
- [ ] **Lodging link-fetch ("Fetch details")** — confirm pasting an Airbnb/VRBO/hotel link on the
      Lodging tab prefills name/price/address/image where available and leaves fields blank
      otherwise. Added 2026-08-20.

#### v0.12.0 — added 2026-08-20, none verified

Static gates all passed (`tsc`, `eslint`, `build`) — which, per §10 of context.md, is not a result.
Everything here needs a real browser, and the map items additionally need a Maps key on an allowed
referrer, so production is the only place they can be checked.

- [ ] **Booked stay pins on the Itinerary map** — the reported bug. Confirm on a trip whose stay
      predates v0.12.0 (address text, no `details.coords`) that the stay now pins, the
      `no-lodging-notice` is gone, and the distance table is populated. ⚠️ Also worth pinning down
      **which** of the two causes was real: if the stay was already pinning and just unreadable, the
      geocode persistence is still correct but was not the fix.
- [ ] **Newly added stays persist coordinates** — add a stay with an address, then confirm the row's
      `details.coords` is set at write time (needs `GOOGLE_API_KEY`), not just resolved client-side.
- [ ] **Candidate vs booked pins** — visually distinct without a legend; adding a candidate changes
      neither budget totals nor which stay anchors distances.
- [ ] **Day numbering matches the rail** — including after a drag-reorder, and including a day
      containing a stop with no coordinates (that stop must consume its number, leaving a visible
      gap on the map rather than renumbering the rest).
- [ ] **Hover cards** — distance values match the Activities list; no booked stay means name only,
      not a placeholder.
- [ ] **Request counts unchanged** — `distancesFromLodging` and `dayDistanceMatrix` must not
      increase, and a drag-reorder must fire neither. This is the assertion that proves the day map
      didn't quietly become the v0.9.0 one again.
- [ ] **Viewport is not hijacked** — pan/zoom the map, trigger a re-render, confirm the polyline
      doesn't refit the bounds. `FitToPins` and `PathLayer` both call `fitBounds` and were racing
      before this release.
- [ ] **A day with 5+ stops** — numbered pins and the connector stay legible without bad overlap.
- [ ] **TravelPayouts removal** — Lodging tab has exactly one add flow, no console errors, and
      stays previously added with `source: "live"` still render and still count toward budget.

### v0.10.0 (itinerary distances + timeline rail) — VERIFIED 2026-08-19

Headless Edge via `puppeteer-core` against the live Supabase project, on a seeded Chicago trip:
day 0 = booked stay → Shedd → Field, day 1 = Zoo → an unlocated block → Powers, plus a second
trip with no lodging at all.

- [x] **The two distance types are genuinely different calculations** — **PASS.** Shedd, the first
      stop after the stay, showed `1.9 mi · 5 min` as both its leg and its from-stay figure (they
      must agree there). Field showed a `0.5 mi` leg against a `1.7 mi` from-stay. After dragging
      Field to first its leg became `1.7 mi`, matching its from-stay exactly — order-dependence
      demonstrated in both directions.
- [x] **Reorder recalculates every leg** — **PASS.** Order changed and legs updated
      (`1.7 mi` stay→Field, `1.0 mi` Field→Shedd), with `dayDistanceMatrix` staying at **1 call**
      — no refetch, which is the entire point of the matrix over per-order routing.
- [x] **No booked lodging** — **PASS.** Chain started at the first activity, zero "stay" nodes,
      and the panel's from-stay lines were absent rather than dashes.
- [x] **A stop with no coordinates** — **PASS.** `Zoo → [no location] → Relax, no plans (hollow
      node) → [no location] → Powers`. Rail unbroken, no bridged mileage anywhere.
- [x] **One request, not two** — **PASS.** Exactly one `distancesFromLodging` call with both the
      activities panel and the map table mounted, confirming the id-sorted shared query key.
- [x] **Still no AI calls** — **PASS.** Observed handlers: `getTrip`, `dayDistanceMatrix`,
      `distancesFromLodging`, `updateTripItems`. No AI-backed handler, no page errors.
- [x] **Timeline rail against the mockup** — **PASS.** The "option C" mockup arrived after the
      first build and was matched against it: solid larger node for the stay, hollow grey rings
      for ordinary stops, spine running node-to-node, leg text with car icon between the cards.
      Uses the app's green `--primary` rather than the mockup's navy. Added 2026-08-19.
- [x] **Rail appearance in a real browser** — **PASS, by screenshot.** The rail is pure CSS with
      no Maps dependency, so unlike the map pins it could be rendered and looked at locally.
      **This caught a real defect the DOM could not:** with the ring at `--border` (near-white)
      the hollow node barely registered and the 40%-opacity "no location" variant vanished
      entirely — every testid and computed style was correct while the thing was unreadable.
      Fixed by darkening the ring to `border-muted-foreground/45`. Added 2026-08-19.

### v0.9.0 (static activity map) — VERIFIED 2026-08-19

Headless Edge via `puppeteer-core` against the live Supabase project, on a seeded 4-day Chicago
trip: booked stay + a lodging *candidate*, activities across 3 days, a pinned arrival time, a
**legacy flat `details.lat`/`lng`** row, a no-coords row, and an unscheduled activity.

- [x] **No AI calls from the Itinerary tab** — **PASS.** All 17 server-fn calls observed across
      the whole session decoded to: `getTrip` ×11, `distancesFromLodging` ×3, `updateTripItems`,
      `updateTripItem`, `addTripItem`. Zero deleted handlers, zero AI-backed handlers, zero
      direct AI HTTP, zero undecoded ids. Dev-server log shows no Gemini activity.
      **Positive control:** the same probe caught `searchTransport` immediately on the Transport
      tab, so the silence is a real negative rather than a broken instrument.
- [x] **Trip-wide activity map** — **PASS, partial.** `activity-map-empty` absent (proves a
      non-empty pin set incl. the booked stay), and the distance table was byte-identical across
      all 4 day tabs — the real "not day-scoped" proof. Pins were **not visually confirmed**: no
      `VITE_GOOGLE_MAPS_KEY` locally, and `localhost` isn't on the key's referrer allowlist, so
      the map renders "Map isn't connected yet". Visual confirmation still owed in production.
- [x] **Distance + drive time list** — **PASS.** Real OSRM road distances from the booked Loop
      hotel: Shedd 1.9 mi/5m, Field 1.7 mi/5m, Lincoln Park Zoo 3.4 mi/9m, Powers Rec Area
      10.6 mi/21m — all plausible for Chicago. The no-coords row read "No location" and was named
      in the unplotted footnote. The Evanston lodging **candidate** did not anchor distances.
      Table refreshed after adding a block, no reload.
- [x] **No-lodging state** — **PASS.** Trip B showed "Book a stay on the Lodging tab to see how
      far each activity is from it."; headers were `ACTIVITY / CATEGORY / WHEN / COST` with no
      distance columns; map panel still rendered its pin set; `distancesFromLodging` was
      correctly **not called** at all.
- [~] **Straight-line fallback** — **NOT REPRODUCED.** The public OSRM server returned the
      `distance` annotation on every request, so the fallback never fired. Untested, not passed.
- [x] **Legacy flat-coords rows still plot** — **PASS.** The single highest-value assertion for
      this change: "Field Museum (legacy flat coords)" resolved to 1.7 mi, confirming the
      `coordsOf` fallback survived being salvaged out of the deleted `itinerary-day-panel.tsx`
      into `workspace-store.ts`.
- [x] **Existing data unaffected** — **PASS.** Pinned time rendered, 4 day tabs correct, booked
      stay anchored distances, budget read `$1,030 / $2,000` — the $700 lodging candidate and the
      staged activity both correctly excluded, matching pre-v0.9.0 semantics.
- [x] **Removed UI is gone** — **PASS.** `itinerary-chat`, `advisor-note`, and
      `build-itinerary-btn` all absent. Activities tab copy now reads "1 not scheduled yet, 5 on
      your itinerary — drag them onto a day from the Itinerary tab."

### Removed in v0.9.0 without ever being verified

These were built in v0.5.0–v0.8.0 and deleted before anyone confirmed they worked in a live
browser. Recorded rather than deleted so the cost of shipping unverified is visible: five
features' worth of work, none of it ever known to be correct in production.

- ~~Geography-aware clustering in "Build out itinerary"~~ — removed with the AI scheduler.
- ~~Chat research mode~~ — removed with the itinerary chat.
- ~~Quieter advisor banner~~ — removed with the drag advisor.
- ~~Day map location fix (per-day route rendering)~~ — the underlying `coordsOf` reader fallback
  **survived** and moved to `workspace-store.ts`; only the per-day route map went. Its
  verification is now covered by "Trip-wide activity map" above.
- ~~Itinerary layout: full-width map + persistent chat sidebar~~ — superseded one release later.

## Scoped, not yet built
(Decided to build, not started or paused.)

- [ ] **Activities redesign — the parts that are still wanted.** Promised in v0.1.0's "Upcoming" as
      "richer filtering, multi-day suggestions, and interest-based ranking," then tracked in no
      file at all for ten releases. Recovered 2026-08-20; it was lost scope, not a decision.
      Not all of it survives contact with what shipped since, so it is split rather than restored
      wholesale:
      - **Still live:** multi-day suggestions; interest-based ranking (the trip already carries
        `interests` and nothing on the Activities tab reads them).
      - **Partly superseded:** "richer filtering." v0.11.0 deliberately deleted the Category field
        and added a distance-from-stay sort, which covered the actual complaint. Any filtering
        work here should start from what's missing now, not from the v0.1.0 wording.
- [ ] **Per-stay check-in/check-out dates** — Lodging's dates are trip-wide today. Named as
      out-of-scope in v0.11.0's changelog ("a separate, unstarted piece of scope") but never
      tracked anywhere. Logged 2026-08-20.

## Out of scope / deferred
(Explicitly decided not to build now, or ever.)

- **Hotel data source replacement** — **DECIDED 2026-08-20: removed, not replaced.** TravelPayouts
  was discontinued (every endpoint 404s with a valid token) and sat in six consecutive "Upcoming"
  sections without being built. Manual "Add your stay" is now the permanent flow; link-fetch
  prefill (v0.11.0) removed most of the tedium that made a live API worth chasing. The provider,
  the `searchLodging` server fn and the whole live-search UI were deleted in v0.12.0. Recorded
  rather than deleted so the decision is visible: this is a choice, not an oversight.
- **Shared Maps `APIProvider`** — deferred 2026-08-20, having been scoped into v0.12.0 and then
  pulled back out. It looked like a tidy-up inside the trip workspace, but `PlaceAutocomplete`
  mounts its own provider on the **landing page** too, so collapsing to one means a provider at the
  root — changing how the Maps API loads for the whole app, not just the workspace. That is not
  something any static gate can check, and maps can't be exercised locally (no key; `localhost:8080`
  isn't on the referrer allowlist), so it would ship to production unverifiable, alongside the very
  map changes that most need to work. Worth doing on its own, with a preview deploy.
- **Migrate server fns off deprecated `.inputValidator()`** — deferred 2026-08-20. Touches every
  server function; no urgency; not worth bundling into a large release.
- **Byte-cache proxied Places photos** — deferred 2026-08-20. A perf change with no current
  trigger; `/api/places/photo` already sets a 24h immutable `Cache-Control`.
- **Presence indicator** — show who else is currently viewing a shared trip. Deliberately
  dropped, 2026-08-20: not pursuing for now.
- **Owner vs. shared trip badge** — distinguishing owned vs. shared trips in the trips list.
  Deliberately dropped, 2026-08-20: not pursuing for now.

## Known inconsistency, not yet decided

- **The Itinerary map's distance table still has a Category column.** v0.11.0 removed Category from
  the Activities tab as "decorative, not something scheduling ever read," but
  `activity-map-panel.tsx` still renders it. Left alone in v0.12.0 rather than silently widening
  that release's scope — but the two tabs now disagree about whether Category exists. Noticed
  2026-08-20.
