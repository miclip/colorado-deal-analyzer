import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate } from '$lib/utils';

const BASE = 'https://gis.arapahoegov.com/arcgis/rest/services';
const SVC = {
	parcels: 'CustomCAMA_WM/MapServer/23',
	sales: 'CustomCAMA_WM/MapServer/45'
};
const GEOCODER = `${BASE}/AddressLocator/GeocodeServer`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

/**
 * Use the Arapahoe geocoder suggest endpoint to find address candidates.
 * Returns suggestions with magicKeys for resolution.
 */
async function geocoderSuggest(
	text: string
): Promise<{ text: string; magicKey: string }[]> {
	const url = `${GEOCODER}/suggest?text=${encodeURIComponent(text)}&f=json&maxSuggestions=8`;
	const res = await fetch(url);
	const data = await res.json();
	return data.suggestions ?? [];
}

/**
 * Resolve a geocoder suggestion to coordinates using its magicKey.
 */
async function geocoderResolve(
	text: string,
	magicKey: string
): Promise<{ lat: number; lng: number } | null> {
	const url = `${GEOCODER}/findAddressCandidates?SingleLine=${encodeURIComponent(text)}&magicKey=${encodeURIComponent(magicKey)}&f=json&maxLocations=1&outSR=4326`;
	const res = await fetch(url);
	const data = await res.json();
	const candidate = data.candidates?.[0];
	if (!candidate) return null;
	return { lat: candidate.location.y, lng: candidate.location.x };
}

/**
 * Find the parcel at a given point using a spatial query on Layer 23.
 */
async function findParcelAtPoint(
	lat: number,
	lng: number
): Promise<{ parcelId: string; address: string; city: string } | null> {
	const res = await q(SVC.parcels, {
		where: '1=1',
		geometry: `${lng},${lat}`,
		geometryType: 'esriGeometryPoint',
		inSR: '4326',
		spatialRel: 'esriSpatialRelIntersects',
		outFields: 'PARCEL_ID,NBHD_Code',
		returnGeometry: 'false',
		resultRecordCount: '1'
	});
	const f = res.features?.[0];
	if (!f) return null;
	return {
		parcelId: f.attributes.PARCEL_ID,
		address: '', // address comes from geocoder
		city: ''
	};
}

