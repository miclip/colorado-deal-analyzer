import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, normalizeAddress } from '$lib/utils';

const BASE = 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services';
const SVC = {
	parcels: 'ODC_PROP_PARCELS_A/FeatureServer/245',
	residential: 'ODC_real_property_residential_characteristics/FeatureServer/59',
	sales: 'ODC_real_property_sales_and_transfers/FeatureServer/60'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

/**
 * Denver sales table stores dates as YYYYMMDD integers + separate SALE_YEAR.
 * Convert to ISO date string.
 */
function saleMonthDayToDate(year: number, monthDay: number): string {
	if (!year || !monthDay) return '';
	const month = Math.floor(monthDay / 100);
	const day = monthDay % 100;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

export const denver: CountyDataSource = {
	id: 'denver',
	name: 'Denver County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q(SVC.parcels, {
			where: `SITUS_ADDRESS_LINE1 LIKE '%${escaped}%' AND D_CLASS_CN LIKE 'RESIDENTIAL%'`,
			resultRecordCount: '15',
			outFields: 'SCHEDNUM,SITUS_ADDRESS_LINE1,SITUS_CITY,D_CLASS_CN',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.SCHEDNUM,
			address: f.attributes.SITUS_ADDRESS_LINE1 ?? '',
			city: f.attributes.SITUS_CITY ?? '',
			neighborhood: f.attributes.D_CLASS_CN ?? ''
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [parcelRes, bldgRes, salesRes] = await Promise.all([
			q(SVC.parcels, {
				where: `SCHEDNUM = '${accountNo}'`,
				outSR: '4326'
			}),
			q(SVC.residential, {
				where: `PARID = '${accountNo}' AND CD = 1`
			}),
			q(SVC.sales, {
				where: `PARID = '${accountNo}'`
			})
		]);

		const parcel = parcelRes.features[0];
		if (!parcel) throw new Error(`Property not found: ${accountNo}`);
		const a = parcel.attributes;

		// Get lat/lng from polygon centroid (geometry returned in WGS84 via outSR)
		let lat = 0,
			lng = 0;
		if (parcel.geometry?.rings) {
			const center = polygonCentroid(parcel.geometry.rings);
			lat = center.lat;
			lng = center.lng;
		}

		const bldg = bldgRes.features[0]?.attributes;

		return {
			accountNo,
			address: a.SITUS_ADDRESS_LINE1 ?? '',
			city: a.SITUS_CITY ?? '',
			neighborhood: bldg?.NBHD_1_CN ?? '',
			lat,
			lng,
			lotAcres: a.LAND_AREA ? a.LAND_AREA / 43560 : 0, // convert sqft to acres
			ownerName: a.OWNER_NAME ?? '',
			building: bldg
				? {
						beds: bldg.BED_RMS ?? 0,
						fullBaths: bldg.FULL_B ?? 0,
						halfBaths: bldg.HLF_B ?? 0,
						threeQtrBaths: 0, // Denver doesn't track 3/4 baths
						sqft: bldg.AREA_ABG ?? 0,
						yearBuilt: bldg.CCYRBLT ?? a.RES_ORIG_YEAR_BUILT ?? 0,
						design: bldg.STYLE_CN ?? '',
						classDescription: bldg.D_CLASS_CN ?? a.D_CLASS_CN ?? ''
					}
				: a.RES_ABOVE_GRADE_AREA
					? {
							beds: 0,
							fullBaths: 0,
							halfBaths: 0,
							threeQtrBaths: 0,
							sqft: a.RES_ABOVE_GRADE_AREA ?? 0,
							yearBuilt: a.RES_ORIG_YEAR_BUILT ?? 0,
							design: '',
							classDescription: a.D_CLASS_CN ?? ''
						}
					: null,
			areas: [],
			sales: salesRes.features
				.map((f: any) => ({
					date: saleMonthDayToDate(f.attributes.SALE_YEAR, f.attributes.SALE_MONTHDAY),
					price: f.attributes.SALE_PRICE ?? 0,
					deedType: f.attributes.INSTRUMENT ?? '',
					receptionNo: f.attributes.RECEPTION_NUM ?? ''
				}))
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values:
				a.APPRAISED_TOTAL_VALUE
					? {
							totalActual: a.APPRAISED_TOTAL_VALUE ?? 0,
							totalAssessed: a.ASSESSED_TOTAL_VALUE_LOCAL ?? 0,
							landActual: a.APPRAISED_LAND_VALUE ?? 0,
							improvementActual: a.APPRAISED_IMP_VALUE ?? 0,
							assessmentYear: 0
						}
					: null
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q(SVC.parcels, {
			where: "D_CLASS_CN LIKE 'RESIDENTIAL%'",
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '5000',
			outFields: 'SCHEDNUM',
			returnGeometry: 'false'
		});
		return res.features.map((f: any) => f.attributes.SCHEDNUM).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		// Parcels layer has SALE_DATE (epoch ms) and SALE_PRICE for the most recent sale
		// Use the parcels layer for speed since it has the last sale embedded
		const dateMs = minDate.getTime();
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.parcels, {
					where: `SCHEDNUM IN (${inClause}) AND SALE_DATE > ${dateMs} AND SALE_PRICE > 50000`,
					outFields: 'SCHEDNUM,SALE_DATE,SALE_PRICE,ASAL_INSTR',
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
				const accountNo = f.attributes.SCHEDNUM;
				const price = f.attributes.SALE_PRICE ?? 0;
				const deedType = f.attributes.ASAL_INSTR ?? '';
				const d = f.attributes.SALE_DATE
					? new Date(f.attributes.SALE_DATE).toISOString().split('T')[0]
					: '';
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
				return q(SVC.residential, {
					where: `PARID IN (${inClause})`
				});
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const existing = map.get(a.PARID);
				if (!existing || a.CD === 1) {
					map.set(a.PARID, {
						beds: a.BED_RMS ?? 0,
						fullBaths: a.FULL_B ?? 0,
						halfBaths: a.HLF_B ?? 0,
						threeQtrBaths: 0,
						sqft: a.AREA_ABG ?? 0,
						yearBuilt: a.CCYRBLT ?? 0,
						design: a.STYLE_CN ?? '',
						classDescription: a.D_CLASS_CN ?? ''
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
					where: `SCHEDNUM IN (${inClause})`,
					outFields: 'SCHEDNUM,SITUS_ADDRESS_LINE1,SITUS_CITY',
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
				map.set(f.attributes.SCHEDNUM, {
					address: f.attributes.SITUS_ADDRESS_LINE1 ?? '',
					city: f.attributes.SITUS_CITY ?? '',
					lat,
					lng
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, { where: `PARID = '${accountNo}'` });
		return res.features
			.map((f: any) => ({
				date: saleMonthDayToDate(f.attributes.SALE_YEAR, f.attributes.SALE_MONTHDAY),
				price: f.attributes.SALE_PRICE ?? 0,
				deedType: f.attributes.INSTRUMENT ?? '',
				receptionNo: f.attributes.RECEPTION_NUM ?? ''
			}))
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
