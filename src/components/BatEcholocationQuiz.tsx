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
    tolerance: 0.005,
    hint: "Check your conversion from milliseconds to seconds.",
  },
  {
    text: "A bat detects a beetle 5.1 m away. How long does the sound take to travel to the beetle and back?",
    answer: 30,
    unit: "ms",
    tolerance: 0.05,
    hint: "Remember that the time is for the complete journey there and back.",
  },
  {
    text: "A bat receives an echo from a flying insect 25 ms after making its call. How far away is the insect?",
    answer: 4.25,
    unit: "m",
    tolerance: 0.005,
    hint: "Convert the echo time into seconds before calculating.",
  },
  {
    text: "A person shouts towards a cliff. The echo is heard 0.8 seconds later. How far away is the cliff?",
    answer: 136,
    unit: "m",
    tolerance: 0.05,
    hint: "Use the total echo time in the equation.",
  },
  {
    text: "A hiker shouts towards a rock face. The echo returns after 1.2 seconds. How far away is the rock face?",
    answer: 204,
    unit: "m",
    tolerance: 0.05,
    hint: "The sound travels to the rock face and back.",
  },
  {
    text: "An ultrasonic sensor detects a box 1.7 m away. How long does the sound take to travel to the box and back?",
    answer: 10,
    unit: "ms",
    tolerance: 0.05,
    hint: "Find the total journey time, then convert seconds to milliseconds.",
  },
  {
    text: "A warehouse robot sends out an ultrasonic pulse. The echo returns after 15 ms. How far away is the wall?",
    answer: 2.55,
    unit: "m",
    tolerance: 0.005,
    hint: "Convert milliseconds to seconds before calculating the distance.",
  },
  {
    text: "A parking sensor detects a car 0.68 m away. How long does the sound take to travel to the car and back?",
    answer: 4,
    unit: "ms",
    tolerance: 0.05,
    hint: "Find the total journey time and give your answer in milliseconds.",
  },
];

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
      checked: QUESTIONS.map(() => false),
      correct: QUESTIONS.map(() => false),
      swapped: false,
      activeReward: null,
      seenRewards: [],
      drawings: QUESTIONS.map(() => []),
      answerInkStrokes: QUESTIONS.map(() => []),
      recognisedAnswers: QUESTIONS.map(() => ""),
      autoShowBatPictures: true,
    };
  }

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
  const [autoShowBatPictures, setAutoShowBatPictures] = useState(
    session.autoShowBatPictures
  );
  const [pictureRevealed, setPictureRevealed] = useState(
    session.autoShowBatPictures
  );

  const seenRewardsRef = useRef(new Set(session.seenRewards));
  const drawingsRef = useRef(session.drawings);
  const currentIndexRef = useRef(session.currentIndex);
  const drawingRef = useRef(false);
  const activeStrokeRef = useRef(null);

  const canvasRef = useRef(null);
  const layoutWrapRef = useRef(null);
  const questionSideRef = useRef(null);
  const workSideRef = useRef(null);
  const swapButtonRef = useRef(null);
  const answerInputRef = useRef(null);
  const answerInkSurfaceRef = useRef(null);
  const answerInkCanvasRef = useRef(null);
  const answerInkStrokesRef = useRef(session.answerInkStrokes);
  const answerInkActiveStrokeRef = useRef(null);
  const answerInkPointerIdRef = useRef(null);
  const answerInkTimerRef = useRef(null);
  const nativeHandwritingRecognizerRef = useRef(null);
  const answerRecognitionRequestRef = useRef(0);

  const currentQuestion = QUESTIONS[currentIndex];
  const score = useMemo(() => correct.filter(Boolean).length, [correct]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    session.currentIndex = currentIndex;
  }, [currentIndex, session]);

  useEffect(() => {
    session.answers = answers;
  }, [answers, session]);

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

      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(
          first.x * rect.width,
          first.y * rect.height,
          stroke.mode === "erase" ? 12 : 1.5,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(first.x * rect.width, first.y * rect.height);

        for (let i = 1; i < stroke.points.length; i += 1) {
          const point = stroke.points[i];
          ctx.lineTo(point.x * rect.width, point.y * rect.height);
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
  }, [swapped, currentIndex, activeReward, positionSwapButton, resizeCanvas]);

  useEffect(() => {
    const wrap = layoutWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      positionSwapButton();
      resizeCanvas();
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, [positionSwapButton, resizeCanvas]);

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
    redrawAnswerInk();
  }, [redrawAnswerInk, session]);

  useEffect(() => {
    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
    }
    answerInkActiveStrokeRef.current = null;
    answerInkPointerIdRef.current = null;
    setAnswerInkMessage("");
    setAnswerEntryMode("write");
    window.requestAnimationFrame(redrawAnswerInk);
  }, [currentIndex, redrawAnswerInk]);

  useEffect(() => {
    if (answerEntryMode !== "write") return undefined;

    const surface = answerInkSurfaceRef.current;
    if (!surface) return undefined;

    window.requestAnimationFrame(redrawAnswerInk);

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(redrawAnswerInk);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [answerEntryMode, redrawAnswerInk]);

  useEffect(() => {
    // Load the local digit model in the background so the first handwritten
    // answer can be recognised without a noticeable model-startup pause.
    void warmOnnxDigitRecognizer();
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
          text: `${question.hint} Change your answer and try again.`,
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

  const handleTypeAnswer = () => {
    if (answerInkTimerRef.current) {
      window.clearTimeout(answerInkTimerRef.current);
      answerInkTimerRef.current = null;
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
    const recognised = recognisedAnswers[currentIndex];
    if (recognised) setCurrentAnswerValue(recognised);
    setAnswerEntryMode("write");
    window.requestAnimationFrame(redrawAnswerInk);
  };

  const handleClearAnswer = () => {
    clearAnswerInk();
    setRecognisedAnswers((previous) => {
      const next = [...previous];
      next[currentIndex] = "";
      return next;
    });
    setCurrentAnswerValue("");
    setAnswerInkMessage("");
  };

  const handleCheckAnswer = async (event) => {
    event.preventDefault();

    let raw = answers[currentIndex].trim();

    // In handwriting mode, use the complete visible ink. Recognition never
    // erases or replaces the learner's writing; it only updates the reading
    // shown underneath the box.
    const currentInk = answerInkStrokesRef.current[currentIndex] || [];
    if (answerEntryMode === "write" && currentInk.length) {
      const recognisedNow = await recogniseAnswerInk();
      if (recognisedNow) raw = recognisedNow;
      else raw = recognisedAnswers[currentIndex].trim();
    }

    const normalized = raw.replace(/\s+/g, "").replace(",", ".");
    const value = Number(normalized);

    if (!raw || !Number.isFinite(value) || value < 0) {
      setFeedback({
        type: "wrong",
        text:
          answerEntryMode === "write"
            ? "I couldn't read a valid number yet. Try writing it again, or use Type answer."
            : "Enter a valid numerical answer first.",
      });
      return;
    }

    const isCorrect =
      Math.abs(value - currentQuestion.answer) <= currentQuestion.tolerance;

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
            text: `${currentQuestion.hint} Change your answer and try again.`,
          }
    );
  };

  const moveToQuestion = (index) => {
    setCurrentIndex(index);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) moveToQuestion(currentIndex - 1);
  };

  const handleNext = () => {
    if (!checked[currentIndex]) return;

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

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
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

  const recogniseWithDeviceHandwriting = async (strokes) => {
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
      const hints = {
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
        const candidate = normalizeRecognisedNumber(prediction?.text);
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
    let text = normalizeRecognisedNumber(onnxResult.text);
    let confident = Boolean(text && onnxResult.confident);

    if (!confident) {
      const deviceText = await recogniseWithDeviceHandwriting(strokes);
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
      setAnswerInkMessage(confident ? "" : "Check the recognised number before submitting.");
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

  const scheduleAnswerInkRecognition = () => {
    if (answerInkTimerRef.current) window.clearTimeout(answerInkTimerRef.current);
    answerInkTimerRef.current = window.setTimeout(() => {
      answerInkTimerRef.current = null;
      void recogniseAnswerInk();
    }, 700);
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
      clearAnswerInk();
      setRecognisedAnswers((previous) => {
        const next = [...previous];
        next[currentIndexRef.current] = "";
        return next;
      });
      setCurrentAnswerValue("");
      setAnswerInkMessage("Answer cleared");
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
    answerInkActiveStrokeRef.current.points.push(
      getAnswerInkPoint(event, answerInkActiveStrokeRef.current.startTime)
    );
    redrawAnswerInk();
  };

  const handleAnswerInkPointerEndCapture = (event) => {
    if (answerInkPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const surface = answerInkSurfaceRef.current;
    answerInkActiveStrokeRef.current = null;
    answerInkPointerIdRef.current = null;

    if (surface?.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }

    scheduleAnswerInkRecognition();
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
    activeStrokeRef.current.points.push(getCanvasPoint(event));
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

  const reward = activeReward === null ? null : rewardPlan[activeReward];
  const isFinalReward = reward?.afterQuestion === QUESTIONS.length;
  const currentAnswerInk = answerInkStrokesRef.current[currentIndex] || [];
  const currentRecognisedAnswer = recognisedAnswers[currentIndex] || "";

  return (
    <div className="batQuiz">
      {activeReward === null ? (
        <>
          <section className="batQuiz__top">
            <div className="batQuiz__topRow">
              <div className="batQuiz__formulaGroup">
                <div className="batQuiz__eyebrow">Echo calculations</div>
                <div className="batQuiz__formula">distance = ½ × speed × time</div>
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

                  <form className="batQuiz__answerPanel" onSubmit={handleCheckAnswer}>
                    <div className="batQuiz__answerLabel">Your answer</div>

                    <div className="batQuiz__answerRow">
                      {answerEntryMode === "write" ? (
                        <div
                          ref={answerInkSurfaceRef}
                          className={`batQuiz__writeAnswerBox ${
                            currentAnswerInk.length ? "is-inking" : ""
                          }`}
                          role="textbox"
                          aria-label={`Write your answer in ${currentQuestion.unit} with a stylus`}
                          onPointerDownCapture={handleAnswerInkPointerDownCapture}
                          onPointerMoveCapture={handleAnswerInkPointerMoveCapture}
                          onPointerUpCapture={handleAnswerInkPointerEndCapture}
                          onPointerCancelCapture={handleAnswerInkPointerEndCapture}
                        >
                          {!currentAnswerInk.length ? (
                            <div className="batQuiz__writePrompt">Write your answer</div>
                          ) : null}
                          <canvas
                            ref={answerInkCanvasRef}
                            className="batQuiz__answerInkCanvas"
                            aria-hidden="true"
                          />
                        </div>
                      ) : (
                        <input
                          ref={answerInputRef}
                          id="bat-quiz-answer"
                          className="batQuiz__answerInput"
                          type="text"
                          inputMode="none"
                          enterKeyHint="done"
                          autoComplete="off"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder="Type a number"
                          aria-label={`Type your answer in ${currentQuestion.unit}`}
                          value={answers[currentIndex]}
                          onChange={handleAnswerChange}
                        />
                      )}
                      <div className="batQuiz__unit">{currentQuestion.unit}</div>
                    </div>

                    {answerEntryMode === "write" ? (
                      <div className="batQuiz__recognitionReadout" aria-live="polite">
                        <span>Recognised:</span>
                        <strong>{currentRecognisedAnswer || "—"}</strong>
                        {currentRecognisedAnswer ? <span>{currentQuestion.unit}</span> : null}
                      </div>
                    ) : null}

                    {answerEntryMode === "type" ? (
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
                            disabled={!answers[currentIndex] && !currentAnswerInk.length}
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
                            onClick={() => handleKeypadPress("clear")}
                            disabled={!answers[currentIndex]}
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

                    <button className="batQuiz__button batQuiz__button--cyan batQuiz__check" type="submit">
                      Check answer
                    </button>
                  </form>
                </section>

                <section className="batQuiz__workPanel" ref={workSideRef}>
                  <div className="batQuiz__workpad">
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
                disabled={!checked[currentIndex]}
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
