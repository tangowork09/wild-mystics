import { ACHIEVEMENTS } from '../../data/progression';
import { state } from '../../game/state';
import { questById, claimQuest, rewardText, achievementTier, claimAchievement } from '../../game/progress';
import { sfx } from '../../core/audio';
import { toast } from '../dom';
import { bar } from '../kit';
import { icon } from '../icons';

export function renderQuests(root: HTMLElement) {
  const draw = () => {
    const q = state.quests;
    const row = (id: string, progress: number, claimed?: boolean) => {
      const d = questById(id);
      if (!d) return '';
      const done = progress >= d.objective.count;
      return `<div class="quest ${d.kind} ${done ? 'done' : ''} ${claimed ? 'claimed' : ''}">
        <div class="q-ic">${icon(d.kind === 'story' ? 'crown' : d.kind === 'daily' ? 'sun' : 'quest_scroll')}</div>
        <div class="q-b"><b>${d.title}</b><p>${d.desc}</p>${bar(progress / d.objective.count, 'xp')}<small>${Math.min(progress, d.objective.count)} / ${d.objective.count} · ${rewardText(d.reward)}</small></div>
        ${claimed ? `<span class="q-claimed">${icon('trophy')} Claimed</span>` : done ? `<button class="btn gold" data-claim="${id}">Claim</button>` : ''}</div>`;
    };
    const story = q.active.filter((a) => questById(a.id)?.kind === 'story');
    const side = q.active.filter((a) => questById(a.id)?.kind === 'side');
    root.innerHTML = `
      <div class="sec-h">${icon('crown')}<span>Story — The Six Guardians</span><small>${q.done.filter((d) => d.startsWith('story')).length} chapters complete</small></div>
      ${story.map((a) => row(a.id, a.progress)).join('') || '<p class="muted">The story is complete. Legends never truly end.</p>'}
      <div class="sec-h">${icon('sun')}<span>Daily requests</span><small>Refresh at midnight</small></div>
      ${q.daily.list.map((a) => row(a.id, a.progress, a.claimed)).join('')}
      <div class="sec-h">${icon('quest_scroll')}<span>Side quests</span><small>Accept more at any town's Quest Board</small></div>
      ${side.map((a) => row(a.id, a.progress)).join('') || '<p class="muted">No side quests yet — visit a Quest Board.</p>'}`;
    root.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) => b.addEventListener('click', () => {
      const d = questById(b.dataset.claim!);
      if (claimQuest(b.dataset.claim!)) { sfx('captured'); toast(`Reward: <b>${d ? rewardText(d.reward) : ''}</b>`, 'loot', 3600); }
      draw();
    }));
  };
  draw();
}

export function renderAchievements(root: HTMLElement) {
  const draw = () => {
    root.innerHTML = `<div class="ach-grid">${ACHIEVEMENTS.map((a) => {
      const t = achievementTier(a.id);
      const next = a.tiers[Math.min(t.claimed, a.tiers.length - 1)];
      const maxed = t.claimed >= a.tiers.length;
      return `<div class="ach ${t.claimable ? 'ready' : ''} ${maxed ? 'maxed' : ''}"><div class="ach-ic">${icon('trophy')}</div><div class="ach-b"><b>${a.title}</b><small>${a.desc}</small>
        <div class="tiers">${a.tiers.map((x, i) => `<i class="${i < t.claimed ? 'on' : i < t.reached ? 'ready' : ''}">${x}</i>`).join('')}</div>
        ${maxed ? '<em>Mastered</em>' : bar(t.cur / next, 'xp')}</div>
        ${t.claimable ? `<button class="btn gold" data-a="${a.id}">+${a.reward[t.claimed]} ${icon('gem')}</button>` : ''}</div>`;
    }).join('')}</div>`;
    root.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const n = claimAchievement(b.dataset.a!);
      if (n) { sfx('captured'); toast(`Achievement reward: <b>${n} Aether</b>`, 'loot'); }
      draw();
    }));
  };
  draw();
}
