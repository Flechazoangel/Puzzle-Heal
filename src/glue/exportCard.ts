type ExportCardOptions = {
  title: string;
  dateText: string;
  difficultyText: string;
  timeText: string;
  sourceText: string;
  signature?: string;
  showTitle?: boolean;
  gradeText?: string;
  starsText?: string;
};

export function exportCardPNG(
  puzzleCanvas: HTMLCanvasElement,
  opts: ExportCardOptions
) {
  const W = 1600;
  const H = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#E8ECEF");
  bg.addColorStop(0.45, "#DDE3E8");
  bg.addColorStop(1, "#D2D9E0");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#7C5244";
  ctx.fillRect(92, 84, 248, 220);

  ctx.fillStyle = "#495B73";
  ctx.beginPath();
  ctx.arc(1392, 176, 112, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#6A5A84";
  ctx.beginPath();
  ctx.moveTo(1268, 388);
  ctx.lineTo(1498, 530);
  ctx.lineTo(1276, 650);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const cardX = 92;
  const cardY = 74;
  const cardW = 1416;
  const cardH = 1044;

  ctx.save();
  ctx.fillStyle = "rgba(250,251,252,0.88)";
  ctx.strokeStyle = "rgba(16,20,24,0.08)";
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, 34);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const imageAreaX = 174;
  const imageAreaY = 174;
  const imageAreaW = 846;
  const imageAreaH = 812;

  ctx.save();
  ctx.fillStyle = "#EEF2F5";
  roundRect(ctx, imageAreaX, imageAreaY, imageAreaW, imageAreaH, 26);
  ctx.fill();

  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 14;
  ctx.shadowColor = "rgba(0,0,0,0.12)";
  roundRect(ctx, imageAreaX, imageAreaY, imageAreaW, imageAreaH, 26);
  ctx.clip();

  const scale = Math.min(
    imageAreaW / puzzleCanvas.width,
    imageAreaH / puzzleCanvas.height
  );
  const dw = puzzleCanvas.width * scale;
  const dh = puzzleCanvas.height * scale;
  const dx = imageAreaX + (imageAreaW - dw) / 2;
  const dy = imageAreaY + (imageAreaH - dh) / 2;

  ctx.drawImage(puzzleCanvas, dx, dy, dw, dh);
  ctx.restore();

  const infoX = 1088;
  const titleY = 204;

  if (opts.showTitle !== false) {
    ctx.fillStyle = "#17202B";
    ctx.font = "900 56px system-ui";
    wrapText(ctx, opts.title, infoX, titleY, 320, 70);
  }

  ctx.fillStyle = "#425364";
  ctx.font = "800 22px system-ui";
  ctx.fillText(opts.sourceText, infoX, opts.showTitle === false ? 236 : 336);

  drawInfoBlock(ctx, infoX, 408, 360, 108, "DATE", opts.dateText);
  drawInfoBlock(ctx, infoX, 540, 300, 108, "DIFFICULTY", opts.difficultyText);
  drawInfoBlock(ctx, infoX, 672, 300, 108, "TIME", opts.timeText);
  drawGradeBlock(
    ctx,
    infoX,
    804,
    360,
    116,
    "GRADE",
    opts.gradeText ?? "A",
    opts.starsText ?? "★★★"
  );

  ctx.fillStyle = "#24313C";
  ctx.font = "900 20px system-ui";
  ctx.fillText(opts.signature ?? "AN 的拼图宇宙", infoX, 964);

  ctx.fillStyle = "#6D7B87";
  ctx.font = "700 17px system-ui";
  ctx.fillText("Made with Puzzle Heal", infoX, 998);

  return canvas.toDataURL("image/png");
}

function drawInfoBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string
) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.strokeStyle = "rgba(16,20,24,0.10)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#637280";
  ctx.font = "900 14px system-ui";
  ctx.fillText(label, x + 20, y + 28);

  ctx.fillStyle = "#1A2430";
  ctx.font = "900 28px system-ui";
  ctx.fillText(value, x + 20, y + 72);
  ctx.restore();
}

function drawGradeBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  grade: string,
  stars: string
) {
  ctx.save();
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "rgba(255,255,255,0.98)");
  grad.addColorStop(1, "rgba(240,245,249,0.98)");
  ctx.fillStyle = grad;
  ctx.strokeStyle = "rgba(16,20,24,0.10)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#637280";
  ctx.font = "900 14px system-ui";
  ctx.fillText(label, x + 20, y + 28);

  ctx.fillStyle = "#1A2430";
  ctx.font = "900 42px system-ui";
  ctx.fillText(grade, x + 20, y + 76);

  ctx.fillStyle = "#405A78";
  ctx.font = "900 22px system-ui";
  ctx.fillText(stars, x + 114, y + 74);
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  let line = "";
  let currentY = y;

  for (let i = 0; i < text.length; i++) {
    const test = line + text[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = text[i];
      currentY += lineHeight;
    } else {
      line = test;
    }
  }

  if (line) ctx.fillText(line, x, currentY);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}