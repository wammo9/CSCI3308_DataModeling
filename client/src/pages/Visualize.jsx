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
  const screeRef = useRef(null);
  const loadingsRef = useRef(null);

  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [plotReady, setPlotReady] = useState(false);
  const [clusterK, setClusterK] = useState(3);
  const [clusterData, setClusterData] = useState(null);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [loadingsComponent, setLoadingsComponent] = useState(0);

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

  // Render plots once run data is available
  useEffect(() => {
    if (!run || !plotRef.current) return;

    import("plotly.js-dist-min").then((Plotly) => {
      const points = run.transformedData;
      const is3D = run.nComponents >= 3;

      // ── Main scatter plot ──
      const markerColor = clusterData?.labels ?? points.map((_, i) => i);
      const markerScale = clusterData ? "Portland" : "Viridis";
      const clusterHover = clusterData ? "<br>Cluster: %{marker.color}" : "";
      const trace = is3D
        ? {
            type: "scatter3d",
            mode: "markers",
            x: points.map((p) => p[0]),
            y: points.map((p) => p[1]),
            z: points.map((p) => p[2]),
            marker: { size: 5, opacity: 0.8, color: markerColor, colorscale: markerScale },
            hovertemplate: `PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}${clusterHover}<extra></extra>`,
          }
        : {
            type: "scatter",
            mode: "markers",
            x: points.map((p) => p[0]),
            y: points.map((p) => p[1]),
            marker: { size: 8, opacity: 0.8, color: markerColor, colorscale: markerScale },
            hovertemplate: `PC1: %{x:.3f}<br>PC2: %{y:.3f}${clusterHover}<extra></extra>`,
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
      });

      // ── Feature 3: Scree plot ──
      const allEV = run.allExplainedVariance || run.explainedVarianceRatio;
      if (screeRef.current && allEV.length > 0) {
        const screeTrace = {
          type: "bar",
          x: allEV.map((_, i) => `PC${i + 1}`),
          y: allEV.map((v) => +(v * 100).toFixed(2)),
          marker: {
            color: allEV.map((_, i) =>
              i < run.nComponents ? "#122620" : "#c8d5c0"
            ),
          },
          hovertemplate: "%{x}: %{y:.1f}%<extra></extra>",
        };
        const cumulativeY = [];
        allEV.reduce((sum, v) => { sum += v; cumulativeY.push(+(sum * 100).toFixed(2)); return sum; }, 0);

        const cumTrace = {
          type: "scatter",
          mode: "lines+markers",
          x: allEV.map((_, i) => `PC${i + 1}`),
          y: cumulativeY,
          yaxis: "y2",
          marker: { color: "#b57a2e", size: 6 },
          line: { color: "#b57a2e", width: 2 },
          hovertemplate: "Cumulative: %{y:.1f}%<extra></extra>",
          name: "Cumulative",
        };

        Plotly.default.newPlot(screeRef.current, [screeTrace, cumTrace], {
          yaxis: { title: "Variance explained (%)", range: [0, Math.max(...allEV) * 120] },
          yaxis2: { title: "Cumulative (%)", overlaying: "y", side: "right", range: [0, 105] },
          margin: { l: 55, r: 55, t: 30, b: 40 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(255,255,255,0.6)",
          showlegend: false,
          bargap: 0.3,
        }, { responsive: true, displaylogo: false, displayModeBar: false });
      }

      if (loadingsRef.current && run.loadings?.length) {
        const selected = Math.min(loadingsComponent, run.loadings.length - 1);
        const values = run.loadings[selected] ?? [];
        Plotly.default.newPlot(loadingsRef.current, [{
          type: "bar",
          x: run.columnNames,
          y: values,
          marker: {
            color: values.map((value) => value >= 0 ? "#2d4a3e" : "#b57a2e"),
          },
          hovertemplate: "%{x}: %{y:.3f}<extra></extra>",
        }], {
          yaxis: { title: "Loading" },
          margin: { l: 55, r: 20, t: 25, b: 80 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(255,255,255,0.6)",
        }, { responsive: true, displaylogo: false, displayModeBar: false });
      }

      setPlotReady(true);
    });
  }, [run, clusterData, loadingsComponent]);

  async function handleRunClusters() {
    setClusterLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/pca/${runId}/clusters?k=${clusterK}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) setClusterData(data.clusters);
      else alert(data.message || "Could not cluster this PCA run.");
    } catch {
      alert("Could not reach the server.");
    } finally {
      setClusterLoading(false);
    }
  }

  function topContributors(componentIndex) {
    const loadings = run.loadings?.[componentIndex] ?? [];
    return loadings
      .map((value, index) => ({ name: run.columnNames[index], value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5);
  }

  // ── Feature 4: Export CSV ──
  async function handleExportCSV() {
    window.open(`${apiBase}/api/pca/${runId}/export?token=${getToken()}`, "_blank");
    // Also try with auth header as fallback
    try {
      const res = await fetch(`${apiBase}/api/pca/${runId}/export`, { headers: authHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${run.filename.replace(/\.csv$/i, "")}_pca.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* fallback failed, the window.open may have worked */ }
  }

  // ── Feature 4: Export PNG ──
  function handleExportPNG() {
    if (!plotRef.current) return;
    import("plotly.js-dist-min").then((Plotly) => {
      Plotly.default.downloadImage(plotRef.current, {
        format: "png",
        width: 1200,
        height: 800,
        filename: `${run.filename.replace(/\.csv$/i, "")}_pca`,
      });
    });
  }

  if (error) {
    return (
      <main className="app-shell centered">
        <div className="card">
          <div className="alert alert-error">{error}</div>
          <Link to="/projects" className="btn btn-ghost">Back to projects</Link>
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
          <Link to="/projects" className="back-link">Back to projects</Link>
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

        {/* Feature 4: Export buttons */}
        <div className="export-btns">
          <button className="btn btn-small btn-ghost" onClick={handleExportCSV}>
            Export CSV
          </button>
          <button className="btn btn-small btn-ghost" onClick={handleExportPNG}>
            Export PNG
          </button>
        </div>
      </section>

      {/* Main scatter plot */}
      <section className="card viz-plot-card">
        <h3>{run.nComponents === 3 ? "3D" : "2D"} PCA scatter plot</h3>
        <div ref={plotRef} className="plotly-container" />
        {!plotReady && <p className="muted">Rendering plot…</p>}
      </section>

      <section className="card viz-plot-card">
        <h3>K-means clusters</h3>
        <p className="muted">
          Group points using their PCA coordinates, then recolor the scatter plot by cluster.
        </p>
        <div className="analysis-controls">
          <label className="field compact-field">
            <span>Clusters</span>
            <select value={clusterK} onChange={(e) => setClusterK(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-small btn-primary" disabled={clusterLoading} onClick={handleRunClusters}>
            {clusterLoading ? "Clustering…" : "Run clustering"}
          </button>
          {clusterData && (
            <button className="btn btn-small btn-ghost" onClick={() => setClusterData(null)}>
              Clear clusters
            </button>
          )}
        </div>
        {clusterData && (
          <div className="cluster-summary">
            {clusterData.counts.map((count, index) => (
              <div key={index}>
                <span className="meta-label">Cluster {index}</span>
                <strong>{count} points</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Feature 3: Scree plot */}
      <section className="card viz-plot-card">
        <h3>Scree plot</h3>
        <p className="muted">
          Variance explained by each principal component.
          Dark bars are the selected components; light bars are the remaining.
        </p>
        <div ref={screeRef} className="plotly-container scree-container" />
      </section>

      {run.loadings?.length > 0 && (
        <section className="card viz-plot-card">
          <h3>PCA component loadings</h3>
          <p className="muted">
            Higher absolute values mean the original feature contributes more to that principal component.
          </p>
          <div className="analysis-controls">
            <label className="field compact-field">
              <span>Component</span>
              <select
                value={loadingsComponent}
                onChange={(e) => setLoadingsComponent(Number(e.target.value))}
              >
                {run.loadings.map((_, index) => (
                  <option key={index} value={index}>PC{index + 1}</option>
                ))}
              </select>
            </label>
          </div>
          <div ref={loadingsRef} className="plotly-container scree-container" />
          <div className="loadings-grid">
            {run.loadings.map((_, componentIndex) => (
              <div key={componentIndex} className="loading-card">
                <h3>PC{componentIndex + 1} top contributors</h3>
                {topContributors(componentIndex).map((item) => (
                  <p key={item.name}>
                    <strong>{item.name}</strong>: {item.value.toFixed(3)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
