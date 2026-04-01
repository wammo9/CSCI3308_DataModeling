import { useEffect, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:5001";

function App() {
  const [status, setStatus] = useState("Loading API status...");
  const [features, setFeatures] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [healthResponse, featuresResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/api/health`),
          fetch(`${apiBaseUrl}/api/features`)
        ]);

        const health = await healthResponse.json();
        const featureList = await featuresResponse.json();

        setStatus(health.message);
        setFeatures(featureList);
      } catch (error) {
        setStatus("Unable to reach the API. Start the Docker services to connect the stack.");
        setFeatures([]);
      }
    }

    loadData();
  }, []);

  return (
    <>
    <nav className="navbar">
      <div>ModelScope</div>
      <div>
        <a href="/">Home</a>
        <a href="/projects">Projects</a>
        <a href="/upload">Upload</a>
      </div>
    </nav>
    
    <main className="app-shell">
          
      <section className="hero">
        <p className="eyebrow">CSCI 3308</p>
        <h1>ModelScope</h1>
        <p className="lead">
          An Express and React starter for turning CSV uploads into approachable
          data modeling workflows.
        </p>
        <div className="status-card">
          <span className="status-label">API status</span>
          <strong>{status}</strong>
        </div>
      </section>

      <section className="feature-panel">
        <h2>Starter feature map</h2>
        <ul>
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    </main>
    </>
  );
}

export default App;
