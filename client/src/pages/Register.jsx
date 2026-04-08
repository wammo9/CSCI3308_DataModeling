import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { setToken } from "../App";

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
    <main className="app-shell centered">
      <div className="card form-card">
        <p className="eyebrow">ModelScope</p>
        <h2>Create an account</h2>

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
            {loading ? "Creating account…" : "Register"}
          </button>
        </form>

        <p className="form-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
