// ArcGIS raw response types
export interface ArcGISResponse<T = Record<string, unknown>> {
	features: ArcGISFeature<T>[];
	exceededTransferLimit?: boolean;
}

export interface ArcGISFeature<T = Record<string, unknown>> {
	attributes: T;
	geometry?: {
		x: number;
		y: number;
		rings?: number[][][];
	};
}

// ParcelPropertyView fields
export interface ParcelPropertyAttrs {
	AccountNo: string;
	PropertyAddress: string;
	city: string;
	NbhdCode: number;
	NbhdDscr: string;
	EstLandAcres: number;
	Latitude: string;
	Longitude: string;
	OwnerName: string;
	LegalDscr: string;
}

// Building Attributes fields
export interface BuildingAttrs {
	AccountNo: string;
	Bedrooms: number;
	FullBaths: number;
	HalfBaths: number;
	ThreeQtrBaths: number;
	FinishedSqft: number;
	YearBuilt: number;
	DesignDscr: string;
	ClassCodeDscr: string;
	BuildingNumber: number;
}

// Building Area fields
export interface BuildingAreaAttrs {
	AccountNo: string;
	AreaDscr: string;
	AreaSqft: number;
}

// Sales fields
export interface SalesAttrs {
	AccountNo: string;
	SaleDate: number; // Unix ms
	SalePrice: number;
	DeedType: string;
	DeedReceptionNo: string;
}

// Values fields
export interface ValuesAttrs {
	AccountNo: string;
	TotalActualValue: number;
	TotalAssessedValue: number;
	LandActualValue: number;
	BldgActualValue: number;
	TaxYear: number;
}

// Parcels Owner fields (for spatial queries)
export interface ParcelsOwnerAttrs {
	AccountNo: string;
	Owner: string;
}

// App domain types
export interface PropertyData {
	accountNo: string;
	address: string;
	city: string;
	neighborhood: string;
	lat: number;
	lng: number;
	lotAcres: number;
	ownerName: string;
	building: BuildingInfo | null;
	areas: AreaInfo[];
	sales: SaleRecord[];
	values: ValueRecord | null;
}

export interface BuildingInfo {
	beds: number;
	fullBaths: number;
	halfBaths: number;
	threeQtrBaths: number;
	sqft: number;
	yearBuilt: number;
	design: string;
	classDescription: string;
}

export interface AreaInfo {
	description: string;
	sqft: number;
}

export interface SaleRecord {
	date: string; // ISO date string
	price: number;
	deedType: string;
	receptionNo: string;
}

export interface ValueRecord {
	totalActual: number;
	totalAssessed: number;
	landActual: number;
	improvementActual: number;
	assessmentYear: number;
}

export interface SearchResult {
	accountNo: string;
	address: string;
	city: string;
	neighborhood: string;
}

export type InvestmentStrategy = 'flip' | 'rental' | 'wholesale';

export interface InvestmentParams {
	strategy: InvestmentStrategy;
	rehabQuality?: 'light' | 'standard' | 'high-end';
	monthlyRent?: number;
	downPaymentPct?: number;
	interestRate?: number;
	propertyMgmt?: boolean;
	assignmentFee?: number;
	additionalContext?: string;
	compRadius: number; // miles
}

export interface CompProperty {
	accountNo: string;
	address: string;
	city: string;
	distance: number; // miles
	building: BuildingInfo | null;
	sales: SaleRecord[];
	score: number;
}

export interface AnalysisResult {
	subject: PropertyData;
	comps: CompProperty[];
	prompt: string;
	compStats: {
		medianPrice: number;
		avgPricePerSqft: number;
		count: number;
	};
}
