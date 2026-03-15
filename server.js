const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  GRUPO_ID: 'ID_DEL_GRUPO@g.us',       // ← reemplaza con el ID de tu grupo
  AUTO_LOCATION_HOURS: 4,               // pide ubicación cada 4 horas
  PORT: process.env.PORT || 3000,
  SOS_CONTACTS: [                       // números que reciben SOS directamente
    '5939XXXXXXXX@c.us',                // ← reemplaza con tus números
  ]
};

// ─── ALMACENAMIENTO ────────────────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'locations.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { locations: {}, history: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ─── WHATSAPP CLIENT ───────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  }
});

client.on('qr', qr => {
  console.log('\n📱 Escanea este QR con WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot familiar conectado!');
  startAutoLocationTimer();
});

// ─── MANEJO DE MENSAJES ────────────────────────────────────────────────────
client.on('message', async (msg) => {
  const text = msg.body.toLowerCase().trim();
  const contact = await msg.getContact();
  const name = contact.pushname || contact.number;

  // === UBICACIÓN EN TIEMPO REAL (compartida desde WhatsApp) ===
  if (msg.type === 'location') {
    const { latitude, longitude } = msg;
    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
    const timestamp = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });

    // Guardar en DB
    const db = loadDB();
    db.locations[name] = { latitude, longitude, timestamp, name };
    db.history.unshift({ name, latitude, longitude, timestamp, type: 'whatsapp' });
    if (db.history.length > 500) db.history = db.history.slice(0, 500);
    saveDB(db);

    // Reenviar al grupo con formato bonito
    const mensaje = `📍 *${name}* compartió su ubicación\n` +
                    `🕐 ${timestamp}\n` +
                    `🗺️ ${mapsLink}`;

    if (msg.from !== CONFIG.GRUPO_ID) {
      await client.sendMessage(CONFIG.GRUPO_ID, mensaje);
    }
    await msg.reply(`✅ Ubicación registrada y enviada al grupo familiar.`);
    return;
  }

  // === PALABRAS CLAVE: PEDIR UBICACIÓN ===
  const keywordsUbicacion = ['ubicacion', 'ubicación', 'donde estoy', 'dónde estoy', 'localizar'];
  if (keywordsUbicacion.some(k => text.includes(k))) {
    await msg.reply(
      `📍 *Compartir ubicación:*\n\n` +
      `1. Toca el clip 📎\n` +
      `2. Selecciona "Ubicación"\n` +
      `3. Elige "Compartir ubicación en tiempo real"\n\n` +
      `O abre la app familiar: ${process.env.APP_URL || 'http://localhost:3000'}/app.html`
    );
    return;
  }

  // === SOS - EMERGENCIA ===
  const keywordsSOS = ['sos', 'emergencia', 'ayuda', 'socorro', '🆘'];
  if (keywordsSOS.some(k => text.includes(k))) {
    const alertMsg = `🚨🚨🚨 *EMERGENCIA* 🚨🚨🚨\n\n` +
                     `⚠️ *${name}* necesita ayuda!\n` +
                     `📞 Número: ${msg.from.replace('@c.us', '')}\n` +
                     `🕐 ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}\n\n` +
                     `_Pídele que comparta su ubicación inmediatamente_`;

    // Enviar al grupo
    await client.sendMessage(CONFIG.GRUPO_ID, alertMsg);

    // Enviar a contactos SOS directos
    for (const contacto of CONFIG.SOS_CONTACTS) {
      try { await client.sendMessage(contacto, alertMsg); } catch (e) {}
    }

    await msg.reply(
      `🚨 *Alerta enviada al grupo familiar y contactos de emergencia.*\n\n` +
      `Por favor comparte tu ubicación ahora:\n` +
      `Clip 📎 → Ubicación → Compartir ubicación en tiempo real`
    );
    return;
  }

  // === HISTORIAL ===
  if (text === 'historial' || text === 'historia') {
    const db = loadDB();
    const recent = db.history.slice(0, 5);
    if (recent.length === 0) {
      await msg.reply('📭 No hay ubicaciones registradas aún.');
      return;
    }
    let reply = '📋 *Últimas ubicaciones:*\n\n';
    recent.forEach(loc => {
      reply += `👤 *${loc.name}*\n🕐 ${loc.timestamp}\n🗺️ https://maps.google.com/?q=${loc.latitude},${loc.longitude}\n\n`;
    });
    await msg.reply(reply);
    return;
  }

  // === VER FAMILIA (últimas ubicaciones) ===
  if (text === 'familia' || text === 'todos' || text === 'dónde están') {
    const db = loadDB();
    const locs = Object.values(db.locations);
    if (locs.length === 0) {
      await msg.reply('📭 Nadie ha compartido ubicación aún.');
      return;
    }
    let reply = '👨‍👩‍👧‍👦 *Ubicaciones de la familia:*\n\n';
    locs.forEach(loc => {
      reply += `📍 *${loc.name}*\n🕐 ${loc.timestamp}\n🗺️ https://maps.google.com/?q=${loc.latitude},${loc.longitude}\n\n`;
    });
    await msg.reply(reply);
    return;
  }

  // === AYUDA ===
  if (text === 'ayuda' || text === 'comandos' || text === 'help') {
    await msg.reply(
      `🤖 *Bot Familiar - Comandos:*\n\n` +
      `📍 *ubicacion* → Cómo compartir tu ubicación\n` +
      `👨‍👩‍👧‍👦 *familia* → Ver dónde está todos\n` +
      `📋 *historial* → Últimas 5 ubicaciones\n` +
      `🚨 *SOS* → Alerta de emergencia\n\n` +
      `💻 Dashboard: ${process.env.APP_URL || 'http://localhost:3000'}/dashboard.html`
    );
  }
});

