import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./BatEcholocationQuiz.css";
import {
  recogniseNumberWithOnnx,
  warmOnnxDigitRecognizer,
} from "./onnxDigitRecognizer";
import {
  recogniseUnitWithOnnx,
  warmOnnxUnitRecognizer,
} from "./onnxUnitRecognizer";

import bat1 from "../assets/bat_1.jpg";
import bat2 from "../assets/bat_2.jpg";
import bat3 from "../assets/bat_3.jpg";
import bat4 from "../assets/bat_4.jpg";
import bat5 from "../assets/bat_5.jpg";
import bat6 from "../assets/bat_6.jpg";
import bat7 from "../assets/bat_7.jpg";
import bat8 from "../assets/bat_8.jpg";
import bat9 from "../assets/bat_9.jpg";

const BAT_IMAGES = [bat1, bat2, bat3, bat4, bat5, bat6, bat7, bat8, bat9];

const QUESTIONS = [
  {
    text: "A bat sends an ultrasonic pulse towards a moth. The echo returns 20 ms later. How far away is the moth?",
    answer: 3.4,
    unit: "m",
    quantity: "distance",
    tolerance: 0.005,
  },
  {
    text: "A bat detects a beetle 5.1 m away. How long does the sound take to travel to the beetle and back?",
    answer: 30,
    unit: "ms",
    quantity: "time",
    tolerance: 0.05,
  },
  {
    text: "A bat receives an echo from a flying insect 25 ms after making its call. How far away is the insect?",
    answer: 4.25,
    unit: "m",
    quantity: "distance",
    tolerance: 0.005,
  },
  {
    text: "A person shouts towards a cliff. The echo is heard 0.8 seconds later. How far away is the cliff?",
    answer: 136,
    unit: "m",
    quantity: "distance",
    tolerance: 0.05,
  },
  {
    text: "A hiker shouts towards a rock face. The echo returns after 1.2 seconds. How far away is the rock face?",
    answer: 204,
    unit: "m",
    quantity: "distance",
    tolerance: 0.05,
  },
  {
    text: "An ultrasonic sensor detects a box 1.7 m away. How long does the sound take to travel to the box and back?",
    answer: 10,
    unit: "ms",
    quantity: "time",
    tolerance: 0.05,
  },
  {
    text: "A warehouse robot sends out an ultrasonic pulse. The echo returns after 15 ms. How far away is the wall?",
    answer: 2.55,
    unit: "m",
    quantity: "distance",
    tolerance: 0.005,
  },
  {
    text: "A parking sensor detects a car 0.68 m away. How long does the sound take to travel to the car and back?",
    answer: 4,
    unit: "ms",
    quantity: "time",
    tolerance: 0.05,
  },
];

const WORKING_HELP = [
  { distance: "distance", time: "0.020" },
  { distance: "5.1", time: "time" },
  { distance: "distance", time: "0.025" },
  { distance: "distance", time: "0.8" },
  { distance: "distance", time: "1.2" },
  { distance: "1.7", time: "time" },
  { distance: "distance", time: "0.015" },
  { distance: "0.68", time: "time" },
];

const WORKING_HELP_COLOURS = {
  distance: "#7c3aed",
  speed: "#047857",
  time: "#c2410c",
};

const WORKING_HELP_LEFT_SPACE = 0.65;
const WORKING_HELP_TOTAL_WIDTH = 1 + WORKING_HELP_LEFT_SPACE;

const UNIT_REQUIRED_FROM_INDEX = 2;

const RECOGNISABLE_UNITS = ["m", "cm", "mm", "km", "s", "ms", "m/s"];

const UNIT_FACTORS = {
  distance: {
    m: 1,
    metre: 1,
    metres: 1,
    meter: 1,
    meters: 1,
    cm: 1e-2,
    centimetre: 1e-2,
    centimetres: 1e-2,
    centimeter: 1e-2,
    centimeters: 1e-2,
    mm: 1e-3,
    millimetre: 1e-3,
    millimetres: 1e-3,
    millimeter: 1e-3,
    millimeters: 1e-3,
    km: 1e3,
    kilometre: 1e3,
    kilometres: 1e3,
    kilometer: 1e3,
    kilometers: 1e3,
  },
  time: {
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1,
    ms: 1e-3,
    msec: 1e-3,
    millisecond: 1e-3,
    milliseconds: 1e-3,
  },
  speed: {
    "m/s": 1,
    mps: 1,
    metrepersecond: 1,
    metrespersecond: 1,
    meterpersecond: 1,
    meterspersecond: 1,
  },
};

function normalizeUnit(unit) {
  return unit.toLowerCase().replace(/μ/g, "µ").replace(/\./g, "");
}

function parseAnswerQuantity(raw, question, unitRequired) {
  const normalized = String(raw ?? "")
    .trim()
    .replace(/−/g, "-")
    .replace(/,/g, ".");
  const match = normalized.match(
    /^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z/.]+)?$/
  );

  if (!match) return { error: "invalid" };

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return { error: "invalid" };

  const unitText = match[2] ? normalizeUnit(match[2]) : "";
  if (unitRequired && !unitText) return { error: "missing-unit" };

  const factors = UNIT_FACTORS[question.quantity];
  const canonicalFactor = factors[normalizeUnit(question.unit)];
  const enteredFactor = unitText ? factors[unitText] : canonicalFactor;
  if (enteredFactor === undefined) return { error: "wrong-unit" };

  return {
    valueInBaseUnits: value * enteredFactor,
    answerInBaseUnits: question.answer * canonicalFactor,
    toleranceInBaseUnits: question.tolerance * canonicalFactor,
  };
}

function getCoalescedPointerSamples(event) {
  const nativeEvent = event.nativeEvent || event;
  const samples =
    typeof nativeEvent.getCoalescedEvents === "function"
      ? nativeEvent.getCoalescedEvents()
      : [];

  return samples.length ? samples : [nativeEvent];
}

// The six facts removed from the original list were 7, 8, 14, 16, 18 and 19.
const BAT_FACTS = [
  "Bats are the only mammals capable of true powered flight.",
  "There are more than 1,400 species of bat in the world.",
  "Bats live on every continent except Antarctica.",
  "The scientific name for the bat group, Chiroptera, means “hand-wing”. Their wings are supported by elongated finger bones.",
  "Bats have existed for more than 50 million years.",
  "Bats are not blind. Many have very sensitive vision that works well in dim light.",
  "When an echolocating bat closes in on an insect, it can make its calls faster and faster in a “feeding buzz”.",
  "Different bat species have different call patterns. Scientists can record bat calls to help identify and study them.",
  "Some bats eat insects, some eat fruit or nectar, and some species even catch fish.",
  "Only three of the world’s 1,400+ bat species are vampire bats that feed on blood.",
  "Some bats are important pollinators. They carry pollen between flowers while feeding on nectar.",
  "Lesser long-nosed bats can have tongues as long as their bodies, which they use to drink nectar from cactus and agave flowers.",
  "Baby bats are called pups.",
  "One exceptionally long-lived Siberian bat was recaptured at least 41 years after it was first banded.",
];

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createRewardPlan() {
  const pictures = shuffle(BAT_IMAGES).slice(0, QUESTIONS.length);
  const facts = shuffle(BAT_FACTS).slice(0, QUESTIONS.length);

  return QUESTIONS.map((_, index) => ({
    afterQuestion: index + 1,
    image: pictures[index],
    fact: facts[index],
  }));
}


let SESSION_CACHE = null;

