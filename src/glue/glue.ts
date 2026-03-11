export type GlueConfig = {
  brushRadius: number;
  targetCoverage: number;
};

export class GlueLayer {
  private mask: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private board: { x: number; y: number; w: number; h: number };
  private cfg: GlueConfig;

  private drawing = false;
  private lastX = 0;
  private lastY = 0;
  private finalizedAt: number | null = null;

  constructor(
    board: { x: number; y: number; w: number; h: number },
    canvasSize: { w: number; h: number },
    cfg: GlueConfig
  ) {
    this.board = board;
    this.cfg = cfg;

    this.mask = document.createElement("canvas");
    this.mask.width = Math.floor(canvasSize.w);
    this.mask.height = Math.floor(canvasSize.h);

    this.ctx = this.mask.getContext("2d")!;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.lineWidth = cfg.brushRadius * 2.8;
    this.ctx.strokeStyle = "rgba(255,255,255,1)";
  }

  getBrushRadius() {
    return this.cfg.brushRadius;
  }

  pointerDown(x: number, y: number) {
    if (this.finalizedAt != null) return;
    if (!this.inBoard(x, y)) return;

    this.drawing = true;
    this.lastX = x;
    this.lastY = y;

    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + 0.01, y + 0.01);
    this.ctx.stroke();
  }

  pointerMove(x: number, y: number) {
    if (this.finalizedAt != null || !this.drawing) return;
    if (!this.inBoard(x, y)) return;

    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  pointerUp() {
    this.drawing = false;
  }

  finalize() {
    if (this.finalizedAt != null) return;
    this.finalizedAt = performance.now();
  }

  estimateCoverage(sampleStep = 2) {
    const { x, y, w, h } = this.board;
    const W = Math.floor(w);
    const H = Math.floor(h);
    if (W <= 0 || H <= 0) return 0;

    const img = this.ctx.getImageData(Math.floor(x), Math.floor(y), W, H).data;
    let hit = 0;
    let total = 0;

    for (let yy = 0; yy < H; yy += sampleStep) {
      for (let xx = 0; xx < W; xx += sampleStep) {
        total++;
        const alpha = img[(yy * W + xx) * 4 + 3];
        if (alpha > 10) hit++;
      }
    }

    return total ? hit / total : 0;
  }

  getCoveragePercent() {
    return Math.round(this.estimateCoverage() * 100);
  }

  isReadyToBind() {
    return this.estimateCoverage() >= this.cfg.targetCoverage;
  }

  isBindAnimationDone() {
    if (this.finalizedAt == null) return false;
    return performance.now() - this.finalizedAt >= 980;
  }

  renderBehind(ctx: CanvasRenderingContext2D) {
    const t =
      this.finalizedAt == null
        ? 0
        : Math.min(1, (performance.now() - this.finalizedAt) / 980);

    const alpha = this.finalizedAt == null ? 0.86 : 0.86 * (1 - t);

    // 第一层：轨迹层，必须清晰可见
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.mask, 0, 0);

    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(96,108,118,0.62)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    // 第二层：胶水厚度层
    ctx.save();
    ctx.globalAlpha = alpha * 0.92;
    ctx.filter = "blur(7px)";
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.mask, 0, 0);

    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(138,150,162,0.42)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    // 第三层：高光扫过
    if (this.finalizedAt != null) {
      const { x, y, w, h } = this.board;
      const sweepX = x - w * 0.7 + w * 2.0 * t;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      const g = ctx.createLinearGradient(sweepX, y, sweepX + w * 0.45, y);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.34)");
      g.addColorStop(1, "rgba(255,255,255,0)");

      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  }

  private inBoard(x: number, y: number) {
    const b = this.board;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
}