import { describe, expect, it } from "vitest";
import { buildGraph, requiredVariationLabel } from "./prereq-graph";
import { FeatureFlag, Prerequisite } from "./types";

const ENV = "production";

function flag(
  key: string,
  opts: { on?: boolean; prerequisites?: Prerequisite[]; name?: string } = {},
): FeatureFlag {
  return {
    key,
    name: opts.name ?? key,
    kind: "boolean",
    variations: [
      { value: true, name: "Enabled" },
      { value: false, name: "Disabled" },
    ],
    environments: {
      [ENV]: { on: opts.on ?? true, prerequisites: opts.prerequisites ?? [] },
    },
  };
}

const requires = (key: string, variation = 0): Prerequisite => ({ key, variation });

describe("buildGraph", () => {
  it("builds two-level nesting with reversed dependent edges", () => {
    const graph = buildGraph(
      [
        flag("leaf"),
        flag("mid", { prerequisites: [requires("leaf")] }),
        flag("top", { prerequisites: [requires("mid")] }),
      ],
      ENV,
    );

    expect(graph.chainRoots).toEqual(["top"]);
    expect(graph.dependentRoots).toEqual(["leaf"]);
    expect(graph.nodes.get("leaf")!.dependents).toEqual(["mid"]);
    expect(graph.nodes.get("mid")!.dependents).toEqual(["top"]);
    expect(graph.nodes.get("top")!.depth).toBe(2);
    expect(graph.stats.maxDepth).toBe(2);
    expect(graph.stats.withPrerequisites).toBe(2);
    expect(graph.stats.usedAsPrerequisite).toBe(2);
  });

  it("supports shared prerequisites (one flag required by many)", () => {
    const graph = buildGraph(
      [
        flag("shared"),
        flag("a", { prerequisites: [requires("shared")] }),
        flag("b", { prerequisites: [requires("shared")] }),
      ],
      ENV,
    );

    expect(graph.nodes.get("shared")!.dependents).toEqual(["a", "b"]);
    expect(graph.chainRoots).toEqual(["a", "b"]);
    expect(graph.dependentRoots).toEqual(["shared"]);
    expect(graph.standalone).toEqual([]);
  });

  it("classifies apex flags (depended on, no own prerequisites) as dependentRoots", () => {
    const graph = buildGraph(
      [
        flag("release-main", { name: "release_main" }),
        flag("feature-a", { prerequisites: [requires("release-main")] }),
        flag("feature-b", { prerequisites: [requires("release-main")] }),
        flag("sub-feature", { prerequisites: [requires("feature-a")] }),
      ],
      ENV,
    );
    // feature-a has both dependents and prerequisites → mid-chain, not a root
    expect(graph.dependentRoots).toEqual(["release-main"]);
    expect(graph.nodes.get("release-main")!.dependents).toEqual(["feature-a", "feature-b"]);
  });

  it("classifies flags without prereq relationships as standalone", () => {
    const graph = buildGraph([flag("loner"), flag("dep", { prerequisites: [requires("loner")] })], ENV);
    expect(graph.standalone).toEqual([]);
    const graph2 = buildGraph([flag("loner")], ENV);
    expect(graph2.standalone).toEqual(["loner"]);
  });

  it("marks an ON flag at risk when a direct prerequisite is off", () => {
    const graph = buildGraph(
      [flag("base", { on: false }), flag("feature", { on: true, prerequisites: [requires("base")] })],
      ENV,
    );

    expect(graph.nodes.get("feature")!.atRisk).toBe(true);
    expect(graph.nodes.get("base")!.atRisk).toBe(false); // off is a state, not a risk
    expect(graph.stats.atRisk).toBe(1);
  });

  it("propagates risk through multi-level chains", () => {
    const graph = buildGraph(
      [
        flag("leaf", { on: false }),
        flag("mid", { on: true, prerequisites: [requires("leaf")] }),
        flag("top", { on: true, prerequisites: [requires("mid")] }),
      ],
      ENV,
    );

    expect(graph.nodes.get("mid")!.atRisk).toBe(true);
    expect(graph.nodes.get("top")!.atRisk).toBe(true);
  });

  it("does not flag healthy chains", () => {
    const graph = buildGraph(
      [flag("leaf"), flag("top", { prerequisites: [requires("leaf")] })],
      ENV,
    );
    expect(graph.stats.atRisk).toBe(0);
  });

  it("an OFF flag with broken prerequisites is not at risk, but its chain is broken", () => {
    const graph = buildGraph(
      [flag("leaf", { on: false }), flag("top", { on: false, prerequisites: [requires("leaf")] })],
      ENV,
    );
    expect(graph.nodes.get("top")!.atRisk).toBe(false);
    expect(graph.nodes.get("top")!.chainBroken).toBe(true);
  });

  it("treats prerequisites missing from the dataset as broken", () => {
    const graph = buildGraph([flag("top", { prerequisites: [requires("deleted-flag")] })], ENV);
    const top = graph.nodes.get("top")!;
    expect(top.missingPrerequisites).toEqual(["deleted-flag"]);
    expect(top.atRisk).toBe(true);
    expect(top.depth).toBe(1);
  });

  it("survives cycles without hanging", () => {
    const graph = buildGraph(
      [
        flag("a", { prerequisites: [requires("b")] }),
        flag("b", { prerequisites: [requires("a")] }),
      ],
      ENV,
    );
    expect(graph.nodes.get("a")!.depth).toBeLessThanOrEqual(2);
    expect(graph.nodes.get("b")!.atRisk).toBe(false);
  });

  it("handles flags with no config for the selected environment", () => {
    const orphan = flag("orphan");
    orphan.environments = {};
    const graph = buildGraph([orphan], ENV);
    expect(graph.nodes.get("orphan")!.on).toBe(false);
    expect(graph.nodes.get("orphan")!.prerequisites).toEqual([]);
  });

  it("handles flags with no environments object at all (e.g. archived)", () => {
    const archived = flag("archived-flag");
    delete archived.environments;
    const graph = buildGraph([archived, flag("normal")], ENV);
    expect(graph.nodes.get("archived-flag")!.on).toBe(false);
    expect(graph.stats.totalFlags).toBe(2);
  });
});

describe("requiredVariationLabel", () => {
  it("prefers the variation name, then the raw value", () => {
    const graph = buildGraph([flag("base"), flag("top", { prerequisites: [requires("base", 1)] })], ENV);
    expect(requiredVariationLabel(graph.nodes, { key: "base", variation: 1 })).toBe("Disabled");

    const unnamed = flag("unnamed");
    unnamed.variations = [{ value: "treatment-a" }];
    const graph2 = buildGraph([unnamed], ENV);
    expect(requiredVariationLabel(graph2.nodes, { key: "unnamed", variation: 0 })).toBe("treatment-a");
  });

  it("falls back to the index for unknown flags or variations", () => {
    const graph = buildGraph([], ENV);
    expect(requiredVariationLabel(graph.nodes, { key: "ghost", variation: 2 })).toBe("variation 2");
  });
});
