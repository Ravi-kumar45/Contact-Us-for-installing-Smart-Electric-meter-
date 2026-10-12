// server.js - स्मार्ट मीटर सेवा backend
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DATA_FILE = path.join(__dirname, "data", "leads.json");

const app = express();
let useMongo = false; // true sirf tab jab MongoDB se connection ho jaye

// ---------- Middleware ----------
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Website files (index.html, style.css, script.js, suraj.jpeg) public folder se
app.use(express.static(path.join(__dirname, "public")));

// ---------- Lead model (MongoDB) ----------
const SERVICE_TYPES = ["new-meter", "info", "other"];

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    mobile: { type: String, required: true, match: /^[6-9]\d{9}$/ },
    address: { type: String, required: true, trim: true, minlength: 10, maxlength: 300 },
    serviceType: { type: String, required: true, enum: SERVICE_TYPES },
    message: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["new", "contacted", "done"], default: "new" },
    ip: String,
  },
  { timestamps: true }
);

const Lead = mongoose.model("Lead", leadSchema);

// ---------- Helpers ----------
const clean = (value, max) => String(value ?? "").trim().slice(0, max);

const normalizeMobile = (value) =>
  String(value ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

function validateLead(body) {
  const data = {
    name: clean(body.name, 80),
    mobile: normalizeMobile(body.mobile),
    address: clean(body.address, 300),
    serviceType: clean(body.serviceType, 20),
    message: clean(body.message, 1000),
  };

  const errors = {};
  if (data.name.length < 2) errors.name = "कृपया अपना पूरा नाम लिखें।";
  if (!/^[6-9]\d{9}$/.test(data.mobile)) errors.mobile = "कृपया 10 अंकों का सही मोबाइल नंबर लिखें।";
  if (data.address.length < 10) errors.address = "कृपया पूरा पता लिखें।";
  if (!SERVICE_TYPES.includes(data.serviceType)) errors.serviceType = "कृपया सेवा चुनें।";

  return { data, errors };
}

// ---------- Storage: MongoDB ya data/leads.json ----------
let writeQueue = Promise.resolve();

// Ek saath kai form submit hon to file ek-ek karke likhi jaye
function queueWrite(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

async function readJsonLeads() {
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    return text.trim() ? JSON.parse(text) : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function saveLead(data) {
  if (useMongo) {
    return Lead.create(data);
  }

  return queueWrite(async () => {
    const leads = await readJsonLeads();
    const lead = {
      _id: crypto.randomUUID(),
      ...data,
      status: "new",
      createdAt: new Date().toISOString(),
    };
    leads.push(lead);
    await fs.writeFile(DATA_FILE, JSON.stringify(leads, null, 2), "utf8");
    return lead;
  });
}

async function listLeads() {
  if (useMongo) {
    return Lead.find().sort({ createdAt: -1 }).limit(200).lean();
  }
  const leads = await readJsonLeads();
  return leads.slice().reverse().slice(0, 200); // naye leads pehle
}

// ---------- Rate limit: 10 minute mein ek IP se max 5 submissions ----------
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;
const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_HITS) {
    return res.status(429).json({
      ok: false,
      message: "बहुत ज़्यादा कोशिशें हो गईं। कृपया कुछ देर बाद फिर कोशिश करें।",
    });
  }

  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

// Purane IP records saaf karein taaki memory na bhare
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}, WINDOW_MS).unref();

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, storage: useMongo ? "mongodb" : "data/leads.json" });
});

// script.js isi route par form bhejta hai
app.post("/api/lead", rateLimit, async (req, res) => {
  const body = req.body || {};

  // Honeypot: asli visitor hidden "website" field nahi bharta, bot bharta hai
  if (body.website) {
    return res.status(201).json({ ok: true, message: "धन्यवाद! आपका आवेदन मिल गया है।" });
  }

  const { data, errors } = validateLead(body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors, message: "कृपया जानकारी जांचें।" });
  }

  try {
    await saveLead({ ...data, ip: req.ip });
    res.status(201).json({
      ok: true,
      message: "धन्यवाद! आपका आवेदन मिल गया है। हम जल्द ही आपसे संपर्क करेंगे।",
    });
  } catch (err) {
    console.error("Lead save error:", err.message);
    res.status(500).json({
      ok: false,
      message: "सर्वर में दिक्कत है। कृपया WhatsApp पर संपर्क करें।",
    });
  }
});

// Admin: latest 200 leads. Header "x-admin-key" mein .env wali ADMIN_KEY bhejein
app.get("/api/leads", async (req, res) => {
  if (!ADMIN_KEY || req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  try {
    const leads = await listLeads();
    res.json({ ok: true, storage: useMongo ? "mongodb" : "data/leads.json", count: leads.length, leads });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, message: "Route not found" });
});

// Bad JSON ya dusri request errors
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ ok: false, message: "Invalid request" });
});

// ---------- Start ----------
async function start() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      useMongo = true;
      console.log("✅ MongoDB connected");
    } catch (err) {
      console.error("⚠️  MongoDB connect nahi hua:", err.message);
    }
  } else {
    console.log("ℹ️  .env mein MONGODB_URI khali hai.");
  }

  if (!useMongo) {
    console.log("📁 Leads ye file mein save honge: data/leads.json");
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server chal raha hai: http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("❌ Server start nahi ho paya:", err.message);
  process.exit(1);
});