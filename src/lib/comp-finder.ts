import type { CompProperty, PropertyData, AreaInfo } from '$lib/types';
import type { CountyDataSource } from '$lib/counties/types';
import { haversineDistance } from '$lib/utils';

/**
 * Find comparable properties near the subject property.
 *
 * Algorithm:
 * 1. Spatial query for nearby parcels
 * 2. Find recent sales among those parcels
 * 3. Fetch building attributes for candidates
 * 4. Score by similarity (sqft, beds, year, lot, distance) and return top 6
 * 5. Fetch full sales history + outbuilding areas for top comps
 */
export async function findComps(
	county: CountyDataSource,
	subject: PropertyData,
	radiusMiles: number
): Promise<CompProperty[]> {
	const nearbyAccountNos = (
		await county.findNearbyAccountNos(subject.lat, subject.lng, radiusMiles)
	).filter((a) => a !== subject.accountNo);

	if (nearbyAccountNos.length === 0) return [];

	const eighteenMonthsAgo = new Date();
	eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);

	const recentSales = await county.getRecentSales(nearbyAccountNos, eighteenMonthsAgo);

	const salesByAccount = new Map(recentSales.map((s) => [s.accountNo, s]));
	const candidateAccountNos = [...salesByAccount.keys()];
	if (candidateAccountNos.length === 0) return [];

	const [bldgByAccount, parcelByAccount] = await Promise.all([
		county.getBuildingInfoBatch(candidateAccountNos),
		county.getParcelInfoBatch(candidateAccountNos)
	]);

	const subjectBldg = subject.building;
	const subjectLot = subject.lotAcres;
	const comps: CompProperty[] = [];

	for (const accountNo of candidateAccountNos) {
		const sale = salesByAccount.get(accountNo)!;
		const bldg = bldgByAccount.get(accountNo) ?? null;
		const parcel = parcelByAccount.get(accountNo);
		if (!parcel) continue;

		const dist = haversineDistance(subject.lat, subject.lng, parcel.lat, parcel.lng);

		// Score components are each ~[0,1]; lower is better.
		const distScore = dist / radiusMiles;

		let sqftScore = 0;
		let bedScore = 0;
		let yearScore = 0;
		if (subjectBldg && bldg) {
			sqftScore =
				subjectBldg.sqft > 0 ? Math.abs(bldg.sqft - subjectBldg.sqft) / subjectBldg.sqft : 0;
			bedScore = Math.min(Math.abs(bldg.beds - (subjectBldg.beds || 0)) / 3, 1);
			yearScore =
				subjectBldg.yearBuilt > 0
					? Math.min(Math.abs(bldg.yearBuilt - subjectBldg.yearBuilt) / 50, 1)
					: 0;
		}

		// Lot score only when both have lot data (denominator floored to 0.25 acre to avoid
		// inflating differences on tiny urban lots).
		let lotScore = 0;
		if (subjectLot > 0 && parcel.lotAcres > 0) {
			lotScore = Math.min(
				Math.abs(parcel.lotAcres - subjectLot) / Math.max(subjectLot, 0.25),
				1
			);
		}

		// Weights: rural subjects emphasize lot size; urban subjects emphasize sqft.
		const isRural = subjectLot >= 0.5;
		const weights = isRural
			? { sqft: 0.2, bed: 0.1, year: 0.1, lot: 0.3, dist: 0.3 }
			: { sqft: 0.3, bed: 0.15, year: 0.1, lot: 0.15, dist: 0.3 };

		const score =
			sqftScore * weights.sqft +
			bedScore * weights.bed +
			yearScore * weights.year +
			lotScore * weights.lot +
			distScore * weights.dist;

		comps.push({
			accountNo,
			address: parcel.address,
			city: parcel.city,
			distance: Math.round(dist * 100) / 100,
			lotAcres: parcel.lotAcres,
			building: bldg,
			areas: [],
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

	comps.sort((a, b) => a.score - b.score);
	const topComps = comps.slice(0, 6);

	// Fetch full sales history (for flip detection) + outbuilding areas (when county supports it
	// and the subject is rural / has outbuildings).
	const wantsAreas =
		typeof county.getBuildingAreasBatch === 'function' &&
		(subject.lotAcres >= 0.5 || subject.areas.length > 0);

	const [historyResults, areasMap] = await Promise.all([
		Promise.all(
			topComps.map(async (comp) => {
				try {
					return await county.getSalesHistory(comp.accountNo);
				} catch {
					return null;
				}
			})
		),
		wantsAreas
			? county.getBuildingAreasBatch!(topComps.map((c) => c.accountNo))
			: Promise.resolve(new Map<string, AreaInfo[]>())
	]);

	for (let i = 0; i < topComps.length; i++) {
		const comp = topComps[i];
		const history = historyResults[i];
		if (history && history.length > 0) {
			// Drop $0 / non-market transfers (estate, survivorship, correction deeds) so they
			// don't pollute the prompt or trigger false-positive flip flags.
			const filtered = history.filter((s) => s.price >= 50000);
			if (filtered.length > 0) comp.sales = filtered;
		}
		comp.areas = areasMap.get(comp.accountNo) ?? [];
	}

	return topComps;
}
