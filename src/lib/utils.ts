/**
 * Calculate distance between two lat/lng points using Haversine formula.
 * Returns distance in miles.
 */
export function haversineDistance(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const R = 3958.8; // Earth's radius in miles
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

function toRad(deg: number): number {
	return deg * (Math.PI / 180);
}

/**
 * Format a number as USD currency.
 */
export function formatCurrency(value: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	}).format(value);
}

/**
 * Format a number with commas.
 */
export function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Convert Unix milliseconds to ISO date string (YYYY-MM-DD).
 */
export function unixMsToDate(ms: number): string {
	return new Date(ms).toISOString().split('T')[0];
}

/**
 * Normalize an address for search - uppercase, trim extra whitespace.
 */
export function normalizeAddress(address: string): string {
	return address.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Calculate median of a number array.
 */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute the area of a WGS84 polygon (ArcGIS rings format) in acres.
 * Uses an equirectangular projection scaled at the polygon's latitude — accurate
 * to <0.5% for typical parcel-sized shapes. Handles holes by subtracting inner rings.
 */
export function ringsToAcres(rings: number[][][], lat: number): number {
	if (!rings || rings.length === 0) return 0;
	const latRad = lat * (Math.PI / 180);
	const mPerDegLat = 111132.92;
	const mPerDegLng = 111319.49 * Math.cos(latRad);
	let totalM2 = 0;
	for (let r = 0; r < rings.length; r++) {
		const ring = rings[r];
		if (ring.length < 3) continue;
		let signed = 0;
		for (let i = 0; i < ring.length; i++) {
			const [x1, y1] = ring[i];
			const [x2, y2] = ring[(i + 1) % ring.length];
			signed += x1 * mPerDegLng * (y2 * mPerDegLat) - x2 * mPerDegLng * (y1 * mPerDegLat);
		}
		// First ring = outer (positive), subsequent rings = holes (subtract)
		totalM2 += r === 0 ? Math.abs(signed) / 2 : -Math.abs(signed) / 2;
	}
	return Math.max(totalM2, 0) / 4046.8564224;
}

/**
 * Split an array into chunks of the given size.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}
