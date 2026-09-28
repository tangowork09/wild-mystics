// Odometer counts: gold, Aether, HP and totals roll digit by digit when they change.
const DIGITS = Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join('');

export function odometer(el: HTMLElement, value: number, format: (n: number) => string = (n) => n.toLocaleString()) {
  const prev = el.dataset.v;
  const next = String(value);
  if (prev === next) return;
  const text = format(value);
  const sig = [...text].map((c) => (/\d/.test(c) ? 'd' : c)).join('');
  let wrap = el.querySelector<HTMLElement>(':scope > .odo');
  const fresh = !wrap || wrap.dataset.sig !== sig;
  if (fresh) {
    wrap = document.createElement('span');
    wrap.className = 'odo';
    wrap.dataset.sig = sig;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = [...text].map((c) => (/\d/.test(c) ? `<span class="od-d"><span class="od-s" style="--d:${c};transition:none">${DIGITS}</span></span>` : `<span class="od-sep">${c}</span>`)).join('');
    el.replaceChildren(wrap);
    const sr = document.createElement('span');
    sr.className = 'sr';
    el.appendChild(sr);
    requestAnimationFrame(() => wrap!.querySelectorAll<HTMLElement>('.od-s').forEach((s) => (s.style.transition = '')));
  } else {
    const strips = wrap!.querySelectorAll<HTMLElement>('.od-s');
    let k = 0;
    for (const c of text) if (/\d/.test(c)) strips[k++]?.style.setProperty('--d', c);
  }
  const sr = el.querySelector<HTMLElement>(':scope > .sr');
  if (sr) sr.textContent = text;
  if (prev !== undefined && !fresh) {
    el.classList.remove('bump-up', 'bump-down');
    void el.offsetWidth;
    el.classList.add(Number(prev) < value ? 'bump-up' : 'bump-down');
  }
  el.dataset.v = next;
}
