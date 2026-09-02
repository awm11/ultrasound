import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Echo = { time: number; amp: number; width: number; label: string }
type Vec = { x: number; y: number; segments?: { start: number; end: number }[] }

function PageSwitcher({
  active,
  onIndustrialTesting,
  onBatEcholocation,
}: {
  active: 'industrial' | 'bat'
  onIndustrialTesting?: () => void
  onBatEcholocation?: () => void
}) {
  return (
    <nav className="page-switcher" aria-label="Simulation pages">
      <button
        type="button"
        className={active === 'bat' ? 'active' : ''}
        onClick={onBatEcholocation}
        disabled={active === 'bat'}
        aria-current={active === 'bat' ? 'page' : undefined}
      >
        Bat echolocation
      </button>
      <button
        type="button"
        className={active === 'industrial' ? 'active' : ''}
        onClick={onIndustrialTesting}
        disabled={active === 'industrial'}
        aria-current={active === 'industrial' ? 'page' : undefined}
      >
        Industrial testing
      </button>
    </nav>
  )
}

const SPEED = 280
const BLOCK_TOP = 100
const BLOCK_BOTTOM = 450
const CRACK = { x: 330, y: 260, length: 100, label: 'Internal crack' }
const TRACE_WIDTH = 360
const TRACE_SAMPLE_INTERVAL_MS = 10
const PROBE_HIT_RADIUS = 45
const CRACK_HIT_RADIUS = 35
const PULSE_HALF_WIDTH = 30

function getEchoAmplitude(overlapWidth: number) {
  const pulseWidth = 2 * PULSE_HALF_WIDTH
  const ratio = Math.max(0, Math.min(1, overlapWidth / pulseWidth))
  return 0.1 + 0.9 * ratio
}

function gaussian(t: number, centre: number, amp: number, width: number) {
  return amp * Math.exp(-((t - centre) ** 2) / (2 * width * width))
}

function getBeamSegments(x: number, halfWidth: number, crackLeft: number, crackRight: number) {
  const beamLeft = x - halfWidth
  const beamRight = x + halfWidth
  const overlapLeft = Math.max(beamLeft, crackLeft)
  const overlapRight = Math.min(beamRight, crackRight)
  const overlapWidth = Math.max(0, overlapRight - overlapLeft)

  if (overlapWidth <= 0) {
    return {
      overlapSegments: [] as { start: number; end: number }[],
      continueSegments: [{ start: beamLeft, end: beamRight }],
    }
  }

  const continueSegments: { start: number; end: number }[] = []
  if (overlapLeft > beamLeft) continueSegments.push({ start: beamLeft, end: overlapLeft })
  if (overlapRight < beamRight) continueSegments.push({ start: overlapRight, end: beamRight })

  return {
    overlapSegments: [{ start: overlapLeft, end: overlapRight }],
    continueSegments,
  }
}