export const arapahoe: CountyDataSource = {
	id: 'arapahoe',
	name: 'Arapahoe County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const suggestions = await geocoderSuggest(term);
		if (suggestions.length === 0) return [];

		// Resolve each suggestion in parallel: geocode → spatial query
		const results = await Promise.all(
			suggestions.map(async (sug) => {
				try {
					const coords = await geocoderResolve(sug.text, sug.magicKey);
					if (!coords) return null;
					const parcel = await findParcelAtPoint(coords.lat, coords.lng);
					if (!parcel) return null;
					// Extract city from suggestion text (e.g. "6000 S GUN CLUB RD, AURORA, 80016")
					const parts = sug.text.split(',').map((s) => s.trim());
					const city = parts[1] ?? '';
					return {
						accountNo: parcel.parcelId,
						address: parts[0] ?? sug.text,
						city,
						neighborhood: ''
					};
				} catch {
					return null;
				}
			})
		);

		// Deduplicate by PARCEL_ID
		const seen = new Set<string>();
		return results.filter((r): r is SearchResult => {
			if (!r || seen.has(r.accountNo)) return false;
			seen.add(r.accountNo);
			return true;
		});
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [parcelRes, salesRes] = await Promise.all([
			q(SVC.parcels, {
				where: `PARCEL_ID = '${accountNo}'`,
				outFields:
					'PARCEL_ID,Strap,Yr_Built,Heated_Area,Bld_Style,Quality,Market_Val,Land_Val,INSIDE_X,INSIDE_Y,NBHD_Code,Basement,Basement_Fin,Att_Garage',
				returnGeometry: 'false'
			}),
			q(SVC.sales, {
				where: `PARCEL_ID = '${accountNo}'`,
				outFields: 'price,qu_flg,saledate',
				returnGeometry: 'false'
			})
		]);

		const parcel = parcelRes.features[0];
		if (!parcel) throw new Error(`Property not found: ${accountNo}`);
		const a = parcel.attributes;

		const lat = a.INSIDE_Y ?? 0;
		const lng = a.INSIDE_X ?? 0;

		return {
			accountNo,
			address: '', // will be populated from search result
			city: '',
			neighborhood: `NBHD ${a.NBHD_Code ?? ''}`.trim(),
			lat,
			lng,
			lotAcres: 0,
			ownerName: '',
			building: a.Heated_Area
				? {
						beds: 0, // not available
						fullBaths: 0, // not available
						halfBaths: 0,
						threeQtrBaths: 0,
						sqft: a.Heated_Area ?? 0,
						yearBuilt: a.Yr_Built ?? 0,
						design: (a.Bld_Style ?? '').trim(),
						classDescription: (a.Quality ?? '').trim()
					}
				: null,
			areas: a.Basement
				? [
						{ description: 'Main Living', sqft: a.Heated_Area ?? 0 },
						{ description: 'Basement', sqft: a.Basement ?? 0 },
						...(a.Basement_Fin
							? [{ description: 'Basement Finished', sqft: a.Basement_Fin }]
							: []),
						...(a.Att_Garage
							? [{ description: 'Attached Garage', sqft: a.Att_Garage }]
							: [])
					]
				: [],
			sales: salesRes.features
				.map((f: any) => ({
					date: f.attributes.saledate ? unixMsToDate(f.attributes.saledate) : '',
					price: f.attributes.price ?? 0,
					deedType: f.attributes.qu_flg === 'Q' ? 'Qualified' : 'Unqualified',
					receptionNo: ''
				}))
				.filter((s: SaleRecord) => s.date)
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values: a.Market_Val
				? {
						totalActual: a.Market_Val ?? 0,
						totalAssessed: 0,
						landActual: a.Land_Val ?? 0,
						improvementActual: (a.Market_Val ?? 0) - (a.Land_Val ?? 0),
						assessmentYear: 0
					}
				: null
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q(SVC.parcels, {
			where: '1=1',
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '2000',
			outFields: 'PARCEL_ID',
			returnGeometry: 'false'
		});
		return res.features
			.map((f: any) => f.attributes.PARCEL_ID)
			.filter((id: string) => id && !id.endsWith('-COM'));
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.sales, {
					where: `PARCEL_ID IN (${inClause}) AND saledate > date '${dateStr}' AND price > 50000`,
					outFields: 'PARCEL_ID,price,qu_flg,saledate',
					returnGeometry: 'false',
					resultRecordCount: '2000'
				});
			})
		);

		const byAccount = new Map<
			string,
			{ accountNo: string; price: number; date: string; deedType: string }
		>();
		for (const res of results) {
			for (const f of res.features) {
				const accountNo = f.attributes.PARCEL_ID;
				const price = f.attributes.price ?? 0;
				const deedType = f.attributes.qu_flg === 'Q' ? 'Qualified' : 'Unqualified';
				const d = f.attributes.saledate ? unixMsToDate(f.attributes.saledate) : '';
				const existing = byAccount.get(accountNo);
				if (!existing || d > existing.date) {
					byAccount.set(accountNo, { accountNo, price, date: d, deedType });
				}
			}
		}
		return [...byAccount.values()];
	},

	async getBuildingInfoBatch(accountNos) {
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.parcels, {
					where: `PARCEL_ID IN (${inClause})`,
					outFields: 'PARCEL_ID,Heated_Area,Yr_Built,Bld_Style,Quality',
					returnGeometry: 'false'
				});
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				if (a.Heated_Area) {
					map.set(a.PARCEL_ID, {
						beds: 0, // not available
						fullBaths: 0, // not available
						halfBaths: 0,
						threeQtrBaths: 0,
						sqft: a.Heated_Area ?? 0,
						yearBuilt: a.Yr_Built ?? 0,
						design: (a.Bld_Style ?? '').trim(),
						classDescription: (a.Quality ?? '').trim()
					});
				}
			}
		}
		return map;
	},

	async getParcelInfoBatch(accountNos) {
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.parcels, {
					where: `PARCEL_ID IN (${inClause})`,
					outFields: 'PARCEL_ID,INSIDE_X,INSIDE_Y',
					returnGeometry: 'false'
				});
			})
		);

		const map = new Map<
			string,
			{ address: string; city: string; lat: number; lng: number; lotAcres: number }
		>();
		for (const res of results) {
			for (const f of res.features) {
				map.set(f.attributes.PARCEL_ID, {
					address: '',
					city: '',
					lat: f.attributes.INSIDE_Y ?? 0,
					lng: f.attributes.INSIDE_X ?? 0,
					lotAcres: 0
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, {
			where: `PARCEL_ID = '${accountNo}'`,
			outFields: 'price,qu_flg,saledate',
			returnGeometry: 'false'
		});
		return res.features
			.map((f: any) => ({
				date: f.attributes.saledate ? unixMsToDate(f.attributes.saledate) : '',
				price: f.attributes.price ?? 0,
				deedType: f.attributes.qu_flg === 'Q' ? 'Qualified' : 'Unqualified',
				receptionNo: ''
			}))
			.filter((s: SaleRecord) => s.date)
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
