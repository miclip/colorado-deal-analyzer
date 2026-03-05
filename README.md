# Colorado Deal Analyzer

A single-page app that fetches Colorado county property data from public ArcGIS APIs, finds comparable sales, and generates a complete AI analysis prompt you can paste into Claude or ChatGPT.

**Live:** https://miclip.github.io/colorado-deal-analyzer/

## Supported Counties

| County | Data Source | Status |
|--------|-----------|--------|
| Adams | Adams County ArcGIS Online (Parcels, Property_Improvements, Property_Sales, Property_Values) | Full support |
| Boulder | Boulder County ArcGIS (ParcelPropertyView, BLDG_ATTRIBUTES, SALES, VALUES, PARCELS_OWNER) | Full support |
| Broomfield | Broomfield ArcGIS Online (single Parcels layer with all data) | Full support |
| Denver | Denver ArcGIS Online (PROP_PARCELS_A, residential_characteristics, sales_and_transfers) | Full support |
| Larimer | Larimer County ArcGIS (Tax Parcels, Site Address, Sales) | Partial — sales + parcels only, no building attributes or values (those require bulk CSV downloads) |
| Mesa | Mesa County ArcGIS Online (single Tax_Parcels_Hosted layer with all data) | Full support |
| Weld | Weld County ArcGIS Online (Account_Point, Ownership2, Imps_CurrentInvntry, Sales2, Parcels) | Full support |

## How It Works

1. **Search** — Select a county and type a property address. Autocomplete queries the county's parcel data.
2. **Review** — See building details, area breakdown, assessed values, and full sale history pulled from multiple APIs in parallel.
3. **Configure** — Pick an investment strategy (Flip / Rental / Wholesale) and set parameters like rehab quality, rent targets, or assignment fees.
4. **Generate** — The app finds comparable sales within your chosen radius, scores them by similarity, and builds a detailed analysis prompt with subject data, comp data, adjustment instructions, and strategy-specific analysis steps.

Copy the prompt into an AI assistant for a full deal analysis with math.

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
├── arcgis.ts           # Generic ArcGIS REST query helper (POST-based)
├── comp-finder.ts      # Spatial search + scoring + flip detection
├── prompt-builder.ts   # Assembles the AI analysis prompt
├── types.ts            # TypeScript interfaces
├── utils.ts            # Haversine distance, formatting, chunking
├── counties/
│   ├── types.ts        # CountyDataSource interface
│   ├── index.ts        # County registry
│   ├── adams.ts        # Adams County adapter
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

The `CountyDataSource` interface requires: `searchByAddress`, `lookupProperty`, `findNearbyAccountNos`, `getRecentSales`, `getBuildingInfoBatch`, `getParcelInfoBatch`, and `getSalesHistory`.

## Build & Deploy

Pushes to `main` auto-deploy via GitHub Actions.

```sh
npm run build    # outputs to build/
npm run preview  # preview production build locally
```
