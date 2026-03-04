import type { PropertyData, CompProperty, InvestmentParams, BuildingInfo } from '$lib/types';
import { formatCurrency, formatNumber } from '$lib/utils';

function formatBaths(b: BuildingInfo): string {
	const parts: string[] = [];
	if (b.fullBaths) parts.push(`${b.fullBaths} full`);
	if (b.threeQtrBaths) parts.push(`${b.threeQtrBaths} three-quarter`);
	if (b.halfBaths) parts.push(`${b.halfBaths} half`);
	return parts.length > 0 ? parts.join(', ') : '0';
}

export function buildPrompt(
	subject: PropertyData,
	comps: CompProperty[],
	params: InvestmentParams,
	countyName: string = 'Boulder County'
): string {
	const sections: string[] = [];

	// System instruction
	sections.push(`You are an expert real estate investment analyst specializing in the ${countyName}, Colorado market. You have deep knowledge of local neighborhoods, property values, renovation costs, and market trends.

Analyze the following property deal using the comparable sales data provided. Show all math. Do not invent data — only use what's provided. If data is insufficient, say so.`);

	// Investment parameters
	sections.push(buildInvestmentSection(params));

	// Subject property
	sections.push(buildSubjectSection(subject));

	// Analysis instructions
	sections.push(buildAnalysisInstructions(params));

	// Comparable sales
	sections.push(buildCompsSection(comps, subject));

	// Comp summary stats
	sections.push(buildCompStats(comps));

	// Rules
	sections.push(buildRules(countyName));

	return sections.join('\n\n---\n\n');
}

function buildInvestmentSection(params: InvestmentParams): string {
	const lines = [`## Investment Parameters`, `- **Strategy:** ${params.strategy.toUpperCase()}`];

	if (params.strategy === 'flip') {
		lines.push(`- **Rehab Quality:** ${params.rehabQuality ?? 'standard'}`);
	} else if (params.strategy === 'rental') {
		if (params.monthlyRent) lines.push(`- **Expected Monthly Rent:** ${formatCurrency(params.monthlyRent)}`);
		if (params.downPaymentPct != null) lines.push(`- **Down Payment:** ${params.downPaymentPct}%`);
		if (params.interestRate != null) lines.push(`- **Interest Rate:** ${params.interestRate}%`);
		lines.push(`- **Property Management:** ${params.propertyMgmt ? 'Yes (budget 8-10%)' : 'Self-managed'}`);
	} else if (params.strategy === 'wholesale') {
		if (params.assignmentFee) lines.push(`- **Target Assignment Fee:** ${formatCurrency(params.assignmentFee)}`);
	}

	if (params.additionalContext) {
		lines.push(`\n**Additional Context from Investor:**\n${params.additionalContext}`);
	}

	return lines.join('\n');
}

function buildSubjectSection(subject: PropertyData): string {
	const lines = [
		`## Subject Property`,
		`- **Address:** ${subject.address}, ${subject.city}`,
		`- **Account:** ${subject.accountNo}`,
		`- **Neighborhood:** ${subject.neighborhood}`,
		`- **Lot Size:** ${subject.lotAcres} acres`
	];

	if (subject.building) {
		const b = subject.building;
		const bathStr = formatBaths(b);
		lines.push(
			`- **Beds:** ${b.beds}`,
			`- **Baths:** ${bathStr}`,
			`- **Finished Sqft:** ${formatNumber(b.sqft)}`,
			`- **Year Built:** ${b.yearBuilt}`,
			`- **Design:** ${b.design}`,
			`- **Class:** ${b.classDescription}`
		);
	}

	if (subject.areas.length > 0) {
		lines.push(`\n**Area Breakdown:**`);
		for (const area of subject.areas) {
			lines.push(`  - ${area.description}: ${formatNumber(area.sqft)} sqft`);
		}
	}

	if (subject.values) {
		lines.push(
			`\n**Assessed Values (${subject.values.assessmentYear}):**`,
			`  - Total Actual: ${formatCurrency(subject.values.totalActual)}`,
			`  - Land: ${formatCurrency(subject.values.landActual)}`,
			`  - Improvements: ${formatCurrency(subject.values.improvementActual)}`,
			`  - Total Assessed: ${formatCurrency(subject.values.totalAssessed)}`
		);
	}

	if (subject.sales.length > 0) {
		lines.push(`\n**Sale History:**`);
		for (const sale of subject.sales) {
			lines.push(
				`  - ${sale.date}: ${formatCurrency(sale.price)} (${sale.deedType})`
			);
		}
	}

	return lines.join('\n');
}

