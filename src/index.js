// src/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import chatRouter from "./routes/chat.js";
import botsRouter from "./routes/bots.js";
import proxyRouter from "./routes/proxy.js";
import uploadRouter from "./routes/upload.js";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" })); // user prompts etc.
app.use(express.urlencoded({ extended: true }));

// Health route
app.get("/", (req, res) => {
  res.send("Agentic Chatbot Backend is running 🚀");
});

// Mount routes BEFORE server starts
app.use("/api/chat", chatRouter);
app.use("/api/bots", botsRouter);
app.use("/api/upload", uploadRouter);

// Connect DB and start server
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
