import { Pinecone } from "@pinecone-database/pinecone";
const pinecone = new Pinecone({ apiKey: "pcsk_3TvzEa_FfvTUK8tNGDAYHBv49MRe5UvCXguURQYV1MmXqrsWwEr3Adm3NVpHynDSNUbCeq" });
const index = pinecone.index("euclid-bots-index");
const stats = await index.describeIndexStats();
console.log(stats);
