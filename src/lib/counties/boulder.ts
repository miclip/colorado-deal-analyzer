import type { CountyDataSource } from './types';
import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';
import { queryArcGIS } from '$lib/arcgis';
import { chunk, unixMsToDate, normalizeAddress } from '$lib/utils';

const BASE = 'https://maps.bouldercounty.org/ArcGIS/rest/services';
const SVC = {
	parcel: 'CamaView/ParcelPropertyView/MapServer/0',
	building: 'CamaView/PropSearch_BLDG_ATTRIBUTES/MapServer/1',
	area: 'CamaView/PropSearch_BLDG_AREA/MapServer/1',
	sales: 'CamaView/PropSearch_SALES/MapServer/1',
	values: 'CamaView/PropSearch_VALUES/MapServer/1',
	parcelsOwner: 'PARCELS/PARCELS_OWNER/FeatureServer/0'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function q(service: string, params: Record<string, string>): Promise<any> {
	return queryArcGIS(BASE, service, params);
}

export const boulder: CountyDataSource = {
	id: 'boulder',
	name: 'Boulder County',

	async searchByAddress(term: string): Promise<SearchResult[]> {
		const escaped = normalizeAddress(term).replace(/'/g, "''");
		const res = await q(SVC.parcel, {
			where: `PropertyAddress LIKE '%${escaped}%'`,
			resultRecordCount: '15'
		});
		return res.features.map((f: any) => ({
			accountNo: f.attributes.AccountNo,
			address: f.attributes.PropertyAddress,
			city: f.attributes.city ?? '',
			neighborhood: f.attributes.NbhdDscr ?? String(f.attributes.NbhdCode ?? '')
		}));
	},

	async lookupProperty(accountNo: string): Promise<PropertyData> {
		const [parcelRes, bldgRes, areaRes, salesRes, valuesRes] = await Promise.all([
			q(SVC.parcel, { where: `AccountNo = '${accountNo}'` }),
			q(SVC.building, { where: `AccountNo = '${accountNo}'` }),
			q(SVC.area, { where: `AccountNo = '${accountNo}'` }),
			q(SVC.sales, { where: `AccountNo = '${accountNo}'` }),
			q(SVC.values, { where: `AccountNo = '${accountNo}'` })
		]);

		const p = parcelRes.features[0]?.attributes;
		if (!p) throw new Error(`Property not found: ${accountNo}`);

		const bldg =
			bldgRes.features.find((f: any) => f.attributes.BuildingNumber === 1)?.attributes ??
			bldgRes.features[0]?.attributes;

		return {
			accountNo,
			address: p.PropertyAddress ?? '',
			city: p.city ?? '',
			neighborhood: p.NbhdDscr ?? String(p.NbhdCode ?? ''),
			lat: parseFloat(p.Latitude) || 0,
			lng: parseFloat(p.Longitude) || 0,
			lotAcres: p.EstLandAcres ?? 0,
			ownerName: p.OwnerName ?? '',
			building: bldg
				? {
						beds: bldg.Bedrooms ?? 0,
						fullBaths: bldg.FullBaths ?? 0,
						halfBaths: bldg.HalfBaths ?? 0,
						threeQtrBaths: bldg.ThreeQtrBaths ?? 0,
						sqft: bldg.FinishedSqft ?? 0,
						yearBuilt: bldg.YearBuilt ?? 0,
						design: bldg.DesignDscr ?? '',
						classDescription: bldg.ClassCodeDscr ?? ''
					}
				: null,
			areas: areaRes.features.map((f: any) => ({
				description: f.attributes.AreaDscr ?? '',
				sqft: f.attributes.AreaSqft ?? 0
			})),
			sales: salesRes.features
				.map((f: any) => ({
					date: f.attributes.SaleDate ? unixMsToDate(f.attributes.SaleDate) : '',
					price: f.attributes.SalePrice ?? 0,
					deedType: f.attributes.DeedType ?? '',
					receptionNo: f.attributes.DeedReceptionNo ?? ''
				}))
				.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date)),
			values: valuesRes.features[0]?.attributes
				? {
						totalActual: valuesRes.features[0].attributes.TotalActualValue ?? 0,
						totalAssessed: valuesRes.features[0].attributes.TotalAssessedValue ?? 0,
						landActual: valuesRes.features[0].attributes.LandActualValue ?? 0,
						improvementActual: valuesRes.features[0].attributes.BldgActualValue ?? 0,
						assessmentYear: valuesRes.features[0].attributes.TaxYear ?? 0
					}
				: null
		};
	},

	async findNearbyAccountNos(lat, lng, radiusMiles) {
		const res = await q(SVC.parcelsOwner, {
			where: '1=1',
			geometry: `${lng},${lat}`,
			geometryType: 'esriGeometryPoint',
			inSR: '4326',
			spatialRel: 'esriSpatialRelIntersects',
			distance: radiusMiles.toString(),
			units: 'esriSRUnit_StatuteMile',
			resultRecordCount: '5000',
			outFields: 'AccountNo'
		});
		return res.features.map((f: any) => f.attributes.AccountNo).filter(Boolean);
	},

	async getRecentSales(accountNos, minDate) {
		const dateStr = minDate.toISOString().split('T')[0];
		const batches = chunk(accountNos, 100);
		const results = await Promise.all(
			batches.map((batch) => {
				const inClause = batch.map((a) => `'${a}'`).join(',');
				return q(SVC.sales, {
					where: `AccountNo IN (${inClause}) AND SaleDate > date '${dateStr}' AND SalePrice > 50000`,
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
				const { AccountNo, SalePrice, SaleDate, DeedType } = f.attributes;
				if (DeedType === 'QD' && SalePrice === 0) continue;
				const d = unixMsToDate(SaleDate);
				const existing = byAccount.get(AccountNo);
				if (!existing || d > existing.date) {
					byAccount.set(AccountNo, {
						accountNo: AccountNo,
						price: SalePrice,
						date: d,
						deedType: DeedType ?? ''
					});
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
				return q(SVC.building, { where: `AccountNo IN (${inClause})` });
			})
		);

		const map = new Map<string, BuildingInfo>();
		for (const res of results) {
			for (const f of res.features) {
				const a = f.attributes;
				const existing = map.get(a.AccountNo);
				if (!existing || a.BuildingNumber === 1) {
					map.set(a.AccountNo, {
						beds: a.Bedrooms ?? 0,
						fullBaths: a.FullBaths ?? 0,
						halfBaths: a.HalfBaths ?? 0,
						threeQtrBaths: a.ThreeQtrBaths ?? 0,
						sqft: a.FinishedSqft ?? 0,
						yearBuilt: a.YearBuilt ?? 0,
						design: a.DesignDscr ?? '',
						classDescription: a.ClassCodeDscr ?? ''
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
				return q(SVC.parcel, {
					where: `AccountNo IN (${inClause})`,
					outFields: 'AccountNo,PropertyAddress,city,Latitude,Longitude'
				});
			})
		);

		const map = new Map<string, { address: string; city: string; lat: number; lng: number }>();
		for (const res of results) {
			for (const f of res.features) {
				map.set(f.attributes.AccountNo, {
					address: f.attributes.PropertyAddress ?? '',
					city: f.attributes.city ?? '',
					lat: parseFloat(f.attributes.Latitude) || 0,
					lng: parseFloat(f.attributes.Longitude) || 0
				});
			}
		}
		return map;
	},

	async getSalesHistory(accountNo) {
		const res = await q(SVC.sales, { where: `AccountNo = '${accountNo}'` });
		return res.features
			.map((f: any) => ({
				date: f.attributes.SaleDate ? unixMsToDate(f.attributes.SaleDate) : '',
				price: f.attributes.SalePrice ?? 0,
				deedType: f.attributes.DeedType ?? '',
				receptionNo: f.attributes.DeedReceptionNo ?? ''
			}))
			.sort((a: SaleRecord, b: SaleRecord) => b.date.localeCompare(a.date));
	}
};
