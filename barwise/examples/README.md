# Example transcripts

These are sample business working session transcripts that you can use
to try the full Barwise pipeline: import, validate, verbalize, and diagram.

| File                                   | Domain     | What it covers                                                          |
| -------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `transcripts/order-management.md`      | E-commerce | Customers, orders, products, statuses, terminology ambiguity            |
| `transcripts/university-enrollment.md` | Education  | Students, courses, offerings, semesters, grades, enrollment constraints |
| `transcripts/clinic-appointments.md`   | Healthcare | Patients, doctors, appointments, time slots, rooms, specialties         |

## Multi-domain project example

`auction-project/` is a worked multi-file project: the monolithic
[`docs/auction.orm.yaml`](../docs/auction.orm.yaml) model split into
four bounded contexts (`catalog`, `auctions`, `payments`, `parties`).

- `auction-split.yaml` -- the split config that produced it.
- `auction-project/` -- the generated project: a `.orm-project.yaml`
  manifest, four `domains/*.orm.yaml` models, and the `mappings/`
  between them.

Regenerate it with:

```sh
barwise project split docs/auction.orm.yaml \
  --config examples/auction-split.yaml --out examples/auction-project
```

See [docs/ORM_PROJECT_GUIDE.md](../docs/ORM_PROJECT_GUIDE.md) for the
full splitting workflow.

## Output samples

`output/` holds models extracted from the sample transcripts together
with their verbalizations and diagnostics, as committed comparison
artifacts: regenerating them across barwise versions shows how
verbalization and validation evolve. Each output file is stamped with
the barwise version that produced it, so version-to-version diffs are
explicit.

Regenerate them from the models in `output/` with:

```sh
npm run build && npm run regen:examples
```

## Walkthrough

This walkthrough uses `university-enrollment.md` but any transcript works.

### 1. Import a transcript

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **ORM: Import Transcript**.
3. Navigate to `examples/transcripts/` and select `university-enrollment.md`.
4. When prompted for a model name, type `university-enrollment` (or accept the default).
5. The extension calls the LLM to extract entity types, value types, fact types,
   and constraints. A progress notification appears while this runs.
6. When extraction finishes, `university-enrollment.orm.yaml` opens in the editor.
   An information message reports how many object types, fact types, and
   constraints were extracted.

Check the **Output** panel (View > Output) and select **ORM Transcript Import**
from the dropdown. This channel shows any ambiguities the LLM flagged
(e.g., terminology disagreements between stakeholders), extraction warnings,
and constraints that were skipped along with the reason.

### 2. Validate the model

1. With `university-enrollment.orm.yaml` open, run **ORM: Validate Model**.
2. The validation engine checks structural rules (required fields, ID
   uniqueness, role-player consistency) and constraint consistency.
3. Results appear in the **ORM Validation** output channel:
   - Errors (structural problems that must be fixed)
   - Warnings (missing definitions, ambiguous readings)
4. A toast notification summarizes the result. If errors are reported, fix
   them in the YAML and re-validate.

### 3. Verbalize the model

1. With the `.orm.yaml` file open, run **ORM: Verbalize Model**.
2. The **ORM Verbalization** output channel shows natural-language readings
   for every fact type and constraint. For example:

   ```
   Student enrolls in CourseOffering
   CourseOffering is taught by Instructor
   Each CourseOffering is taught by at most one Instructor
   Every CourseOffering is taught by some Instructor
   Grade is one of { A, B, C, D, F }
   ```

3. Review the readings to confirm the model matches the stakeholders' intent.
   If a reading sounds wrong, edit the roles or reading templates in the YAML
   and verbalize again.

### 4. View the diagram

1. Run **ORM: Show Diagram**.
2. A webview panel opens beside the editor showing the ORM diagram as SVG:
   - Entity types appear as rounded rectangles with solid borders.
   - Value types appear as ovals with dashed borders.
   - Fact types are shown as connected role boxes between the types they relate.
   - Constraints are annotated on the diagram.
3. Use the mouse wheel to zoom and click-drag to pan. The controls in the
   bottom-right corner offer Zoom In (+), Zoom Out (-), and Reset (fit to view).

### 5. Re-import (incremental update)

After reviewing the diagram or verbalizations, you may want to refine the
model by re-importing the same transcript (or an updated one):

1. Run **ORM: Import Transcript** again, selecting the same or a revised transcript.
2. Because `university-enrollment.orm.yaml` already exists, the extension
   diffs the new extraction against the existing model.
3. A multi-select dialog appears listing every added, modified, or removed
   element. Additions and modifications are pre-selected; removals require
   explicit opt-in.
4. Confirm the changes you want to keep. The YAML file is updated in place.

## LLM configuration

The extension supports two LLM providers.

**GitHub Copilot (default)** -- uses the VS Code `vscode.lm` API. Requires the
GitHub Copilot extension to be installed and signed in. No API key needed.

**Anthropic (direct)** -- uses the Anthropic SDK. Set `barwise.llmProvider` to
`"anthropic"` in VS Code settings and provide your key via `barwise.anthropicApiKey`
or the `ANTHROPIC_API_KEY` environment variable.

## Writing your own transcripts

A good transcript is a natural conversation between a facilitator and one or
more domain experts. The LLM looks for:

- **Business objects** and how they are identified ("each customer has a unique customer ID")
- **Relationships** between objects ("a customer places an order")
- **Constraints** on those relationships ("every order must have exactly one customer")
- **Enumerated values** ("status can be: pending, confirmed, shipped, delivered")
- **Ambiguities** worth flagging ("the billing team calls them clients")

Plain `.md` or `.txt` files work. No special formatting is required -- just
dialogue with enough detail for the modeler to extract structure.
