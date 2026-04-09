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
  const [runningPCA, setRunningPCA] = useState(null);

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

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
                {datasets.map((ds) => (
                  <tr key={ds.id}>
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
                          onClick={() => handlePreview(ds.id)}
                        >
                          {preview?.datasetId === ds.id ? "Hide" : "Preview"}
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
                ))}
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
