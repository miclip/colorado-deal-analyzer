import type { PropertyData, BuildingInfo, SaleRecord, SearchResult } from '$lib/types';

/**
 * Each county implements this interface to normalize its ArcGIS data
 * into the app's domain types. The comp-finder uses these primitives
 * for the shared scoring/ranking logic.
 */
export interface CountyDataSource {
	id: string;
	name: string;

	/** Search properties by partial address match. */
	searchByAddress(term: string): Promise<SearchResult[]>;

	/** Fetch all data for a single property. */
	lookupProperty(accountNo: string): Promise<PropertyData>;

	/** Find account numbers for parcels within a radius of a point. */
	findNearbyAccountNos(lat: number, lng: number, radiusMiles: number): Promise<string[]>;

	/**
	 * Get recent sales for a batch of accounts.
	 * Returns one entry per account (most recent qualifying sale).
	 */
	getRecentSales(
		accountNos: string[],
		minDate: Date
	): Promise<{ accountNo: string; price: number; date: string; deedType: string }[]>;

	/** Get building info for a batch of accounts. */
	getBuildingInfoBatch(accountNos: string[]): Promise<Map<string, BuildingInfo>>;

	/** Get address + lat/lng for a batch of accounts. */
	getParcelInfoBatch(
		accountNos: string[]
	): Promise<Map<string, { address: string; city: string; lat: number; lng: number }>>;

	/** Get full sales history for a single account (for flip detection). */
	getSalesHistory(accountNo: string): Promise<SaleRecord[]>;
}
