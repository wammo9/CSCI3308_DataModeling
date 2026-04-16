import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getToken } from "../App";
import { useToast } from "../components/AppFeedback";

const apiBase = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

function pct(ratio) {
  return (ratio * 100).toFixed(1) + "%";
}

function matchesSearch(metadata, searchTerm, index) {
  const normalized = searchTerm.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [
    `row ${index + 1}`,
    ...Object.values(metadata?.labels ?? {}),
    ...Object.values(metadata?.values ?? {}),
    ...Object.values(metadata?.numeric ?? {}).filter((value) => value !== null && value !== undefined),
  ]
    .map((value) => String(value).toLowerCase())
    .join(" ");

  return haystack.includes(normalized);
}

function filterRunItems(run, clusterData, filters) {
  return (run?.transformedData ?? [])
    .map((coords, index) => ({
      index,
      coords,
      metadata: run?.rowMetadata?.[index] ?? null,
      cluster: clusterData?.labels?.[index],
    }))
    .filter(({ index, metadata, cluster }) => {
      if (!matchesSearch(metadata, filters.searchTerm ?? "", index)) return false;

      if (filters.labelFilterColumn && filters.labelFilterValue !== "all") {
        const label = metadata?.labels?.[filters.labelFilterColumn] || "Unlabeled";
        if (label !== filters.labelFilterValue) return false;
      }

      if (filters.clusterFilter !== "all" && String(cluster) !== String(filters.clusterFilter)) {
        return false;
      }

      if (filters.numericFilterColumn) {
        const numericValue = metadata?.numeric?.[filters.numericFilterColumn];
        if (filters.numericFilterMin !== "" && (!Number.isFinite(Number(numericValue)) || Number(numericValue) < Number(filters.numericFilterMin))) {
          return false;
        }
        if (filters.numericFilterMax !== "" && (!Number.isFinite(Number(numericValue)) || Number(numericValue) > Number(filters.numericFilterMax))) {
          return false;
        }
      }

      return true;
    });
}

