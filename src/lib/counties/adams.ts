import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services';
const SVC = {
	parcels: 'Parcels/FeatureServer/0',
	improvements: 'Property_Improvements/FeatureServer/0',
	sales: 'Property_Sales/FeatureServer/0',
	values: 'Property_Values/FeatureServer/0'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

/**
 * Adams County stores baths as a decimal (e.g. 2.5 = 2 full + 1 half).
 * Split into full and half bath counts.
 */
function splitBaths(baths: number): { full: number; half: number } {
	const full = Math.floor(baths);
	const half = baths % 1 >= 0.25 ? 1 : 0;
	return { full, half };
}

/**
 * Compute centroid from polygon rings (WGS84).
 */
function polygonCentroid(rings: number[][][]): { lat: number; lng: number } {
	const ring = rings[0];
	if (!ring || ring.length === 0) return { lat: 0, lng: 0 };
	let sumX = 0,
		sumY = 0;
	for (const [x, y] of ring) {
		sumX += x;
		sumY += y;
	}
	return { lng: sumX / ring.length, lat: sumY / ring.length };
}

export const adams: CountyDataSource = {
	id: 'adams',
	name: 'Adams County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q(SVC.parcels, {
			where: `concataddr1 LIKE '%${escaped}%' AND concataddr1 <> ''`,
			resultRecordCount: '15',
			outFields: 'PARCELNB,concataddr1,loccity,ownername1',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.PARCELNB,
			address: (f.attributes.concataddr1 ?? '').trim(),
			city: (f.attributes.loccity ?? '').trim(),
			neighborhood: ''
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [parcelRes, bldgRes, salesRes, valuesRes] = await Promise.all([
			q(SVC.parcels, {
				where: `PARCELNB = '${accountNo}'`,
				outSR: '4326'
			}),
			q(SVC.improvements, {
				where: `parcelnb = '${accountNo}' AND proptype = 'Residential'`,
				returnGeometry: 'false'
			}),
			q(SVC.sales, {
				where: `parcelnb = '${accountNo}'`,
				returnGeometry: 'false'
			}),
			q(SVC.values, {
				where: `parcelnb = '${accountNo}'`,
				returnGeometry: 'false'
			})
		]);

		const parcel = parcelRes.features[0];
		if (!parcel) throw new Error(`Property not found: ${accountNo}`);
		const a = parcel.attributes;

		// Get lat/lng from polygon centroid
		let lat = 0,
			lng = 0;
		if (parcel.geometry?.rings) {
			const center = polygonCentroid(parcel.geometry.rings);
			lat = center.lat;
			lng = center.lng;
		}

		// Primary building (bldgid = '1.00')
		const bldg =
			bldgRes.features.find((f: any) => parseFloat(f.attributes.bldgid) === 1)?.attributes ??
			bldgRes.features[0]?.attributes;

		const val = valuesRes.features[0]?.attributes;

		const bathInfo = bldg ? splitBaths(bldg.baths ?? 0) : { full: 0, half: 0 };

		return {
			accountNo,
			address: (a.concataddr1 ?? '').trim(),
			city: (a.loccity ?? '').trim(),
			neighborhood: val?.schoolname ?? '',
			lat,
			lng,
			lotAcres: val?.lotmeasure === 'Acres' ? val?.lotsize ?? 0 : 0,
			ownerName: (a.ownername1 ?? '').trim(),
			building: bldg
				? {
						beds: bldg.bedrooms ?? 0,
						fullBaths: bathInfo.full,
						halfBaths: bathInfo.half,
						threeQtrBaths: 0,
						sqft: bldg.sf ?? 0,
						yearBuilt: bldg.yrblt ?? 0,
						design: bldg.bltasdesc ?? '',
						classDescription: bldg.proptype ?? ''
					}
				: null,
			areas: [],
			sales: salesRes.features
				.map((f: any) => ({
					date: f.attributes.saledt ? unixMsToDate(f.attributes.saledt) : '',
					price: f.attributes.salesp ?? 0,
					deedType: f.attributes.deedtype ?? '',
					receptionNo: f.attributes.recptno ?? ''
				}))
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values: val
				? {
						totalActual: val.acttotalval ?? 0,
						totalAssessed: val.asdtotalval ?? 0,
						landActual: val.actlandval ?? 0,
						improvementActual: val.actimpsval ?? 0,
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
			outFields: 'PARCELNB',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => f.attributes.PARCELNB).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.sales, {
					where: `parcelnb IN (${inClause}) AND saledt > date '${dateStr}' AND salesp > 50000`,
					returnGeometry: 'false',
					resultRecordCount: '1000'
				});
			})
		);

		const byAccount = new Map<
			string,
			{ accountNo: string; price: number; date: string; deedType: string }
		>();
		for (const res of results) {
			for (const f of res.features) {
				const accountNo = f.attributes.parcelnb;
				const price = f.attributes.salesp ?? 0;
				const deedType = f.attributes.deedtype ?? '';
				if (deedType === 'QC' && price === 0) continue;
				const d = f.attributes.saledt ? unixMsToDate(f.attributes.saledt) : '';
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
				return q(SVC.improvements, {
					where: `parcelnb IN (${inClause}) AND proptype = 'Residential'`,
					returnGeometry: 'false'
				});
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const existing = map.get(a.parcelnb);
				if (!existing || parseFloat(a.bldgid) === 1) {
					const bathInfo = splitBaths(a.baths ?? 0);
					map.set(a.parcelnb, {
						beds: a.bedrooms ?? 0,
						fullBaths: bathInfo.full,
						halfBaths: bathInfo.half,
						threeQtrBaths: 0,
						sqft: a.sf ?? 0,
						yearBuilt: a.yrblt ?? 0,
						design: a.bltasdesc ?? '',
						classDescription: a.proptype ?? ''
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
					where: `PARCELNB IN (${inClause})`,
					outFields: 'PARCELNB,concataddr1,loccity',
					outSR: '4326'
				});
			})
		);

		const map = new Map<string, { address: string; city: string; lat: number; lng: number }>();
		for (const res of results) {
			for (const f of res.features) {
				let lat = 0,
					lng = 0;
				if (f.geometry?.rings) {
					const center = polygonCentroid(f.geometry.rings);
					lat = center.lat;
					lng = center.lng;
				}
				map.set(f.attributes.PARCELNB, {
					address: (f.attributes.concataddr1 ?? '').trim(),
					city: (f.attributes.loccity ?? '').trim(),
					lat,
					lng
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, {
			where: `parcelnb = '${accountNo}'`,
			returnGeometry: 'false'
		});
		return res.features
			.map((f: any) => ({
				date: f.attributes.saledt ? unixMsToDate(f.attributes.saledt) : '',
				price: f.attributes.salesp ?? 0,
				deedType: f.attributes.deedtype ?? '',
				receptionNo: f.attributes.recptno ?? ''
			}))
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
