<script lang="ts">
	import type { SearchResult, PropertyData, InvestmentParams, AnalysisResult } from '$lib/types';
	import type { CountyDataSource } from '$lib/counties/types';
	import { counties, countyList, getCounty } from '$lib/counties';
	import { findComps } from '$lib/comp-finder';
	import { buildPrompt } from '$lib/prompt-builder';
	import { median } from '$lib/utils';
	import AddressSearch from '$lib/components/AddressSearch.svelte';
	import PropertyCard from '$lib/components/PropertyCard.svelte';
	import InvestmentForm from '$lib/components/InvestmentForm.svelte';
	import CompList from '$lib/components/CompList.svelte';
	import PromptOutput from '$lib/components/PromptOutput.svelte';

	// County selection
	let selectedCountyId = $state('boulder');
	let county = $derived(getCounty(selectedCountyId));

	// Step state: 1=search, 2=property, 3=params, 4=results
	let step = $state(1);
	let selectedResult = $state<SearchResult | null>(null);
	let property = $state<PropertyData | null>(null);
	let analysis = $state<AnalysisResult | null>(null);
	let loadingProperty = $state(false);
	let loadingAnalysis = $state(false);
	let errorMsg = $state('');

	async function handleAddressSelect(result: SearchResult) {
		selectedResult = result;
		loadingProperty = true;
		errorMsg = '';
		step = 2;

		try {
			property = await county.lookupProperty(result.accountNo);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to fetch property data';
			step = 1;
		} finally {
			loadingProperty = false;
		}
	}

	function confirmProperty() {
		step = 3;
	}

	async function handleAnalyze(params: InvestmentParams) {
		if (!property) return;
		loadingAnalysis = true;
		errorMsg = '';
		step = 4;

		try {
			const comps = await findComps(county, property, params.compRadius || 0.5);

			const salesPrices = comps
				.map((c) => c.sales[0]?.price)
				.filter((p): p is number => p != null && p > 0);
			const pricesPerSqft = comps
				.filter((c) => c.building?.sqft && c.sales[0]?.price)
				.map((c) => c.sales[0].price / c.building!.sqft);

			const prompt = buildPrompt(property, comps, params, county.name);

			analysis = {
				subject: property,
				comps,
				prompt,
				compStats: {
					medianPrice: median(salesPrices),
					avgPricePerSqft:
						pricesPerSqft.length > 0
							? Math.round(pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length)
							: 0,
					count: comps.length
				}
			};
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Analysis failed';
			step = 3;
		} finally {
			loadingAnalysis = false;
		}
	}

	function startOver() {
		step = 1;
		selectedResult = null;
		property = null;
		analysis = null;
		errorMsg = '';
	}
</script>

<!-- Progress Steps -->
<div class="mb-8">
	<div class="flex items-center justify-between">
		{#each [
			{ num: 1, label: 'Search' },
			{ num: 2, label: 'Property' },
			{ num: 3, label: 'Parameters' },
			{ num: 4, label: 'Analysis' }
		] as s}
			<div class="flex items-center gap-2">
				<div
					class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold {step >= s.num
						? 'bg-blue-600 text-white'
						: 'bg-gray-200 text-gray-500'}"
				>
					{s.num}
				</div>
				<span class="hidden text-sm font-medium sm:inline {step >= s.num ? 'text-gray-900' : 'text-gray-400'}">
					{s.label}
				</span>
			</div>
			{#if s.num < 4}
				<div class="mx-2 h-px flex-1 {step > s.num ? 'bg-blue-600' : 'bg-gray-200'}"></div>
			{/if}
		{/each}
	</div>
</div>

<!-- Error -->
{#if errorMsg}
	<div class="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
		{errorMsg}
	</div>
{/if}

<!-- Step 1: Address Search -->
{#if step === 1}
	<div class="space-y-4">
		<h2 class="text-lg font-semibold text-gray-900">Find a Property</h2>
		<div class="flex items-end gap-4">
			<div>
				<label for="county-select" class="block text-sm font-medium text-gray-700 mb-1">County</label>
				<select
					id="county-select"
					bind:value={selectedCountyId}
					class="rounded-lg border border-gray-300 px-3 py-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
				>
					{#each countyList as c}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1">
				<AddressSearch {county} onselect={handleAddressSelect} />
			</div>
		</div>
		<p class="text-sm text-gray-600">
			Search for a property by address. Addresses are stored as uppercase (e.g., "308 PEARL ST").
		</p>
	</div>
{/if}

<!-- Step 2: Property Details -->
{#if step === 2}
	{#if loadingProperty}
		<div class="flex flex-col items-center gap-4 py-12">
			<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
			<p class="text-gray-500">Loading property data...</p>
		</div>
	{:else if property}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Confirm Property</h2>
			<PropertyCard {property} />
			<div class="flex gap-3">
				<button
					type="button"
					onclick={confirmProperty}
					class="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
				>
					This is the right property
				</button>
				<button
					type="button"
					onclick={startOver}
					class="rounded-lg border border-gray-300 bg-white px-6 py-2.5 font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
				>
					Search Again
				</button>
			</div>
		</div>
	{/if}
{/if}

<!-- Step 3: Investment Parameters -->
{#if step === 3}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">Investment Parameters</h2>
			<button
				type="button"
				onclick={() => (step = 2)}
				class="text-sm text-blue-600 hover:text-blue-700"
			>
				&larr; Back to Property
			</button>
		</div>
		{#if property}
			<p class="text-sm text-gray-600">
				Analyzing <strong>{property.address}</strong> — configure your investment strategy below.
			</p>
		{/if}
		<InvestmentForm onsubmit={handleAnalyze} loading={loadingAnalysis} />
	</div>
{/if}

<!-- Step 4: Analysis Results -->
{#if step === 4}
	{#if loadingAnalysis}
		<div class="flex flex-col items-center gap-4 py-12">
			<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
			<p class="text-gray-500">Finding comparables and building analysis prompt...</p>
			<p class="text-xs text-gray-400">This may take 10-20 seconds</p>
		</div>
	{:else if analysis}
		<div class="space-y-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-gray-900">Analysis Results</h2>
				<div class="flex gap-3">
					<button
						type="button"
						onclick={() => (step = 3)}
						class="text-sm text-blue-600 hover:text-blue-700"
					>
						&larr; Adjust Parameters
					</button>
					<button
						type="button"
						onclick={startOver}
						class="text-sm text-gray-500 hover:text-gray-700"
					>
						Start Over
					</button>
				</div>
			</div>

			<!-- Comp Cards -->
			<div>
				<h3 class="mb-3 font-semibold text-gray-900">Comparable Sales</h3>
				<CompList comps={analysis.comps} compStats={analysis.compStats} />
			</div>

			<!-- Generated Prompt -->
			<div>
				<h3 class="mb-3 font-semibold text-gray-900">Generated Analysis Prompt</h3>
				<p class="mb-3 text-sm text-gray-600">
					Copy this prompt into Claude or ChatGPT for a complete deal analysis.
				</p>
				<PromptOutput prompt={analysis.prompt} />
			</div>
		</div>
	{/if}
{/if}
