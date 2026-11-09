/* [CHOCO-COMMODITY] data only: short commodity labels for car tags (LABELS-STATS-DIAG.md §8). Rule order: per-car field -> train sym rule -> industry+type -> type default.
   [UNVERIFIED] entries are guesses from the rev6h README prose; correct here. */
window.CHOCO_COMMODITY = {
  ind: { // industry: { type: [label, loadedWhen] }  loadedWhen: 'in' = arrives loaded, 'out' = leaves loaded
    CCF1: { gbrx: ['veg oil', 'in'] }, CCF2: { rf: ['frozen food', 'out'] }, TL: { coil: ['steel coil', 'in'], f68: ['pipe', 'in'] },
    PSR: { gon: ['scrap', 'out'] }, FF: { t51: ['soy meal', 'in'], g32: ['fertilizer', 'in'] }, NUT1: { at25: ['phos acid', 'out'] }, NUT2: { g32: ['phosphate', 'out'] },
    GCF: { hc: ['pulp', 'out'] }, WL: { f68: ['lumber', 'out'], hc: ['lumber', 'out'] }, PR: { tk: ['propane', 'in'] } },
  train: [ // [regex on sym, label or null (=type default), load]
    [/Q-stack/i, 'containers', 'loaded'], [/coal.*empties/i, 'coal', 'empty'], [/coal/i, 'coal', 'loaded'],
    [/ethanol.*empties/i, 'ethanol', 'empty'], [/ethanol/i, 'ethanol', 'loaded'], [/fertilizer|grain/i, 'fertilizer', 'loaded'] ],
  type: { coil: 'steel coil', gon: 'scrap', g32: 'fertilizer', h51: 'grain', t51: 'grain', gbrx: 'veg oil', at25: 'chemicals', tk: 'propane', rf: 'food', hc: 'paper',
    f68: 'lumber', c89: 'lumber', cb: 'lumber', ar: 'autos', well: 'containers', cp: 'coal', c60: 'general' /* [UNVERIFIED] */ },
  none: ['loco', 'caboose', 'amfleet']
};
