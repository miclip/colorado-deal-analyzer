<script lang="ts">
	import type { InvestmentParams, InvestmentStrategy } from '$lib/types';

	interface Props {
		onsubmit: (params: InvestmentParams) => void;
		loading?: boolean;
	}

	let { onsubmit, loading = false }: Props = $props();

	let strategy = $state<InvestmentStrategy>('flip');
	let rehabQuality = $state<'light' | 'standard' | 'high-end'>('standard');
	let monthlyRent = $state<number | undefined>(undefined);
	let downPaymentPct = $state(20);
	let interestRate = $state(7.0);
	let propertyMgmt = $state(false);
	let assignmentFee = $state(10000);
	let additionalContext = $state('');
	let compRadius = $state(0.5);

	function handleSubmit(e: Event) {
		e.preventDefault();
		const params: InvestmentParams = {
			strategy,
			compRadius
		};

		if (strategy === 'flip') {
			params.rehabQuality = rehabQuality;
		} else if (strategy === 'rental') {
			params.monthlyRent = monthlyRent;
			params.downPaymentPct = downPaymentPct;
			params.interestRate = interestRate;
			params.propertyMgmt = propertyMgmt;
		} else if (strategy === 'wholesale') {
			params.assignmentFee = assignmentFee;
		}

		if (additionalContext.trim()) {
			params.additionalContext = additionalContext.trim();
		}

		onsubmit(params);
	}
</script>

<form onsubmit={handleSubmit} class="space-y-6">
	<!-- Strategy -->
	<fieldset>
		<legend class="block text-sm font-medium text-gray-700 mb-2">Investment Strategy</legend>
		<div class="flex gap-3">
			{#each [
				{ value: 'flip', label: 'Flip' },
				{ value: 'rental', label: 'Rental' },
				{ value: 'wholesale', label: 'Wholesale' }
			] as opt}
				<label
					class="flex-1 cursor-pointer rounded-lg border-2 px-4 py-3 text-center transition-colors {strategy === opt.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}"
				>
					<input
						type="radio"
						name="strategy"
						value={opt.value}
						bind:group={strategy}
						class="sr-only"
					/>
					<span class="font-medium">{opt.label}</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<!-- Flip options -->
	{#if strategy === 'flip'}
		<fieldset>
			<legend class="block text-sm font-medium text-gray-700 mb-2">Rehab Quality</legend>
			<div class="flex gap-3">
				{#each [
					{ value: 'light', label: 'Light', desc: '$15-25/sqft' },
					{ value: 'standard', label: 'Standard', desc: '$30-50/sqft' },
					{ value: 'high-end', label: 'High-End', desc: '$60-100/sqft' }
				] as opt}
					<label
						class="flex-1 cursor-pointer rounded-lg border-2 px-3 py-2 text-center transition-colors {rehabQuality === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}"
					>
						<input
							type="radio"
							name="rehabQuality"
							value={opt.value}
							bind:group={rehabQuality}
							class="sr-only"
						/>
						<div class="text-sm font-medium">{opt.label}</div>
						<div class="text-xs text-gray-500">{opt.desc}</div>
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	<!-- Rental options -->
	{#if strategy === 'rental'}
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="monthlyRent" class="block text-sm font-medium text-gray-700 mb-1">
					Expected Monthly Rent
				</label>
				<input
					id="monthlyRent"
					type="number"
					bind:value={monthlyRent}
					placeholder="e.g. 2500"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
				/>
			</div>
			<div>
				<label for="downPayment" class="block text-sm font-medium text-gray-700 mb-1">
					Down Payment %
				</label>
				<input
					id="downPayment"
					type="number"
					bind:value={downPaymentPct}
					min="0"
					max="100"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
				/>
			</div>
			<div>
				<label for="interestRate" class="block text-sm font-medium text-gray-700 mb-1">
					Interest Rate %
				</label>
				<input
					id="interestRate"
					type="number"
					bind:value={interestRate}
					step="0.1"
					min="0"
					max="20"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
				/>
			</div>
			<div class="flex items-center pt-6">
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						bind:checked={propertyMgmt}
						class="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
					/>
					<span class="text-sm text-gray-700">Property Management (8-10%)</span>
				</label>
			</div>
		</div>
	{/if}

	<!-- Wholesale options -->
	{#if strategy === 'wholesale'}
		<div>
			<label for="assignmentFee" class="block text-sm font-medium text-gray-700 mb-1">
				Target Assignment Fee
			</label>
			<input
				id="assignmentFee"
				type="number"
				bind:value={assignmentFee}
				step="1000"
				class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none sm:w-1/2"
			/>
		</div>
	{/if}

	<!-- Comp Radius -->
	<div>
		<label for="compRadius" class="block text-sm font-medium text-gray-700 mb-1">
			Comp Search Radius
		</label>
		<select
			id="compRadius"
			bind:value={compRadius}
			class="rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
		>
			<option value={0.25}>0.25 miles</option>
			<option value={0.5}>0.5 miles</option>
			<option value={1}>1 mile</option>
			<option value={2}>2 miles</option>
		</select>
	</div>

	<!-- Additional Context -->
	<div>
		<label for="context" class="block text-sm font-medium text-gray-700 mb-1">
			Additional Context (optional)
		</label>
		<textarea
			id="context"
			bind:value={additionalContext}
			rows={3}
			placeholder="Any additional info for the analysis... (e.g. property needs new roof, neighborhood is gentrifying)"
			class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
		></textarea>
	</div>

	<button
		type="submit"
		disabled={loading}
		class="w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#if loading}
			<span class="inline-flex items-center gap-2">
				<span class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
				Finding Comps & Building Prompt...
			</span>
		{:else}
			Generate Analysis Prompt
		{/if}
	</button>
</form>
