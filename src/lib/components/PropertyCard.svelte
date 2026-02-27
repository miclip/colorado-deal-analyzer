<script lang="ts">
	import type { PropertyData } from '$lib/types';
	import { formatCurrency, formatNumber } from '$lib/utils';

	interface Props {
		property: PropertyData;
	}

	let { property }: Props = $props();

	function bathSummary(b: PropertyData['building']) {
		if (!b) return '';
		const parts: string[] = [];
		if (b.fullBaths) parts.push(`${b.fullBaths}F`);
		if (b.threeQtrBaths) parts.push(`${b.threeQtrBaths}¾`);
		if (b.halfBaths) parts.push(`${b.halfBaths}H`);
		return parts.join(' + ') || '0';
	}
</script>

<div class="rounded-lg border border-gray-200 bg-white shadow-sm">
	<div class="border-b border-gray-100 px-6 py-4">
		<h3 class="text-lg font-semibold text-gray-900">{property.address}</h3>
		<p class="text-sm text-gray-500">
			{property.city} · Neighborhood {property.neighborhood} · Account {property.accountNo}
		</p>
	</div>

	<div class="grid gap-6 p-6 md:grid-cols-2">
		<!-- Building Details -->
		{#if property.building}
			<div>
				<h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Building</h4>
				<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
					<dt class="text-gray-500">Beds</dt>
					<dd class="font-medium">{property.building.beds}</dd>
					<dt class="text-gray-500">Baths</dt>
					<dd class="font-medium">{bathSummary(property.building)}</dd>
					<dt class="text-gray-500">Finished Sqft</dt>
					<dd class="font-medium">{formatNumber(property.building.sqft)}</dd>
					<dt class="text-gray-500">Year Built</dt>
					<dd class="font-medium">{property.building.yearBuilt}</dd>
					<dt class="text-gray-500">Design</dt>
					<dd class="font-medium">{property.building.design || '—'}</dd>
					<dt class="text-gray-500">Class</dt>
					<dd class="font-medium">{property.building.classDescription || '—'}</dd>
					<dt class="text-gray-500">Lot</dt>
					<dd class="font-medium">{property.lotAcres} acres</dd>
				</dl>
			</div>
		{/if}

		<!-- Area Breakdown -->
		{#if property.areas.length > 0}
			<div>
				<h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Area Breakdown</h4>
				<ul class="space-y-1 text-sm">
					{#each property.areas as area}
						<li class="flex justify-between">
							<span class="text-gray-600">{area.description}</span>
							<span class="font-medium">{formatNumber(area.sqft)} sqft</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Values -->
		{#if property.values}
			<div>
				<h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
					Assessed Values ({property.values.assessmentYear})
				</h4>
				<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
					<dt class="text-gray-500">Total Actual</dt>
					<dd class="font-medium">{formatCurrency(property.values.totalActual)}</dd>
					<dt class="text-gray-500">Land</dt>
					<dd class="font-medium">{formatCurrency(property.values.landActual)}</dd>
					<dt class="text-gray-500">Improvements</dt>
					<dd class="font-medium">{formatCurrency(property.values.improvementActual)}</dd>
					<dt class="text-gray-500">Total Assessed</dt>
					<dd class="font-medium">{formatCurrency(property.values.totalAssessed)}</dd>
				</dl>
			</div>
		{/if}

		<!-- Sales History -->
		{#if property.sales.length > 0}
			<div>
				<h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Sale History</h4>
				<ul class="space-y-2 text-sm">
					{#each property.sales as sale}
						<li class="rounded bg-gray-50 px-3 py-2">
							<div class="flex justify-between">
								<span class="font-medium">{formatCurrency(sale.price)}</span>
								<span class="text-gray-500">{sale.date}</span>
							</div>
							<div class="text-xs text-gray-500">{sale.deedType}</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</div>
