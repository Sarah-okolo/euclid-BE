// src/upsert-test.js
import dotenv from "dotenv";
import { pinecone } from "./config/pinecone.js";

dotenv.config();
console.log("index name:", process.env.PINECONE_INDEX);

const index = pinecone.index(process.env.PINECONE_INDEX, process.env.PINECONE_INDEX_HOST);
const ns = index.namespace("demo-test");

await ns.upsertRecords([
  { _id: "rec3", text: "Instagram now supports integrated status resharing!" },
]);

console.log("✅ Upserted record successfully.");

const results = await ns.searchRecords({
  query: {
    id: "rec2", 
    topK: 3
  }
});
console.log("🔍 Query results:", results.result?.hits[0]);
