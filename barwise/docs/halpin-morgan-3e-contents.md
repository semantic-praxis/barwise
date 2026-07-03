# Halpin & Morgan, 3rd ed. -- table of contents

Reference copy of the table of contents of the canonical ORM text, for
grounding book citations without needing the physical book in hand.

- **Book:** Terry Halpin and Tony Morgan, _Information Modeling and
  Relational Databases_, 3rd ed. Morgan Kaufmann / Elsevier, 2024.
- **ISBN:** 9780443237904.
- **Companion:**
  `https://www.elsevier.com/books-and-journals/book-companion/9780443237904`

This is the edition `docs/adr/0001-metamodel-evolution-policy.md` pins
the metamodel to (filter 4: design against the book, not against NORMA's
tooling), and the source `docs/book-verification-checklist.md` verifies
constructs against. It is also the target of the `docs/anki` deck's
"Read more" pointers.

Transcribed by hand from photographs of the printed contents pages, so
treat a page number as approximate if it matters to the byte; the
chapter and section numbers are the durable part. Page numbers are the
first page of each entry.

## Contents

```
Foreword by Enrico Franconi                                         xi
Foreword by Herman Balsters                                        xiii
Foreword by Gordon C. Everest                                       xv
Preface                                                             xix

 1  Introduction                                                      1
    1.1  Information Modeling                                         1
    1.2  Information Modeling Approaches                              6
    1.3  Historical Background                                       19
    1.4  The Relevant Skills                                         23
    1.5  Summary                                                     24

 2  Information Levels and Frameworks                                27
    2.1  Four Information Levels                                     27
    2.2  The Conceptual Level                                        32
    2.3  Database Design Example                                     42
    2.4  Development Frameworks                                      48
    2.5  Summary                                                     55

 3  Conceptual Modeling: First Steps                                 59
    3.1  Conceptual Modeling Language Criteria                       59
    3.2  Conceptual Schema Design Procedure                          62
    3.3  CSDP Step 1: From Examples to Elementary Facts              63
    3.4  CSDP Step 2: Draw Fact Types and Populate                   83
    3.5  CSDP Step 3: Trim Schema; Note Basic Derivations            97
    3.6  Summary                                                    106

 4  Uniqueness Constraints                                          111
    4.1  Introduction to CSDP Step 4                                111
    4.2  Uniqueness Constraints on Unaries and Binaries             112
    4.3  Uniqueness Constraints on Longer Fact Types                124
    4.4  External Uniqueness Constraints                            129
    4.5  Arity Checks                                               139
    4.6  Projections and Joins                                      151
    4.7  Summary                                                    156

 5  Mandatory Roles                                                 159
    5.1  Introduction to CSDP Step 5                                159
    5.2  Mandatory and Optional Roles                               162
    5.3  Reference Schemes                                          173
    5.4  Case Study: A Compact Disc Retailer                        192
    5.5  Logical Derivation Check                                   199
    5.6  Summary                                                    207

 6  Value, Set-Comparison, and Subtype Constraints                  211
    6.1  Introduction to CSDP Step 6                                211
    6.2  Basic Set Theory                                           212
    6.3  Value Constraints and Independent Types                    216
    6.4  Subset, Equality, and Exclusion Constraints               224
    6.5  Subtyping                                                  239
    6.6  Generalization of Object Types                             261
    6.7  Summary                                                    269

 7  Other Constraints and Final Checks                              273
    7.1  Introduction to CSDP Step 7                                273
    7.2  Frequency Constraints                                      274
    7.3  Ring Constraints                                           279
    7.4  Other Constraints and Rules                                291
    7.5  Final Checks                                               297
    7.6  Summary                                                    306

 8  Entity-Relationship Modeling                                    309
    8.1  Overview of ER                                             309
    8.2  Barker Notation                                            311
    8.3  Information Engineering Notation                           321
    8.4  IDEF1X                                                     325
    8.5  Mapping from ORM to ER                                     337
    8.6  Summary                                                    344

 9  Data Modeling in UML                                            347
    9.1  Introduction                                               347
    9.2  Object-Orientation                                         349
    9.3  Attributes                                                 352
    9.4  Associations                                               358
    9.5  Set-Comparison Constraints                                 365
    9.6  Subtyping                                                  373
    9.7  Other Constraints and Derivation Rules                     378
    9.8  Mapping from ORM to UML                                     390
    9.9  Summary                                                    397

10  Advanced Modeling Issues                                        401
    10.1  Join Constraints                                          401
    10.2  Deontic Rules                                             409
    10.3  Temporality                                               413
    10.4  Collection Types                                          436
    10.5  Nominalization and Objectification                        444
    10.6  Open/Closed World Semantics                               456
    10.7  Higher-Order Types                                        461
    10.8  Further Constraints Involving Subtyping                   474
    10.9  Summary                                                   476

11  Relational Mapping                                              481
    11.1  Implementing a Conceptual Schema                          481
    11.2  Relational Schemas                                        482
    11.3  Relational Mapping Procedure                              491
    11.4  Advanced Mapping Aspects                                  519
    11.5  Summary                                                   536

12  Relational Languages                                            539
    12.1  SQL: Relational Algebra                                   539
    12.2  Relational Database Systems                               566
    12.3  SQL: Historical and Structural Overview                   568
    12.4  SQL: Identifiers and Data Types                           570
    12.5  SQL: Choosing Columns, Rows, and Order                    574
    12.6  SQL: Joins                                                583
    12.7  SQL: in, between, like, and is null Operators             594
    12.8  SQL: Union and Simple Subqueries                          603
    12.9  SQL: Scalar Operators and Bag Functions                   614
    12.10 SQL: Grouping                                             622
    12.11 SQL: Correlated and Existential Subqueries                629
    12.12 SQL: Recursive Queries                                    637
    12.13 SQL: Updating Table Populations                           639
    12.14 Summary                                                   642

13  Other Database Features                                         647
    13.1  SQL: The Bigger Picture                                   647
    13.2  SQL: Defining Tables                                      648
    13.3  SQL: Views                                                656
    13.4  SQL: Triggers                                             663
    13.5  SQL: Routines                                             666
    13.6  More Database Objects                                     669
    13.7  Transactions and Concurrency                             673
    13.8  Security and Metadata                                     675
    13.9  Summary                                                   677

14  Schema Transformations                                          681
    14.1  Schema Equivalence and Optimization                       681
    14.2  Predicate Specialization and Generalization               685
    14.3  Nesting, Coreferencing, and Flattening                    697
    14.4  Other Transformations                                     715
    14.5  Conceptual Schema Optimization                            719
    14.6  Normalization                                             731
    14.7  Denormalization and Low-Level Optimization                752
    14.8  Reengineering                                             758
    14.9  Data Migration and Query Transformation                   765
    14.10 Summary                                                   769

15  Process and State Modeling                                      773
    15.1  Modeling Dynamic Behavior                                 773
    15.2  Processes and Workflow                                    776
    15.3  Foundations for Process Theory                            782
    15.4  State Models                                              788
    15.5  Modeling Information Dynamics in UML                      793
    15.6  Business Process Standards Initiatives                    806
    15.7  Business Process Model and Notation                       808
    15.8  Standard Process Patterns                                 810
    15.9  Process Models, Databases, and ORM                        819
    15.10 Decision Model and Notation                               825
    15.11 Summary                                                   829

16  Data File Formats                                               831
    16.1  External Data Structures                                  831
    16.2  XML                                                       833
    16.3  JSON                                                      853
    16.4  Other Markup Languages                                    866
    16.5  XML, JSON, and ORM                                        868
    16.6  Summary                                                   871

17  NoSQL and Other Nonrelational Databases                         875
    17.1  The Growth of the NoSQL Movement                          875
    17.2  Key-Value Stores                                          886
    17.3  Column-Oriented Databases                                 890
    17.4  Document Databases                                        895
    17.5  Graph Databases                                           904
    17.6  Other Nonrelational Databases                             916
    17.7  Summary                                                   932

18  Other Modeling Aspects and Trends                               935
    18.1  Introduction                                              935
    18.2  Data Warehousing and OLAP                                 936
    18.3  Conceptual Query Languages                                943
    18.4  Schema Abstraction Mechanisms                             952
    18.5  Further Design Aspects                                    957
    18.6  Ontologies and the Semantic Web                           965
    18.7  Metamodeling                                              994
    18.8  Summary                                                  1002

ORM Glossary                                                       1007
UML Glossary                                                       1019
ER Glossary                                                        1023
Useful websites                                                    1027
Bibliography                                                       1029
Index                                                              1041
```

