import type { CountyDataSource } from './types';
import { boulder } from './boulder';
import { larimer } from './larimer';
import { weld } from './weld';

export const counties: Record<string, CountyDataSource> = {
	boulder,
	larimer,
	weld
};

export const countyList = Object.values(counties).map((c) => ({ id: c.id, name: c.name }));

export function getCounty(id: string): CountyDataSource {
	const county = counties[id];
	if (!county) throw new Error(`Unknown county: ${id}`);
	return county;
}
