# Repertory Signal

NYC repertory / arthouse movie showtimes for a single user, with transparent ranking, travel-time heuristics, a monthly calendar, and a hidden admin mode.

## Stack

- Next.js + TypeScript
- Prisma schema targeting Postgres
- Tier 1 adapter system with live fetch-backed ingestion
- Local persistence for thumbs, live boosts, and admin overrides in v1

## Current status

This repo ships a production-oriented architecture and live Tier 1 ingestion for:

- Film Noir Cinema
- Low Cinema
- IFC Center
- Spectacle Theater
- Museum of the Moving Image

The runtime now fetches live source pages for the Tier 1 venues where access is available, with local browser persistence for user preferences and admin overrides. Some venues may still fail because of source-side bot protection or markup changes; those failures are surfaced in admin health instead of silently replaced with fake data.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies if this repo does not already have them available.
3. Run `npm run dev`.
4. Open `/projection-room` and use `ADMIN_SECRET` to unlock admin mode.

## Test

Run:

```bash
npm test
```

## Environment

- `DATABASE_URL`: Postgres connection string for production persistence
- `ADMIN_SECRET`: hidden admin gate secret
- `USE_DEMO_DATA`: set to `true` only if you want the old fixture-backed demo runtime
- `OPENAI_API_KEY`: reserved for future live summary generation
- `OPENAI_MODEL`: reserved for future live summary generation

## Add a venue

1. Add the venue record in [src/lib/catalog.ts](/Users/davidohuff/Documents/nyc-repertory-showtimes/src/lib/catalog.ts).
2. Create a fixture or live fetch implementation under [src/lib/fixtures](/Users/davidohuff/Documents/nyc-repertory-showtimes/src/lib/fixtures) or a fetch-backed adapter.
3. Implement a `VenueAdapter` in [src/lib/adapters/base.ts](/Users/davidohuff/Documents/nyc-repertory-showtimes/src/lib/adapters/base.ts).
4. Register it in [src/lib/adapters/registry.ts](/Users/davidohuff/Documents/nyc-repertory-showtimes/src/lib/adapters/registry.ts).
5. Add fixture tests in [src/tests/adapters.test.ts](/Users/davidohuff/Documents/nyc-repertory-showtimes/src/tests/adapters.test.ts).

## Repair a broken parser

1. Check the admin health view in `/projection-room`.
2. Inspect the raw fixture or source payload for the affected venue.
3. Update only the relevant adapter parser.
4. Re-run `npm test` and add a regression fixture if the source shape changed.

## Re-run ingestion for one venue

POST to:

```bash
/api/admin/ingest/[slug]
```

Example venue slug: `ifc-center`

## Notes on persistence

- User preferences, boost toggles, paused venues, manual screenings, and summary overrides are currently stored in `localStorage`.
- The Prisma schema models the Postgres-backed destination shape for Phase 1+ productionization.
