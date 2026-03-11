import { prettyTitleFromFilename } from "./utils";

export type PuzzleAsset = {
  title: string;
  url: string;
  source: "local" | "remote";
};

type RemoteManifestItem = {
  title: string;
  url: string;
};

const localPuzzleModules = {
  ...import.meta.glob("../assets/puzzles/*.{png,jpg,jpeg,webp,avif}", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob("../assets/images/*.{png,jpg,jpeg,webp,avif}", {
    eager: true,
    import: "default",
  }),
} as Record<string, string>;

export function getLocalPuzzleAssets(): PuzzleAsset[] {
  return Object.entries(localPuzzleModules)
    .map(([path, url]) => {
      const file = path.split("/").pop() || "Untitled";
      return {
        title: prettyTitleFromFilename(file),
        url,
        source: "local" as const,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

export async function getRemotePuzzleAssets(): Promise<PuzzleAsset[]> {
  try {
    const res = await fetch("/image/remote-manifest.json", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as RemoteManifestItem[];
    if (!Array.isArray(json)) return [];

    return json
      .filter((item) => item && typeof item.title === "string" && typeof item.url === "string")
      .map((item) => ({
        title: item.title.trim(),
        url: item.url.trim(),
        source: "remote" as const,
      }))
      .filter((item) => item.title && item.url);
  } catch {
    return [];
  }
}

export async function loadImageFromUrl(url: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`图片加载失败: ${url}`));
    img.src = url;
  });

  return img;
}

export async function loadImageFromFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function normalizeToCanvas(img: CanvasImageSource, maxLongSide = 1600) {
  const source = img as HTMLImageElement | HTMLCanvasElement;
  const iw = (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width;
  const ih = (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height;

  const scale = Math.min(1, maxLongSide / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

export async function loadRandomPuzzleAsset() {
  const local = getLocalPuzzleAssets();
  const remote = await getRemotePuzzleAssets();
  const all = [...local, ...remote];

  if (all.length === 0) {
    throw new Error(
      "没有可用图片。请把图片放到 src/assets/puzzles/，或者提供 public/image/remote-manifest.json。"
    );
  }

  const asset = all[Math.floor(Math.random() * all.length)];
  const img = await loadImageFromUrl(asset.url);
  return { asset, img };
}