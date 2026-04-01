import cors from "cors";
import express from "express";

const app = express();
const port = process.env.PORT || 5001;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "modelscope-api",
    message: "Express server is running."
  });
});

app.get("/api/features", (_req, res) => {
  res.json([
    "Upload CSV datasets",
    "Generate automatic data models",
    "Organize saved modeling projects"
  ]);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
