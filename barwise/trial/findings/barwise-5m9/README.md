# barwise-5m9: `lineage impact --element` takes an id; the doc example passes a name

`docs/CLI.md`:

```sh
barwise lineage impact model.orm.yaml --element "Customer"
```

two lines above `--element <id> -- element ID to analyze`. The CLI
hands the string to `analyzeImpact`, which compares it with element ids,
so a name returns `affectedArtifacts: []` with exit 0 -- the same answer
as "nothing depends on this". A typo gives it too.

## Reproduction

As in `../barwise-ofb/`, then:

```sh
barwise lineage impact model.orm.yaml --element Encounter --format json
```

`{ "changedElement": "Encounter", "affectedArtifacts": [] }`, exit 0.

This row cannot close before barwise-ofb: with no sources recorded, the
id gives the same empty answer. The trial asks both ways
(`late:impact-name`, `late:impact-id`) so the two defects close
separately.
