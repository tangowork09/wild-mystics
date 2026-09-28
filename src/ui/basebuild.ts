// Homestead UI: build mode (palette → ghost placement → confirm), structure panels
// (collect / upgrade / move / demolish + per-type actions) and the homestead overview.
import * as THREE from 'three';
import { renderer } from '../core/renderer';
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { input } from '../core/input';
import { STRUCTURES, structureDef, type StructureCategory, type StructureDef } from '../data/structures';
import { MATERIALS, ORBS, ITEMS, type MaterialId } from '../data/items';
import { state, healAll, type BaseStructure } from '../game/state';
import {
  build, move, demolish, upgrade, pending, collect, collectAll, buildReason, costOf, canPay, builtCount,
  habitatSlots, residents, assign, unassign, train, trainCost, RECIPES, craft, sell, SELL_PRICES,
} from '../game/base';
import { displayName, statsOf, xpToNext } from '../game/creature';
import type { Overworld } from '../world/world';
import { modal, toast, confirmBox, el, uiRoot } from './dom';
import { bar, costList, esc, mysticFace } from './kit';
import { icon } from './icons';
import { pickCreature } from './pickers';
import type { JournalTab } from './journal';

export interface BuildHooks {
  world: Overworld;
  openJournal(tab: JournalTab): Promise<void>;
  /** Save-state changed (refresh HUD etc.). */
  changed(): void;
}

const TYPE_ICON: Record<string, string> = {
  habitat: 'paw', lumber_mill: 'log_wood', quarry: 'rock', crystal_spire: 'crystal_cluster', garden: 'herb', windmill: 'wind',
  forge: 'anvil', training_hall: 'sword', healing_well: 'heart', watchtower: 'eye', market: 'coin',
  lamp: 'sun', fence: 'house_base', banner: 'flag', barrels: 'chest', statue: 'star',
};
const CATS: { id: StructureCategory; label: string; ic: string }[] = [
  { id: 'production', label: 'Production', ic: 'hammer_build' }, { id: 'mystics', label: 'Mystics', ic: 'paw' },
  { id: 'crafting', label: 'Crafting', ic: 'anvil' }, { id: 'decor', label: 'Decor', ic: 'flag' },
];
const RES_ICON: Record<string, string> = { gold: 'coin', aether: 'gem', wood: 'log_wood', stone: 'stone', ore: 'ore', crystal: 'crystal_cluster', fiber: 'fiber' };
const resList = (r: Partial<Record<string, number>>) => Object.entries(r).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `<span class="cost-i">${icon(RES_ICON[k] ?? 'gem')}${v}</span>`).join('') || '<span class="muted small">nothing yet</span>';

export class BaseBuilder {
  private ui: HTMLElement | null = null;
  private cat: StructureCategory = 'production';
  private placing: { def: StructureDef; uid?: string; rot: number; x: number; z: number; locked: boolean; reason: string | null } | null = null;
  private down: { x: number; y: number } | null = null;
  private keyH = (e: KeyboardEvent) => this.onKey(e);
  private pdH = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private puH = (e: PointerEvent) => this.onTap(e);

  constructor(private hooks: BuildHooks) {}

  get active() { return !!this.ui; }

  // ── build mode ──────────────────────────────────────────────────────────
  enter() {
    if (this.ui) return;
    const w = this.hooks.world;
    w.dismount();
    w.buildMode = true;
    this.ui = el('div', 'build-ui');
    uiRoot().appendChild(this.ui);
    addEventListener('keydown', this.keyH, true);
    renderer.domElement.addEventListener('pointerdown', this.pdH);
    renderer.domElement.addEventListener('pointerup', this.puH);
    sfx('open');
    this.drawPalette();
    requestAnimationFrame(() => this.ui?.classList.add('in'));
  }

