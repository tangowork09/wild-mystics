// Shops: an Outfitter in each of the nine towns, one specialty shop per town and Pell, the
// traveling merchant, who sets up in a different town every day with rotating rare stock.
// Logic (prices, tiers, stock, buy/sell) lives in src/game/shop.ts.
//
// Goods ids: plain ItemId (`tonic`), `orb:<OrbId>`, `relic:<relicId>`.
// Tier: stock unlocks with story progress (see TIER_SIGILS).

export interface StockRow {
  good: string;
  /** Story tier needed (0 = from the start). */
  tier?: number;
  /** Units per day (undefined = unlimited). */
  stock?: number;
  /** Override the catalogue price. */
  price?: number;
  tag?: string;
}

export interface ShopDef {
  id: string;
  name: string;
  kind: 'outfitter' | 'specialty' | 'merchant';
  /** Land (zone id) whose town hosts the shop. The merchant's is decided daily. */
  region: string;
  /** Keeper NPC id (portrait + name). */
  keeper: string;
  greeting: string;
  stock: StockRow[];
}

/** Guardian sigils needed for each stock tier (tier 5 = the Crown answered). */
export const TIER_SIGILS = [0, 1, 3, 5, 7, 9];
export const TIER_LOCK_TEXT = ['', 'Unlocks after your first Guardian sigil', 'Unlocks with 3 Guardian sigils', 'Unlocks with 5 Guardian sigils', 'Unlocks with 7 Guardian sigils', 'Unlocks once the Crown is answered'];

const R = (good: string, tier = 0, extra: Partial<StockRow> = {}): StockRow => ({ good, tier, ...extra });

/** What every Outfitter stocks. */
const OUTFITTER_BASE: StockRow[] = [
  R('orb:mystic'), R('orb:radiant'), R('orb:grand', 2), R('orb:sovereign', 4),
  R('tonic'), R('super_tonic', 1), R('mega_tonic', 2), R('elixir', 1), R('phoenix_ash', 3),
  R('ether', 1), R('hyper_ether', 3),
  R('cleanse'), R('antidote'), R('burn_salve'), R('wake_bell', 1), R('thaw_drop', 1), R('spark_balm', 1),
  R('ward_incense'), R('lure_incense'), R('escape_shard'),
];

const outfitter = (id: string, region: string, keeper: string, town: string, greeting: string, extra: StockRow[]): ShopDef =>
  ({ id, name: `${town} Outfitter`, kind: 'outfitter', region, keeper, greeting, stock: [...OUTFITTER_BASE, ...extra] });

