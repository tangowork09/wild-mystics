// Quest log (reads api.quests): Main / Side / Daily / Bounty groups, a paged list, and a detail
// card with numbered steps (finished steps stay, stamped), rewards and Track / Claim / Show on map.
// Feats (lifetime achievements) share the file.
import { ACHIEVEMENTS, type Reward } from '../../data/progression';
import { ORBS, ITEMS, MATERIALS, type ItemId, type OrbId, type MaterialId } from '../../data/items';
import { RELICS } from '../../data/relics';
import { api, type QuestView } from '../../game/contracts';
import { achievementTier, claimAchievement } from '../../game/progress';
import { state } from '../../game/state';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { toast } from '../dom';
import { bar, emptyState } from '../kit';
import { icon, glyph } from '../icons';
import { Pager } from '../pager';
import { distText } from '../guidance';
import { itemArt } from './bag';
import type { TabCleanup } from '../journal';

type Kind = QuestView['kind'];
const KINDS: { id: Kind; label: string; ic: string }[] = [
  { id: 'main', label: 'Main', ic: 'crown' }, { id: 'side', label: 'Side', ic: 'quest_scroll' }, { id: 'daily', label: 'Daily', ic: 'sun' }, { id: 'bounty', label: 'Bounty', ic: 'skull' },
];
const ORDER: Record<QuestView['status'], number> = { ready: 0, active: 1, available: 2, done: 3 };

/** Reward chips (capsules with art + amount). */
export function rewardChips(r: Reward) {
  const out: string[] = [];
  const chip = (art: string, label: string, n?: number) => `<span class="rw">${art}<span class="rw-t">${n !== undefined ? `<b class="tnum">${n.toLocaleString()}</b> ` : ''}${label}</span></span>`;
  if (r.gold) out.push(chip(`<span class="item-art" style="--c:var(--coin)">${icon('coin')}</span>`, 'Gold', r.gold));
  if (r.aether) out.push(chip('<span class="item-art holo">' + icon('gem') + '</span>', 'Aether', r.aether));
  if (r.tickets) out.push(chip(`<span class="item-art" style="--c:var(--magenta)">${icon('scroll')}</span>`, r.tickets > 1 ? 'Tickets' : 'Ticket', r.tickets));
  if (r.essence) out.push(chip(`<span class="item-art" style="--c:var(--el-wind)">${icon('sparkles')}</span>`, 'Essence', r.essence));
  for (const [k, v] of Object.entries(r.orbs ?? {})) out.push(chip(itemArt(k), ORBS[k as OrbId]?.name ?? k, v));
  for (const [k, v] of Object.entries(r.items ?? {})) out.push(chip(itemArt(k), ITEMS[k as ItemId]?.name ?? k, v));
  for (const [k, v] of Object.entries(r.materials ?? {})) out.push(chip(itemArt(k), MATERIALS[k as MaterialId]?.name ?? k, v));
  if (r.relic) out.push(chip(`<span class="item-art" style="--c:var(--el-void)">${icon('crown')}</span>`, RELICS[r.relic]?.name ?? 'Relic'));
  if (r.rankXp) out.push(chip(`<span class="item-art" style="--c:var(--xp)">${glyph('star')}</span>`, 'Rank XP', r.rankXp));
  return out.join('');
}

let group: Kind = 'main';