export default function Visualize() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const plotRef = useRef(null);
  const screeRef = useRef(null);
  const loadingsRef = useRef(null);
  const toast = useToast();

  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [plotReady, setPlotReady] = useState(false);
  const [clusterK, setClusterK] = useState(3);
  const [clusterData, setClusterData] = useState(null);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [loadingsComponent, setLoadingsComponent] = useState(0);
  const [colorBy, setColorBy] = useState("row");
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [labelFilterColumn, setLabelFilterColumn] = useState("");
  const [labelFilterValue, setLabelFilterValue] = useState("all");
  const [numericFilterColumn, setNumericFilterColumn] = useState("");
  const [numericFilterMin, setNumericFilterMin] = useState("");
  const [numericFilterMax, setNumericFilterMax] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");

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

  useEffect(() => {
    setSearchTerm("");
    setLabelFilterColumn("");
    setLabelFilterValue("all");
    setNumericFilterColumn("");
    setNumericFilterMin("");
    setNumericFilterMax("");
    setClusterFilter("all");
    setSelectedPoint(null);
  }, [runId]);

  useEffect(() => {
    setLabelFilterValue("all");
  }, [labelFilterColumn]);

  // Render plots once run data is available
  useEffect(() => {
    if (!run || !plotRef.current) return;

    import("plotly.js-dist-min").then((Plotly) => {
      const filteredItems = filterRunItems(run, clusterData, {
        searchTerm,
        labelFilterColumn,
        labelFilterValue,
        numericFilterColumn,
        numericFilterMin,
        numericFilterMax,
        clusterFilter,
      });
      const filteredItemMap = new Map(filteredItems.map((item) => [item.index, item]));
      const points = filteredItems.map((item) => item.coords);
      const is3D = run.nComponents >= 3;

      function makeTrace(groupPoints, name, pointIndexes, marker = {}) {
        const hoverLabel = name ? `<br>${colorBy.replace(/^label:/, "")}: ${name}` : "";
        return is3D
          ? {
            type: "scatter3d",
            mode: "markers",
            name,
            x: groupPoints.map((p) => p[0]),
            y: groupPoints.map((p) => p[1]),
            z: groupPoints.map((p) => p[2]),
            customdata: pointIndexes,
            marker: { size: 5, opacity: 0.8, ...marker },
            hovertemplate: `PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}${hoverLabel}<extra></extra>`,
          }
          : {
            type: "scatter",
            mode: "markers",
            name,
            x: groupPoints.map((p) => p[0]),
            y: groupPoints.map((p) => p[1]),
            customdata: pointIndexes,
            marker: { size: 8, opacity: 0.8, ...marker },
            hovertemplate: `PC1: %{x:.3f}<br>PC2: %{y:.3f}${hoverLabel}<extra></extra>`,
          };
      }

      // ── Main scatter plot ──
      const pointIndexes = filteredItems.map((item) => item.index);
      const labelColumn = colorBy.startsWith("label:") ? colorBy.slice(6) : "";
      const traces = labelColumn
        ? [...new Set(filteredItems.map((item) => item.metadata?.labels?.[labelColumn] || "Unlabeled"))]
            .map((label) => {
              const grouped = filteredItems
                .filter((item) => (item.metadata?.labels?.[labelColumn] || "Unlabeled") === label);
              return makeTrace(
                grouped.map((item) => item.coords),
                label,
                grouped.map((item) => item.index),
              );
            })
        : [makeTrace(points, "", pointIndexes, {
            color: colorBy === "cluster" && clusterData
              ? filteredItems.map((item) => clusterData.labels?.[item.index] ?? 0)
              : pointIndexes,
            colorscale: colorBy === "cluster" && clusterData ? "Portland" : "Viridis",
          })];

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

      if (plotRef.current?.removeAllListeners) {
        plotRef.current.removeAllListeners("plotly_click");
      }

      if (points.length === 0) {
        Plotly.default.newPlot(plotRef.current, [], {
          ...layout,
          annotations: [{
            text: "No points match the current filters.",
            x: 0.5,
            y: 0.5,
            xref: "paper",
            yref: "paper",
            showarrow: false,
            font: { size: 16, color: "#6b705c" },
          }],
        }, {
          responsive: true,
          displaylogo: false,
        });
        setPlotReady(true);
        return;
      }

      Plotly.default.newPlot(plotRef.current, traces, layout, {
        responsive: true,
        displaylogo: false,
      }).then(() => {
        if (plotRef.current?.on) {
          plotRef.current.on("plotly_click", (event) => {
            const index = event.points?.[0]?.customdata;
            if (index !== undefined) {
              const item = filteredItemMap.get(index);
              setSelectedPoint({
                index,
                coords: item?.coords ?? [],
                metadata: item?.metadata ?? run.rowMetadata?.[index] ?? null,
                cluster: item?.cluster ?? clusterData?.labels?.[index],
              });
            }
          });
        }
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
  }, [
    run,
    clusterData,
    loadingsComponent,
    colorBy,
    searchTerm,
    labelFilterColumn,
    labelFilterValue,
    numericFilterColumn,
    numericFilterMin,
    numericFilterMax,
    clusterFilter,
  ]);

  useEffect(() => {
    if (!run || !selectedPoint) return;
    const stillVisible = filterRunItems(run, clusterData, {
      searchTerm,
      labelFilterColumn,
      labelFilterValue,
      numericFilterColumn,
      numericFilterMin,
      numericFilterMax,
      clusterFilter,
    }).some((item) => item.index === selectedPoint.index);

    if (!stillVisible) setSelectedPoint(null);
  }, [
    run,
    clusterData,
    selectedPoint,
    searchTerm,
    labelFilterColumn,
    labelFilterValue,
    numericFilterColumn,
    numericFilterMin,
    numericFilterMax,
    clusterFilter,
  ]);

  async function handleRunClusters() {
    setClusterLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/pca/${runId}/clusters?k=${clusterK}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setClusterData(data.clusters);
        setColorBy("cluster");
      }
      else toast.error(data.message || "Could not cluster this PCA run.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setClusterLoading(false);
    }
  }

  async function handleExportReport() {
    try {
      const res = await fetch(`${apiBase}/api/pca/${runId}/report`, { headers: authHeaders() });
      if (!res.ok) {
        toast.error("Could not create report.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${run.filename.replace(/\.csv$/i, "")}_pca_report.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not reach the server.");
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
  const filteredItems = filterRunItems(run, clusterData, {
    searchTerm,
    labelFilterColumn,
    labelFilterValue,
    numericFilterColumn,
    numericFilterMin,
    numericFilterMax,
    clusterFilter,
  });
  const labelFilterValues = labelFilterColumn
    ? [...new Set((run.rowMetadata ?? []).map((row) => row?.labels?.[labelFilterColumn] || "Unlabeled"))]
    : [];
  const originalNumericColumns = run.rowMetadata?.[0]?.numeric ? Object.keys(run.rowMetadata[0].numeric) : [];
  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    labelFilterColumn ||
    numericFilterColumn ||
    numericFilterMin !== "" ||
    numericFilterMax !== "" ||
    clusterFilter !== "all"
  );
  const pcaInsights = [
    `The selected components explain ${pct(totalPct)} of the numeric variation in this run.`,
    run.explainedVarianceRatio[0] >= 0.5
      ? `PC1 carries most of the structure by itself at ${pct(run.explainedVarianceRatio[0])}.`
      : `The structure is spread across multiple components; PC1 explains ${pct(run.explainedVarianceRatio[0])}.`,
  ];
  if (run.loadings?.[0]?.length) {
    const top = topContributors(0)[0];
    if (top) pcaInsights.push(`${top.name} is the strongest contributor to PC1 in this run.`);
  }

  return (
    <main className="app-shell workspace-shell">
      <section className="card viz-header">
        <div>
          <Link to="/projects" className="back-link">Back to projects</Link>
          <h2>{run.filename}</h2>
          <div className="tag-list">
            {run.isPinned && <span className="tag">Pinned run</span>}
            {run.notes && <span className="tag">Has notes</span>}
          </div>
          {run.notes && <p className="muted">{run.notes}</p>}
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

        {run.preprocessingReport && (
          <div className={`validation-card ${run.preprocessingReport.valid ? "valid" : "invalid"}`}>
            <strong>
              {run.preprocessingReport.valid ? "Valid after preprocessing" : "Invalid preprocessing result"}
            </strong>
            <p>{run.preprocessingReport.message}</p>
            {run.preprocessingReport.rows && (
              <p className="muted">
                Rows used: {run.preprocessingReport.rows.used} of {run.preprocessingReport.rows.input}
                {" "}· Invalid rows removed: {run.preprocessingReport.rows.droppedInvalid}
                {" "}· Values imputed: {run.preprocessingReport.rows.imputedValues}
                {" "}· Outliers removed: {run.preprocessingReport.rows.droppedOutliers}
              </p>
            )}
            {(run.preprocessingReport.columns?.encodedCategorical ?? []).length > 0 && (
              <p className="muted">
                Encoded categorical columns: {run.preprocessingReport.columns.encodedCategorical.join(", ")}
              </p>
            )}
            {(run.preprocessingReport.columns?.removedConstant ?? []).length > 0 && (
              <p className="muted">
                Constant columns removed: {run.preprocessingReport.columns.removedConstant.join(", ")}
              </p>
            )}
          </div>
        )}

        {run.preprocessingDiff?.summary && (
          <div className="validation-card valid">
            <strong>Before and after preprocessing</strong>
            <p>
              {run.preprocessingDiff.summary.usableRows} of {run.preprocessingDiff.summary.startingRows} rows were kept,
              and the feature set changed to {run.preprocessingDiff.summary.outputFeatureCount} PCA-ready columns.
            </p>
            {(run.preprocessingDiff.takeaways ?? []).length > 0 && (
              <p className="muted">{run.preprocessingDiff.takeaways.join(" ")}</p>
            )}
          </div>
        )}

        <div className="insight-grid">
          {pcaInsights.map((insight) => (
            <div key={insight} className="insight-card">{insight}</div>
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
          <button className="btn btn-small btn-ghost" onClick={handleExportReport}>
            Export report
          </button>
        </div>
      </section>

      {/* Main scatter plot */}
      <section className="card viz-plot-card">
        <h3>{run.nComponents === 3 ? "3D" : "2D"} PCA scatter plot</h3>
        <div className="analysis-controls">
          <label className="field compact-field">
            <span>Search rows</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Label, value, or row number"
            />
          </label>
          <label className="field compact-field">
            <span>Color by</span>
            <select
              value={colorBy}
              onChange={(e) => {
                setColorBy(e.target.value);
                setSelectedPoint(null);
              }}
            >
              <option value="row">Row order</option>
              {clusterData && <option value="cluster">Cluster</option>}
              {(run.labelColumns ?? []).map((col) => (
                <option key={col} value={`label:${col}`}>{col}</option>
              ))}
            </select>
          </label>
          {(run.labelColumns ?? []).length > 0 && (
            <>
              <label className="field compact-field">
                <span>Filter label</span>
                <select
                  value={labelFilterColumn}
                  onChange={(e) => setLabelFilterColumn(e.target.value)}
                >
                  <option value="">All labels</option>
                  {(run.labelColumns ?? []).map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </label>
              {labelFilterColumn && (
                <label className="field compact-field">
                  <span>Label value</span>
                  <select
                    value={labelFilterValue}
                    onChange={(e) => setLabelFilterValue(e.target.value)}
                  >
                    <option value="all">All values</option>
                    {labelFilterValues.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {clusterData && (
            <label className="field compact-field">
              <span>Cluster filter</span>
              <select value={clusterFilter} onChange={(e) => setClusterFilter(e.target.value)}>
                <option value="all">All clusters</option>
                {clusterData.counts.map((_, index) => (
                  <option key={index} value={index}>Cluster {index}</option>
                ))}
              </select>
            </label>
          )}
          {originalNumericColumns.length > 0 && (
            <>
              <label className="field compact-field">
                <span>Numeric filter</span>
                <select
                  value={numericFilterColumn}
                  onChange={(e) => setNumericFilterColumn(e.target.value)}
                >
                  <option value="">No numeric filter</option>
                  {originalNumericColumns.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </label>
              {numericFilterColumn && (
                <>
                  <label className="field compact-field">
                    <span>Min</span>
                    <input
                      type="number"
                      value={numericFilterMin}
                      onChange={(e) => setNumericFilterMin(e.target.value)}
                      placeholder="Any"
                    />
                  </label>
                  <label className="field compact-field">
                    <span>Max</span>
                    <input
                      type="number"
                      value={numericFilterMax}
                      onChange={(e) => setNumericFilterMax(e.target.value)}
                      placeholder="Any"
                    />
                  </label>
                </>
              )}
            </>
          )}
          <button
            className="btn btn-small btn-ghost"
            disabled={!hasActiveFilters}
            onClick={() => {
              setSearchTerm("");
              setLabelFilterColumn("");
              setLabelFilterValue("all");
              setNumericFilterColumn("");
              setNumericFilterMin("");
              setNumericFilterMax("");
              setClusterFilter("all");
            }}
          >
            Clear filters
          </button>
        </div>
        <p className="muted">
          Showing {filteredItems.length} of {run.transformedData.length} points.
        </p>
        <div ref={plotRef} className="plotly-container" />
        {!plotReady && <p className="muted">Rendering plot…</p>}
        {selectedPoint && (
          <div className="inspector-panel">
            <h3>Selected point {selectedPoint.index + 1}</h3>
            <div className="inspector-grid">
              {selectedPoint.cluster !== undefined && (
                <div>
                  <span className="meta-label">Cluster</span>
                  <strong>{selectedPoint.cluster}</strong>
                </div>
              )}
              {(selectedPoint.coords ?? []).map((value, index) => (
                <div key={`pc-${index}`}>
                  <span className="meta-label">PC{index + 1}</span>
                  <strong>{value.toFixed(3)}</strong>
                </div>
              ))}
              {Object.entries(selectedPoint.metadata?.labels ?? {}).map(([key, value]) => (
                <div key={key}>
                  <span className="meta-label">{key}</span>
                  <strong>{value || "n/a"}</strong>
                </div>
              ))}
              {Object.entries(selectedPoint.metadata?.numeric ?? {}).map(([key, value]) => (
                <div key={key}>
                  <span className="meta-label">{key}</span>
                  <strong>{Number(value).toFixed(3)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
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
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                setClusterData(null);
                setClusterFilter("all");
                if (colorBy === "cluster") setColorBy("row");
              }}
            >
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
