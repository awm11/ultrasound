import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./BatEcholocationQuiz.css";

import bat1 from "../assets/bat_1.jpg";
import bat2 from "../assets/bat_2.jpg";
import bat3 from "../assets/bat_3.jpg";
import bat4 from "../assets/bat_4.jpg";
import bat5 from "../assets/bat_5.jpg";
import bat6 from "../assets/bat_6.jpg";
import bat7 from "../assets/bat_7.jpg";
import bat8 from "../assets/bat_8.jpg";
import bat9 from "../assets/bat_9.jpg";
import bat10 from "../assets/bat_10.jpg";

const BAT_IMAGES = [bat1, bat2, bat3, bat4, bat5, bat6, bat7, bat8, bat9, bat10];

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
  const pictures = shuffle(BAT_IMAGES).slice(0, 4);
  const facts = shuffle(BAT_FACTS).slice(0, 4);

  return [2, 4, 6, 8].map((afterQuestion, index) => ({
    afterQuestion,
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

export default function BatEcholocationQuiz({ onFinish }) {
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
    session.swapped = swapped;
  }, [swapped, session]);

  useEffect(() => {
    session.activeReward = activeReward;
  }, [activeReward, session]);

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

  const handleAnswerChange = (event) => {
    const value = event.target.value;

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
  };

  const handleCheckAnswer = (event) => {
    event.preventDefault();

    // Keep the field as a normal text box so Windows Ink in Edge can turn
    // stylus handwriting directly into text. A decimal comma is accepted too.
    const raw = answers[currentIndex].trim();
    const normalized = raw.replace(/\s+/g, "").replace(",", ".");
    const value = Number(normalized);

    if (!raw || !Number.isFinite(value) || value < 0) {
      setFeedback({ type: "wrong", text: "Enter a valid numerical answer first." });
      return;
    }

    const isCorrect = Math.abs(value - currentQuestion.answer) <= currentQuestion.tolerance;

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
    const checkpoint = completedQuestion % 2 === 0;

    if (checkpoint && !seenRewardsRef.current.has(completedQuestion)) {
      seenRewardsRef.current.add(completedQuestion);
      session.seenRewards = [...seenRewardsRef.current];
      setActiveReward(completedQuestion / 2 - 1);
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
                    <label className="batQuiz__answerLabel" htmlFor="bat-quiz-answer">
                      Write your answer
                    </label>

                    <div className="batQuiz__answerRow">
                      <input
                        id="bat-quiz-answer"
                        className="batQuiz__answerInput"
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="done"
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Write or type a number"
                        aria-label={`Write or type your answer in ${currentQuestion.unit}`}
                        value={answers[currentIndex]}
                        onChange={handleAnswerChange}
                      />
                      <div className="batQuiz__unit">{currentQuestion.unit}</div>
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
                  <div className="batQuiz__workTitle">Working out</div>
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
              <img className="batQuiz__rewardImage" src={reward.image} alt="Bat reward" />
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
