import { portrait } from './assets/manifest';
import { ELEMENTS } from './data/elements';
import { SPECIES } from './data/species';
import { ZONES, type Zone } from './data/zones';
import { createCreature, learnedSkills, statsOf } from './game/creature';
import { state, save, markCaught } from './game/state';
import type { Overworld } from './world/world';
import type { Hud } from './ui/hud';
import type { Battle } from './battle/battle';
import { el, uiRoot } from './ui/dom';
import { teamMenu, dexMenu, bagMenu, mapMenu } from './ui/menus';
import { openService } from './ui/services';
import type { Service } from './world/towns';

// URL-driven shortcuts used for automated screenshots and quick testing, e.g.
//   ?auto=world&pos=0,100&yaw=180     ?auto=battle&sp=gloop&lv=4     ?auto=boss&zone=vale
//   ?view=gallery                      ?auto=world&ui=service:hatchery   &autoplay (bot plays battles)

interface Api {
  startBattle: (list: { species: string; level: number; shiny: boolean }[], adv: 'player' | 'enemy' | null, wild: null) => Promise<void>;
  startBoss: (z: Zone) => Promise<void>;
  begin: (fresh: boolean, starter?: string) => Promise<void>;
}

type G = { world: Overworld; hud: Hud; battle: Battle | null; busy: boolean; started: boolean };

export async function runDebug(game: G, api: Api): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__renderer = (await import('./core/renderer')).renderer;
  w.__screens = await import('./ui/screens');
  const stateMod = await import('./game/state');
  Object.defineProperty(w, '__state', { get: () => stateMod.state, configurable: true });
  w.__creature = await import('./game/creature');
  w.__autoplay = q.has('autoplay');
  w.__autoCapture = q.has('autocap');
  w.__noDefend = q.has('nodefend');
  const auto = q.get('auto');
  const view = q.get('view');
  if (!auto && !view) return false;

  if (view === 'gallery') {
    const g = el('div', 'gallery');
    g.innerHTML = Object.values(SPECIES).map((s) => `<div class="gal" style="--el:${ELEMENTS[s.element].color}"><img src="${portrait(s.id)}" alt=""><b>${s.name}</b><small>${ELEMENTS[s.element].glyph} ${s.id}${s.boss ? ' · boss' : ''}</small></div>`).join('');
    uiRoot().appendChild(g);
    w.__ready = true;
    return true;
  }

  const fresh = q.has('fresh') || !state.started || !state.team.length;
  await api.begin(fresh, fresh ? q.get('starter') ?? 'emberling' : undefined);
  if (fresh) {
    for (const id of (q.get('team') ?? 'gloop,chirpling,pecklet').split(',').filter(Boolean)) {
      const c = createCreature(id, Number(q.get('tlv') ?? 6));
      state.team.push(c);
      markCaught(id);
    }
    const tlv = Number(q.get('tlv') ?? 6);
    for (const c of state.team) {
      c.level = Math.max(c.level, tlv);
      c.skills = learnedSkills(c.species, c.level);
      c.hp = statsOf(c).maxHp;
    }
    state.inv.gold = 2000;
    state.inv.elementum = { fire: 20, water: 20, nature: 20, earth: 20, storm: 20, wind: 20, void: 4 };
    save();
  }
  const pos = q.get('pos');
  if (pos) { const [x, z] = pos.split(',').map(Number); game.world.teleport(x, z); }
  const yaw = q.get('yaw');
  if (yaw) { game.world.camYaw = (Number(yaw) * Math.PI) / 180; }
  const pitch = q.get('pitch');
  if (pitch) game.world.camPitch = (Number(pitch) * Math.PI) / 180;
  const dist = q.get('dist');
  if (dist) game.world.camDist = Number(dist);
  game.world.snapCamera();
  w.__ready = true;

  if (auto === 'battle') {
    const sp = (q.get('sp') ?? 'gloop').split(',');
    void api.startBattle(sp.map((s) => ({ species: s, level: Number(q.get('lv') ?? 4), shiny: q.has('shiny') })), (q.get('adv') as 'player' | 'enemy' | null) ?? null, null);
  }
  if (auto === 'boss') {
    const z = ZONES.find((zz) => zz.id === (q.get('zone') ?? 'vale'))!;
    void api.startBoss(z);
  }
  if (q.get('view') === 'chars' || q.has('chars')) {
    const { makeNpcRig, makePlayerRig } = await import('./assets/manifest');
    const W = game.world;
    const base = W.playerPos.clone();
    const rigs = [makePlayerRig(), makeNpcRig(0), makeNpcRig(1), makeNpcRig(2), makeNpcRig(3)].filter(Boolean);
    rigs.forEach((r, i) => {
      const x = base.x - 4 + i * 2, z = base.z - 6;
      r!.root.position.set(x, W.data.heightAt(x, z), z);
      r!.root.rotation.y = i % 2 ? Math.PI : 0;
      W.scene.add(r!.root);
    });
    W.camYaw = 0; W.camPitch = 0.2; W.camDist = 12; W.snapCamera();
  }
  const ui = q.get('ui');
  if (ui) {
    game.busy = true;
    const hooks = { evolve: async () => {} };
    if (ui === 'team') void teamMenu(hooks);
    if (ui === 'box') void teamMenu(hooks, true);
    if (ui === 'dex') void dexMenu();
    if (ui === 'bag') void bagMenu();
    if (ui === 'map') void mapMenu(game.hud.minimap);
    if (ui.startsWith('service:')) void openService(ui.split(':')[1] as Service, game.world.zone, hooks);
  }
  return true;
}
