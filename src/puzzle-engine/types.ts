export type Vec2 = { x: number; y: number };

export type Rotation = 0 | 90 | 180 | 270;
export type PieceStyle = "rect" | "jigsaw";
export type TabDirection = -1 | 0 | 1;

export type PieceTabs = {
  top: TabDirection;
  right: TabDirection;
  bottom: TabDirection;
  left: TabDirection;
};

export type PuzzleConfig = {
  rows: number;
  cols: number;

  canvasW: number;
  canvasH: number;

  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;

  snapThreshold: number;
  scatterPadding: number;

  randomRotation: boolean;
  showGuide: boolean;
  pieceStyle: PieceStyle;
};

export type Piece = {
  id: number;

  sx: number;
  sy: number;
  sw: number;
  sh: number;

  row: number;
  col: number;

  x: number;
  y: number;
  correctX: number;
  correctY: number;

  baseW: number;
  baseH: number;

  rotation: Rotation;
  locked: boolean;
  groupId: number;
  popUntil: number;

  tabs: PieceTabs;
  visualPadding: number;
  pieceStyle: PieceStyle;
};

export type EngineState = {
  pieces: Piece[];
  draggingGroupId: number | null;
  dragOffset: Vec2;
  lockedCount: number;
  totalCount: number;
  completed: boolean;
};

export type PieceSnapshot = {
  id: number;
  rotation: Rotation;
  locked: boolean;
  groupId: number;
  rx: number;
  ry: number;
};

export type EngineSnapshot = {
  completed: boolean;
  lockedCount: number;
  pieces: PieceSnapshot[];
};