export function renderQuests(root: HTMLElement, opts: { showOnMap(): void; playerPos(): { x: number; z: number } | null }): TabCleanup {
  const all = () => { try { return api.quests.list(); } catch { return [] as QuestView[]; } };
  const listOf = (k: Kind) => all().filter((q) => q.kind === k).sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(b.tracked) - Number(a.tracked));
  const first = all();
  if (!first.some((q) => q.kind === group)) group = (first.find((q) => q.tracked)?.kind ?? first[0]?.kind ?? 'main');
  let focus = listOf(group).find((q) => q.tracked)?.id ?? listOf(group)[0]?.id ?? '';

  root.innerHTML = `<div class="quests md">
    <div class="md-master"><header class="bag-top"><div class="seg q-groups" role="tablist"></div></header><div class="q-list"></div></div>
    <div class="md-detail q-detail"></div></div>`;
  const detail = root.querySelector('.q-detail') as HTMLElement;
  const groups = root.querySelector('.q-groups') as HTMLElement;
  const pager = new Pager<QuestView>(root.querySelector('.q-list') as HTMLElement, {
    items: listOf(group), cell: { w: 240, h: 60 }, gap: 6, primary: true, maxCols: 1, label: 'Quests',
    selected: (q) => q.id === focus, onPick: (q) => { focus = q.id; sfx('select'); pager.refresh(); drawDetail(); },
    render: (q) => {
      const cur = q.current;
      const status = q.status === 'ready' ? 'Ready to turn in' : q.status === 'available' ? `New · ${q.giver ?? 'Someone'} has a request` : q.status === 'done' ? 'Complete' : cur?.count && cur.count > 1 ? `${cur.progress ?? 0}/${cur.count} · ${cur.text}` : cur?.text ?? q.summary;
      const ic = q.status === 'ready' ? icon('gift') : q.status === 'done' ? glyph('check') : q.status === 'available' ? glyph('bang') : q.tracked ? glyph('diamond') : icon(KINDS.find((k) => k.id === q.kind)!.ic);
      return `<span class="qrow ${q.status} ${q.tracked ? 'tracked' : ''}"><span class="q-ic">${ic}</span><span class="q-b"><b class="ell">${q.title}</b><small class="ell">${status}</small></span>${q.level ? `<span class="q-lv tnum">Lv ${q.level}</span>` : ''}</span>`;
    },
    empty: () => emptyState(`No ${group} quests`, group === 'main' ? 'The story continues as you explore. Talk to people in town.' : group === 'daily' ? 'New daily requests arrive at midnight.' : group === 'bounty' ? 'Bounties for Alpha Mystics are posted at town quest boards.' : 'Townsfolk with a gold ! above them have work for you.', 'quest_scroll'),
  });

  const drawGroups = () => {
    const a = all();
    groups.innerHTML = KINDS.map((k) => {
      const qs = a.filter((q) => q.kind === k.id && q.status !== 'done');
      const ready = qs.filter((q) => q.status === 'ready').length;
      return `<button role="tab" data-g="${k.id}" class="${k.id === group ? 'on' : ''}" aria-selected="${k.id === group}">${k.label}${qs.length ? `<span class="n ${ready ? 'hot' : ''}">${ready || qs.length}</span>` : ''}</button>`;
    }).join('');
    groups.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => b.addEventListener('click', () => {
      group = b.dataset.g as Kind;
      const l = listOf(group);
      focus = l.find((q) => q.tracked)?.id ?? l[0]?.id ?? '';
      sfx('select');
      drawAll();
    }));
  };

  const drawDetail = () => {
    const q = all().find((x) => x.id === focus);
    if (!q) {
      detail.innerHTML = `<div class="qd">${emptyState(all().length ? 'Pick a quest' : 'Your quest log is empty', all().length ? 'Choose one on the left to see its steps and rewards.' : 'Quests arrive as you meet people around the island. Look for a gold ! over their heads.', 'quest_scroll')}</div>`;
      return;
    }
    const steps = q.steps.length ? q.steps : q.current ? [q.current] : [];
    const d = q.target ? distanceTo(q.target.x, q.target.z) : null;
    detail.innerHTML = `<div class="qd ${q.status}">
      <header class="qd-head"><h3 class="qd-title">${q.title}</h3>
        <div class="qd-meta">${q.chapter ? `<span class="tag mag">${q.chapter}</span>` : `<span class="tag">${KINDS.find((k) => k.id === q.kind)!.label}</span>`}${q.level ? `<span class="tag line tnum">Lv ${q.level}</span>` : ''}${q.giver ? `<span class="qd-giver">${icon('user_profile')} ${q.giver}</span>` : ''}</div></header>
      <p class="qd-sum">${q.summary}</p>
      <div class="qd-steps"></div>
      ${q.target && q.status !== 'done' ? `<div class="qd-where">${icon(q.status === 'ready' ? 'gift' : 'map')}<span><b>${q.target.label}</b>${d !== null ? ` · <span class="tnum">${distText(d)}</span> away` : ''}</span></div>` : ''}
      <div class="qd-rewards"><span class="qd-rl">Rewards</span><div class="rw-row">${rewardChips(q.rewards) || '<span class="muted">Gratitude</span>'}</div></div>
      <div class="qd-act">
        ${q.status === 'ready' ? `<button class="btn gold" data-a="claim">${icon('gift')} Claim reward</button>` : ''}
        ${q.status !== 'done' && q.target ? (q.tracked ? `<button class="btn" disabled>${glyph('diamond')} Tracking</button>` : `<button class="btn primary" data-a="track">${glyph('diamond')} Track</button>`) : ''}
        ${q.target && q.status !== 'done' ? `<button class="btn ghost" data-a="map">${icon('map')} Show on map</button>` : ''}
      </div></div>`;
    // steps page inside the detail when the chain is long
    const stepHost = detail.querySelector('.qd-steps') as HTMLElement;
    if (steps.length) {
      const sp = new Pager<(typeof steps)[number]>(stepHost, {
        items: steps, cell: { w: 200, h: 30 }, gap: 4, maxCols: 1, keys: false, label: 'Steps',
        render: (s) => { const i = steps.indexOf(s); return `<span class="step ${s.done ? 'done' : 'cur'}"><span class="st-no tnum">${s.done ? glyph('check') : i + 1}</span><span class="st-t ell">${s.text}</span>${s.count && s.count > 1 ? `<span class="st-p tnum">${Math.min(s.progress ?? 0, s.count)}/${s.count}</span>` : ''}</span>`; },
      });
      const curIdx = steps.findIndex((s) => !s.done);
      sp.showIndex(curIdx < 0 ? steps.length - 1 : curIdx);
      stepCleanup = () => sp.destroy();
    } else stepHost.remove();
    detail.querySelector('[data-a=track]')?.addEventListener('click', () => { api.quests.track(q.id); sfx('open'); haptic('light'); toast(`Tracking <b>${q.title}</b>`, 'quest', 1800); drawAll(); });
    detail.querySelector('[data-a=claim]')?.addEventListener('click', () => {
      if (api.quests.claim(q.id)) { sfx('captured'); haptic('success'); toast(`Quest complete: <b>${q.title}</b>`, 'loot', 3200); } else sfx('error');
      drawAll();
    });
    detail.querySelector('[data-a=map]')?.addEventListener('click', () => { if (!q.tracked) api.quests.track(q.id); opts.showOnMap(); });
  };
  let stepCleanup: (() => void) | null = null;
  const distanceTo = (x: number, z: number) => {
    const p = opts.playerPos() ?? (state.pos ? { x: state.pos[0], z: state.pos[1] } : null);
    return p ? Math.hypot(x - p.x, z - p.z) : null;
  };
  const drawAll = () => {
    stepCleanup?.();
    stepCleanup = null;
    drawGroups();
    const l = listOf(group);
    if (!l.some((q) => q.id === focus)) focus = l[0]?.id ?? '';
    pager.setItems(l, l.findIndex((q) => q.id === focus));
    drawDetail();
  };
  drawAll();
  return () => { stepCleanup?.(); pager.destroy(); };
}

