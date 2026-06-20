require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
const admin = require("firebase-admin");

// ============ FIREBASE INITIALIZATION ============
// Load service account from JSON file (download from Firebase Console)
let db;
let auth;

try {
  const serviceAccount = require("./serviceAccountKey.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  auth = admin.auth();
  console.log("✅ Firebase initialized successfully!");
} catch (error) {
  console.error("❌ Firebase initialization error:", error.message);
  console.log("⚠️ Make sure serviceAccountKey.json is in the same folder as server.js");
}

// Firestore collection names
const USERS_COLLECTION = "users";
const DESIGNS_COLLECTION = "designs";
const CONTACTS_COLLECTION = "contacts";

// ============ EXPRESS SETUP ============
const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed."));
    cb(null, true);
  },
});

const fs = require("fs");
const crypto = require("crypto");

const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

for (const dir of [GENERATED_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function saveDataUrl(dataUrl, folder, prefix = "image") {
  if (!dataUrl || !String(dataUrl).startsWith("data:image")) return dataUrl || "";
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const ext = match[1].includes("jpeg") ? "jpg" : match[1].split("/")[1].replace("svg+xml", "svg");
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const targetDir = folder === "uploads" ? UPLOADS_DIR : GENERATED_DIR;
  fs.writeFileSync(path.join(targetDir, filename), Buffer.from(match[2], "base64"));
  return `/${folder === "uploads" ? "uploads" : "generated"}/${filename}`;
}

function saveUploadedFile(file) {
  if (!file) return "";
  if (!file.mimetype.startsWith("image/")) throw new Error("Only image uploads are allowed.");
  const ext = file.mimetype.includes("jpeg") ? "jpg" : file.mimetype.split("/")[1];
  const filename = `room_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
  return `/uploads/${filename}`;
}

// ============ AUTH MIDDLEWARE ============
async function authOptional(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  if (token && auth) {
    try {
      const decodedToken = await auth.verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email?.split("@")[0],
      };
    } catch (error) {
      console.error("Auth error:", error.message);
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  if (!token || !auth) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }
  
  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split("@")[0],
    };
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

// Rate limiting
const requestLog = new Map();
function rateLimit(maxRequests = 25, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const key = req.ip || req.headers["x-forwarded-for"] || "local";
    const now = Date.now();
    const entry = requestLog.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    requestLog.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ ok: false, error: "Too many requests. Please wait and try again." });
    }
    next();
  };
}

// ============ AI GENERATION (unchanged) ============
const fallbackImages = [
  "/images/spacejoy-9M66C_w_ToM-unsplash.jpg",
  "/images/Gemini_Generated_Image_y3ecbdy3ecbdy3ec.png",
  "/images/jason-wang-NxAwryAbtIw-unsplash.jpg",
];

function formatError(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.error?.message ||
    error?.message ||
    "Unknown server error"
  );
}

function buildPrompt(body, hasUploadedImage = false) {
  const style = body.style || "modern";
  const color = body.color || "neutral";
  const shape = body.shape || "curved";
  const budget = body.budget || "not specified";
  const length = body.length || "not specified";
  const width = body.width || "not specified";
  const height = body.height || "not specified";
  const info = body.info || "Create a beautiful, practical home interior.";
  const roomType = body.roomType || "bedroom";
  const mood = body.mood || "cozy and elegant";
  const openings = body.openings || "not specified";

  return `Redesign the uploaded room into a realistic ${style} ${roomType} interior.

Very important:
- keep the same camera angle and room perspective
- keep the same room layout, ceiling shape, walls, doors, windows, and main structure
- transform the furniture, lighting, colours, storage, decor, and materials
- make it look like a real before and after interior design transformation
- do not create a random room
- do not change the room type

Room details:
Style: ${style}
Colour palette: ${color}
Furniture shapes: ${shape}
Budget level: EGP ${budget}
Room dimensions: ${length} x ${width} x ${height}
Doors and windows: ${openings}
Mood: ${mood}
Requirements: ${info}

Final image requirements:
photorealistic, realistic home interior, high quality render, elegant materials, warm lighting, practical layout, no people, no logos, no text, no watermark.`;
}


function buildEditPrompt(body) {
  const editPrompt = body.editPrompt || "Improve the generated design.";
  const previousPrompt = body.previousPrompt || "No previous prompt was provided.";
  const data = body.designData || {};

  return `Create a new edited version of this AI interior design result.

Keep the same room concept and overall project direction, but apply the user's requested changes clearly.

Original design context:
Room type: ${data.roomType || "not specified"}
Style: ${data.style || "not specified"}
Colour palette: ${data.color || "not specified"}
Furniture shapes: ${data.shape || "not specified"}
Mood: ${data.mood || "not specified"}
Budget level: EGP ${data.budget || "not specified"}
Previous requirements: ${data.info || "not specified"}

Previous prompt:
${previousPrompt}

User edit request:
${editPrompt}

Final image requirements:
photorealistic, realistic home interior, high quality render, elegant materials, warm lighting, practical layout, no people, no logos, no text, no watermark.`;
}

function selectedProvider() {
  return (process.env.AI_PROVIDER || "pollinations").toLowerCase().trim();
}

function pollinationsUrl(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: process.env.IMAGE_WIDTH || "1024",
    height: process.env.IMAGE_HEIGHT || "1024",
    seed: String(seed || Date.now()),
    model: process.env.POLLINATIONS_MODEL || "flux",
    nologo: "true",
    private: "true",
    enhance: "true",
  });

  if (process.env.POLLINATIONS_API_KEY) {
    params.set("token", process.env.POLLINATIONS_API_KEY);
  }

  return `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
}

async function generateWithPollinations(prompt) {
  const seed = Date.now();
  const imageUrl = pollinationsUrl(prompt, seed);

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("Pollinations failed to generate image");
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    imageUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    provider: "pollinations",
  };
}

async function generateWithOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("your-key")) {
    throw new Error("OPENAI_API_KEY is missing. Use AI_PROVIDER=pollinations for free generation, or add a valid OpenAI key.");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await openai.images.generate({
    model: process.env.IMAGE_MODEL || "dall-e-3",
    prompt,
    size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
  });

  const firstImage = result?.data?.[0];
  if (firstImage?.b64_json) {
    return {
      imageUrl: `data:image/png;base64,${firstImage.b64_json}`,
      provider: "openai",
    };
  }

  if (firstImage?.url) {
    return { imageUrl: firstImage.url, provider: "openai" };
  }

  throw new Error("OpenAI did not return an image.");
}

