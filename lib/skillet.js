const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const { execSync } = require("child_process");

const HOME = os.homedir();
const SKILLET_DIR = process.env.SKILLET_DIR || path.join(HOME, ".skillet");
const SKILLET_CACHE = path.join(SKILLET_DIR, "cache");
const SKILLET_SNAPSHOTS = path.join(SKILLET_DIR, "snapshots");

const TOOLS = {
  "claude-code": {
    cmd: "claude",
    skillsDir: () => path.join(HOME, ".claude", "skills"),
  },
  "qwen-code": {
    cmd: "qwen",
    skillsDir: () => path.join(HOME, ".qwen", "skills"),
  },
  "gemini-cli": {
    cmd: "gemini",
    skillsDir: () => path.join(HOME, ".gemini", "skills"),
  },
  "aider": {
    cmd: "aider",
    skillsDir: () => path.join(HOME, ".aider", "skills"),
  },
  "codex": {
    cmd: "codex",
    skillsDir: () => path.join(HOME, ".codex", "skills"),
  },
  "cursor": {
    cmd: null,
    skillsDir: () => path.join(HOME, ".cursor", "skills"),
  },
  "opencode": {
    cmd: "opencode",
    skillsDir: () => path.join(HOME, ".opencode", "skills"),
  },
  "kilo": {
    cmd: "kilo",
    skillsDir: () => path.join(HOME, ".kilo", "skills"),
  },
  "roo": {
    cmd: null,
    skillsDir: () => path.join(HOME, ".roo", "skills"),
  },
  "continue": {
    cmd: null,
    skillsDir: () => path.join(HOME, ".continue", "skills"),
  },
};

