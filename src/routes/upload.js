// src/routes/upload.js
import express from "express";
import pdfParse from "pdf-parse";
import { upload } from "../middleware/upload.js";
import { processDocument } from "../services/rag.js";
import { getDB } from "../config/db.js";

const router = express.Router();

/**
 * POST /api/upload
 * Handles bot knowledge base file upload (PDF)
 */
router.post("/", upload.single("knowledgeBase"), async (req, res) => {
  try {
    const { botId } = req.body;
    const file = req.file;

    if (!botId || !file) {
      return res.status(400).json({
        status: "failed",
        error: "Missing botId or file",
      });
    }

    // Extract text from PDF
    const pdfData = await pdfParse(file.buffer);
    const extractedText = pdfData.text?.trim();

    if (!extractedText) {
      return res.status(400).json({
        status: "failed",
        error: "Failed to extract text from file",
      });
    }

    // Process and embed document
    const success = await processDocument(botId, extractedText, file.originalname);

    if (!success) {
      return res.status(500).json({
        status: "failed",
        error: "Document processing failed",
      });
    }

    return res.json({
      botId,
      status: "complete",
    });
  } catch (err) {
    console.error("Error in /api/upload:", err);
    return res.status(500).json({
      status: "failed",
      error: "Internal server error",
    });
  }
});

export default router;
