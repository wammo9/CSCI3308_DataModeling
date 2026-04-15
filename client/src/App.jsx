import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Projects from "./pages/Projects";
import Visualize from "./pages/Visualize";
import Compare from "./pages/Compare";
import BrandLockup from "./components/BrandLockup";

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
      <div className="navbar-inner">
        <NavLink to={loggedIn ? "/projects" : "/"} className="navbar-brand" aria-label="ModelScope home">
          <BrandLockup compact />
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
      </div>
    </nav>
  );
}

// ── Home page ─────────────────────────────────────────────────────────────────

function Home() {
  return (
    <main className="app-shell home-shell">
      <section className="card hero">
        <div className="hero-copy">
          <p className="eyebrow">Human-centered data modeling</p>
          <BrandLockup
            className="hero-brand"
            subtitle="Turn messy CSVs into clear PCA stories with a workflow that feels guided, calm, and trustworthy."
          />
          <h1>Explore structure without the chaos.</h1>
          <p className="lead">
            Upload a CSV, clean the rough edges, explore principal components,
            and compare runs with confidence in a workspace designed to feel warm,
            legible, and genuinely usable.
          </p>
          <div className="hero-actions">
            <NavLink to="/register" className="btn btn-primary">
              Start exploring
            </NavLink>
            <NavLink to="/login" className="btn btn-ghost">
              Sign in
            </NavLink>
          </div>
          <div className="tag-list hero-tags">
            <span className="tag">CSV upload</span>
            <span className="tag">PCA presets</span>
            <span className="tag">Run comparison</span>
          </div>
        </div>

        <div className="hero-panel">
          <p className="eyebrow">A calmer workflow</p>
          <div className="hero-stat-grid">
            <div className="hero-stat">
              <span className="meta-label">Upload</span>
              <strong>Bring in real CSVs</strong>
              <p>Start from your own data or a sample set when you want to move faster.</p>
            </div>
            <div className="hero-stat">
              <span className="meta-label">Refine</span>
              <strong>Clean with guidance</strong>
              <p>Use quality checks and recommended presets to reduce guesswork before PCA.</p>
            </div>
            <div className="hero-stat">
              <span className="meta-label">Compare</span>
              <strong>Understand what changed</strong>
              <p>Put PCA runs side-by-side so preprocessing choices feel transparent, not magical.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-grid">
        <article className="card feature-panel">
          <p className="eyebrow">What ModelScope does</p>
          <h2>Designed to make statistical exploration feel more humane.</h2>
          <ul className="feature-list">
            <li>Upload CSV datasets with quantitative columns.</li>
            <li>Detect numeric features and surface data quality issues early.</li>
            <li>Suggest cleanup steps and recommended PCA presets before you run analysis.</li>
            <li>Visualize 2D or 3D principal components with filtering, clustering, and point inspection.</li>
            <li>Compare PCA runs side-by-side to judge preprocessing choices with context.</li>
          </ul>
        </article>

        <article className="card feature-panel">
          <p className="eyebrow">Why it feels better</p>
          <h2>Structured for curiosity, not intimidation.</h2>
          <ol className="workflow-list">
            <li>
              <strong>Orient first.</strong>
              <span>Every page leads with the most important context so users know where they are and what to do next.</span>
            </li>
            <li>
              <strong>Guide decisions.</strong>
              <span>Quality signals, presets, and comparisons help users understand tradeoffs instead of clicking blindly.</span>
            </li>
            <li>
              <strong>Stay visually calm.</strong>
              <span>Warm surfaces, clear hierarchy, and consistent interactions keep the app analytical without feeling cold.</span>
            </li>
          </ol>
        </article>
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