async function generateWithHuggingFace(prompt) {
  if (!process.env.HF_TOKEN || process.env.HF_TOKEN.includes("your-token")) {
    throw new Error("HF_TOKEN is missing. Create a Hugging Face token, or use AI_PROVIDER=pollinations.");
  }

  const model = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    let message = buffer.toString("utf8");
    try { message = JSON.parse(message).error || message; } catch {}
    throw new Error(`Hugging Face generation failed: ${message}`);
  }

  return {
    imageUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    provider: "huggingface",
  };
}

async function generateImage(prompt) {
  const provider = selectedProvider();
  if (provider === "openai") return generateWithOpenAI(prompt);
  if (provider === "huggingface" || provider === "hf") return generateWithHuggingFace(prompt);
  return generateWithPollinations(prompt);
}

// ============ EXPRESS ROUTES ============
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend with Firebase is working", provider: selectedProvider() });
});

app.get("/api/pollinations-image", async (req, res) => {
  try {
    const prompt = req.query.prompt;
    if (!prompt) return res.status(400).send("Missing prompt");

    const imageResponse = await fetch(pollinationsUrl(prompt, req.query.seed));
    if (!imageResponse.ok) {
      const details = await imageResponse.text();
      throw new Error(details || `Pollinations returned ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  } catch (error) {
    console.error("Pollinations proxy error:", formatError(error));
    res.status(500).send("Image generation failed. Please try again.");
  }
});

// ============ FIREBASE AUTH ROUTES ============
app.post("/api/signup", rateLimit(8, 10 * 60 * 1000), async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: "Name, email, and password are required." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
  }

  try {
    const userRecord = await auth.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      displayName: String(name).trim(),
    });

    // Store user data in Firestore
    await db.collection(USERS_COLLECTION).doc(userRecord.uid).set({
      uid: userRecord.uid,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      createdAt: new Date().toISOString(),
    });

    const customToken = await auth.createCustomToken(userRecord.uid);

    res.json({
      ok: true,
      token: customToken,
      user: {
        uid: userRecord.uid,
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
      },
      message: "Account created successfully.",
    });
  } catch (error) {
    console.error("Signup error:", error);
    if (error.code === "auth/email-already-exists") {
      return res.status(409).json({ ok: false, error: "An account with this email already exists." });
    }
    res.status(500).json({ ok: false, error: error.message || "Failed to create account." });
  }
});

app.post("/api/login", rateLimit(12, 10 * 60 * 1000), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email and password are required." });
  }

  try {
    const userRecord = await auth.getUserByEmail(String(email).trim().toLowerCase());
    const customToken = await auth.createCustomToken(userRecord.uid);
    
    // Get user data from Firestore
    const userDoc = await db.collection(USERS_COLLECTION).doc(userRecord.uid).get();
    const userData = userDoc.exists ? userDoc.data() : { name: userRecord.displayName || email.split("@")[0] };
    
    res.json({
      ok: true,
      token: customToken,
      user: {
        uid: userRecord.uid,
        name: userData.name || userRecord.displayName,
        email: userRecord.email,
      },
      message: "Logged in successfully.",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(401).json({ ok: false, error: "Invalid email or password." });
  }
});

app.post("/api/logout", authRequired, async (req, res) => {
  // Firebase tokens are stateless - just return success
  res.json({ ok: true, message: "Logged out successfully." });
});

app.get("/api/me", authRequired, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ============ FIREBASE FIRESTORE ROUTES ============
app.get("/api/designs", authRequired, async (req, res) => {
  try {
    console.log("=== DESIGNS API CALLED ===");
    console.log("User UID:", req.user.uid);
    
    // First, let's check if the designs collection exists and has data
    const allDocsSnapshot = await db.collection(DESIGNS_COLLECTION).get();
    console.log(`Total designs in collection: ${allDocsSnapshot.size}`);
    
    allDocsSnapshot.forEach((doc) => {
      console.log(`Design ID: ${doc.id}, UserId: ${doc.data().userId}`);
    });
    
    // Now get designs for this specific user
    const designsSnapshot = await db
      .collection(DESIGNS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .get();
    
    console.log(`Designs found for user ${req.user.uid}: ${designsSnapshot.size}`);
    
    const designs = [];
    designsSnapshot.forEach((doc) => {
      designs.push({ id: doc.id, ...doc.data() });
    });
    
    res.json({ ok: true, designs });
  } catch (error) {
    console.error("ERROR in /api/designs:", error.message);
    console.error("Full error:", error);
    res.status(500).json({ ok: false, error: error.message, stack: error.stack });
  }
});

app.post("/api/designs", authRequired, async (req, res) => {
  const body = req.body || {};
  if (!body.imageUrl) {
    return res.status(400).json({ ok: false, error: "Design image is required." });
  }
  
  try {
    const design = {
      userId: req.user.uid,
      createdAt: new Date().toISOString(),
      imageUrl: saveDataUrl(body.imageUrl, "generated", "design"),
      beforeImage: saveDataUrl(body.beforeImage, "uploads", "before"),
      prompt: body.prompt || "",
      provider: body.provider || "AI provider",
      style: body.style || "",
      color: body.color || "",
      shape: body.shape || "",
      roomType: body.roomType || "",
      mood: body.mood || "",
      budget: body.budget || "",
      favourite: Boolean(body.favourite),
      notes: body.notes || "",
      demo: Boolean(body.demo),
    };
    
    const docRef = await db.collection(DESIGNS_COLLECTION).add(design);
    design.id = docRef.id;
    
    res.json({ ok: true, design });
  } catch (error) {
    console.error("Save design error:", error);
    res.status(500).json({ ok: false, error: "Failed to save design." });
  }
});

app.patch("/api/designs/:id", authRequired, async (req, res) => {
  try {
    const designRef = db.collection(DESIGNS_COLLECTION).doc(req.params.id);
    const designDoc = await designRef.get();
    
    if (!designDoc.exists || designDoc.data().userId !== req.user.uid) {
      return res.status(404).json({ ok: false, error: "Design not found." });
    }
    
    const updates = {};
    if (typeof req.body.favourite === "boolean") updates.favourite = req.body.favourite;
    if (typeof req.body.notes === "string") updates.notes = req.body.notes;
    
    await designRef.update(updates);
    
    res.json({ ok: true, design: { id: req.params.id, ...designDoc.data(), ...updates } });
  } catch (error) {
    console.error("Update design error:", error);
    res.status(500).json({ ok: false, error: "Failed to update design." });
  }
});

app.delete("/api/designs/:id", authRequired, async (req, res) => {
  try {
    const designRef = db.collection(DESIGNS_COLLECTION).doc(req.params.id);
    const designDoc = await designRef.get();
    
    if (!designDoc.exists || designDoc.data().userId !== req.user.uid) {
      return res.status(404).json({ ok: false, error: "Design not found." });
    }
    
    await designRef.delete();
    
    res.json({ ok: true, message: "Design deleted." });
  } catch (error) {
    console.error("Delete design error:", error);
    res.status(500).json({ ok: false, error: "Failed to delete design." });
  }
});

// ============ GENERATE ENDPOINT (UPDATED FOR FIREBASE) ============
app.post("/api/generate", authOptional, rateLimit(20, 15 * 60 * 1000), upload.single("image"), async (req, res) => {
  const body = req.body || {};
  const required = ["style", "color", "shape"];
  const missing = required.filter((key) => !body[key]);

  if (!req.file) missing.push("room photo");

  if (missing.length) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields",
      details: `Please fill: ${missing.join(", ")}`,
    });
  }

  const prompt = buildPrompt(body, Boolean(req.file));

  try {
    const generated = await generateImage(prompt);
    const beforeImage = saveUploadedFile(req.file);
    let savedDesign = null;
    let responseImageUrl = generated.imageUrl;

    if (req.user) {
      responseImageUrl = saveDataUrl(generated.imageUrl, "generated", "design");
      
      const designData = {
        userId: req.user.uid,
        createdAt: new Date().toISOString(),
        imageUrl: responseImageUrl,
        beforeImage,
        prompt,
        provider: generated.provider,
        style: body.style,
        color: body.color,
        shape: body.shape,
        roomType: body.roomType,
        mood: body.mood,
        budget: body.budget,
        favourite: false,
        notes: "",
        demo: false,
      };
      
      const docRef = await db.collection(DESIGNS_COLLECTION).add(designData);
      savedDesign = { id: docRef.id, ...designData };
    }

    return res.json({
      ok: true,
      demo: false,
      provider: generated.provider,
      imageUrl: responseImageUrl,
      beforeImage,
      design: savedDesign,
      prompt,
      message: `Generated successfully using ${generated.provider}.`,
    });
  } catch (error) {
    const details = formatError(error);
    console.error("Image generation error:", details);

    if (process.env.USE_DEMO_FALLBACK === "true") {
      return res.json({
        ok: true,
        demo: true,
        provider: "fallback",
        imageUrl: fallbackImages[0],
        prompt,
        message: `Fallback image used because AI generation failed: ${details}`,
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Image generation failed",
      details,
    });
  }
});


// ============ EDIT GENERATED RESULT ENDPOINT ============
app.post("/api/edit-generate", authOptional, rateLimit(20, 15 * 60 * 1000), async (req, res) => {
  const body = req.body || {};

  if (!body.editPrompt) {
    return res.status(400).json({
      ok: false,
      error: "Missing edit instructions",
      details: "Please write the details you want to change.",
    });
  }

  const prompt = buildEditPrompt(body);

  try {
    const generated = await generateImage(prompt);
    let responseImageUrl = generated.imageUrl;
    let savedDesign = null;

    if (req.user) {
      responseImageUrl = saveDataUrl(generated.imageUrl, "generated", "edited_design");
      const data = body.designData || {};
      const designData = {
        userId: req.user.uid,
        createdAt: new Date().toISOString(),
        imageUrl: responseImageUrl,
        beforeImage: data.beforeImage || "",
        prompt,
        provider: generated.provider,
        style: data.style || "",
        color: data.color || "",
        shape: data.shape || "",
        roomType: data.roomType || "",
        mood: data.mood || "",
        budget: data.budget || "",
        favourite: false,
        notes: `Edited with request: ${body.editPrompt}`,
        demo: false,
      };
      const docRef = await db.collection(DESIGNS_COLLECTION).add(designData);
      savedDesign = { id: docRef.id, ...designData };
    }

    return res.json({
      ok: true,
      demo: false,
      provider: generated.provider,
      imageUrl: responseImageUrl,
      design: savedDesign,
      prompt,
      message: `Edited design generated successfully using ${generated.provider}.`,
    });
  } catch (error) {
    const details = formatError(error);
    console.error("Edit image generation error:", details);

    if (process.env.USE_DEMO_FALLBACK === "true") {
      return res.json({
        ok: true,
        demo: true,
        provider: "fallback",
        imageUrl: fallbackImages[0],
        prompt,
        message: `Fallback image used because edit generation failed: ${details}`,
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Edit generation failed",
      details,
    });
  }
});

// ============ CONTACT ENDPOINT (FIRESTORE) ============
app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: "Please fill all contact fields." });
  }
  
  try {
    await db.collection(CONTACTS_COLLECTION).add({
      name,
      email,
      message,
      createdAt: new Date().toISOString(),
    });
    
    console.log("Contact request saved to Firestore:", { name, email, message });
    res.json({ ok: true, message: "Message received. We will contact you soon." });
  } catch (error) {
    console.error("Contact save error:", error);
    res.status(500).json({ ok: false, error: "Failed to save message." });
  }
});

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔥 Firebase: ${db ? "CONNECTED ✅" : "NOT CONNECTED ❌"}`);
  console.log(`🤖 AI provider: ${selectedProvider()}`);
  console.log(`📱 Open: http://localhost:${PORT}/generate.html\n`);
});