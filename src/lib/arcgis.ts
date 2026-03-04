import type { ArcGISResponse } from '$lib/types';

/**
 * Generic ArcGIS REST query using POST to avoid URL length limits.
 */
export async function queryArcGIS<T>(
	baseUrl: string,
	service: string,
	params: Record<string, string>
): Promise<ArcGISResponse<T>> {
	const url = `${baseUrl}/${service}/query`;

	const body = new URLSearchParams();
	body.set('f', 'json');
	if (!params.outFields) {
		body.set('outFields', '*');
	}
	for (const [key, value] of Object.entries(params)) {
		body.set(key, value);
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	if (!response.ok) {
		throw new Error(`ArcGIS query failed: ${response.status} ${response.statusText}`);
	}
	const data = await response.json();
	if (data.error) {
		throw new Error(
			`ArcGIS error: ${data.error.message} (${data.error.details?.join(', ') ?? ''})`
		);
	}
	return data as ArcGISResponse<T>;
}