function UltrasoundTestingScreen({ onNext }: { onNext: () => void }) {
  const frameRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const probeX = useRef(330)
  const pulse = useRef<Vec | null>(null)
  const returnPulse = useRef<Vec | null>(null)
  const throughPulse = useRef<Vec | null>(null)
  const throughReturnPulse = useRef<Vec | null>(null)
  const running = useRef(false)
  const sweepTime = useRef(0)
  const sweepActive = useRef(false)
  const nextTraceSampleTime = useRef(0)
  const echoQueue = useRef<Echo[]>([])
  const signal = useRef<number[]>([])
  const throughEchoQueued = useRef(false)
  const throughEchoTime = useRef<number | null>(null)
  const throughEchoAmp = useRef(0.55)
  const draggingRef = useRef<'probe' | 'crack' | null>(null)
  const crackRef = useRef({ x: CRACK.x, y: CRACK.y })
  const [showCrack, setShowCrack] = useState(true)
  const showCrackRef = useRef(true)
  const [playing, setPlaying] = useState(false)
  const [teacher, setTeacher] = useState(true)
  const teacherRef = useRef(true)
  const [speed, setSpeed] = useState(0.5)
  const modeLabel = playing ? 'Playing' : 'Paused'
  const speedRef = useRef(0.5)
  const [trace, setTrace] = useState<number[]>([])
  const [echoes, setEchoes] = useState<Echo[]>([])
  const [cursorX, setCursorX] = useState<number | null>(null)
  const [cursorTime, setCursorTime] = useState<number | null>(null)
  const rulerRef = useRef({x: 200, y: 150, length: 200})
  const rulerDragging = useRef(false)
  const rulerVisible = useRef(false)
  const [showRuler, setShowRuler] = useState(false)
  const rulerGrabOffset = useRef({ x: 0, y: 0 })
  const keyState = useRef({left: false, right: false,})
  const [challengeMode, setChallengeMode] = useState(false)
  const challengeRef = useRef(false)
  const [guessX, setGuessX] = useState<number | null>(null)
  const guessXRef = useRef<{ x: number; y: number } | null>(null)
  const [guessDistance, setGuessDistance] = useState<number | null>(null)
  const [guessFeedback, setGuessFeedback] = useState('')

  useEffect(() => {
    teacherRef.current = teacher
  }, [teacher])

  useEffect(() => {
  showCrackRef.current = showCrack
}, [showCrack])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
        if (e.code === 'Space') {
        e.preventDefault()
        fire()
        }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
        window.removeEventListener('keydown', handleKeyDown)
    }

    }, [])

  useEffect(() => {

    function down(e: KeyboardEvent) {
        switch (e.code) {
        case 'ArrowLeft':
            e.preventDefault()
            keyState.current.left = true
            break

        case 'ArrowRight':
            e.preventDefault()
            keyState.current.right = true
            break

        case 'Space':
            e.preventDefault()
            fire()
            break
        }
    }

    function up(e: KeyboardEvent) {
        switch (e.code) {
        case 'ArrowLeft':
            keyState.current.left = false
            break

        case 'ArrowRight':
            keyState.current.right = false
            break
        }
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    return () => {
        window.removeEventListener('keydown', down)
        window.removeEventListener('keyup', up)
    }

    }, [])


  function clampProbeX(x: number) {
    return Math.max(110, Math.min(570, x))
  }

  function clampCrackX(x: number) {
    return Math.max(
        80 + CRACK.length / 2,
        Math.min(600 - CRACK.length / 2, x)
    )
    }

  function clampCrackY(y: number) {
    return Math.max(BLOCK_TOP + 10, Math.min(BLOCK_BOTTOM - 10, y))
  }

  function moveProbeTo(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const nextX = clampProbeX(clientX - rect.left)
    probeX.current = nextX
  }

  function isNearProbe(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return false

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const probeLeft = probeX.current - 30
    const probeRight = probeX.current + 30
    const probeTop = 70
    const probeBottom = 100

    return x >= probeLeft - PROBE_HIT_RADIUS && x <= probeRight + PROBE_HIT_RADIUS && y >= probeTop - PROBE_HIT_RADIUS && y <= probeBottom + PROBE_HIT_RADIUS
  }

  function isNearCrack(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return false

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const crackLeft = crackRef.current.x - CRACK.length / 2
    const crackRight = crackRef.current.x + CRACK.length / 2
    const crackTop = crackRef.current.y - CRACK_HIT_RADIUS
    const crackBottom = crackRef.current.y + CRACK_HIT_RADIUS

    return x >= crackLeft - CRACK_HIT_RADIUS && x <= crackRight + CRACK_HIT_RADIUS && y >= crackTop && y <= crackBottom
  }

    function randomiseCrack() {
        const minX = 80 + CRACK.length / 2
        const maxX = 600 - CRACK.length / 2
        const safeGap = 80  // increase this to make the middle forbidden area wider
        const leftMax = (minX + maxX) / 2 - safeGap
        const rightMin = (minX + maxX) / 2 + safeGap
        const x =
            Math.random() < 0.5
            ? minX + Math.random() * (leftMax - minX)
            : rightMin + Math.random() * (maxX - rightMin)
        crackRef.current = {
            x,
            y: clampCrackY(
            BLOCK_TOP + 40 + Math.random() * 270
            ),
        }
    }

    function moveCrackTo(clientX: number, clientY: number) {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      crackRef.current = {
        x: clampCrackX(clientX - rect.left),
        y: clampCrackY(clientY - rect.top),
      }
    }

    function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
      event.preventDefault()

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()

      const x = (event.clientX - rect.left) * (canvas.width / rect.width)
      const y = (event.clientY - rect.top) * (canvas.height / rect.height)


      // Ruler (available in all modes)
      if (showRuler) {

        const r = rulerRef.current

        if (
          x >= r.x - 40 &&
          x <= r.x + 40 &&
          y >= r.y &&
          y <= r.y + 290 + r.length
        ) {
          rulerDragging.current = true

          rulerGrabOffset.current = {
            x: x - r.x,
            y: y - r.y
          }

          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
      }


      // Probe (available in all modes)
      if (isNearProbe(event.clientX, event.clientY)) {

        draggingRef.current = 'probe'

        event.currentTarget.setPointerCapture(event.pointerId)

        moveProbeTo(event.clientX)

        return
      }


      // Challenge guess
      if (challengeRef.current && !showCrackRef.current) {
        setGuessX(x)
        guessXRef.current = {x, y}

        return
      }


      // Crack dragging (demonstration mode only)
      if (isNearCrack(event.clientX, event.clientY) && !challengeRef.current) {

        draggingRef.current = 'crack'

        event.currentTarget.setPointerCapture(event.pointerId)

        moveCrackTo(event.clientX, event.clientY)

        return
      }


      draggingRef.current = null
    }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    
    if (rulerDragging.current) {

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()

    rulerRef.current.x =
    event.clientX - rect.left - rulerGrabOffset.current.x

    rulerRef.current.y =
    event.clientY - rect.top - rulerGrabOffset.current.y

    return
    }

    if (!draggingRef.current) return
    event.preventDefault()

    if (draggingRef.current === 'probe') {
      moveProbeTo(event.clientX)
    } else {
      moveCrackTo(event.clientX, event.clientY)
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    rulerDragging.current = false
    draggingRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function fire() {
    running.current = true
    setPlaying(true)
    sweepTime.current = -30
    sweepActive.current = true
    signal.current = []
    echoQueue.current = []
    throughEchoQueued.current = false
    throughEchoTime.current = null
    throughEchoAmp.current = 0.55
    throughPulse.current = null
    throughReturnPulse.current = null
    nextTraceSampleTime.current = 0
    const crackDistance = crackRef.current.y - BLOCK_TOP
    const crackLeft = crackRef.current.x - CRACK.length / 2
    const crackRight = crackRef.current.x + CRACK.length / 2
    const { overlapSegments, continueSegments } = getBeamSegments(probeX.current, PULSE_HALF_WIDTH, crackLeft, crackRight)
    if (overlapSegments.length > 0) {
      const overlapWidth = overlapSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
      echoQueue.current.push({ time: crackDistance * 2 / SPEED * 1000, amp: getEchoAmplitude(overlapWidth), width: 25, label: 'Crack echo' })
      if (continueSegments.length > 0) {
        const continueWidth = continueSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
        throughEchoTime.current = (BLOCK_BOTTOM - BLOCK_TOP) * 2 / SPEED * 1000
        throughEchoQueued.current = false
        throughEchoAmp.current = getEchoAmplitude(continueWidth)
      }
    } else {
      const wallDistance = BLOCK_BOTTOM - BLOCK_TOP
      echoQueue.current.push({ time: wallDistance * 2 / SPEED * 1000, amp: 1.0, width: 30, label: 'Back wall echo' })
    }
    pulse.current = {
      x: probeX.current,
      y: BLOCK_TOP,
      segments: [{ start: probeX.current - PULSE_HALF_WIDTH, end: probeX.current + PULSE_HALF_WIDTH }],
    }
  }
    function startChallenge() {
    challengeRef.current = true
    setGuessX(null)
    guessXRef.current = null
    randomiseCrack()
    setShowCrack(false)
    signal.current = []
    echoQueue.current = []
    setTrace([])
    setEchoes([])
    speedRef.current = 1.0
    setSpeed(1.0)
    }
 
    function revealAnswer() {
    // challengeRef.current = false
    if (guessXRef.current === null) return

    const dx = guessXRef.current.x - crackRef.current.x
    const dy = guessXRef.current.y - crackRef.current.y

    const distance = Math.sqrt(dx * dx + dy * dy)

    setGuessDistance(distance)

    if (distance < 15) {
      setGuessFeedback("✓ Good job! Closer than a bat's whisker.")
    } 
    else if (distance < 50) {
      setGuessFeedback("🔎 Not bad! We'll make an inspector of you yet.")
    } 
    else {
      setGuessFeedback("Hmmm...you might want to recheck your calculations?")
    }

    setShowCrack(true)
    }


  function play() {
    running.current = true
    setPlaying(true)
  }

  function pause() {
    running.current = false
    setPlaying(false)
  }

  function reset() {
    running.current = false
    pulse.current = null
    returnPulse.current = null
    throughPulse.current = null
    throughReturnPulse.current = null
    sweepActive.current = false
    sweepTime.current = 0
    signal.current = []
    echoQueue.current = []
    nextTraceSampleTime.current = 0
    probeX.current = 330
    randomiseCrack()
    setTrace([])
    setEchoes([])
    setPlaying(false)
    challengeRef.current = false
    // revealLineRef.current = null
    guessXRef.current = null
    showCrackRef.current = true
    setShowCrack(true)
    draggingRef.current = null
    rulerDragging.current = false
    speedRef.current = 0.5
    setSpeed(0.5)
    setGuessX(null)
    guessXRef.current = null
    setGuessDistance(null)
  }

  function drawBeamSegments(ctx: CanvasRenderingContext2D, beam: Vec | null, color: string) {
    if (!showCrackRef.current) return
    if (!beam?.segments) return

    ctx.strokeStyle = color
    ctx.lineWidth = 5
    beam.segments.forEach((segment) => {
      if (segment.end <= segment.start) return
      ctx.beginPath()
      ctx.moveTo(segment.start, beam.y)
      ctx.lineTo(segment.end, beam.y)
      ctx.stroke()
    })
  }

function handleTraceMove(e: React.MouseEvent<SVGSVGElement>) {
  const rect = e.currentTarget.getBoundingClientRect()

  const x = e.clientX - rect.left

  const plotLeft = 40
  const plotWidth = 770

  const clampedX = Math.max(plotLeft, Math.min(plotLeft + plotWidth, x))

  const time = ((clampedX - plotLeft) / plotWidth) * 120

  setCursorX(clampedX)
  setCursorTime(time)
}

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let last = 0

    function animate(now: number) {
      const dt = (now - last) / 1000
      last = now

    const probeSpeed = 240 // pixels per second

    if (keyState.current.left) {
    probeX.current = clampProbeX(
        probeX.current - probeSpeed * dt
    )
    }

    if (keyState.current.right) {
    probeX.current = clampProbeX(
        probeX.current + probeSpeed * dt
    )
    }

      if (running.current) {
        const speedScale = (speedRef.current || 0.1) * 4
        if (pulse.current) {
          pulse.current.y += SPEED * dt * speedScale
          const pulseLeft = pulse.current.x - PULSE_HALF_WIDTH
          const pulseRight = pulse.current.x + PULSE_HALF_WIDTH
          const crackLeft = crackRef.current.x - CRACK.length / 2
          const crackRight = crackRef.current.x + CRACK.length / 2
          const { overlapSegments, continueSegments } = getBeamSegments(pulse.current.x, PULSE_HALF_WIDTH, crackLeft, crackRight)

          if (pulse.current.y >= crackRef.current.y && overlapSegments.length > 0) {
            returnPulse.current = { x: pulse.current.x, y: crackRef.current.y, segments: overlapSegments }
            if (continueSegments.length > 0) {
              throughPulse.current = { x: pulse.current.x, y: crackRef.current.y, segments: continueSegments }
              throughEchoTime.current = (BLOCK_BOTTOM - BLOCK_TOP) * 2 / SPEED * 1000
            }
            pulse.current = null
          } else if (pulse.current.y >= BLOCK_BOTTOM) {
            returnPulse.current = { x: pulse.current.x, y: BLOCK_BOTTOM, segments: [{ start: pulseLeft, end: pulseRight }] }
            pulse.current = null
          }
        }

        if (returnPulse.current) {
          returnPulse.current.y -= SPEED * dt * speedScale
          if (returnPulse.current.y < BLOCK_TOP) returnPulse.current = null
        }

        if (throughPulse.current) {
          throughPulse.current.y += SPEED * dt * speedScale
          if (throughPulse.current.y >= BLOCK_BOTTOM) {
            throughReturnPulse.current = { x: throughPulse.current.x, y: BLOCK_BOTTOM, segments: throughPulse.current.segments }
            if (throughEchoTime.current !== null && !throughEchoQueued.current) {
              echoQueue.current.push({ time: throughEchoTime.current, amp: throughEchoAmp.current, width: 25, label: 'Back wall echo (through)' })
              throughEchoQueued.current = true
            }
            throughPulse.current = null
          }
        }

        if (throughReturnPulse.current) {
          throughReturnPulse.current.y -= SPEED * dt * speedScale
          if (throughReturnPulse.current.y < BLOCK_TOP) throughReturnPulse.current = null
        }

        if (sweepActive.current) {
          sweepTime.current += dt * 1000 * speedScale

          while (nextTraceSampleTime.current < sweepTime.current && signal.current.length < TRACE_WIDTH) {
            const sampleTime = nextTraceSampleTime.current
            let value = 0
            value += gaussian(sampleTime, 30, 1.3, 15)
            echoQueue.current.forEach((e) => {
              value += gaussian(sampleTime, e.time, e.amp, e.width)
            })
            signal.current.push(value)
            nextTraceSampleTime.current += TRACE_SAMPLE_INTERVAL_MS
          }

          if (signal.current.length >= TRACE_WIDTH) sweepActive.current = false
          setTrace([...signal.current])
          setEchoes(echoQueue.current.filter((e) => sweepTime.current >= e.time))
        }
      }

      ctx.clearRect(0, 0, 700, 550)
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, 700, 550)

        const steelGradient = ctx.createLinearGradient(
        0,
        BLOCK_TOP,
        0,
        BLOCK_BOTTOM
        )

        steelGradient.addColorStop(0, '#f4f4f4')
        steelGradient.addColorStop(0.25, '#d0d4d8')
        steelGradient.addColorStop(0.5, '#eef0f2')
        steelGradient.addColorStop(0.75, '#b4b7b8')
        steelGradient.addColorStop(1, '#e5e7e9')

        ctx.fillStyle = steelGradient
        ctx.strokeStyle = '#555'
        ctx.lineWidth = 3

        ctx.fillRect(
        80,
        BLOCK_TOP,
        520,
        BLOCK_BOTTOM - BLOCK_TOP
        )

        ctx.strokeRect(
        80,
        BLOCK_TOP,
        520,
        BLOCK_BOTTOM - BLOCK_TOP
        )

        if (teacherRef.current) {
            ctx.fillStyle = 'black'
            ctx.font = '16px Arial'
            ctx.fillText(
                'Steel block',
                95,
                BLOCK_TOP + 25
            )
            }

      ctx.font = '16px Arial'
      
    ctx.save()

    const px = probeX.current

    // probe shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.roundRect(px - 32, 73, 64, 30, 6)
    ctx.fill()


    // probe body gradient
    const probeGradient = ctx.createLinearGradient(
    0,
    70,
    0,
    100
    )

    probeGradient.addColorStop(0, '#4da3ff')
    probeGradient.addColorStop(0.5, '#1976d2')
    probeGradient.addColorStop(1, '#0d47a1')

    ctx.fillStyle = probeGradient
    ctx.strokeStyle = '#073b7a'
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.roundRect(px - 30, 70, 60, 30, 6)
    ctx.fill()
    ctx.stroke()


    // contact face
    ctx.fillStyle = '#222'
    ctx.beginPath()
    ctx.roundRect(px - 24, 94, 48, 6, 2)
    ctx.fill()


    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.roundRect(px - 20, 74, 40, 5, 2)
    ctx.fill()

    ctx.restore()


// cable
    ctx.save()

    ctx.strokeStyle = '#222'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'

    ctx.beginPath()

    ctx.moveTo(px, 70)

    ctx.bezierCurveTo(
    px + 25, 40,
    520, 120 + (px - 330) * 0.12,
    700, 140
    )

    ctx.stroke()


    // cable highlight
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 3

    ctx.beginPath()

    ctx.moveTo(px, 70)

    ctx.bezierCurveTo(
    px + 25, 40,
    520, 120 + (px - 330) * 0.12,
    700, 140
    )

    ctx.stroke()

    ctx.restore()

//probe teacher mode labels

      if (teacherRef.current) {
        ctx.fillStyle = 'black'
        ctx.fillText('probe', probeX.current - 18, 58)
        ctx.fillStyle = 'black'
        ctx.font = '15px Arial'
        ctx.fillText('to computer', 610, 165)
        ctx.fillText('→', 640, 180)

      }
      ctx.strokeStyle = 'black'
      ctx.lineWidth = 6
      ctx.beginPath()


// Crack
if (showCrackRef.current) {

  const left = crackRef.current.x - CRACK.length / 2
  const right = crackRef.current.x + CRACK.length / 2
  const y = crackRef.current.y

  ctx.strokeStyle = '#111'
  ctx.lineWidth = 4

  ctx.beginPath()
  ctx.moveTo(left, y)
  ctx.lineTo(left + 25, y - 1)
  ctx.lineTo(left + 50, y + 1)
  ctx.lineTo(left + 75, y - 1)
  ctx.lineTo(right, y)
  ctx.stroke()

  // left tip
  ctx.fillStyle = '#111'
  ctx.beginPath()
  ctx.moveTo(left - 4, y)
  ctx.lineTo(left + 2, y - 2)
  ctx.lineTo(left + 2, y + 2)
  ctx.closePath()
  ctx.fill()

  // right tip
  ctx.beginPath()
  ctx.moveTo(right + 4, y)
  ctx.lineTo(right - 2, y - 2)
  ctx.lineTo(right - 2, y + 2)
  ctx.closePath()
  ctx.fill()



}

// Student guess marker
if (guessXRef.current !== null && challengeRef.current) {
  
  const {x, y} = guessXRef.current

  ctx.strokeStyle = '#ed0707'
  ctx.lineWidth = 3

  ctx.beginPath()

  ctx.moveTo(x - 10, y - 10)
  ctx.lineTo(x + 10, y + 10)

  ctx.moveTo(x + 10, y - 10)
  ctx.lineTo(x - 10, y + 10)

  ctx.stroke()
}

//Ruler
if (rulerVisible.current) {

  const r = rulerRef.current
  const pxPerMm = (BLOCK_BOTTOM - BLOCK_TOP) / 250

  const scaleMm = 300
  const scalePx = scaleMm * pxPerMm

  const endExtension = 14
  const rulerLengthPx = scalePx + endExtension * 2

  const w = 55
  const depth = 3
  const left = r.x - w / 2

  const scaleTop = r.y + endExtension


  // shadow underneath
  ctx.save()
  ctx.globalAlpha = 0.25

  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.beginPath()
  ctx.roundRect(
    left + depth,
    r.y + depth,
    w,
    rulerLengthPx,
    4
  )
  ctx.fill()

  ctx.restore()


  // ruler body
  ctx.save()
  ctx.globalAlpha = 0.72

  // front face
  ctx.fillStyle = '#c7943a'
  ctx.strokeStyle = '#7a5528'
  ctx.lineWidth = 2

  ctx.beginPath()
  ctx.roundRect(
    left,
    r.y,
    w,
    rulerLengthPx,
    4
  )
  ctx.fill()
  ctx.stroke()

  // right-hand side
  ctx.fillStyle = '#a97838'
  ctx.beginPath()
  ctx.moveTo(left + w, r.y + 4)
  ctx.lineTo(left + w + depth, r.y + 10)
  ctx.lineTo(left + w + depth, r.y + rulerLengthPx - 10)
  ctx.lineTo(left + w, r.y + rulerLengthPx)
  ctx.closePath()
  ctx.fill()

  // top bevel
  ctx.fillStyle = '#e8c98d'
  ctx.beginPath()
  ctx.moveTo(left + 4, r.y)
  ctx.lineTo(left + w - 4, r.y)
  ctx.lineTo(left + w, r.y + 4)
  ctx.lineTo(left + 4, r.y + 4)
  ctx.closePath()
  ctx.fill()

  ctx.restore()


  // scale markings (5 divisions per cm)
  ctx.save()

  ctx.globalAlpha = 0.9
  ctx.strokeStyle = '#222'
  ctx.fillStyle = '#222'
  ctx.lineWidth = 1.2
  ctx.font = '15px Arial'

  for (let div = 0; div <= 150; div++) {

    const y = scaleTop + (div / 150) * scalePx

    const isCm = div % 5 === 0
    const cm = div / 5

    let tick = 10

    if (isCm) {
    // Longer marks every 5 cm
    tick = cm % 5 === 0 ? 28 : 22
    }

    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + tick, y)
    ctx.stroke()

    // labels every 5 cm
    if (isCm) {
      const cm = div / 5
      if (cm > -1 && cm < 31 && cm % 5 === 0) {
        ctx.fillText(
          `${cm}`,
          r.x + 6,
          y + 5
        )
      }
    }
  }

  ctx.font = '16px Arial'
  ctx.fillText(
    'cm',
    r.x + 2,
    scaleTop + scalePx - 400
  )

  ctx.restore()

}

    //   ctx.stroke()

      if (teacherRef.current && showCrackRef.current) {
        ctx.fillStyle = 'black'
        ctx.fillText(CRACK.label, crackRef.current.x - 35, crackRef.current.y - 15)
      }

      if (pulse.current) {
        drawBeamSegments(ctx, pulse.current, '#00a8ff')
        if (teacherRef.current && showCrackRef.current) {
          ctx.fillStyle = 'black'
          ctx.fillText('pulse', pulse.current.x + 10, pulse.current.y - 10)
        }
      }

      if (returnPulse.current) {
        drawBeamSegments(ctx, returnPulse.current, '#ff8c00')
        if (teacherRef.current && showCrackRef.current) {
          ctx.fillStyle = 'black'
          ctx.fillText('echo', returnPulse.current.x + 10, returnPulse.current.y - 10)
        }
      }

      if (throughPulse.current) {
        drawBeamSegments(ctx, throughPulse.current, '#00a8ff')
        if (teacherRef.current && showCrackRef.current) {
          ctx.fillStyle = 'black'
          ctx.fillText('pulse', throughPulse.current.x + 10, throughPulse.current.y - 10)
        }
      }

      if (throughReturnPulse.current) {
        drawBeamSegments(ctx, throughReturnPulse.current, '#ff8c00')
        if (teacherRef.current && showCrackRef.current) {
          ctx.fillStyle = 'black'
          ctx.fillText('echo', throughReturnPulse.current.x + 10, throughReturnPulse.current.y - 10)
        }
      }

      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
    if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
    }
    }
    }, [])

