import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services';
const SVC = {
	accountPoint: 'Account_Point_open_data/FeatureServer/0',
	ownership: 'Ownership2/FeatureServer/17',
	buildings: 'Imps_CurrentInvntry/FeatureServer/14',
	sales: 'Sales2/FeatureServer/18',
	parcels: 'Parcels_open_data/FeatureServer/0',
	salesPoint: 'Sales_Point_open_data/FeatureServer/1'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

export const weld: CountyDataSource = {
	id: 'weld',
	name: 'Weld County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q(SVC.accountPoint, {
			where: `PROPERTYADDRESS LIKE '%${escaped}%'`,
			resultRecordCount: '15',
			outFields: 'ACCOUNTNO,PARCELNO,PROPERTYADDRESS,PROPERTYCITY,NBHD,AcctType'
		});
		return res.features
			.filter((f: any) => f.attributes.AcctType === 'Residential')
			.map((f: any) => ({
				accountNo: f.attributes.ACCOUNTNO,
				address: f.attributes.PROPERTYADDRESS ?? '',
				city: f.attributes.PROPERTYCITY ?? '',
				neighborhood: f.attributes.NBHD ?? ''
			}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [acctRes, ownerRes, bldgRes, salesRes] = await Promise.all([
			q(SVC.accountPoint, { where: `ACCOUNTNO = '${accountNo}'` }),
			q(SVC.ownership, {
				where: `ACCOUNTNO = '${accountNo}' AND NAMETYPE = 'P'`,
				resultRecordCount: '1'
			}),
			q(SVC.buildings, { where: `ACCOUNTNO = '${accountNo}'` }),
			q(SVC.sales, { where: `accountno = '${accountNo}'` })
		]);

		const acct = acctRes.features[0];
		if (!acct) throw new Error(`Property not found: ${accountNo}`);
		const a = acct.attributes;

		// Get lat/lng from point geometry
		const geom = acct.geometry;
		let lat = 0,
			lng = 0;
		if (geom) {
			// Geometry is in Web Mercator (102100), need to convert to WGS84
			lng = (geom.x / 20037508.34) * 180;
			lat = (Math.atan(Math.exp((geom.y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90;
		}

		const owner = ownerRes.features[0]?.attributes;

		// Get primary building (BLDGID=1)
		const bldg =
			bldgRes.features.find((f: any) => f.attributes.BLDGID === 1)?.attributes ??
			bldgRes.features[0]?.attributes;

		// Get values from ownership table
		const landActual = owner?.LANDACT ?? 0;
		const impActual = owner?.IMPACT ?? 0;
		const landAssessed = owner?.LANDASD ?? 0;
		const impAssessed = owner?.IMPASD ?? 0;

		return {
			accountNo,
			address: a.PROPERTYADDRESS ?? '',
			city: a.PROPERTYCITY ?? '',
			neighborhood: a.NBHD ?? '',
			lat,
			lng,
			lotAcres: a.LANDNETACRECOUNT ?? 0,
			ownerName: owner?.NAME ?? '',
			building: bldg
				? {
						beds: bldg.BEDROOMS ?? a.BEDROOMCOUNT ?? 0,
						fullBaths: bldg.BATHS ?? a.BATHCOUNT ?? 0,
						halfBaths: 0,
						threeQtrBaths: 0,
						sqft: bldg.SF ?? a.GLA ?? 0,
						yearBuilt: parseInt(bldg.YRBLT) || a.BLTASYEARBUILT || 0,
						design: bldg.BLTASDESC ?? a.BLTASDESCRIPTION ?? '',
						classDescription: bldg.OCCUPANCY ?? a.CLASSDESCRIPTION ?? ''
					}
				: a.GLA
					? {
							beds: a.BEDROOMCOUNT ?? 0,
							fullBaths: a.BATHCOUNT ?? 0,
							halfBaths: 0,
							threeQtrBaths: 0,
							sqft: a.GLA ?? 0,
							yearBuilt: a.BLTASYEARBUILT ?? 0,
							design: a.BLTASDESCRIPTION ?? '',
							classDescription: a.CLASSDESCRIPTION ?? ''
						}
					: null,
			areas: [],
			sales: salesRes.features
				.map((f: any) => ({
					date: f.attributes.saledt ? unixMsToDate(f.attributes.saledt) : '',
					price: f.attributes.salep ?? 0,
					deedType: f.attributes.deedtype ?? '',
					receptionNo: f.attributes.recptno ?? ''
				}))
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values:
				landActual || impActual
					? {
							totalActual: landActual + impActual,
							totalAssessed: landAssessed + impAssessed,
							landActual,
							improvementActual: impActual,
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
			resultRecordCount: '5000',
			outFields: 'ACCOUNTNO'
		});
		return res.features.map((f: any) => f.attributes.ACCOUNTNO).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.sales, {
					where: `accountno IN (${inClause}) AND saledt > date '${dateStr}' AND salep > 50000`,
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
				const accountNo = f.attributes.accountno;
				const price = f.attributes.salep ?? 0;
				const deedType = f.attributes.deedtype ?? '';
				if (deedType === 'QCN' && price === 0) continue;
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
				return q(SVC.buildings, { where: `ACCOUNTNO IN (${inClause})` });
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const existing = map.get(a.ACCOUNTNO);
				if (!existing || a.BLDGID === 1) {
					map.set(a.ACCOUNTNO, {
						beds: a.BEDROOMS ?? 0,
						fullBaths: a.BATHS ?? 0,
						halfBaths: 0,
						threeQtrBaths: 0,
						sqft: a.SF ?? 0,
						yearBuilt: parseInt(a.YRBLT) || 0,
						design: a.BLTASDESC ?? '',
						classDescription: a.OCCUPANCY ?? ''
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
					where: `ACCOUNTNO IN (${inClause})`,
					outFields: 'ACCOUNTNO,SITUS,LOCCITY,latitude,longitude'
				});
			})
		);

		const map = new Map<string, { address: string; city: string; lat: number; lng: number }>();
		for (const res of results) {
			for (const f of res.features) {
				map.set(f.attributes.ACCOUNTNO, {
					address: f.attributes.SITUS ?? '',
					city: f.attributes.LOCCITY ?? '',
					lat: f.attributes.latitude ?? 0,
					lng: f.attributes.longitude ?? 0
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, { where: `accountno = '${accountNo}'` });
		return res.features
			.map((f: any) => ({
				date: f.attributes.saledt ? unixMsToDate(f.attributes.saledt) : '',
				price: f.attributes.salep ?? 0,
				deedType: f.attributes.deedtype ?? '',
				receptionNo: f.attributes.recptno ?? ''
			}))
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
