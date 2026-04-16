function SketchStroke({ d, className = "" }) {
  return (
    <>
      <path d={d} className={`pinky-sketch pinky-sketch-main ${className}`.trim()} />
      <path d={d} className={`pinky-sketch pinky-sketch-offset ${className}`.trim()} />
    </>
  );
}

export default function PinkyIllustration({ pose = "idle", blink = false, honking = false }) {
  const eyePath = blink ? "M96 34 Q100 36 104 34" : "M99 34 a2.2 2.6 0 1 0 0.01 0";

  return (
    <svg
      className={`pinky-illustration pinky-pose-${pose} ${blink ? "is-blinking" : ""} ${honking ? "is-honking" : ""}`}
      viewBox="0 0 150 150"
      aria-hidden="true"
      focusable="false"
    >
      <g className="pinky-shadow-layer">
        <ellipse cx="68" cy="126" rx="34" ry="8" className="pinky-shadow" />
      </g>

      <g className="pinky-body-group">
        <g className="pinky-neck-group">
          <path
            d="M74 78 C72 54 82 34 95 28 C103 25 110 30 109 38 C107 52 95 62 88 67"
            className="pinky-neck-fill"
          />
          <SketchStroke d="M74 78 C72 54 82 34 95 28 C103 25 110 30 109 38 C107 52 95 62 88 67" />
        </g>

        <g className="pinky-body-shell">
          <path
            d="M31 85 C26 65 36 48 54 45 C78 39 102 49 111 69 C119 87 108 108 84 112 C56 118 37 106 31 85 Z"
            className="pinky-fill"
          />
          <SketchStroke d="M31 85 C26 65 36 48 54 45 C78 39 102 49 111 69 C119 87 108 108 84 112 C56 118 37 106 31 85 Z" />
        </g>

        <g className="pinky-wing-group">
          <path
            d="M63 80 C54 71 57 57 71 55 C86 53 94 62 93 73 C92 82 81 90 69 88 C66 87 64 85 63 80 Z"
            className="pinky-wing-fill"
          />
          <SketchStroke d="M63 80 C54 71 57 57 71 55 C86 53 94 62 93 73 C92 82 81 90 69 88 C66 87 64 85 63 80 Z" />
          <path d="M66 77 C72 72 79 70 86 71" className="pinky-wing-line" />
        </g>

        <g className="pinky-head-group">
          <ellipse cx="103" cy="33" rx="15" ry="13" className="pinky-fill" />
          <ellipse cx="103" cy="33" rx="15" ry="13" className="pinky-sketch pinky-sketch-main" />
          <ellipse cx="104.4" cy="34.3" rx="15.2" ry="12.7" className="pinky-sketch pinky-sketch-offset" />
          <path d={eyePath} className={`pinky-eye ${blink ? "is-line" : "is-dot"}`} />
          <path d="M92 27 Q96 24 100 26" className="pinky-brow" />
          <path d="M110 22 Q112 17 117 18" className="pinky-tuft" />
        </g>

        <g className={`pinky-beak-group ${honking ? "is-open" : ""}`}>
          <path d="M114 36 L132 39 L114 45 Z" className="pinky-beak-top" />
          <path d="M113 42 L128 49 L112 50 Z" className="pinky-beak-bottom" />
          <path d="M114 39 L132 42" className="pinky-beak-line" />
        </g>

        <g className="pinky-leg-group pinky-leg-left">
          <path d="M54 108 C52 116 51 120 50 126" className="pinky-leg" />
          <path d="M48 126 L42 129 M49 126 L52 129 M49 126 L56 128" className="pinky-foot" />
        </g>

        <g className="pinky-leg-group pinky-leg-right">
          <path d="M72 110 C71 118 71 122 70 128" className="pinky-leg" />
          <path d="M68 128 L62 131 M69 128 L72 131 M69 128 L76 130" className="pinky-foot" />
        </g>
      </g>
    </svg>
  );
}
