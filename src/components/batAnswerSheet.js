// Builds a printable PNG summary of the learner's bat-quiz answers and copies
// it to the clipboard. Kept free of React so it can be tested on its own.

export const WORKING_HELP_COLOURS = {
  distance: "#7c3aed",
  speed: "#047857",
  time: "#c2410c",
};

export const WORKING_HELP_LEFT_SPACE = 0.65;
export const WORKING_HELP_TOTAL_WIDTH = 1 + WORKING_HELP_LEFT_SPACE;

const HELP_FONT = '"Segoe Print", "Comic Sans MS", sans-serif';
const SHEET_FONT =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

// Paints the working-out area (optional "help me get started" equations plus
// the learner's pen strokes) onto ctx, in CSS pixels of size width × height.
// Stroke x/y values are stored as fractions of the original (no-help) area.
export function paintWorking(ctx, width, height, strokes, helpValues) {
  const originalWidth = helpValues ? width / WORKING_HELP_TOTAL_WIDTH : width;

  if (helpValues) {
    let fontSize = Math.max(22, Math.min(32, originalWidth * 0.043));
    const helpLines = [
      [
        { text: "distance", quantity: "distance" },
        { text: " = ½ × " },
        { text: "speed", quantity: "speed" },
        { text: " × " },
        { text: "time", quantity: "time" },
      ],
      [
        { text: helpValues.distance, quantity: "distance" },
        { text: " = ½ × " },
        { text: helpValues.speed ?? "340", quantity: "speed" },
        { text: " × " },
        { text: helpValues.time, quantity: "time" },
      ],
    ];

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `600 ${fontSize}px ${HELP_FONT}`;
    ctx.textBaseline = "top";
    const helpAreaWidth = originalWidth * WORKING_HELP_LEFT_SPACE;
    const measureLine = (segments) =>
      segments.reduce((total, segment) => total + ctx.measureText(segment.text).width, 0);
    const widestLine = Math.max(...helpLines.map(measureLine));
    if (widestLine > helpAreaWidth - 32) {
      fontSize = Math.max(17, fontSize * ((helpAreaWidth - 32) / widestLine));
      ctx.font = `600 ${fontSize}px ${HELP_FONT}`;
    }

    helpLines.forEach((segments, index) => {
      let x = (helpAreaWidth - measureLine(segments)) / 2;
      const y = height * 0.08 + index * fontSize * 1.65;

      segments.forEach((segment) => {
        ctx.fillStyle = segment.quantity
          ? WORKING_HELP_COLOURS[segment.quantity]
          : "#172554";
        ctx.fillText(segment.text, x, y);
        x += ctx.measureText(segment.text).width;
      });
    });
    ctx.restore();
  }

  const renderX = (x) =>
    helpValues ? (WORKING_HELP_LEFT_SPACE + x) * originalWidth : x * width;

  (strokes || []).forEach((stroke) => {
    if (!stroke.points.length) return;

    ctx.save();
    ctx.globalCompositeOperation =
      stroke.mode === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#111827";
    ctx.lineWidth = stroke.mode === "erase" ? 24 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const first = stroke.points[0];
    ctx.beginPath();
    if (stroke.points.length === 1) {
      ctx.arc(
        renderX(first.x),
        first.y * height,
        stroke.mode === "erase" ? 12 : 1.5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    } else {
      ctx.moveTo(renderX(first.x), first.y * height);
      for (let i = 1; i < stroke.points.length; i += 1) {
        const point = stroke.points[i];
        ctx.lineTo(renderX(point.x), point.y * height);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
}

// Renders the working area off-screen and crops it to the ink, so a mostly
// empty whiteboard doesn't fill the summary with blank space.
function renderCroppedWorking(entry, baseSize, scale) {
  const hasInk = (entry.strokes || []).some(
    (stroke) => stroke.mode !== "erase" && stroke.points.length
  );
  if (!hasInk && !entry.helpValues) return null;

  const width = baseSize.width * (entry.helpValues ? WORKING_HELP_TOTAL_WIDTH : 1);
  const height = baseSize.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintWorking(ctx, width, height, entry.strokes, entry.helpValues);

  const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // Everything was rubbed out.

  const pad = Math.round(14 * scale);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cropped = document.createElement("canvas");
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  cropped.getContext("2d").drawImage(canvas, -minX, -minY);
  return cropped;
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  String(text)
    .split("\n")
    .forEach((paragraph) => {
      let line = "";
      paragraph.split(/\s+/).forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      lines.push(line);
    });
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const COLOURS = {
  page: "#ffffff",
  ink: "#0f172a",
  muted: "#475569",
  faint: "#94a3b8",
  border: "#cbd5e1",
  cardBg: "#f8fafc",
  accent: "#0eb4dc",
  headerBg: "#0d1e33",
  correctBg: "#dcfce7",
  correctInk: "#166534",
  wrongBg: "#fee2e2",
  wrongInk: "#991b1b",
  workBg: "#ffffff",
};

const STATUS_COLOURS = {
  correct: { bg: COLOURS.correctBg, ink: COLOURS.correctInk },
  wrong: { bg: COLOURS.wrongBg, ink: COLOURS.wrongInk },
  unchecked: { bg: "#fef3c7", ink: "#92400e" },
};

// entries: [{ number, text, answerText, status ("correct" | "wrong" |
//             "unchecked"), wrongAttempts, helpUsed,
//             strokes, helpValues }]
// baseSize: CSS-pixel size of the working-out area (without help) on screen.
export function renderAnswerSheet({
  title,
  subtitle,
  entries,
  totalQuestions,
  baseSize,
  footer,
  scale = 2,
}) {
  const W = 1000;
  const M = 36; // page margin
  const CARD_PAD = 22;
  const GAP = 24; // between text and working columns
  const cardWidth = W - M * 2;
  const textWidth = 430;
  const workWidth = cardWidth - CARD_PAD * 2 - GAP - textWidth;
  const WORK_MAX_HEIGHT = 340;

  const measure = document.createElement("canvas").getContext("2d");
  const font = (weight, size) => `${weight} ${size}px ${SHEET_FONT}`;

  // ---- Measure every card first so the page height is known. ----
  const cards = entries.map((entry) => {
    measure.font = font(500, 19);
    const questionLines = wrapText(measure, entry.text, textWidth);
    measure.font = font(700, 26);
    const answerLines = wrapText(measure, entry.answerText || "—", textWidth - 24);

    const working = renderCroppedWorking(entry, baseSize, scale);
    let workDrawWidth = 0;
    let workDrawHeight = 0;
    if (working) {
      const naturalWidth = working.width / scale;
      const naturalHeight = working.height / scale;
      const fit = Math.min(1, workWidth / naturalWidth, WORK_MAX_HEIGHT / naturalHeight);
      workDrawWidth = naturalWidth * fit;
      workDrawHeight = naturalHeight * fit;
    }

    const textHeight =
      24 + // "Question n" label
      questionLines.length * 27 +
      18 +
      22 + // "Your answer" label
      answerLines.length * 34 +
      16 +
      34 + // status pill
      (entry.helpUsed ? 26 : 0);
    const workHeight = (working ? workDrawHeight : 90) + 24;
    const height = CARD_PAD * 2 + Math.max(textHeight, workHeight);
    return { entry, questionLines, answerLines, working, workDrawWidth, workDrawHeight, height };
  });

  const HEADER_H = 128;
  const height =
    M + HEADER_H + 22 + cards.reduce((sum, card) => sum + card.height + 18, 0) + 44;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = "top";

  ctx.fillStyle = COLOURS.page;
  ctx.fillRect(0, 0, W, height);

  // ---- Header ----
  roundRect(ctx, M, M, cardWidth, HEADER_H, 18);
  ctx.fillStyle = COLOURS.headerBg;
  ctx.fill();
  ctx.fillStyle = COLOURS.accent;
  ctx.fillRect(M + 28, M + 26, 6, HEADER_H - 52);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 30);
  ctx.fillText(title, M + 52, M + 26);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = font(500, 17);
  ctx.fillText(subtitle, M + 52, M + 68);

  const correctCount = entries.filter((entry) => entry.status === "correct").length;
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 34);
  ctx.fillText(`${correctCount} / ${totalQuestions}`, W - M - 30, M + 26);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = font(500, 15);
  ctx.fillText("questions correct", W - M - 30, M + 68);
  ctx.textAlign = "left";

  // ---- Question cards ----
  let y = M + HEADER_H + 22;
  cards.forEach((card) => {
    const { entry } = card;
    const x = M;

    roundRect(ctx, x, y, cardWidth, card.height, 16);
    ctx.fillStyle = COLOURS.cardBg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLOURS.border;
    ctx.stroke();

    // Left column: question, answer, status.
    let ty = y + CARD_PAD;
    const tx = x + CARD_PAD;
    ctx.fillStyle = COLOURS.accent;
    ctx.font = font(800, 14);
    ctx.fillText(`QUESTION ${entry.number}`, tx, ty);
    ty += 24;

    ctx.fillStyle = COLOURS.ink;
    ctx.font = font(500, 19);
    card.questionLines.forEach((line) => {
      ctx.fillText(line, tx, ty);
      ty += 27;
    });
    ty += 18;

    ctx.fillStyle = COLOURS.muted;
    ctx.font = font(700, 13);
    ctx.fillText("YOUR ANSWER", tx, ty);
    ty += 22;

    const palette = STATUS_COLOURS[entry.status] || STATUS_COLOURS.wrong;
    const answerBoxHeight = card.answerLines.length * 34 + 4;
    ctx.fillStyle = palette.ink;
    ctx.fillRect(tx, ty - 2, 4, answerBoxHeight);
    ctx.fillStyle = COLOURS.ink;
    ctx.font = font(700, 26);
    card.answerLines.forEach((line) => {
      ctx.fillText(line, tx + 16, ty);
      ty += 34;
    });
    ty += 16;

    const tries = (n) => `${n} incorrect ${n === 1 ? "try" : "tries"}`;
    let statusText;
    if (entry.status === "correct") {
      statusText =
        entry.wrongAttempts > 0
          ? `Correct after ${tries(entry.wrongAttempts)}`
          : "Correct first time";
    } else if (entry.status === "unchecked") {
      statusText = "Changed since last check";
      if (entry.wrongAttempts > 0) statusText += ` · ${tries(entry.wrongAttempts)}`;
    } else {
      statusText = `Not yet correct · ${tries(entry.wrongAttempts)}`;
    }
    ctx.font = font(700, 15);
    const pillWidth = ctx.measureText(statusText).width + 46;
    roundRect(ctx, tx, ty, pillWidth, 30, 15);
    ctx.fillStyle = palette.bg;
    ctx.fill();

    // Tick or cross icon, drawn so it never depends on font glyphs.
    const iconX = tx + 18;
    const iconY = ty + 15;
    ctx.save();
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = palette.ink;
    ctx.beginPath();
    if (entry.status === "correct") {
      ctx.moveTo(iconX - 6, iconY);
      ctx.lineTo(iconX - 2, iconY + 4.5);
      ctx.lineTo(iconX + 6, iconY - 5);
    } else if (entry.status === "unchecked") {
      ctx.arc(iconX, iconY, 6, 0, Math.PI * 2);
      ctx.moveTo(iconX, iconY - 3.5);
      ctx.lineTo(iconX, iconY);
      ctx.lineTo(iconX + 2.5, iconY + 2);
    } else {
      ctx.moveTo(iconX - 5, iconY - 5);
      ctx.lineTo(iconX + 5, iconY + 5);
      ctx.moveTo(iconX + 5, iconY - 5);
      ctx.lineTo(iconX - 5, iconY + 5);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = palette.ink;
    ctx.fillText(statusText, tx + 34, ty + 7);
    ty += 34;

    if (entry.helpUsed) {
      ty += 6;
      ctx.fillStyle = COLOURS.muted;
      ctx.font = font(500, 14);
      ctx.fillText("Used “Help me get started”", tx, ty);
    }

    // Right column: working out.
    const wx = x + CARD_PAD + textWidth + GAP;
    const wy = y + CARD_PAD;
    ctx.fillStyle = COLOURS.muted;
    ctx.font = font(700, 13);
    ctx.fillText("WORKING", wx, wy);

    const boxY = wy + 22;
    const boxHeight = card.height - CARD_PAD * 2 - 22;
    roundRect(ctx, wx, boxY, workWidth, boxHeight, 12);
    ctx.fillStyle = COLOURS.workBg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOURS.border;
    ctx.stroke();

    if (card.working) {
      const dx = wx + (workWidth - card.workDrawWidth) / 2;
      const dy = boxY + (boxHeight - card.workDrawHeight) / 2;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(card.working, dx, dy, card.workDrawWidth, card.workDrawHeight);
    } else {
      ctx.fillStyle = COLOURS.faint;
      ctx.font = font(500, 16);
      ctx.textAlign = "center";
      ctx.fillText("No working shown", wx + workWidth / 2, boxY + boxHeight / 2 - 9);
      ctx.textAlign = "left";
    }

    y += card.height + 18;
  });

  ctx.fillStyle = COLOURS.faint;
  ctx.font = font(500, 14);
  ctx.fillText(footer, M, y + 4);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png"
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Must be called directly from a click handler: Safari only allows clipboard
// writes when the ClipboardItem is created synchronously inside the gesture,
// which is why the PNG is handed over as a promise.
// Resolves to "copied", or "downloaded" when the browser can't copy images.
export async function copyAnswerSheet(options, filename = "bat-echo-answers.png") {
  const blobPromise = Promise.resolve().then(() => canvasToBlob(renderAnswerSheet(options)));

  if (navigator.clipboard?.write && typeof window.ClipboardItem === "function") {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blobPromise }),
      ]);
      return "copied";
    } catch {
      // Fall through to downloading the image instead.
    }
  }

  downloadBlob(await blobPromise, filename);
  return "downloaded";
}
