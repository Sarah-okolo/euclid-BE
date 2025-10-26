import express from "express";
import crypto from "crypto";
import { PDFParse } from "pdf-parse";
import { upload } from "../middleware/upload.js";
import { getDB } from "../config/db.js";
import { processDocument } from "../services/rag.js";
import { validateBotConfig } from "../utils/validators.js";

const router = express.Router();

/**
 * POST /api/bots/create
 * Create a new bot and process its knowledge base (PDF).
 */
router.post("/create", upload.single("knowledgeBase"), async (req, res) => {
  const db = getDB();

  try {
    // --- Validation ---
    const error = validateBotConfig(req.body);
    if (error) return res.status(400).json({ status: "failed", error });
    if (!req.file)
      return res.status(400).json({ status: "failed", error: "No PDF file uploaded" });

    // --- Parse endpoint roles ---
    let parsedRoles = [];
    try {
      parsedRoles = JSON.parse(req.body.endpointRoles || "[]");
    } catch {
      parsedRoles = [];
    }

    // ✅ Always prefix bot ID with "euclid-bot-"
    const botId = `euclid-bot-${crypto.randomUUID()}`;
    const botsCollection = db.collection("bots");

    const botDoc = {
      botId, // prefixed ID
      businessName: req.body.businessName,
      botName: req.body.botName,
      botPersona: req.body.botPersona,
      defaultPrompt: req.body.defaultPrompt || "",
      apiBaseUrl: req.body.apiBaseUrl || "",
      endpointRoles: JSON.stringify(parsedRoles),
      authDomain: req.body.authDomain,
      authAudience: req.body.authAudience,
      authClientId: req.body.authClientId,
      rolesNamespace: req.body.rolesNamespace,
      embeddingStatus: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await botsCollection.insertOne(botDoc);
    console.log(`🧩 Creating bot ${botId}...`);

    // --- Extract text from PDF ---
    const parser = new PDFParse({ data: req.file.buffer });
    const textResult = await parser.getText();
    await parser.destroy();

    const pdfText = textResult.text?.trim() || "";
    if (!pdfText) {
      await botsCollection.updateOne(
        { botId },
        { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
      );
      console.error("❌ PDF extraction failed — no text found.");
      return res.status(400).json({ status: "failed", error: "Failed to extract text from PDF" });
    }

    console.log(`📄 Extracted ${pdfText.length} characters from ${req.file.originalname}`);

    // --- Process and upload to Pinecone ---
    const success = await processDocument(botId, pdfText, req.file.originalname);

    if (!success) {
      await botsCollection.updateOne(
        { botId },
        { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
      );
      console.error(`❌ Embedding or Pinecone ingestion failed for bot ${botId}`);
      return res.status(500).json({ status: "failed", error: "Failed to process document" });
    }

    await botsCollection.updateOne(
      { botId },
      { $set: { embeddingStatus: "complete", updatedAt: new Date() } }
    );

    console.log(`✅ Bot ${botId} created and knowledge base processed successfully.`);
    return res.json({ botId, status: "complete" });
  } catch (err) {
    console.error("❌ Error creating bot:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Internal server error",
    });
  }
});

/**
 * GET /api/bots/:botId
 * Retrieve bot configuration
 */
router.get("/:botId", async (req, res) => {
  const db = getDB();
  console.log("Fetching bot details");

  try {
    const bot = await db
      .collection("bots")
      .findOne({ botId: req.params.botId }, { projection: { _id: 0 } });

    if (!bot)
      return res.status(404).json({ status: "failed", error: "Bot not found" });

    return res.json({ status: "success", bot });
  } catch (err) {
    console.error("❌ Error fetching bot:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

/**
 * PUT /api/bots/:botId
 * Update bot configuration and optionally re-upload its knowledge base.
 */
router.put("/:botId", upload.single("knowledgeBase"), async (req, res) => {
  console.log("Fetching bot for update:", req.params.botId);
  const db = getDB();

  try {
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId: req.params.botId });
    console.log("Updating bot:", req.params.botId);

    if (!bot)
      return res.status(404).json({ status: "failed", error: "Bot not found" });

    const error = validateBotConfig(req.body, { update: true });
    if (error)
      return res.status(400).json({ status: "failed", error });

    // --- Parse endpoint roles ---
    let parsedRoles = [];
    try {
      parsedRoles = JSON.parse(req.body.endpointRoles || "[]");
    } catch {
      parsedRoles = [];
    }

    const updateData = {
      businessName: req.body.businessName || bot.businessName,
      botName: req.body.botName || bot.botName,
      botPersona: req.body.botPersona || bot.botPersona,
      defaultPrompt: req.body.defaultPrompt || bot.defaultPrompt,
      apiBaseUrl: req.body.apiBaseUrl || bot.apiBaseUrl,
      endpointRoles: JSON.stringify(parsedRoles),
      authDomain: req.body.authDomain || bot.authDomain,
      authAudience: req.body.authAudience || bot.authAudience,
      rolesNamespace: req.body.rolesNamespace || bot.rolesNamespace,
      updatedAt: new Date(),
    };

    // --- If new PDF is provided, re-process ---
    if (req.file) {
      console.log(`🔁 Reprocessing bot ${req.params.botId} with new PDF...`);

      const parser = new PDFParse({ data: req.file.buffer });
      const textResult = await parser.getText();
      await parser.destroy();

      const pdfText = textResult.text?.trim() || "";
      if (!pdfText) {
        await botsCollection.updateOne(
          { botId: req.params.botId },
          { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
        );
        console.error("❌ New PDF extraction failed — no text found.");
        return res.status(400).json({
          status: "failed",
          error: "Failed to extract text from new PDF file",
        });
      }

      await botsCollection.updateOne(
        { botId: req.params.botId },
        { $set: { embeddingStatus: "pending", updatedAt: new Date() } }
      );

      const success = await processDocument(req.params.botId, pdfText, req.file.originalname);

      if (!success) {
        await botsCollection.updateOne(
          { botId: req.params.botId },
          { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
        );
        console.error(`❌ Re-ingestion failed for bot ${req.params.botId}`);
        return res.status(500).json({ status: "failed", error: "Document processing failed" });
      }

      updateData.embeddingStatus = "complete";
      console.log(`✅ Bot ${req.params.botId} successfully re-processed.`);
    }

    await botsCollection.updateOne({ botId: req.params.botId }, { $set: updateData });
    return res.json({ status: "success", botId: req.params.botId });
  } catch (err) {
    console.error("❌ Error updating bot:", err);
    return res.status(500).json({
      status: "failed",
      error: err.message || "Internal server error",
    });
  }
});

export default router;