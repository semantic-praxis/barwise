# Splitting a model into an OrmProject

A single `.orm.yaml` file holds one ORM model. That is the right shape
for a focused domain, but a model that grows to cover an entire business
becomes hard to read, hard to diff, and hard to own. Barwise supports
**multi-file projects**: several domain models, each in its own
`.orm.yaml` file, tied together by a `.orm-project.yaml` manifest and
`.map.yaml` context mappings.

This guide walks through converting a monolithic model into a
multi-domain project. The metamodel behind it is described in
[ARCHITECTURE.md](ARCHITECTURE.md) section 3.1.4; here the focus is the
workflow. The worked example splits [`auction.orm.yaml`](auction.orm.yaml)
-- a 106-object-type model of an auction business -- into four bounded
contexts: `catalog`, `auctions`, `payments`, and `parties`. The result
is committed under [`examples/auction-project/`](../examples/auction-project).

## When to split

A single file is fine until it is not. Signs you have outgrown one:

- **The file is too big to hold in your head.** You scroll to find an
  object type instead of remembering where it is.
- **Different teams own different parts.** The billing team and the
  catalog team both edit the same file and collide in every merge.
- **The same word means different things.** "Customer" to the sales
  team is any lead; "Customer" to billing is someone with an invoice.
  A single namespace cannot hold both.
- **You only ever diagram or validate a slice.** You never look at the
  whole thing at once, so the whole thing should not be one unit.

If none of these bite, stay with one file. Splitting adds manifest and
mapping files to maintain; do it when the single file is the problem.

## Identify bounded contexts

A bounded context is a part of the model with its own vocabulary and a
clear owner. To find them, group object types by the language people
use around them, not by database tables or by what is technically
convenient. The auction model splits cleanly into four:

| Context    | Owns                                                        |
| ---------- | ----------------------------------------------------------- |
| `catalog`  | Assets, their classification, inspection, and refurbishment |
| `auctions` | Auctions, listings, bids, offerings, deals                  |
| `payments` | Invoices, payments, payouts, refunds, settlements           |
| `parties`  | Customers, organizations, locations                         |

Where two contexts both touch a concept -- an auction listing referring
to a catalog asset, say -- that is a **seam**. Seams are expected; the
mapping files document them.

## Split the model

`barwise project split` does the cutting. It needs a config that says,
per context, which object types that context owns.

### 1. Scaffold a config

You do not have to type every object type by hand. Generate a starter
config and edit it:

```sh
barwise project split docs/auction.orm.yaml --scaffold-config \
  --domains catalog,auctions,payments,parties > auction-split.yaml
```

This lists every entity object type under the first domain. Move each
one under the context that owns it. Value types do not need to be
listed -- the split infers their home from the fact types that use
them (an `Asset_id` value type follows `Asset`).

The finished config for the auction model is
[`examples/auction-split.yaml`](../examples/auction-split.yaml):

```yaml
projectName: "Auction Semantic Model"

domains:
  catalog:
    - Asset
    - ConsignmentAsset
    # ...
  auctions:
    - Auction
    - Listing
    # ...
  payments:
    - ARInvoice
    - Payment
    # ...
  parties:
    - Customer
    - Organization
    - Location
```

An object type with no fact type at all (a value type used only in
documentation) cannot be inferred. Assign it explicitly, as the example
config does for `BuyerFee` and `Month`.

### 2. Run the split

```sh
barwise project split docs/auction.orm.yaml \
  --config examples/auction-split.yaml --out examples/auction-project
```

This writes:

```
examples/auction-project/
  project.orm-project.yaml      the manifest
  domains/
    catalog.orm.yaml            one model per context
    auctions.orm.yaml
    payments.orm.yaml
    parties.orm.yaml
  mappings/
    auctions-catalog.map.yaml   one mapping per seam
    ...
```

### 3. Read the warnings

The split prints a warning for everything it decided for you:

- **Inferred homes** -- object types not in the config, and where they
  landed. Review them; if a guess is wrong, add the object type to the
  config and split again.
- **Generated mappings** -- which contexts share which object types.
- **Dropped constraints** -- a uniqueness, subset, or equality
  constraint whose roles span two contexts cannot live in a
  single-file model. The split drops it and tells you. If the
  constraint matters, re-express it within one context or record it in
  the mapping.

The split is deterministic: the same config always produces the same
project. Treat the warnings as a to-do list and tighten the config
until you are happy, rather than hand-editing the output.

### From an agent