return (

  <div className="app">

    <div className="industrial-header-row">
      <div className={`challenge-banner ${challengeRef.current ? 'active' : ''}`}>
        <span className="banner-copy">
          {challengeRef.current
              ? '🎯 CHALLENGE MODE • Locate the hidden defect'
              : '🔎  EXPLORATION MODE'}
        </span>
      </div>
      <PageSwitcher active="industrial" onBatEcholocation={onNext} />
    </div>

    <div className="top-row">

      <div className="simulation">

        <canvas
          ref={canvasRef}
          width={700}
          height={500}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ cursor: 'grab', touchAction: 'none' }}
        />

        <div className="controls">
{/* 
          <div className={`mode-pill ${playing ? 'mode-pill-play' : 'mode-pill-pause'}`}>
            <span className="mode-dot" />
            <span>{modeLabel}</span>
          </div> */}

          <div className="button-row">
{/* 
            <button className={`control-btn primary ${playing ? 'active' : ''}`} onClick={play}>
              ▶ Play
            </button>

            <button className={`control-btn secondary ${!playing ? 'active' : ''}`} onClick={pause}>
              ⏸ Pause
            </button> */}

            <button
            className="control-btn tertiary"
            style={{
  background:'linear-gradient(135deg, #0284c7, #06b6d4)',
  color:'white',
  borderRadius:'8px',
  boxShadow:'0 4px 10px rgba(2,132,199,0.35)'

}}
            onClick={fire}
            >
            🔊 Fire pulse
            </button>

            <button
            className="control-btn tertiary"
            style={{
              background:'linear-gradient(135deg, #d7b436, #f6c453)',
              color:'dark gray',
              boxShadow:'0 4px 10px rgba(183,121,31,0.4)'
            }}
                onClick={() => {
                    rulerVisible.current = !rulerVisible.current
                    setShowRuler(rulerVisible.current)
                }}>
            📏 Ruler
            </button>

            <button className="control-btn tertiary"
            style={{
              background:'linear-gradient(135deg, #cfd8e4, #f9fafc)',
              color:'dark gray',
              boxShadow:'0 4px 10px rgba(71,85,105,0.35)'
              }}
              onClick={reset}>
              ↺ Reset
            </button>

        
            {!challengeRef.current ? (
            <button
            className="control-btn"
            style={{
                background:'linear-gradient(90deg,#f59e0b,#ef4444)',
                color:'white',
                // border:'1px solid white',
                borderRadius:'8px',
                // boxShadow:'0 0 12px rgba(239,68,68,.35)'
              }}
            onClick={startChallenge}>
                🎯 Challenge
            </button>
            
            ) : (
            <button 
            className="control-btn"
            style={{
              background:'linear-gradient(90deg,#16a34a,#0d9488)',
              color:'white',
              // border:'2px solid white',
              borderRadius:'8px',
              // boxShadow:'0 0 12px rgba(13,148,136,.35)'
            }}
            onClick={revealAnswer}>
                ✔ Reveal answer
            </button>
            )}

          </div>

        </div>

      </div>


      <div className="ascan-panel">
{/* 
        <h2>A-scan</h2> */}

        <div className="ascan-container">

<svg
  width={850}
  height={500}
  style={{background: '#111', cursor:'crosshair',border:'3px solid #333', borderRadius:'6px'}}
  onMouseMove={handleTraceMove}
  onMouseLeave={() => {
    setCursorX(null)
    setCursorTime(null)
  }}
>


  {/* vertical axis */}
  <line
    x1="40"
    y1="30"
    x2="40"
    y2="410"
    stroke="white"
    strokeWidth="2"
  />

  <text
    x="8"
    y="25"
    fill="white"
    fontSize="15"
  >
    Amplitude
  </text>


  {/* trace */}
  <polyline
    fill="none"
    stroke="cyan"
    strokeWidth="3"
    points={trace.map((v, i) => {
      const x = 40 + (i / (TRACE_WIDTH - 1)) * 770
      return `${x},${390 - v * 260}`
    }).join(' ')}
  />


  {/* horizontal axis */}
  <line
    x1="40"
    y1="400"
    x2="810"
    y2="400"
    stroke="white"
    strokeWidth="2"
  />


  {/* time axis */}
  {[0,20,40,60,80,100,120].map((t) => {

    const x = 40 + (t / 120) * 770

    return (
      <g key={t}>

        <line
          x1={x}
          y1="415"
          x2={x}
          y2="400"
          stroke="white"
          strokeWidth="2"
        />

        <text
          x={x - 10}
          y="440"
          fill="white"
          fontSize="22"
        >
          {t}
        </text>

      </g>
    )

  })}


  <text
    x="400"
    y="480"
    fill="white"
    fontSize="22"
    fontStyle="italic"

  >
    ( µs )
  </text>

{cursorX !== null && (
  <>
    <line
      x1={cursorX}
      y1="30"
      x2={cursorX}
      y2="400"
      stroke="white"
      strokeWidth="1"
      strokeDasharray="5 5"
    />

    <rect
      x={cursorX - 52}
      y="8"
      width="100"
      height="35"
      fill="black"
      stroke="white"
    />

    <text
      x={cursorX - 35}
      y="32"
      fill="white"
      fontSize="20"
    >
      {cursorTime?.toFixed(1)} µs
    </text>
  </>
)}

