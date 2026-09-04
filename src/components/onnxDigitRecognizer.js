import * as ort from "onnxruntime-web";
import modelUrl from "../models/bat-digit-mlp.onnx?url";

let sessionPromise = null;

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

async function getSession() {
  if (!sessionPromise) {
    // A single WASM thread is plenty for this tiny model and avoids requiring
    // cross-origin isolation on school/static-site deployments.
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

export function warmOnnxDigitRecognizer() {
  return getSession().then(() => true).catch(() => false);
}

function strokeBounds(stroke) {
  const points = stroke.points || [];
  if (!points.length) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
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

function pathLength(stroke) {
  let length = 0;
  for (let i = 1; i < stroke.points.length; i += 1) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function isDecimalStroke(stroke, fieldHeight) {
  const box = strokeBounds(stroke);
  if (!box) return false;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const length = pathLength(stroke);
  return (
    box.minY > fieldHeight * 0.34 &&
    width < fieldHeight * 0.22 &&
    height < fieldHeight * 0.22 &&
    length < fieldHeight * 0.34
  );
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
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

  // Multi-stroke digits normally overlap in x. Allow a tiny non-overlap gap
  // for styles such as a two-stroke 4, but avoid swallowing the next digit.
  return (
    overlapRatio >= 0.12 ||
    (gap <= fieldHeight * 0.045 && combinedWidth <= combinedHeight * 1.05)
  );
}

function groupCharacters(strokes, fieldHeight) {
  const tokens = [];
  const digitStrokes = [];

  strokes.forEach((stroke) => {
    if (!stroke?.points?.length) return;
    const box = strokeBounds(stroke);
    if (!box) return;
    if (isDecimalStroke(stroke, fieldHeight)) {
      tokens.push({
        type: "decimal",
        x: (box.minX + box.maxX) / 2,
        strokes: [stroke],
        box,
      });
    } else {
      digitStrokes.push({ stroke, box });
    }
  });

  const clusters = [];
  digitStrokes
    .sort((a, b) => a.box.minX - b.box.minX)
    .forEach((item) => {
      let best = null;
      let bestOverlap = -1;

      for (const cluster of clusters) {
        if (!shouldJoin(cluster, item, fieldHeight)) continue;
        const overlap = horizontalOverlap(cluster.box, item.box);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = cluster;
        }
      }

      if (best) {
        best.strokes.push(item.stroke);
        best.box = mergeBounds(best.box, item.box);
      } else {
        clusters.push({ type: "digit", strokes: [item.stroke], box: item.box });
      }
    });

  clusters.forEach((cluster) => {
    cluster.x = (cluster.box.minX + cluster.box.maxX) / 2;
    tokens.push(cluster);
  });

  return tokens.sort((a, b) => a.x - b.x);
}

function looksLikeOpenFour(token) {
  if (!token?.box || token.strokes.length < 2) return false;

  const tokenWidth = Math.max(1, token.box.maxX - token.box.minX);
  const tokenHeight = Math.max(1, token.box.maxY - token.box.minY);

  return token.strokes.some((verticalStroke) => {
    const verticalBox = strokeBounds(verticalStroke);
    if (!verticalBox || verticalStroke.points.length < 2) return false;

    const verticalWidth = verticalBox.maxX - verticalBox.minX;
    const verticalHeight = verticalBox.maxY - verticalBox.minY;
    const first = verticalStroke.points[0];
    const last = verticalStroke.points[verticalStroke.points.length - 1];
    const directDistance = Math.hypot(last.x - first.x, last.y - first.y);
    const directness = directDistance / Math.max(pathLength(verticalStroke), 1);

    const isLongVertical =
      verticalHeight >= tokenHeight * 0.52 &&
      verticalWidth <= Math.max(5, tokenWidth * 0.24) &&
      Math.abs(last.y - first.y) >= Math.abs(last.x - first.x) * 2.5 &&
      directness >= 0.72;
    if (!isLongVertical) return false;

    const verticalX =
      verticalStroke.points.reduce((sum, point) => sum + point.x, 0) /
      verticalStroke.points.length;

    return token.strokes.some((barStroke) => {
      if (barStroke === verticalStroke || barStroke.points.length < 3) return false;

      const middlePoints = barStroke.points.filter(
        (point) =>
          point.y > verticalBox.minY + verticalHeight * 0.12 &&
          point.y < verticalBox.maxY - verticalHeight * 0.12
      );
      if (!middlePoints.length) return false;

      const crossingPoint = middlePoints.reduce((nearest, point) =>
        Math.abs(point.x - verticalX) < Math.abs(nearest.x - verticalX)
          ? point
          : nearest
      );
      if (Math.abs(crossingPoint.x - verticalX) > tokenWidth * 0.12) return false;

      const bandHalfHeight = tokenHeight * 0.12;
      const barPoints = barStroke.points.filter(
        (point) => Math.abs(point.y - crossingPoint.y) <= bandHalfHeight
      );
      if (barPoints.length < 2) return false;

      const barMinX = Math.min(...barPoints.map((point) => point.x));
      const barMaxX = Math.max(...barPoints.map((point) => point.x));
      const crossesVertical =
        barMinX < verticalX - tokenWidth * 0.1 &&
        barMaxX > verticalX + tokenWidth * 0.08 &&
        barMaxX - barMinX >= tokenWidth * 0.42;
      const hasRaisedArm = barStroke.points.some(
        (point) =>
          point.y < crossingPoint.y - tokenHeight * 0.22 &&
          point.x < verticalX - tokenWidth * 0.04
      );

      return crossesVertical && hasRaisedArm;
    });
  });
}

function rasterizeDigit(token) {
  // Draw at high resolution first, then downsample to the model's 8×8 input.
  // The model was trained on centred grayscale handwriting with this geometry.
  const large = document.createElement("canvas");
  large.width = 64;
  large.height = 64;
  const ctx = large.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6.6;

  const box = token.box;
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(46 / width, 46 / height);
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;
  const tx = (x) => 32 + (x - centreX) * scale;
  const ty = (y) => 32 + (y - centreY) * scale;

  token.strokes.forEach((stroke) => {
    if (!stroke.points.length) return;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.beginPath();
      ctx.arc(tx(p.x), ty(p.y), 3.3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(tx(stroke.points[0].x), ty(stroke.points[0].y));
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(tx(stroke.points[i].x), ty(stroke.points[i].y));
    }
    ctx.stroke();
  });

  const small = document.createElement("canvas");
  small.width = 8;
  small.height = 8;
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(large, 0, 0, 8, 8);

  const rgba = smallCtx.getImageData(0, 0, 8, 8).data;
  const pixels = new Float32Array(64);
  for (let i = 0; i < 64; i += 1) {
    // RGB and alpha are both white/opaque where the digit was drawn; using
    // alpha gives a stable 0..1 grayscale value on the transparent background.
    pixels[i] = rgba[i * 4 + 3] / 255;
  }
  return pixels;
}

async function classifyDigit(pixels) {
  const session = await getSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const feeds = {
    [inputName]: new ort.Tensor("float32", pixels, [1, 64]),
  };
  const results = await session.run(feeds);
  const logits = Array.from(results[outputName].data, Number);
  const probabilities = softmax(logits);
  let best = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[best]) best = i;
  }
  return { digit: String(best), confidence: probabilities[best] };
}

export async function recogniseNumberWithOnnx(strokes, fieldWidth, fieldHeight) {
  if (!Array.isArray(strokes) || !strokes.length || !fieldWidth || !fieldHeight) {
    return { text: "", confidence: 0, confident: false, source: "onnx" };
  }

  const tokens = groupCharacters(strokes, fieldHeight);
  if (!tokens.length || tokens.length > 6) {
    return { text: "", confidence: 0, confident: false, source: "onnx" };
  }

  let decimalCount = 0;
  const pieces = [];
  const confidences = [];

  try {
    for (const token of tokens) {
      if (token.type === "decimal") {
        decimalCount += 1;
        pieces.push(".");
        continue;
      }
      const result = await classifyDigit(rasterizeDigit(token));
      const openFourCorrection = result.digit === "5" && looksLikeOpenFour(token);
      pieces.push(openFourCorrection ? "4" : result.digit);
      confidences.push(openFourCorrection ? Math.max(0.86, result.confidence) : result.confidence);
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

  const text = pieces.join("");
  const numericPattern = /^\d{1,4}(?:\.\d{1,2})?$/;
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;

  return {
    text: decimalCount <= 1 && numericPattern.test(text) ? text : "",
    confidence,
    confident: decimalCount <= 1 && numericPattern.test(text) && confidence >= 0.72,
    source: "onnx",
  };
}
