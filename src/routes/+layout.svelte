<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen bg-gray-50">
	<header class="border-b border-gray-200 bg-white">
		<div class="mx-auto max-w-4xl px-4 py-4">
			<h1 class="text-xl font-bold text-gray-900">Boulder Property Deal Analyzer</h1>
			<p class="text-sm text-gray-500">Fetch property data & generate AI analysis prompts</p>
		</div>
	</header>

	<main class="mx-auto max-w-4xl px-4 py-8">
		{@render children()}
	</main>
</div>
