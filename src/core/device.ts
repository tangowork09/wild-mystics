// Single source of truth for touch UI. Some Android WebViews report `pointer: fine` (an emulated or
// attached mouse) while the device has a touchscreen and no hover, so check touch points too.
export const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
document.documentElement.classList.toggle('touch', isTouch);
