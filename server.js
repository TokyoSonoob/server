// server.js
// Generic bot runner – ไม่ผูกกับ discord.js อีกต่อไป
// โค้ดที่ผู้ใช้ส่งเข้ามาจะมี require ของตัวเอง เช่น require("discord.js")

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const vm = require("vm");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

let currentStop = null; // ฟังก์ชันหยุดงานล่าสุด (workers, intervals, bots ทุกชนิด)

// POST /run
app.post("/run", async (req, res) => {
  const { code, env } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).send("field `code` (string) is required");
  }

  // รวม ENV จากแอป
  if (env && typeof env === "object") {
    Object.assign(process.env, env);
  }

  // หยุดงานเก่าถ้ามี
  if (currentStop) {
    try {
      await currentStop();
    } catch (err) {
      console.error("[stop old error]", err);
    }
    currentStop = null;
  }

  const logLines = [];
  const log = (...args) => {
    const line = args
      .map((x) => {
        if (typeof x === "string") return x;
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      })
      .join(" ");
    logLines.push(line);
    console.log("[bot]", line);
  };

  // แปลง export default → CommonJS
  const normalized = String(code).replace(
    /export\s+default\s+/,
    "module.exports.default = "
  );

  // sandbox สำหรับ user code
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require, // ให้ user code require อะไรก็ได้ (รวมถึง discord.js)
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

    // ให้สิทธิ user ตั้ง stop function เอง
    const setStop = (stopFn) => {
      currentStop = stopFn;
    };

    // รันโค้ดผู้ใช้
    await fn({
      log,
      env: process.env,
      setStop,
    });

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

// STOP
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

// CHECK server
app.get("/", (req, res) => {
  res.send("Generic Bot Runner is up.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