function getSession() {
  if (!SESSION_CACHE) {
    SESSION_CACHE = {
      rewardPlan: createRewardPlan(),
      currentIndex: 0,
      answers: QUESTIONS.map(() => ""),
      units: QUESTIONS.map(() => ""),
      checked: QUESTIONS.map(() => false),
      correct: QUESTIONS.map(() => false),
      swapped: false,
      activeReward: null,
      seenRewards: [],
      drawings: QUESTIONS.map(() => []),
      answerInkStrokes: QUESTIONS.map(() => []),
      unitInkStrokes: QUESTIONS.map(() => []),
      recognisedAnswers: QUESTIONS.map(() => ""),
      recognisedUnits: QUESTIONS.map(() => ""),
      autoShowBatPictures: true,
      wrongAttempts: QUESTIONS.map(() => 0),
      workingHelpShown: QUESTIONS.map(() => false),
    };
  }

  SESSION_CACHE.wrongAttempts ??= QUESTIONS.map(() => 0);
  SESSION_CACHE.workingHelpShown ??= QUESTIONS.map(() => false);
  SESSION_CACHE.units ??= QUESTIONS.map(() => "");
  SESSION_CACHE.unitInkStrokes ??= QUESTIONS.map(() => []);
  SESSION_CACHE.recognisedUnits ??= QUESTIONS.map(() => "");

  return SESSION_CACHE;
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h11" />
      <path d="m15 4 3 3-3 3" />
      <path d="M17 17H6" />
      <path d="m9 14-3 3 3 3" />
    </svg>
  );
}

