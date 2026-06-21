# CC5: ORM serialization, book-verification (parked)

Status: Parked -- awaiting (a) the background research pass and (b) answers
from the 3rd ed. (2024) serialization chapters. This doc collects the
question, the evidence so far, the questions for the book, and -- once
answered -- the verdict on whether barwise's `.orm.yaml` follows the book or
is NORMA-shaped.
Created: 2026-06-21
Last-updated: 2026-06-21
Tracking: barwise-62o (CC5), barwise-8ir (audit epic),
docs/book-verification-checklist.md

## The question

CC5 from the book-verification checklist: the 3rd ed. (2024) of Halpin &
Morgan newly covers serializing ORM models to JSON, YAML, and other markup
formats. barwise's native `.orm.yaml` (with a JSON Schema in
`packages/core/schemas/orm-model.schema.json`) is exactly that kind of
serialization. Does our format follow the book's conceptual framing, or did
it pick up NORMA's XML habits (a deep id-reference graph, constraints in a
separate referenced block, physical artifacts in the conceptual file)?

## Evidence so far

There is no published, freely-accessible canonical JSON or YAML schema for
Object-Role Modeling models to compare against:

- NORMA's `.orm` XML (`ORM2Core.xsd`) is the de facto machine-readable
  schema, and it is XML.
- Academic interchange proposals exist but none are JSON/YAML or adopted
  standards: a "standard ORM meta-model" interchange effort (_Metamodels for
  Object-Role Modeling_) and mappings of ORM to first-order logic via the
  Common Logic Interchange Format (CLIF).
- A "json-schema-orm" search hit is object-_relational_ mapping, not
  Object-_Role_ Modeling -- a false match.

So barwise's `orm-model.schema.json` appears to be one of very few -- perhaps
the only -- JSON-Schema-defined ORM serializations. There is nothing
canonical to align to, which is why CC5 turns on the book's _conceptual_
guidance (and the conceptual-vs-physical separation principle) rather than a
rival format.