</svg>


        </div>

      </div>

    </div>

{guessDistance !== null && guessXRef.current && (
      <div className="feedback-panel">

        <div>
          <strong>Distance from defect centre:</strong> {(guessDistance/14).toFixed(1)} cm
        </div>

        <div>
          {guessFeedback}
        </div>

      </div>
    )}

    <div className={`info-panel ${challengeRef.current ? 'challenge-info' : ''}`}>

    

    {challengeRef.current ? (
      <>
        <h2>Hidden Defect Challenge</h2>
        <p>
          Use the probe to locate the hidden defect.<br />
          Click on the steel to mark the defect location, then click "Reveal answer" to see how close you were.<br />
          The speed of sound in steel is 5890 m/s.
        </p>
      </>
    ) : (
      <>
        <h2>Ultrasound Non-destructive Testing</h2>
        <p>
          Use the ⬅️ and ➡️ arrow keys or click and drag the probe (transducer) to move it along the surface.<br />
          Use the <strong>SPACE BAR</strong> to fire a pulse.<br />
          Drag the crack to reposition it within the steel block.<br />
          The speed of sound in steel is 5890 m/s.
        </p>
      </>
    )}


    {!challengeRef.current && (
        <div className="extra-controls">

        <div className="speed-control">

            <label>
            Animation speed: {speed.toFixed(1)}x
            </label>

            <div className="speed-slider-row">
              <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.1"
              value={speed}
              onChange={(e) => {
                  const value = Number(e.target.value)
                  speedRef.current = value
                  setSpeed(value)
              }}
              />

              <button
                type="button"
                className={`animation-toggle ${playing ? 'pause' : 'play'}`}
                onClick={playing ? pause : play}
                aria-label={playing ? 'Pause animation' : 'Play animation'}
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
            </div>

        </div>


        <div className="checkbox-control">

            <label>
            <input
                type="checkbox"
                checked={showCrack}
                onChange={(e) => setShowCrack(e.target.checked)}
            />
            Reveal defect
            </label>

            <label>
            <input
                type="checkbox"
                checked={teacher}
                onChange={(e) => setTeacher(e.target.checked)}
            />
            Show labels
            </label>

        </div>

        </div>)}


    <style>{`

        .challenge-banner{
          width:auto;
          margin-top:0;
          padding:12px;
          border-radius:8px;
          display:flex;
          align-items:center;
          gap:12px;
          font-size:20px;
          font-weight:600;
          letter-spacing:.5px;
          color: #f3f4f6;
          background: #555;
          border:1px solid #d1d5db;
          transition:all .3s ease;
        }

        .banner-copy{
          flex:1;
          text-align:center;
        }

        .industrial-header-row{
          width:1550px;
          margin-top:20px;
          display:grid;
          grid-template-columns:minmax(0, 1fr) 260px;
          align-items:stretch;
          gap:18px;
        }

        .challenge-banner.active{
          background:linear-gradient(90deg,#f59e0b,#ef4444);
          border-color:white;
          box-shadow:0 0 20px rgba(239,68,68,.45);
        }
          
      .app{
        width: 1650px;
        display:flex;
        flex-direction:column;
        align-items:center;
        gap:30px;
        font-family:Arial;
      }

      .top-row{
        margin-top:0px;
        display:grid;
        grid-template-columns:700px 700px;
        gap:30px;
        justify-content:center;
        align-items:start;
      }

      .simulation{
      transform: translateX(-70px);
      }

      .ascan-panel{
        display:flex;
        flex-direction:column;
        align-items:center;
      }

      .info-panel{
        margin-top:0px;
        width:1400px;
        text-align:center;
      }

      .challenge-info{
        background:linear-gradient(90deg,#f59e0b,#ef4444);
          color: white;
          padding: 10px;
          width: 850px;
          border: 1px solid white;
          border-radius: 10px;
          box-shadow:0 0 20px rgba(239,68,68,.45);
      }

      .feedback-panel{
        margin-top:0px;
        padding:5px 20px;
        border-radius:8px;
        background: #f8fafc;
        border:1px solid #cbd5e1;
        font-weight:600;
      }

      .extra-controls{
        display:grid;
        grid-template-columns:320px 200px;
        gap:30px;
        align-items:center;
        justify-content:center;
        justify-items:center;
        margin-top:12px;
        }

      .speed-control{
        width: 320px;
        display:flex;
        flex-direction:column;
        gap:6px;
        }

      .speed-slider-row{
        display:flex;
        align-items:center;
        gap:10px;
        }

      .speed-slider-row input{
        flex:1;
        min-width:0;
        }

      .animation-toggle{
        min-width:86px;
        padding:7px 10px;
        border:none;
        border-radius:8px;
        color:white;
        cursor:pointer;
        font-weight:600;
        transition:background .2s ease, transform .2s ease;
        }

      .animation-toggle:hover{
        transform:translateY(-1px);
        }

      .animation-toggle:focus{
        outline:none;
        box-shadow:none;
        }

      .animation-toggle.play{
        background:#16a34a;
        }

      .animation-toggle.pause{
        background:#f59e0b;
        }

      .checkbox-control{
        display:flex;
        flex-direction:column;
        gap:6px;
        align-items:flex-start;
        }

      .ascan-container{
      }

      .controls{
        display:flex;
        flex-direction:column;
        gap:10px;
        margin-top:12px;
      }

      .button-row{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        justify-content:center;

      }

      .control-btn{
        margin:0;
        padding:10px 12px;
        border:none;
        border-radius:8px;
        cursor:pointer;
        font-weight:600;
        transition:all .2s ease;
        min-width:96px;
      }

      .control-btn.active{
        box-shadow:0 0 0 2px rgba(0,0,0,.08),0 2px 8px rgba(0,0,0,.12);
      }

      .control-btn.primary{
        background:#16a34a;
        color:white;
      }

      .control-btn.secondary{
        background:#f59e0b;
        color:white;
      }

      .control-btn.tertiary{
        background:#e5e7eb;
        color:#111827;
      }

      .mode-pill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        align-self:flex-start;
        padding:8px 12px;
        border-radius:999px;
        font-weight:700;
      }

      .mode-pill-play{
        background:#dcfce7;
        color:#166534;
        border:1px solid #86efac;
      }

      .mode-pill-pause{
        background:#fee2e2;
        color:#991b1b;
        border:1px solid #fca5a5;
      }

      .mode-dot{
        width:10px;
        height:10px;
        border-radius:50%;
        background:currentColor;
        box-shadow:0 0 0 3px rgba(255,255,255,.35);
      }

      canvas{
        border:3px solid #777;
        border-radius:4px;
        box-shadow:0 2px 6px rgba(0,0,0,0.25);
        display:block;
      }

    `}</style>

  </div>
</div>
)}

const BAT_OUTPUT_WIDTH = 1104
const BAT_OUTPUT_HEIGHT = 650
const BAT_FIELD_WIDTH = 552
const BAT_FIELD_HEIGHT = 325
const BAT_FIELD_SCALE = BAT_OUTPUT_WIDTH / BAT_FIELD_WIDTH
const BAT_FIELD_PADDING = 112
const BAT_SIMULATION_WIDTH = BAT_FIELD_WIDTH + BAT_FIELD_PADDING * 2
const BAT_SIMULATION_HEIGHT = BAT_FIELD_HEIGHT + BAT_FIELD_PADDING * 2
const BAT_TRACE_CAPACITY = 540
const BAT_POST_ECHO_STEPS = 480
const BAT_WAVE_C2 = 0.39
const BAT_PULSE_OUTER_RADIUS = 91
const BAT_SOURCE_X = 210
const BAT_SOURCE_Y = 333
const BAT_CONE_CORE_HALF_ANGLE = Math.PI * 40 / 180
const BAT_CONE_HALF_ANGLE = Math.PI * 50 / 180
const BAT_MOTH_POSITION_HALF_ANGLE = Math.PI * 55 / 180
const BAT_GRAPH_LEFT = 314
const BAT_GRAPH_RIGHT = 894

