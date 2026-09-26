#!/usr/bin/env node
/**
 * Entry point for the barwise-mcp binary.
 * Starts the MCP server with stdio transport.
 */

import { createUuidv7Generator, setIdGenerator } from "@barwise/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomBytes } from "node:crypto";
import { createServer } from "./server.js";

setIdGenerator(createUuidv7Generator({ now: Date.now, randomBytes }));
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
