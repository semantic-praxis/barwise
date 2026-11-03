#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandNameIn, createProgram } from "./cli.js";

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string; };

(await createProgram(version, commandNameIn(process.argv.slice(2)))).parse();
