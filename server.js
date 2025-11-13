// server.js
// ตัวเล็กๆไว้รันโค้ด Discord bot จาก client

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const vm = require("vm");
const Discord = require("discord.js");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

let currentStop = null; // ฟังก์ชันหยุดบอทตัวล่าสุด

// POST /run  <-- ตรงกับที่แอปส่งมาแล้ว
app.post("/run", async (req, res) => {
  const { code, env } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).send("field `code` (string) is required");
  }

  // ผสม ENV ที่ส่งมาจากแอปเข้าไปใน process.env
  if (env && typeof env === "object") {
    Object.assign(process.env, env);
  }

  // ถ้ามีบอทเก่ารันอยู่ให้หยุดก่อน
  if (currentStop) {
    try {
      await currentStop();
    } catch (e) {
      console.error("[stop old bot error]", e);
    }
    currentStop = null;
  }

  const logLines = [];
  const log = (...args) => {
    const line = args
      .map((x) =>
        typeof x === "string" ? x : (() => {
          try {
            return JSON.stringify(x);
          } catch {
            return String(x);
          }
        })()
      )
      .join(" ");
    logLines.push(line);
    console.log("[bot]", line);
  };

  // helper สร้าง client พร้อม intents พื้นฐาน
  const makeClient = () => {
    const client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.MessageContent,
      ],
    });

    // เวลาบอกให้ stop จะ destroy client นี้
    currentStop = async () => {
      try {
        await client.destroy();
      } catch (e) {
        console.error("[destroy error]", e);
      }
      currentStop = null;
    };

    return client;
  };

  // แปลง `export default ...` ให้กลายเป็น CommonJS แทน
  const normalized = String(code).replace(
    /export\s+default\s+/,
    "module.exports.default = "
  );

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,      // ให้ใช้ require ปกติได้ (discord.js ฯลฯ)
    console,
    process,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
  };

  try {
    vm.createContext(sandbox);
    vm.runInContext(normalized, sandbox, { timeout: 10000 });

    const fn =
      sandbox.module.exports.default || sandbox.exports.default;

    if (typeof fn !== "function") {
      return res
        .status(400)
        .send("export default function not found in user code");
    }

    // รันฟังก์ชันของผู้ใช้
    await fn({ Discord, makeClient, log });

    log("User code executed without immediate error.");
    return res.status(200).send(logLines.join("\n") + "\n");
  } catch (err) {
    console.error("[run error]", err);
    currentStop = null;
    return res
      .status(500)
      .send(String(err && err.stack ? err.stack : err));
  }
});

// POST /stop  ใช้กับปุ่ม STOP ในแอป
app.post("/stop", async (req, res) => {
  if (!currentStop) {
    return res.status(200).send("no bot is running");
  }
  try {
    await currentStop();
  } catch (e) {
    console.error("[stop error]", e);
  }
  currentStop = null;
  return res.status(200).send("stopped");
});

// GET /  สำหรับเช็คว่า server ยังอยู่
app.get("/", (req, res) => {
  res.send("Bot runner server is up.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
