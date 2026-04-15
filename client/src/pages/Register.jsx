import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { setToken } from "../App";
import BrandLockup from "../components/BrandLockup";

const apiBase = import.meta.env.VITE_API_URL || "";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (form.username.trim().length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Registration failed");
      } else {
        // Server returns a token on successful registration
        if (data.token) setToken(data.token);
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
        <p className="eyebrow">New workspace</p>
        <BrandLockup subtitle="Build a more confident workflow for CSV exploration, cleanup, and PCA storytelling." />
        <ul className="auth-benefits">
          <li>Organize datasets and keep track of your analysis choices.</li>
          <li>Use quality checks and visual comparisons to stay grounded in the data.</li>
          <li>Move from messy upload to clean insight without losing context.</li>
        </ul>
      </section>

      <section className="card form-card auth-form-panel">
        <p className="eyebrow">Create account</p>
        <h2>Set up your modeling workspace.</h2>
        <p className="muted">Create an account to save datasets, compare runs, and keep your exploration history together.</p>

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
              autoComplete="new-password"
            />
          </label>

          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              name="confirm"
              value={form.confirm}
              onChange={handleChange}
              required
              autoComplete="new-password"
            />
          </label>

          <button className="btn btn-primary full-width" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="form-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