function makeBrainTrace(samples: number[], baseline = 116, height = 32) {
  if (samples.length === 0) return `M ${BAT_GRAPH_LEFT},${baseline}`
  return samples.map((sample, index) => {
    const x = BAT_GRAPH_LEFT + (
      index / (BAT_TRACE_CAPACITY - 1)
    ) * (BAT_GRAPH_RIGHT - BAT_GRAPH_LEFT)
    const y = baseline - Math.tanh(sample * 5.5) * height
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

type BatBrainTrace = {
  primary: number[]
  secondary: number[]
}

type BatWaveFieldProps = {
  reflectorX: number
  reflectorY: number
  reflectorAngle: number
  playbackSpeed: number
  paused: boolean
  binaural: boolean
  enabled: boolean
  runId: number
  onTraceUpdate: (trace: BatBrainTrace) => void
  onPhaseChange: (phase: string) => void
}

function BatWaveField({
  reflectorX,
  reflectorY,
  reflectorAngle,
  playbackSpeed,
  paused,
  binaural,
  enabled,
  runId,
  onTraceUpdate,
  onPhaseChange,
}: BatWaveFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speedRef = useRef(playbackSpeed)
  const pausedRef = useRef(paused)

  useEffect(() => {
    speedRef.current = playbackSpeed
  }, [playbackSpeed])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, BAT_OUTPUT_WIDTH, BAT_OUTPUT_HEIGHT)
    if (!enabled) {
      onTraceUpdate({ primary: [], secondary: [] })
      return
    }

    const cellCount = BAT_SIMULATION_WIDTH * BAT_SIMULATION_HEIGHT
    let previous = new Float32Array(cellCount)
    let current = new Float32Array(cellCount)
    let next = new Float32Array(cellCount)
    const loss = new Float32Array(cellCount)
    const blocked = new Uint8Array(cellCount)
    const fieldCanvas = document.createElement('canvas')
    fieldCanvas.width = BAT_FIELD_WIDTH
    fieldCanvas.height = BAT_FIELD_HEIGHT
    const fieldContext = fieldCanvas.getContext('2d')
    if (!fieldContext) return
    const image = fieldContext.createImageData(BAT_FIELD_WIDTH, BAT_FIELD_HEIGHT)
    const displayedPressure = new Float32Array(BAT_FIELD_WIDTH * BAT_FIELD_HEIGHT)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const sourceX = Math.round(BAT_SOURCE_X / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const sourceY = Math.round(BAT_SOURCE_Y / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const centreReceiverX = sourceX + Math.round(11 / BAT_FIELD_SCALE)
    const earReceiverX = Math.round((BAT_SOURCE_X - 22) / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const upperEarReceiverY = Math.round((BAT_SOURCE_Y - 25) / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const lowerEarReceiverY = Math.round((BAT_SOURCE_Y + 25) / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const primaryReceiverX = binaural ? earReceiverX : centreReceiverX
    const primaryReceiverY = binaural ? upperEarReceiverY : sourceY
    const secondaryReceiverX = earReceiverX
    const secondaryReceiverY = lowerEarReceiverY
    const obstacleX = Math.round(reflectorX / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const obstacleY = Math.round(reflectorY / BAT_FIELD_SCALE) + BAT_FIELD_PADDING
    const obstacleHalfHeight = Math.round(34 / BAT_FIELD_SCALE)
    const pulseInnerRadius = Math.max(2, Math.round(5 / BAT_FIELD_SCALE))
    const pulseOuterRadius = Math.round(BAT_PULSE_OUTER_RADIUS / BAT_FIELD_SCALE)
    const pulseCycles = 4
    const emissionSteps = 45
    const waveSpeed = Math.sqrt(BAT_WAVE_C2)
    const sourceToReflector = Math.hypot(obstacleX - sourceX, obstacleY - sourceY)
    const reflectorToReceiver = Math.hypot(
      obstacleX - primaryReceiverX,
      obstacleY - (binaural ? sourceY : primaryReceiverY),
    )
    const firstHitStep = Math.max(0, Math.round((sourceToReflector - pulseOuterRadius) / waveSpeed))
    const echoStep = Math.round((sourceToReflector - pulseOuterRadius + reflectorToReceiver) / waveSpeed)
    const murCoefficient = (waveSpeed - 1) / (waveSpeed + 1)
    const graphEndStep = BAT_TRACE_CAPACITY * 2
    const stopStep = Math.max(echoStep + BAT_POST_ECHO_STEPS, graphEndStep)
    const primaryTraceSamples: number[] = []
    const secondaryTraceSamples: number[] = []
    let reportedTraceLength = -1
    let reportedPhase = ''
    let step = 0
    let frame = 0
    let animationFrame = 0
    let lastTime = performance.now()
    let accumulator = 0
    let displayInitialized = false
    const fixedStepMs = 1000 / 120

    for (let y = 0; y < BAT_SIMULATION_HEIGHT; y += 1) {
      for (let x = 0; x < BAT_SIMULATION_WIDTH; x += 1) {
        const index = y * BAT_SIMULATION_WIDTH + x
        const edgeDistance = Math.min(
          x,
          y,
          BAT_SIMULATION_WIDTH - 1 - x,
          BAT_SIMULATION_HEIGHT - 1 - y,
        )
        const absorbingLayerWidth = 90
        const boundaryDepth = Math.max(0, (absorbingLayerWidth - edgeDistance) / absorbingLayerWidth)
        loss[index] = 0.0006 + 0.42 * boundaryDepth ** 3
      }
    }

    function initialPulse(radius: number, angle: number) {
      if (radius < pulseInnerRadius || radius > pulseOuterRadius || Math.abs(angle) > BAT_CONE_HALF_ANGLE) {
        return 0
      }
      const radialPosition = (radius - pulseInnerRadius) / (pulseOuterRadius - pulseInnerRadius)
      const radialEnvelope = Math.sin(Math.PI * radialPosition) ** 4
      const absoluteAngle = Math.abs(angle)
      const angularTaper = absoluteAngle <= BAT_CONE_CORE_HALF_ANGLE
        ? 1
        : (BAT_CONE_HALF_ANGLE - absoluteAngle) / (
          BAT_CONE_HALF_ANGLE - BAT_CONE_CORE_HALF_ANGLE
        )
      const angularEnvelope = angularTaper * angularTaper * (3 - 2 * angularTaper)
      return Math.sin(radialPosition * Math.PI * 2 * pulseCycles) * radialEnvelope * angularEnvelope * 1.45
    }

    function directCallAtEar(currentStep: number) {
      if (currentStep >= emissionSteps) return 0
      const progress = currentStep / emissionSteps
      const envelope = Math.sin(Math.PI * progress) ** 2
      return Math.sin(progress * Math.PI * 2 * pulseCycles) * envelope * 0.72
    }

    for (let y = 0; y < BAT_SIMULATION_HEIGHT; y += 1) {
      for (let x = 0; x < BAT_SIMULATION_WIDTH; x += 1) {
        const dx = x - sourceX
        const dy = y - sourceY
        const radius = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)
        const index = y * BAT_SIMULATION_WIDTH + x
        current[index] = initialPulse(radius, angle)
        const previousRadius = radius + waveSpeed
        const radialCorrection = radius > pulseInnerRadius
          ? Math.sqrt(previousRadius / radius)
          : 1
        previous[index] = initialPulse(previousRadius, angle) * radialCorrection
      }
    }

    const normalX = Math.cos(reflectorAngle)
    const normalY = Math.sin(reflectorAngle)
    const tangentX = -normalY
    const tangentY = normalX
    for (let along = -obstacleHalfHeight; along <= obstacleHalfHeight; along += 1) {
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        const x = Math.round(obstacleX + tangentX * along + normalX * thickness)
        const y = Math.round(obstacleY + tangentY * along + normalY * thickness)
        if (x > 0 && x < BAT_SIMULATION_WIDTH - 1 && y > 0 && y < BAT_SIMULATION_HEIGHT - 1) {
          blocked[y * BAT_SIMULATION_WIDTH + x] = 1
        }
      }
    }

    function reportPhase(nextPhase: string) {
      if (nextPhase === reportedPhase) return
      reportedPhase = nextPhase
      onPhaseChange(nextPhase)
    }

    function simulateStep() {
      for (let y = 1; y < BAT_SIMULATION_HEIGHT - 1; y += 1) {
        const row = y * BAT_SIMULATION_WIDTH
        for (let x = 1; x < BAT_SIMULATION_WIDTH - 1; x += 1) {
          const index = row + x
          if (blocked[index]) {
            next[index] = 0
            continue
          }

          const centre = current[index]
          const left = blocked[index - 1] ? centre : current[index - 1]
          const right = blocked[index + 1] ? centre : current[index + 1]
          const above = blocked[index - BAT_SIMULATION_WIDTH] ? centre : current[index - BAT_SIMULATION_WIDTH]
          const below = blocked[index + BAT_SIMULATION_WIDTH] ? centre : current[index + BAT_SIMULATION_WIDTH]
          const aboveLeft = blocked[index - BAT_SIMULATION_WIDTH - 1]
            ? centre
            : current[index - BAT_SIMULATION_WIDTH - 1]
          const aboveRight = blocked[index - BAT_SIMULATION_WIDTH + 1]
            ? centre
            : current[index - BAT_SIMULATION_WIDTH + 1]
          const belowLeft = blocked[index + BAT_SIMULATION_WIDTH - 1]
            ? centre
            : current[index + BAT_SIMULATION_WIDTH - 1]
          const belowRight = blocked[index + BAT_SIMULATION_WIDTH + 1]
            ? centre
            : current[index + BAT_SIMULATION_WIDTH + 1]
          const laplacian = (
            4 * (left + right + above + below)
            + aboveLeft
            + aboveRight
            + belowLeft
            + belowRight
            - 20 * centre
          ) / 6
          const localLoss = loss[index]
          next[index] = (
            2 * centre
            - (1 - localLoss) * previous[index]
            + BAT_WAVE_C2 * laplacian
          ) / (1 + localLoss)
        }
      }

      for (let y = 1; y < BAT_SIMULATION_HEIGHT - 1; y += 1) {
        const leftEdge = y * BAT_SIMULATION_WIDTH
        const rightEdge = leftEdge + BAT_SIMULATION_WIDTH - 1
        next[leftEdge] = (
          current[leftEdge + 1]
          + murCoefficient * (next[leftEdge + 1] - current[leftEdge])
        ) / (1 + loss[leftEdge])
        next[rightEdge] = (
          current[rightEdge - 1]
          + murCoefficient * (next[rightEdge - 1] - current[rightEdge])
        ) / (1 + loss[rightEdge])
      }

      for (let x = 1; x < BAT_SIMULATION_WIDTH - 1; x += 1) {
        const topEdge = x
        const bottomEdge = (BAT_SIMULATION_HEIGHT - 1) * BAT_SIMULATION_WIDTH + x
        next[topEdge] = (
          current[topEdge + BAT_SIMULATION_WIDTH]
          + murCoefficient * (next[topEdge + BAT_SIMULATION_WIDTH] - current[topEdge])
        ) / (1 + loss[topEdge])
        next[bottomEdge] = (
          current[bottomEdge - BAT_SIMULATION_WIDTH]
          + murCoefficient * (next[bottomEdge - BAT_SIMULATION_WIDTH] - current[bottomEdge])
        ) / (1 + loss[bottomEdge])
      }

      next[0] = 0
      next[BAT_SIMULATION_WIDTH - 1] = 0
      next[(BAT_SIMULATION_HEIGHT - 1) * BAT_SIMULATION_WIDTH] = 0
      next[BAT_SIMULATION_HEIGHT * BAT_SIMULATION_WIDTH - 1] = 0

      const oldPrevious = previous
      previous = current
      current = next
      next = oldPrevious
      next.fill(0)

      if (step % 2 === 0 && primaryTraceSamples.length < BAT_TRACE_CAPACITY) {
        const directCall = binaural ? directCallAtEar(step) : 0
        primaryTraceSamples.push(
          current[primaryReceiverY * BAT_SIMULATION_WIDTH + primaryReceiverX] + directCall,
        )
        if (binaural) {
          secondaryTraceSamples.push(
            current[secondaryReceiverY * BAT_SIMULATION_WIDTH + secondaryReceiverX] + directCall,
          )
        }
      }

      if (step < emissionSteps) reportPhase('Emitting squeak')
      else if (step < firstHitStep) reportPhase('Wavefronts travelling')
      else if (step < firstHitStep + emissionSteps) reportPhase('Reflecting from insect')
      else if (step < echoStep) reportPhase('Echo returning')
      else reportPhase('Echo detected')

      step += 1
    }

    function renderField() {
      const pixels = image.data
      const temporalBlend = Math.max(
        0.42,
        Math.min(1, 0.82 / Math.sqrt(speedRef.current)),
      )
      for (let y = 0; y < BAT_FIELD_HEIGHT; y += 1) {
        const simulationRow = (y + BAT_FIELD_PADDING) * BAT_SIMULATION_WIDTH
        for (let x = 0; x < BAT_FIELD_WIDTH; x += 1) {
          const simulationIndex = simulationRow + x + BAT_FIELD_PADDING
          const fieldIndex = y * BAT_FIELD_WIDTH + x
          const targetPressure = current[simulationIndex]
          if (!displayInitialized) displayedPressure[fieldIndex] = targetPressure
          else {
            displayedPressure[fieldIndex] += (
              targetPressure - displayedPressure[fieldIndex]
            ) * temporalBlend
          }
          const value = displayedPressure[fieldIndex]
          const rawAmplitude = Math.abs(value)
          const noiseFloor = 0.004
          const fullyVisibleAmplitude = 0.018
          const gatePosition = Math.max(0, Math.min(
            1,
            (rawAmplitude - noiseFloor) / (fullyVisibleAmplitude - noiseFloor),
          ))
          const noiseGate = gatePosition * gatePosition * (3 - 2 * gatePosition)
          const visibleAmplitude = rawAmplitude * 8
          const strength = (
            Math.pow(Math.min(1, visibleAmplitude), 0.32)
            * noiseGate
          )
          const pixel = (y * BAT_FIELD_WIDTH + x) * 4

          if (strength <= 0 || blocked[simulationIndex]) {
            pixels[pixel] = 0
            pixels[pixel + 1] = 0
            pixels[pixel + 2] = 0
            pixels[pixel + 3] = 0
          } else if (value > 0) {
            pixels[pixel] = 105
            pixels[pixel + 1] = 239
            pixels[pixel + 2] = 250
            pixels[pixel + 3] = Math.round(strength * 248)
          } else {
            pixels[pixel] = 0
            pixels[pixel + 1] = 20
            pixels[pixel + 2] = 48
            pixels[pixel + 3] = Math.round(strength * 240)
          }
        }
      }
      fieldContext.putImageData(image, 0, 0)
      context.clearRect(0, 0, BAT_OUTPUT_WIDTH, BAT_OUTPUT_HEIGHT)
      context.drawImage(fieldCanvas, 0, 0, BAT_OUTPUT_WIDTH, BAT_OUTPUT_HEIGHT)
      displayInitialized = true
    }

    function animate(now: number) {
      if (!pausedRef.current) {
        accumulator += Math.min(50, now - lastTime) * speedRef.current
      }
      lastTime = now

      let substeps = 0
      while (accumulator >= fixedStepMs && substeps < 8 && step < stopStep) {
        simulateStep()
        accumulator -= fixedStepMs
        substeps += 1
      }

      if (!pausedRef.current || frame === 0) renderField()
      frame += 1
      if (frame % 3 === 0 && primaryTraceSamples.length !== reportedTraceLength) {
        reportedTraceLength = primaryTraceSamples.length
        onTraceUpdate({
          primary: [...primaryTraceSamples],
          secondary: [...secondaryTraceSamples],
        })
      }

      if (step < stopStep) animationFrame = requestAnimationFrame(animate)
      else {
        onTraceUpdate({
          primary: [...primaryTraceSamples],
          secondary: [...secondaryTraceSamples],
        })
      }
    }

    onTraceUpdate({ primary: [], secondary: [] })
    reportPhase('Emitting squeak')
    animationFrame = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(animationFrame)
  }, [binaural, enabled, onPhaseChange, onTraceUpdate, reflectorAngle, reflectorX, reflectorY, runId])

  return (
    <canvas
      ref={canvasRef}
      className="bat-wave-canvas"
      width={BAT_OUTPUT_WIDTH}
      height={BAT_OUTPUT_HEIGHT}
      aria-hidden="true"
    />
  )
}

function BatEcholocationScreen({ onBack }: { onBack: () => void }) {
  const sceneRef = useRef<SVGSVGElement>(null)
  const mothPositionRef = useRef({ x: 720, y: BAT_SOURCE_Y })
  const draggingMothRef = useRef(false)
  const [mothPosition, setMothPosition] = useState({ x: 720, y: BAT_SOURCE_Y })
  const [simulationMoth, setSimulationMoth] = useState({ x: 720, y: BAT_SOURCE_Y })
  const [draggingMoth, setDraggingMoth] = useState(false)
  const [soundSpeed, setSoundSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [binaural, setBinaural] = useState(false)
  const [squeakActive, setSqueakActive] = useState(true)
  const [runId, setRunId] = useState(0)
  const [phase, setPhase] = useState('Emitting squeak')
  const [brainTrace, setBrainTrace] = useState<BatBrainTrace>({ primary: [], secondary: [] })

  const insectX = mothPosition.x
  const insectY = mothPosition.y
  const batToMothAngle = Math.atan2(insectY - BAT_SOURCE_Y, insectX - BAT_SOURCE_X)
  const reflectorRotation = batToMothAngle * 180 / Math.PI
  const graphReceiverX = binaural ? BAT_SOURCE_X - 22 : BAT_SOURCE_X + 11
  const expectedEchoIndex = (
    Math.hypot(insectX - BAT_SOURCE_X, insectY - BAT_SOURCE_Y) / BAT_FIELD_SCALE
    + Math.hypot(insectX - graphReceiverX, insectY - BAT_SOURCE_Y) / BAT_FIELD_SCALE
    - BAT_PULSE_OUTER_RADIUS / BAT_FIELD_SCALE
  ) / Math.sqrt(BAT_WAVE_C2) / 2
  const expectedEchoX = BAT_GRAPH_LEFT + (
    Math.min(1, expectedEchoIndex / (BAT_TRACE_CAPACITY - 1))
    * (BAT_GRAPH_RIGHT - BAT_GRAPH_LEFT)
  )

  function sendSqueak() {
    setSimulationMoth(mothPositionRef.current)
    setPhase('Emitting squeak')
    setBrainTrace({ primary: [], secondary: [] })
    setPaused(false)
    setSqueakActive(true)
    setRunId((id) => id + 1)
  }

  function toggleBinauralHearing() {
    setBinaural((isBinaural) => !isBinaural)
    setBrainTrace({ primary: [], secondary: [] })
    setPhase('Ready')
    setPaused(false)
    setSqueakActive(false)
  }

  useEffect(() => {
    const heldKeys = {
      ArrowLeft: false,
      ArrowRight: false,
      ArrowUp: false,
      ArrowDown: false,
    }
    let velocityX = 0
    let velocityY = 0
    let wasMoving = false
    let animationFrame = 0
    let lastTime = performance.now()

    function releaseArrowKeys() {
      heldKeys.ArrowLeft = false
      heldKeys.ArrowRight = false
      heldKeys.ArrowUp = false
      heldKeys.ArrowDown = false
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('button, input, select, textarea, [contenteditable="true"]')) return

      if (event.code === 'Space') {
        if (event.repeat) return
        event.preventDefault()
        releaseArrowKeys()
        velocityX = 0
        velocityY = 0
        wasMoving = false
        sendSqueak()
        return
      }

      if (!(event.code in heldKeys)) return
      event.preventDefault()
      heldKeys[event.code as keyof typeof heldKeys] = true
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (!(event.code in heldKeys)) return
      event.preventDefault()
      heldKeys[event.code as keyof typeof heldKeys] = false
    }

    function animateMoth(now: number) {
      const deltaTime = Math.min(0.034, (now - lastTime) / 1000)
      lastTime = now

      if (draggingMothRef.current) {
        velocityX = 0
        velocityY = 0
        wasMoving = false
      } else {
        let inputX = Number(heldKeys.ArrowRight) - Number(heldKeys.ArrowLeft)
        let inputY = Number(heldKeys.ArrowDown) - Number(heldKeys.ArrowUp)
        const inputLength = Math.hypot(inputX, inputY)
        const hasInput = inputLength > 0
        if (hasInput) {
          inputX /= inputLength
          inputY /= inputLength
          const acceleration = 520
          velocityX += inputX * acceleration * deltaTime
          velocityY += inputY * acceleration * deltaTime
        }

        const drag = Math.exp(-(hasInput ? 1.8 : 4.2) * deltaTime)
        velocityX *= drag
        velocityY *= drag

        const speed = Math.hypot(velocityX, velocityY)
        const maximumSpeed = 190
        if (speed > maximumSpeed) {
          velocityX = velocityX / speed * maximumSpeed
          velocityY = velocityY / speed * maximumSpeed
        }

        const updatedSpeed = Math.hypot(velocityX, velocityY)
        if (updatedSpeed > 0.6) {
          if (!wasMoving) {
            wasMoving = true
            setBrainTrace({ primary: [], secondary: [] })
            setPhase('Ready')
            setPaused(false)
            setSqueakActive(false)
          }

          const flutterVelocity = Math.sin(now * 0.018) * Math.min(20, updatedSpeed * 0.12)
          const perpendicularX = -velocityY / updatedSpeed
          const perpendicularY = velocityX / updatedSpeed
          const currentPosition = mothPositionRef.current
          const proposedX = currentPosition.x + (
            velocityX + perpendicularX * flutterVelocity
          ) * deltaTime
          const proposedY = currentPosition.y + (
            velocityY + perpendicularY * flutterVelocity
          ) * deltaTime
          const nextPosition = clampMothToCone(proposedX, proposedY)

          if (Math.hypot(nextPosition.x - proposedX, nextPosition.y - proposedY) > 0.5) {
            velocityX *= 0.3
            velocityY *= 0.3
          }

          mothPositionRef.current = nextPosition
          setMothPosition(nextPosition)
        } else if (wasMoving) {
          velocityX = 0
          velocityY = 0
          wasMoving = false
          setSimulationMoth(mothPositionRef.current)
        }
      }

      animationFrame = requestAnimationFrame(animateMoth)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseArrowKeys)
    animationFrame = requestAnimationFrame(animateMoth)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseArrowKeys)
      cancelAnimationFrame(animationFrame)
    }
  }, [])

  function scenePoint(event: ReactPointerEvent<SVGSVGElement>) {
    const scene = sceneRef.current
    if (!scene) return null
    const rect = scene.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (BAT_OUTPUT_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (650 / rect.height),
    }
  }

  function clampMothToCone(x: number, y: number) {
    const dx = x - BAT_SOURCE_X
    const dy = y - BAT_SOURCE_Y
    const unclampedAngle = Math.atan2(dy, Math.max(1, dx))
    const angle = Math.max(
      -BAT_MOTH_POSITION_HALF_ANGLE,
      Math.min(BAT_MOTH_POSITION_HALF_ANGLE, unclampedAngle),
    )
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    let maximumRadius = Math.min(610, (BAT_OUTPUT_WIDTH - 85 - BAT_SOURCE_X) / cosine)
    if (sine < 0) maximumRadius = Math.min(maximumRadius, (BAT_SOURCE_Y - 205) / -sine)
    if (sine > 0) maximumRadius = Math.min(maximumRadius, (540 - BAT_SOURCE_Y) / sine)
    const radius = Math.min(maximumRadius, Math.max(130, Math.hypot(dx, dy)))
    return {
      x: BAT_SOURCE_X + Math.cos(angle) * radius,
      y: BAT_SOURCE_Y + Math.sin(angle) * radius,
    }
  }

  function handleMothPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const point = scenePoint(event)
    if (!point || Math.hypot(point.x - insectX, point.y - insectY) > 48) return
    event.preventDefault()
    draggingMothRef.current = true
    setDraggingMoth(true)
    setBrainTrace({ primary: [], secondary: [] })
    setPhase('Positioning insect')
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleMothPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingMothRef.current) return
    const point = scenePoint(event)
    if (!point) return
    event.preventDefault()
    const nextPosition = clampMothToCone(point.x, point.y)
    mothPositionRef.current = nextPosition
    setMothPosition(nextPosition)
  }

  function handleMothPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingMothRef.current) return
    draggingMothRef.current = false
    setDraggingMoth(false)
    setSimulationMoth(mothPositionRef.current)
    setPhase('Emitting squeak')
    setPaused(false)
    setSqueakActive(true)
    setRunId((id) => id + 1)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <main className="bat-echo-screen">
      <header className="bat-echo-header">
        <div className="bat-screen-number" aria-label="Screen 2">02</div>
        <div className="bat-echo-heading">
          <span>How ultrasound works in nature</span>
          <h1>A bat builds a picture from echoes</h1>
        </div>
        <PageSwitcher active="bat" onIndustrialTesting={onBack} />
      </header>

      <div className="bat-demo-layout">
        <section className="bat-scene-wrap" aria-label="Interactive bat echolocation demonstration">
        <svg
          ref={sceneRef}
          className={`bat-scene ${draggingMoth ? 'is-dragging-moth' : ''}`}
          viewBox={`0 0 ${BAT_OUTPUT_WIDTH} ${BAT_OUTPUT_HEIGHT}`}
          role="img"
          aria-labelledby="bat-scene-title bat-scene-description"
          onPointerDown={handleMothPointerDown}
          onPointerMove={handleMothPointerMove}
          onPointerUp={handleMothPointerUp}
          onPointerCancel={handleMothPointerUp}
        >
          <title id="bat-scene-title">A bat detecting a moth with ultrasound</title>
          <desc id="bat-scene-description">
            A time-stepped pressure field spreads from a bat, reflects from the surface of a moth, and returns to the bat. The pressure measured at the bat is plotted live in a thought bubble.
          </desc>

          <defs>
            <linearGradient id="bat-night-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#071426" />
              <stop offset="1" stopColor="#17375a" />
            </linearGradient>
            <linearGradient id="bat-brain-bubble" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#e7f1fc" />
            </linearGradient>
          </defs>

          <rect className="bat-night" x="0" y="0" width={BAT_OUTPUT_WIDTH} height={BAT_OUTPUT_HEIGHT} rx="18" />
          <circle className="bat-moon" cx="1010" cy="78" r="35" />
          <circle className="bat-moon-cutout" cx="1026" cy="64" r="35" />
          <g className="bat-stars" aria-hidden="true">
            <circle cx="58" cy="70" r="2" />
            <circle cx="124" cy="42" r="1.5" />
            <circle cx="704" cy="76" r="2" />
            <circle cx="782" cy="42" r="1.5" />
            <circle cx="912" cy="158" r="1.7" />
            <circle cx="612" cy="45" r="1.4" />
          </g>
          <path className="bat-cave-floor" d="M0,539 C105,494 190,521 276,555 C380,596 470,570 553,541 C653,507 741,521 835,564 C932,608 1019,581 1104,544 L1104,650 L0,650 Z" />

          <foreignObject className="bat-wave-foreign-object" x="0" y="0" width={BAT_OUTPUT_WIDTH} height={BAT_OUTPUT_HEIGHT}>
            <div className="bat-wave-layer">
              <BatWaveField
                reflectorX={simulationMoth.x}
                reflectorY={simulationMoth.y}
                reflectorAngle={Math.atan2(
                  simulationMoth.y - BAT_SOURCE_Y,
                  simulationMoth.x - BAT_SOURCE_X,
                )}
                playbackSpeed={soundSpeed}
                paused={paused}
                binaural={binaural}
                enabled={!draggingMoth && squeakActive}
                runId={runId}
                onTraceUpdate={setBrainTrace}
                onPhaseChange={setPhase}
              />
            </div>
          </foreignObject>

          <g className="bat-thought-bubble">
            <circle cx="198" cy="306" r="6" />
            <circle cx="213" cy="276" r="9" />
            <circle cx="234" cy="243" r="12" />
            <circle cx="263" cy="207" r="14" />
            <path d="M276,30 H892 C914,30 932,48 932,70 V145 C932,167 914,185 892,185 H316 C294,185 276,167 276,145 Z" />
          </g>

          <g
            className="bat-brain-graph"
            role="img"
            aria-label={binaural
              ? 'Separate pressure traces measured at the bat’s upper and lower ears'
              : 'The bat hears a loud squeak, followed later by a smaller echo'}
          >
            <text className="bat-brain-title" x="304" y="58">WHAT THE BAT'S BRAIN DETECTS</text>
            {binaural ? (
              <>
                <line className="bat-graph-axis" x1={BAT_GRAPH_LEFT} y1="99" x2={BAT_GRAPH_RIGHT} y2="99" />
                <line className="bat-graph-axis" x1={BAT_GRAPH_LEFT} y1="135" x2={BAT_GRAPH_RIGHT} y2="135" />
                <path
                  className="bat-live-trace bat-live-trace-primary"
                  d={makeBrainTrace(brainTrace.primary, 99, 15)}
                />
                <path
                  className="bat-live-trace bat-live-trace-secondary"
                  d={makeBrainTrace(brainTrace.secondary, 135, 15)}
                />
                <g className="bat-ear-trace-key">
                  <line className="bat-ear-key-primary" x1="708" y1="54" x2="724" y2="54" />
                  <text x="729" y="58">upper ear</text>
                  <line className="bat-ear-key-secondary" x1="794" y1="54" x2="810" y2="54" />
                  <text x="815" y="58">lower ear</text>
                </g>
              </>
            ) : (
              <>
                <line className="bat-graph-axis" x1={BAT_GRAPH_LEFT} y1="116" x2={BAT_GRAPH_RIGHT} y2="116" />
                <path
                  className="bat-live-trace bat-live-trace-primary"
                  d={makeBrainTrace(brainTrace.primary)}
                />
              </>
            )}
            <line className="bat-graph-axis" x1={BAT_GRAPH_LEFT} y1="75" x2={BAT_GRAPH_LEFT} y2="151" />
            <text className="bat-graph-axis-label" x={BAT_GRAPH_LEFT + 7} y="164">time →</text>

            <text className="bat-call-label" x={BAT_GRAPH_LEFT + 6} y="82">squeak</text>
            {phase === 'Echo detected' && (
              <>
                <line className="bat-echo-marker" x1={expectedEchoX} y1="76" x2={expectedEchoX} y2="151" />
                <text className="bat-echo-label" x={expectedEchoX - 14} y="82">echo</text>
              </>
            )}
          </g>

          <g
            className={`bat-animal ${binaural ? 'is-binaural' : ''}`}
            transform={`translate(${BAT_SOURCE_X} ${BAT_SOURCE_Y})`}
          >
            <path
              className="bat-wing bat-wing-upper"
              transform="translate(20 0)"
              d="M-43,-11 C-53,-24 -65,-43 -72,-60 C-67,-96 -58,-132 -48,-164 C-81,-162 -106,-148 -124,-126 Q-101,-108 -151,-83 Q-113,-65 -153,-44 Q-108,-34 -76,-17 Q-57,-7 -43,-11 Z"
            />
            <path
              className="bat-wing bat-wing-lower"
              transform="translate(20 0)"
              d="M-43,11 C-53,24 -65,43 -72,60 C-67,96 -58,132 -48,164 C-81,162 -106,148 -124,126 Q-101,108 -151,83 Q-113,65 -153,44 Q-108,34 -76,17 Q-57,7 -43,11 Z"
            />
            <path className="bat-tail" d="M-104,-9 L-145,0 L-104,9 Q-116,0 -104,-9 Z" />
            <ellipse className="bat-body" cx="-70" cy="0" rx="43" ry="24" />
            <ellipse className="bat-neck" cx="-39" cy="0" rx="25" ry="20" />
            <path className="bat-head" d="M-45,0 C-43,-18 -31,-25 -15,-22 C0,-19 9,-9 12,0 C9,9 0,19 -15,22 C-31,25 -43,18 -45,0 Z" />
            <path className="bat-ear" d="M-34,-15 L-22,-43 Q-8,-23 -15,-8 Z" />
            <path className="bat-ear" d="M-34,15 L-22,43 Q-8,23 -15,8 Z" />
            <path className="bat-ear-inner bat-ear-inner-primary" d="M-27,-17 L-22,-32" />
            <path className="bat-ear-inner bat-ear-inner-secondary" d="M-27,17 L-22,32" />
            {binaural && (
              <>
                <circle className="bat-ear-receiver bat-ear-receiver-primary" cx="-22" cy="-25" r="4" />
                <circle className="bat-ear-receiver bat-ear-receiver-secondary" cx="-22" cy="25" r="4" />
              </>
            )}
            <path className="bat-muzzle" d="M-11,-11 C1,-11 8,-6 11,0 C8,6 1,11 -11,11 C-6,6 -6,-6 -11,-11 Z" />
            <circle className="bat-eye" cx="-7" cy="-8" r="2.7" />
            <circle className="bat-eye" cx="-7" cy="8" r="2.7" />
            <path className="bat-nose" d="M7,-3.5 L13,0 L7,3.5 Z" />
            <path className="bat-mouth" d="M7,-4 Q10,0 7,4" />
          </g>
          <text className="bat-object-label" x={BAT_SOURCE_X - 110} y="423">BAT</text>

          <g className="bat-insect" transform={`translate(${insectX} ${insectY}) rotate(${reflectorRotation})`}>
            <circle className="bat-insect-hit-target" cx="0" cy="0" r="46" />
            <ellipse className="bat-insect-body" cx="0" cy="0" rx="9" ry="18" />
            <ellipse className="bat-insect-wing" cx="-13" cy="-7" rx="15" ry="9" transform="rotate(-24 -13 -7)" />
            <ellipse className="bat-insect-wing" cx="13" cy="-7" rx="15" ry="9" transform="rotate(24 13 -7)" />
            <path className="bat-antenna" d="M-3,-17 Q-11,-31 -19,-24 M3,-17 Q11,-31 19,-24" />
          </g>
          <text className="bat-object-label" x={insectX - 22} y={insectY + 57}>MOTH</text>

          <g className="bat-wave-legend" transform="translate(44 600)">
            <path className="bat-wave-key" d="M0,8 Q16,-8 32,8" />
            <text x="44" y="9">wavefronts</text>
          </g>
        </svg>
        </section>

        <section className="bat-controls" aria-label="Echolocation controls">
        <button className="bat-send-button" type="button" onClick={sendSqueak}>
          🔊 Send a squeak
        </button>
        <button
          className="bat-pause-button"
          type="button"
          onClick={() => setPaused((isPaused) => !isPaused)}
          disabled={draggingMoth || !squeakActive}
          aria-pressed={paused}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <label className="bat-speed-control">
          <span>animation speed</span>
          <input
            className="bat-speed-slider"
            type="range"
            min="0.45"
            max="4"
            step="0.05"
            value={soundSpeed}
                  onChange={(event) => {
                    setSoundSpeed(Number(event.target.value))
                    event.currentTarget.blur()
                  }}
                  onPointerUp={(event) => event.currentTarget.blur()}
          />
        </label>
        <label className="bat-binaural-control">
          <span>Binaural hearing</span>
          <input
            type="checkbox"
            checked={binaural}
                  onChange={(event) => {
                    toggleBinauralHearing()
                    event.currentTarget.blur()
                  }}
                  onPointerUp={(event) => event.currentTarget.blur()}
          />
          <span className="bat-toggle-track" aria-hidden="true" />
        </label>
        <p className="bat-keyboard-hint">Space: squeak · Arrow keys: move moth</p>
        <div className={`bat-phase bat-phase-${phase.toLowerCase().replaceAll(' ', '-')}`} aria-live="polite">
          <span className="bat-phase-dot" />
          {phase}
        </div>
        </section>
      </div>

      <p className="bat-explanation">
        The bat does not “see” a graph. Its brain measures the time between the squeak and its echo—the same basic idea used by an ultrasound detector.
      </p>

      <style>{`
        .bat-echo-screen{
          width:min(1550px, calc(100% - 32px));
          margin:0 auto;
          padding:24px 0 34px;
          color:#f4f7fb;
          font-family:Arial, sans-serif;
        }

        .bat-echo-header{
          display:grid;
          grid-template-columns:260px 1fr 260px;
          align-items:end;
          gap:20px;
          margin-bottom:18px;
        }

        .bat-echo-heading{ text-align:center; }

        .bat-echo-heading span{
          display:block;
          margin-bottom:4px;
          color:#9eacc1;
          font-size:12px;
          letter-spacing:.13em;
          text-transform:uppercase;
        }

        .bat-echo-heading h1{
          margin:0;
          color:#f4f7fb;
          font-size:clamp(26px, 4vw, 42px);
          line-height:1.12;
          font-weight:500;
          letter-spacing:-.03em;
        }

        .bat-screen-number{
          justify-self:start;
          color:#8290a6;
          font-size:24px;
          font-variant-numeric:tabular-nums;
        }

        .bat-demo-layout{
          display:grid;
          grid-template-columns:minmax(0, 1fr) 210px;
          align-items:stretch;
          gap:18px;
        }

        .bat-scene-wrap{
          border:3px solid #343d4d;
          border-radius:14px;
          overflow:hidden;
          box-shadow:0 8px 30px rgba(0,0,0,.28);
        }

        .bat-scene{ display:block; width:100%; height:auto; touch-action:none; }
        .bat-scene.is-dragging-moth{ cursor:grabbing; }
        .bat-night{ fill:url(#bat-night-sky); }
        .bat-moon{ fill:#f2da83; }
        .bat-moon-cutout{ fill:#071426; }
        .bat-stars{ fill:#ffffff; opacity:.65; }
        .bat-cave-floor{ fill:#081618; opacity:.94; }

        .bat-thought-bubble{ fill:url(#bat-brain-bubble); }
        .bat-brain-title{ fill:#142238; font-size:12px; font-weight:700; letter-spacing:.08em; }
        .bat-graph-axis{ stroke:#31405a; stroke-width:1.4; opacity:.62; }
        .bat-graph-axis-label,
        .bat-call-label,
        .bat-echo-label{ fill:#263650; font-size:12px; }

        .bat-live-trace{
          fill:none;
          stroke-width:2.6;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .bat-live-trace-primary,
        .bat-ear-key-primary{ stroke:#14b8dc; }
        .bat-live-trace-secondary,
        .bat-ear-key-secondary{ stroke:#ec4899; }

        .bat-ear-trace-key line{ stroke-width:3; stroke-linecap:round; }
        .bat-ear-trace-key text{ fill:#263650; font-size:10px; font-weight:700; }

        .bat-echo-marker{
          stroke:#f5a23e;
          stroke-width:1.5;
          stroke-dasharray:4 4;
        }

        .bat-wing,
        .bat-body,
        .bat-neck,
        .bat-head,
        .bat-ear,
        .bat-tail{ fill:#0d121b; }
        .bat-wing{
          fill:#111925;
          stroke:#536277;
          stroke-width:1.1;
          stroke-linejoin:round;
        }
        .bat-eye{ fill:#f4d65e; }
        .bat-muzzle{ fill:#263244; }
        .bat-nose{ fill:#94a3b8; }
        .bat-mouth,
        .bat-ear-inner{ fill:none; stroke:#7889a0; stroke-width:1.8; stroke-linecap:round; }
        .bat-animal.is-binaural .bat-ear-inner-primary{ stroke:#14b8dc; stroke-width:2.8; }
        .bat-animal.is-binaural .bat-ear-inner-secondary{ stroke:#ec4899; stroke-width:2.8; }
        .bat-ear-receiver-primary{ fill:#14b8dc; }
        .bat-ear-receiver-secondary{ fill:#ec4899; }
        .bat-ear-receiver{ stroke:#f8fafc; stroke-width:1; }
        .bat-wave-foreign-object{ pointer-events:none; }
        .bat-wave-layer{ width:${BAT_OUTPUT_WIDTH}px; height:${BAT_OUTPUT_HEIGHT}px; }
        .bat-wave-canvas{
          display:block;
          width:${BAT_OUTPUT_WIDTH}px;
          height:${BAT_OUTPUT_HEIGHT}px;
          background:transparent;
          image-rendering:auto;
        }

        .bat-wave-key{
          fill:none;
          stroke:#5be2f4;
          stroke-width:4;
          stroke-linecap:round;
        }

        .bat-insect-body{ fill:#f4d65e; }
        .bat-insect-wing{ fill:#f6fbff; opacity:.84; }
        .bat-antenna{ fill:none; stroke:#f6fbff; stroke-width:1.5; }
        .bat-insect{ cursor:grab; }
        .bat-insect-hit-target{ fill:transparent; pointer-events:all; }
        .bat-object-label{ fill:#f5f8fc; font-size:12px; font-weight:700; letter-spacing:.16em; }
        .bat-wave-legend text{ fill:#f5f8fc; font-size:12px; }
        .bat-wave-legend path{ stroke-width:3; }

        .bat-controls{
          display:flex;
          flex-direction:column;
          align-items:stretch;
          gap:16px;
          padding:20px 16px;
          border:1px solid #343d4d;
          border-radius:14px;
          background:#171e2a;
        }

        .bat-send-button{
          min-height:44px;
          border:0;
          border-radius:8px;
          padding:0 18px;
          background:linear-gradient(135deg,#0284c7,#06b6d4);
          color:white;
          font-size:16px;
          font-weight:700;
          cursor:pointer;
          box-shadow:0 4px 10px rgba(2,132,199,.35);
        }

        .bat-pause-button{
          min-height:44px;
          border:1px solid #526077;
          border-radius:8px;
          padding:0 16px;
          background:#202a39;
          color:#eff6ff;
          font-size:15px;
          font-weight:700;
          cursor:pointer;
        }

        .bat-pause-button:hover{ background:#2a374a; }
        .bat-pause-button:disabled{ cursor:default; opacity:.5; }

        .bat-speed-slider{
          width:100%;
          min-height:32px;
          margin:0;
          accent-color:#31c8ed;
          cursor:pointer;
        }

        .bat-speed-control{
          display:grid;
          grid-template-columns:1fr;
          align-items:center;
          gap:12px;
          color:#dbe4f1;
          font-size:13px;
          font-weight:700;
          white-space:nowrap;
        }

        .bat-binaural-control{
          position:relative;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          min-height:38px;
          color:#dbe4f1;
          font-size:13px;
          font-weight:700;
          cursor:pointer;
        }

        .bat-binaural-control input{
          position:absolute;
          width:1px;
          height:1px;
          opacity:0;
        }

        .bat-toggle-track{
          position:relative;
          flex:0 0 auto;
          width:42px;
          height:23px;
          border:1px solid #607087;
          border-radius:999px;
          background:#273244;
          transition:background .18s ease, border-color .18s ease;
        }

        .bat-toggle-track::after{
          content:'';
          position:absolute;
          top:3px;
          left:3px;
          width:15px;
          height:15px;
          border-radius:50%;
          background:#dbe4f1;
          transition:transform .18s ease;
        }

        .bat-binaural-control input:checked + .bat-toggle-track{
          border-color:#14b8dc;
          background:#087b9c;
        }

        .bat-binaural-control input:checked + .bat-toggle-track::after{
          transform:translateX(19px);
        }

        .bat-binaural-control:focus-within .bat-toggle-track{
          outline:2px solid #7dd3fc;
          outline-offset:2px;
        }

        .bat-keyboard-hint{
          color:#8fa0b8;
          font-size:12px;
          line-height:1.45;
        }

        .bat-phase{
          display:flex;
          align-items:center;
          justify-content:flex-start;
          gap:8px;
          color:#dbe4f1;
          font-size:14px;
          font-weight:600;
          margin-top:auto;
        }

        .bat-phase-dot{
          width:9px;
          height:9px;
          border-radius:50%;
          background:#31c8ed;
          box-shadow:0 0 10px rgba(49,200,237,.8);
        }

        .bat-phase-reflecting-from-insect .bat-phase-dot,
        .bat-phase-echo-returning .bat-phase-dot,
        .bat-phase-echo-detected .bat-phase-dot{
          background:#f5a23e;
          box-shadow:0 0 10px rgba(245,162,62,.8);
        }

        .bat-explanation{
          max-width:1100px;
          margin:10px auto 0;
          color:#aebbd0;
          text-align:center;
          font-size:15px;
        }

        @media (max-width:900px){
          .bat-echo-screen{ width:min(100% - 20px, 1550px); padding-top:12px; }
          .bat-echo-header{ grid-template-columns:auto minmax(0, 260px); align-items:start; }
          .bat-echo-header .page-switcher{ grid-column:2; grid-row:1; }
          .bat-echo-heading{ grid-column:1 / -1; grid-row:2; }
          .bat-screen-number{ grid-column:1; grid-row:1; }
          .bat-demo-layout{ grid-template-columns:1fr; }
          .bat-controls{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:12px;
            padding:14px;
          }
          .bat-speed-control,
          .bat-binaural-control,
          .bat-phase{ grid-column:1 / -1; }
          .bat-phase{ justify-content:center; margin-top:0; }
          .bat-send-button,
          .bat-pause-button{ width:100%; }
        }

      `}</style>
    </main>
  )
}

export default function App() {
  const [screen, setScreen] = useState<'testing' | 'bat'>('testing')

  return screen === 'testing'
    ? <UltrasoundTestingScreen onNext={() => setScreen('bat')} />
    : <BatEcholocationScreen onBack={() => setScreen('testing')} />
}