// ─── AUTO-SOLICITAR UBICACIÓN CADA X HORAS ─────────────────────────────────
function startAutoLocationTimer() {
  const ms = CONFIG.AUTO_LOCATION_HOURS * 60 * 60 * 1000;
  setInterval(async () => {
    const hora = new Date().toLocaleString('es-EC', {
      timeZone: 'America/Guayaquil',
      hour: '2-digit', minute: '2-digit'
    });
    try {
      await client.sendMessage(
        CONFIG.GRUPO_ID,
        `📍 *Check-in familiar* — ${hora}\n\n` +
        `¿Dónde están todos? Compartan su ubicación 😊\n` +
        `_(Escribe "ubicacion" si necesitas ayuda)_`
      );
    } catch (e) {
      console.log('Error enviando check-in automático:', e.message);
    }
  }, ms);
  console.log(`⏰ Check-in automático cada ${CONFIG.AUTO_LOCATION_HOURS} horas activado`);
}

// ─── API REST ───────────────────────────────────────────────────────────────

// Recibir ubicación desde la PWA móvil
app.post('/api/location', async (req, res) => {
  const { name, latitude, longitude, isSOS } = req.body;
  if (!name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const timestamp = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });
  const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;

  // Guardar en DB
  const db = loadDB();
  db.locations[name] = { latitude, longitude, timestamp, name };
  db.history.unshift({ name, latitude, longitude, timestamp, type: isSOS ? 'sos' : 'app' });
  if (db.history.length > 500) db.history = db.history.slice(0, 500);
  saveDB(db);

  // Enviar al grupo de WhatsApp
  if (client.info) {
    const emoji = isSOS ? '🚨' : '📍';
    const prefix = isSOS ? '*EMERGENCIA* — ' : '';
    const msg = `${emoji} ${prefix}*${name}* ${isSOS ? 'necesita ayuda!' : 'compartió su ubicación'}\n` +
                `🕐 ${timestamp}\n` +
                `🗺️ ${mapsLink}`;
    try {
      await client.sendMessage(CONFIG.GRUPO_ID, msg);
      if (isSOS) {
        for (const contacto of CONFIG.SOS_CONTACTS) {
          try { await client.sendMessage(contacto, msg); } catch (e) {}
        }
      }
    } catch (e) {
      console.log('Error enviando a WhatsApp:', e.message);
    }
  }

  res.json({ ok: true, timestamp });
});

// Obtener última ubicación de cada familiar
app.get('/api/locations', (req, res) => {
  const db = loadDB();
  res.json(Object.values(db.locations));
});

// Obtener historial
app.get('/api/history', (req, res) => {
  const db = loadDB();
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.history.slice(0, limit));
});

// ─── START ──────────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${CONFIG.PORT}`);
  console.log(`📱 App familiar: http://localhost:${CONFIG.PORT}/app.html`);
  console.log(`💻 Dashboard:    http://localhost:${CONFIG.PORT}/dashboard.html`);
});

client.initialize();
