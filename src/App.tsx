import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Echo = { time: number; amp: number; width: number; label: string }
type Vec = { x: number; y: number; segments?: { start: number; end: number }[] }

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

export default function App() {
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

    if (showRuler) {

    const canvas = canvasRef.current
    if (canvas) {

        const rect = canvas.getBoundingClientRect()

        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

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
    }

    if (isNearProbe(event.clientX, event.clientY)) {
      draggingRef.current = 'probe'
      event.currentTarget.setPointerCapture(event.pointerId)
      moveProbeTo(event.clientX)
      return
    }

    if (isNearCrack(event.clientX, event.clientY)) {
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
    crackRef.current = { x: CRACK.x, y: CRACK.y }
    setTrace([])
    setEchoes([])
    setPlaying(false)
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
        const speedScale = (speedRef.current || 0.1) * 2
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
        steelGradient.addColorStop(0.75, '#c5c9cd')
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

    //   ctx.fillStyle = '#ddd'
    //   ctx.strokeStyle = '#333'
    //   ctx.lineWidth = 3
    //   ctx.fillRect(80, BLOCK_TOP, 520, BLOCK_BOTTOM - BLOCK_TOP)
    //   ctx.strokeRect(80, BLOCK_TOP, 520, BLOCK_BOTTOM - BLOCK_TOP)
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

// cable

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

//teacher mode

      if (teacherRef.current) {
        ctx.fillStyle = 'black'
        ctx.fillText('probe', probeX.current - 18, 58)
      }
      ctx.strokeStyle = 'black'
      ctx.lineWidth = 6
      ctx.beginPath()

// Crack
    if (showCrackRef.current){
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
  ctx.fillStyle = '#d8b06a'
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
    r.x - 10,
    scaleTop + scalePx + 25
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

    <div className="top-row">

      <div className="simulation">

        <canvas
          ref={canvasRef}
          width={700}
          height={550}
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

            <button className={`control-btn primary ${playing ? 'active' : ''}`} onClick={play}>
              ▶ Play
            </button>

            <button className={`control-btn secondary ${!playing ? 'active' : ''}`} onClick={pause}>
              ⏸ Pause
            </button>

            <button className="control-btn tertiary" onClick={fire}>
              🔊 Fire pulse
            </button>

            <button className="control-btn tertiary" onClick={reset}>
              ↺ Reset
            </button>

            <button
            className="control-btn tertiary"
            onClick={() => {
                rulerVisible.current = !rulerVisible.current
                setShowRuler(rulerVisible.current)
            }}
            >
            📏 Ruler
            </button>
            
            <button
            className="control-btn tertiary"
            onClick={randomiseCrack}
            >
            🎲 Random crack
            </button>

          </div>

        </div>

      </div>


      <div className="ascan-panel">

        <h2>A-scan</h2>

        <div className="ascan-container">

<svg
  width={850}
  height={500}
  style={{ background: '#111', cursor:'crosshair' }}
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


    <div className="info-panel">


      <h2>Ultrasound Non-destructive Testing</h2>
      <p>
        Use the ⬅️ and ➡️ arrow keys or click and drag the probe (transducer) to move it along the surface.<br />
        Use the <strong>SPACE BAR</strong> to fire a pulse.<br />
        Drag the crack to reposition it within the steel block.
      </p>

      

    </div>


        <div className="extra-controls">

        <div className="speed-control">

            <label>
            Animation speed: {speed.toFixed(1)}x
            </label>

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
            Teacher mode
            </label>

        </div>

        </div>


    <style>{`

      .app{
        width: 1650px;
        display:flex;
        flex-direction:column;
        align-items:center;
        gap:30px;
        font-family:Arial;
      }

      .top-row{
        margin-top:30px;
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

      .extra-controls{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:30px;
        align-items:center;
        margin-top:12px;
        }

      .speed-control{
        display:flex;
        flex-direction:column;
        gap:6px;
        }

      .checkbox-control{
        display:flex;
        flex-direction:column;
        gap:6px;
        align-items:flex-start;
        }

      .ascan-container{
        margin-top:10px;
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
        border:1px solid #999;
        display:block;
      }

    `}</style>

  </div>
)

}
