# Colorado Deal Analyzer

A single-page app that fetches Colorado county property data from public ArcGIS APIs, finds comparable sales, and generates a complete AI analysis prompt you can paste into Claude or ChatGPT.

**Live:** https://coloradodeals.miclip.io

## Supported Counties

| County | Data Source | Status |
|--------|-----------|--------|
| Adams | Adams County ArcGIS Online (Parcels, Property_Improvements, Property_Sales, Property_Values) | Full support |
| Arapahoe | Arapahoe County ArcGIS (CustomCAMA_WM MapServer + GeocodeServer) | Partial — no beds/baths data |
| Boulder | Boulder County ArcGIS (ParcelPropertyView, BLDG_ATTRIBUTES, SALES, VALUES, PARCELS_OWNER) | Full support |
| Broomfield | Broomfield ArcGIS Online (single Parcels layer with all data) | Full support |
| Denver | Denver ArcGIS Online (PROP_PARCELS_A, residential_characteristics, sales_and_transfers) | Full support |
| Larimer | Larimer County ArcGIS (Tax Parcels, Site Address, Sales) | Partial — no building attributes or values |
| Mesa | Mesa County ArcGIS Online (single Tax_Parcels_Hosted layer with all data) | Full support |
| Weld | Weld County ArcGIS Online (Account_Point, Ownership2, Imps_CurrentInvntry, Sales2, Parcels) | Full support |

### County Capabilities

| County | Address Search | Beds/Baths | Sqft/Year | Sales History | Values | Lot Size |
|--------|---------------|------------|-----------|---------------|--------|----------|
| Adams | SQL LIKE on parcels | Yes | Yes | Full chain | Yes | Yes |
| Arapahoe | Geocoder (suggest + resolve) | No | Yes | Most recent only | Yes (market + land) | No |
| Boulder | SQL LIKE on parcels | Yes (full/half/3/4) | Yes | Full chain | Yes | Yes |
| Broomfield | SQL LIKE on parcels | Yes | Yes | Most recent only | Yes | Yes |
| Denver | SQL LIKE on parcels | Yes | Yes | Partial (fallback to parcels) | No | Yes |
| Larimer | SQL LIKE on parcels | No | No | Full chain | No | Yes (computed from polygon) |
| Mesa | SQL LIKE on parcels | Yes | Yes | Most recent only | Yes | Yes |
| Weld | SQL LIKE on parcels | Yes | Yes | Full chain | Yes | Yes |

### Why Some Counties Are Missing

Several large Colorado counties are not supported due to data access limitations:

- **El Paso** (Colorado Springs) — No public ArcGIS REST API for assessor data. Property data requires their PropertyMax portal which uses authentication.
- **Jefferson** (Lakewood/Golden) — Assessor data is behind an authenticated portal. ArcGIS services exist for parcels but lack building attributes and sales.
- **Douglas** (Castle Rock) — No public ArcGIS REST service for assessor/property data. Data is only available through their county website with CAPTCHA.
- **Pueblo** — Has ArcGIS services but the parcel layers lack building attributes and sales data needed for comp analysis.

All supported counties use publicly accessible ArcGIS REST APIs with CORS support, enabling browser-side queries without a proxy server.

## How It Works

1. **Search** — Select a county and type a property address. Autocomplete queries the county's parcel data.
2. **Review** — See building details, area breakdown, assessed values, and full sale history pulled from multiple APIs in parallel.
3. **Configure** — Pick an investment strategy (Retail Sale / Flip / Rental / Wholesale) and set parameters like rehab quality, rent targets, list price, or assignment fees.
4. **Generate** — The app finds comparable sales within your chosen radius, scores them by similarity, and builds a detailed analysis prompt with subject data, comp data, adjustment instructions, and strategy-specific analysis steps.

Copy the prompt into an AI assistant for a full deal analysis with math.

## Comp-Finding Algorithm

1. Spatial query finds parcels within the user's radius
2. Batch-queries recent sales (18 months, > $50k) for those parcels
3. Filters out quit claim deeds with $0 price
4. Fetches building attributes + lot acreage for candidates
5. Scores by similarity. Weights shift based on subject lot size:
   - Urban (lot < 0.5 ac): sqft 30%, beds 15%, year 10%, lot 15%, distance 30%
   - Rural (lot ≥ 0.5 ac): sqft 20%, beds 10%, year 10%, lot 30%, distance 30%
6. Returns top 6, then fetches full sale chains (for flip detection) and outbuilding areas (Boulder only)
7. Filters $0 / non-market transfers (estate, survivorship, correction deeds) out of comp sales history

## Tech Stack

- SvelteKit (Svelte 5) with TypeScript
- Tailwind CSS v4
- Static SPA (adapter-static) — all API calls run in the browser
- Hosted on Vercel

## Development

```sh
npm install
npm run dev
```

Open http://localhost:5173.

## Project Structure

```
src/lib/
├── arcgis.ts           # Generic ArcGIS REST query helper (POST-based)
├── comp-finder.ts      # Spatial search + scoring + flip detection
├── prompt-builder.ts   # Assembles the AI analysis prompt
├── types.ts            # TypeScript interfaces
├── utils.ts            # Haversine distance, formatting, chunking
├── counties/
│   ├── types.ts        # CountyDataSource interface
│   ├── index.ts        # County registry
│   ├── adams.ts        # Adams County adapter
│   ├── arapahoe.ts     # Arapahoe County adapter (no beds/baths)
│   ├── boulder.ts      # Boulder County adapter
│   ├── broomfield.ts   # Broomfield County adapter
│   ├── denver.ts       # Denver County adapter
│   ├── larimer.ts      # Larimer County adapter (no building data)
│   ├── mesa.ts         # Mesa County adapter
│   └── weld.ts         # Weld County adapter
└── components/
    ├── AddressSearch.svelte   # Debounced autocomplete
    ├── PropertyCard.svelte    # Property detail display
    ├── InvestmentForm.svelte  # Strategy + parameter inputs
    ├── CompList.svelte        # Comp cards with stats
    └── PromptOutput.svelte    # Copy/download prompt
```

## Adding a New County

1. Create `src/lib/counties/{county}.ts` implementing `CountyDataSource`
2. Register it in `src/lib/counties/index.ts`

The `CountyDataSource` interface requires: `searchByAddress`, `lookupProperty`, `findNearbyAccountNos`, `getRecentSales`, `getBuildingInfoBatch`, `getParcelInfoBatch` (returns lot acreage when available), and `getSalesHistory`. Optionally implement `getBuildingAreasBatch` if the county exposes outbuilding/area breakdowns.

## Build & Deploy

Pushes to `main` auto-deploy via Vercel.

```sh
npm run build    # outputs to build/
npm run preview  # preview production build locally
```
