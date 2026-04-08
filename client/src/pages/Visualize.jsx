import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getToken } from "../App";

const apiBase = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

function pct(ratio) {
  return (ratio * 100).toFixed(1) + "%";
}

export default function Visualize() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const plotRef = useRef(null);

  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [plotReady, setPlotReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${apiBase}/api/pca/${runId}`, { headers: authHeaders() });
        if (res.status === 401) { navigate("/login"); return; }
        if (!res.ok) { setError("Could not load PCA results."); return; }
        const data = await res.json();
        setRun(data);
      } catch {
        setError("Could not reach the server.");
      }
    }
    load();
  }, [runId, navigate]);

  // Render the plot once run data is available and the container is mounted
  useEffect(() => {
    if (!run || !plotRef.current) return;

    import("plotly.js-dist-min").then((Plotly) => {
      const points = run.transformedData;
      const is3D = run.nComponents >= 3;

      const trace = is3D
        ? {
            type: "scatter3d",
            mode: "markers",
            x: points.map((p) => p[0]),
            y: points.map((p) => p[1]),
            z: points.map((p) => p[2]),
            marker: { size: 5, opacity: 0.8, color: points.map((_, i) => i), colorscale: "Viridis" },
            hovertemplate:
              `PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>`,
          }
        : {
            type: "scatter",
            mode: "markers",
            x: points.map((p) => p[0]),
            y: points.map((p) => p[1]),
            marker: { size: 8, opacity: 0.8, color: points.map((_, i) => i), colorscale: "Viridis" },
            hovertemplate: `PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>`,
          };

      const evRatios = run.explainedVarianceRatio;

      const layout = is3D
        ? {
            scene: {
              xaxis: { title: `PC1 (${pct(evRatios[0])})` },
              yaxis: { title: `PC2 (${pct(evRatios[1])})` },
              zaxis: { title: `PC3 (${pct(evRatios[2])})` },
            },
            margin: { l: 0, r: 0, t: 40, b: 0 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
          }
        : {
            xaxis: { title: `PC1 (${pct(evRatios[0])})` },
            yaxis: { title: `PC2 (${pct(evRatios[1])})` },
            margin: { l: 60, r: 20, t: 40, b: 60 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(255,255,255,0.6)",
          };

      Plotly.default.newPlot(plotRef.current, [trace], layout, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["toImage"],
      });

      setPlotReady(true);
    });
  }, [run]);

  if (error) {
    return (
      <main className="app-shell centered">
        <div className="card">
          <div className="alert alert-error">{error}</div>
          <Link to="/projects" className="btn btn-ghost">← Back to projects</Link>
        </div>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="app-shell centered">
        <p className="muted">Loading visualization…</p>
      </main>
    );
  }

  const totalPct = run.explainedVarianceRatio.reduce((s, v) => s + v, 0);

  return (
    <main className="app-shell">
      <section className="card viz-header">
        <div>
          <Link to="/projects" className="back-link">← Back to projects</Link>
          <h2>{run.filename}</h2>
        </div>

        <div className="viz-meta">
          <div className="meta-item">
            <span className="meta-label">Samples</span>
            <strong>{run.nSamples}</strong>
          </div>
          <div className="meta-item">
            <span className="meta-label">Components</span>
            <strong>{run.nComponents}</strong>
          </div>
          <div className="meta-item">
            <span className="meta-label">Total variance explained</span>
            <strong>{pct(totalPct)}</strong>
          </div>
        </div>

        <div className="ev-bars">
          {run.explainedVarianceRatio.map((v, i) => (
            <div key={i} className="ev-row">
              <span className="ev-label">PC{i + 1}</span>
              <div className="ev-track">
                <div className="ev-fill" style={{ width: pct(v) }} />
              </div>
              <span className="ev-value">{pct(v)}</span>
            </div>
          ))}
        </div>

        <div className="feature-chips">
          <span className="meta-label">Input features:&nbsp;</span>
          {run.columnNames.map((c) => (
            <span key={c} className="tag">{c}</span>
          ))}
        </div>
      </section>

      <section className="card viz-plot-card">
        <h3>{run.nComponents === 3 ? "3D" : "2D"} PCA scatter plot</h3>
        <div ref={plotRef} className="plotly-container" />
        {!plotReady && <p className="muted">Rendering plot…</p>}
      </section>
    </main>
  );
}
