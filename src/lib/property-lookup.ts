import type { PropertyData, BuildingInfo, AreaInfo, SaleRecord, ValueRecord } from '$lib/types';
import {
	getParcelProperty,
	getBuildingAttributes,
	getBuildingArea,
	getSales,
	getValues
} from './arcgis';
import { unixMsToDate } from '$lib/utils';

/**
 * Fetch all data for a property by account number.
 * Calls 5 APIs in parallel.
 */
export async function lookupProperty(accountNo: string): Promise<PropertyData> {
	const [parcelRes, bldgRes, areaRes, salesRes, valuesRes] = await Promise.all([
		getParcelProperty(accountNo),
		getBuildingAttributes(accountNo),
		getBuildingArea(accountNo),
		getSales(accountNo),
		getValues(accountNo)
	]);

	const parcel = parcelRes.features[0]?.attributes;
	if (!parcel) {
		throw new Error(`Property not found: ${accountNo}`);
	}

	// Use first building record (primary residence, BuildingNumber=1)
	const bldg = bldgRes.features.find((f) => f.attributes.BuildingNumber === 1)?.attributes
		?? bldgRes.features[0]?.attributes;
	const building: BuildingInfo | null = bldg
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
		: null;

	const areas: AreaInfo[] = areaRes.features.map((f) => ({
		description: f.attributes.AreaDscr ?? '',
		sqft: f.attributes.AreaSqft ?? 0
	}));

	const sales: SaleRecord[] = salesRes.features
		.map((f) => ({
			date: f.attributes.SaleDate ? unixMsToDate(f.attributes.SaleDate) : '',
			price: f.attributes.SalePrice ?? 0,
			deedType: f.attributes.DeedType ?? '',
			receptionNo: f.attributes.DeedReceptionNo ?? ''
		}))
		.sort((a, b) => b.date.localeCompare(a.date));

	const val = valuesRes.features[0]?.attributes;
	const values: ValueRecord | null = val
		? {
				totalActual: val.TotalActualValue ?? 0,
				totalAssessed: val.TotalAssessedValue ?? 0,
				landActual: val.LandActualValue ?? 0,
				improvementActual: val.BldgActualValue ?? 0,
				assessmentYear: val.TaxYear ?? 0
			}
		: null;

	return {
		accountNo,
		address: parcel.PropertyAddress ?? '',
		city: parcel.city ?? '',
		neighborhood: parcel.NbhdDscr ?? String(parcel.NbhdCode ?? ''),
		lat: parseFloat(parcel.Latitude) || 0,
		lng: parseFloat(parcel.Longitude) || 0,
		lotAcres: parcel.EstLandAcres ?? 0,
		ownerName: parcel.OwnerName ?? '',
		building,
		areas,
		sales,
		values
	};
}
