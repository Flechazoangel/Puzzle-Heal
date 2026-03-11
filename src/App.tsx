import { useEffect, useMemo, useRef, useState } from "react";
import {
  getLocalPuzzleAssets,
  loadImageFromFile,
  loadRandomPuzzleAsset,
  normalizeToCanvas,
  type PuzzleAsset,
} from "./puzzle-engine/image";
import { PuzzleEngine } from "./puzzle-engine/engine";
import type {
  EngineSnapshot,
  Piece,
  PieceStyle,
  PuzzleConfig,
} from "./puzzle-engine/types";
import { GlueLayer } from "./glue/glue";
import { exportCardPNG } from "./glue/exportCard";
import { formatDuration, prettyTitleFromFilename } from "./puzzle-engine/utils";

type Screen = "home" | "game";
type Mode = "puzzle" | "glue" | "done";

type PendingLaunch =
  | {
      type: "asset";
      asset: PuzzleAsset;
      img: HTMLImageElement;
    }
  | {
      type: "upload";
      file: File;
      img: HTMLImageElement;
    }
  | null;

type SummaryData = {
  title: string;
  imageTitle: string;
  difficulty: string;
  timeText: string;
  grade: string;
  stars: number;
  hintUsed: number;
  sourceText: string;
  bestText: string;
};

type BestRecord = {
  timeMs: number;
  grade: string;
  stars: number;
};

type BestRecordMap = Record<string, BestRecord>;

function formatToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function readNumberSetting(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const num = raw == null ? NaN : Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function readBoolSetting(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === "1";
}

function readStringSetting(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function readJsonSetting<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getBestKey(imageTitle: string, rows: number, cols: number) {
  return `${imageTitle}__${rows}x${cols}`;
}

function getStageText(mode: Mode, completed: boolean, glueReady: boolean) {
  if (mode === "puzzle") {
    return completed ? "已完成拼图" : "拼图中";
  }
  if (mode === "glue") {
    return glueReady ? "可以装订" : "涂胶中";
  }
  return "已完成";
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const elapsedBaseRef = useRef(0);

  const pointerDownRef = useRef<{
    x: number;
    y: number;
    time: number;
    moved: boolean;
    active: boolean;
  }>({
    x: 0,
    y: 0,
    time: 0,
    moved: false,
    active: false,
  });

  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<Mode>("puzzle");

  const [engine, setEngine] = useState<PuzzleEngine | null>(null);
  const [imageCanvas, setImageCanvas] = useState<HTMLCanvasElement | null>(null);
  const [glue, setGlue] = useState<GlueLayer | null>(null);

  const [rows, setRows] = useState(() => readNumberSetting("pz_rows", 8));
  const [cols, setCols] = useState(() => readNumberSetting("pz_cols", 8));
  const [customRows, setCustomRows] = useState(() => readStringSetting("pz_custom_rows", "6"));
  const [customCols, setCustomCols] = useState(() => readStringSetting("pz_custom_cols", "6"));
  const [useCustomSize, setUseCustomSize] = useState(() => readBoolSetting("pz_use_custom", false));

  const [randomRotation, setRandomRotation] = useState(() => readBoolSetting("pz_rotation", true));
  const [showGuide, setShowGuide] = useState(() => readBoolSetting("pz_guide", true));
  const [pieceStyle, setPieceStyle] = useState<PieceStyle>(() => {
    const v = readStringSetting("pz_piece_style", "jigsaw");
    return v === "rect" ? "rect" : "jigsaw";
  });

  const [title, setTitle] = useState("今日拼图");
  const [imageTitle, setImageTitle] = useState("Untitled");
  const [sourceText, setSourceText] = useState("本地图片");

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [brushPos, setBrushPos] = useState<{ x: number; y: number } | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const [localAssets, setLocalAssets] = useState<PuzzleAsset[]>([]);
  const [gallerySearch, setGallerySearch] = useState("");
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch>(null);

  const [showExportTitle, setShowExportTitle] = useState(() => readBoolSetting("pz_export_title", true));
  const [starLevel, setStarLevel] = useState(0);
  const [gradeLabel, setGradeLabel] = useState("C");
  const [hintUsed, setHintUsed] = useState(0);

  const [playCount, setPlayCount] = useState(() => readNumberSetting("pz_play_count", 0));
  const [bestRecords, setBestRecords] = useState<BestRecordMap>(() =>
    readJsonSetting<BestRecordMap>("pz_best_records", {})
  );
  const [showPreview, setShowPreview] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [glueReadyNotified, setGlueReadyNotified] = useState(false);

  const [, setUiTick] = useState(0);

  function bumpUI() {
    setUiTick((v) => v + 1);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 1600);
  }

  function playSnapSound() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.06);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch {
      //
    }
  }

  function resetTimer() {
    elapsedBaseRef.current = 0;
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setFinalElapsedMs(null);
    setIsPaused(false);
  }

  function getCurrentElapsed() {
    if (finalElapsedMs != null) return finalElapsedMs;
    if (startedAtRef.current == null) return elapsedBaseRef.current;
    return elapsedBaseRef.current + (performance.now() - startedAtRef.current);
  }

  function pauseTimer() {
    if (startedAtRef.current == null) return;
    elapsedBaseRef.current += performance.now() - startedAtRef.current;
    startedAtRef.current = null;
    setElapsedMs(elapsedBaseRef.current);
    setIsPaused(true);
  }

  function resumeTimer() {
    if (finalElapsedMs != null) return;
    startedAtRef.current = performance.now();
    setIsPaused(false);
  }

  function leaveToHome() {
    setScreen("home");
    setMode("puzzle");
    setGlue(null);
    setExportUrl(null);
    setBrushPos(null);
    setIsPaused(false);
    setShowPreview(false);
    setShowSummary(false);
    setFocusMode(false);
  }

  function evaluatePerformance(timeMs: number, hintCount: number, totalCount: number) {
    const sec = Math.max(1, Math.floor(timeMs / 1000));

    let stars = 1;
    if (totalCount <= 9 && sec <= 90) stars = 3;
    else if (totalCount <= 16 && sec <= 180) stars = 3;
    else if (totalCount <= 64 && sec <= 480) stars = 3;
    else if (sec <= totalCount * 12) stars = 2;

    const localHintLimit = Math.max(1, Math.round(totalCount / 5));
    const hintRate = hintCount / localHintLimit;

    let grade = "C";
    if (stars === 3 && hintRate <= 0.34) grade = "S";
    else if (stars >= 2 && hintRate <= 0.67) grade = "A";
    else if (hintRate <= 1) grade = "B";

    return { stars, grade };
  }

  function updateBestRecord(timeMs: number, grade: string, stars: number) {
    const key = getBestKey(imageTitle, rows, cols);
    const current = bestRecords[key];
    const shouldUpdate =
      !current ||
      timeMs < current.timeMs ||
      (timeMs === current.timeMs && stars > current.stars);

    if (!shouldUpdate) return current ?? null;

    const next: BestRecordMap = {
      ...bestRecords,
      [key]: { timeMs, grade, stars },
    };
    setBestRecords(next);
    return next[key];
  }

  function getBestRecordText() {
    const record = bestRecords[getBestKey(imageTitle, rows, cols)];
    if (!record) return "—";
    return `${formatDuration(record.timeMs)} · ${"★".repeat(record.stars)} · ${record.grade}`;
  }

  function tidyLoosePiecesLeft() {
    if (!engine) return;

    const board = engine.getBoardRect();
    const pieces = engine.state.pieces.filter((p) => !p.locked);
    if (!pieces.length) return;

    const pad = 16;
    const leftStartX = pad;
    const leftLimitX = Math.max(120, board.x - 26);
    const topStartY = 108;
    const bottomLimitY = board.y + board.h - 8;

    let xCursor = leftStartX;
    let yCursor = topStartY;
    let lineMaxH = 0;

    const pieceBox = (p: Piece) => {
      const rotSwap = p.rotation === 90 || p.rotation === 270;
      const outerW = (rotSwap ? p.baseH : p.baseW) + p.visualPadding * 2;
      const outerH = (rotSwap ? p.baseW : p.baseH) + p.visualPadding * 2;
      return { w: outerW, h: outerH };
    };

    for (const p of pieces) {
      const { w, h } = pieceBox(p);

      if (xCursor + w > leftLimitX) {
        xCursor = leftStartX;
        yCursor += lineMaxH + 12;
        lineMaxH = 0;
      }

      if (yCursor + h > bottomLimitY) {
        yCursor = topStartY;
        xCursor += 26;
      }

      p.x = xCursor;
      p.y = yCursor;
      p.popUntil = performance.now() + 180;

      xCursor += w + 12;
      lineMaxH = Math.max(lineMaxH, h);
    }

    redraw();
    bumpUI();
    showToast("已整理");
  }

  useEffect(() => {
    setLocalAssets(getLocalPuzzleAssets());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("pz_rows", String(rows));
    window.localStorage.setItem("pz_cols", String(cols));
    window.localStorage.setItem("pz_custom_rows", customRows);
    window.localStorage.setItem("pz_custom_cols", customCols);
    window.localStorage.setItem("pz_use_custom", useCustomSize ? "1" : "0");
    window.localStorage.setItem("pz_rotation", randomRotation ? "1" : "0");
    window.localStorage.setItem("pz_guide", showGuide ? "1" : "0");
    window.localStorage.setItem("pz_piece_style", pieceStyle);
    window.localStorage.setItem("pz_export_title", showExportTitle ? "1" : "0");
  }, [rows, cols, customRows, customCols, useCustomSize, randomRotation, showGuide, pieceStyle, showExportTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("pz_best_records", JSON.stringify(bestRecords));
  }, [bestRecords]);

  useEffect(() => {
    if (screen !== "game") return;
    if (mode === "done") return;
    if (isPaused) return;

    const id = window.setInterval(() => {
      setElapsedMs(getCurrentElapsed());
    }, 250);

    return () => window.clearInterval(id);
  }, [screen, mode, isPaused, finalElapsedMs]);

  function resizeCanvasToContainer() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement!;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  useEffect(() => {
    if (screen !== "game") return;

    const raf = requestAnimationFrame(() => {
      resizeCanvasToContainer();
      if (imageCanvas && !pendingLaunch) {
        recreateEnginePreservingState();
      } else {
        redraw();
      }
    });

    const onResize = () => {
      resizeCanvasToContainer();
      if (imageCanvas) {
        recreateEnginePreservingState();
      } else {
        redraw();
      }
    };

    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [screen, imageCanvas, pendingLaunch]);

  useEffect(() => {
    if (screen !== "game") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = mode === "glue" ? "none" : "default";
  }, [screen, mode]);

  useEffect(() => {
    if (screen !== "game") return;
    redraw();
  }, [engine, glue, mode, brushPos]);

  useEffect(() => {
    if (screen !== "game" || !pendingLaunch || !canvasRef.current) return;

    const run = async () => {
      resizeCanvasToContainer();

      if (pendingLaunch.type === "asset") {
        const normalized = normalizeToCanvas(pendingLaunch.img, 1600);
        setImageCanvas(normalized);
        setImageTitle(pendingLaunch.asset.title);
        setTitle(pendingLaunch.asset.title);
        setSourceText(pendingLaunch.asset.source === "remote" ? "远程图片" : "本地图片");

        createEngineFromImageCanvas(normalized, {
          rows,
          cols,
          randomRotation,
          showGuide,
          pieceStyle,
        });

        resetTimer();
        setStarLevel(0);
        setGradeLabel("C");
        setHintUsed(0);
        setShowSummary(false);
        setSummaryData(null);
        setShowPreview(false);
        setGlueReadyNotified(false);
      } else {
        const normalized = normalizeToCanvas(pendingLaunch.img, 1600);
        const name = prettyTitleFromFilename(pendingLaunch.file.name);

        setImageCanvas(normalized);
        setImageTitle(name);
        setTitle(name);
        setSourceText("用户上传");

        createEngineFromImageCanvas(normalized, {
          rows,
          cols,
          randomRotation,
          showGuide,
          pieceStyle,
        });

        resetTimer();
        setStarLevel(0);
        setGradeLabel("C");
        setHintUsed(0);
        setShowSummary(false);
        setSummaryData(null);
        setShowPreview(false);
        setGlueReadyNotified(false);
      }

      setPendingLaunch(null);
      bumpUI();
    };

    const raf = requestAnimationFrame(() => {
      void run();
    });

    return () => cancelAnimationFrame(raf);
  }, [screen, pendingLaunch]);

  useEffect(() => {
    if (mode !== "done" || finalElapsedMs == null) return;
    const score = evaluatePerformance(finalElapsedMs, hintUsed, rows * cols);
    setStarLevel(score.stars);
    setGradeLabel(score.grade);
  }, [mode, finalElapsedMs, rows, cols, hintUsed]);

  const percentGlue = glue?.getCoveragePercent() ?? 0;
  const glueReady = glue?.isReadyToBind() ?? false;

  useEffect(() => {
    if (mode !== "glue") return;
    if (!glueReady || glueReadyNotified) return;
    setGlueReadyNotified(true);
    showToast("可以装订");
  }, [mode, glueReady, glueReadyNotified]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screen !== "game") return;

      if (e.key.toLowerCase() === "g") {
        const next = !showGuide;
        setShowGuide(next);
        if (imageCanvas) {
          createEngineFromImageCanvas(imageCanvas, {
            rows,
            cols,
            randomRotation,
            showGuide: next,
            pieceStyle,
          });
        }
      }

      if (e.key.toLowerCase() === "t") {
        tidyLoosePiecesLeft();
      }

      if (e.key.toLowerCase() === "p") {
        if (isPaused) resumeTimer();
        else pauseTimer();
      }

      if (e.key.toLowerCase() === "h" && mode === "puzzle") {
        useHint();
      }

      if (e.key.toLowerCase() === "v") {
        setShowPreview((v) => !v);
      }

      if (e.key.toLowerCase() === "f") {
        toggleFocusMode();
      }

      if (e.key === "Enter" && mode === "glue" && glue?.isReadyToBind()) {
        bindNow();
      }

      if (e.key === "Escape") {
        setShowPreview(false);
        setShowSummary(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    screen,
    mode,
    glue,
    imageCanvas,
    rows,
    cols,
    randomRotation,
    pieceStyle,
    showGuide,
    isPaused,
    hintUsed,
    glueReady,
    engine,
    focusMode,
  ]);

  function computeBoardRect(imgW: number, imgH: number) {
    const canvas = canvasRef.current!;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    const sidePad = 28;
    const topPad = 112;
    const bottomPad = 96;

    const availableW = Math.max(360, cssW - sidePad * 2);
    const availableH = Math.max(280, cssH - topPad - bottomPad);
    const maxBoardW = availableW * 0.9;
    const maxBoardH = availableH * 0.9;
    const aspect = imgW / imgH;

    let boardW = maxBoardW;
    let boardH = boardW / aspect;

    if (boardH > maxBoardH) {
      boardH = maxBoardH;
      boardW = boardH * aspect;
    }

    const boardX = Math.round((cssW - boardW) / 2);
    const boardY = Math.round((cssH - boardH) / 2 - 4);

    return {
      boardX: Math.max(sidePad, boardX),
      boardY: Math.max(topPad, boardY),
      boardW,
      boardH,
      canvasW: cssW,
      canvasH: cssH,
    };
  }

  function createEngineFromImageCanvas(
    imgCanvas: HTMLCanvasElement,
    overrides?: Partial<{
      rows: number;
      cols: number;
      randomRotation: boolean;
      showGuide: boolean;
      pieceStyle: PieceStyle;
    }>,
    snapshot?: EngineSnapshot | null
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const nextRows = overrides?.rows ?? rows;
    const nextCols = overrides?.cols ?? cols;
    const nextRandomRotation = overrides?.randomRotation ?? randomRotation;
    const nextShowGuide = overrides?.showGuide ?? showGuide;
    const nextPieceStyle = overrides?.pieceStyle ?? pieceStyle;

    const { boardX, boardY, boardW, boardH, canvasW, canvasH } = computeBoardRect(
      imgCanvas.width,
      imgCanvas.height
    );

    const cfg: PuzzleConfig = {
      rows: nextRows,
      cols: nextCols,
      canvasW,
      canvasH,
      boardX,
      boardY,
      boardW,
      boardH,
      snapThreshold: Math.max(10, Math.min(24, (boardW / nextCols) * 0.22)),
      scatterPadding: 20,
      randomRotation: nextRandomRotation,
      showGuide: nextShowGuide,
      pieceStyle: nextPieceStyle,
    };

    const eng = new PuzzleEngine({
      imageCanvas: imgCanvas,
      config: cfg,
    });

    if (snapshot) {
      eng.restoreSnapshot(snapshot);
    }

    setEngine(eng);

    if (!snapshot) {
      setMode("puzzle");
      setGlue(null);
      setExportUrl(null);
      setBrushPos(null);
      setGlueReadyNotified(false);
    }

    eng.render(ctx);
    bumpUI();
    return eng;
  }

  function recreateEnginePreservingState() {
    if (!imageCanvas) return;
    const snapshot = engine?.createSnapshot() ?? null;
    const nextEngine = createEngineFromImageCanvas(
      imageCanvas,
      {
        rows,
        cols,
        randomRotation,
        showGuide,
        pieceStyle,
      },
      snapshot
    );

    if (!nextEngine) return;

    if (mode === "glue") {
      const board = nextEngine.getBoardRect();
      const nextGlue = new GlueLayer(
        board,
        { w: canvasRef.current?.clientWidth ?? board.w, h: canvasRef.current?.clientHeight ?? board.h },
        {
          brushRadius: Math.max(14, Math.min(28, board.w / 34)),
          targetCoverage: 0.94,
        }
      );
      setGlue(nextGlue);
      setBrushPos((prev) =>
        prev
          ? {
              x: board.x + board.w / 2,
              y: board.y + board.h / 2,
            }
          : null
      );
    }
  }

  function toggleFocusMode() {
    const snapshot = engine?.createSnapshot() ?? null;
    setFocusMode((prev) => !prev);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resizeCanvasToContainer();
        if (imageCanvas) {
          createEngineFromImageCanvas(
            imageCanvas,
            {
              rows,
              cols,
              randomRotation,
              showGuide,
              pieceStyle,
            },
            snapshot
          );
        } else {
          redraw();
        }
      });
    });
  }

  async function startFromAsset(asset: PuzzleAsset, img: HTMLImageElement) {
    setScreen("game");
    setPendingLaunch({ type: "asset", asset, img });
    setPlayCount((v) => {
      const next = v + 1;
      window.localStorage.setItem("pz_play_count", String(next));
      return next;
    });
  }

  async function startWithRandomImage() {
    try {
      const { asset, img } = await loadRandomPuzzleAsset();
      await startFromAsset(asset, img);
    } catch (err) {
      console.error(err);
      showToast("加载失败");
    }
  }

  async function startFromSpecificAsset(asset: PuzzleAsset) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = asset.url;
      });
      await startFromAsset(asset, img);
    } catch {
      showToast("加载失败");
    }
  }

  async function onUpload(file: File) {
    try {
      const img = await loadImageFromFile(file);
      setPlayCount((v) => {
        const next = v + 1;
        window.localStorage.setItem("pz_play_count", String(next));
        return next;
      });
      setScreen("game");
      setPendingLaunch({ type: "upload", file, img });
    } catch (err) {
      console.error(err);
      showToast("加载失败");
    }
  }

  function renderGlueHUD(percent: number) {
    return (
      <div className="glueHUD">
        <div className="glueTop">
          <span>胶水</span>
          <span>{percent}%</span>
        </div>
        <div className="glueBar">
          <div className="glueFill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;

    const ctx = canvas.getContext("2d")!;
    if (mode === "glue" && glue) {
      renderBackSideFlipped(ctx, engine);
      glue.renderBehind(ctx);
      renderBrushIndicator(ctx, glue);
      if (glue.isReadyToBind()) {
        renderReadySparkle(ctx, engine.getBoardRect());
      }
    } else {
      engine.render(ctx);
    }
  }

  function renderBackSideFlipped(ctx: CanvasRenderingContext2D, eng: PuzzleEngine) {
    const board = eng.getBoardRect();
    const img = eng.getBoardImageCanvas();

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.save();
    ctx.fillStyle = "#d2dee8";
    ctx.beginPath();
    ctx.roundRect(board.x, board.y, board.w, board.h, 18);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(16,20,24,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(board.x, board.y, board.w, board.h, 18);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(board.x, board.y, board.w, board.h, 18);
    ctx.clip();

    const cx = board.x + board.w / 2;
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
    ctx.drawImage(img, board.x, board.y, board.w, board.h);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#eff4f8";
    ctx.fillRect(board.x, board.y, board.w, board.h);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#415261";
    for (let y = board.y; y < board.y + board.h; y += 8) {
      ctx.fillRect(board.x, y, board.w, 1);
    }

    ctx.restore();
  }

  function renderBrushIndicator(ctx: CanvasRenderingContext2D, g: GlueLayer) {
    if (!brushPos) return;
    const r = g.getBrushRadius();

    ctx.save();
    ctx.beginPath();
    ctx.arc(brushPos.x, brushPos.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(16,20,24,0.92)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function renderReadySparkle(
    ctx: CanvasRenderingContext2D,
    board: { x: number; y: number; w: number; h: number }
  ) {
    const t = performance.now() / 1000;
    const alpha = 0.26 + 0.18 * Math.sin(t * 6);

    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 5;
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(board.x - 3, board.y - 3, board.w + 6, board.h + 6, 24);
    ctx.stroke();
    ctx.restore();

    drawSpark(ctx, board.x + 24, board.y + 24, 16);
    drawSpark(ctx, board.x + board.w - 28, board.y + 24, 14);
    drawSpark(ctx, board.x + board.w - 24, board.y + board.h - 28, 18);
  }

  function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2.2;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(-r * 0.62, -r * 0.62);
    ctx.lineTo(r * 0.62, r * 0.62);
    ctx.moveTo(-r * 0.62, r * 0.62);
    ctx.lineTo(r * 0.62, -r * 0.62);
    ctx.stroke();
    ctx.restore();
  }

  function getPointerPos(e: PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  useEffect(() => {
    if (screen !== "game") return;
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;

    const onDown = (ev: PointerEvent) => {
      if (isPaused) return;
      const { x, y } = getPointerPos(ev);

      pointerDownRef.current = {
        x,
        y,
        time: performance.now(),
        moved: false,
        active: true,
      };

      if (mode === "glue" && glue) {
        glue.pointerDown(x, y);
        setBrushPos({ x, y });
        canvas.setPointerCapture(ev.pointerId);
        redraw();
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (isPaused) return;
      const { x, y } = getPointerPos(ev);

      if (mode === "glue" && glue) {
        glue.pointerMove(x, y);
        setBrushPos({ x, y });
        redraw();
        return;
      }

      if (mode !== "puzzle") return;
      if (!pointerDownRef.current.active) return;

      const dx = x - pointerDownRef.current.x;
      const dy = y - pointerDownRef.current.y;
      const dist = Math.hypot(dx, dy);

      if (!pointerDownRef.current.moved && dist > 6) {
        pointerDownRef.current.moved = true;
        engine.pointerDown(pointerDownRef.current.x, pointerDownRef.current.y);
      }

      if (pointerDownRef.current.moved) {
        engine.pointerMove(x, y);
        redraw();
      }
    };

    const onUp = () => {
      if (mode === "glue" && glue) {
        glue.pointerUp();
        redraw();
        return;
      }

      if (mode !== "puzzle") return;
      if (isPaused) return;
      if (!pointerDownRef.current.active) return;

      const clickDuration = performance.now() - pointerDownRef.current.time;

      if (!pointerDownRef.current.moved && clickDuration < 220) {
        const rotated = engine.rotateTopPieceAt(pointerDownRef.current.x, pointerDownRef.current.y);
        if (rotated) {
          redraw();
          bumpUI();
        }
      } else {
        const events = engine.pointerUp();
        if (events > 0) playSnapSound();
        redraw();
        bumpUI();
      }

      pointerDownRef.current.active = false;
    };

    const onLeave = () => {
      if (mode === "glue") {
        setBrushPos(null);
      }
    };

    const onEnter = () => {
      if (mode === "glue" && engine) {
        const board = engine.getBoardRect();
        if (!brushPos) {
          setBrushPos({
            x: board.x + board.w / 2,
            y: board.y + board.h / 2,
          });
        }
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerenter", onEnter);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerenter", onEnter);
    };
  }, [screen, engine, mode, glue, isPaused, brushPos]);

  function restartScatter() {
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows,
      cols,
      randomRotation,
      showGuide,
      pieceStyle,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
    setGlueReadyNotified(false);
    showToast("已重开");
  }

  function replaySameImage() {
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows,
      cols,
      randomRotation,
      showGuide,
      pieceStyle,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
    setGlueReadyNotified(false);
    showToast("再来一局");
  }

  function applyDifficulty(r: number, c: number) {
    setUseCustomSize(false);
    setRows(r);
    setCols(c);
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows: r,
      cols: c,
      randomRotation,
      showGuide,
      pieceStyle,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
  }

  function applyCustomDifficulty() {
    const r = Math.max(2, Math.min(20, Number(customRows) || 6));
    const c = Math.max(2, Math.min(20, Number(customCols) || 6));
    setUseCustomSize(true);
    setRows(r);
    setCols(c);
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows: r,
      cols: c,
      randomRotation,
      showGuide,
      pieceStyle,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
  }

  function applyRotation(next: boolean) {
    setRandomRotation(next);
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows,
      cols,
      randomRotation: next,
      showGuide,
      pieceStyle,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
  }

  function applyGuide(next: boolean) {
    setShowGuide(next);
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows,
      cols,
      randomRotation,
      showGuide: next,
      pieceStyle,
    });
    bumpUI();
  }

  function applyPieceStyle(next: PieceStyle) {
    setPieceStyle(next);
    if (!imageCanvas) return;
    createEngineFromImageCanvas(imageCanvas, {
      rows,
      cols,
      randomRotation,
      showGuide,
      pieceStyle: next,
    });
    resetTimer();
    setStarLevel(0);
    setGradeLabel("C");
    setHintUsed(0);
    setShowSummary(false);
    setSummaryData(null);
  }

  function enterGlueStage() {
    if (!engine) return;

    if (!engine.state.completed) {
      showToast("先完成拼图");
      return;
    }

    const canvas = canvasRef.current!;
    const board = engine.getBoardRect();

    const g = new GlueLayer(
      board,
      { w: canvas.clientWidth, h: canvas.clientHeight },
      {
        brushRadius: Math.max(14, Math.min(28, board.w / 34)),
        targetCoverage: 0.94,
      }
    );

    setGlue(g);
    setMode("glue");
    setExportUrl(null);
    setBrushPos({
      x: board.x + board.w / 2,
      y: board.y + board.h / 2,
    });
    setGlueReadyNotified(false);
    redraw();
    bumpUI();
  }

  function bindNow() {
    if (!glue) return;
    if (!glue.isReadyToBind()) {
      showToast("还差一点");
      return;
    }

    const activeGlue = glue;
    activeGlue.finalize();

    const tick = () => {
      redraw();

      if (activeGlue.isBindAnimationDone()) {
        const final = getCurrentElapsed();
        const score = evaluatePerformance(final, hintUsed, rows * cols);

        setFinalElapsedMs(final);
        setElapsedMs(final);
        startedAtRef.current = null;
        setMode("done");
        setGlue(null);
        setBrushPos(null);
        setStarLevel(score.stars);
        setGradeLabel(score.grade);

        const best = updateBestRecord(final, score.grade, score.stars);
        const bestText = best
          ? `${formatDuration(best.timeMs)} · ${"★".repeat(best.stars)} · ${best.grade}`
          : `${formatDuration(final)} · ${"★".repeat(score.stars)} · ${score.grade}`;

        exportWork(final, score.grade, score.stars);

        setSummaryData({
          title,
          imageTitle,
          difficulty: `${rows} × ${cols}`,
          timeText: formatDuration(final),
          grade: score.grade,
          stars: score.stars,
          hintUsed,
          sourceText,
          bestText,
        });
        setShowSummary(true);

        bumpUI();
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  function exportWork(timeMs: number, grade: string, stars: number) {
    if (!engine) return;

    const img = engine.getImageCanvas();
    const puzzle = document.createElement("canvas");
    puzzle.width = img.width;
    puzzle.height = img.height;

    const pctx = puzzle.getContext("2d")!;
    pctx.drawImage(img, 0, 0);

    const url = exportCardPNG(puzzle, {
      title,
      dateText: formatToday(),
      difficultyText: `${rows} × ${cols}`,
      timeText: formatDuration(timeMs),
      sourceText: `${imageTitle} · ${sourceText}`,
      signature: "AN 的拼图宇宙",
      showTitle: showExportTitle,
      gradeText: grade,
      starsText: "★".repeat(stars),
    });

    setExportUrl(url);
  }

  async function copyExportImage() {
    if (!exportUrl) return;
    try {
      const res = await fetch(exportUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      showToast("已复制");
    } catch {
      showToast("复制失败");
    }
  }

  function useHint() {
    if (mode !== "puzzle" || !engine) return;
    if (hintUsed >= hintLimit) {
      showToast("提示已用完");
      return;
    }
    if (engine.placeOneHintPiece()) {
      setHintUsed((v) => v + 1);
      redraw();
      bumpUI();
      showToast("已提示");
    }
  }

  function handleFocusNextStep() {
    if (mode === "puzzle" && (engine?.state.completed ?? false)) {
      enterGlueStage();
      return;
    }
    if (mode === "glue" && glueReady) {
      bindNow();
    }
  }

  const displayElapsedMs = finalElapsedMs ?? elapsedMs;
  const progressText = engine
    ? `${engine.state.lockedCount}/${engine.state.totalCount}`
    : "--/--";
  const progressPercent = engine
    ? Math.round((engine.state.lockedCount / engine.state.totalCount) * 100)
    : 0;

  const filteredAssets = localAssets.filter((item) =>
    item.title.toLowerCase().includes(gallerySearch.trim().toLowerCase())
  );

  const galleryTotalCount = filteredAssets.length;

  const diffButtons = [
    { r: 3, c: 3, label: "3×3" },
    { r: 4, c: 4, label: "4×4" },
    { r: 8, c: 8, label: "8×8" },
  ];

  const hintLimit = Math.max(1, Math.round((engine?.state.totalCount ?? rows * cols) / 5));
  const hintRemain = Math.max(0, hintLimit - hintUsed);

  const stageInfo = useMemo(() => {
    if (mode === "puzzle") {
      return {
        title: engine?.state.completed ? "拼图完成" : "正在拼图",
        desc: engine?.state.completed
          ? "已经可以进入下一步定型"
          : "拖动拼块，点击可旋转，拼好后进入定型",
        pill: `${progressPercent}%`,
      };
    }

    if (mode === "glue") {
      return {
        title: "正在定型",
        desc: glueReady ? "覆盖率足够，现在可以直接装订" : "给背面涂满胶水后即可装订",
        pill: `${percentGlue}%`,
      };
    }

    return {
      title: "作品完成",
      desc: "拼图已经完成，可以导出作品图或再来一局",
      pill: "DONE",
    };
  }, [mode, progressPercent, percentGlue, engine?.state.completed, glueReady]);

  const finishEnabled = mode === "puzzle" && (engine?.state.completed ?? false);

  const homeDifficultyText = useCustomSize
    ? `${Math.max(2, Math.min(20, Number(customRows) || 6))} × ${Math.max(
        2,
        Math.min(20, Number(customCols) || 6)
      )}`
    : `${rows} × ${cols}`;

  if (screen === "home") {
    return (
      <div className="home">
        <div className="homeShell">
          <div className="sidebar">
            <div className="brandRow">
              <div className="logo">
                <div className="logoMark" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <rect x="2" y="2" width="10" height="10" rx="3" fill="#405A78" />
                    <rect x="16" y="3" width="10" height="10" rx="3" fill="#557866" />
                    <path d="M3 19 L11 19 L7 26 Z" fill="#9A5A46" />
                    <circle cx="20" cy="21" r="5" fill="#fff" />
                    <circle cx="20" cy="21" r="3.2" fill="#25384C" />
                  </svg>
                </div>
                <div className="logoText">
                  <div className="name">Puzzle Heal</div>
                  <div className="tag">AN 的拼图宇宙</div>
                </div>
              </div>
              <span className="badge">START</span>
            </div>

            <div className="scrollSidebar">
              <div className="toolbarGroup">
                <div className="section">
                  <div className="label">难度</div>
                  <div className="row">
                    {diffButtons.map((b) => (
                      <button
                        key={b.label}
                        className={`btn ${!useCustomSize && rows === b.r && cols === b.c ? "btnSelected" : ""}`}
                        onClick={() => {
                          setUseCustomSize(false);
                          setRows(b.r);
                          setCols(b.c);
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                    <button
                      className={`btn ${useCustomSize ? "btnSelected" : ""}`}
                      onClick={() => setUseCustomSize(true)}
                    >
                      自定义
                    </button>
                  </div>

                  {useCustomSize && (
                    <div className="customGrid">
                      <input
                        className="textInput"
                        value={customRows}
                        onChange={(e) => setCustomRows(e.target.value)}
                        placeholder="行"
                      />
                      <input
                        className="textInput"
                        value={customCols}
                        onChange={(e) => setCustomCols(e.target.value)}
                        placeholder="列"
                      />
                    </div>
                  )}
                </div>

                <div className="section">
                  <div className="label">样式</div>
                  <div className="row">
                    <button
                      className={`btn ${pieceStyle === "jigsaw" ? "btnSelected" : ""}`}
                      onClick={() => setPieceStyle("jigsaw")}
                    >
                      异形
                    </button>
                    <button
                      className={`btn ${pieceStyle === "rect" ? "btnSelected" : ""}`}
                      onClick={() => setPieceStyle("rect")}
                    >
                      矩形
                    </button>
                  </div>
                </div>

                <div className="section">
                  <div className="switchLabel">旋转</div>
                  <div className="switchRow">
                    <button
                      className={`switch ${randomRotation ? "on" : ""}`}
                      onClick={() => setRandomRotation((v) => !v)}
                    />
                  </div>
                </div>

                <div className="section">
                  <div className="switchLabel">底图</div>
                  <div className="switchRow">
                    <button
                      className={`switch ${showGuide ? "on" : ""}`}
                      onClick={() => setShowGuide((v) => !v)}
                    />
                  </div>
                </div>
              </div>

              <div className="divider" />

              <div className="homeActions">
                <input
                  className="fileInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void onUpload(f);
                  }}
                />
                <button
                  className="btn btnPink"
                  onClick={() => {
                    if (useCustomSize) {
                      const r = Math.max(2, Math.min(20, Number(customRows) || 6));
                      const c = Math.max(2, Math.min(20, Number(customCols) || 6));
                      setRows(r);
                      setCols(c);
                    }
                    void startWithRandomImage();
                  }}
                >
                  随机开玩
                </button>
              </div>
            </div>

            <div className="homeFootMeta">
              <span>AN</span>
              <span>·</span>
              <span>本地游玩 {playCount}</span>
            </div>
          </div>

          <div className="homeGallery">
            <div className="galleryHeader">
              <div className="galleryTitleRow">
                <div className="galleryTitle">Gallery</div>
                <span className="galleryCount">共 {galleryTotalCount} 张图片</span>
              </div>
              <span className="badge">{homeDifficultyText}</span>
            </div>  

            <div className="galleryToolbar">
              <input
                className="gallerySearch"
                value={gallerySearch}
                onChange={(e) => setGallerySearch(e.target.value)}
                placeholder="搜索"
              />
            </div>

            <div className="galleryScroll">
              <div className="galleryGrid">
                {filteredAssets.length > 0 ? (
                  filteredAssets.map((asset) => (
                    <button
                      key={asset.title}
                      className="galleryCard"
                      onClick={() => startFromSpecificAsset(asset)}
                    >
                      <div className="galleryThumb">
                        <img src={asset.url} alt={asset.title} />
                      </div>
                      <div className="mask" />
                      <div className="cap">{asset.title}</div>
                    </button>
                  ))
                ) : (
                  <div className="galleryCard emptyCard">
                    <div className="emptyText">空空的</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {toast && <div className="toast toastFixed">{toast}</div>}
      </div>
    );
  }

  return (
    <div className={`app ${focusMode ? "focusMode" : ""}`}>
      {!focusMode && (
        <div className="sidebar">
          <div className="brandRow">
            <div className="logo">
              <div className="logoMark" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="2" y="2" width="10" height="10" rx="3" fill="#405A78" />
                  <rect x="16" y="3" width="10" height="10" rx="3" fill="#557866" />
                  <path d="M3 19 L11 19 L7 26 Z" fill="#9A5A46" />
                  <circle cx="20" cy="21" r="5" fill="#fff" />
                  <circle cx="20" cy="21" r="3.2" fill="#25384C" />
                </svg>
              </div>
              <div className="logoText">
                <div className="name">Puzzle Heal</div>
                <div className="tag">AN 的拼图宇宙</div>
              </div>
            </div>
            <span className="badge">{mode === "puzzle" ? "PLAY" : mode === "glue" ? "GLUE" : "DONE"}</span>
          </div>

          <div className="scrollSidebar">
            <div className="statGrid">
              <div className="statCard">
                <div className="k">进度</div>
                <div className="v">{progressText}</div>
              </div>
              <div className="statCard">
                <div className="k">计时</div>
                <div className="v">{formatDuration(displayElapsedMs)}</div>
                <div className="timeMiniActions">
                  <button
                    className={`btn iconBtn ${isPaused ? "btnPurple" : ""}`}
                    onClick={() => {
                      if (isPaused) resumeTimer();
                      else pauseTimer();
                    }}
                  >
                    {isPaused ? "继续" : "暂停"}
                  </button>
                </div>
              </div>
            </div>

            <div className="statGrid compactGrid">
              <div className="statCard">
                <div className="k">提示</div>
                <div className="v smallValue">
                  {hintRemain}/{hintLimit}
                </div>
              </div>
              <div className="statCard">
                <div className="k">最好</div>
                <div className="v smallValue">{getBestRecordText()}</div>
              </div>
            </div>

            <div className="toolbarGroup">
              <div className="row">
                <button className="btn btnDanger" onClick={leaveToHome}>
                  返回主页
                </button>

                <button className="btn btnPink" onClick={startWithRandomImage}>
                  换一张
                </button>
              </div>

              <div className="row">
                {mode === "puzzle" && (
                  <button
                    className={finishEnabled ? "btn btnGreen" : "btn btnGreen btnDisabled"}
                    onClick={enterGlueStage}
                  >
                    完成并定型
                  </button>
                )}

                {mode === "glue" && (
                  <button
                    className={glueReady ? "btn btnGreen btnGlow" : "btn btnGreen btnDisabled"}
                    onClick={bindNow}
                  >
                    装订定型
                  </button>
                )}
              </div>

              <div className="row">
                <button className="btn btnWarning" onClick={replaySameImage}>
                  同图重玩
                </button>
                <button className="btn btnDanger" onClick={restartScatter}>
                  重新打散
                </button>
              </div>

              {exportUrl && (
                <div className="row">
                  <a className="link" href={exportUrl} download={`${title}-${formatToday()}.png`}>
                    下载作品图
                  </a>
                  <button className="btn btnPurple" onClick={copyExportImage}>
                    复制作品图
                  </button>
                </div>
              )}
            </div>

            <div className="section titleSection">
              <div className="label">作品名</div>
              <input
                className="textInput"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="toolbarGroup">
              <div className="row">
                <button className="btn" onClick={tidyLoosePiecesLeft}>
                  整理到左侧
                </button>
                <button className={`btn ${showPreview ? "btnSelected" : ""}`} onClick={() => setShowPreview((v) => !v)}>
                  原图预览
                </button>
                <button className={`btn ${focusMode ? "btnSelected" : ""}`} onClick={toggleFocusMode}>
                  专注模式
                </button>
              </div>

              <div className="row">
                <button
                  className={hintRemain > 0 ? "btn btnPrimary" : "btn btnPrimary btnDisabled"}
                  onClick={useHint}
                >
                  使用提示
                </button>
              </div>
            </div>

            <div className="toolbarGroup">
              <div className="section">
                <div className="label">难度</div>
                <div className="row">
                  {diffButtons.map((b) => (
                    <button
                      key={b.label}
                      className={`btn ${!useCustomSize && rows === b.r && cols === b.c ? "btnSelected" : ""}`}
                      onClick={() => applyDifficulty(b.r, b.c)}
                    >
                      {b.label}
                    </button>
                  ))}
                  <button
                    className={`btn ${useCustomSize ? "btnSelected" : ""}`}
                    onClick={() => setUseCustomSize((v) => !v)}
                  >
                    自定义
                  </button>
                </div>

                {useCustomSize && (
                  <div className="customGrid">
                    <input
                      className="textInput"
                      value={customRows}
                      onChange={(e) => setCustomRows(e.target.value)}
                      placeholder="行"
                    />
                    <input
                      className="textInput"
                      value={customCols}
                      onChange={(e) => setCustomCols(e.target.value)}
                      placeholder="列"
                    />
                  </div>
                )}

                {useCustomSize && (
                  <button className="btn btnPrimary" onClick={applyCustomDifficulty}>
                    应用
                  </button>
                )}
              </div>

              <div className="section">
                <div className="label">样式</div>
                <div className="row">
                  <button
                    className={`btn ${pieceStyle === "jigsaw" ? "btnSelected" : ""}`}
                    onClick={() => applyPieceStyle("jigsaw")}
                  >
                    异形
                  </button>
                  <button
                    className={`btn ${pieceStyle === "rect" ? "btnSelected" : ""}`}
                    onClick={() => applyPieceStyle("rect")}
                  >
                    矩形
                  </button>
                </div>
              </div>

              <div className="section">
                <div className="switchLabel">旋转</div>
                <div className="switchRow">
                  <button
                    className={`switch ${randomRotation ? "on" : ""}`}
                    onClick={() => applyRotation(!randomRotation)}
                  />
                </div>
              </div>

              <div className="section">
                <div className="switchLabel">底图</div>
                <div className="switchRow">
                  <button
                    className={`switch ${showGuide ? "on" : ""}`}
                    onClick={() => applyGuide(!showGuide)}
                  />
                </div>
              </div>

              <div className="section">
                <div className="switchLabel">导出标题</div>
                <div className="switchRow">
                  <button
                    className={`switch ${showExportTitle ? "on" : ""}`}
                    onClick={() => setShowExportTitle((v) => !v)}
                  />
                </div>
              </div>
            </div>

            <div className="footerMini">
              <strong>{imageTitle}</strong>
              {mode === "done" && (
                <>
                  <br />
                  {"★".repeat(starLevel)} · <strong>{gradeLabel}</strong>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="canvasWrap">
        <div className="stepBanner">
          <div className="stepTextBlock">
            <div className="stepTitle">{stageInfo.title}</div>
            <div className="stepDesc">{stageInfo.desc}</div>
          </div>
          <div className="stepPill">{stageInfo.pill}</div>
        </div>

        {mode === "glue" && renderGlueHUD(percentGlue)}

        {focusMode && (
          <div className="focusFloatingPanel">
            <button className="btn btnPrimary" onClick={toggleFocusMode}>
              退出专注模式
            </button>

            {mode === "puzzle" && (
              <button
                className={finishEnabled ? "btn btnGreen" : "btn btnGreen btnDisabled"}
                onClick={handleFocusNextStep}
              >
                下一步：定型
              </button>
            )}

            {mode === "glue" && (
              <button
                className={glueReady ? "btn btnGreen btnGlow" : "btn btnGreen btnDisabled"}
                onClick={handleFocusNextStep}
              >
                下一步：装订
              </button>
            )}
          </div>
        )}

        {showPreview && imageCanvas && (
          <div className="previewCard">
            <div className="previewTop">
              <span>原图</span>
              <button className="previewClose" onClick={() => setShowPreview(false)}>
                ×
              </button>
            </div>
            <img src={imageCanvas.toDataURL("image/png")} alt="原图预览" />
          </div>
        )}

        {glueReady && mode === "glue" && (
          <div className="glueReadyBadge">可装订 ✨</div>
        )}

        {toast && <div className="toast">{toast}</div>}

        {isPaused && (
          <div className="pauseOverlay">
            <div className="pauseChip">PAUSED</div>
          </div>
        )}

        {showSummary && summaryData && (
          <div className="summaryOverlay" onClick={() => setShowSummary(false)}>
            <div className="summaryCard" onClick={(e) => e.stopPropagation()}>
              <div className="summaryHeader">
                <div>
                  <div className="summaryTitle">完成总结</div>
                </div>
                <button className="previewClose" onClick={() => setShowSummary(false)}>
                  ×
                </button>
              </div>

              <div className="summaryStars">{"★".repeat(summaryData.stars)}</div>

              <div className="summaryGrid">
                <div className="summaryTile">
                  <div className="k">作品名</div>
                  <div className="v">{summaryData.title}</div>
                </div>
                <div className="summaryTile">
                  <div className="k">图片</div>
                  <div className="v">{summaryData.imageTitle}</div>
                </div>
                <div className="summaryTile">
                  <div className="k">难度</div>
                  <div className="v">{summaryData.difficulty}</div>
                </div>
                <div className="summaryTile">
                  <div className="k">总用时</div>
                  <div className="v">{summaryData.timeText}</div>
                </div>
                <div className="summaryTile">
                  <div className="k">评级</div>
                  <div className="v">{summaryData.grade}</div>
                </div>
                <div className="summaryTile">
                  <div className="k">提示次数</div>
                  <div className="v">{summaryData.hintUsed}</div>
                </div>
                <div className="summaryTile summaryTileWide">
                  <div className="k">最佳记录</div>
                  <div className="v">{summaryData.bestText}</div>
                </div>
              </div>

              <div className="summaryActions">
                {exportUrl && (
                  <a className="btn btnPrimary" href={exportUrl} download={`${title}-${formatToday()}.png`}>
                    下载作品图
                  </a>
                )}
                {exportUrl && (
                  <button className="btn btnPurple" onClick={copyExportImage}>
                    复制作品图
                  </button>
                )}
                <button className="btn btnWarning" onClick={replaySameImage}>
                  同图再玩一局
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="shortcutDock">
          <button
            className="shortcutChip"
            onClick={useHint}
            title="使用提示（H）"
            data-tip="提示"
          >
            <span className="shortcutKey">H</span>
          </button>
          <button
            className="shortcutChip"
            onClick={tidyLoosePiecesLeft}
            title="整理到左侧（T）"
            data-tip="整理"
          >
            <span className="shortcutKey">T</span>
          </button>
          <button
            className="shortcutChip"
            onClick={() => setShowPreview((v) => !v)}
            title="原图预览（V）"
            data-tip="预览"
          >
            <span className="shortcutKey">V</span>
          </button>
          <button
            className="shortcutChip"
            onClick={toggleFocusMode}
            title="专注模式（F）"
            data-tip="专注"
          >
            <span className="shortcutKey">F</span>
          </button>
        </div>

        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}