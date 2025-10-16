// src/config/db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);
let db;

export async function connectDB() {
  try {
    if (!db) {
      await client.connect();
      db = client.db(); // default DB from connection string
      console.log("✅ MongoDB connected successfully");
    }
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    throw err;
  }
}

export function getDB() {
  if (!db) throw new Error("Database not initialized. Call connectDB() first.");
  return db;
}
