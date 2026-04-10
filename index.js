#!/usr/bin/env node
// skillet — Universal skills installer
// Usage: skillet <command> or npx skillet <command>

const { Skillet } = require("./lib/skillet");

async function main() {
  const args = process.argv.slice(2);
  const skillet = new Skillet();
  const cmd = args[0] || "help";

  try {
    switch (cmd) {
      case "agents":    await skillet.showAgents(); break;
      case "status":    await skillet.status(); break;
      case "find":
      case "search":    await skillet.find(args.slice(1).join(" ")); break;
      case "install":
      case "add":       await skillet.install(args.slice(1)); break;
      case "remove":
      case "rm":
      case "uninstall": await skillet.remove(args.slice(1)); break;
      case "list":
      case "ls":        await skillet.list(); break;
      case "migrate":   await skillet.migrate(args.slice(1)); break;
      case "sync":      await skillet.sync(); break;
      case "snapshot":
      case "snap":      await skillet.snapshot(args.slice(1)); break;
      case "snapshots": await skillet.snapshots(); break;
      case "restore":   await skillet.restore(args[1]); break;
      case "diff":      await skillet.diff(args.slice(1)); break;
      case "doctor":    await skillet.doctor(); break;
      case "browse":
      case "open":      await skillet.browse(); break;
      default:          skillet.help();
    }
  } catch (err) {
    console.error(`\n\x1b[31m[✗]\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

main();
