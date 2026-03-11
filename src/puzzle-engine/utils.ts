export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function dist2(x1: number, y1: number, x2: number, y2: number) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickRotation(rng: () => number = Math.random): 0 | 90 | 180 | 270 {
  const all = [0, 90, 180, 270] as const;
  return all[Math.floor(rng() * all.length)];
}

export function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function prettyTitleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim();
}

export type TabDirection = -1 | 0 | 1;
export type PieceTabs = {
  top: TabDirection;
  right: TabDirection;
  bottom: TabDirection;
  left: TabDirection;
};

/**
 * 统一定义：
 * 1 = outward（向外凸）
 * -1 = inward（向内凹）
 * 0 = flat
 */
export function jigsawPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tabs: PieceTabs
) {
  const l = -w / 2;
  const t = -h / 2;
  const r = w / 2;
  const b = h / 2;

  const tabSize = Math.min(w, h) * 0.18;
  const shoulderW = w * 0.28;
  const shoulderH = h * 0.28;
  const neckW = w * 0.08;
  const neckH = h * 0.08;
  const headW = w * 0.10;
  const headH = h * 0.10;

  ctx.beginPath();
  ctx.moveTo(l, t);

  // top: left -> right, outward => negative y
  if (tabs.top === 0) {
    ctx.lineTo(r, t);
  } else {
    const amp = tabs.top === 1 ? -tabSize : tabSize;
    const x1 = l + shoulderW;
    const x2 = r - shoulderW;
    const cx = (l + r) / 2;

    ctx.lineTo(x1, t);
    ctx.bezierCurveTo(
      x1 + neckW,
      t,
      cx - headW,
      t + amp,
      cx,
      t + amp
    );
    ctx.bezierCurveTo(
      cx + headW,
      t + amp,
      x2 - neckW,
      t,
      x2,
      t
    );
    ctx.lineTo(r, t);
  }

  // right: top -> bottom, outward => positive x
  if (tabs.right === 0) {
    ctx.lineTo(r, b);
  } else {
    const amp = tabs.right === 1 ? tabSize : -tabSize;
    const y1 = t + shoulderH;
    const y2 = b - shoulderH;
    const cy = (t + b) / 2;

    ctx.lineTo(r, y1);
    ctx.bezierCurveTo(
      r,
      y1 + neckH,
      r + amp,
      cy - headH,
      r + amp,
      cy
    );
    ctx.bezierCurveTo(
      r + amp,
      cy + headH,
      r,
      y2 - neckH,
      r,
      y2
    );
    ctx.lineTo(r, b);
  }

  // bottom: right -> left, outward => positive y
  if (tabs.bottom === 0) {
    ctx.lineTo(l, b);
  } else {
    const amp = tabs.bottom === 1 ? tabSize : -tabSize;
    const x1 = r - shoulderW;
    const x2 = l + shoulderW;
    const cx = (l + r) / 2;

    ctx.lineTo(x1, b);
    ctx.bezierCurveTo(
      x1 - neckW,
      b,
      cx + headW,
      b + amp,
      cx,
      b + amp
    );
    ctx.bezierCurveTo(
      cx - headW,
      b + amp,
      x2 + neckW,
      b,
      x2,
      b
    );
    ctx.lineTo(l, b);
  }

  // left: bottom -> top, outward => negative x
  if (tabs.left === 0) {
    ctx.lineTo(l, t);
  } else {
    const amp = tabs.left === 1 ? -tabSize : tabSize;
    const y1 = b - shoulderH;
    const y2 = t + shoulderH;
    const cy = (t + b) / 2;

    ctx.lineTo(l, y1);
    ctx.bezierCurveTo(
      l,
      y1 - neckH,
      l + amp,
      cy + headH,
      l + amp,
      cy
    );
    ctx.bezierCurveTo(
      l + amp,
      cy - headH,
      l,
      y2 + neckH,
      l,
      y2
    );
    ctx.lineTo(l, t);
  }

  ctx.closePath();
}