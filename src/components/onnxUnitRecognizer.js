import * as ort from "onnxruntime-web";
import modelUrl from "../models/bat-unit-letters.onnx?url";

const LETTERS = ["c", "k", "m", "s"];
const ALLOWED_UNITS = ["m", "cm", "mm", "km", "s", "ms", "m/s"];

let sessionPromise = null;

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

async function getSession() {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1;
    sessionPromise = ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    }).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function warmOnnxUnitRecognizer() {
  return getSession().then(() => true).catch(() => false);
}

function strokeBounds(stroke) {
  const points = stroke.points || [];
  if (!points.length) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

function mergeBounds(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
}

function pathLength(stroke) {
  let length = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const point = stroke.points[index];
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function isSlash(stroke, fieldHeight) {
  const box = strokeBounds(stroke);
  if (!box || stroke.points.length < 2) return false;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const directness = Math.hypot(last.x - first.x, last.y - first.y) / Math.max(pathLength(stroke), 1);
  return height > fieldHeight * 0.34 && width > fieldHeight * 0.1 && directness > 0.78;
}

function shouldJoin(cluster, item, fieldHeight) {
  const overlap = horizontalOverlap(cluster.box, item.box);
  const itemWidth = Math.max(1, item.box.maxX - item.box.minX);
  const clusterWidth = Math.max(1, cluster.box.maxX - cluster.box.minX);
  const gap = Math.max(0, item.box.minX - cluster.box.maxX, cluster.box.minX - item.box.maxX);
  const overlapRatio = overlap / Math.min(itemWidth, clusterWidth);
  const combined = mergeBounds(cluster.box, item.box);
  const combinedWidth = combined.maxX - combined.minX;
  const combinedHeight = Math.max(1, combined.maxY - combined.minY);
  return overlapRatio >= 0.1 || (gap <= fieldHeight * 0.045 && combinedWidth <= combinedHeight * 1.15);
}

function groupCharacters(strokes, fieldHeight) {
  const tokens = [];
  const letterStrokes = [];

  strokes.forEach((stroke) => {
    if (!stroke?.points?.length) return;
    const box = strokeBounds(stroke);
    if (!box) return;
    letterStrokes.push({ stroke, box });
  });

  const clusters = [];
  letterStrokes
    .sort((a, b) => a.box.minX - b.box.minX)
    .forEach((item) => {
      let best = null;
      let bestOverlap = -1;
      for (const cluster of clusters) {
        if (!shouldJoin(cluster, item, fieldHeight)) continue;
        const overlap = horizontalOverlap(cluster.box, item.box);
        if (overlap > bestOverlap) {
          best = cluster;
          bestOverlap = overlap;
        }
      }
      if (best) {
        best.strokes.push(item.stroke);
        best.box = mergeBounds(best.box, item.box);
      } else {
        clusters.push({ type: "letter", strokes: [item.stroke], box: item.box });
      }
    });

  clusters.forEach((cluster) => {
    if (cluster.strokes.length === 1 && isSlash(cluster.strokes[0], fieldHeight)) {
      cluster.type = "slash";
    }
    cluster.x = (cluster.box.minX + cluster.box.maxX) / 2;
    tokens.push(cluster);
  });
  return tokens.sort((a, b) => a.x - b.x);
}

function rasterizeLetter(token) {
  const large = document.createElement("canvas");
  large.width = 64;
  large.height = 64;
  const context = large.getContext("2d", { willReadFrequently: true });
  context.strokeStyle = "#fff";
  context.fillStyle = "#fff";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 6.6;

  const box = token.box;
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(46 / width, 46 / height);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;
  const transformX = (x) => 32 + (x - centreX) * scale;
  const transformY = (y) => 32 + (y - centreY) * scale;

  token.strokes.forEach((stroke) => {
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(transformX(point.x), transformY(point.y), 3.3, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(transformX(stroke.points[0].x), transformY(stroke.points[0].y));
    for (let index = 1; index < stroke.points.length; index += 1) {
      context.lineTo(transformX(stroke.points[index].x), transformY(stroke.points[index].y));
    }
    context.stroke();
  });

  const small = document.createElement("canvas");
  small.width = 8;
  small.height = 8;
  const smallContext = small.getContext("2d", { willReadFrequently: true });
  smallContext.imageSmoothingEnabled = true;
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(large, 0, 0, 8, 8);
  const rgba = smallContext.getImageData(0, 0, 8, 8).data;
  const pixels = new Float32Array(64);
  for (let index = 0; index < 64; index += 1) pixels[index] = rgba[index * 4 + 3] / 255;
  return pixels;
}

async function classifyLetter(pixels) {
  const session = await getSession();
  const feeds = {
    [session.inputNames[0]]: new ort.Tensor("float32", pixels, [1, 64]),
  };
  const results = await session.run(feeds);
  const logits = Array.from(results[session.outputNames[0]].data, Number);
  const probabilities = softmax(logits);
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[best]) best = index;
  }
  return { letter: LETTERS[best], confidence: probabilities[best] };
}

function chooseAllowedUnit(raw, confidence) {
  if (ALLOWED_UNITS.includes(raw)) return raw;

  // A restricted vocabulary lets a slightly imperfect character prediction
  // still resolve to the nearest physically meaningful unit.
  const scored = ALLOWED_UNITS.map((unit) => {
    const lengthPenalty = Math.abs(unit.length - raw.length) * 2;
    let mismatches = lengthPenalty;
    for (let index = 0; index < Math.min(unit.length, raw.length); index += 1) {
      if (unit[index] !== raw[index]) mismatches += 1;
    }
    return { unit, mismatches };
  }).sort((a, b) => a.mismatches - b.mismatches);

  return confidence >= 0.56 && scored[0]?.mismatches <= 1 ? scored[0].unit : "";
}

export async function recogniseUnitWithOnnx(strokes, fieldHeight) {
  if (!Array.isArray(strokes) || !strokes.length || !fieldHeight) {
    return { text: "", confidence: 0, confident: false, source: "onnx" };
  }

  const tokens = groupCharacters(strokes, fieldHeight);
  if (!tokens.length || tokens.length > 3) {
    return { text: "", confidence: 0, confident: false, source: "onnx" };
  }

  const pieces = [];
  const confidences = [];
  try {
    for (const token of tokens) {
      if (token.type === "slash") {
        pieces.push("/");
        continue;
      }
      const result = await classifyLetter(rasterizeLetter(token));
      pieces.push(result.letter);
      confidences.push(result.confidence);
    }
  } catch (error) {
    return {
      text: "",
      confidence: 0,
      confident: false,
      source: "onnx",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const raw = pieces.join("");
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 1;
  const text = chooseAllowedUnit(raw, confidence);
  return {
    text,
    confidence,
    confident: Boolean(text && confidence >= 0.66),
    source: "onnx",
  };
}