function buildAnalysisInstructions(params: InvestmentParams): string {
	const steps = [
		`## Analysis Steps — Please Complete Each One`,
		``,
		`### 1. Comp Classification`,
		`For each comp, determine if it was a flip (bought and resold within 12 months) or a standard market sale. Identify any outliers.`,
		``,
		`### 2. Comp Adjustments`,
		`Adjust each comp's sale price for differences vs. the subject:`,
		`- Sqft difference (use local $/sqft)`,
		`- Bed/bath count difference`,
		`- Age/year built difference`,
		`- Condition/quality differences (if inferable)`,
		`- Lot size differences`,
		`- Distance/location premium or discount`,
		`Show the adjustment math for each comp.`,
		``,
		`### 3. ARV (After Repair Value)`,
		`Calculate the ARV using adjusted comp values. Weight more recent and closer comps higher. Do NOT average flip comps with standard comps — analyze separately.`,
		``
	];

	if (params.strategy === 'flip') {
		steps.push(
			`### 4. Rehab Cost Estimate`,
			`Based on the subject's condition, age, and sqft, estimate rehab costs for a ${params.rehabQuality ?? 'standard'} renovation:`,
			`- Light: $15-25/sqft (cosmetic — paint, flooring, fixtures)`,
			`- Standard: $30-50/sqft (kitchen/bath remodel, some systems)`,
			`- High-End: $60-100/sqft (full gut, high-end finishes)`,
			`Include line-item estimates for major categories.`,
			``,
			`### 5. Deal Analysis`,
			`- ARV`,
			`- Minus rehab costs`,
			`- Minus holding costs (6 months: taxes, insurance, utilities, loan interest)`,
			`- Minus selling costs (6% agent commissions + 1.5% closing)`,
			`- Minus profit margin (minimum 15% of ARV for flips)`,
			`- = Maximum purchase price`,
			`- Show purchase price as % of ARV (target: 65-75% for standard rehab)`,
			``
		);
	} else if (params.strategy === 'rental') {
		steps.push(
			`### 4. Rental Analysis`,
			`- Monthly rent estimate${params.monthlyRent ? ` (investor target: ${formatCurrency(params.monthlyRent)})` : ''}`,
			`- Annual gross income`,
			`- Operating expenses (taxes, insurance, maintenance ~1-2% of value, vacancy ~5%, ${params.propertyMgmt ? 'property management 8-10%' : 'self-managed'})`,
			`- NOI (Net Operating Income)`,
			`- Cap rate at various purchase prices`,
			`${params.downPaymentPct != null ? `- Cash flow analysis at ${params.downPaymentPct}% down, ${params.interestRate}% rate, 30yr` : ''}`,
			`- Cash-on-cash return`,
			`- 1% rule check (monthly rent >= 1% of purchase price)`,
			``
		);
	} else if (params.strategy === 'wholesale') {
		steps.push(
			`### 4. Wholesale Analysis`,
			`- ARV from comps`,
			`- Estimate end-buyer's required discount (investor wants 70-75% of ARV minus rehab)`,
			`- Estimated rehab for end buyer`,
			`- Maximum Allowable Offer (MAO) = ARV × 70% - rehab costs`,
			`- Your contract price = MAO - assignment fee${params.assignmentFee ? ` (target: ${formatCurrency(params.assignmentFee)})` : ''}`,
			``
		);
	}

	steps.push(
		`### ${params.strategy === 'flip' ? '6' : '5'}. Final Recommendation`,
		`- Summarize: is this a good deal at the likely asking price?`,
		`- Key risks and considerations`,
		`- Suggested offer range with rationale`,
		`- Confidence level (High/Medium/Low) and what additional info would increase confidence`
	);

	return steps.join('\n');
}

