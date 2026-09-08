#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyReleaseVersion } from "./release-channel.mjs";

export function classifyReleaseEntry({ eventName, ref, version }) {
  classifyReleaseVersion(version);
  if (eventName === "workflow_dispatch") {
    if (ref !== "refs/heads/main") {
      throw new Error("manual qualification requires refs/heads/main");
    }
    return "qualification";
  }
  if (eventName === "push" && ref === `refs/tags/v${version}`) {
    return "publication";
  }
  throw new Error("publication requires a pushed tag matching package.json");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const { version } = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    console.log(
      classifyReleaseEntry({
        eventName: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF,
        version,
      }),
    );
  } catch (error) {
    console.error(`Release entry rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
