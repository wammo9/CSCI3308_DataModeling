import { useEffect, useRef, useState } from "react";
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

function datasetTitle(ds) {
  return ds.name || ds.original_filename?.replace(/\.csv$/i, "") || "Dataset";
}

function formatSettingValue(value) {
  if (value === true) return "On";
  if (value === false) return "Off";
  if (value === "drop") return "Drop rows";
  if (value === "mean") return "Fill with mean";
  if (value === "median") return "Fill with median";
  if (value === "iqr") return "Remove by IQR";
  if (value === "zscore") return "Remove by z-score";
  if (value === "none") return "Keep all rows";
  return value ?? "n/a";
}

export default function Compare() {
  const navigate = useNavigate();
  const plotRefs = useRef({});

  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState([]);
  const [datasetDetails, setDatasetDetails] = useState({});
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [runDetails, setRunDetails] = useState({});
  const [runComparison, setRunComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDatasets() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${apiBase}/api/datasets`, { headers: authHeaders() });
        if (res.status === 401) {
          navigate("/login");
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          setError(data.message || "Could not load datasets.");
          return;
        }
        setDatasets(data.datasets ?? []);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    }
    loadDatasets();
  }, [navigate]);

  useEffect(() => {
    async function loadDatasetDetails() {
      if (selectedDatasetIds.length === 0) {
        setDatasetDetails({});
        setSelectedRunIds([]);
        return;
      }

      setDetailLoading(true);
      try {
        const entries = await Promise.all(selectedDatasetIds.map(async (id) => {
          const [qualityRes, analysisRes, runsRes] = await Promise.all([
            fetch(`${apiBase}/api/datasets/${id}/quality`, { headers: authHeaders() }),
            fetch(`${apiBase}/api/datasets/${id}/analysis`, { headers: authHeaders() }),
            fetch(`${apiBase}/api/datasets/${id}/pca`, { headers: authHeaders() }),
          ]);

          const [quality, analysis, runs] = await Promise.all([
            qualityRes.json(),
            analysisRes.json(),
            runsRes.json(),
          ]);

          return [id, {
            quality: qualityRes.ok ? quality.qualityReport : null,
            analysis: analysisRes.ok ? analysis.analysis : null,
            runs: runsRes.ok ? runs.runs ?? [] : [],
          }];
        }));
        setDatasetDetails(Object.fromEntries(entries));
        setSelectedRunIds((ids) => ids.filter((id) =>
          entries.some(([, detail]) => detail.runs.some((run) => String(run.id) === String(id)))
        ));
      } catch {
        setError("Could not load comparison details.");
      } finally {
        setDetailLoading(false);
      }
    }

    loadDatasetDetails();
  }, [selectedDatasetIds]);

  useEffect(() => {
    async function loadRuns() {
      if (selectedRunIds.length === 0) {
        setRunDetails({});
        return;
      }

      try {
        const entries = await Promise.all(selectedRunIds.map(async (id) => {
          const res = await fetch(`${apiBase}/api/pca/${id}`, { headers: authHeaders() });
          const data = await res.json();
          return res.ok ? [id, data] : null;
        }));
        setRunDetails(Object.fromEntries(entries.filter(Boolean)));
      } catch {
        setError("Could not load PCA run details.");
      }
    }

    loadRuns();
  }, [selectedRunIds]);

  useEffect(() => {
    async function loadRunComparison() {
      setComparisonError("");
      if (selectedRunIds.length !== 2) {
        setRunComparison(null);
        setComparisonLoading(false);
        return;
      }

      const selectedRuns = datasets.flatMap((ds) =>
        (datasetDetails[ds.id]?.runs ?? []).map((run) => ({
          ...run,
          datasetId: ds.id,
          datasetName: datasetTitle(ds),
        }))
      ).filter((run) => selectedRunIds.includes(run.id));

      if (selectedRuns.length !== 2) {
        setRunComparison(null);
        return;
      }
      if (selectedRuns[0].datasetId !== selectedRuns[1].datasetId) {
        setRunComparison(null);
        setComparisonError("Select two runs from the same dataset to see the detailed run comparison summary.");
        return;
      }

      setComparisonLoading(true);
      try {
        const res = await fetch(
          `${apiBase}/api/datasets/${selectedRuns[0].datasetId}/pca/compare?runA=${selectedRuns[0].id}&runB=${selectedRuns[1].id}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        if (!res.ok) {
          setRunComparison(null);
          setComparisonError(data.message || "Could not compare the selected runs.");
          return;
        }
        setRunComparison({
          ...data.comparison,
          datasetName: selectedRuns[0].datasetName,
        });
      } catch {
        setRunComparison(null);
        setComparisonError("Could not reach the server.");
      } finally {
        setComparisonLoading(false);
      }
    }

    loadRunComparison();
  }, [selectedRunIds, datasetDetails, datasets]);

  useEffect(() => {
    const runs = Object.values(runDetails);
    if (runs.length === 0) return;

    import("plotly.js-dist-min").then((Plotly) => {
      runs.forEach((run) => {
        const el = plotRefs.current[run.runId];
        const points = run.transformedData ?? [];
        if (!el || points.length === 0) return;
        const is3D = run.nComponents >= 3;
        const marker = {
          size: is3D ? 4 : 7,
          opacity: 0.78,
          color: points.map((_, index) => index),
          colorscale: "Viridis",
        };
        const trace = is3D
          ? {
            type: "scatter3d",
            mode: "markers",
            x: points.map((point) => point[0]),
            y: points.map((point) => point[1]),
            z: points.map((point) => point[2]),
            marker,
            hovertemplate: "PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>",
          }
          : {
            type: "scatter",
            mode: "markers",
            x: points.map((point) => point[0]),
            y: points.map((point) => point[1]),
            marker,
            hovertemplate: "PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>",
          };

        Plotly.default.newPlot(el, [trace], {
          margin: { l: 35, r: 15, t: 10, b: 35 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(255,255,255,0.65)",
          xaxis: { title: "PC1" },
          yaxis: { title: "PC2" },
        }, { responsive: true, displaylogo: false });
      });
    });
  }, [runDetails]);

  function toggleDataset(id) {
    setSelectedDatasetIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  }

  function toggleRun(id) {
    setSelectedRunIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  }

  const selectedDatasets = datasets.filter((ds) => selectedDatasetIds.includes(ds.id));
  const allRuns = selectedDatasets.flatMap((ds) =>
    (datasetDetails[ds.id]?.runs ?? []).map((run) => ({ ...run, dataset: ds }))
  );

  return (
    <main className="app-shell workspace-shell compare-shell">
      <section className="card compare-hero">
        <div>
          <p className="eyebrow">Comparison dashboard</p>
          <h2>Compare datasets and PCA runs</h2>
          <p className="muted">
            Select two or more datasets to compare row counts, numeric features, quality warnings,
            correlations, explained variance, and PCA plots side-by-side.
          </p>
        </div>
        <Link to="/projects" className="btn btn-ghost">Back to projects</Link>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        <h3>Select datasets</h3>
        {loading ? (
          <p className="muted">Loading datasets...</p>
        ) : datasets.length === 0 ? (
          <p className="empty-state">No datasets yet. Upload or add sample datasets on the Projects page.</p>
        ) : (
          <div className="compare-picker">
            {datasets.map((ds) => (
              <label key={ds.id} className="compare-option">
                <input
                  type="checkbox"
                  checked={selectedDatasetIds.includes(ds.id)}
                  onChange={() => toggleDataset(ds.id)}
                />
                <span>
                  <strong>{datasetTitle(ds)}</strong>
                  <small>{ds.row_count} rows · {(ds.quantitative_columns ?? []).length} numeric features</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {detailLoading && <p className="muted">Loading comparison details...</p>}

      {selectedDatasets.length > 0 && (
        <section className="comparison-grid">
          {selectedDatasets.map((ds) => {
            const detail = datasetDetails[ds.id] ?? {};
            const quality = detail.quality;
            const analysis = detail.analysis;
            const strongest = analysis?.strongestCorrelations?.[0];
            return (
              <article key={ds.id} className="card comparison-card">
                <div>
                  <h3>{datasetTitle(ds)}</h3>
                  <p className="muted">{ds.original_filename}</p>
                </div>

                <div className="quality-metrics">
                  <div>
                    <span className="meta-label">Rows</span>
                    <strong>{formatNumber(ds.row_count)}</strong>
                  </div>
                  <div>
                    <span className="meta-label">Columns</span>
                    <strong>{formatNumber(ds.column_count)}</strong>
                  </div>
                  <div>
                    <span className="meta-label">Numeric</span>
                    <strong>{formatNumber((ds.quantitative_columns ?? []).length)}</strong>
                  </div>
                  <div>
                    <span className="meta-label">PCA runs</span>
                    <strong>{formatNumber(detail.runs?.length ?? 0)}</strong>
                  </div>
                </div>

                {quality && (
                  <div className={`validation-card ${quality.validForPca !== false ? "valid" : "invalid"}`}>
                    <strong>{quality.validForPca !== false ? "Valid for PCA" : "Invalid for PCA"}</strong>
                    <p>{quality.validationMessage || "Quality report available."}</p>
                    <p className="muted">
                      Rows dropped: {formatNumber(quality.rows?.droppedForPca)}
                      {" "}· Ignored columns: {formatNumber(quality.columns?.ignored)}
                    </p>
                  </div>
                )}

                {(quality?.warnings ?? []).length > 0 && (
                  <div className="quality-warnings">
                    {quality.warnings.slice(0, 4).map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                )}

                <div>
                  <span className="meta-label">Strongest relationship</span>
                  {strongest ? (
                    <p className="compare-stat">
                      <strong>{strongest.x}</strong> and <strong>{strongest.y}</strong>: {Number(strongest.r).toFixed(3)}
                    </p>
                  ) : (
                    <p className="muted">No correlation summary available.</p>
                  )}
                </div>

                <div className="tag-list">
                  {(ds.quantitative_columns ?? []).slice(0, 8).map((col) => (
                    <span key={col} className="tag">{col}</span>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {allRuns.length > 0 && (
        <section className="card">
          <h3>Select PCA runs to compare</h3>
          <div className="run-compare-list">
            {allRuns.map((run) => (
              <label key={run.id} className="compare-option">
                <input
                  type="checkbox"
                  checked={selectedRunIds.includes(run.id)}
                  onChange={() => toggleRun(run.id)}
                />
                <span>
                  <strong>{datasetTitle(run.dataset)} · Run #{run.id}</strong>
                  <small>
                    {run.n_components} components · {pct(run.explained_variance_ratio)}
                    {" "}variance · {run.n_samples} samples
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {(selectedRunIds.length > 0 || runComparison || comparisonError) && (
        <section className="card">
          <div className="compare-summary-header">
            <div>
              <h3>Run comparison summary</h3>
              <p className="muted">
                Select exactly two runs from the same dataset to compare variance explained, preprocessing choices,
                and feature coverage side-by-side.
              </p>
            </div>
          </div>

          {comparisonLoading ? (
            <p className="muted">Comparing selected runs...</p>
          ) : runComparison ? (
            <>
              <div className="comparison-grid">
                {[["Run A", runComparison.runA], ["Run B", runComparison.runB]].map(([label, run]) => (
                  <article key={label} className="comparison-card compare-run-card">
                    <div>
                      <span className="meta-label">{label}</span>
                      <h3>{runComparison.datasetName}</h3>
                      <p className="muted">
                        Run #{run.id} · {new Date(run.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="quality-metrics">
                      <div>
                        <span className="meta-label">Variance</span>
                        <strong>{pct(run.explainedVarianceRatio)}</strong>
                      </div>
                      <div>
                        <span className="meta-label">Samples</span>
                        <strong>{formatNumber(run.nSamples)}</strong>
                      </div>
                      <div>
                        <span className="meta-label">Components</span>
                        <strong>{run.nComponents}</strong>
                      </div>
                      <div>
                        <span className="meta-label">Features</span>
                        <strong>{formatNumber(run.columnNames?.length)}</strong>
                      </div>
                    </div>
                    {run.preprocessingReport?.message && (
                      <div className="validation-card valid">
                        <strong>Preprocessing summary</strong>
                        <p>{run.preprocessingReport.message}</p>
                      </div>
                    )}
                    <div>
                      <span className="meta-label">Top PC1 contributors</span>
                      <div className="tag-list">
                        {(run.topContributors ?? []).map((item) => (
                          <span key={`${run.id}-${item.name}`} className="tag">
                            {item.name} ({item.value.toFixed(2)})
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {(runComparison.preprocessingDifferences ?? []).length > 0 && (
                <div className="comparison-notes">
                  <span className="meta-label">Preprocessing differences</span>
                  {(runComparison.preprocessingDifferences ?? []).map((item) => (
                    <p key={item.key}>
                      <strong>{item.label}:</strong> Run A uses {formatSettingValue(item.runA)} and Run B uses {formatSettingValue(item.runB)}.
                    </p>
                  ))}
                </div>
              )}

              {(runComparison.onlyInRunA?.length > 0 || runComparison.onlyInRunB?.length > 0) && (
                <div className="comparison-grid compare-feature-grid">
                  <div className="comparison-notes">
                    <span className="meta-label">Only in Run A</span>
                    <div className="tag-list">
                      {(runComparison.onlyInRunA ?? []).length > 0 ? runComparison.onlyInRunA.map((col) => (
                        <span key={`run-a-${col}`} className="tag">{col}</span>
                      )) : <span className="muted">Same features as Run B.</span>}
                    </div>
                  </div>
                  <div className="comparison-notes">
                    <span className="meta-label">Only in Run B</span>
                    <div className="tag-list">
                      {(runComparison.onlyInRunB ?? []).length > 0 ? runComparison.onlyInRunB.map((col) => (
                        <span key={`run-b-${col}`} className="tag">{col}</span>
                      )) : <span className="muted">Same features as Run A.</span>}
                    </div>
                  </div>
                </div>
              )}

              <div className="insight-grid">
                {(runComparison.takeaways ?? []).map((item) => (
                  <div key={item} className="insight-card">{item}</div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">
              {comparisonError || "Select exactly two runs from the same dataset to unlock the detailed comparison summary."}
            </p>
          )}
        </section>
      )}

      {Object.values(runDetails).length > 0 && (
        <section className="comparison-grid">
          {Object.values(runDetails).map((run) => (
            <article key={run.runId} className="card comparison-card">
              <div className="run-card-header">
                <div>
                  <h3>{run.filename}</h3>
                  <p className="muted">Run #{run.runId} · {run.nSamples} samples</p>
                </div>
                <Link className="btn btn-small btn-primary" to={`/visualize/${run.runId}`}>
                  Open
                </Link>
              </div>

              <div className="quality-metrics">
                <div>
                  <span className="meta-label">Components</span>
                  <strong>{run.nComponents}</strong>
                </div>
                <div>
                  <span className="meta-label">Variance</span>
                  <strong>{pct(run.explainedVarianceRatio)}</strong>
                </div>
                <div>
                  <span className="meta-label">Features</span>
                  <strong>{formatNumber(run.columnNames?.length)}</strong>
                </div>
              </div>

              {run.preprocessingReport && (
                <div className="validation-card valid">
                  <strong>Preprocessing</strong>
                  <p>{run.preprocessingReport.message}</p>
                  <p className="muted">
                    Imputed: {formatNumber(run.preprocessingReport.rows?.imputedValues)}
                    {" "}· Outliers removed: {formatNumber(run.preprocessingReport.rows?.droppedOutliers)}
                  </p>
                </div>
              )}

              <div className="mini-pca-plot" ref={(el) => { plotRefs.current[run.runId] = el; }} />

              <div className="tag-list">
                {(run.columnNames ?? []).slice(0, 10).map((col) => (
                  <span key={col} className="tag">{col}</span>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