export default function BatEcholocationQuiz({ onFinish, onRewardChange }) {
  // Module-level session state survives closing/reopening the component and is cleared by a page refresh.
  const sessionRef = useRef(getSession());
  const session = sessionRef.current;
  const rewardPlan = session.rewardPlan;

  const [currentIndex, setCurrentIndex] = useState(session.currentIndex);
  const [answers, setAnswers] = useState(() => [...session.answers]);
  const [units, setUnits] = useState(() => [...session.units]);
  const [checked, setChecked] = useState(() => [...session.checked]);
  const [correct, setCorrect] = useState(() => [...session.correct]);
  const [feedback, setFeedback] = useState({ type: "", text: "" });
  const [swapped, setSwapped] = useState(session.swapped);
  const [activeReward, setActiveReward] = useState(session.activeReward);
  const [answerInkMessage, setAnswerInkMessage] = useState("");
  const [answerEntryMode, setAnswerEntryMode] = useState("write");
  const [recognisedAnswers, setRecognisedAnswers] = useState(() => [
    ...session.recognisedAnswers,
  ]);
  const [recognisedUnits, setRecognisedUnits] = useState(() => [
    ...session.recognisedUnits,
  ]);
  const [autoShowBatPictures, setAutoShowBatPictures] = useState(
    session.autoShowBatPictures
  );
  const [pictureRevealed, setPictureRevealed] = useState(
    session.autoShowBatPictures
  );
  const [wrongAttempts, setWrongAttempts] = useState(() => [
    ...session.wrongAttempts,
  ]);
  const [workingHelpShown, setWorkingHelpShown] = useState(() => [
    ...session.workingHelpShown,
  ]);

  const seenRewardsRef = useRef(new Set(session.seenRewards));
  const drawingsRef = useRef(session.drawings);
  const workingHelpShownRef = useRef(session.workingHelpShown);
  const currentIndexRef = useRef(session.currentIndex);
  const drawingRef = useRef(false);
  const activeStrokeRef = useRef(null);
  const helpScrollAnimationRef = useRef(null);

  const canvasRef = useRef(null);
  const layoutWrapRef = useRef(null);
  const questionSideRef = useRef(null);
  const workSideRef = useRef(null);
  const swapButtonRef = useRef(null);
  const answerInputRef = useRef(null);
  const unitInputRef = useRef(null);
  const answerInkSurfaceRef = useRef(null);
  const answerInkCanvasRef = useRef(null);
  const answerInkStrokesRef = useRef(session.answerInkStrokes);
  const answerInkActiveStrokeRef = useRef(null);
  const answerInkPointerIdRef = useRef(null);
  const answerInkErasingRef = useRef(false);
  const answerInkTimerRef = useRef(null);
  const nativeHandwritingRecognizerRef = useRef(null);
  const answerRecognitionRequestRef = useRef(0);
  const unitInkSurfaceRef = useRef(null);
  const unitInkCanvasRef = useRef(null);
  const unitInkStrokesRef = useRef(session.unitInkStrokes);
  const unitInkActiveStrokeRef = useRef(null);
  const unitInkPointerIdRef = useRef(null);
  const unitInkErasingRef = useRef(false);
  const unitInkTimerRef = useRef(null);
  const unitRecognitionRequestRef = useRef(0);

  const currentQuestion = QUESTIONS[currentIndex];
  const answerUnitRequired = currentIndex >= UNIT_REQUIRED_FROM_INDEX;
  const score = useMemo(() => correct.filter(Boolean).length, [correct]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    session.currentIndex = currentIndex;
  }, [currentIndex, session]);

  useEffect(() => {
    session.answers = answers;
  }, [answers, session]);

  useEffect(() => {
    session.units = units;
  }, [units, session]);

  useEffect(() => {
    session.checked = checked;
  }, [checked, session]);

  useEffect(() => {
    session.correct = correct;
  }, [correct, session]);

  useEffect(() => {
    session.recognisedAnswers = recognisedAnswers;
  }, [recognisedAnswers, session]);

  useEffect(() => {
    session.recognisedUnits = recognisedUnits;
  }, [recognisedUnits, session]);

  useEffect(() => {
    session.swapped = swapped;
  }, [swapped, session]);

  useEffect(() => {
    session.activeReward = activeReward;
  }, [activeReward, session]);

  useEffect(() => {
    onRewardChange?.(activeReward !== null);
  }, [activeReward, onRewardChange]);

  useEffect(() => {
    session.autoShowBatPictures = autoShowBatPictures;
  }, [autoShowBatPictures, session]);

  useEffect(() => {
    session.wrongAttempts = wrongAttempts;
  }, [wrongAttempts, session]);

  useEffect(() => {
    session.workingHelpShown = workingHelpShown;
    workingHelpShownRef.current = workingHelpShown;
  }, [workingHelpShown, session]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const helpValues = workingHelpShownRef.current[currentIndexRef.current]
      ? WORKING_HELP[currentIndexRef.current]
      : null;
    const originalWidth = helpValues
      ? rect.width / WORKING_HELP_TOTAL_WIDTH
      : rect.width;

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
          { text: "340", quantity: "speed" },
          { text: " × " },
          { text: helpValues.time, quantity: "time" },
        ],
      ];

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.font = `600 ${fontSize}px "Segoe Print", "Comic Sans MS", sans-serif`;
      ctx.textBaseline = "top";
      const helpAreaWidth = originalWidth * WORKING_HELP_LEFT_SPACE;
      const widestLine = Math.max(
        ...helpLines.map((segments) =>
          segments.reduce(
            (total, segment) => total + ctx.measureText(segment.text).width,
            0
          )
        )
      );
      if (widestLine > helpAreaWidth - 32) {
        fontSize = Math.max(17, fontSize * ((helpAreaWidth - 32) / widestLine));
        ctx.font = `600 ${fontSize}px "Segoe Print", "Comic Sans MS", sans-serif`;
      }

      helpLines.forEach((segments, index) => {
        const lineWidth = segments.reduce(
          (total, segment) => total + ctx.measureText(segment.text).width,
          0
        );
        let x = (helpAreaWidth - lineWidth) / 2;
        const y = rect.height * 0.08 + index * fontSize * 1.65;

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

    const strokes = drawingsRef.current[currentIndexRef.current] || [];

    strokes.forEach((stroke) => {
      if (!stroke.points.length) return;

      ctx.save();
      ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
      ctx.strokeStyle = "#111827";
      ctx.fillStyle = "#111827";
      ctx.lineWidth = stroke.mode === "erase" ? 24 : 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const first = stroke.points[0];
      const renderX = (x) =>
        helpValues
          ? (WORKING_HELP_LEFT_SPACE + x) * originalWidth
          : x * rect.width;

      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(
          renderX(first.x),
          first.y * rect.height,
          stroke.mode === "erase" ? 12 : 1.5,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(renderX(first.x), first.y * rect.height);

        for (let i = 1; i < stroke.points.length; i += 1) {
          const point = stroke.points[i];
          ctx.lineTo(renderX(point.x), point.y * rect.height);
        }

        ctx.stroke();
      }

      ctx.restore();
    });
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    redraw();
  }, [redraw]);

  const positionSwapButton = useCallback(() => {
    const wrap = layoutWrapRef.current;
    const question = questionSideRef.current;
    const work = workSideRef.current;
    const button = swapButtonRef.current;

    if (!wrap || !question || !work || !button) return;

    if (window.matchMedia("(max-width: 760px)").matches) {
      button.style.left = "";
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const qRect = question.getBoundingClientRect();
    const wRect = work.getBoundingClientRect();

    // The centre of the physical gap between the two panels, regardless of which one is left.
    const gapLeft = Math.min(qRect.right, wRect.right);
    const gapRight = Math.max(qRect.left, wRect.left);
    button.style.left = `${(gapLeft + gapRight) / 2 - wrapRect.left}px`;
  }, []);

  useLayoutEffect(() => {
    positionSwapButton();
    resizeCanvas();
  }, [
    swapped,
    currentIndex,
    activeReward,
    workingHelpShown,
    positionSwapButton,
    resizeCanvas,
  ]);

  useEffect(() => {
    if (activeReward !== null) return undefined;

    const wrap = layoutWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      positionSwapButton();
      resizeCanvas();
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, [activeReward, positionSwapButton, resizeCanvas]);

  useEffect(() => {
    const handleResize = () => {
      positionSwapButton();
      resizeCanvas();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [positionSwapButton, resizeCanvas]);

  useEffect(() => {
    if (activeReward === null) {
      requestAnimationFrame(resizeCanvas);
    }
  }, [activeReward, currentIndex, resizeCanvas]);

  const redrawAnswerInk = useCallback(() => {
    const surface = answerInkSurfaceRef.current;
    const canvas = answerInkCanvasRef.current;
    if (!surface || !canvas) return;

    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#111827";
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const strokes = answerInkStrokesRef.current[currentIndexRef.current] || [];

    strokes.forEach((stroke) => {
      if (!stroke.points.length) return;

      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
  }, []);

  const redrawUnitInk = useCallback(() => {
    const surface = unitInkSurfaceRef.current;
    const canvas = unitInkCanvasRef.current;
    if (!surface || !canvas) return;

    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.strokeStyle = "#111827";
    context.fillStyle = "#111827";
    context.lineWidth = 3.4;
    context.lineCap = "round";
    context.lineJoin = "round";

    const strokes = unitInkStrokesRef.current[currentIndexRef.current] || [];
    strokes.forEach((stroke) => {
      if (!stroke.points.length) return;
      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        context.beginPath();
        context.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
        context.fill();
        return;
      }
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let index = 1; index < stroke.points.length; index += 1) {
        context.lineTo(stroke.points[index].x, stroke.points[index].y);
      }
      context.stroke();
    });
  }, []);

  const clearAnswerInk = useCallback(() => {
    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }
    answerRecognitionRequestRef.current += 1;
    answerInkStrokesRef.current[currentIndexRef.current] = [];
    session.answerInkStrokes = answerInkStrokesRef.current;
    answerInkActiveStrokeRef.current = null;
    answerInkPointerIdRef.current = null;
    answerInkErasingRef.current = false;
    redrawAnswerInk();
  }, [redrawAnswerInk, session]);

  const clearUnitInk = useCallback(() => {
    if (unitInkTimerRef.current) {
      window.clearTimeout(unitInkTimerRef.current);
      unitInkTimerRef.current = null;
    }
    unitRecognitionRequestRef.current += 1;
    unitInkStrokesRef.current[currentIndexRef.current] = [];
    session.unitInkStrokes = unitInkStrokesRef.current;
    unitInkActiveStrokeRef.current = null;
    unitInkPointerIdRef.current = null;
    unitInkErasingRef.current = false;
    redrawUnitInk();
  }, [redrawUnitInk, session]);

  useEffect(() => {
    if (helpScrollAnimationRef.current) {
      window.cancelAnimationFrame(helpScrollAnimationRef.current);
      helpScrollAnimationRef.current = null;
    }
    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }
    answerInkActiveStrokeRef.current = null;
    answerInkPointerIdRef.current = null;
    answerInkErasingRef.current = false;
    if (unitInkTimerRef.current) {
      window.clearTimeout(unitInkTimerRef.current);
      unitInkTimerRef.current = null;
    }
    unitInkActiveStrokeRef.current = null;
    unitInkPointerIdRef.current = null;
    unitInkErasingRef.current = false;
    setAnswerInkMessage("");
    setAnswerEntryMode("write");
    window.requestAnimationFrame(redrawAnswerInk);
    window.requestAnimationFrame(redrawUnitInk);
  }, [currentIndex, redrawAnswerInk, redrawUnitInk]);

  useEffect(() => {
    if (answerEntryMode !== "write") return undefined;

    const surface = answerInkSurfaceRef.current;
    const unitSurface = unitInkSurfaceRef.current;
    if (!surface) return undefined;

    window.requestAnimationFrame(redrawAnswerInk);
    window.requestAnimationFrame(redrawUnitInk);

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      redrawAnswerInk();
      redrawUnitInk();
    });
    observer.observe(surface);
    if (unitSurface) observer.observe(unitSurface);
    return () => observer.disconnect();
  }, [answerEntryMode, answerUnitRequired, redrawAnswerInk, redrawUnitInk]);

  useEffect(() => {
    // Load the local digit model in the background so the first handwritten
    // answer can be recognised without a noticeable model-startup pause.
    void warmOnnxDigitRecognizer();
    void warmOnnxUnitRecognizer();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function prepareNativeHandwritingRecognition() {
      if (!("createHandwritingRecognizer" in navigator)) return;
      if (typeof window.HandwritingStroke !== "function") return;

      try {
        const recognizer = await navigator.createHandwritingRecognizer({
          languages: ["en"],
        });

        if (cancelled) {
          recognizer.finish?.();
          return;
        }

        nativeHandwritingRecognizerRef.current = recognizer;
      } catch {
        // The local ONNX recognizer and Type answer remain available.
      }
    }

    prepareNativeHandwritingRecognition();

    return () => {
      cancelled = true;
      nativeHandwritingRecognizerRef.current?.finish?.();
      nativeHandwritingRecognizerRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (answerInkTimerRef.current) window.clearTimeout(answerInkTimerRef.current);
      if (unitInkTimerRef.current) window.clearTimeout(unitInkTimerRef.current);
      if (helpScrollAnimationRef.current) {
        window.cancelAnimationFrame(helpScrollAnimationRef.current);
      }
    },
    []
  );

  const showQuestionFeedback = useCallback(
    (index) => {
      if (!checked[index]) {
        setFeedback({ type: "", text: "" });
        return;
      }

      const question = QUESTIONS[index];
      if (correct[index]) {
        setFeedback({
          type: "correct",
          text: `Correct — ${question.answer} ${question.unit}.`,
        });
      } else {
        setFeedback({
          type: "wrong",
          text: "Change your answer and try again.",
        });
      }
    },
    [checked, correct]
  );

  useEffect(() => {
    showQuestionFeedback(currentIndex);
  }, [currentIndex, showQuestionFeedback]);

  const setCurrentAnswerValue = useCallback(
    (value) => {
      setAnswers((previous) => {
        const next = [...previous];
        next[currentIndex] = value;
        return next;
      });

      setChecked((previous) => {
        const next = [...previous];
        next[currentIndex] = false;
        return next;
      });

      setCorrect((previous) => {
        const next = [...previous];
        next[currentIndex] = false;
        return next;
      });

      setFeedback({ type: "", text: "" });
    },
    [currentIndex]
  );

  const handleAnswerChange = (event) => {
    setCurrentAnswerValue(event.target.value);
  };

  const setCurrentUnitValue = useCallback(
    (value) => {
      const normalized = String(value ?? "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .slice(0, 3);
      setUnits((previous) => {
        const next = [...previous];
        next[currentIndex] = normalized;
        return next;
      });
      setChecked((previous) => {
        const next = [...previous];
        next[currentIndex] = false;
        return next;
      });
      setCorrect((previous) => {
        const next = [...previous];
        next[currentIndex] = false;
        return next;
      });
      setFeedback({ type: "", text: "" });
    },
    [currentIndex]
  );

  const handleUnitChange = (event) => {
    setCurrentUnitValue(event.target.value.replace(/[^a-zA-Z/]/g, ""));
  };

  const handleTypeAnswer = () => {
    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }
    if (unitInkTimerRef.current) {
      window.clearTimeout(unitInkTimerRef.current);
      unitInkTimerRef.current = null;
    }
    setAnswerEntryMode("type");
    window.requestAnimationFrame(() => answerInputRef.current?.focus());
  };

  const handleKeypadPress = (key) => {
    const current = answers[currentIndex].replace(",", ".");

    if (key === "backspace") {
      setCurrentAnswerValue(current.slice(0, -1));
      return;
    }

    if (key === "clear") {
      setCurrentAnswerValue("");
      return;
    }

    if (key === ".") {
      if (current.includes(".")) return;
      setCurrentAnswerValue(current ? `${current}.` : "0.");
      return;
    }

    if (!/^\d$/.test(key)) return;

    const digits = current.replace(/\D/g, "");
    if (digits.length >= 5) return;

    setCurrentAnswerValue(current === "0" ? key : `${current}${key}`);
  };

  const handleWriteAnswer = () => {
    answerInputRef.current?.blur();
    unitInputRef.current?.blur();
    const recognised = recognisedAnswers[currentIndex];
    if (recognised) setCurrentAnswerValue(recognised);
    const recognisedUnit = recognisedUnits[currentIndex];
    if (recognisedUnit) setCurrentUnitValue(recognisedUnit);
    setAnswerEntryMode("write");
    window.requestAnimationFrame(() => {
      redrawAnswerInk();
      redrawUnitInk();
    });
  };

  const handleClearAnswer = () => {
    clearAnswerInk();
    clearUnitInk();
    setRecognisedAnswers((previous) => {
      const next = [...previous];
      next[currentIndex] = "";
      return next;
    });
    setRecognisedUnits((previous) => {
      const next = [...previous];
      next[currentIndex] = "";
      return next;
    });
    setCurrentAnswerValue("");
    setCurrentUnitValue("");
    setAnswerInkMessage("");
  };

  const handleCheckAnswer = async (event) => {
    event.preventDefault();

    let rawNumber = answers[currentIndex].trim();
    let rawUnit = answerUnitRequired ? units[currentIndex].trim() : "";

    // In handwriting mode, use the complete visible ink. Recognition never
    // erases or replaces the learner's writing; it only updates the reading
    // shown underneath the box.
    const currentInk = answerInkStrokesRef.current[currentIndex] || [];
    if (answerEntryMode === "write" && currentInk.length) {
      const recognisedNow = await recogniseAnswerInk();
      if (recognisedNow) rawNumber = recognisedNow;
      else rawNumber = recognisedAnswers[currentIndex].trim();
    }

    const currentUnitInk = unitInkStrokesRef.current[currentIndex] || [];
    if (answerEntryMode === "write" && answerUnitRequired && currentUnitInk.length) {
      const recognisedUnitNow = await recogniseUnitInk();
      if (recognisedUnitNow) rawUnit = recognisedUnitNow;
      else rawUnit = recognisedUnits[currentIndex].trim();
    }

    const parsedAnswer = parseAnswerQuantity(
      answerUnitRequired ? `${rawNumber} ${rawUnit}` : rawNumber,
      currentQuestion,
      answerUnitRequired
    );

    if (parsedAnswer.error) {
      const errorText =
        parsedAnswer.error === "missing-unit"
          ? "Write a unit in the unit box before checking."
          : parsedAnswer.error === "wrong-unit"
            ? "Check the unit."
            : answerEntryMode === "write"
              ? "I couldn't read a valid answer yet. Rewrite either box, or use Type answer."
              : "Enter a valid number and unit first.";
      setFeedback({
        type: "wrong",
        text: errorText,
      });
      return;
    }

    const isCorrect =
      Math.abs(
        parsedAnswer.valueInBaseUnits - parsedAnswer.answerInBaseUnits
      ) <= parsedAnswer.toleranceInBaseUnits;

    setChecked((previous) => {
      const next = [...previous];
      next[currentIndex] = true;
      return next;
    });

    setCorrect((previous) => {
      const next = [...previous];
      next[currentIndex] = isCorrect;
      return next;
    });

    setFeedback(
      isCorrect
        ? {
            type: "correct",
            text: `Correct — ${currentQuestion.answer} ${currentQuestion.unit}.`,
          }
        : {
            type: "wrong",
            text: "Change your answer and try again.",
          }
    );

    if (!isCorrect) {
      setWrongAttempts((previous) => {
        const next = [...previous];
        next[currentIndex] += 1;
        return next;
      });
    }
  };

  const handleShowWorkingHelp = () => {
    if (currentIndex >= WORKING_HELP.length) return;

    setWorkingHelpShown((previous) => {
      const next = [...previous];
      next[currentIndex] = true;
      workingHelpShownRef.current = next;
      return next;
    });
    window.requestAnimationFrame(() => {
      const workpad = canvasRef.current?.parentElement;
      resizeCanvas();

      if (!workpad) return;
      const startScroll = Math.max(0, workpad.scrollWidth - workpad.clientWidth);
      workpad.scrollLeft = startScroll;

      if (helpScrollAnimationRef.current) {
        window.cancelAnimationFrame(helpScrollAnimationRef.current);
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        workpad.scrollLeft = 0;
        return;
      }

      const duration = 1500;
      const startTime = performance.now();
      const animateScroll = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        workpad.scrollLeft = startScroll * (1 - eased);

        if (progress < 1) {
          helpScrollAnimationRef.current = window.requestAnimationFrame(animateScroll);
        } else {
          helpScrollAnimationRef.current = null;
        }
      };

      helpScrollAnimationRef.current = window.requestAnimationFrame(animateScroll);
    });
  };

  const moveToQuestion = (index) => {
    setCurrentIndex(index);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) moveToQuestion(currentIndex - 1);
  };

  const handleNext = () => {
    if (!correct[currentIndex]) return;

    const completedQuestion = currentIndex + 1;

    if (!seenRewardsRef.current.has(completedQuestion)) {
      seenRewardsRef.current.add(completedQuestion);
      session.seenRewards = [...seenRewardsRef.current];
      setPictureRevealed(autoShowBatPictures);
      setActiveReward(completedQuestion - 1);
      return;
    }

    if (currentIndex < QUESTIONS.length - 1) {
      moveToQuestion(currentIndex + 1);
    }
  };

  const handleContinueReward = () => {
    if (activeReward === null) return;

    const completedQuestion = rewardPlan[activeReward].afterQuestion;
    setActiveReward(null);

    if (completedQuestion < QUESTIONS.length) {
      moveToQuestion(completedQuestion);
    }
  };

  const handleReview = () => {
    setActiveReward(null);
    moveToQuestion(0);
  };

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const helpIsVisible = workingHelpShownRef.current[currentIndexRef.current];
    const renderedX = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width)
    );
    const logicalX = helpIsVisible
      ? renderedX * WORKING_HELP_TOTAL_WIDTH - WORKING_HELP_LEFT_SPACE
      : renderedX;

    return {
      x: Math.max(-WORKING_HELP_LEFT_SPACE, Math.min(1, logicalX)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const isEraserEvent = (event) =>
    event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) === 32);

  const isAnswerWritingPointer = (event) =>
    event.pointerType === "pen" ||
    event.pointerType === "touch" ||
    (event.pointerType === "mouse" && event.button === 0);

  const getAnswerInkPoint = (event, strokeStartTime = performance.now()) => {
    const surface = answerInkSurfaceRef.current;
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      t: Math.max(0, performance.now() - strokeStartTime),
    };
  };

  const normalizeRecognisedNumber = (value) => {
    const cleaned = String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/,/g, ".");

    if (/^\d{1,3}(?:\.\d{1,2})?$/.test(cleaned)) return cleaned;

    const match = cleaned.match(/\d{1,3}(?:\.\d{1,2})?/);
    return match ? match[0] : "";
  };

  const normalizeRecognisedUnit = (value) => {
    const cleaned = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z/]/g, "");
    return RECOGNISABLE_UNITS.includes(cleaned) ? cleaned : "";
  };

  const recogniseWithDeviceHandwriting = async (
    strokes,
    question,
    recognitionKind
  ) => {
    const recognizer = nativeHandwritingRecognizerRef.current;
    if (!recognizer || typeof window.HandwritingStroke !== "function") return "";

    const firstPointerType = strokes.find((stroke) => stroke.pointerType)?.pointerType;
    const inputType =
      firstPointerType === "pen"
        ? "stylus"
        : ["touch", "mouse"].includes(firstPointerType)
          ? firstPointerType
          : undefined;

    try {
      const hints = recognitionKind === "unit"
        ? {
            recognitionType: "text",
            alternatives: 8,
            graphemeSet: ["m", "s", "c", "k", "/", "M", "S", "C", "K"],
          }
        : {
            recognitionType: "number",
            alternatives: 4,
            graphemeSet: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "."],
          };
      if (inputType) hints.inputType = inputType;

      const drawing = recognizer.startDrawing(hints);

      strokes.forEach((stroke) => {
        const nativeStroke = new window.HandwritingStroke();
        stroke.points.forEach((point) => {
          nativeStroke.addPoint({ x: point.x, y: point.y, t: point.t });
        });
        drawing.addStroke(nativeStroke);
      });

      const predictions = await drawing.getPrediction();
      drawing.clear?.();

      for (const prediction of predictions || []) {
        const candidate = recognitionKind === "unit"
          ? normalizeRecognisedUnit(prediction?.text)
          : normalizeRecognisedNumber(prediction?.text);
        if (candidate) return candidate;
      }
    } catch {
      // Return no device result; the local ONNX result remains available.
    }

    return "";
  };

  const recogniseAnswerInk = async () => {
    const surface = answerInkSurfaceRef.current;
    const index = currentIndexRef.current;
    const strokes = answerInkStrokesRef.current[index] || [];
    if (!surface || !strokes.length) return recognisedAnswers[index] || "";

    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }

    const requestId = ++answerRecognitionRequestRef.current;
    setAnswerInkMessage("Recognising…");
    const question = QUESTIONS[index];

    // Run the bundled neural-network recogniser locally in the browser. The
    // handwriting never leaves the device. If its confidence is low, a browser/
    // device handwriting recogniser can still supply a better reading where one
    // is available. Type answer remains the guaranteed fallback.
    const rect = surface.getBoundingClientRect();
    const onnxResult = await recogniseNumberWithOnnx(
      strokes,
      rect.width,
      rect.height
    );
    const numberText = normalizeRecognisedNumber(onnxResult.text);
    let text = numberText;
    let confident = Boolean(text && onnxResult.confident);

    if (!confident) {
      const deviceText = await recogniseWithDeviceHandwriting(
        strokes,
        question,
        "number"
      );
      if (deviceText) {
        text = deviceText;
        confident = true;
      }
    }

    if (requestId !== answerRecognitionRequestRef.current) return "";

    if (text) {
      setRecognisedAnswers((previous) => {
        const next = [...previous];
        next[index] = text;
        return next;
      });

      setAnswers((previous) => {
        const next = [...previous];
        next[index] = text;
        return next;
      });

      setChecked((previous) => {
        const next = [...previous];
        next[index] = false;
        return next;
      });

      setCorrect((previous) => {
        const next = [...previous];
        next[index] = false;
        return next;
      });

      setFeedback({ type: "", text: "" });
      setAnswerInkMessage(
        confident
          ? ""
          : "Check the recognised number before submitting."
      );
      return text;
    }

    setRecognisedAnswers((previous) => {
      const next = [...previous];
      next[index] = "";
      return next;
    });
    setAnswers((previous) => {
      const next = [...previous];
      next[index] = "";
      return next;
    });
    setAnswerInkMessage("I couldn't read that yet — clear and rewrite, or use Type answer.");
    return "";
  };

  const recogniseUnitInk = async () => {
    const surface = unitInkSurfaceRef.current;
    const index = currentIndexRef.current;
    const strokes = unitInkStrokesRef.current[index] || [];
    if (!surface || !strokes.length) return recognisedUnits[index] || "";

    if (unitInkTimerRef.current) {
      window.clearTimeout(unitInkTimerRef.current);
      unitInkTimerRef.current = null;
    }

    const requestId = ++unitRecognitionRequestRef.current;
    setAnswerInkMessage("Recognising unit…");
    const question = QUESTIONS[index];
    const rect = surface.getBoundingClientRect();
    const onnxResult = await recogniseUnitWithOnnx(strokes, rect.height);
    let text = normalizeRecognisedUnit(onnxResult.text);
    let confident = Boolean(text && onnxResult.confident);

    if (!confident) {
      const deviceText = await recogniseWithDeviceHandwriting(strokes, question, "unit");
      if (deviceText) {
        text = deviceText;
        confident = true;
      }
    }

    if (requestId !== unitRecognitionRequestRef.current) return "";

    setRecognisedUnits((previous) => {
      const next = [...previous];
      next[index] = text;
      return next;
    });
    setUnits((previous) => {
      const next = [...previous];
      next[index] = text;
      return next;
    });
    setChecked((previous) => {
      const next = [...previous];
      next[index] = false;
      return next;
    });
    setCorrect((previous) => {
      const next = [...previous];
      next[index] = false;
      return next;
    });
    setFeedback({ type: "", text: "" });

    if (text) {
      setAnswerInkMessage(confident ? "" : "Check the recognised unit before submitting.");
      return text;
    }

    setAnswerInkMessage(
      `I couldn't read that unit — use ${RECOGNISABLE_UNITS.join(", ")}, or Type answer.`
    );
    return "";
  };

  const scheduleAnswerInkRecognition = () => {
    if (answerInkTimerRef.current) window.clearTimeout(answerInkTimerRef.current);
    answerInkTimerRef.current = window.setTimeout(() => {
      answerInkTimerRef.current = null;
      void recogniseAnswerInk();
    }, 700);
  };

  const scheduleUnitInkRecognition = () => {
    if (unitInkTimerRef.current) window.clearTimeout(unitInkTimerRef.current);
    unitInkTimerRef.current = window.setTimeout(() => {
      unitInkTimerRef.current = null;
      void recogniseUnitInk();
    }, 700);
  };

  const eraseAnswerInkAt = (point, radius = 18) => {
    const index = currentIndexRef.current;
    const strokes = answerInkStrokesRef.current[index] || [];
    const nextStrokes = [];

    strokes.forEach((stroke) => {
      let survivingSegment = [];

      const keepSegment = () => {
        if (!survivingSegment.length) return;
        nextStrokes.push({
          ...stroke,
          points: survivingSegment,
        });
        survivingSegment = [];
      };

      stroke.points.forEach((strokePoint) => {
        const beneathEraser = Math.hypot(
          strokePoint.x - point.x,
          strokePoint.y - point.y
        ) <= radius;

        if (beneathEraser) keepSegment();
        else survivingSegment.push(strokePoint);
      });

      keepSegment();
    });

    answerInkStrokesRef.current[index] = nextStrokes;
    session.answerInkStrokes = answerInkStrokesRef.current;
    redrawAnswerInk();
    return nextStrokes.length > 0;
  };

  const handleAnswerInkPointerDownCapture = (event) => {
    if (!isAnswerWritingPointer(event)) return;

    event.preventDefault();
    event.stopPropagation();

    const surface = answerInkSurfaceRef.current;
    if (!surface) return;

    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }
    answerRecognitionRequestRef.current += 1;

    if (isEraserEvent(event)) {
      surface.setPointerCapture(event.pointerId);
      answerInkPointerIdRef.current = event.pointerId;
      answerInkErasingRef.current = true;
      answerInkActiveStrokeRef.current = null;
      setRecognisedAnswers((previous) => {
        const next = [...previous];
        next[currentIndexRef.current] = "";
        return next;
      });
      setCurrentAnswerValue("");
      setAnswerInkMessage("Erasing…");
      const eraserRadius = Math.max(18, Math.min(30, Math.max(event.width, event.height)));
      eraseAnswerInkAt(getAnswerInkPoint(event), eraserRadius);
      return;
    }

    const index = currentIndexRef.current;
    const strokes = answerInkStrokesRef.current[index] || [];
    if (!answerInkStrokesRef.current[index]) answerInkStrokesRef.current[index] = strokes;

    setAnswerInkMessage(strokes.length ? "Updating recognition…" : "Writing…");

    surface.setPointerCapture(event.pointerId);
    answerInkPointerIdRef.current = event.pointerId;

    const startTime = performance.now();
    const stroke = {
      pointerType: event.pointerType,
      startTime,
      points: [getAnswerInkPoint(event, startTime)],
    };
    answerInkActiveStrokeRef.current = stroke;
    strokes.push(stroke);
    session.answerInkStrokes = answerInkStrokesRef.current;
    redrawAnswerInk();
  };

  const handleAnswerInkPointerMoveCapture = (event) => {
    if (
      answerInkPointerIdRef.current !== event.pointerId ||
      !answerInkActiveStrokeRef.current
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (answerInkErasingRef.current) {
      const eraserRadius = Math.max(18, Math.min(30, Math.max(event.width, event.height)));
      eraseAnswerInkAt(getAnswerInkPoint(event), eraserRadius);
      return;
    }

    const startTime = answerInkActiveStrokeRef.current.startTime;
    const points = getCoalescedPointerSamples(event).map((sample) =>
      getAnswerInkPoint(sample, startTime)
    );
    answerInkActiveStrokeRef.current.points.push(...points);
    redrawAnswerInk();
  };

  const handleAnswerInkPointerEndCapture = (event) => {
    if (answerInkPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const surface = answerInkSurfaceRef.current;
    const wasErasing = answerInkErasingRef.current;
    answerInkActiveStrokeRef.current = null;
    answerInkPointerIdRef.current = null;
    answerInkErasingRef.current = false;

    if (surface?.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }

    if (wasErasing) {
      const strokesRemain = (answerInkStrokesRef.current[currentIndexRef.current] || []).length > 0;
      if (strokesRemain) {
        setAnswerInkMessage("Updating recognition…");
        scheduleAnswerInkRecognition();
      } else {
        setAnswerInkMessage("Answer cleared");
      }
    } else {
      scheduleAnswerInkRecognition();
    }
  };

  const getUnitInkPoint = (event, strokeStartTime = performance.now()) => {
    const surface = unitInkSurfaceRef.current;
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      t: Math.max(0, performance.now() - strokeStartTime),
    };
  };

  const eraseUnitInkAt = (point, radius = 18) => {
    const index = currentIndexRef.current;
    const strokes = unitInkStrokesRef.current[index] || [];
    const nextStrokes = [];

    strokes.forEach((stroke) => {
      let survivingSegment = [];
      const keepSegment = () => {
        if (!survivingSegment.length) return;
        nextStrokes.push({ ...stroke, points: survivingSegment });
        survivingSegment = [];
      };
      stroke.points.forEach((strokePoint) => {
        if (Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= radius) {
          keepSegment();
        } else {
          survivingSegment.push(strokePoint);
        }
      });
      keepSegment();
    });

    unitInkStrokesRef.current[index] = nextStrokes;
    session.unitInkStrokes = unitInkStrokesRef.current;
    redrawUnitInk();
    return nextStrokes.length > 0;
  };

  const handleUnitInkPointerDownCapture = (event) => {
    if (!isAnswerWritingPointer(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const surface = unitInkSurfaceRef.current;
    if (!surface) return;
    if (unitInkTimerRef.current) {
      window.clearTimeout(unitInkTimerRef.current);
      unitInkTimerRef.current = null;
    }
    unitRecognitionRequestRef.current += 1;

    if (isEraserEvent(event)) {
      surface.setPointerCapture(event.pointerId);
      unitInkPointerIdRef.current = event.pointerId;
      unitInkErasingRef.current = true;
      unitInkActiveStrokeRef.current = null;
      setRecognisedUnits((previous) => {
        const next = [...previous];
        next[currentIndexRef.current] = "";
        return next;
      });
      setCurrentUnitValue("");
      setAnswerInkMessage("Erasing unit…");
      const radius = Math.max(18, Math.min(30, Math.max(event.width, event.height)));
      eraseUnitInkAt(getUnitInkPoint(event), radius);
      return;
    }

    const index = currentIndexRef.current;
    const strokes = unitInkStrokesRef.current[index] || [];
    if (!unitInkStrokesRef.current[index]) unitInkStrokesRef.current[index] = strokes;
    setAnswerInkMessage(strokes.length ? "Updating unit…" : "Writing unit…");
    surface.setPointerCapture(event.pointerId);
    unitInkPointerIdRef.current = event.pointerId;
    const startTime = performance.now();
    const stroke = {
      pointerType: event.pointerType,
      startTime,
      points: [getUnitInkPoint(event, startTime)],
    };
    unitInkActiveStrokeRef.current = stroke;
    strokes.push(stroke);
    session.unitInkStrokes = unitInkStrokesRef.current;
    redrawUnitInk();
  };

  const handleUnitInkPointerMoveCapture = (event) => {
    if (unitInkPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (unitInkErasingRef.current) {
      const radius = Math.max(18, Math.min(30, Math.max(event.width, event.height)));
      eraseUnitInkAt(getUnitInkPoint(event), radius);
      return;
    }
    if (!unitInkActiveStrokeRef.current) return;
    const startTime = unitInkActiveStrokeRef.current.startTime;
    const points = getCoalescedPointerSamples(event).map((sample) =>
      getUnitInkPoint(sample, startTime)
    );
    unitInkActiveStrokeRef.current.points.push(...points);
    redrawUnitInk();
  };

  const handleUnitInkPointerEndCapture = (event) => {
    if (unitInkPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const surface = unitInkSurfaceRef.current;
    const wasErasing = unitInkErasingRef.current;
    unitInkActiveStrokeRef.current = null;
    unitInkPointerIdRef.current = null;
    unitInkErasingRef.current = false;
    if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);

    const strokesRemain = (unitInkStrokesRef.current[currentIndexRef.current] || []).length > 0;
    if (strokesRemain) {
      setAnswerInkMessage(wasErasing ? "Updating unit…" : "Recognising unit…");
      scheduleUnitInkRecognition();
    } else {
      setAnswerInkMessage("Unit cleared");
    }
  };

  const handlePointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);

    const stroke = {
      mode: isEraserEvent(event) ? "erase" : "draw",
      points: [getCanvasPoint(event)],
    };

    activeStrokeRef.current = stroke;
    drawingsRef.current[currentIndexRef.current].push(stroke);
    redraw();
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current || !activeStrokeRef.current) return;
    const points = getCoalescedPointerSamples(event).map(getCanvasPoint);
    activeStrokeRef.current.points.push(...points);
    redraw();
  };

  const handlePointerEnd = (event) => {
    const canvas = canvasRef.current;
    drawingRef.current = false;
    activeStrokeRef.current = null;

    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const clearWorking = () => {
    drawingsRef.current[currentIndexRef.current] = [];
    session.drawings = drawingsRef.current;
    drawingRef.current = false;
    activeStrokeRef.current = null;
    redraw();
  };

  const reward = activeReward === null ? null : rewardPlan[activeReward];
  const isFinalReward = reward?.afterQuestion === QUESTIONS.length;
  const currentAnswerInk = answerInkStrokesRef.current[currentIndex] || [];
  const currentUnitInk = unitInkStrokesRef.current[currentIndex] || [];
  const currentRecognisedAnswer = recognisedAnswers[currentIndex] || "";
  const currentRecognisedUnit = recognisedUnits[currentIndex] || "";

  return (
    <div className="batQuiz">
      {activeReward === null ? (
        <>
          <section className="batQuiz__top">
            <div className="batQuiz__topRow">
              <div className="batQuiz__formulaGroup">
                <div className="batQuiz__eyebrow">Echo calculations</div>
                <div
                  className={`batQuiz__formula ${currentIndex >= 4 ? "is-hidden" : ""}`}
                  aria-hidden={currentIndex >= 4}
                >
                  distance = ½ × speed × time
                </div>
              </div>

              <div className="batQuiz__topMeta">
                <div className="batQuiz__speed">
                  Speed of sound = <strong>340 m/s</strong>
                </div>
                <div className="batQuiz__progress">
                  Question {currentIndex + 1} of {QUESTIONS.length}
                </div>
                <div className="batQuiz__dots" aria-hidden="true">
                  {QUESTIONS.map((_, index) => (
                    <span
                      key={index}
                      className={`batQuiz__dot ${index === currentIndex ? "is-active" : ""}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="batQuiz__echoNote">
              The echo time is the total time taken for the sound to travel to the object and back.
            </div>
          </section>

          <section className="batQuiz__quizArea">
            <div className="batQuiz__layoutWrap" ref={layoutWrapRef}>
              <div className={`batQuiz__layout ${swapped ? "is-swapped" : ""}`}>
                <section className="batQuiz__questionPanel" ref={questionSideRef}>
                  <div className="batQuiz__questionLabel">Question</div>
                  <h2 className="batQuiz__questionText">{currentQuestion.text}</h2>

                  <form
                    className={`batQuiz__answerPanel ${
                      feedback.type === "correct" ? "has-correct-feedback" : ""
                    }`}
                    onSubmit={handleCheckAnswer}
                  >
                    <div className="batQuiz__answerLabel">Your answer</div>

                    <div className={`batQuiz__answerRow ${answerUnitRequired ? "has-unit-entry" : ""}`}>
                      {answerEntryMode === "write" ? (
                        <>
                          <div
                            ref={answerInkSurfaceRef}
                            className={`batQuiz__writeAnswerBox batQuiz__writeAnswerBox--number ${
                              currentAnswerInk.length ? "is-inking" : ""
                            }`}
                            role="textbox"
                            aria-label={`Write your numerical answer${answerUnitRequired ? "" : ` in ${currentQuestion.unit}`} with a stylus`}
                            onPointerDownCapture={handleAnswerInkPointerDownCapture}
                            onPointerMoveCapture={handleAnswerInkPointerMoveCapture}
                            onPointerUpCapture={handleAnswerInkPointerEndCapture}
                            onPointerCancelCapture={handleAnswerInkPointerEndCapture}
                          >
                            {!currentAnswerInk.length ? (
                              <div className="batQuiz__writePrompt">
                                {answerUnitRequired ? "Number" : "Write your answer"}
                              </div>
                            ) : null}
                            <canvas
                              ref={answerInkCanvasRef}
                              className="batQuiz__answerInkCanvas"
                              aria-hidden="true"
                            />
                          </div>
                          {answerUnitRequired ? (
                            <div
                              ref={unitInkSurfaceRef}
                              className={`batQuiz__writeAnswerBox batQuiz__writeAnswerBox--unit ${
                                currentUnitInk.length ? "is-inking" : ""
                              }`}
                              role="textbox"
                              aria-label={`Write the unit. Recognised units are ${RECOGNISABLE_UNITS.join(", ")}`}
                              onPointerDownCapture={handleUnitInkPointerDownCapture}
                              onPointerMoveCapture={handleUnitInkPointerMoveCapture}
                              onPointerUpCapture={handleUnitInkPointerEndCapture}
                              onPointerCancelCapture={handleUnitInkPointerEndCapture}
                            >
                              {!currentUnitInk.length ? (
                                <div className="batQuiz__writePrompt">Unit</div>
                              ) : null}
                              <canvas
                                ref={unitInkCanvasRef}
                                className="batQuiz__answerInkCanvas"
                                aria-hidden="true"
                              />
                            </div>
                          ) : (
                            <div className="batQuiz__unit">{currentQuestion.unit}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <input
                            ref={answerInputRef}
                            id="bat-quiz-answer"
                            className="batQuiz__answerInput batQuiz__answerInput--number"
                            type="text"
                            inputMode={answerUnitRequired ? "decimal" : "none"}
                            enterKeyHint="done"
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="Type a number"
                            aria-label={`Type your numerical answer${answerUnitRequired ? "" : ` in ${currentQuestion.unit}`}`}
                            value={answers[currentIndex]}
                            onChange={handleAnswerChange}
                          />
                          {answerUnitRequired ? (
                            <input
                              ref={unitInputRef}
                              className="batQuiz__answerInput batQuiz__answerInput--unit"
                              type="text"
                              inputMode="text"
                              enterKeyHint="done"
                              autoComplete="off"
                              autoCapitalize="off"
                              autoCorrect="off"
                              spellCheck={false}
                              maxLength={3}
                              placeholder="Unit"
                              aria-label={`Type the unit. Recognised units are ${RECOGNISABLE_UNITS.join(", ")}`}
                              value={units[currentIndex]}
                              onChange={handleUnitChange}
                            />
                          ) : (
                            <div className="batQuiz__unit">{currentQuestion.unit}</div>
                          )}
                        </>
                      )}
                    </div>

                    {answerEntryMode === "write" ? (
                      <div className="batQuiz__recognitionReadout" aria-live="polite">
                        <span>Recognised:</span>
                        <strong>{currentRecognisedAnswer || "—"}</strong>
                        <span>
                          {answerUnitRequired
                            ? currentRecognisedUnit || "—"
                            : currentQuestion.unit}
                        </span>
                      </div>
                    ) : null}

                    {answerEntryMode === "type" && !answerUnitRequired ? (
                      <div className="batQuiz__keypad" aria-label="Number keypad">
                        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map(
                          (key) => (
                            <button
                              key={key}
                              type="button"
                              className={`batQuiz__keypadKey ${key === "backspace" ? "is-action" : ""}`}
                              aria-label={key === "backspace" ? "Backspace" : key === "." ? "Decimal point" : key}
                              onClick={() => handleKeypadPress(key)}
                            >
                              {key === "backspace" ? "⌫" : key}
                            </button>
                          )
                        )}
                      </div>
                    ) : null}

                    <div className="batQuiz__answerModeRow">
                      {answerEntryMode === "write" ? (
                        <>
                          <button
                            type="button"
                            className="batQuiz__answerModeButton"
                            onClick={handleTypeAnswer}
                          >
                            Type answer
                          </button>
                          <button
                            type="button"
                            className="batQuiz__answerClearButton"
                            onClick={handleClearAnswer}
                            disabled={
                              !answers[currentIndex] &&
                              !units[currentIndex] &&
                              !currentAnswerInk.length &&
                              !currentUnitInk.length
                            }
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="batQuiz__answerModeButton"
                            onClick={handleWriteAnswer}
                          >
                            Write answer
                          </button>
                          <button
                            type="button"
                            className="batQuiz__answerClearButton"
                            onClick={handleClearAnswer}
                            disabled={!answers[currentIndex] && !units[currentIndex]}
                          >
                            Clear
                          </button>
                        </>
                      )}
                    </div>

                    <div
                      className={`batQuiz__inkStatus ${
                        answerInkMessage ? "is-visible" : ""
                      }`}
                      aria-live="polite"
                    >
                      {answerInkMessage || " "}
                    </div>

                    {feedback.text ? (
                      <div
                        className={`batQuiz__feedback batQuiz__feedback--${feedback.type}`}
                        role="status"
                        aria-live="polite"
                      >
                        {feedback.text}
                      </div>
                    ) : null}

                    {currentIndex < WORKING_HELP.length &&
                    wrongAttempts[currentIndex] >= 2 &&
                    !correct[currentIndex] ? (
                      <button
                        type="button"
                        className="batQuiz__stuckButton"
                        aria-pressed={workingHelpShown[currentIndex]}
                        onClick={handleShowWorkingHelp}
                      >
                        I’m completely stuck
                      </button>
                    ) : null}

                    <button className="batQuiz__button batQuiz__button--cyan batQuiz__check" type="submit">
                      Check answer
                    </button>
                  </form>
                </section>

                <section className="batQuiz__workPanel" ref={workSideRef}>
                  <div
                    className={`batQuiz__workpad ${
                      workingHelpShown[currentIndex] ? "has-working-help" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="batQuiz__workClear"
                      onClick={clearWorking}
                      aria-label="Clear working for this question"
                    >
                      Clear
                    </button>
                    <canvas
                      ref={canvasRef}
                      className="batQuiz__canvas"
                      aria-label="Working out area"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerEnd}
                      onPointerCancel={handlePointerEnd}
                    />
                  </div>
                </section>
              </div>

              <button
                ref={swapButtonRef}
                className="batQuiz__swap"
                type="button"
                aria-label="Swap question and working out sides"
                aria-pressed={swapped}
                title="Swap sides"
                onClick={() => setSwapped((value) => !value)}
              >
                <SwapIcon />
              </button>
            </div>

            <div className="batQuiz__nav">
              <button
                type="button"
                className="batQuiz__button batQuiz__button--ghost"
                disabled={currentIndex === 0}
                onClick={handlePrevious}
              >
                ← Previous question
              </button>

              <button
                type="button"
                className="batQuiz__button batQuiz__button--cyan"
                disabled={!correct[currentIndex]}
                onClick={handleNext}
              >
                {currentIndex === QUESTIONS.length - 1 ? "Finish →" : "Next question →"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="batQuiz__rewardPanel">
          <div className="batQuiz__rewardLayout">
            <div className="batQuiz__rewardImageWrap">
              {pictureRevealed ? (
                <img className="batQuiz__rewardImage" src={reward.image} alt="Bat reward" />
              ) : (
                <button
                  type="button"
                  className="batQuiz__showPictureButton"
                  onClick={() => setPictureRevealed(true)}
                >
                  Show bat picture
                </button>
              )}
            </div>

            <div className="batQuiz__rewardContent">
              <div className="batQuiz__rewardEyebrow">
                {isFinalReward ? "Challenge complete" : `${reward.afterQuestion} questions complete`}
              </div>
              <h2 className="batQuiz__rewardTitle">{isFinalReward ? "Well done!" : "Nice work!"}</h2>

              <p className="batQuiz__rewardProgress">
                {isFinalReward
                  ? `You completed all ${QUESTIONS.length} questions. Score: ${score} / ${QUESTIONS.length}`
                  : `You have completed ${reward.afterQuestion} of ${QUESTIONS.length} questions.`}
              </p>

              <div className="batQuiz__factBox">
                <div className="batQuiz__factLabel">Bat fact</div>
                <div className="batQuiz__factText">{reward.fact}</div>
              </div>

              <div className="batQuiz__rewardActions">
                {autoShowBatPictures ? (
                  <button
                    type="button"
                    className="batQuiz__button batQuiz__button--ghost"
                    onClick={() => setAutoShowBatPictures(false)}
                  >
                    No more bat pictures please
                  </button>
                ) : null}
                {!isFinalReward ? (
                  <button
                    type="button"
                    className="batQuiz__button batQuiz__button--cyan"
                    onClick={handleContinueReward}
                  >
                    Continue →
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="batQuiz__button batQuiz__button--ghost"
                      onClick={handleReview}
                    >
                      Review questions
                    </button>
                    {onFinish ? (
                      <button
                        type="button"
                        className="batQuiz__button batQuiz__button--cyan"
                        onClick={onFinish}
                      >
                        Finish
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
