// 源适配器注册表：新增同类比价站点 = 在 sources/ 加一个适配器文件并在此登记。
import * as priceai from "./priceai.mjs";
import * as ldxp from "./ldxp.mjs";
import * as cardnav from "./cardnav.mjs";
import * as directShops from "./direct-shops.mjs";

export const registry = {
  [priceai.sourceId]: {
    label: priceai.sourceLabel,
    pull: priceai.pull,
    sourceId: priceai.sourceId,
  },
  [ldxp.sourceId]: {
    label: ldxp.sourceLabel,
    pull: ldxp.pull,
    sourceId: ldxp.sourceId,
  },
  [cardnav.sourceId]: {
    label: cardnav.sourceLabel,
    pull: cardnav.pull,
    sourceId: cardnav.sourceId,
  },
  [directShops.sourceId]: {
    label: directShops.sourceLabel,
    pull: directShops.pull,
    sourceId: directShops.sourceId,
  },
};

export function listSources() {
  return Object.entries(registry).map(([id, def]) => ({ id, ...def }));
}
