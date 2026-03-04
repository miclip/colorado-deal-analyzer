import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://maps1.larimer.org/arcgis/rest/services';
const SVC = {
	siteAddress: 'MapServices/Parcels/MapServer/0',
	taxParcels: 'MapServices/Parcels/MapServer/3',
	sales: 'MapServices/Parcels/MapServer/5'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

/**
 * Compute a simple centroid from polygon rings (average of vertices).
 * Geometry must be in WGS84 (outSR=4326).
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

export const larimer: CountyDataSource = {
	id: 'larimer',
	name: 'Larimer County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q(SVC.taxParcels, {
			where: `LOCADDRESS LIKE '%${escaped}%' AND ACCTTYPE = 'Residential'`,
			resultRecordCount: '15',
			outFields: 'PARCELNUM,LOCADDRESS,LOCCITY,NAME,TAXDIST'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.PARCELNUM,
			address: f.attributes.LOCADDRESS ?? '',
			city: f.attributes.LOCCITY ?? '',
			neighborhood: f.attributes.TAXDIST ?? ''
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [parcelRes, salesRes] = await Promise.all([
			q(SVC.taxParcels, {
				where: `PARCELNUM = '${accountNo}'`,
				outSR: '4326'
			}),
			q(SVC.sales, { where: `PARCELNUM = '${accountNo}'` })
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

		return {
			accountNo,
			address: a.LOCADDRESS ?? '',
			city: a.LOCCITY ?? '',
			neighborhood: a.TAXDIST ?? '',
			lat,
			lng,
			lotAcres: 0, // not available in ArcGIS
			ownerName: a.NAME ?? '',
			building: null, // building data only in bulk CSV downloads
			areas: [],
			sales: salesRes.features
				.map((f: any) => ({
					date: f.attributes.SALEDATE ? unixMsToDate(f.attributes.SALEDATE) : '',
					price: f.attributes.SALEPRICE ?? 0,
					deedType: '', // not available in ArcGIS layer
					receptionNo: ''
				}))
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values: null // not available in ArcGIS
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q(SVC.taxParcels, {
			where: "ACCTTYPE = 'Residential'",
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '5000',
			outFields: 'PARCELNUM'
		});
		return res.features.map((f: any) => f.attributes.PARCELNUM).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.sales, {
					where: `PARCELNUM IN (${inClause}) AND SALEDATE > date '${dateStr}' AND SALEPRICE > 50000`,
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
				const accountNo = f.attributes.PARCELNUM;
				const price = f.attributes.SALEPRICE ?? 0;
				const d = f.attributes.SALEDATE ? unixMsToDate(f.attributes.SALEDATE) : '';
				const existing = byAccount.get(accountNo);
				if (!existing || d > existing.date) {
					byAccount.set(accountNo, { accountNo, price, date: d, deedType: '' });
				}
			}
		}
		return [...byAccount.values()];
	},

	async getBuildingInfoBatch() {
		// Building data (beds, baths, sqft, year built) is not available
		// via Larimer's ArcGIS services — only in bulk CSV downloads.
		return new Map<string, BuildingInfo>();
	},

	async getParcelInfoBatch(accountNos) {
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.taxParcels, {
					where: `PARCELNUM IN (${inClause})`,
					outFields: 'PARCELNUM,LOCADDRESS,LOCCITY',
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
				map.set(f.attributes.PARCELNUM, {
					address: f.attributes.LOCADDRESS ?? '',
					city: f.attributes.LOCCITY ?? '',
					lat,
					lng
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, { where: `PARCELNUM = '${accountNo}'` });
		return res.features
			.map((f: any) => ({
				date: f.attributes.SALEDATE ? unixMsToDate(f.attributes.SALEDATE) : '',
				price: f.attributes.SALEPRICE ?? 0,
				deedType: '',
				receptionNo: ''
			}))
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
