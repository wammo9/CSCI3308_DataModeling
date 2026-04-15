import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Projects from "./pages/Projects";
import Visualize from "./pages/Visualize";
import Compare from "./pages/Compare";

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem("ms_token");
}

export function setToken(token) {
  localStorage.setItem("ms_token", token);
}

export function clearToken() {
  localStorage.removeItem("ms_token");
}

// ── Protected route wrapper ───────────────────────────────────────────────────

function Protected({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar() {
  const navigate = useNavigate();
  const loggedIn = !!getToken();

  function handleLogout() {
    clearToken();
    navigate("/login");
  }

  return (
    <nav className="navbar">
      <NavLink to={loggedIn ? "/projects" : "/"} className="navbar-brand">
        ModelScope
      </NavLink>
      <div className="navbar-links">
        {loggedIn ? (
          <>
            <NavLink to="/projects">Projects</NavLink>
            <NavLink to="/compare">Compare</NavLink>
            <button className="btn-link" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/register">Register</NavLink>
          </>
        )}
      </div>
    </nav>
  );
}

// ── Home page ─────────────────────────────────────────────────────────────────

function Home() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">CSCI 3308</p>
        <h1>ModelScope</h1>
        <p className="lead">
          Upload a CSV, run principal component analysis, and explore your data
          in an interactive 3-D scatter plot — all in the browser.
        </p>
        <div className="hero-actions">
          <NavLink to="/register" className="btn btn-primary">
            Get started
          </NavLink>
          <NavLink to="/login" className="btn btn-ghost">
            Sign in
          </NavLink>
        </div>
      </section>

      <section className="feature-panel">
        <h2>What ModelScope does</h2>
        <ul>
          <li>Upload CSV datasets with quantitative columns</li>
          <li>Automatically detects numeric features and removes invalid rows</li>
          <li>Suggests cleanup steps and recommended PCA presets before you run analysis</li>
          <li>Runs PCA and reduces to 2 or 3 principal components</li>
          <li>Displays an interactive 3-D scatter plot with explained variance</li>
          <li>Compares PCA runs side-by-side so you can judge preprocessing choices</li>
        </ul>
      </section>
    </main>
  );
}

// ── App / Router ──────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/projects"
          element={
            <Protected>
              <Projects />
            </Protected>
          }
        />
        <Route
          path="/visualize/:runId"
          element={
            <Protected>
              <Visualize />
            </Protected>
          }
        />
        <Route
          path="/compare"
          element={
            <Protected>
              <Compare />
            </Protected>
          }
        />
        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
