import type { CompProperty, PropertyData, BuildingInfo } from '$lib/types';
import {
	findParcelsNearby,
	getSalesBatch,
	getBuildingAttributesBatch,
	getParcelPropertyBatch,
	getSales
} from './arcgis';
import { chunk, haversineDistance, unixMsToDate } from '$lib/utils';

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
	subject: PropertyData,
	radiusMiles: number
): Promise<CompProperty[]> {
	// 1. Find nearby parcels
	const parcelsRes = await findParcelsNearby(subject.lat, subject.lng, radiusMiles);
	const nearbyAccountNos = parcelsRes.features
		.map((f) => f.attributes.AccountNo)
		.filter((a) => a && a !== subject.accountNo);

	if (nearbyAccountNos.length === 0) return [];

	// 2. Get recent sales (last 18 months, > $50k)
	const eighteenMonthsAgo = new Date();
	eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);

	// Batch into groups of 200 for IN-clause limits
	const batches = chunk(nearbyAccountNos, 100);
	const salesResults = await Promise.all(
		batches.map((batch) => getSalesBatch(batch, eighteenMonthsAgo))
	);

	// Combine all sales and deduplicate by account (keep most recent sale)
	const salesByAccount = new Map<string, { price: number; date: string; deedType: string }>();
	for (const res of salesResults) {
		for (const f of res.features) {
			const { AccountNo, SalePrice, SaleDate, DeedType } = f.attributes;
			// Filter out quit claim deeds with $0 price
			if (DeedType === 'QD' && SalePrice === 0) continue;
			const dateStr = unixMsToDate(SaleDate);
			const existing = salesByAccount.get(AccountNo);
			if (!existing || dateStr > existing.date) {
				salesByAccount.set(AccountNo, {
					price: SalePrice,
					date: dateStr,
					deedType: DeedType ?? ''
				});
			}
		}
	}

	const candidateAccountNos = [...salesByAccount.keys()];
	if (candidateAccountNos.length === 0) return [];

	// 3. Fetch building attributes for candidates
	const bldgBatches = chunk(candidateAccountNos, 100);
	const bldgResults = await Promise.all(
		bldgBatches.map((batch) => getBuildingAttributesBatch(batch))
	);

	// Keep only primary building (BuildingNumber=1) per account
	const bldgByAccount = new Map<string, BuildingInfo>();
	for (const res of bldgResults) {
		for (const f of res.features) {
			const existing = bldgByAccount.get(f.attributes.AccountNo);
			if (!existing || f.attributes.BuildingNumber === 1) {
				bldgByAccount.set(f.attributes.AccountNo, {
					beds: f.attributes.Bedrooms ?? 0,
					fullBaths: f.attributes.FullBaths ?? 0,
					halfBaths: f.attributes.HalfBaths ?? 0,
					threeQtrBaths: f.attributes.ThreeQtrBaths ?? 0,
					sqft: f.attributes.FinishedSqft ?? 0,
					yearBuilt: f.attributes.YearBuilt ?? 0,
					design: f.attributes.DesignDscr ?? '',
					classDescription: f.attributes.ClassCodeDscr ?? ''
				});
			}
		}
	}

	// 4. Fetch parcel data for addresses + lat/lng
	const parcelBatches = chunk(candidateAccountNos, 100);
	const parcelResults = await Promise.all(
		parcelBatches.map((batch) => getParcelPropertyBatch(batch))
	);

	const parcelByAccount = new Map<
		string,
		{ address: string; city: string; lat: number; lng: number }
	>();
	for (const res of parcelResults) {
		for (const f of res.features) {
			parcelByAccount.set(f.attributes.AccountNo, {
				address: f.attributes.PropertyAddress ?? '',
				city: f.attributes.city ?? '',
				lat: parseFloat(f.attributes.Latitude) || 0,
				lng: parseFloat(f.attributes.Longitude) || 0
			});
		}
	}

	// 5. Score and rank
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
			const sqftDiff = subjectBldg.sqft > 0 ? Math.abs(bldg.sqft - subjectBldg.sqft) / subjectBldg.sqft : 0;
			const bedDiff = Math.abs(bldg.beds - (subjectBldg.beds || 0));
			const yearDiff =
				subjectBldg.yearBuilt > 0 ? Math.abs(bldg.yearBuilt - subjectBldg.yearBuilt) / 50 : 0;
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

	// 6. Fetch full sales history for top comps (for flip detection)
	await Promise.all(
		topComps.map(async (comp) => {
			try {
				const salesRes = await getSales(comp.accountNo);
				comp.sales = salesRes.features
					.map((f) => ({
						date: f.attributes.SaleDate ? unixMsToDate(f.attributes.SaleDate) : '',
						price: f.attributes.SalePrice ?? 0,
						deedType: f.attributes.DeedType ?? '',
						receptionNo: f.attributes.DeedReceptionNo ?? ''
					}))
					.sort((a, b) => b.date.localeCompare(a.date));
			} catch {
				// Keep the single sale we already have
			}
		})
	);

	return topComps;
}
