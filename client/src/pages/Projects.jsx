import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getToken } from "../App";

const apiBase = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export default function Projects() {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [datasets, setDatasets] = useState([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [runningPCA, setRunningPCA] = useState(null); // datasetId currently running PCA

  useEffect(() => {
    fetchDatasets();
  }, []);

  async function fetchDatasets() {
    setLoadingDatasets(true);
    try {
      const res = await fetch(`${apiBase}/api/datasets`, { headers: authHeaders() });
      if (res.status === 401) { navigate("/login"); return; }
      const data = await res.json();
      setDatasets(data.datasets ?? []);
    } catch {
      // network error — datasets stays empty
    } finally {
      setLoadingDatasets(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    setUploadError("");
    setUploadSuccess("");

    const file = fileRef.current?.files[0];
    if (!file) {
      setUploadError("Please select a CSV file.");
      return;
    }

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
    } catch {
      setUploadError("Could not reach the server.");
    } finally {
      setUploading(false);
    }
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
    } catch {
      alert("Could not reach the server.");
    } finally {
      setRunningPCA(null);
    }
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
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="file-input"
          />
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
          <p className="empty-state">
            No datasets yet. Upload a CSV above to get started.
          </p>
        ) : (
          <div className="dataset-table-wrap">
            <table className="dataset-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Rows</th>
                  <th>Columns</th>
                  <th>Numeric features</th>
                  <th>Uploaded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((ds) => (
                  <tr key={ds.id}>
                    <td className="filename">{ds.original_filename}</td>
                    <td>{ds.row_count}</td>
                    <td>{ds.column_count}</td>
                    <td>
                      <span className="tag-list">
                        {(ds.quantitative_columns ?? []).map((col) => (
                          <span key={col} className="tag">{col}</span>
                        ))}
                      </span>
                    </td>
                    <td className="muted">
                      {new Date(ds.upload_timestamp).toLocaleDateString()}
                    </td>
                    <td>
                      <button
                        className="btn btn-small btn-primary"
                        disabled={runningPCA === ds.id}
                        onClick={() => handleRunPCA(ds.id)}
                      >
                        {runningPCA === ds.id ? "Running…" : "Run PCA →"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