Sources: _Metamodels for Object-Role Modeling_
(https://www.researchgate.net/publication/228952702_Metamodels_for_Object-Role_Modeling);
_Mapping ORM into Common Logic Interchange Format_
(https://www.researchgate.net/publication/251952406).

## barwise `.orm.yaml` shape (the comparison basis)

```
root:   orm_version, model
model:  name, domain_context, note,
        object_types[], fact_types[], subtype_facts[],
        objectified_fact_types[], populations[], definitions[], diagrams[]

fact_type:   roles[], readings[] (templates "{0} ... {1}"),
             constraints[]  <- INLINE on the fact type (not a referenced block)
object_type: value_constraint, cardinality, default_value, note, ...
references:  roles and object types referenced by opaque id
```

Notable choices to test against the book: constraints inline (not NORMA's
separate `<Constraints>` block referenced by id); an opaque id graph for role
references; sample `populations` embedded in the same file; diagram `layout`
embedded in the conceptual file.

## Questions for the 3rd ed.

Focus on Ch. 16 "Data Interchange" (especially 16.5 "XML, JSON, and ORM")
and Ch. 17 "NoSQL Databases".

Crux:

- Q1. Does the book show a worked JSON and/or YAML serialization of an ORM
  model (not just relational DDL)? Which listings/figures?
- Q2. Is that JSON/YAML the _conceptual_ ORM model serialized, or the
  _physical_ schema for a document/NoSQL database the model maps to? Does the
  book keep conceptual vs physical separate? (Ours: `.orm.yaml` is
  conceptual; DDL is derived.)

Structure -- book-like or NORMA-like:

- Q3. Top-level grouping: separate object-type and fact-type collections
  (like ours), or organized differently?
- Q4. Constraints inline on the fact type, or in a separate id-referenced
  section (NORMA-style)? This is our key anti-NORMA choice.
- Q5. Keyed by opaque ids and id-references (an id graph, NORMA-style), or by
  names/readings as primary keys?
- Q6. How are fact-type readings represented (placeholder templates like
  `{0} ... {1}`, or another form)?

What belongs in the file:

- Q7. Are sample populations (fact instances) in the same file as the schema,
  or separate (CSV for data)? We embed `populations`.
- Q8. Does the conceptual serialization include diagram / layout /
  presentation info, or keep it out? We embed `diagrams`.
- Q9. Any schema / format version field (like our `orm_version`)?

Construct-specific and interchange:

- Q10. Derivation rule serialized as text or formal expression? Join /
  set-comparison path serialized as root plus roles plus projection?
- Q11. Does the book name a canonical ORM interchange format, or treat
  NORMA's `.orm` XML as the standard? Is JSON/YAML offered as interchange or
  just as illustration?

## Research findings (cited pass, 2026-06-21)

A cited research pass landed three results. All quotes are from search-engine
snippets, not full primary text (the fetcher 403'd Elsevier, ScienceDirect,
brcommunity, ResearchGate, IEEE); the one first-hand source is a real `.orm`
file. Treat the book-content claims as TOC-level, not chapter-text-level.

1. Every documented ORM-specific interchange format is XML; there is no
   standard JSON/YAML one. NORMA `.orm` (XML, GUID id/ref graph, verbose:
   the metamodel sample is ~16.7k lines), ORM-ML (XML), SBVR XMI (XML),
   Common Logic XCL (XML); CLIF is Lisp-like text. ORM has no official
   standard metamodel (OMG has considered it). So barwise's legible
   `.orm.yaml` fills a real gap. Tellingly, ORM-ML's authors state it "is
   not meant to be written by hand ... [but] as a 'save as' or 'export to'
   functionality in ORM tools" -- barwise's hand-editable, LLM-legible YAML
   is the deliberate counterpoint, the whole NORMA-vs-yaml thesis.

2. The 3rd ed. promotes this material from one 2nd-ed section (16.7
   "Postrelational Databases") to two chapters. Chapter 16 "Data Interchange"
   has 16.1 External Data Structures, 16.2 XML, 16.3 JSON, 16.4 Other Markup
   Languages, and -- the load-bearing one for CC5 -- 16.5 "XML, JSON, and
   ORM". Chapter 17 "NoSQL Databases" covers key-value, column-oriented,
   document, and graph stores. So 16.5 is the single highest-value section
   (how JSON/XML relate to the conceptual ORM model); 17 is the physical
   NoSQL-target side. (Section titles are snippet-derived from the O'Reilly
   TOC -- O'Reilly/Elsevier/ScienceDirect all 403'd -- so treat exact
   numbering as moderate-confidence.)

3. No published Halpin work gives a verified construct-by-construct
   ORM-to-JSON mapping. The documented nested/tree-target mapping is
   ORM -> XSD (XML Schema); the BR Journal "Logical Data Modeling" series
   (Parts 1-14) covers constraints/derivation/Rmap but not JSON/NoSQL. Any
   ORM-to-document mapping most likely lives narratively in Ch. 16.5 / 17,
   unread.

4. There is direct prior art for barwise's thesis -- a _legible, hand-
   editable, diff-friendly_ ORM serialization is not a barwise invention and
   is not NORMA-centric. Clifford Heath's CQL (Constellation Query Language)
   / ActiveFacts represents "almost any ORM2 model in plain text using
   natural language", explicitly motivated by "familiar tools including email
   and differential revision management" (version control), and ActiveFacts
   round-trips with NORMA `.orm` files. barwise's `.orm.yaml` is a YAML-shaped
   member of that same legible-serialization family (CQL, FORML, verbalization)
   -- the opposite pole from NORMA's GUID id-graph XML. That is a point in our
   favor for the anti-NORMA-centrism question, independent of the book.

Working hypothesis to confirm against the book: the 3rd ed.'s JSON/YAML
appears as (a) data-interchange formats (Ch. 16) and (b) NoSQL/document
_physical_ targets (Ch. 17) -- realizations the conceptual model maps _to_ or
exchanges, not necessarily a conceptual serialization of the ORM model
itself. 16.5 "XML, JSON, and ORM" is exactly where the book would (or would
not) sanction serializing the conceptual model in JSON/YAML. If it treats
JSON only as a physical/interchange target, barwise's conceptual `.orm.yaml`
is doing something the book does not directly prescribe -- legitimately, per
the CQL precedent -- and the right test is the conceptual-vs-physical
principle: does our file stay conceptual? Mostly yes; the embedded `diagrams`
layout is the one physical/presentation intrusion worth scrutinizing (Q8).

Sources: NORMA `.orm` (verified XML/id-graph) --
https://raw.githubusercontent.com/ormfoundation/NORMA-plus/master/Documentation/OrmMetaModel.orm;
ORM-ML -- https://xml.coverpages.org/orm-ml.html and
https://ceur-ws.org/Vol-60/jarrar.pdf; "Metamodels for ORM" (no standard
metamodel) --
https://www.researchgate.net/publication/228952702_Metamodels_for_Object-Role_Modeling;
3rd-ed TOC -- https://www.oreilly.com/library/view/information-modeling-and/9780443237911/;
SBVR (OMG, ORM-grounded, XMI) -- https://www.omg.org/spec/SBVR/1.5/PDF;
CQL / ActiveFacts (legible-text ORM, round-trips NORMA) --
https://github.com/cjheath/activefacts and
https://dataconstellation.com/ActiveFacts/CQLIntroduction.html.

## Book answers (pending)

To be filled from the 3rd ed.

## Verdict (pending)

Once findings and answers are in: is `.orm.yaml` book-aligned or
NORMA-shaped, and the concrete changes (if any) to make.
