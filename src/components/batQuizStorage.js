// Saves the bat quiz session to localStorage so a refresh or an accidentally
// closed window doesn't lose a student's answers and working. Saved progress
// expires after a while so the next person on a shared school computer starts
// fresh.

const STORAGE_KEY = "awm-bat-echo-quiz-v1";
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour since last change

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function packWorking(drawings) {
  return drawings.map((strokes) =>
    (strokes || []).map((stroke) => ({
      m: stroke.mode === "erase" ? "e" : "d",
      p: stroke.points.map((point) => [round(point.x, 4), round(point.y, 4)]),
    }))
  );
}

function unpackWorking(packed) {
  return packed.map((strokes) =>
    (strokes || []).map((stroke) => ({
      mode: stroke.m === "e" ? "erase" : "draw",
      points: stroke.p.map(([x, y]) => ({ x, y })),
    }))
  );
}

function packInk(inkByQuestion) {
  return inkByQuestion.map((strokes) =>
    (strokes || []).map((stroke) => ({
      k: stroke.pointerType || "",
      p: stroke.points.map((point) => [
        round(point.x, 1),
        round(point.y, 1),
        Math.round(point.t || 0),
      ]),
    }))
  );
}

function unpackInk(packed) {
  return packed.map((strokes) =>
    (strokes || []).map((stroke) => ({
      pointerType: stroke.k || undefined,
      startTime: 0,
      points: stroke.p.map(([x, y, t]) => ({ x, y, t })),
    }))
  );
}

const SIMPLE_ARRAYS = [
  "answers",
  "units",
  "checked",
  "correct",
  "attempted",
  "wrongAttempts",
  "workingHelpShown",
  "recognisedAnswers",
  "recognisedUnits",
];

export function saveSession(session) {
  try {
    const data = {
      savedAt: Date.now(),
      currentIndex: session.currentIndex,
      swapped: session.swapped,
      autoShowBatPictures: session.autoShowBatPictures,
      answerEntryMode: session.answerEntryMode,
      seenRewards: session.seenRewards,
      drawings: packWorking(session.drawings),
      answerInkStrokes: packInk(session.answerInkStrokes),
      unitInkStrokes: packInk(session.unitInkStrokes),
    };
    SIMPLE_ARRAYS.forEach((key) => {
      data[key] = session[key];
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full, disabled or unavailable (e.g. some private modes):
    // the quiz still works, it just won't survive a refresh.
  }
}

// Returns the saved fields to merge into a fresh session, or null.
export function loadSavedSession(questionCount) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);

    if (!data || typeof data.savedAt !== "number" || Date.now() - data.savedAt > EXPIRY_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const lengthOk = (value) => Array.isArray(value) && value.length === questionCount;
    const arrays = [...SIMPLE_ARRAYS, "drawings", "answerInkStrokes", "unitInkStrokes"];
    if (!arrays.every((key) => lengthOk(data[key]))) {
      // Saved by a version of the quiz with a different number of questions.
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const restored = {
      currentIndex: Math.min(
        questionCount - 1,
        Math.max(0, Number.isInteger(data.currentIndex) ? data.currentIndex : 0)
      ),
      swapped: Boolean(data.swapped),
      autoShowBatPictures: data.autoShowBatPictures !== false,
      seenRewards: Array.isArray(data.seenRewards) ? data.seenRewards : [],
      drawings: unpackWorking(data.drawings),
      answerInkStrokes: unpackInk(data.answerInkStrokes),
      unitInkStrokes: unpackInk(data.unitInkStrokes),
    };
    SIMPLE_ARRAYS.forEach((key) => {
      restored[key] = [...data[key]];
    });
    if (data.answerEntryMode === "type" || data.answerEntryMode === "write") {
      restored.answerEntryMode = data.answerEntryMode;
    }
    return restored;
  } catch {
    return null;
  }
}

export function clearSavedSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