  exit() {
    if (!this.ui) return;
    this.cancelPlacing();
    const w = this.hooks.world;
    w.buildMode = false;
    removeEventListener('keydown', this.keyH, true);
    renderer.domElement.removeEventListener('pointerdown', this.pdH);
    renderer.domElement.removeEventListener('pointerup', this.puH);
    const u = this.ui;
    this.ui = null;
    u.classList.remove('in');
    setTimeout(() => u.remove(), 260);
    sfx('back');
  }

  private drawPalette() {
    if (!this.ui) return;
    const list = STRUCTURES.filter((s) => s.category === this.cat);
    this.ui.className = 'build-ui in palette';
    this.ui.innerHTML = `<div class="bu-top"><div class="bu-title">${icon('hammer_build')}<div><b>Homestead · Build mode</b><small>Pick a structure, then place it inside the golden ring.</small></div></div>
        <div class="bu-mats">${(Object.keys(MATERIALS) as MaterialId[]).map((m) => `<span class="cost-i">${icon(RES_ICON[m])}${state.inv.materials[m]}</span>`).join('')}<span class="cost-i">${icon('coin')}${state.inv.gold.toLocaleString()}</span></div>
        <button class="btn primary" data-done>Done <kbd>Esc</kbd></button></div>
      <div class="bu-palette"><div class="chips">${CATS.map((c) => `<button class="chip ${this.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${icon(c.ic)} ${c.label}</button>`).join('')}</div>
        <div class="bu-cards">${list.map((d) => {
          const why = buildReason(d);
          return `<button class="bu-card ${why ? 'off' : ''}" data-type="${d.id}" title="${why ?? d.desc}"><span class="bu-ic">${icon(TYPE_ICON[d.id] ?? 'house_base')}</span><b>${d.name}</b><small>${d.desc}</small>
            ${d.produces ? `<em class="bu-prod">${resList(d.produces)}/h</em>` : ''}${costList(costOf(d))}<i class="bu-count">${builtCount(d.id)}/${d.max}</i>${why ? `<span class="bu-why">${why}</span>` : ''}</button>`;
        }).join('')}</div></div>`;
    this.ui.querySelector('[data-done]')!.addEventListener('click', () => this.exit());
    this.ui.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat as StructureCategory; sfx('select'); this.drawPalette(); }));
    this.ui.querySelectorAll<HTMLElement>('[data-type]').forEach((b) => b.addEventListener('click', () => {
      const d = structureDef(b.dataset.type!);
      const why = buildReason(d);
      if (why) { sfx('error'); toast(why, 'bad'); return; }
      this.startPlacing(d);
    }));
  }

  private startPlacing(def: StructureDef, uid?: string) {
    const s = uid ? state.base.structures.find((b) => b.uid === uid) : undefined;
    this.placing = { def, uid, rot: s?.rot ?? 0, x: s?.x ?? 0, z: s?.z ?? 0, locked: !!s, reason: null };
    this.hooks.world.homestead.startGhost(def.id);
    if (!this.ui) this.enter();
    this.drawPlacing();
    this.update();
    sfx('select');
  }

  private drawPlacing() {
    if (!this.ui || !this.placing) return;
    const p = this.placing;
    this.ui.className = 'build-ui in placing';
    this.ui.innerHTML = `<div class="bu-place"><span class="bu-ic">${icon(TYPE_ICON[p.def.id] ?? 'house_base')}</span><div class="bu-pt"><b>${p.uid ? 'Moving' : 'Placing'}: ${p.def.name}</b><small class="bu-reason"></small></div>
      <button class="btn" data-rot title="Rotate (R)">⟳ <span>Rotate</span></button>
      <button class="btn ghost" data-cancel>Cancel</button>
      <button class="btn primary" data-place>${p.uid ? 'Move here' : 'Build'} ${p.uid ? '' : costList(costOf(p.def))}</button></div>
      <p class="bu-hint">${input.isTouch ? 'Tap the ground to position · drag to look around' : 'Click the ground or walk to position · <kbd>R</kbd> rotate · <kbd>Enter</kbd> confirm · <kbd>Esc</kbd> cancel'}</p>`;
    this.ui.querySelector('[data-rot]')!.addEventListener('click', () => this.rotate());
    this.ui.querySelector('[data-cancel]')!.addEventListener('click', () => { this.cancelPlacing(); this.drawPalette(); });
    this.ui.querySelector('[data-place]')!.addEventListener('click', () => this.confirm());
  }

  private rotate() {
    if (!this.placing) return;
    this.placing.rot = (this.placing.rot + Math.PI / 4) % (Math.PI * 2);
    sfx('select');
    this.update();
  }

  private cancelPlacing() {
    if (!this.placing) return;
    this.placing = null;
    this.hooks.world.homestead.endGhost();
  }

  private confirm() {
    const p = this.placing;
    if (!p) return;
    if (p.reason) { sfx('error'); toast(p.reason, 'bad'); return; }
    if (p.uid) {
      if (!move(p.uid, p.x, p.z, p.rot)) { sfx('error'); return; }
      toast(`${p.def.name} moved.`);
    } else {
      const s = build(p.def.id, p.x, p.z, p.rot);
      if (!s) { sfx('error'); toast(buildReason(p.def) ?? 'Cannot build here.', 'bad'); return; }
      toast(`${p.def.name} built!`, 'good');
    }
    sfx('levelup');
    haptic('success');
    const again = !p.uid && !buildReason(p.def) && p.def.category === 'decor';
    this.cancelPlacing();
    this.hooks.world.homestead.sync();
    this.hooks.changed();
    if (again) this.startPlacing(p.def); else this.drawPalette();
  }

  private onKey(e: KeyboardEvent) {
    if (document.querySelector('.modal.in')) return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === 'escape') { if (this.placing) { this.cancelPlacing(); this.drawPalette(); } else this.exit(); }
    else if (this.placing && (k === 'r' || k === ']')) this.rotate();
    else if (this.placing && k === '[') { this.placing.rot = (this.placing.rot - Math.PI / 4 + Math.PI * 2) % (Math.PI * 2); this.update(); }
    else if (this.placing && k === 'enter') this.confirm();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  /** Tap (not drag) on the ground moves the ghost there. */
  private onTap(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (!this.placing || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
    const hit = this.pickGround(e.clientX, e.clientY);
    if (!hit) return;
    this.placing.x = hit.x;
    this.placing.z = hit.z;
    this.placing.locked = true;
    this.update();
  }

  private pickGround(cx: number, cy: number): THREE.Vector3 | null {
    const w = this.hooks.world;
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, w.camera);
    const p = ray.ray.origin.clone();
    const dir = ray.ray.direction;
    for (let t = 0; t < 260; t += 0.5) {
      p.copy(ray.ray.origin).addScaledVector(dir, t);
      if (p.y <= w.data.heightAt(p.x, p.z)) return p;
    }
    return null;
  }

  /** Per-frame: ghost follows the spot ahead of the player unless the player tapped a spot. */
  update() {
    const p = this.placing;
    if (!p) return;
    const w = this.hooks.world;
    if (!p.locked) {
      const ahead = p.def.radius + 4;
      p.x = w.playerPos.x - Math.sin(w.camYaw) * ahead;
      p.z = w.playerPos.z - Math.cos(w.camYaw) * ahead;
    }
    if (input.move.x || input.move.y) p.locked = false;
    p.x = Math.round(p.x * 2) / 2;
    p.z = Math.round(p.z * 2) / 2;
    const r = w.homestead.moveGhost(p.x, p.z, p.rot, p.uid);
    if (r && r.reason !== p.reason) {
      p.reason = r.reason;
      const box = this.ui?.querySelector('.bu-reason');
      if (box) box.textContent = r.reason ?? 'Looks good — confirm to place.';
      this.ui?.querySelector('[data-place]')?.toggleAttribute('disabled', !!r.reason);
    }
  }

  // ── panels ──────────────────────────────────────────────────────────────
  openOverview(): Promise<void> {
    return modal('structure homestead-ov', (b, close) => {
      const draw = () => {
        const list = state.base.structures;
        const prod = list.filter((s) => structureDef(s.type).produces);
        const total: Record<string, number> = {};
        for (const s of prod) for (const [k, v] of Object.entries(pending(s))) total[k] = (total[k] ?? 0) + (v ?? 0);
        b.innerHTML = `<div class="svc-head" style="--c:#6aa84a"><span class="svc-icon">${icon('house_base')}</span><div class="svc-t"><h2>Your Homestead</h2><small>${list.length} structures · production stockpiles up to 8 hours</small></div></div>
          ${list.length ? '' : `<p class="svc-say">“A fine plot of land. Timber and stone are all it takes to start — build a Lumber Mill and a Quarry first.”</p>`}
          <div class="ov-grid">${list.map((s) => {
            const d = structureDef(s.type);
            const pend = pending(s);
            const ready = Object.values(pend).some((v) => (v ?? 0) > 0);
            return `<button class="ov-s ${ready ? 'ready' : ''}" data-uid="${s.uid}"><span class="bu-ic">${icon(TYPE_ICON[s.type] ?? 'house_base')}</span><b>${d.name}</b><small>Lv ${s.level}${d.produces ? ` · ${resList(pend)}` : ''}</small></button>`;
          }).join('')}</div>
          <div class="row-center"><button class="btn gold" data-all ${Object.values(total).some((v) => v > 0) ? '' : 'disabled'}>${icon('gift')} Collect all ${resList(total)}</button>
          <button class="btn primary" data-build>${icon('hammer_build')} Build mode</button></div>`;
        b.querySelector('[data-all]')?.addEventListener('click', () => {
          const got = collectAll();
          sfx('coin');
          toast(`Collected ${resList(got)}`, 'loot');
          this.hooks.changed();
          draw();
        });
        b.querySelector('[data-build]')?.addEventListener('click', () => { close(); this.enter(); });
        b.querySelectorAll<HTMLElement>('[data-uid]').forEach((x) => x.addEventListener('click', () => { close(); void this.openStructure(x.dataset.uid!); }));
      };
      draw();
    });
  }

  openStructure(uid: string): Promise<void> {
    return modal('structure', (b, close) => {
      const draw = () => {
        const s = state.base.structures.find((x) => x.uid === uid);
        if (!s) { close(); return; }
        const d = structureDef(s.type);
        const up = s.level < d.maxLevel ? costOf(d, s.level + 1) : null;
        b.innerHTML = `<div class="svc-head" style="--c:#8a6a3a"><span class="svc-icon">${icon(TYPE_ICON[s.type] ?? 'house_base')}</span><div class="svc-t"><h2>${d.name}</h2><small>Level ${s.level}/${d.maxLevel} · ${d.desc}</small></div></div>
          <div class="st-body">${this.body(s, d)}</div>
          <div class="st-foot">
            ${up ? `<button class="btn ${canPay(up) ? 'primary' : ''}" data-up ${canPay(up) ? '' : 'disabled'}>${icon('hammer_build')} Upgrade to Lv ${s.level + 1} ${costList(up)}</button>` : ''}
            <button class="btn ghost" data-move>${icon('compass')} Move</button>
            <button class="btn danger" data-demo>Demolish</button></div>`;
        b.querySelector('[data-up]')?.addEventListener('click', () => {
          if (upgrade(uid)) { sfx('levelup'); haptic('success'); toast(`${d.name} upgraded to level ${s.level}!`, 'good'); this.hooks.world.homestead.sync(); this.hooks.changed(); } else sfx('error');
          draw();
        });
        b.querySelector('[data-move]')?.addEventListener('click', () => { close(); this.startPlacing(d, uid); });
        b.querySelector('[data-demo]')?.addEventListener('click', async () => {
          if (!(await confirmBox(`Demolish ${d.name}?`, 'You get back half of the base build cost. Residents return to storage.', 'Demolish', true))) return;
          demolish(uid);
          this.hooks.world.homestead.sync();
          this.hooks.changed();
          sfx('break');
          close();
        });
        this.wire(b, s, d, draw);
      };
      draw();
    });
  }

  private body(s: BaseStructure, d: StructureDef): string {
    const parts: string[] = [];
    if (d.produces) {
      const pend = pending(s);
      const lvl = 1 + (s.level - 1) * 0.6;
      const rate = Object.fromEntries(Object.entries(d.produces).map(([k, v]) => [k, Math.round((v ?? 0) * lvl)]));
      parts.push(`<div class="st-prod"><div><small>Producing per hour</small>${resList(rate)}</div><div><small>Ready to collect</small>${resList(pend)}</div>
        <button class="btn gold" data-collect ${Object.values(pend).some((v) => (v ?? 0) > 0) ? '' : 'disabled'}>Collect</button></div>`);
    }
    switch (s.type) {
      case 'habitat': {
        const res = residents(s);
        const slots = habitatSlots(s);
        parts.push(`<div class="sec-h">${icon('paw')}<span>Residents</span><small>${res.length}/${slots} · residents gain XP over time (collect to apply)</small></div>
          <div class="res-list">${res.map((c) => `<div class="res">${mysticFace(c.species, c.shiny, 52)}<b>${esc(displayName(c))}</b><small>Lv ${c.level}</small><button class="btn tiny ghost" data-unassign="${c.uid}">Remove</button></div>`).join('')}
          ${res.length < slots ? `<button class="res add" data-assign><span class="plus">+</span><small>Add from storage</small></button>` : ''}</div>`);
        parts.push(`<div class="row-center"><button class="btn gold" data-collect-xp>${icon('sparkles')} Gather resident XP</button></div>`);
        break;
      }
      case 'forge':
        parts.push(`<div class="sec-h">${icon('anvil')}<span>Crafting</span></div><div class="recipes">${RECIPES.map((r, i) => {
          const art = r.out.orb ? `<span class="orbdot" style="background:radial-gradient(circle at 35% 30%, #fff, ${ORBS[r.out.orb].color} 45%, #1a1020)"></span>` : icon(ITEMS[r.out.item as keyof typeof ITEMS]?.icon ?? 'potion');
          return `<div class="recipe">${art}<b>${r.name}</b>${costList(r.cost)}<button class="btn tiny ${canPay(r.cost) ? 'primary' : ''}" data-craft="${i}" ${canPay(r.cost) ? '' : 'disabled'}>Craft</button></div>`;
        }).join('')}</div><div class="row-center"><button class="btn ghost" data-relics>${icon('crown')} Upgrade relics</button></div>`);
        break;
      case 'training_hall':
        parts.push(`<div class="sec-h">${icon('sword')}<span>Train your team</span><small>Instant XP for gold</small></div><div class="train-list">${state.team.map((c, i) => {
          const cost = trainCost(c);
          return `<div class="tr">${mysticFace(c.species, c.shiny, 48)}<div><b>${esc(displayName(c))}</b><small>Lv ${c.level}</small>${bar(c.xp / xpToNext(c.level), 'xp')}</div><button class="btn tiny ${state.inv.gold >= cost ? 'primary' : ''}" data-train="${i}" ${state.inv.gold >= cost ? '' : 'disabled'}>${icon('coin')} ${cost}</button></div>`;
        }).join('')}</div>`);
        break;
      case 'healing_well': {
        const hurt = [...state.team, ...state.box].filter((c) => c.hp < statsOf(c).maxHp).length;
        parts.push(`<p class="svc-say">“Cool water, drawn from deep beneath the Vale.”</p><div class="row-center"><button class="btn primary big" data-heal ${hurt ? '' : 'disabled'}>${icon('heart')} ${hurt ? 'Rest at the well' : 'Everyone is healthy'}</button></div>`);
        break;
      }
      case 'market':
        parts.push(`<div class="sec-h">${icon('coin')}<span>Sell materials</span></div><div class="sell-list">${(Object.keys(MATERIALS) as MaterialId[]).map((m) => {
          const have = state.inv.materials[m];
          return `<div class="sell" style="--c:${MATERIALS[m].color}">${icon(RES_ICON[m])}<b>${MATERIALS[m].name}</b><small>×${have} · ${SELL_PRICES[m]}g each</small>
            <button class="btn tiny" data-sell="${m}" data-n="10" ${have >= 10 ? '' : 'disabled'}>×10</button><button class="btn tiny" data-sell="${m}" data-n="${have}" ${have ? '' : 'disabled'}>All</button></div>`;
        }).join('')}</div>`);
        break;
      case 'watchtower':
        parts.push('<p class="svc-say">From up here your minimap reaches much farther — wild Mystics can’t hide from you.</p>');
        break;
      default:
        if (!d.produces) parts.push(`<p class="muted">${d.desc}</p>`);
    }
    return parts.join('');
  }

  private wire(b: HTMLElement, s: BaseStructure, d: StructureDef, draw: () => void) {
    b.querySelector('[data-collect]')?.addEventListener('click', () => { const got = collect(s.uid); sfx('coin'); toast(`Collected ${resList(got)}`, 'loot'); this.hooks.changed(); draw(); });
    b.querySelector('[data-collect-xp]')?.addEventListener('click', () => { collect(s.uid); sfx('levelup'); toast('Your residents grew stronger.', 'good'); draw(); });
    b.querySelectorAll<HTMLElement>('[data-unassign]').forEach((x) => x.addEventListener('click', () => { unassign(s, x.dataset.unassign!); this.hooks.world.homestead.sync(); draw(); }));
    b.querySelector('[data-assign]')?.addEventListener('click', async () => {
      const taken = new Set(state.base.structures.flatMap((o) => o.assigned));
      const c = await pickCreature('Choose a resident (from storage)', (x) => state.box.includes(x) && !taken.has(x.uid), (x) => `Lv ${x.level}`);
      if (c && assign(s, c.uid)) { sfx('select'); this.hooks.world.homestead.sync(); }
      draw();
    });
    b.querySelectorAll<HTMLElement>('[data-craft]').forEach((x) => x.addEventListener('click', () => {
      const r = RECIPES[Number(x.dataset.craft)];
      if (craft(r)) { sfx('levelup'); toast(`Crafted ${r.name}!`, 'good'); } else sfx('error');
      draw();
    }));
    b.querySelector('[data-relics]')?.addEventListener('click', () => void this.hooks.openJournal('relics'));
    b.querySelectorAll<HTMLElement>('[data-train]').forEach((x) => x.addEventListener('click', () => {
      const c = state.team[Number(x.dataset.train)];
      const r = train(c);
      if (!r) { sfx('error'); return; }
      sfx('levelup');
      toast(r.levels ? `${esc(displayName(c))} grew to level ${c.level}!` : `${esc(displayName(c))} trained hard.`, 'good');
      this.hooks.changed();
      draw();
    }));
    b.querySelector('[data-heal]')?.addEventListener('click', () => { healAll(); sfx('heal'); toast('Everyone is refreshed.', 'good'); this.hooks.changed(); draw(); });
    b.querySelectorAll<HTMLElement>('[data-sell]').forEach((x) => x.addEventListener('click', () => {
      const g = sell(x.dataset.sell as MaterialId, Number(x.dataset.n));
      sfx('coin');
      toast(`Sold for ${g} gold.`);
      this.hooks.changed();
      draw();
    }));
    void d;
  }
}

