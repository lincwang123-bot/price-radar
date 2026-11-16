// "可覆盖 plus" describes an extra capability. It is not the Plus plan.
export function plusCoverageOnly(titleText) {
  titleText = titleText.toLowerCase();
  const stripped = titleText.replace(/(?:可|能|支持|已经|已)?\s*(?:覆盖|覆蓋)(?:到|至)?\s*plus|兼容\s*plus/g, " ");
  return /plus/.test(titleText) && !/plus/.test(stripped);
}

