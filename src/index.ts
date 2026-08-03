import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDB } from "./config/db";
import { seedDatabase } from "./data/seed";
import apiRouter from "./routes/api";
import authRouter from "./routes/auth";
import lawyersRouter from "./routes/lawyers";
import advocatesRouter from "./routes/advocates";
import consultationsRouter from "./routes/consultations";
import paymentsRouter from "./routes/payments";
import adminRouter from "./routes/admin";
import adminTeamsRouter from "./routes/admin-teams";
import adminGeminiKeysRouter from "./routes/admin-gemini-keys";
import feedbackRouter from "./routes/feedback";
import demoRequestsRouter from "./routes/demo-requests";
import sajilokanunAuthRouter from "./routes/sajilokanun-auth";
import internalRouter from "./routes/internal";
import referenceRouter from "./routes/reference";
import { processExpiredSelectedWindows } from "./services/consultationMatching";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "Nagarik Palika API" });
});

app.use("/api/auth", authRouter);
app.use("/api/lawyers", lawyersRouter);
app.use("/api/advocates", advocatesRouter);
app.use("/api/consultations", consultationsRouter);
app.use("/api/payments", paymentsRouter);
// Must mount before adminRouter / adminTeamsRouter (those apply requireAuth to all /api/admin/*).
app.use("/api/admin", adminGeminiKeysRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin", adminTeamsRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/demo-requests", demoRequestsRouter);
app.use("/api/sajilokanun-auth", sajilokanunAuthRouter);
app.use("/api/reference", referenceRouter);
app.use("/api", apiRouter);
app.use("/internal", internalRouter);

const CRON_INTERVAL_MS = 15 * 60 * 1000;

function startPoolCron() {
  setInterval(async () => {
    try {
      const count = await processExpiredSelectedWindows();
      if (count > 0) {
        console.log(`Open-pool cron: processed ${count} expired selected windows`);
      }
    } catch (err) {
      console.error("Open-pool cron error:", err);
    }
  }, CRON_INTERVAL_MS);
}

async function start() {
  await connectDB();
  await seedDatabase();
  startPoolCron();

  app.listen(PORT, () => {
    console.log(`Nagarik Palika API running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
