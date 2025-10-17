// src/middleware/upload.js
import multer from "multer";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const MAX_FILE_SIZE = parseInt(process.env.MAX_PDF_SIZE) || 3 * 1024 * 1024; // default 3MB

const storage = multer.memoryStorage(); // store in memory for direct processing

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== ".pdf") {
    return cb(new Error("Only PDF files are allowed"), false);
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});