export function renderAchievements(root: HTMLElement): TabCleanup {
  root.innerHTML = '<div class="feats"></div>';
  const pager = new Pager<(typeof ACHIEVEMENTS)[number]>(root.querySelector('.feats') as HTMLElement, {
    items: ACHIEVEMENTS, cell: { w: 250, h: 104 }, gap: 8, primary: true, label: 'Feats',
    render: (a) => {
      const t = achievementTier(a.id);
      const maxed = t.claimed >= a.tiers.length;
      const next = a.tiers[Math.min(t.claimed, a.tiers.length - 1)];
      return `<div class="feat ${t.claimable ? 'ready' : ''} ${maxed ? 'maxed' : ''}">
        <span class="ft-ic">${icon('trophy')}</span>
        <div class="ft-b"><b class="ell">${a.title}</b><small class="ell">${a.desc}</small>
          <div class="ft-tiers">${a.tiers.map((x, i) => `<i class="${i < t.claimed ? 'on' : i < t.reached ? 'ready' : ''}" title="${x}"></i>`).join('')}</div>
          ${maxed ? '<span class="ft-state">Mastered</span>' : `<div class="ft-prog">${bar(t.cur / next, 'gold thin')}<span class="tnum">${Math.min(t.cur, next).toLocaleString()}/${next.toLocaleString()}</span></div>`}</div>
        ${t.claimable ? `<button class="btn small gold ft-claim" data-a="${a.id}" data-nopick>+${a.reward[t.claimed]} ${icon('gem')}</button>` : ''}</div>`;
    },
  });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const n = claimAchievement(b.dataset.a!);
    if (n) { sfx('captured'); haptic('success'); toast(`Feat reward: <b>${n} Aether</b>`, 'loot'); }
    pager.refresh();
  });
  return () => pager.destroy();
}
