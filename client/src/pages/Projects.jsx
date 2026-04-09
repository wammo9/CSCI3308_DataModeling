import { Fragment, useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getToken } from "../App";

const apiBase = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

function pct(ratios = []) {
  return (ratios.reduce((sum, value) => sum + Number(value || 0), 0) * 100).toFixed(1) + "%";
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function Projects() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const correlationRef = useRef(null);
  const distributionRef = useRef(null);
  const scatterRef = useRef(null);

  const [datasets, setDatasets] = useState([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [runningPCA, setRunningPCA] = useState(null);

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Quality report state
  const [qualityReports, setQualityReports] = useState({});
  const [qualityLoadingId, setQualityLoadingId] = useState(null);

  // PCA options state
  const [configuringId, setConfiguringId] = useState(null);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [componentCount, setComponentCount] = useState(3);
  const [scaleFeatures, setScaleFeatures] = useState(true);
  const [configError, setConfigError] = useState("");

  // Run history state
  const [openRunsId, setOpenRunsId] = useState(null);
  const [runsByDataset, setRunsByDataset] = useState({});
  const [runsLoadingId, setRunsLoadingId] = useState(null);

  // Dataset analysis state
  const [openAnalysisId, setOpenAnalysisId] = useState(null);
  const [analysisByDataset, setAnalysisByDataset] = useState({});
  const [analysisLoadingId, setAnalysisLoadingId] = useState(null);
  const [distributionColumn, setDistributionColumn] = useState("");
  const [scatterX, setScatterX] = useState("");
  const [scatterY, setScatterY] = useState("");

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    const analysis = openAnalysisId ? analysisByDataset[openAnalysisId] : null;
    if (!analysis || !correlationRef.current || !distributionRef.current || !scatterRef.current) return;

    import("plotly.js-dist-min").then((Plotly) => {
      const cols = analysis.columnNames ?? [];
      const rows = analysis.rows ?? [];
      const distributionIndex = Math.max(0, cols.indexOf(distributionColumn || cols[0]));
      const xIndex = Math.max(0, cols.indexOf(scatterX || cols[0]));
      const yIndex = Math.max(0, cols.indexOf(scatterY || cols[1] || cols[0]));
      const distributionValues = rows.map((row) => row.values[distributionIndex]);
      const xValues = rows.map((row) => row.values[xIndex]);
      const yValues = rows.map((row) => row.values[yIndex]);

      Plotly.default.newPlot(correlationRef.current, [{
        type: "heatmap",
        x: cols,
        y: cols,
        z: analysis.correlationMatrix,
        zmin: -1,
        zmax: 1,
        colorscale: "RdBu",
        reversescale: true,
        hovertemplate: "%{y} vs %{x}: %{z:.3f}<extra></extra>",
      }], {
        margin: { l: 90, r: 20, t: 20, b: 80 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(255,255,255,0.6)",
      }, { responsive: true, displaylogo: false });

      Plotly.default.newPlot(distributionRef.current, [
        {
          type: "histogram",
          x: distributionValues,
          name: "Histogram",
          marker: { color: "#2d4a3e" },
          opacity: 0.85,
        },
        {
          type: "box",
          x: distributionValues,
          name: "Box plot",
          marker: { color: "#b57a2e" },
          boxpoints: "outliers",
          yaxis: "y2",
        },
      ], {
        margin: { l: 50, r: 20, t: 20, b: 50 },
        yaxis2: { overlaying: "y", side: "right", showticklabels: false },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(255,255,255,0.6)",
        showlegend: false,
      }, { responsive: true, displaylogo: false });

      Plotly.default.newPlot(scatterRef.current, [{
        type: "scatter",
        mode: "markers",
        x: xValues,
        y: yValues,
        marker: { size: 8, opacity: 0.75, color: rows.map((_, i) => i), colorscale: "Viridis" },
        hovertemplate: `${cols[xIndex]}: %{x:.3f}<br>${cols[yIndex]}: %{y:.3f}<extra></extra>`,
      }], {
        xaxis: { title: cols[xIndex] },
        yaxis: { title: cols[yIndex] },
        margin: { l: 60, r: 20, t: 20, b: 60 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(255,255,255,0.6)",
      }, { responsive: true, displaylogo: false });
    });
  }, [openAnalysisId, analysisByDataset, distributionColumn, scatterX, scatterY]);

  async function fetchDatasets() {
    setLoadingDatasets(true);
    try {
      const res = await fetch(`${apiBase}/api/datasets`, { headers: authHeaders() });
      if (res.status === 401) { navigate("/login"); return; }
      const data = await res.json();
      setDatasets(data.datasets ?? []);
    } catch {
      // network error
    } finally {
      setLoadingDatasets(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    setUploadError("");
    setUploadSuccess("");

    const file = fileRef.current?.files[0];
    if (!file) { setUploadError("Please select a CSV file."); return; }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await fetch(`${apiBase}/api/datasets/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.message || "Upload failed");
      } else {
        setUploadSuccess(
          `"${data.filename}" uploaded — ${data.rowCount} rows, ${data.quantitativeColumns.length} numeric columns.`
        );
        fileRef.current.value = "";
        fetchDatasets();
      }
    } catch { setUploadError("Could not reach the server."); }
    finally { setUploading(false); }
  }

  async function handleRunPCA(datasetId) {
    setRunningPCA(datasetId);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/pca`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("PCA failed: " + (data.message || "Unknown error"));
      } else {
        navigate(`/visualize/${data.runId}`);
      }
    } catch { alert("Could not reach the server."); }
    finally { setRunningPCA(null); }
  }

  function startConfiguring(ds) {
    if (configuringId === ds.id) {
      setConfiguringId(null);
      return;
    }
    const columns = ds.quantitative_columns ?? [];
    setConfiguringId(ds.id);
    setSelectedColumns(columns);
    setComponentCount(columns.length >= 3 ? 3 : 2);
    setScaleFeatures(true);
    setConfigError("");
  }

  function toggleSelectedColumn(column) {
    setSelectedColumns((cols) =>
      cols.includes(column) ? cols.filter((c) => c !== column) : [...cols, column]
    );
  }

  async function handleConfiguredPCA(datasetId) {
    setConfigError("");
    if (selectedColumns.length < 2) {
      setConfigError("Choose at least two numeric features.");
      return;
    }

    setRunningPCA(datasetId);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/pca`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: selectedColumns,
          nComponents: componentCount,
          scale: scaleFeatures,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConfigError(data.message || "PCA failed");
      } else {
        navigate(`/visualize/${data.runId}`);
      }
    } catch {
      setConfigError("Could not reach the server.");
    } finally {
      setRunningPCA(null);
    }
  }

  // ── Feature 1: Preview ──

  async function handlePreview(datasetId) {
    if (preview?.datasetId === datasetId) { setPreview(null); return; }
    setPreviewLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/preview`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview({ datasetId, ...data });
      }
    } catch { /* ignore */ }
    finally { setPreviewLoading(false); }
  }

  async function handleQuality(datasetId) {
    if (qualityReports[datasetId]?.open) {
      setQualityReports((reports) => ({
        ...reports,
        [datasetId]: { ...reports[datasetId], open: false },
      }));
      return;
    }

    setQualityLoadingId(datasetId);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/quality`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setQualityReports((reports) => ({
          ...reports,
          [datasetId]: { open: true, report: data.qualityReport },
        }));
      }
    } catch { /* ignore */ }
    finally { setQualityLoadingId(null); }
  }

  async function fetchRuns(datasetId) {
    setRunsLoadingId(datasetId);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/pca`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setRunsByDataset((runs) => ({ ...runs, [datasetId]: data.runs ?? [] }));
      }
    } catch { /* ignore */ }
    finally { setRunsLoadingId(null); }
  }

  async function handleRuns(datasetId) {
    if (openRunsId === datasetId) {
      setOpenRunsId(null);
      return;
    }

    setOpenRunsId(datasetId);
    fetchRuns(datasetId);
  }

  async function handleDeleteRun(runId, datasetId) {
    if (!confirm("Delete this PCA run?")) return;
    try {
      const res = await fetch(`${apiBase}/api/pca/${runId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        fetchRuns(datasetId);
      }
    } catch { alert("Could not reach the server."); }
  }

  async function handleAnalysis(datasetId) {
    if (openAnalysisId === datasetId) {
      setOpenAnalysisId(null);
      return;
    }

    setOpenAnalysisId(datasetId);
    if (analysisByDataset[datasetId]) {
      const cols = analysisByDataset[datasetId].columnNames ?? [];
      setDistributionColumn(cols[0] || "");
      setScatterX(cols[0] || "");
      setScatterY(cols[1] || cols[0] || "");
      return;
    }

    setAnalysisLoadingId(datasetId);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}/analysis`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        const cols = data.analysis?.columnNames ?? [];
        setAnalysisByDataset((analyses) => ({ ...analyses, [datasetId]: data.analysis }));
        setDistributionColumn(cols[0] || "");
        setScatterX(cols[0] || "");
        setScatterY(cols[1] || cols[0] || "");
      }
    } catch { alert("Could not reach the server."); }
    finally { setAnalysisLoadingId(null); }
  }

  // ── Feature 2: Delete ──

  async function handleDelete(datasetId, filename) {
    if (!confirm(`Delete "${filename}" and all its PCA runs?`)) return;
    try {
      const res = await fetch(`${apiBase}/api/datasets/${datasetId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        if (preview?.datasetId === datasetId) setPreview(null);
        fetchDatasets();
      }
    } catch { alert("Could not reach the server."); }
  }

  // ── Feature 5: Rename / Notes ──

  function startEditing(ds) {
    setEditingId(ds.id);
    setEditName(ds.name || ds.original_filename.replace(/\.csv$/i, ""));
    setEditNotes(ds.notes || "");
  }

  async function saveEditing() {
    try {
      const res = await fetch(`${apiBase}/api/datasets/${editingId}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, notes: editNotes }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchDatasets();
      }
    } catch { alert("Could not reach the server."); }
  }

  return (
    <main className="app-shell">
      {/* ── Upload section ── */}
      <section className="card">
        <h2>Upload a dataset</h2>
        <p className="muted">
          Upload a CSV with at least two numeric columns. Non-numeric columns are
          ignored; rows with missing values are dropped automatically.
        </p>

        {uploadError && <div className="alert alert-error">{uploadError}</div>}
        {uploadSuccess && <div className="alert alert-success">{uploadSuccess}</div>}

        <form onSubmit={handleUpload} className="upload-form">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="file-input" />
          <button className="btn btn-primary" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload CSV"}
          </button>
        </form>
      </section>

      {/* ── Dataset list ── */}
      <section className="card">
        <h2>Your datasets</h2>

        {loadingDatasets ? (
          <p className="muted">Loading…</p>
        ) : datasets.length === 0 ? (
          <p className="empty-state">No datasets yet. Upload a CSV above to get started.</p>
        ) : (
          <div className="dataset-table-wrap">
            <table className="dataset-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>File</th>
                  <th>Rows</th>
                  <th>Numeric features</th>
                  <th>Uploaded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((ds) => {
                  const reportState = qualityReports[ds.id];
                  const report = reportState?.report;
                  const runs = runsByDataset[ds.id] ?? [];
                  const analysis = analysisByDataset[ds.id];
                  const isConfiguring = configuringId === ds.id;
                  const hasRunHistory = openRunsId === ds.id;
                  const hasAnalysis = openAnalysisId === ds.id;
                  return (
                    <Fragment key={ds.id}>
                      <tr>
                        {/* Name cell — inline editing */}
                        <td>
                          {editingId === ds.id ? (
                            <div className="edit-inline">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="edit-input"
                                placeholder="Name"
                              />
                              <textarea
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                className="edit-textarea"
                                placeholder="Notes (optional)"
                                rows={2}
                              />
                              <div className="edit-actions">
                                <button className="btn btn-small btn-primary" onClick={saveEditing}>Save</button>
                                <button className="btn btn-small btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="filename">
                                {ds.name || ds.original_filename.replace(/\.csv$/i, "")}
                              </span>
                              {ds.notes && <p className="ds-notes">{ds.notes}</p>}
                            </div>
                          )}
                        </td>
                        <td className="muted">{ds.original_filename}</td>
                        <td>{ds.row_count}</td>
                        <td>
                          <span className="tag-list">
                            {(ds.quantitative_columns ?? []).map((col) => (
                              <span key={col} className="tag">{col}</span>
                            ))}
                          </span>
                        </td>
                        <td className="muted">{new Date(ds.upload_timestamp).toLocaleDateString()}</td>
                        <td>
                          <div className="action-btns">
                            <button
                              className="btn btn-small btn-primary"
                              disabled={runningPCA === ds.id}
                              onClick={() => handleRunPCA(ds.id)}
                            >
                              {runningPCA === ds.id ? "Running…" : "PCA"}
                            </button>
                            <button
                              className="btn btn-small btn-ghost"
                              onClick={() => startConfiguring(ds)}
                            >
                              {isConfiguring ? "Hide options" : "Options"}
                            </button>
                            <button
                              className="btn btn-small btn-ghost"
                              onClick={() => handleRuns(ds.id)}
                            >
                              {hasRunHistory ? "Hide runs" : "Runs"}
                            </button>
                            <button
                              className="btn btn-small btn-ghost"
                              disabled={previewLoading && preview?.datasetId !== ds.id}
                              onClick={() => handlePreview(ds.id)}
                            >
                              {preview?.datasetId === ds.id ? "Hide" : "Preview"}
                            </button>
                            <button
                              className="btn btn-small btn-ghost"
                              disabled={qualityLoadingId === ds.id}
                              onClick={() => handleQuality(ds.id)}
                            >
                              {reportState?.open ? "Hide quality" : qualityLoadingId === ds.id ? "Loading…" : "Quality"}
                            </button>
                            <button
                              className="btn btn-small btn-ghost"
                              disabled={analysisLoadingId === ds.id}
                              onClick={() => handleAnalysis(ds.id)}
                            >
                              {hasAnalysis ? "Hide analysis" : analysisLoadingId === ds.id ? "Loading…" : "Analysis"}
                            </button>
                            <button className="btn btn-small btn-ghost" onClick={() => startEditing(ds)}>
                              Edit
                            </button>
                            <button
                              className="btn btn-small btn-danger"
                              onClick={() => handleDelete(ds.id, ds.original_filename)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isConfiguring && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="detail-panel pca-options-panel">
                              <div>
                                <h3>PCA options</h3>
                                <p className="muted">Choose the numeric features for the next PCA run.</p>
                              </div>

                              {configError && <div className="alert alert-error">{configError}</div>}

                              <div className="column-picker">
                                {(ds.quantitative_columns ?? []).map((col) => (
                                  <label key={col} className="check-pill">
                                    <input
                                      type="checkbox"
                                      checked={selectedColumns.includes(col)}
                                      onChange={() => toggleSelectedColumn(col)}
                                    />
                                    <span>{col}</span>
                                  </label>
                                ))}
                              </div>

                              <div className="option-grid">
                                <label className="field compact-field">
                                  <span>Components</span>
                                  <select
                                    value={componentCount}
                                    onChange={(e) => setComponentCount(Number(e.target.value))}
                                  >
                                    <option value={2}>2D</option>
                                    <option value={3}>3D</option>
                                  </select>
                                </label>

                                <label className="check-row">
                                  <input
                                    type="checkbox"
                                    checked={scaleFeatures}
                                    onChange={(e) => setScaleFeatures(e.target.checked)}
                                  />
                                  <span>Scale features before PCA</span>
                                </label>
                              </div>

                              <button
                                className="btn btn-small btn-primary"
                                disabled={runningPCA === ds.id}
                                onClick={() => handleConfiguredPCA(ds.id)}
                              >
                                {runningPCA === ds.id ? "Running…" : "Run configured PCA"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {hasRunHistory && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="detail-panel">
                              <h3>PCA runs</h3>
                              {runsLoadingId === ds.id ? (
                                <p className="muted">Loading runs…</p>
                              ) : runs.length === 0 ? (
                                <p className="muted">No PCA runs yet.</p>
                              ) : (
                                <div className="run-list">
                                  {runs.map((run) => (
                                    <div key={run.id} className="run-item">
                                      <div>
                                        <strong>{run.n_components} components</strong>
                                        <p className="muted">
                                          {pct(run.explained_variance_ratio)} variance, {run.n_samples} samples,
                                          {" "}{new Date(run.created_at).toLocaleString()}
                                        </p>
                                        <div className="tag-list">
                                          {(run.column_names ?? []).map((col) => (
                                            <span key={col} className="tag">{col}</span>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="action-btns">
                                        <Link className="btn btn-small btn-primary" to={`/visualize/${run.id}`}>
                                          Open
                                        </Link>
                                        <button
                                          className="btn btn-small btn-danger"
                                          onClick={() => handleDeleteRun(run.id, ds.id)}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}

                      {reportState?.open && report && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="detail-panel">
                              <h3>Dataset quality</h3>
                              <div className="quality-metrics">
                                <div>
                                  <span className="meta-label">Rows used</span>
                                  <strong>{formatNumber(report.rows?.usableForPca)} of {formatNumber(report.rows?.total)}</strong>
                                </div>
                                <div>
                                  <span className="meta-label">Rows dropped</span>
                                  <strong>{formatNumber(report.rows?.droppedForPca)}</strong>
                                </div>
                                <div>
                                  <span className="meta-label">Numeric features</span>
                                  <strong>{formatNumber(report.columns?.quantitative)}</strong>
                                </div>
                                <div>
                                  <span className="meta-label">Ignored columns</span>
                                  <strong>{formatNumber(report.columns?.ignored)}</strong>
                                </div>
                              </div>

                              {(report.warnings ?? []).length > 0 && (
                                <div className="quality-warnings">
                                  {report.warnings.map((warning) => (
                                    <p key={warning}>{warning}</p>
                                  ))}
                                </div>
                              )}

                              {(report.numericColumns ?? []).length > 0 && (
                                <div className="dataset-table-wrap">
                                  <table className="dataset-table quality-table">
                                    <thead>
                                      <tr>
                                        <th>Column</th>
                                        <th>Missing</th>
                                        <th>Min</th>
                                        <th>Max</th>
                                        <th>Mean</th>
                                        <th>Std dev</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {report.numericColumns.map((col) => (
                                        <tr key={col.name}>
                                          <td>{col.name}</td>
                                          <td>{formatNumber(col.missingCount)}</td>
                                          <td>{formatNumber(col.min)}</td>
                                          <td>{formatNumber(col.max)}</td>
                                          <td>{formatNumber(col.mean)}</td>
                                          <td>{formatNumber(col.stdDev)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {(report.ignoredColumns ?? []).length > 0 && (
                                <p className="muted">
                                  Ignored: {report.ignoredColumns.map((col) => col.name).join(", ")}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}

                      {hasAnalysis && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="detail-panel analysis-panel">
                              <div>
                                <h3>Quantitative analysis</h3>
                                <p className="muted">
                                  Correlations, distributions, and pairwise scatter plots for the cleaned numeric rows.
                                </p>
                              </div>

                              {analysisLoadingId === ds.id && <p className="muted">Loading analysis…</p>}

                              {analysis && (
                                <>
                                  <div className="analysis-grid">
                                    <div>
                                      <h3>Correlation heatmap</h3>
                                      <div ref={correlationRef} className="analysis-plot" />
                                    </div>
                                    <div>
                                      <h3>Strongest relationships</h3>
                                      <div className="correlation-list">
                                        {(analysis.strongestCorrelations ?? []).map((item) => (
                                          <p key={`${item.x}-${item.y}`}>
                                            <strong>{item.x}</strong> and <strong>{item.y}</strong>: {Number(item.r).toFixed(3)}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="analysis-controls">
                                    <label className="field compact-field">
                                      <span>Distribution</span>
                                      <select
                                        value={distributionColumn}
                                        onChange={(e) => setDistributionColumn(e.target.value)}
                                      >
                                        {analysis.columnNames.map((col) => (
                                          <option key={col} value={col}>{col}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="field compact-field">
                                      <span>X axis</span>
                                      <select value={scatterX} onChange={(e) => setScatterX(e.target.value)}>
                                        {analysis.columnNames.map((col) => (
                                          <option key={col} value={col}>{col}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="field compact-field">
                                      <span>Y axis</span>
                                      <select value={scatterY} onChange={(e) => setScatterY(e.target.value)}>
                                        {analysis.columnNames.map((col) => (
                                          <option key={col} value={col}>{col}</option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>

                                  <div className="analysis-grid">
                                    <div>
                                      <h3>Histogram and box plot</h3>
                                      <div ref={distributionRef} className="analysis-plot" />
                                    </div>
                                    <div>
                                      <h3>Scatterplot explorer</h3>
                                      <div ref={scatterRef} className="analysis-plot" />
                                    </div>
                                  </div>

                                  <div className="dataset-table-wrap">
                                    <table className="dataset-table quality-table">
                                      <thead>
                                        <tr>
                                          <th>Column</th>
                                          <th>Mean</th>
                                          <th>Median</th>
                                          <th>Std dev</th>
                                          <th>Q1</th>
                                          <th>Q3</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {analysis.columnStats.map((col) => (
                                          <tr key={col.name}>
                                            <td>{col.name}</td>
                                            <td>{formatNumber(col.mean)}</td>
                                            <td>{formatNumber(col.median)}</td>
                                            <td>{formatNumber(col.stdDev)}</td>
                                            <td>{formatNumber(col.q1)}</td>
                                            <td>{formatNumber(col.q3)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Preview panel ── */}
      {preview && (
        <section className="card">
          <h3>Preview: {preview.filename}</h3>
          <p className="muted">
            Showing first {preview.preview.length} of {preview.totalRows} rows.
            Numeric columns are highlighted.
          </p>
          <div className="dataset-table-wrap">
            <table className="dataset-table preview-table">
              <thead>
                <tr>
                  {preview.columns.map((col) => (
                    <th
                      key={col}
                      className={preview.quantitativeColumns.includes(col) ? "col-numeric" : ""}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row, i) => (
                  <tr key={i}>
                    {preview.columns.map((col) => (
                      <td key={col}>{row[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
