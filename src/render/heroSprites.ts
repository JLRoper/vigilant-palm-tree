import type { ProceduralDrawer } from "./assetSource";

const KNIGHT_PALETTE: Record<string, string | null> = {
  ".": null,
  K: "#1a1208",
  G: "#c8c8d0",
  g: "#585860",
  W: "#fff8dc",
  R: "#d42020",
  Y: "#ffd84a",
  O: "#8b6914",
  s: "#a0522d",
  B: "#8b4513",
  D: "#4a2208",
  L: "#3a2010",
};

const KNIGHT_ART: string[] = [
  "..................",
  "......RRR.........",
  ".....RWWR.........",
  "......RRR.........",
  "..KKKKKKKK........",
  ".KGGGGGGGGK.......",
  ".KGGKKKGGGK.......",
  ".KGGKKKGGGK.......",
  "..KGGGGGGGK.......",
  "...KYYYYYK........",
  "...KYOOOYK........",
  "...KYYYYYK........",
  "..KKKYYYYKKK......",
  ".KKsssggggsssKK...",
  ".KBBBBBBBBBBK.....",
  ".KBDBBBBBBDBK.....",
  ".KBBBBBBBBBBK.....",
  "..KKKKKKKKKKK.....",
  "..LL......LL......",
  "..LL......LL......",
  "..LL......LL......",
  "..................",
];

const DEMON_PALETTE: Record<string, string | null> = {
  ".": null,
  K: "#150000",
  R: "#a01818",
  r: "#5a0a0a",
  Y: "#ffd84a",
  D: "#180404",
};

const DEMON_ART: string[] = [
  "..................",
  "..K...........K...",
  ".KK...........KK..",
  "KKK...........KKK.",
  ".KK...........KK..",
  "..KKKKKKKKKKKKK...",
  "..KRRRRRRRRRRRK...",
  "..KRRRRRRRRRRRK...",
  "..KRYRRRRRRRYRK...",
  "..KRYRRRRRRRYRK...",
  "..KRRRDDDDRRRK....",
  "..KRRDDDDDDDRK....",
  "..KRRRDDDDRRRK....",
  "...KRRRRRRRRK.....",
  "....KRRRRRRK......",
  "...KRRRRRRRRRK....",
  "..KRRRRRRRRRRRK...",
  "..KRrRRRRRRRRrRK..",
  "..KRRRRRRRRRRRRK..",
  "...KKRRRRRRRRKK...",
  "...K.KK....KK.K...",
  "...K..K....K..K...",
];

type Pixel = { x: number; y: number; color: string };
type Sprite = { width: number; height: number; pixels: Pixel[] };

function parseSprite(art: string[], palette: Record<string, string | null>): Sprite {
  if (art.length === 0) throw new Error("empty sprite");
  const width = art[0].length;
  for (let i = 0; i < art.length; i++) {
    if (art[i].length !== width) {
      throw new Error(
        `row ${i} has width ${art[i].length}, expected ${width}: "${art[i]}"`
      );
    }
  }
  const pixels: Pixel[] = [];
  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const color = palette[ch];
      if (color === undefined) {
        throw new Error(`unknown char "${ch}" at (${x},${y})`);
      }
      if (color !== null) {
        pixels.push({ x, y, color });
      }
    }
  }
  return { width, height: art.length, pixels };
}

function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, xOffset: number, yOffset: number): void {
  for (const p of sprite.pixels) {
    ctx.fillStyle = p.color;
    ctx.fillRect(xOffset + p.x, yOffset + p.y, 1, 1);
  }
}

let knightSprite: Sprite | null = null;
let demonSprite: Sprite | null = null;

function getKnight(): Sprite {
  if (!knightSprite) knightSprite = parseSprite(KNIGHT_ART, KNIGHT_PALETTE);
  return knightSprite;
}

function getDemon(): Sprite {
  if (!demonSprite) demonSprite = parseSprite(DEMON_ART, DEMON_PALETTE);
  return demonSprite;
}

export const drawKnightSprite: ProceduralDrawer = (ctx, size) => {
  const sprite = getKnight();
  const xOffset = Math.floor((size - sprite.width) / 2);
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, sprite, xOffset, 0);
};

export const drawDemonSprite: ProceduralDrawer = (ctx, size) => {
  const sprite = getDemon();
  const xOffset = Math.floor((size - sprite.width) / 2);
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, sprite, xOffset, 0);
};
