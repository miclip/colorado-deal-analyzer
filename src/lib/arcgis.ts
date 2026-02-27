import type {
	ArcGISResponse,
	ParcelPropertyAttrs,
	BuildingAttrs,
	BuildingAreaAttrs,
	SalesAttrs,
	ValuesAttrs,
	ParcelsOwnerAttrs
} from '$lib/types';

const BASE_URL = 'https://maps.bouldercounty.org/ArcGIS/rest/services';

const SERVICES = {
	parcelProperty: 'CamaView/ParcelPropertyView/MapServer/0',
	buildingAttributes: 'CamaView/PropSearch_BLDG_ATTRIBUTES/MapServer/1',
	buildingArea: 'CamaView/PropSearch_BLDG_AREA/MapServer/1',
	sales: 'CamaView/PropSearch_SALES/MapServer/1',
	values: 'CamaView/PropSearch_VALUES/MapServer/1',
	parcelsOwner: 'PARCELS/PARCELS_OWNER/FeatureServer/0'
} as const;

/**
 * Query ArcGIS REST API using POST to avoid URL length limits.
 */
async function query<T>(
	service: string,
	params: Record<string, string>
): Promise<ArcGISResponse<T>> {
	const url = `${BASE_URL}/${service}/query`;

	const body = new URLSearchParams();
	body.set('f', 'json');
	if (!params.outFields) {
		body.set('outFields', '*');
	}
	for (const [key, value] of Object.entries(params)) {
		body.set(key, value);
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	if (!response.ok) {
		throw new Error(`ArcGIS query failed: ${response.status} ${response.statusText}`);
	}
	const data = await response.json();
	if (data.error) {
		throw new Error(`ArcGIS error: ${data.error.message} (${data.error.details?.join(', ') ?? ''})`);
	}
	return data as ArcGISResponse<T>;
}

/**
 * Search properties by partial address match.
 */
export async function searchByAddress(
	term: string
): Promise<ArcGISResponse<ParcelPropertyAttrs>> {
	const escaped = term.replace(/'/g, "''");
	return query<ParcelPropertyAttrs>(SERVICES.parcelProperty, {
		where: `PropertyAddress LIKE '%${escaped}%'`,
		resultRecordCount: '15'
	});
}

/**
 * Get parcel property by account number.
 */
export async function getParcelProperty(
	accountNo: string
): Promise<ArcGISResponse<ParcelPropertyAttrs>> {
	return query<ParcelPropertyAttrs>(SERVICES.parcelProperty, {
		where: `AccountNo = '${accountNo}'`
	});
}

/**
 * Get parcel property for multiple accounts.
 */
export async function getParcelPropertyBatch(
	accountNos: string[]
): Promise<ArcGISResponse<ParcelPropertyAttrs>> {
	const inClause = accountNos.map((a) => `'${a}'`).join(',');
	return query<ParcelPropertyAttrs>(SERVICES.parcelProperty, {
		where: `AccountNo IN (${inClause})`,
		outFields: 'AccountNo,PropertyAddress,city,Latitude,Longitude'
	});
}

/**
 * Get building attributes for an account.
 */
export async function getBuildingAttributes(
	accountNo: string
): Promise<ArcGISResponse<BuildingAttrs>> {
	return query<BuildingAttrs>(SERVICES.buildingAttributes, {
		where: `AccountNo = '${accountNo}'`
	});
}

/**
 * Get building attributes for multiple accounts.
 */
export async function getBuildingAttributesBatch(
	accountNos: string[]
): Promise<ArcGISResponse<BuildingAttrs>> {
	const inClause = accountNos.map((a) => `'${a}'`).join(',');
	return query<BuildingAttrs>(SERVICES.buildingAttributes, {
		where: `AccountNo IN (${inClause})`
	});
}

/**
 * Get building area breakdown for an account.
 */
export async function getBuildingArea(
	accountNo: string
): Promise<ArcGISResponse<BuildingAreaAttrs>> {
	return query<BuildingAreaAttrs>(SERVICES.buildingArea, {
		where: `AccountNo = '${accountNo}'`
	});
}

/**
 * Get sales history for an account.
 */
export async function getSales(accountNo: string): Promise<ArcGISResponse<SalesAttrs>> {
	return query<SalesAttrs>(SERVICES.sales, {
		where: `AccountNo = '${accountNo}'`
	});
}

/**
 * Get sales for multiple accounts, filtered by date and minimum price.
 */
export async function getSalesBatch(
	accountNos: string[],
	minDate: Date,
	minPrice: number = 50000
): Promise<ArcGISResponse<SalesAttrs>> {
	const inClause = accountNos.map((a) => `'${a}'`).join(',');
	const dateStr = minDate.toISOString().split('T')[0]; // YYYY-MM-DD
	return query<SalesAttrs>(SERVICES.sales, {
		where: `AccountNo IN (${inClause}) AND SaleDate > date '${dateStr}' AND SalePrice > ${minPrice}`,
		resultRecordCount: '1000'
	});
}

/**
 * Get assessed values for an account.
 */
export async function getValues(accountNo: string): Promise<ArcGISResponse<ValuesAttrs>> {
	return query<ValuesAttrs>(SERVICES.values, {
		where: `AccountNo = '${accountNo}'`
	});
}

/**
 * Spatial query: find parcels within a radius (miles) of a point.
 */
export async function findParcelsNearby(
	lat: number,
	lng: number,
	radiusMiles: number
): Promise<ArcGISResponse<ParcelsOwnerAttrs>> {
	return query<ParcelsOwnerAttrs>(SERVICES.parcelsOwner, {
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
}