export const SHOPS: ShopDef[] = [
  // ── Outfitters ──
  outfitter('hearthwick_outfitter', 'vale', 'tobias_outfitter', 'Hearthwick', 'Welcome, welcome! Orbs, tonics, and a hat that would really suit you.', [R('leaf_stone', 1)]),
  outfitter('stillwater_outfitter', 'lakes', 'sten_outfitter', 'Stillwater', 'Mind the puddle. Everything’s dry on the shelves, I promise.', [R('orb:tide'), R('water_stone', 1)]),
  outfitter('tidewatch_outfitter', 'coast', 'nell_outfitter', 'Tidewatch', 'Salt gets into everything. Even the prices. Especially the prices.', [R('orb:tide'), R('water_stone', 1), R('earth_stone', 2)]),
  outfitter('mirehaven_outfitter', 'marsh', 'grell_outfitter', 'Mirehaven', 'Dry socks cost extra. Everything else is fair.', [R('orb:dusk'), R('void_stone', 2)]),
  outfitter('cinderrest_outfitter', 'scar', 'brann_outfitter', 'Cinderrest', 'Everything’s fireproof. Probably.', [R('orb:ember'), R('fire_stone', 1), R('earth_stone', 1)]),
  outfitter('elderhollow_outfitter', 'elder', 'lark_outfitter', 'Elderhollow', 'Sustainably foraged. Mostly by Mystics.', [R('orb:dusk'), R('leaf_stone', 1), R('clarity_mint', 2)]),
  outfitter('sunreach_outfitter', 'dunes', 'omar_outfitter', 'Sunreach', 'Sand in the orbs is free of charge.', [R('orb:ember'), R('earth_stone', 1), R('wind_stone', 2)]),
  outfitter('skyhold_outfitter', 'peaks', 'sigrid_outfitter', 'Skyhold', 'Cold-rated, all of it. Except me. I’m cold.', [R('orb:tide'), R('thunder_stone', 1), R('wind_stone', 1), R('clarity_mint', 2)]),
  outfitter('glimmerhold_outfitter', 'hollows', 'dex_outfitter', 'Glimmerhold', 'Crystal-lit and fairly priced. Mostly crystal-lit.', [R('orb:tide'), R('thunder_stone', 1), R('clarity_mint', 2)]),

  // ── Specialty shops ──
  { id: 'hearthwick_bakery', name: 'Bramble’s Bakery', kind: 'specialty', region: 'vale', keeper: 'bramble_baker',
    greeting: 'Honey cakes for people, berry treats for Mystics. Don’t mix them up. Or do. I’m not your mother.',
    stock: [R('berry_treat'), R('honey_cake'), R('meadow_posy'), R('star_candy', 2, { stock: 3 })] },
  { id: 'stillwater_bait', name: 'Old Bo’s Bait & Stones', kind: 'specialty', region: 'lakes', keeper: 'angler_bo',
    greeting: 'Worms for the patient, glow bait for the impatient, Water Stones for the ambitious.',
    stock: [R('worm_bait'), R('glow_bait'), R('water_stone'), R('orb:tide'), R('tide_charm', 1, { tag: 'Rare' })] },
  { id: 'tidewatch_charms', name: 'Coral’s Tide Charms', kind: 'specialty', region: 'coast', keeper: 'charm_coral',
    greeting: 'Every charm here has a little sea inside it. Hold one to your ear.',
    stock: [R('tide_charm', 0, { tag: 'Rare' }), R('sea_glass'), R('orb:tide'), R('relic:tide_pearl', 1), R('relic:zephyr_plume', 2), R('relic:dawn_bell', 3)] },
  { id: 'mirehaven_apothecary', name: 'Moth’s Apothecary', kind: 'specialty', region: 'marsh', keeper: 'apothecary_moth',
    greeting: 'Dusk Orbs and cures. The marsh gives, the marsh takes, I sell the difference.',
    stock: [R('orb:dusk'), R('cleanse'), R('antidote'), R('burn_salve'), R('wake_bell'), R('thaw_drop'), R('spark_balm'), R('clarity_mint'), R('marsh_tea'), R('moon_lily'), R('relic:venom_ring', 3)] },
  { id: 'cinderrest_forge', name: 'Oskar’s Relic Forge', kind: 'specialty', region: 'scar', keeper: 'relicsmith_oskar',
    greeting: 'Fire Stones and forge relics. No refunds. No refunds on fire.',
    stock: [R('fire_stone'), R('earth_stone'), R('ember_pepper'), R('relic:warrior_band'), R('relic:iron_carapace'), R('relic:ember_charm', 1), R('relic:keen_monocle', 2), R('relic:hammer_totem', 2), R('relic:cinder_brand', 3)] },
  { id: 'elderhollow_florist', name: 'Briar’s Florist', kind: 'specialty', region: 'elder', keeper: 'florist_briar',
    greeting: 'Leaf Stones, hatch charms, and flowers that remember your name.',
    stock: [R('leaf_stone'), R('hatch_charm', 0, { tag: 'Rare' }), R('moon_lily'), R('meadow_posy'), R('lure_incense'), R('berry_treat'), R('relic:verdant_seed', 2), R('relic:bramble_mail', 3)] },
  { id: 'sunreach_gear', name: 'Zaid’s Desert Outfitters', kind: 'specialty', region: 'dunes', keeper: 'gearsmith_zaid',
    greeting: 'Thunder Stones and desert gear. The dowsing rod twitches near secrets. So do I.',
    stock: [R('thunder_stone'), R('earth_stone'), R('oasis_water'), R('desert_rose'), R('dowsing_rod', 0, { tag: 'Rare' }), R('nomad_cloak', 4, { tag: 'Rare' }), R('relic:swift_boots'), R('relic:wind_step', 3)] },
  { id: 'skyhold_quarter', name: 'Eira’s Quartermaster', kind: 'specialty', region: 'peaks', keeper: 'quartermaster_eira',
    greeting: 'The best gear on the island, for Wayfarers who’ve earned it.',
    stock: [R('orb:grand'), R('orb:sovereign', 4), R('phoenix_ash'), R('hyper_ether'), R('explorer_lantern', 0, { tag: 'Rare' }), R('shimmer_incense'), R('wisdom_scroll'), R('wind_stone'), R('snow_bloom'), R('relic:storm_feather', 4), R('relic:aegis_locket', 5)] },
  { id: 'glimmerhold_jeweler', name: 'Opal’s Jewellery', kind: 'specialty', region: 'hollows', keeper: 'jeweler_opal',
    greeting: 'Every gem is a little piece of the mountain’s patience. Priced accordingly.',
    stock: [R('orb:grand'), R('orb:sovereign', 4), R('star_candy'), R('wisdom_scroll'), R('void_stone'), R('thunder_stone'), R('geode_candy'), R('relic:burst_prism', 4), R('relic:maestro_baton', 4), R('relic:umbral_shard', 4), R('relic:vampire_fang', 5)] },

  // ── Pell, the traveling merchant (stock drawn daily from MERCHANT_POOL) ──
  { id: 'merchant', name: 'Pell’s Wandering Wagon', kind: 'merchant', region: 'vale', keeper: 'merchant_pell',
    greeting: 'Rare goods for rare folk! Here today, somewhere else tomorrow!', stock: [] },
];

/** Pell's rare pool. Each day four rows are drawn (tier-gated) with limited stock. */
export const MERCHANT_POOL: StockRow[] = [
  R('shimmer_incense', 0, { stock: 2 }), R('wisdom_scroll', 0, { stock: 3 }), R('star_candy', 0, { stock: 3 }), R('hatch_charm', 0, { stock: 1 }),
  R('explorer_lantern', 0, { stock: 1 }), R('dowsing_rod', 1, { stock: 1 }), R('phoenix_ash', 1, { stock: 3 }), R('void_stone', 1, { stock: 2 }),
  R('orb:grand', 1, { stock: 5 }), R('orb:sovereign', 3, { stock: 2 }), R('glow_bait', 0, { stock: 5 }), R('nomad_cloak', 3, { stock: 1 }),
  R('relic:binders_knot', 1, { stock: 1 }), R('relic:scholar_lens', 0, { stock: 1 }), R('relic:bramble_mail', 2, { stock: 1 }),
  R('relic:vampire_fang', 3, { stock: 1 }), R('relic:frost_talisman', 4, { stock: 1 }), R('relic:phoenix_plume', 4, { stock: 1 }),
];

/** Relic prices by rarity (relics aren't in the item catalogue). */
export const RELIC_PRICE: Record<string, number> = { common: 700, rare: 1800, epic: 4200, exotic: 9000, legendary: 0 };

export const shopById = (id: string) => SHOPS.find((s) => s.id === id);
export const outfitterFor = (region: string) => SHOPS.find((s) => s.kind === 'outfitter' && s.region === region);
export const specialtyFor = (region: string) => SHOPS.find((s) => s.kind === 'specialty' && s.region === region);
