/**
 * Every workspace package that declares `effect` declares core's exact
 * version (docs/specs/effect-adoption.spec.md, Scope; 1r, R1).
 *
 * Core's public API will carry Effect types (Open decision 1), so two
 * versions in one install would be two incompatible `Effect` types: a
 * decoder from one could not be composed with code built on the other, and
 * the type error would name neither version. Core pins it exactly, so a
 * range here could resolve to a different version than core's.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const BARWISE = resolve(import.meta.dirname, "../../..");

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Manifest;
const manifests = [
  read(resolve(BARWISE, "package.json")),
  ...readdirSync(resolve(BARWISE, "packages")).map((p) =>
    read(resolve(BARWISE, "packages", p, "package.json"))
  ),
];

/** Every declaration of `effect` a manifest makes, by section. */
function effectDeclarations(m: Manifest): [string, string][] {
  return (["dependencies", "devDependencies", "peerDependencies"] as const).flatMap((section) => {
    const version = m[section]?.effect;
    return version === undefined ? [] : [[`${m.name} ${section}`, version] as [string, string]];
  });
}

/** What disagrees with core's pin, or an empty list. */
function disagreements(all: readonly Manifest[]): string[] {
  const core = all.find((m) => m.name === "@barwise/core");
  const pinned = core?.dependencies?.effect;
  if (pinned === undefined || !/^\d+\.\d+\.\d+$/.test(pinned)) {
    return [`@barwise/core must pin effect to an exact version, not ${pinned ?? "nothing"}`];
  }
  return all.flatMap(effectDeclarations)
    .filter(([, version]) => version !== pinned)
    .map(([where, version]) => `${where} declares effect ${version}, core pins ${pinned}`);
}

it("every package declaring effect pins core's exact version", () => {
  expect(disagreements(manifests)).toEqual([]);
});

it("installs one effect, at core's version, so no transitive copy brings a second", () => {
  // Manifests can agree while a dependency pulls another effect into a
  // nested node_modules; only the lockfile shows that.
  const lock = JSON.parse(readFileSync(resolve(BARWISE, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; }>;
  };
  const installed = Object.entries(lock.packages)
    .filter(([path]) => /(^|\/)node_modules\/effect$/.test(path))
    .map(([path, entry]) => `${path}@${entry.version}`);
  const pinned = manifests.find((m) => m.name === "@barwise/core")?.dependencies?.effect;
  expect(installed).toEqual([`node_modules/effect@${pinned}`]);
});

it("refuses a range, another version, and a core that does not pin", () => {
  const core: Manifest = { name: "@barwise/core", dependencies: { effect: "4.0.5" } };
  expect(disagreements([core, { name: "a", devDependencies: { effect: "^4.0.5" } }])).toEqual([
    "a devDependencies declares effect ^4.0.5, core pins 4.0.5",
  ]);
  expect(disagreements([core, { name: "b", dependencies: { effect: "4.0.6" } }])).toHaveLength(1);
  expect(disagreements([{ name: "@barwise/core", dependencies: { effect: "~4.0.5" } }])).toEqual([
    "@barwise/core must pin effect to an exact version, not ~4.0.5",
  ]);
});
