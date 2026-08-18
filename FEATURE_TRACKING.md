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
- [ ] **Per-item pinned arrival time + conflict check** (itinerary timing fix) — confirm pinning
      a specific activity's time flags a realistic conflict (not enough travel time from the
      prior stop) and doesn't false-positive on reasonable schedules. Added 2026-08-17.
- [ ] **Quieter advisor banner** (itinerary timing fix) — confirm the restyled A4 advisor note
      still surfaces after a drag-reorder, reads correctly, and no longer references a stale or
      mismatched time. Added 2026-08-17.
- [ ] **Geography-aware clustering in "Build out itinerary"** — confirm against the reported real
      case (four Merrillville/Michigan City, IN venues within ~5 minutes of each other) that they
      now land on the same day; tune `CLUSTER_RADIUS_MILES` in `geo-cluster.ts` (currently 9) if
      it over- or under-groups on real trips. Added 2026-08-17.
- [ ] **"Remove from itinerary" unschedules instead of deleting** — confirm removing a scheduled
      activity from the Itinerary tab returns it to the Activities tab's staged list rather than
      deleting it, and that deleting from the Activities tab still actually deletes it. Added
      2026-08-17.
- [ ] **Draggable activities panel** (left side of the Itinerary tab) — confirm dragging a staged
      activity onto a day schedules it, dragging a scheduled one back onto the panel unschedules
      it, the panel's collapse toggle works, and the day map/notes stay in sync either way. Added
      2026-08-17.
- [ ] **Chat reads as part of the screen, not a popup** — confirm the Map/Ask AI tab switcher in
      the itinerary's right slot feels integrated (no backdrop/overlay), and that existing edit
      commands ("move X to day 2") still work exactly as before. Added 2026-08-17.
- [ ] **Chat research mode** — confirm an open-ended question ("what are good restaurants near
      day 2's stops?") returns real, named Places results with reasoning (not hallucinated), and
      that a genuinely ambiguous question gets a clarifying reply instead of a guess. Added
      2026-08-17.
- [ ] **Day map location fix** — confirm a day with activities added via the Places browse dialog
      (e.g. "Anytime — food & places") now renders pins and a route instead of "nothing to plot,"
      both for already-saved activities (reader fallback) and newly-added ones (writer fix). Added
      2026-08-17.
- [ ] **Manually-added activities now get geocoded** — confirm a new activity added via the manual
      form (typed location, autocompleted location, and no location at all) ends up with real
      coordinates and plots on the day map once scheduled; confirm browse-dialog/chat-added
      activities are unaffected (no duplicate lookup). Added 2026-08-17.
- [ ] **Existing coordinate-less activities** — for any activity added before this fix (e.g. the
      reported "Albanese Candy Factory"), confirm the workaround still works: unschedule it, then
      either re-add it or re-run "Build out itinerary" to pick up real coordinates. Added
      2026-08-17.

## Scoped, not yet built
(Decided to build, not started or paused.)

- [ ] **Presence indicator** — show who else is currently viewing a shared trip. Realtime
      plumbing already exists (`use-trip-realtime`); the indicator itself isn't built. Added
      2026-08-17.
- [ ] **Hotel data source replacement** — TravelPayouts (the original hotel search provider) is
      discontinued/dead (all endpoints 404). Manual "Add your stay" is the current workaround;
      need a real hotel search API. Top backlog item. Added 2026-08-17.
- [ ] **Owner vs. shared trip badge** — the trips list doesn't yet distinguish trips you own from
      trips shared with you, even though shared trips are already returned. Added 2026-08-17.
- [ ] **Smart paste for Lodging/Transport links** — paste-a-link metadata fetch (Airbnb, VRBO,
      Amtrak, etc.) currently only works in Activities; not extended to Lodging or Transport.
      Added 2026-08-17.

## Out of scope / deferred
(Explicitly decided not to build now, or ever.)

- None yet — items land here once we actively decide to hold or drop them, rather than by
  default.