function buildCompsSection(comps: CompProperty[], subject: PropertyData): string {
	if (comps.length === 0) return '## Comparable Sales\n\nNo comparable sales found within the search radius.';

	const lines = [`## Comparable Sales (${comps.length} found)`];

	comps.forEach((comp, i) => {
		lines.push(`\n### Comp ${i + 1}: ${comp.address}, ${comp.city}`);
		lines.push(`- **Account:** ${comp.accountNo}`);
		lines.push(`- **Distance:** ${comp.distance} mi from subject`);

		if (comp.building) {
			const b = comp.building;
			const bathStr = formatBaths(b);
			lines.push(
				`- **Beds:** ${b.beds}`,
				`- **Baths:** ${bathStr}`,
				`- **Sqft:** ${formatNumber(b.sqft)}${subject.building?.sqft ? ` (${b.sqft > subject.building.sqft ? '+' : ''}${formatNumber(b.sqft - subject.building.sqft)} vs subject)` : ''}`,
				`- **Year Built:** ${b.yearBuilt}`,
				`- **Design:** ${b.design}`
			);
			if (b.sqft > 0 && comp.sales.length > 0 && comp.sales[0].price > 0) {
				lines.push(
					`- **$/Sqft:** ${formatCurrency(Math.round(comp.sales[0].price / b.sqft))}`
				);
			}
		}

		if (comp.sales.length > 0) {
			lines.push(`\n  **Sale History:**`);
			for (const sale of comp.sales) {
				lines.push(
					`  - ${sale.date}: ${formatCurrency(sale.price)} (${sale.deedType})`
				);
			}
			// Flag potential flips
			if (comp.sales.length >= 2) {
				const recent = new Date(comp.sales[0].date);
				const prior = new Date(comp.sales[1].date);
				const monthsBetween =
					(recent.getTime() - prior.getTime()) / (1000 * 60 * 60 * 24 * 30);
				if (monthsBetween <= 12 && comp.sales[0].price > comp.sales[1].price) {
					const appreciation = Math.round(
						((comp.sales[0].price - comp.sales[1].price) / comp.sales[1].price) * 100
					);
					lines.push(
						`  ⚠️ **POTENTIAL FLIP** — resold within ${Math.round(monthsBetween)} months with ${appreciation}% price increase`
					);
				}
			}
		}
	});

	return lines.join('\n');
}

function buildCompStats(comps: CompProperty[]): string {
	const salesPrices = comps
		.map((c) => c.sales[0]?.price)
		.filter((p): p is number => p != null && p > 0);

	if (salesPrices.length === 0) return '';

	const sorted = [...salesPrices].sort((a, b) => a - b);
	const medianPrice =
		sorted.length % 2 !== 0
			? sorted[Math.floor(sorted.length / 2)]
			: (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

	const pricesPerSqft = comps
		.filter((c) => c.building?.sqft && c.sales[0]?.price)
		.map((c) => c.sales[0].price / c.building!.sqft);

	const avgPricePerSqft =
		pricesPerSqft.length > 0
			? Math.round(pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length)
			: 0;

	return [
		`## Comp Summary Statistics`,
		`- **Comp Count:** ${comps.length}`,
		`- **Median Sale Price:** ${formatCurrency(medianPrice)}`,
		`- **Price Range:** ${formatCurrency(sorted[0])} — ${formatCurrency(sorted[sorted.length - 1])}`,
		avgPricePerSqft > 0 ? `- **Avg Price/Sqft:** ${formatCurrency(avgPricePerSqft)}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

function buildRules(countyName: string): string {
	return `## Rules
- Show all math — every adjustment, every calculation
- Do NOT average flip comps with standard market comps — analyze them separately and note the difference
- Do NOT invent data — if information is missing, state what you'd need
- Use ${countyName} market knowledge for contextual insights (school districts, flood zones, development trends)
- Be specific about location quality — is the comp in a comparable sub-market?
- Flag any red flags (title issues, non-arm's-length transactions, unusual deed types)
- Provide conservative, moderate, and aggressive scenarios where appropriate`;
}