## Where the Anki deck points

The `docs/anki` deck's "Read more" pointers resolve into this contents
list as follows. Keep this mapping in sync when either the deck or a
future edition changes.

- `01-foundations` -- ch. 3 (3.2-3.4: the CSDP, elementary facts, fact
  types); ORM Glossary, p. 1007.
- `02-object-types` -- 5.3 (reference schemes), 6.3 (value and
  independent types), 10.5 (objectification / nominalization); see also
  14.3 (nesting).
- `03-fact-types-and-readings` -- 3.3-3.4 (elementary facts, fact types,
  predicates, readings).
- `04-verbalization` -- Halpin, _ORM 2 Constraint Verbalization_
  (ORM2-02); chs. 4-7 for the constraints being verbalized.
- `05-constraints-phase1` -- ch. 4 (uniqueness; external uniqueness is
  4.4), 5.2 (mandatory roles), 6.3 (value constraints).
- `06-constraints-phase2` -- 6.4 (subset, equality, exclusion), 7.2
  (frequency), 7.3 (ring), 5.2 (disjunctive mandatory).
- `07-modeling-judgment` -- 3.3 (elementary facts), 3.5 and 7.4 (schema
  trimming and final checks), 10.5 (objectification).
- `08-subtypes` -- 6.5-6.6 (subtyping, generalization), 10.8 (further
  constraints involving subtyping).
- `09-projects-and-mappings` -- not in this book; barwise
  `docs/ORM_PROJECT_GUIDE.md` and DDD context mapping (Evans). Chapter 16
  (16.5, XML, JSON, and ORM) is the nearest serialization material.
- `10-relational-mapping` -- ch. 11 (the Rmap procedure is 11.3); barwise
  `docs/ARCHITECTURE.md` sections 3.4-3.5.

## Related sources

Beyond the book, the deck and the metamodel also cite:

- Halpin, _ORM 2 Constraint Verbalization_, tech report ORM2-02,
  `https://www.orm.net/pdf/ORM2_TechReport2.pdf` -- the FORML sentence
  forms.
- Halpin, _ORM 2 Graphical Notation_, tech report ORM2-01,
  `https://www.orm.net/pdf/ORM2_TechReport1.pdf`.
- Halpin, _Logical Data Modeling_ series, Business Rules Journal,
  `https://www.brcommunity.com`.