const DEFAULT_REPOS = [
  "vercel-labs/agent-skills",
  "vercel-labs/skills",
];

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const log = {
  skillet: (msg) => console.log(`\n${C.cyan}[skillet]${C.reset} ${msg}`),
  ok: (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`),
  warn: (msg) => console.log(`  ${C.yellow}!${C.reset} ${msg}`),
  info: (msg) => console.log(`  ${C.dim}${msg}${C.reset}`),
  bullet: (label) => console.log(`    ${C.green}•${C.reset} ${label}`),
};

function isValidSemver(v) { return /^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(v); }
function normalizeSemver(v) {
  if (!v) return "v0.1.0";
  return v.startsWith("v") ? v : `v${v}`;
}
function bumpSemver(current, type = "patch") {
  const v = current.replace(/^v/, "");
  const [major, minor, patch] = v.split(/[.-]/).map(Number);
  switch (type) {
    case "major": return `v${major + 1}.0.0`;
    case "minor": return `v${major}.${minor + 1}.0`;
    case "patch": return `v${major}.${minor}.${patch + 1}`;
    default: return current;
  }
}

class Skillet {
  constructor() { this._ensureDirs(); }

  _ensureDirs() {
    for (const d of [SKILLET_DIR, SKILLET_CACHE, SKILLET_SNAPSHOTS]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  _isCmd(cmd) {
    if (!cmd) return false;
    try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; }
    catch { return false; }
  }

  detectTools() {
    const found = {};
    for (const [name, tool] of Object.entries(TOOLS)) {
      const installed = tool.cmd ? this._isCmd(tool.cmd) : false;
      const skillsDir = tool.skillsDir();
      const hasDir = fs.existsSync(skillsDir);
      const skills = hasDir
        ? fs.readdirSync(skillsDir).filter((f) => fs.statSync(path.join(skillsDir, f)).isDirectory())
        : [];
      found[name] = { name, installed, skillsDir, hasSkillsDir: hasDir, skills, skillsCount: skills.length };
    }
    return found;
  }

  _fetch(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "skillet-cli" } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return this._fetch(res.headers.location).then(resolve, reject);
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${url}`)));
      }).on("error", reject);
    });
  }

  _fetchJson(url) { return this._fetch(url).then((d) => JSON.parse(d)); }

  _copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name), d = path.join(dest, entry.name);
      entry.isDirectory() ? this._copyDir(s, d) : fs.copyFileSync(s, d);
    }
  }

  _hashDir(dir) {
    if (!fs.existsSync(dir)) return {};
    const hash = {};
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else { const rel = path.relative(dir, full); hash[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 12); }
      }
    };
    walk(dir);
    return hash;
  }

  async _fetchRegistry() {
    const cacheFile = path.join(SKILLET_CACHE, "registry.json");
    const cacheAge = fs.existsSync(cacheFile) ? (Date.now() - fs.statSync(cacheFile).mtimeMs) / 1000 : Infinity;
    if (cacheAge < 3600 && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));

    log.skillet("Fetching skills registry...");
    const all = [];
    for (const repo of DEFAULT_REPOS) {
      try {
        const data = await this._fetchJson(`https://api.github.com/repos/${repo}/contents/skills`);
        for (const item of data) if (item.type === "dir") all.push({ name: item.name, repo });
      } catch { /* skip */ }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(all, null, 2));
    return all;
  }

  async _downloadSkillFiles(repo, skillName) {
    const files = {};
    await this._downloadDir(repo, `skills/${skillName}`, "", files);
    return files;
  }

  async _downloadDir(repo, basePath, prefix, files) {
    const data = await this._fetchJson(`https://api.github.com/repos/${repo}/contents/${basePath}`);
    for (const item of data) {
      if (item.type === "file") { try { files[path.join(prefix, item.name)] = await this._fetch(item.download_url); } catch {} }
      else if (item.type === "dir") await this._downloadDir(repo, `${basePath}/${item.name}`, path.join(prefix, item.name), files);
    }
  }

  // ─── commands ────────────────────────────────────────────────────

  async showAgents() {
    const detected = this.detectTools();
    log.skillet("Detected tools:");
    const entries = Object.entries(detected);
    if (!entries.some(([, v]) => v.installed)) { log.info("No supported tools detected."); return; }
    for (const [, info] of entries) {
      const status = info.installed ? (info.hasSkillsDir ? `${info.skillsCount} skill${info.skillsCount !== 1 ? "s" : ""}` : "installed (no skills dir)") : "not installed";
      const icon = info.installed ? (info.hasSkillsDir ? "✓" : "~") : "✗";
      const color = info.installed ? (info.hasSkillsDir ? C.green : C.yellow) : C.red;
      console.log(`  ${color}[${icon}]${C.reset} ${C.bold}${info.name}${C.reset} → ${info.skillsDir} ${C.dim}(${status})${C.reset}`);
    }
    console.log();
  }

  async status() {
    const detected = this.detectTools();
    log.skillet("Skills status:");
    const allSkills = new Set();
    const agentMap = {};
    for (const [name, info] of Object.entries(detected)) {
      if (!info.installed) continue;
      agentMap[name] = new Set(info.skills);
      for (const s of info.skills) allSkills.add(s);
    }
    const activeAgents = Object.keys(agentMap);
    const synced = [...allSkills].filter((s) => activeAgents.every((a) => agentMap[a].has(s)));
    const unsynced = [...allSkills].filter((s) => !synced.includes(s));
    if (!allSkills.size) { log.info("No skills installed."); return; }
    console.log(`\n  ${C.bold}Installed:${C.reset}`);
    for (const skill of synced.sort()) console.log(`  ${C.green}✓${C.reset} ${C.bold}${skill}${C.reset} ${C.dim}(${activeAgents.length}/${activeAgents.length} tools)${C.reset}`);
    if (unsynced.length) {
      console.log(`\n  ${C.yellow}Partial:${C.reset}`);
      for (const skill of unsynced.sort()) {
        const on = activeAgents.filter((a) => agentMap[a].has(skill));
        console.log(`  ${C.yellow}~${C.reset} ${C.bold}${skill}${C.reset} ${C.dim}(on: ${on.join(", ")})${C.reset}`);
      }
    }
    const snaps = this.listSnapshots();
    if (snaps.length) console.log(`\n  ${C.bold}Snapshots:${C.reset} ${C.dim}${snaps.length} saved${C.reset}`);
    console.log();
  }

  async find(keyword) {
    const registry = await this._fetchRegistry();
    let skills = keyword ? registry.filter((s) => new RegExp(keyword, "i").test(s.name)) : registry;
    if (!skills.length) { log.skillet(`No skills found${keyword ? ` for "${keyword}"` : ""}.`); log.info("Browse https://skills.sh"); return; }
    log.skillet(`Available skills${keyword ? ` for "${keyword}"` : ""}:`);
    for (const s of skills) console.log(`  ${C.bold}${s.name.padEnd(30)}${C.reset} ${C.dim}${s.repo}${C.reset}`);
    console.log(`\n  ${C.cyan}Tip:${C.reset} skillet install ${skills[0].name}`);
  }

  async install(args) {
    let skillName = "", repo = "", targets = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--repo" || args[i] === "-r") repo = args[++i];
      else if (args[i] === "--agent" || args[i] === "-a") targets.push(args[++i]);
      else if (!skillName) skillName = args[i];
    }
    if (!skillName) throw new Error("Usage: skillet install <skill-name> [--repo owner/repo]");
    if (!repo) {
      const reg = await this._fetchRegistry();
      const found = reg.find((s) => s.name === skillName);
      if (found) repo = found.repo;
    }
    if (!repo) {
      for (const r of DEFAULT_REPOS) { try { await this._fetchJson(`https://api.github.com/repos/${r}/contents/skills/${skillName}`); repo = r; break; } catch {} }
    }
    if (!repo) throw new Error(`Skill "${skillName}" not found. Try 'skillet find ${skillName}'`);
    log.skillet(`Installing "${skillName}" from github.com/${repo}...`);
    const files = await this._downloadSkillFiles(repo, skillName);
    if (!files["SKILL.md"]) throw new Error(`SKILL.md not found in "${skillName}"`);

    const detected = this.detectTools();
    const list = targets.length ? targets.filter((t) => detected[t]) : Object.entries(detected).filter(([, v]) => v.installed).map(([k]) => k);
    if (!list.length) throw new Error("No target tools found.");
    for (const name of list) {
      const info = detected[name];
      if (!fs.existsSync(info.skillsDir)) fs.mkdirSync(info.skillsDir, { recursive: true });
      const dest = path.join(info.skillsDir, skillName);
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      for (const [fn, content] of Object.entries(files)) {
        const fp = path.join(dest, fn);
        if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content);
      }
      log.ok(`${skillName} → ${dest} (${C.bold}${name}${C.reset})`);
    }
    console.log(`\n${C.cyan}[skillet]${C.reset} Installed to ${C.bold}${list.length}${C.reset} tool(s). Restart to apply.`);
  }

  async remove(args) {
    let skillName = "", targets = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--agent" || args[i] === "-a") targets.push(args[++i]);
      else if (!skillName) skillName = args[i];
    }
    if (!skillName) throw new Error("Usage: skillet remove <skill-name>");
    const detected = this.detectTools();
    const list = targets.length ? targets.filter((t) => detected[t]) : Object.entries(detected).filter(([, v]) => v.installed).map(([k]) => k);
    for (const name of list) {
      const p = path.join(detected[name].skillsDir, skillName);
      if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); log.ok(`Removed "${skillName}" from ${C.bold}${name}${C.reset}`); }
    }
  }

  async list() {
    const detected = this.detectTools();
    log.skillet("Installed skills:");
    let total = 0;
    for (const [name, info] of Object.entries(detected)) {
      if (!info.installed) continue;
      total += info.skills.length;
      console.log(`\n  ${C.bold}${name.padEnd(16)}${C.reset} ${C.dim}${info.skillsDir}${C.reset}`);
      if (!info.skills.length) log.info("(none)");
      else for (const s of info.skills.sort()) console.log(`    ${C.green}•${C.reset} ${s}`);
    }
    if (!total) log.info("No skills installed.");
    console.log();
  }

  async migrate(args) {
    let from = "", to = "", specificSkills = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--from") from = args[++i];
      else if (args[i] === "--to") to = args[++i];
      else if (args[i] === "--skill" || args[i] === "-s") specificSkills.push(args[++i]);
      else if (!from) from = args[i];
      else if (!to) to = args[i];
      else specificSkills.push(args[i]);
    }
    if (!from || !to) throw new Error("Usage: skillet migrate <from> <to> [--skill name]");
    if (!TOOLS[from]) throw new Error(`Unknown source: ${from}`);
    if (!TOOLS[to]) throw new Error(`Unknown target: ${to}`);
    const fromDir = TOOLS[from].skillsDir(), toDir = TOOLS[to].skillsDir();
    if (!fs.existsSync(fromDir)) throw new Error(`Source directory doesn't exist: ${fromDir}`);
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
    const available = fs.readdirSync(fromDir).filter((f) => fs.statSync(path.join(fromDir, f)).isDirectory());
    let skills = specificSkills.length ? specificSkills.filter((s) => available.includes(s)) : available;
    if (!skills.length) { log.warn(`No skills to migrate from ${from}`); return; }
    const existing = fs.existsSync(toDir) ? fs.readdirSync(toDir).filter((f) => fs.statSync(path.join(toDir, f)).isDirectory()) : [];
    const newSkills = skills.filter((s) => !existing.includes(s));
    const overwrite = skills.filter((s) => existing.includes(s));
    if (newSkills.length) { log.skillet(`New skills (${newSkills.length}):`); for (const s of newSkills) log.bullet(s); }
    if (overwrite.length) { log.skillet(`Overwriting (${overwrite.length}):`); for (const s of overwrite) console.log(`    ${C.yellow}•${C.reset} ${s} ${C.dim}(overwrite)${C.reset}`); }
    for (const skill of skills) {
      const src = path.join(fromDir, skill), dest = path.join(toDir, skill);
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      this._copyDir(src, dest);
      log.ok(`${skill} (${from} → ${to})`);
    }
    console.log(`\n${C.cyan}[skillet]${C.reset} Migrated ${C.bold}${skills.length}${C.reset} skill(s).`);
  }

  async snapshot(args) {
    let tag = "", message = "", type = "patch";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--tag" || args[i] === "-t") tag = args[++i];
      else if (args[i] === "--message" || args[i] === "-m") message = args[++i];
      else if (args[i] === "--major") type = "major";
      else if (args[i] === "--minor") type = "minor";
      else if (!tag) tag = args[i];
    }
    const detected = this.detectTools();
    const active = Object.entries(detected).filter(([, v]) => v.installed);
    if (!active.length) throw new Error("No tools installed.");
    const snaps = this.listSnapshots();
    if (!tag) tag = snaps.length ? bumpSemver(snaps[snaps.length - 1].tag, type) : "v0.1.0";
    else tag = normalizeSemver(tag);
    const snapshotDir = path.join(SKILLET_SNAPSHOTS, tag);
    if (fs.existsSync(snapshotDir)) log.warn(`Snapshot ${tag} already exists, overwriting.`);

    const manifest = { tag, message, created: new Date().toISOString(), agents: {} };
    log.skillet(`Creating snapshot ${C.bold}${tag}${C.reset}...`);
    for (const [name, info] of active) {
      if (!info.hasSkillsDir) continue;
      manifest.agents[name] = { skillsDir: info.skillsDir, skills: info.skills, hash: this._hashDir(info.skillsDir) };
      if (info.skills.length) this._copyDir(info.skillsDir, path.join(snapshotDir, name));
    }
    fs.writeFileSync(path.join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    log.ok(`Snapshot ${C.bold}${tag}${C.reset} created (${Object.values(manifest.agents).reduce((s, a) => s + a.skills.length, 0)} skills captured).`);
  }

  listSnapshots() {
    if (!fs.existsSync(SKILLET_SNAPSHOTS)) return [];
    return fs.readdirSync(SKILLET_SNAPSHOTS)
      .filter((d) => fs.existsSync(path.join(SKILLET_SNAPSHOTS, d, "manifest.json")))
      .map((d) => JSON.parse(fs.readFileSync(path.join(SKILLET_SNAPSHOTS, d, "manifest.json"), "utf8")))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  async snapshots() {
    const snaps = this.listSnapshots();
    log.skillet("Snapshots:");
    if (!snaps.length) { log.info("None yet. Try: skillet snapshot"); return; }
    for (const s of snaps) {
      const count = Object.values(s.agents).reduce((sum, a) => sum + a.skills.length, 0);
      console.log(`  ${C.cyan}📸${C.reset} ${C.bold}${s.tag}${C.reset} ${C.dim}(${s.created.split("T")[0]})${C.reset}`);
      if (s.message) console.log(`     ${C.dim}${s.message}${C.reset}`);
      console.log(`     ${C.dim}${count} skills across ${Object.keys(s.agents).join(", ")}${C.reset}`);
    }
    console.log();
  }

  async restore(tag) {
    if (!tag) throw new Error("Usage: skillet restore <tag>");
    const snapPath = path.join(SKILLET_SNAPSHOTS, normalizeSemver(tag));
    const manifestPath = path.join(snapPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      const snaps = this.listSnapshots();
      throw new Error(`Snapshot ${tag} not found. Available: ${snaps.map((s) => s.tag).join(", ") || "none"}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    log.skillet(`Restoring ${C.bold}${manifest.tag}${C.reset}...`);
    for (const [name, data] of Object.entries(manifest.agents)) {
      const tool = TOOLS[name];
      if (!tool) { log.warn(`Skipping ${name} (unknown tool)`); continue; }
      const targetDir = tool.skillsDir();
      const snapDir = path.join(snapPath, name);
      if (!fs.existsSync(snapDir)) { log.warn(`No files for ${name} in snapshot`); continue; }
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      for (const s of fs.readdirSync(targetDir)) { const p = path.join(targetDir, s); if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true }); }
      this._copyDir(snapDir, targetDir);
      log.ok(`${name} restored (${data.skills.length} skills)`);
    }
    console.log(`\n${C.cyan}[skillet]${C.reset} Restored to ${C.bold}${manifest.tag}${C.reset}`);
  }

  async diff(args) {
    let a = "", b = "";
    for (let i = 0; i < args.length; i++) { if (!a) a = args[i]; else if (!b) b = args[i]; }
    const snaps = this.listSnapshots();
    if (!a && snaps.length >= 2) { a = snaps[snaps.length - 2].tag; b = snaps[snaps.length - 1].tag; }
    if (!a || !b) throw new Error("Usage: skillet diff [a] [b]");
    a = normalizeSemver(a); b = normalizeSemver(b);
    const pa = path.join(SKILLET_SNAPSHOTS, a), pb = path.join(SKILLET_SNAPSHOTS, b);
    if (!fs.existsSync(path.join(pa, "manifest.json"))) throw new Error(`Snapshot not found: ${a}`);
    if (!fs.existsSync(path.join(pb, "manifest.json"))) throw new Error(`Snapshot not found: ${b}`);
    const ma = JSON.parse(fs.readFileSync(path.join(pa, "manifest.json"), "utf8"));
    const mb = JSON.parse(fs.readFileSync(path.join(pb, "manifest.json"), "utf8"));
    log.skillet(`Diff: ${C.bold}${a}${C.reset} ${C.dim}→${C.reset} ${C.bold}${b}${C.reset}\n`);
    for (const name of new Set([...Object.keys(ma.agents), ...Object.keys(mb.agents)])) {
      const sa = new Set(ma.agents[name]?.skills || []), sb = new Set(mb.agents[name]?.skills || []);
      const added = [...sb].filter((s) => !sa.has(s)), removed = [...sa].filter((s) => !sb.has(s));
      if (!added.length && !removed.length) continue;
      console.log(`  ${C.bold}${name}${C.reset}:`);
      for (const s of added) console.log(`    ${C.green}+ ${s}${C.reset}`);
      for (const s of removed) console.log(`    ${C.red}- ${s}${C.reset}`);
    }
    console.log();
  }

  async sync() {
    const detected = this.detectTools();
    const active = Object.entries(detected).filter(([, v]) => v.installed && v.hasSkillsDir);
    if (active.length < 2) { log.info("Need at least 2 tools with skills directories."); return; }
    const union = new Set();
    for (const [, info] of active) for (const s of info.skills) union.add(s);
    if (!union.size) { log.info("No skills installed."); return; }
    log.skillet(`Syncing ${union.size} skill(s) across ${active.length} tools...`);
    for (const skill of [...union].sort()) {
      let srcAgent = "", srcDir = "";
      for (const [name, info] of active) { if (info.skills.includes(skill)) { srcAgent = name; srcDir = info.skillsDir; break; } }
      for (const [name, info] of active) {
        if (info.skills.includes(skill)) continue;
        this._copyDir(path.join(srcDir, skill), path.join(info.skillsDir, skill));
        log.ok(`${skill} → ${name} (from ${srcAgent})`);
      }
    }
    console.log(`\n${C.cyan}[skillet]${C.reset} All tools now have identical skills.`);
  }

  async doctor() {
    const detected = this.detectTools();
    log.skillet("Health check:\n");
    let issues = 0;
    for (const [name, info] of Object.entries(detected)) {
      if (!info.installed) continue;
      console.log(`  ${C.bold}${name}${C.reset}`);
      if (!info.hasSkillsDir) { log.warn(`Skills directory missing: ${info.skillsDir}`); issues++; }
      else {
        log.ok(`Directory exists: ${info.skillsDir}`);
        for (const skill of info.skills) {
          const p = path.join(info.skillsDir, skill, "SKILL.md");
          fs.existsSync(p) ? log.ok(`${skill}/SKILL.md (${fs.statSync(p).size} bytes)`) : (log.warn(`${skill}/SKILL.md missing`), issues++);
        }
      }
      console.log();
    }
    issues ? log.warn(`${issues} issue(s) found.`) : log.ok("All skills healthy.");
  }

  async browse() {
    const url = "https://skills.sh";
    log.skillet(`Opening ${url}...`);
    try {
      if (process.platform === "darwin") execSync(`open ${url}`);
      else if (process.platform === "win32") execSync(`start ${url}`);
      else execSync(`xdg-open ${url}`);
    } catch { console.log(`  → ${url}`); }
  }

  help() {
    console.log(`
${C.bold}skillet${C.reset} — Universal Skills Installer

${C.cyan}USAGE:${C.reset}
  skillet <command> [arguments]

${C.cyan}CORE:${C.reset}
  ${C.bold}agents${C.reset}              Show detected tools
  ${C.bold}status${C.reset}              Overview of skills + sync state
  ${C.bold}find${C.reset} [keyword]      Search the skills registry
  ${C.bold}install${C.reset} <name>      Install a skill to all detected tools
  ${C.bold}remove${C.reset} <name>       Remove a skill
  ${C.bold}list${C.reset}                Show installed skills

${C.cyan}MIGRATION:${C.reset}
  ${C.bold}migrate${C.reset} <from> <to>    Copy skills between tools
  ${C.bold}migrate${C.reset} <from> <to> --skill <name>  Migrate one skill
  ${C.bold}sync${C.reset}                   Make all tools have identical skills

${C.cyan}SNAPSHOTS:${C.reset}
  ${C.bold}snapshot${C.reset} [tag]      Versioned backup of all skills
  ${C.bold}snapshots${C.reset}           List saved snapshots
  ${C.bold}restore${C.reset} <tag>        Restore a previous snapshot
  ${C.bold}diff${C.reset} [a] [b]        Compare two snapshots

${C.cyan}MISC:${C.reset}
  ${C.bold}doctor${C.reset}              Verify skill files exist
  ${C.bold}browse${C.reset}              Open skills.sh

${C.cyan}EXAMPLES:${C.reset}
  skillet agents
  skillet find react
  skillet install react-best-practices
  skillet migrate claude-code qwen-code
  skillet migrate claude-code gemini-cli --skill react-best-practices
  skillet snapshot v1.0.0 --message "baseline"
  skillet restore v1.0.0
  skillet diff
  skillet sync
  skillet doctor

${C.cyan}SUPPORTED TOOLS:${C.reset}
  claude-code  qwen-code  gemini-cli  aider  codex  cursor  opencode  kilo  roo  continue
`);
  }
}

module.exports = { Skillet, TOOLS };
