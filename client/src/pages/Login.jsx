import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { setToken } from "../App";
import BrandLockup from "../components/BrandLockup";

const apiBase = import.meta.env.VITE_API_URL || "";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${apiBase}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Login failed");
      } else {
        setToken(data.token);
        navigate("/projects");
      }
    } catch {
      setError("Could not reach the server. Make sure it is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <section className="card auth-aside">
        <p className="eyebrow">Welcome back</p>
        <BrandLockup subtitle="A calmer place to upload CSVs, tune PCA, and compare what changed." />
        <ul className="auth-benefits">
          <li>See data quality issues before they derail your analysis.</li>
          <li>Use guided PCA presets instead of starting from a blank slate.</li>
          <li>Compare runs side-by-side when you want to understand tradeoffs.</li>
        </ul>
      </section>

      <section className="card form-card auth-form-panel">
        <p className="eyebrow">Sign in</p>
        <h2>Pick up where you left off.</h2>
        <p className="muted">Your datasets, presets, and PCA runs will be ready when you return.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              required
              autoComplete="username"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
            />
          </label>

          <button className="btn btn-primary full-width" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="form-footer">
          No account? <Link to="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}
