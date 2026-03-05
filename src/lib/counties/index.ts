import type { CountyDataSource } from './types';
import { adams } from './adams';
import { boulder } from './boulder';
import { broomfield } from './broomfield';
import { denver } from './denver';
import { larimer } from './larimer';
import { mesa } from './mesa';
import { weld } from './weld';

export const counties: Record<string, CountyDataSource> = {
	adams,
	boulder,
	broomfield,
	denver,
	larimer,
	mesa,
	weld
};

export const countyList = Object.values(counties).map((c) => ({ id: c.id, name: c.name }));

export function getCounty(id: string): CountyDataSource {
	const county = counties[id];
	if (!county) throw new Error(`Unknown county: ${id}`);
	return county;
}
