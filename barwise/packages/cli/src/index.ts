#!/usr/bin/env node
import { createUuidv7Generator, setIdGenerator } from "@barwise/core";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandNameIn, createProgram } from "./cli.js";

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string; };

setIdGenerator(createUuidv7Generator({ now: Date.now, randomBytes }));
(await createProgram(version, commandNameIn(process.argv.slice(2)))).parse();
