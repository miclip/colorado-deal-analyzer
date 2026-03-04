import type { CompProperty, PropertyData } from '$lib/types';
import type { CountyDataSource } from '$lib/counties/types';
import { haversineDistance } from '$lib/utils';

/**
 * Find comparable properties near the subject property.
 *
 * Algorithm:
 * 1. Spatial query for nearby parcels
 * 2. Find recent sales among those parcels
 * 3. Fetch building attributes for candidates
 * 4. Score by similarity and return top 6
 */
export async function findComps(
	county: CountyDataSource,
	subject: PropertyData,
	radiusMiles: number
): Promise<CompProperty[]> {
	// 1. Find nearby parcels
	const nearbyAccountNos = (
		await county.findNearbyAccountNos(subject.lat, subject.lng, radiusMiles)
	).filter((a) => a !== subject.accountNo);

	if (nearbyAccountNos.length === 0) return [];

	// 2. Get recent sales (last 18 months, > $50k)
	const eighteenMonthsAgo = new Date();
	eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);

	const recentSales = await county.getRecentSales(nearbyAccountNos, eighteenMonthsAgo);

	const salesByAccount = new Map(recentSales.map((s) => [s.accountNo, s]));
	const candidateAccountNos = [...salesByAccount.keys()];
	if (candidateAccountNos.length === 0) return [];

	// 3. Fetch building attributes and parcel info for candidates
	const [bldgByAccount, parcelByAccount] = await Promise.all([
		county.getBuildingInfoBatch(candidateAccountNos),
		county.getParcelInfoBatch(candidateAccountNos)
	]);

	// 4. Score and rank
	const subjectBldg = subject.building;
	const comps: CompProperty[] = [];

	for (const accountNo of candidateAccountNos) {
		const sale = salesByAccount.get(accountNo)!;
		const bldg = bldgByAccount.get(accountNo) ?? null;
		const parcel = parcelByAccount.get(accountNo);
		if (!parcel) continue;

		const dist = haversineDistance(subject.lat, subject.lng, parcel.lat, parcel.lng);

		// Score: lower is better
		let score = 0;
		if (subjectBldg && bldg) {
			const sqftDiff =
				subjectBldg.sqft > 0 ? Math.abs(bldg.sqft - subjectBldg.sqft) / subjectBldg.sqft : 0;
			const bedDiff = Math.abs(bldg.beds - (subjectBldg.beds || 0));
			const yearDiff =
				subjectBldg.yearBuilt > 0
					? Math.abs(bldg.yearBuilt - subjectBldg.yearBuilt) / 50
					: 0;
			const distScore = dist / radiusMiles;

			score = sqftDiff * 0.3 + bedDiff * 0.05 * 0.2 + yearDiff * 0.15 + distScore * 0.35;
		} else {
			score = dist / radiusMiles;
		}

		comps.push({
			accountNo,
			address: parcel.address,
			city: parcel.city,
			distance: Math.round(dist * 100) / 100,
			building: bldg,
			sales: [
				{
					date: sale.date,
					price: sale.price,
					deedType: sale.deedType,
					receptionNo: ''
				}
			],
			score
		});
	}

	// Sort by score ascending, take top 6
	comps.sort((a, b) => a.score - b.score);
	const topComps = comps.slice(0, 6);

	// 5. Fetch full sales history for top comps (for flip detection)
	await Promise.all(
		topComps.map(async (comp) => {
			try {
				comp.sales = await county.getSalesHistory(comp.accountNo);
			} catch {
				// Keep the single sale we already have
			}
		})
	);

	return topComps;
}
