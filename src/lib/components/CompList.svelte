<script lang="ts">
	import type { CompProperty } from '$lib/types';
	import { formatCurrency, formatNumber } from '$lib/utils';

	interface Props {
		comps: CompProperty[];
		compStats: {
			medianPrice: number;
			avgPricePerSqft: number;
			count: number;
		};
	}

	let { comps, compStats }: Props = $props();
</script>

{#if comps.length === 0}
	<p class="text-gray-500 italic">No comparable sales found within the search radius.</p>
{:else}
	<!-- Stats Summary -->
	<div class="mb-4 grid grid-cols-3 gap-4 rounded-lg bg-gray-50 p-4">
		<div class="text-center">
			<div class="text-2xl font-bold text-gray-900">{compStats.count}</div>
			<div class="text-xs text-gray-500">Comps Found</div>
		</div>
		<div class="text-center">
			<div class="text-2xl font-bold text-gray-900">{formatCurrency(compStats.medianPrice)}</div>
			<div class="text-xs text-gray-500">Median Price</div>
		</div>
		<div class="text-center">
			<div class="text-2xl font-bold text-gray-900">
				{compStats.avgPricePerSqft > 0 ? formatCurrency(compStats.avgPricePerSqft) : '—'}
			</div>
			<div class="text-xs text-gray-500">Avg $/Sqft</div>
		</div>
	</div>

	<!-- Comp Cards -->
	<div class="space-y-3">
		{#each comps as comp, i}
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="flex items-start justify-between">
					<div>
						<span class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
							{i + 1}
						</span>
						<span class="font-medium text-gray-900">{comp.address}</span>
						<span class="text-sm text-gray-500">, {comp.city}</span>
					</div>
					<span class="text-sm text-gray-500">{comp.distance} mi</span>
				</div>

				<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					{#if comp.sales.length > 0 && comp.sales[0].price > 0}
						<span class="font-semibold text-green-700">{formatCurrency(comp.sales[0].price)}</span>
						<span class="text-gray-500">{comp.sales[0].date}</span>
					{/if}
					{#if comp.building}
						<span>{comp.building.beds}bd/{comp.building.fullBaths + comp.building.threeQtrBaths + comp.building.halfBaths}ba</span>
						<span>{formatNumber(comp.building.sqft)} sqft</span>
						<span>Built {comp.building.yearBuilt}</span>
						{#if comp.building.sqft > 0 && comp.sales[0]?.price > 0}
							<span class="text-gray-500">
								{formatCurrency(Math.round(comp.sales[0].price / comp.building.sqft))}/sqft
							</span>
						{/if}
					{/if}
				</div>

				{#if comp.sales.length >= 2}
					{@const recent = new Date(comp.sales[0].date)}
					{@const prior = new Date(comp.sales[1].date)}
					{@const monthsBetween = (recent.getTime() - prior.getTime()) / (1000 * 60 * 60 * 24 * 30)}
					{#if monthsBetween <= 12 && comp.sales[0].price > comp.sales[1].price}
						<div class="mt-2 rounded bg-amber-50 px-3 py-1 text-xs text-amber-700">
							Potential flip — resold within {Math.round(monthsBetween)} months
							({formatCurrency(comp.sales[1].price)} &rarr; {formatCurrency(comp.sales[0].price)})
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}
