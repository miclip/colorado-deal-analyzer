import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://services1.arcgis.com/vXSRPZbyyOmH9pek/arcgis/rest/services';
const SVC = 'Parcels/FeatureServer/0';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, SVC, params);
}

/**
 * Broomfield stores baths as a decimal (e.g. 2.5 = 2 full + 1 half).
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

export const broomfield: CountyDataSource = {
	id: 'broomfield',
	name: 'Broomfield County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q({
			where: `UPPER(SITUS_FULL_ADDRESS) LIKE '%${escaped}%' AND ACCOUNTTYPE IN ('SFR','CONDO','AGRES')`,
			resultRecordCount: '15',
			outFields: 'ACCOUNTNUMBER,SITUS_FULL_ADDRESS,ARCHITECTURESTYLE',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.ACCOUNTNUMBER,
			address: f.attributes.SITUS_FULL_ADDRESS ?? '',
			city: 'BROOMFIELD',
			neighborhood: f.attributes.ARCHITECTURESTYLE ?? ''
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const res = await q({
			where: `ACCOUNTNUMBER = '${accountNo}'`,
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

		const sqft = parseFloat(a.LIVINGAREA) || 0;
		const bathInfo = splitBaths(a.BATHS ?? 0);

		return {
			accountNo,
			address: a.SITUS_FULL_ADDRESS ?? '',
			city: 'BROOMFIELD',
			neighborhood: a.ARCHITECTURESTYLE ?? '',
			lat,
			lng,
			lotAcres: a.GIS_ACRES ?? 0,
			ownerName: a.OWNERNAME ?? '',
			building: sqft > 0 || a.BEDROOMS
				? {
						beds: a.BEDROOMS ?? 0,
						fullBaths: bathInfo.full,
						halfBaths: bathInfo.half,
						threeQtrBaths: 0,
						sqft,
						yearBuilt: a.ACTUALYEARBUILT ?? 0,
						design: a.ARCHITECTURESTYLE ?? '',
						classDescription: a.ACCOUNTTYPE ?? ''
					}
				: null,
			areas: [],
			sales: a.SALEDATE
				? [
						{
							date: unixMsToDate(a.SALEDATE),
							price: a.SALEPRICE ?? 0,
							deedType: a.SALEDOCUMENTTYPE ?? '',
							receptionNo: a.SALEDOCUMENTNUMBER ?? ''
						}
					]
				: [],
			values: a.FINALACTUALVALUE
				? {
						totalActual: a.FINALACTUALVALUE ?? 0,
						totalAssessed: a.FINALTAXABLEVALUE ?? 0,
						landActual: a.LANDACTUAL ?? 0,
						improvementActual: a.IMPROVEMENTSACTUAL ?? 0,
						assessmentYear: 0
					}
				: null
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q({
			where: "ACCOUNTTYPE IN ('SFR','CONDO','AGRES')",
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '2000',
			outFields: 'ACCOUNTNUMBER',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => f.attributes.ACCOUNTNUMBER).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q({
					where: `ACCOUNTNUMBER IN (${inClause}) AND SALEDATE > date '${dateStr}' AND SALEPRICE > 50000`,
					outFields: 'ACCOUNTNUMBER,SALEDATE,SALEPRICE,SALEDOCUMENTTYPE',
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
				const accountNo = f.attributes.ACCOUNTNUMBER;
				const price = f.attributes.SALEPRICE ?? 0;
				const deedType = f.attributes.SALEDOCUMENTTYPE ?? '';
				const d = f.attributes.SALEDATE ? unixMsToDate(f.attributes.SALEDATE) : '';
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
					where: `ACCOUNTNUMBER IN (${inClause})`,
					outFields: 'ACCOUNTNUMBER,BEDROOMS,BATHS,LIVINGAREA,ACTUALYEARBUILT,ARCHITECTURESTYLE,ACCOUNTTYPE',
					returnGeometry: 'false'
				});
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const bathInfo = splitBaths(a.BATHS ?? 0);
				map.set(a.ACCOUNTNUMBER, {
					beds: a.BEDROOMS ?? 0,
					fullBaths: bathInfo.full,
					halfBaths: bathInfo.half,
					threeQtrBaths: 0,
					sqft: parseFloat(a.LIVINGAREA) || 0,
					yearBuilt: a.ACTUALYEARBUILT ?? 0,
					design: a.ARCHITECTURESTYLE ?? '',
					classDescription: a.ACCOUNTTYPE ?? ''
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
					where: `ACCOUNTNUMBER IN (${inClause})`,
					outFields: 'ACCOUNTNUMBER,SITUS_FULL_ADDRESS',
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
				map.set(f.attributes.ACCOUNTNUMBER, {
					address: f.attributes.SITUS_FULL_ADDRESS ?? '',
					city: 'BROOMFIELD',
					lat,
					lng
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		// Broomfield only has the most recent sale embedded in the parcel layer
		const res = await q({
			where: `ACCOUNTNUMBER = '${accountNo}'`,
			outFields: 'SALEDATE,SALEPRICE,SALEDOCUMENTTYPE,SALEDOCUMENTNUMBER',
			returnGeometry: 'false'
		});
		const a = res.features[0]?.attributes;
		if (a?.SALEDATE) {
			return [
				{
					date: unixMsToDate(a.SALEDATE),
					price: a.SALEPRICE ?? 0,
					deedType: a.SALEDOCUMENTTYPE ?? '',
					receptionNo: a.SALEDOCUMENTNUMBER ?? ''
				}
			];
		}
		return [];
	}
};
