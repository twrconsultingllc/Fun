// Every dollar figure in the sample datasets is a human-readable string like
// "100,000 (sample only)" or "50,000-500,000 (sample range only)" — these
// two parsers pull the numbers back out so gap-analysis tools can compare
// them, without pretending the annotation isn't part of the sample data.

export function parseUsd(value) {
  if (value == null) return null;
  const match = String(value).match(/[\d,]+/);
  if (!match) return null;
  return Number(match[0].replace(/,/g, ""));
}

export function parseUsdRange(value) {
  if (value == null) return null;
  const matches = String(value).match(/[\d,]+/g);
  if (!matches || matches.length < 2) return null;
  const [min, max] = matches.slice(0, 2).map((m) => Number(m.replace(/,/g, "")));
  return { min, max };
}

export function computeGap({ netWorthUsd, suretyBondPostedUsd, stateRequirements }) {
  const netWorthRequiredUsd = parseUsd(stateRequirements.netWorthRequirementUsd);
  const suretyBondRangeUsd = parseUsdRange(stateRequirements.suretyBondRangeUsd);

  const netWorthMeetsRequirement =
    netWorthRequiredUsd == null ? null : netWorthUsd >= netWorthRequiredUsd;

  const posted = suretyBondPostedUsd != null;
  const suretyBondMeetsMinimum = !posted
    ? false
    : suretyBondRangeUsd == null
      ? null
      : suretyBondPostedUsd >= suretyBondRangeUsd.min;

  return {
    netWorth: {
      actualUsd: netWorthUsd,
      requiredUsd: netWorthRequiredUsd,
      meetsRequirement: netWorthMeetsRequirement,
    },
    suretyBond: {
      postedUsd: suretyBondPostedUsd ?? null,
      rangeUsd: suretyBondRangeUsd,
      posted,
      meetsMinimum: suretyBondMeetsMinimum,
    },
    hasGap: netWorthMeetsRequirement === false || suretyBondMeetsMinimum === false,
  };
}
