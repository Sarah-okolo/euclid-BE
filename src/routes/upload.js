// src/routes/upload.js
import express from "express";
import { PDFParse } from "pdf-parse";
import { upload } from "../middleware/upload.js";
import { processDocument } from "../services/rag.js";
import { getDB } from "../config/db.js";

const router = express.Router();

/**
 * POST /api/upload
 * Upload and process a knowledge base PDF for an existing bot.
 */
router.post("/", upload.single("knowledgeBase"), async (req, res) => {
  const db = getDB();

  try {
    const { botId } = req.body;
    const file = req.file;

    if (!botId || !file) {
      return res.status(400).json({
        status: "failed",
        error: "Missing botId or file",
      });
    }

    // Check if the bot exists before processing
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId });
    if (!bot) {
      return res.status(404).json({
        status: "failed",
        error: "Bot not found",
      });
    }

    console.log(`📤 Upload: Received new knowledge base for bot ${botId} (${file.originalname})`);

    // Parse PDF text
    const parser = new PDFParse({ data: file.buffer });
    const textResult = await parser.getText();
    await parser.destroy();

    const extractedText = textResult.text?.trim() || "";
    if (!extractedText) {
      console.error("❌ Upload: No text extracted from file.");
      return res.status(400).json({
        status: "failed",
        error: "Failed to extract text from uploaded PDF",
      });
    }

    console.log(`📄 Upload: Extracted ${extractedText.length} characters from ${file.originalname}`);

    // Update status to pending before ingestion
    await botsCollection.updateOne(
      { botId },
      { $set: { embeddingStatus: "pending", updatedAt: new Date() } }
    );

    // Process document into Pinecone (native embedding)
    const success = await processDocument(botId, extractedText, file.originalname);

    if (!success) {
      await botsCollection.updateOne(
        { botId },
        { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
      );
      console.error(`❌ Upload: Pinecone ingestion failed for bot ${botId}`);
      return res.status(500).json({
        status: "failed",
        error: "Document processing failed",
      });
    }

    await botsCollection.updateOne(
      { botId },
      { $set: { embeddingStatus: "complete", updatedAt: new Date() } }
    );

    console.log(`✅ Upload: Knowledge base updated successfully for bot ${botId}`);
    return res.json({
      status: "success",
      botId,
      message: "Knowledge base uploaded and processed successfully.",
    });
  } catch (err) {
    console.error("❌ Error in /api/upload:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Internal server error",
    });
  }
});

export default router;
