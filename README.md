# Boulder Deal Analyzer

A single-page app that fetches Boulder County property data from public ArcGIS APIs, finds comparable sales, and generates a complete AI analysis prompt you can paste into Claude or ChatGPT.

**Live:** https://miclip.github.io/boulder-deal-analyzer/

## How It Works

1. **Search** — Type a property address. Autocomplete queries Boulder County's ParcelPropertyView.
2. **Review** — See building details, area breakdown, assessed values, and full sale history pulled from 5 APIs in parallel.
3. **Configure** — Pick an investment strategy (Flip / Rental / Wholesale) and set parameters like rehab quality, rent targets, or assignment fees.
4. **Generate** — The app finds comparable sales within your chosen radius, scores them by similarity, and builds a detailed analysis prompt with subject data, comp data, adjustment instructions, and strategy-specific analysis steps.

Copy the prompt into an AI assistant for a full deal analysis with math.

## Data Sources

All data comes from Boulder County's public ArcGIS REST services (no API key needed):

| Service | What It Provides |
|---------|-----------------|
| ParcelPropertyView | Address, lat/lng, lot size, neighborhood, owner |
| BLDG_ATTRIBUTES | Beds, baths, finished sqft, year built, design |
| BLDG_AREA | Per-floor/section area breakdown |
| SALES | Sale date, price, deed type, reception number |
| VALUES | Actual and assessed values by year |
| PARCELS_OWNER | Spatial polygon data for radius searches |

## Comp-Finding Algorithm

1. Spatial query finds parcels within the user's radius
2. Batch-queries recent sales (18 months, > $50k) for those parcels
3. Filters out quit claim deeds with $0 price
4. Fetches building attributes for candidates
5. Scores by similarity: sqft (30%), beds (20%), year built (15%), distance (35%)
6. Returns top 6, then fetches full sale chains for flip detection

## Tech Stack

- SvelteKit (Svelte 5) with TypeScript
- Tailwind CSS v4
- Static SPA (adapter-static) — all API calls run in the browser
- GitHub Pages via Actions

## Development

```sh
npm install
npm run dev
```

Open http://localhost:5173.

## Project Structure

```
src/lib/
├── arcgis.ts           # ArcGIS REST client (POST-based queries)
├── property-lookup.ts  # Fetches all data for one property (5 parallel calls)
├── comp-finder.ts      # Spatial search + scoring + flip detection
├── prompt-builder.ts   # Assembles the AI analysis prompt
├── types.ts            # TypeScript interfaces
├── utils.ts            # Haversine distance, formatting, chunking
└── components/
    ├── AddressSearch.svelte   # Debounced autocomplete
    ├── PropertyCard.svelte    # Property detail display
    ├── InvestmentForm.svelte  # Strategy + parameter inputs
    ├── CompList.svelte        # Comp cards with stats
    └── PromptOutput.svelte    # Copy/download prompt
```

## Build & Deploy

Pushes to `main` auto-deploy via GitHub Actions.

```sh
npm run build    # outputs to build/
npm run preview  # preview production build locally
```
