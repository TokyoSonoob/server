// server.js
// เซิร์ฟเวอร์รับโค้ดจาก client แล้วรันเป็น Discord bot ด้วย process แยก

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000; // Render จะเซ็ต PORT ให้เอง

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

// โฟลเดอร์เก็บไฟล์โค้ดชั่วคราว
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// เก็บ process และไฟล์ของ bot ที่กำลังรันอยู่
let currentBot = null;
let currentBotFile = null;

/**
 * สร้างไฟล์ JS ที่ wrap โค้ดของ user
 * @param {string} userCode - โค้ดที่ส่งมาจาก client (ส่วน client.on(...) ต่าง ๆ)
 * @returns {string} path ของไฟล์ bot ที่สร้าง
 */
function createBotFile(userCode) {
  const filename = `session-bot-${Date.now()}.js`;
  const filePath = path.join(SESSIONS_DIR, filename);

  const content = `
// ==== Auto-generated bot wrapper ====

const { Client, GatewayIntentBits, Partials } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('[FATAL] DISCORD_TOKEN is missing in env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', () => {
  console.log('[BOT] Logged in as ' + client.user.tag);
});

// ===== User code starts here =====
try {
${userCode}
} catch (err) {
  console.error('[USER_CODE_ERROR]', err);
}
// ===== User code ends here =====

client.on('error', (err) => {
  console.error('[CLIENT_ERROR]', err);
});

client.login(TOKEN).catch(err => {
  console.error('[LOGIN_ERROR]', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});
`;

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * หยุด bot ตัวเก่าถ้ามี
 */
function stopCurrentBot() {
  if (currentBot) {
    console.log('[SERVER] Killing previous bot process...');
    currentBot.kill('SIGTERM');
    currentBot = null;
  }

  if (currentBotFile && fs.existsSync(currentBotFile)) {
    try {
      fs.unlinkSync(currentBotFile);
    } catch (e) {
      console.warn('[SERVER] Failed to delete temp bot file:', e.message);
    }
    currentBotFile = null;
  }
}

/**
 * รัน bot ใหม่จากโค้ดที่ส่งมา
 * @param {string} code - user code
 * @param {object} env - ข้อมูล env เช่น DISCORD_TOKEN
 */
function startBot(code, env) {
  stopCurrentBot();

  const botFilePath = createBotFile(code);
  currentBotFile = botFilePath;

  console.log('[SERVER] Spawning new bot process:', botFilePath);

  const child = spawn('node', [botFilePath], {
    env: {
      ...process.env,
      DISCORD_TOKEN: env.DISCORD_TOKEN || '',
      GUILD_ID: env.GUILD_ID || ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (data) => {
    process.stdout.write('[BOT_LOG] ' + data.toString());
  });

  child.stderr.on('data', (data) => {
    process.stderr.write('[BOT_ERR] ' + data.toString());
  });

  child.on('exit', (code, signal) => {
    console.log(`[SERVER] Bot process exited (code=${code}, signal=${signal})`);
  });

  currentBot = child;
}

/**
 * POST /run-bot
 * body: {
 *   code: string,
 *   env?: {
 *     DISCORD_TOKEN?: string,
 *     GUILD_ID?: string
 *   }
 * }
 */
app.post('/run-bot', (req, res) => {
  const { code, env = {} } = req.body || {};

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ ok: false, error: 'code is required (string)' });
  }

  if (!env.DISCORD_TOKEN) {
    return res.status(400).json({ ok: false, error: 'env.DISCORD_TOKEN is required' });
  }

  try {
    startBot(code, env);
    return res.json({ ok: true, message: 'Bot started with new code' });
  } catch (err) {
    console.error('[SERVER_ERROR]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// แถม endpoint เช็คสถานะ
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'running' });
});

// ปิด server แล้วปิด bot ด้วย
process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  stopCurrentBot();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[SERVER] Bot runner listening on port ${PORT}`);
});
