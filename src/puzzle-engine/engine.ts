import type {
  EngineSnapshot,
  EngineState,
  Piece,
  PieceTabs,
  PuzzleConfig,
  Rotation,
  TabDirection,
} from "./types";
import {
  dist2,
  easeOutBack,
  jigsawPath,
  pickRotation,
} from "./utils";

type EngineDeps = {
  imageCanvas: HTMLCanvasElement;
  config: PuzzleConfig;
  rng?: () => number;
};

type BoardRect = { x: number; y: number; w: number; h: number };

export class PuzzleEngine {
  private imgCanvas: HTMLCanvasElement;
  private boardImageCanvas: HTMLCanvasElement;
  private cfg: PuzzleConfig;
  private rng: () => number;

  state: EngineState;

  constructor(deps: EngineDeps) {
    this.imgCanvas = deps.imageCanvas;
    this.cfg = deps.config;
    this.rng = deps.rng ?? Math.random;
    this.boardImageCanvas = this.buildBoardImageCanvas();

    const pieces = this.buildPieces();

    this.state = {
      pieces,
      draggingGroupId: null,
      dragOffset: { x: 0, y: 0 },
      lockedCount: 0,
      totalCount: pieces.length,
      completed: false,
    };
  }

  private buildBoardImageCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.cfg.boardW));
    canvas.height = Math.max(1, Math.round(this.cfg.boardH));

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sw = this.imgCanvas.width;
    const sh = this.imgCanvas.height;
    const dw = canvas.width;
    const dh = canvas.height;

    const srcRatio = sw / sh;
    const dstRatio = dw / dh;

    let sx = 0;
    let sy = 0;
    let sWidth = sw;
    let sHeight = sh;

    if (srcRatio > dstRatio) {
      sWidth = sh * dstRatio;
      sx = (sw - sWidth) / 2;
    } else {
      sHeight = sw / dstRatio;
      sy = (sh - sHeight) / 2;
    }

    ctx.drawImage(
      this.imgCanvas,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      dw,
      dh
    );

    return canvas;
  }

  getImageCanvas() {
    return this.imgCanvas;
  }

  getBoardImageCanvas() {
    return this.boardImageCanvas;
  }

  getBoardRect(): BoardRect {
    const { boardX, boardY, boardW, boardH } = this.cfg;
    return { x: boardX, y: boardY, w: boardW, h: boardH };
  }

  createSnapshot(): EngineSnapshot {
    const board = this.getBoardRect();

    return {
      completed: this.state.completed,
      lockedCount: this.state.lockedCount,
      pieces: this.state.pieces.map((p) => ({
        id: p.id,
        rotation: p.rotation,
        locked: p.locked,
        groupId: p.groupId,
        rx: board.w > 0 ? (p.x - board.x) / board.w : 0,
        ry: board.h > 0 ? (p.y - board.y) / board.h : 0,
      })),
    };
  }

  restoreSnapshot(snapshot: EngineSnapshot) {
    const board = this.getBoardRect();
    const map = new Map(snapshot.pieces.map((p) => [p.id, p]));

    for (const piece of this.state.pieces) {
      const saved = map.get(piece.id);
      if (!saved) continue;

      piece.rotation = saved.rotation;
      piece.locked = saved.locked;
      piece.groupId = saved.groupId;

      if (saved.locked || snapshot.completed) {
        piece.x = piece.correctX;
        piece.y = piece.correctY;
        piece.rotation = 0;
        piece.locked = true;
      } else {
        piece.x = board.x + saved.rx * board.w;
        piece.y = board.y + saved.ry * board.h;
      }
    }

    this.state.draggingGroupId = null;
    this.state.dragOffset = { x: 0, y: 0 };
    this.syncState();

    if (snapshot.completed) {
      this.state.completed = true;
      this.state.lockedCount = this.state.totalCount;
    }
  }

  private rotatedBaseW(p: Piece) {
    return p.rotation === 90 || p.rotation === 270 ? p.baseH : p.baseW;
  }

  private rotatedBaseH(p: Piece) {
    return p.rotation === 90 || p.rotation === 270 ? p.baseW : p.baseH;
  }

  private bboxW(p: Piece) {
    return this.rotatedBaseW(p) + p.visualPadding * 2;
  }

  private bboxH(p: Piece) {
    return this.rotatedBaseH(p) + p.visualPadding * 2;
  }

  private centerOf(p: Piece) {
    return {
      cx: p.x + this.bboxW(p) / 2,
      cy: p.y + this.bboxH(p) / 2,
    };
  }

  private setCenter(p: Piece, cx: number, cy: number) {
    p.x = cx - this.bboxW(p) / 2;
    p.y = cy - this.bboxH(p) / 2;
  }

  private randSign(): TabDirection {
    return this.rng() > 0.5 ? 1 : -1;
  }

  private buildTabsMap(): PieceTabs[][] {
    const out: PieceTabs[][] = [];
    const { rows, cols } = this.cfg;

    for (let r = 0; r < rows; r++) {
      out[r] = [];
      for (let c = 0; c < cols; c++) {
        const top: TabDirection = r === 0 ? 0 : ((-out[r - 1][c].bottom) as TabDirection);
        const left: TabDirection = c === 0 ? 0 : ((-out[r][c - 1].right) as TabDirection);
        const right: TabDirection = c === cols - 1 ? 0 : this.randSign();
        const bottom: TabDirection = r === rows - 1 ? 0 : this.randSign();

        out[r][c] = { top, right, bottom, left };
      }
    }

    return out;
  }

  private computeScatterZones(pieceW: number, pieceH: number) {
    const { canvasW, canvasH, boardX, boardY, boardW, boardH, scatterPadding } = this.cfg;
    const margin = Math.max(16, scatterPadding);

    const clampZone = (x1: number, y1: number, x2: number, y2: number) => {
      const X1 = Math.max(margin, x1);
      const Y1 = Math.max(margin, y1);
      const X2 = Math.min(canvasW - margin - pieceW, x2);
      const Y2 = Math.min(canvasH - margin - pieceH, y2);
      return { x1: X1, y1: Y1, x2: X2, y2: Y2 };
    };

    const left = clampZone(
      boardX - pieceW - scatterPadding,
      boardY - 10,
      boardX - scatterPadding,
      boardY + boardH - pieceH + 10
    );

    const right = clampZone(
      boardX + boardW + scatterPadding,
      boardY - 10,
      canvasW - margin - pieceW,
      boardY + boardH - pieceH + 10
    );

    const top = clampZone(
      margin,
      margin,
      canvasW - margin - pieceW,
      boardY - scatterPadding
    );

    const bottom = clampZone(
      margin,
      boardY + boardH + scatterPadding,
      canvasW - margin - pieceW,
      canvasH - margin - pieceH
    );

    const zones = [left, right, top, bottom].filter(
      (z) => z.x2 > z.x1 + 4 && z.y2 > z.y1 + 4
    );

    if (zones.length === 0) {
      return [
        {
          x1: margin,
          y1: margin,
          x2: canvasW - margin - pieceW,
          y2: canvasH - margin - pieceH,
        },
      ];
    }

    zones.sort(
      (a, b) =>
        (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1)
    );

    return zones;
  }

  private sampleInZone(z: { x1: number; y1: number; x2: number; y2: number }) {
    return {
      x: z.x1 + this.rng() * Math.max(1, z.x2 - z.x1),
      y: z.y1 + this.rng() * Math.max(1, z.y2 - z.y1),
    };
  }

  private buildPieces(): Piece[] {
    const { rows, cols, boardX, boardY, boardW, boardH, randomRotation, pieceStyle } = this.cfg;

    const baseW = boardW / cols;
    const baseH = boardH / rows;

    const tabsMap = this.buildTabsMap();
    const visualPadding =
      pieceStyle === "jigsaw" ? Math.round(Math.min(baseW, baseH) * 0.18) : 0;

    const maxOuterW = Math.max(baseW, baseH) + visualPadding * 2;
    const maxOuterH = Math.max(baseW, baseH) + visualPadding * 2;
    const zones = this.computeScatterZones(maxOuterW, maxOuterH);

    const pieces: Piece[] = [];
    let groupSeq = 1;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;

        const tabs: PieceTabs =
          pieceStyle === "jigsaw"
            ? tabsMap[row][col]
            : {
                top: 0 as TabDirection,
                right: 0 as TabDirection,
                bottom: 0 as TabDirection,
                left: 0 as TabDirection,
              };

        const rotation: Rotation = randomRotation ? pickRotation(this.rng) : 0;

        const p: Piece = {
          id: idx,
          sx: col * baseW,
          sy: row * baseH,
          sw: baseW,
          sh: baseH,
          row,
          col,
          x: 0,
          y: 0,
          correctX: boardX + col * baseW - visualPadding,
          correctY: boardY + row * baseH - visualPadding,
          baseW,
          baseH,
          rotation,
          locked: false,
          groupId: groupSeq++,
          popUntil: 0,
          tabs,
          visualPadding,
          pieceStyle,
        };

        const zone = zones[Math.floor(this.rng() * zones.length)];
        const start = this.sampleInZone(zone);
        p.x = start.x;
        p.y = start.y;

        const { cx, cy } = this.centerOf(p);
        this.setCenter(p, cx, cy);

        pieces.push(p);
      }
    }

    return pieces;
  }

  private getGroupPieces(groupId: number) {
    return this.state.pieces.filter((p) => p.groupId === groupId);
  }

  private bringGroupToFront(groupId: number) {
    const rest: Piece[] = [];
    const group: Piece[] = [];

    for (const p of this.state.pieces) {
      if (p.groupId === groupId) group.push(p);
      else rest.push(p);
    }

    this.state.pieces = rest.concat(group);
  }

  private mergeGroups(a: number, b: number) {
    if (a === b) return;
    const keep = Math.min(a, b);
    const drop = Math.max(a, b);

    for (const p of this.state.pieces) {
      if (p.groupId === drop) p.groupId = keep;
    }
  }

  private popPieces(pieces: Piece[], durationMs = 160) {
    const now = performance.now();
    for (const p of pieces) {
      p.popUntil = now + durationMs;
    }
  }

  private syncState() {
    this.state.lockedCount = this.state.pieces.filter((p) => p.locked).length;
    this.state.completed = this.state.lockedCount === this.state.totalCount;
  }

  tidyLoosePieces() {
    const { canvasW, canvasH, boardY, boardH } = this.cfg;
    const loose = this.state.pieces.filter((p) => !p.locked);
    if (!loose.length) return;

    const pad = 18;
    let xCursor = pad;
    let yCursor = pad;

    for (const p of loose) {
      const bw = this.bboxW(p);
      const bh = this.bboxH(p);

      if (xCursor + bw > canvasW - pad) {
        xCursor = pad;
        yCursor += bh + 12;
      }

      if (yCursor + bh > boardY - 12 && yCursor < boardY + boardH + 12) {
        yCursor = boardY + boardH + 24;
        xCursor = pad;
      }

      if (yCursor + bh > canvasH - pad) {
        yCursor = pad;
        xCursor = canvasW - Math.min(320, canvasW * 0.24);
      }

      p.x = xCursor;
      p.y = yCursor;
      xCursor += bw + 12;
    }

    this.popPieces(loose, 180);
  }

  rotatePieceClockwise(pieceId: number) {
    const p = this.state.pieces.find((x) => x.id === pieceId);
    if (!p || p.locked) return;

    const { cx, cy } = this.centerOf(p);
    p.rotation = ((p.rotation + 90) % 360) as Rotation;
    this.setCenter(p, cx, cy);
    this.popPieces([p], 120);
  }

  rotateTopPieceAt(px: number, py: number) {
    const p = this.pickTopPiece(px, py);
    if (!p) return false;
    this.rotatePieceClockwise(p.id);
    return true;
  }

  placeOneHintPiece() {
    const candidates = this.state.pieces.filter((p) => !p.locked);
    if (!candidates.length) return false;

    const target = candidates.sort((a, b) => {
      const da = dist2(a.x, a.y, a.correctX, a.correctY);
      const db = dist2(b.x, b.y, b.correctX, b.correctY);
      return db - da;
    })[0];

    target.rotation = 0;
    target.x = target.correctX;
    target.y = target.correctY;
    target.locked = true;
    target.groupId = 100000 + target.id;

    this.popPieces([target], 220);
    this.syncState();
    return true;
  }

  private pickTopPiece(px: number, py: number): Piece | null {
    for (let i = this.state.pieces.length - 1; i >= 0; i--) {
      const p = this.state.pieces[i];
      if (p.locked) continue;

      const left = p.x;
      const top = p.y;
      const right = p.x + this.bboxW(p);
      const bottom = p.y + this.bboxH(p);

      if (px >= left && px <= right && py >= top && py <= bottom) {
        return p;
      }
    }
    return null;
  }

  pointerDown(px: number, py: number) {
    const p = this.pickTopPiece(px, py);
    if (!p) return;

    this.state.draggingGroupId = p.groupId;
    this.bringGroupToFront(p.groupId);
    this.state.dragOffset = {
      x: px - p.x,
      y: py - p.y,
    };
  }

  pointerMove(px: number, py: number) {
    const gid = this.state.draggingGroupId;
    if (gid == null) return;

    const group = this.getGroupPieces(gid).filter((p) => !p.locked);
    if (!group.length) return;

    const anchor = group[group.length - 1];
    const targetX = px - this.state.dragOffset.x;
    const targetY = py - this.state.dragOffset.y;

    const dx = targetX - anchor.x;
    const dy = targetY - anchor.y;

    for (const p of group) {
      p.x += dx;
      p.y += dy;
    }
  }

  pointerUp(): number {
    const gid = this.state.draggingGroupId;
    if (gid == null) return 0;
    this.state.draggingGroupId = null;

    let snapEvents = 0;

    if (this.trySnapGroupToBoard(gid)) snapEvents++;

    let merged = true;
    while (merged) {
      merged = this.trySnapAnyGroups();
      if (merged) snapEvents++;
    }

    this.lockAnyAlignedGroups();
    this.syncState();

    return snapEvents;
  }

  private trySnapGroupToBoard(groupId: number) {
    const thr = this.cfg.snapThreshold;
    const thr2 = thr * thr;

    const group = this.getGroupPieces(groupId).filter((p) => !p.locked);
    if (!group.length) return false;

    for (const p of group) {
      if (p.rotation !== 0) continue;

      if (dist2(p.x, p.y, p.correctX, p.correctY) <= thr2) {
        const dx = p.correctX - p.x;
        const dy = p.correctY - p.y;

        for (const g of group) {
          g.x += dx;
          g.y += dy;
        }

        this.lockGroupIfAligned(groupId);
        this.popPieces(group, 160);
        return true;
      }
    }

    return false;
  }

  private trySnapAnyGroups() {
    const thr = this.cfg.snapThreshold;
    const thr2 = thr * thr;

    const pieces = this.state.pieces.filter((p) => !p.locked);
    const groupMap = new Map<number, Piece[]>();

    for (const p of pieces) {
      if (!groupMap.has(p.groupId)) groupMap.set(p.groupId, []);
      groupMap.get(p.groupId)!.push(p);
    }

    const groupIds = Array.from(groupMap.keys());
    if (groupIds.length <= 1) return false;

    for (let i = 0; i < groupIds.length; i++) {
      for (let j = i + 1; j < groupIds.length; j++) {
        const gA = groupIds[i];
        const gB = groupIds[j];
        const A = groupMap.get(gA)!;
        const B = groupMap.get(gB)!;

        const pair = this.findSnappablePair(A, B, thr2);
        if (!pair) continue;

        const { b, expectedBx, expectedBy } = pair;
        const dx = expectedBx - b.x;
        const dy = expectedBy - b.y;

        for (const pb of B) {
          pb.x += dx;
          pb.y += dy;
        }

        this.mergeGroups(gA, gB);
        const mergedId = Math.min(gA, gB);
        this.lockGroupIfAligned(mergedId);
        this.popPieces(this.getGroupPieces(mergedId).filter((p) => !p.locked), 150);
        return true;
      }
    }

    return false;
  }

  private findSnappablePair(A: Piece[], B: Piece[], thr2: number): null | {
    a: Piece;
    b: Piece;
    expectedBx: number;
    expectedBy: number;
  } {
    for (const a of A) {
      if (a.rotation !== 0) continue;

      for (const b of B) {
        if (b.rotation !== 0) continue;

        const dr = b.row - a.row;
        const dc = b.col - a.col;
        if (Math.abs(dr) + Math.abs(dc) !== 1) continue;

        let expectedBx = b.x;
        let expectedBy = b.y;

        if (dr === 0 && dc === 1) {
          expectedBx = a.x + a.baseW;
          expectedBy = a.y;
        } else if (dr === 0 && dc === -1) {
          expectedBx = a.x - b.baseW;
          expectedBy = a.y;
        } else if (dr === 1 && dc === 0) {
          expectedBx = a.x;
          expectedBy = a.y + a.baseH;
        } else if (dr === -1 && dc === 0) {
          expectedBx = a.x;
          expectedBy = a.y - b.baseH;
        }

        if (dist2(b.x, b.y, expectedBx, expectedBy) <= thr2) {
          return { a, b, expectedBx, expectedBy };
        }
      }
    }

    return null;
  }

  private lockGroupIfAligned(groupId: number) {
    const thr = this.cfg.snapThreshold;
    const thr2 = thr * thr;
    const group = this.getGroupPieces(groupId).filter((p) => !p.locked);

    if (!group.length) return;

    for (const p of group) {
      if (p.rotation !== 0) return;
      if (dist2(p.x, p.y, p.correctX, p.correctY) > thr2) return;
    }

    for (const p of group) {
      p.locked = true;
    }
    this.popPieces(group, 180);
  }

  private lockAnyAlignedGroups() {
    const groups = new Map<number, Piece[]>();

    for (const p of this.state.pieces) {
      if (p.locked) continue;
      if (!groups.has(p.groupId)) groups.set(p.groupId, []);
      groups.get(p.groupId)!.push(p);
    }

    for (const gid of groups.keys()) {
      this.lockGroupIfAligned(gid);
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    const { boardX, boardY, boardW, boardH, showGuide } = this.cfg;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (showGuide) {
      this.renderGuide(ctx);
    }

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(16,22,28,0.22)";
    ctx.beginPath();
    ctx.roundRect(boardX, boardY, boardW, boardH, 20);
    ctx.stroke();
    ctx.restore();

    this.renderGroupHighlights(ctx);

    for (const p of this.state.pieces) {
      this.drawPiece(ctx, p);
    }
  }

  private renderGuide(ctx: CanvasRenderingContext2D) {
    const { boardX, boardY, boardW, boardH } = this.cfg;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(boardX, boardY, boardW, boardH, 20);
    ctx.clip();

    ctx.globalAlpha = 0.14;
    ctx.drawImage(this.boardImageCanvas, boardX, boardY, boardW, boardH);

    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#edf2f6";
    ctx.fillRect(boardX, boardY, boardW, boardH);

    ctx.restore();
  }

  private renderGroupHighlights(ctx: CanvasRenderingContext2D) {
    const map = new Map<number, Piece[]>();

    for (const p of this.state.pieces) {
      if (p.locked) continue;
      if (!map.has(p.groupId)) map.set(p.groupId, []);
      map.get(p.groupId)!.push(p);
    }

    for (const [, arr] of map.entries()) {
      if (arr.length <= 1) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const p of arr) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + this.bboxW(p));
        maxY = Math.max(maxY, p.y + this.bboxH(p));
      }

      ctx.save();
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = "rgba(78,100,121,0.42)";
      ctx.beginPath();
      ctx.roundRect(minX - 8, minY - 8, maxX - minX + 16, maxY - minY + 16, 20);
      ctx.stroke();
      ctx.restore();
    }
  }

  private tracePiecePath(ctx: CanvasRenderingContext2D, p: Piece) {
    if (p.pieceStyle === "jigsaw") {
      jigsawPath(ctx, p.baseW, p.baseH, p.tabs);
      return;
    }

    ctx.beginPath();
    ctx.rect(-p.baseW / 2, -p.baseH / 2, p.baseW, p.baseH);
    ctx.closePath();
  }

  private drawPiece(ctx: CanvasRenderingContext2D, p: Piece) {
    const now = performance.now();
    let scale = 1;

    if (p.popUntil > now) {
      const t = 1 - (p.popUntil - now) / 160;
      scale = 1 + 0.08 * easeOutBack(Math.min(1, Math.max(0, t)));
    }

    const bw = this.bboxW(p);
    const bh = this.bboxH(p);
    const cx = p.x + bw / 2;
    const cy = p.y + bh / 2;

    ctx.save();

    if (!p.locked) {
      ctx.shadowBlur = 18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;
      ctx.shadowColor = "rgba(0,0,0,0.16)";
    }

    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.rotate((p.rotation * Math.PI) / 180);

    this.tracePiecePath(ctx, p);
    ctx.clip();

    const fullDrawX = -(p.col * p.baseW + p.baseW / 2);
    const fullDrawY = -(p.row * p.baseH + p.baseH / 2);

    ctx.drawImage(this.boardImageCanvas, fullDrawX, fullDrawY);

    ctx.shadowBlur = 0;
    ctx.lineWidth = p.locked ? 1.6 : 2;
    ctx.strokeStyle = p.locked ? "rgba(16,20,24,0.18)" : "rgba(16,20,24,0.48)";

    this.tracePiecePath(ctx, p);
    ctx.stroke();

    ctx.restore();
  }
}