import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://services1.arcgis.com/6IRzQDYOM6sGbmjI/arcgis/rest/services';
const SVC = 'Tax_Parcels_Hosted/FeatureServer/0';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, SVC, params);
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

export const mesa: CountyDataSource = {
	id: 'mesa',
	name: 'Mesa County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q({
			where: `UPPER(LOCATION) LIKE '%${escaped}%' AND PROPTYPE = 'Residential'`,
			resultRecordCount: '15',
			outFields: 'ACCOUNTNO,LOCATION,NBDESC,ARCH1ST',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.ACCOUNTNO,
			address: f.attributes.LOCATION ?? '',
			city: '',
			neighborhood: f.attributes.NBDESC ?? ''
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const res = await q({
			where: `ACCOUNTNO = '${accountNo}'`,
			outSR: '4326'
		});

		const parcel = res.features[0];
		if (!parcel) throw new Error(`Property not found: ${accountNo}`);
		const a = parcel.attributes;

		let lat = 0,
			lng = 0;
		if (parcel.geometry?.rings) {
			const center = polygonCentroid(parcel.geometry.rings);
			lat = center.lat;
			lng = center.lng;
		}

		const baths = parseFloat(a.BTHS1ST) || 0;
		const fullBaths = Math.floor(baths);
		const halfBaths = baths % 1 >= 0.25 ? 1 : 0;

		return {
			accountNo,
			address: a.LOCATION ?? '',
			city: '',
			neighborhood: a.NBDESC ?? '',
			lat,
			lng,
			lotAcres: a.Acres ?? 0,
			ownerName: a.OWNER ?? '',
			building: a.TOTHTSQF
				? {
						beds: a.BDRMS1ST ?? 0,
						fullBaths,
						halfBaths,
						threeQtrBaths: 0,
						sqft: a.TOTHTSQF ?? 0,
						yearBuilt: a.AYB1ST ?? 0,
						design: a.ARCH1ST ?? '',
						classDescription: a.PROPTYPE ?? ''
					}
				: null,
			areas: [],
			sales: a.SDATE
				? [
						{
							date: unixMsToDate(a.SDATE),
							price: a.SPRICE ?? 0,
							deedType: a.SQUAL ?? '',
							receptionNo: a.SRECPT ?? ''
						}
					]
				: [],
			values: a.TOTVALCUR
				? {
						totalActual: a.TOTVALCUR ?? 0,
						totalAssessed: a.TOTASSCUR ?? 0,
						landActual: a.LNDVALCUR ?? 0,
						improvementActual: a.IMPVALCUR ?? 0,
						assessmentYear: 0
					}
				: null
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q({
			where: "PROPTYPE = 'Residential'",
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '2000',
			outFields: 'ACCOUNTNO',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => f.attributes.ACCOUNTNO).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q({
					where: `ACCOUNTNO IN (${inClause}) AND SDATE > date '${dateStr}' AND SPRICE > 50000`,
					outFields: 'ACCOUNTNO,SDATE,SPRICE,SQUAL',
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
				const accountNo = f.attributes.ACCOUNTNO;
				const price = f.attributes.SPRICE ?? 0;
				const deedType = f.attributes.SQUAL ?? '';
				const d = f.attributes.SDATE ? unixMsToDate(f.attributes.SDATE) : '';
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
				return q({
					where: `ACCOUNTNO IN (${inClause})`,
					outFields: 'ACCOUNTNO,BDRMS1ST,BTHS1ST,TOTHTSQF,AYB1ST,ARCH1ST,PROPTYPE',
					returnGeometry: 'false'
				});
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const baths = parseFloat(a.BTHS1ST) || 0;
				map.set(a.ACCOUNTNO, {
					beds: a.BDRMS1ST ?? 0,
					fullBaths: Math.floor(baths),
					halfBaths: baths % 1 >= 0.25 ? 1 : 0,
					threeQtrBaths: 0,
					sqft: a.TOTHTSQF ?? 0,
					yearBuilt: a.AYB1ST ?? 0,
					design: a.ARCH1ST ?? '',
					classDescription: a.PROPTYPE ?? ''
				});
			}
		}
		return map;
	},

	async getParcelInfoBatch(accountNos) {
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q({
					where: `ACCOUNTNO IN (${inClause})`,
					outFields: 'ACCOUNTNO,LOCATION',
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
				map.set(f.attributes.ACCOUNTNO, {
					address: f.attributes.LOCATION ?? '',
					city: '',
					lat,
					lng
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		// Mesa County only has the most recent sale embedded in the parcel layer
		const res = await q({
			where: `ACCOUNTNO = '${accountNo}'`,
			outFields: 'SDATE,SPRICE,SQUAL,SRECPT',
			returnGeometry: 'false'
		});
		const a = res.features[0]?.attributes;
		if (a?.SDATE) {
			return [
				{
					date: unixMsToDate(a.SDATE),
					price: a.SPRICE ?? 0,
					deedType: a.SQUAL ?? '',
					receptionNo: a.SRECPT ?? ''
				}
			];
		}
		return [];
	}
};
