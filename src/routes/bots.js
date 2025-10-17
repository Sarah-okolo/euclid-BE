// src/routes/bots.js
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
 * Handles bot configuration and RAG ingestion in one synchronous pipeline.
 */
router.post("/create", upload.single("knowledgeBase"), async (req, res) => {
  const db = getDB();

  try {
    const error = validateBotConfig(req.body);
    if (error) return res.status(400).json({ status: "failed", error });

    if (!req.file)
      return res.status(400).json({ status: "failed", error: "No PDF file uploaded" });

    let parsedRoles = [];
    try {
      parsedRoles = JSON.parse(req.body.endpointRoles || "[]");
    } catch {
      parsedRoles = [];
    }

    const botId = crypto.randomUUID();
    const botsCollection = db.collection("bots");

    const botDoc = {
      botId,
      businessName: req.body.businessName,
      botName: req.body.botName,
      botPersona: req.body.botPersona,
      defaultPrompt: req.body.defaultPrompt || "",
      apiBaseUrl: req.body.apiBaseUrl || "",
      endpointRoles: JSON.stringify(parsedRoles),
      authDomain: req.body.authDomain,
      authAudience: req.body.authAudience,
      rolesNamespace: req.body.rolesNamespace,
      embeddingStatus: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await botsCollection.insertOne(botDoc);

    // ✅ Updated PDF parsing using new pdf-parse API
    const parser = new PDFParse({ data: req.file.buffer });
    const textResult = await parser.getText();
    await parser.destroy();

    const pdfText = textResult.text?.trim() || "";
    if (!pdfText) {
      await botsCollection.updateOne(
        { botId },
        { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
      );
      return res.status(400).json({ status: "failed", error: "Failed to extract text" });
    }

    const success = await processDocument(botId, pdfText, req.file.originalname);
    // console.log("🚀pdf text extracted", pdfText, "👀from", req.file.originalname)

    if (!success) {
      await botsCollection.updateOne(
        { botId },
        { $set: { embeddingStatus: "failed", updatedAt: new Date() } }
      );
      return res.status(500).json({ status: "failed", error: "Failed to process document" });
    }

    await botsCollection.updateOne(
      { botId },
      { $set: { embeddingStatus: "complete", updatedAt: new Date() } }
    );

    return res.json({ botId, status: "complete" });
  } catch (err) {
    console.error("Error creating bot:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

/**
 * GET /api/bots/:botId
 * Retrieve bot configuration
 */
router.get("/:botId", async (req, res) => {
  const db = getDB();
  try {
    const bot = await db.collection("bots").findOne(
      { botId: req.params.botId },
      { projection: { _id: 0 } }
    );

    if (!bot) return res.status(404).json({ status: "failed", error: "Bot not found" });

    return res.json({ status: "success", bot });
  } catch (err) {
    console.error("Error fetching bot:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

/**
 * PUT /api/bots/:botId
 * Update bot configuration (optional PDF re-upload)
 */
router.put("/:botId", upload.single("knowledgeBase"), async (req, res) => {
  const db = getDB();
  try {
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId: req.params.botId });

    if (!bot) return res.status(404).json({ status: "failed", error: "Bot not found" });

    const error = validateBotConfig(req.body, { update: true });
    if (error) return res.status(400).json({ status: "failed", error });

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

    // ✅ Updated PDF re-processing using new pdf-parse API
    if (req.file) {
      const parser = new PDFParse({ data: req.file.buffer });
      const textResult = await parser.getText();
      await parser.destroy();

      const pdfText = textResult.text?.trim() || "";

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
        return res.status(500).json({ status: "failed", error: "Failed to process document" });
      }

      updateData.embeddingStatus = "complete";
    }

    await botsCollection.updateOne({ botId: req.params.botId }, { $set: updateData });

    return res.json({ status: "success", botId: req.params.botId });
  } catch (err) {
    console.error("Error updating bot:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

export default router;
