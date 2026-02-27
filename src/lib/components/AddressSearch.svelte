<script lang="ts">
	import type { SearchResult } from '$lib/types';
	import { searchByAddress } from '$lib/arcgis';
	import { normalizeAddress } from '$lib/utils';

	interface Props {
		onselect: (result: SearchResult) => void;
	}

	let { onselect }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let showDropdown = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	function handleInput() {
		clearTimeout(debounceTimer);
		if (query.length < 3) {
			results = [];
			showDropdown = false;
			return;
		}
		loading = true;
		debounceTimer = setTimeout(async () => {
			try {
				const term = normalizeAddress(query);
				const res = await searchByAddress(term);
				results = res.features.map((f) => ({
					accountNo: f.attributes.AccountNo,
					address: f.attributes.PropertyAddress,
					city: f.attributes.city ?? '',
					neighborhood: f.attributes.NbhdDscr ?? String(f.attributes.NbhdCode ?? '')
				}));
				showDropdown = results.length > 0;
			} catch {
				results = [];
			} finally {
				loading = false;
			}
		}, 300);
	}

	function select(result: SearchResult) {
		query = result.address;
		showDropdown = false;
		results = [];
		onselect(result);
	}
</script>

<div class="relative">
	<label for="address-search" class="block text-sm font-medium text-gray-700 mb-1">
		Property Address
	</label>
	<div class="relative">
		<input
			id="address-search"
			type="text"
			bind:value={query}
			oninput={handleInput}
			onfocus={() => results.length > 0 && (showDropdown = true)}
			placeholder="Start typing an address... (e.g. 308 PEARL ST)"
			class="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
		/>
		{#if loading}
			<div class="absolute right-3 top-1/2 -translate-y-1/2">
				<div class="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500"></div>
			</div>
		{/if}
	</div>

	{#if showDropdown}
		<ul class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
			{#each results as result}
				<li>
					<button
						type="button"
						class="w-full cursor-pointer px-4 py-3 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
						onclick={() => select(result)}
					>
						<div class="font-medium text-gray-900">{result.address}</div>
						<div class="text-sm text-gray-500">
							{result.city}{result.neighborhood ? ` · Nbhd ${result.neighborhood}` : ''}
							· Acct {result.accountNo}
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
