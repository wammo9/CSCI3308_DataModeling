import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import PinkyIllustration from "./PinkyIllustration";

const PINKY_STORAGE_KEY = "ms_pinky_enabled";
const PinkyContext = createContext(null);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotionQuery() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)");
}

function coarsePointerQuery() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)");
}

function usePersistentPinkyState() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(PINKY_STORAGE_KEY);
    if (stored == null) return true;
    return stored === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(PINKY_STORAGE_KEY, enabled ? "true" : "false");
  }, [enabled]);

  return [enabled, setEnabled];
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(() => Boolean(prefersReducedMotionQuery()?.matches));

  useEffect(() => {
    const media = prefersReducedMotionQuery();
    if (!media) return undefined;
    const handleChange = () => setReduced(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

function useCoarsePointerPreference() {
  const [coarsePointer, setCoarsePointer] = useState(() => Boolean(coarsePointerQuery()?.matches));

  useEffect(() => {
    const media = coarsePointerQuery();
    if (!media) return undefined;
    const handleChange = () => setCoarsePointer(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return coarsePointer;
}

function createHonkPlayer() {
  let audioContext = null;

  return function playHonk() {
    if (typeof window === "undefined" || !window.AudioContext) return;
    try {
      audioContext = audioContext || new window.AudioContext();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      const now = audioContext.currentTime;
      const master = audioContext.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      master.connect(audioContext.destination);

      const oscillatorA = audioContext.createOscillator();
      oscillatorA.type = "square";
      oscillatorA.frequency.setValueAtTime(320, now);
      oscillatorA.frequency.exponentialRampToValueAtTime(210, now + 0.1);
      oscillatorA.frequency.exponentialRampToValueAtTime(280, now + 0.22);

      const oscillatorB = audioContext.createOscillator();
      oscillatorB.type = "triangle";
      oscillatorB.frequency.setValueAtTime(470, now);
      oscillatorB.frequency.exponentialRampToValueAtTime(260, now + 0.22);

      const filter = audioContext.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.setValueAtTime(0.9, now);

      oscillatorA.connect(filter);
      oscillatorB.connect(filter);
      filter.connect(master);

      oscillatorA.start(now);
      oscillatorB.start(now);
      oscillatorA.stop(now + 0.24);
      oscillatorB.stop(now + 0.24);
    } catch {
      // Sound is decorative; ignore audio failures safely.
    }
  };
}

const playHonk = createHonkPlayer();

function PinkyOverlay({ enabled, reducedMotion }) {
  const shellRef = useRef(null);
  const innerRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [pose, setPose] = useState("idle");
  const [blink, setBlink] = useState(false);
  const [reaction, setReaction] = useState(false);
  const [honkText, setHonkText] = useState("");

  const viewportRef = useRef({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  });
  const motionRef = useRef({
    x: viewportRef.current.width - 220,
    y: viewportRef.current.height - 210,
    vx: 0,
    vy: 0,
    facing: 1,
    lean: 0,
    reactionUntil: 0,
    pose: "idle",
    jitterSeed: Math.random() * 1000,
  });
  const pointerRef = useRef({
    x: viewportRef.current.width - 120,
    y: viewportRef.current.height - 120,
    dx: 0,
    dy: 0,
    speed: 0,
    hasMoved: false,
  });
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastMoveTsRef = useRef(0);
  const lastHonkTsRef = useRef(0);
  const reactionTimerRef = useRef(null);
  const blinkTimerRef = useRef(null);
  const blinkCloseTimerRef = useRef(null);
  const honkTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    function handleResize() {
      viewportRef.current = { width: window.innerWidth, height: window.innerHeight };
      motionRef.current.x = clamp(motionRef.current.x, 24, viewportRef.current.width - 148);
      motionRef.current.y = clamp(motionRef.current.y, 48, viewportRef.current.height - 164);
    }

    function handlePointerMove(event) {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const now = performance.now();
      const dt = Math.max(16, now - lastMoveTsRef.current || 16);
      const dx = event.clientX - pointerRef.current.x;
      const dy = event.clientY - pointerRef.current.y;
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        dx,
        dy,
        speed: Math.hypot(dx, dy) / (dt / 16.67),
        hasMoved: true,
      };
      lastMoveTsRef.current = now;
    }

    function frame(now) {
      const state = motionRef.current;
      const pointer = pointerRef.current;
      const dt = Math.min(2, (now - (lastFrameRef.current || now)) / 16.67 || 1);
      lastFrameRef.current = now;

      const viewport = viewportRef.current;
      const size = { width: 126, height: 132 };
      const safePadding = reducedMotion ? 28 : 20;
      const travelYOffset = reducedMotion ? 28 : 38;
      const direction = pointer.dx < -0.4 ? -1 : pointer.dx > 0.4 ? 1 : state.facing;
      const idleTargetX = viewport.width - size.width - 32;
      const idleTargetY = viewport.height - size.height - 48;
      const chaseOffsetX = direction >= 0 ? -92 : 92;
      const targetX = pointer.hasMoved
        ? pointer.x + chaseOffsetX + Math.sin(now * 0.01 + state.jitterSeed) * (reducedMotion ? 3 : Math.min(pointer.speed, 12))
        : idleTargetX;
      const targetY = pointer.hasMoved
        ? pointer.y + travelYOffset + Math.cos(now * 0.008 + state.jitterSeed) * (reducedMotion ? 2 : 8)
        : idleTargetY;

      const clampedTargetX = clamp(targetX, safePadding, viewport.width - size.width - safePadding);
      const clampedTargetY = clamp(targetY, 42, viewport.height - size.height - 22);
      const spring = reducedMotion ? 0.045 : pointer.speed > 16 ? 0.1 : 0.072;
      const damping = reducedMotion ? 0.78 : pointer.speed > 16 ? 0.87 : 0.9;

      state.vx = (state.vx + (clampedTargetX - state.x) * spring * dt) * damping;
      state.vy = (state.vy + (clampedTargetY - state.y) * spring * dt) * damping;

      if (state.reactionUntil > now) {
        state.vx += Math.sin(now * 0.06 + state.jitterSeed) * (reducedMotion ? 0.2 : 0.7);
        state.vy -= reducedMotion ? 0.08 : 0.25;
      }

      state.x = clamp(state.x + state.vx * dt, safePadding, viewport.width - size.width - safePadding);
      state.y = clamp(state.y + state.vy * dt, 42, viewport.height - size.height - 22);
      state.lean = clamp(state.vx * (reducedMotion ? 0.05 : 0.1), -16, 16);
      state.facing = Math.abs(state.vx) > 0.35 ? (state.vx < 0 ? -1 : 1) : state.facing;

      const speed = Math.hypot(state.vx, state.vy);
      const nextPose = state.reactionUntil > now
        ? "honk"
        : speed > (reducedMotion ? 4.8 : 8.4)
          ? "dash"
          : speed > (reducedMotion ? 2.1 : 3.6)
            ? "chase"
            : "idle";

      if (nextPose !== state.pose) {
        state.pose = nextPose;
        setPose(nextPose);
      }

      if (shellRef.current) {
        shellRef.current.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.lean}deg)`;
      }
      if (innerRef.current) {
        innerRef.current.style.setProperty("--pinky-flip", String(state.facing));
        innerRef.current.style.setProperty("--pinky-speed", speed.toFixed(3));
      }

      rafRef.current = window.requestAnimationFrame(frame);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    rafRef.current = window.requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, reducedMotion]);

  useEffect(() => {
    if (!enabled) return undefined;

    function scheduleBlink() {
      const wait = 1800 + Math.random() * 2800;
      blinkTimerRef.current = window.setTimeout(() => {
        setBlink(true);
        window.clearTimeout(blinkCloseTimerRef.current);
        blinkCloseTimerRef.current = window.setTimeout(() => setBlink(false), 130);
        scheduleBlink();
      }, wait);
    }

    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimerRef.current);
      window.clearTimeout(blinkCloseTimerRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      window.clearTimeout(reactionTimerRef.current);
      window.clearTimeout(blinkCloseTimerRef.current);
      window.clearTimeout(honkTimerRef.current);
    };
  }, []);

  if (!enabled) return null;

  function triggerReaction() {
    const now = performance.now();
    motionRef.current.reactionUntil = now + (reducedMotion ? 260 : 420);
    motionRef.current.vx += motionRef.current.facing * -3.5 + (Math.random() - 0.5) * 2;
    motionRef.current.vy -= reducedMotion ? 1.6 : 3.4;
    setReaction(true);
    window.clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = window.setTimeout(() => setReaction(false), reducedMotion ? 220 : 360);

    const honkSamples = ["HONK!", "SKREE!", "HNK!", "NYAONK!"];
    setHonkText(honkSamples[Math.floor(Math.random() * honkSamples.length)]);
    window.clearTimeout(honkTimerRef.current);
    honkTimerRef.current = window.setTimeout(() => setHonkText(""), 620);

    if (now - lastHonkTsRef.current > 420) {
      lastHonkTsRef.current = now;
      playHonk();
    }
  }

  function handlePointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    triggerReaction();
  }

  return (
    <div className="pinky-layer" aria-hidden="true">
      <div
        ref={shellRef}
        className={`pinky-shell pose-${pose} ${hovered ? "is-hovered" : ""} ${reaction ? "is-reacting" : ""} ${reducedMotion ? "is-reduced" : ""}`}
      >
        <button
          type="button"
          className="pinky-hitbox"
          onPointerDown={handlePointerDown}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          tabIndex={-1}
          title="Pinky the goose. Click for a honk."
        >
          <div ref={innerRef} className="pinky-inner">
            <div className={`pinky-bubble ${honkText ? "is-visible" : ""}`}>{honkText}</div>
            <div className="pinky-figure-wrap">
              <PinkyIllustration pose={pose} blink={blink} honking={reaction} />
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

export function PinkyProvider({ children }) {
  const [enabled, setEnabled] = usePersistentPinkyState();
  const reducedMotion = useReducedMotionPreference();
  const coarsePointer = useCoarsePointerPreference();

  const value = useMemo(() => ({
    enabled,
    setEnabled,
    toggleEnabled() {
      setEnabled((current) => !current);
    },
    reducedMotion,
    coarsePointer,
    overlayEnabled: enabled && !coarsePointer,
  }), [coarsePointer, enabled, reducedMotion]);

  return (
    <PinkyContext.Provider value={value}>
      {children}
      <PinkyOverlay enabled={enabled && !coarsePointer} reducedMotion={reducedMotion} />
    </PinkyContext.Provider>
  );
}

export function usePinky() {
  const context = useContext(PinkyContext);
  if (!context) {
    throw new Error("usePinky must be used within a PinkyProvider.");
  }
  return context;
}