The same split is the `split_model` MCP tool, and `barwise_split_model`
for the `@barwise` chat participant in VS Code. It takes `projectName`
and `domains` directly instead of a config file. Called without
`outDir` it writes nothing and returns each domain's entity types, the
object types it shares, and the warnings above, so an agent can agree
the assignment with you before calling again with `outDir`. Both refuse
to overwrite existing files unless forced, as the CLI does. See
[MCP.md](MCP.md#split_model).

## The project manifest

`project.orm-project.yaml` is the entry point. It lists the domain
files and the mapping files:

```yaml
format_version: "1.0"
project:
  name: Auction Semantic Model
  iri_base: https://data.acme.com/auctions/   # optional
  domains:
    - path: domains/catalog.orm.yaml
      context: catalog
    - path: domains/auctions.orm.yaml
      context: auctions
    - path: domains/payments.orm.yaml
      context: payments
    - path: domains/parties.orm.yaml
      context: parties
  mappings:
    - path: mappings/auctions-catalog.map.yaml
    # ...
```

Each domain has a `context` name that is unique within the project.
All paths are relative to the manifest's own directory. The manifest
can also list data `products` and project `settings`; see
[ARCHITECTURE.md](ARCHITECTURE.md) section 3.1.5.

`format_version` is the manifest format's version, which barwise writes
on every manifest; a manifest without it is read as 1.0, and one from a
newer barwise is refused as such. `.map.yaml` files carry their own
`format_version` the same way.

`iri_base` is optional. It is the absolute IRI, ending in `/`, that every
domain's namespace starts with: the base and the project's own segments,
followed by each domain's context, so `ordering` above it would be
`https://data.acme.com/auctions/ordering/`. The project's `name` is a
display label and is not part of any IRI. A domain file outside such a
project can declare its own `namespace` in its model header instead; a
domain that declares one inside a project with `iri_base` is reported by
`barwise validate`, and the project's namespace is the one used. Until
format 4.0 a namespace changes no element id
(`docs/specs/iri-identity.spec.md`).

You can also start a project empty, without splitting anything:

```sh
barwise project init "Auction Semantic Model"
```

This creates the manifest and the `domains/` and `mappings/`
directories, ready for you to add models by hand.

## Context mappings

When two contexts share an object type, the owning context keeps the
real definition and the other context gets a **shadow** -- a copy
marked with `source_context` so a reader knows it is owned elsewhere:

```yaml
- id: 39a503b7-4caa-4c25-9eea-d9817bf69a30
  name: Auction
  kind: entity
  reference_mode: id
  source_context: auctions
```

A `.map.yaml` file documents the correspondence. The split generates
one with the `shared_kernel` pattern:

```yaml
format_version: "1.0"
mapping:
  source_context: auctions
  target_context: payments
  pattern: shared_kernel
  entity_mappings:
    - source_object_type: WonItem
      target_object_type: WonItem
      description: '"WonItem" is owned by "auctions" and referenced by "payments".'
```

`shared_kernel` means both contexts genuinely share one definition. If
they do not -- if the two `Customer`s really are different concepts --
change the pattern to `anticorruption_layer` and record the difference
as a `semantic_conflict`:

```yaml
semantic_conflicts:
  - term: Customer
    source_meaning: "Any lead the sales team tracks."
    target_meaning: "A party with a payment relationship."
    resolution: "The warehouse Customer uses the billing definition."
```

The three patterns -- `shared_kernel`, `published_language`, and
`anticorruption_layer` -- come from the DDD context mapping catalogue.

## Cross-domain references

Within a project, an object type is named by its context:
`auctions:Auction` is the `Auction` defined in the `auctions` domain.
This qualified-reference syntax keeps `auctions:Auction` and
`payments:Auction` (its shadow) unambiguous. The project resolves these
references once every domain model is loaded; `barwise validate` on the
manifest checks that every entity mapping resolves on both sides.

## Use the project

Point the project-aware commands at the manifest:

```sh
# Validate every domain plus the cross-domain rules.
barwise validate examples/auction-project/project.orm-project.yaml

# One SVG per domain, into a directory.
barwise diagram examples/auction-project/project.orm-project.yaml \
  --output diagrams/

# Just one domain, as a single SVG.
barwise diagram examples/auction-project/project.orm-project.yaml \
  --domain catalog --output catalog.svg
```

In VS Code, the extension activates when a workspace contains a
`.orm-project.yaml` file, and each `domains/*.orm.yaml` file opens with
the full ORM model browser, validation, verbalization, and diagram
support. Open a domain file to work on one context at a time.

## Reference

- CLI commands: [CLI.md](CLI.md) (`project`, `validate`, `diagram`)
- MCP tools: [MCP.md](MCP.md)
- Metamodel: [ARCHITECTURE.md](ARCHITECTURE.md) sections 3.1.4-3.1.5
- Worked example: [`examples/auction-project/`](../examples/auction-project)
