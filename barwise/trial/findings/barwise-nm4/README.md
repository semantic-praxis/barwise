# barwise-nm4: the NORMA importer silently drops internal uniqueness constraints no fact references

```sh
barwise import norma trial/findings/barwise-nm4/assignment.orm --output /tmp/nm4.orm.yaml
```

`assignment.orm` is one binary fact type, `RandomizedSubject is assigned
to Arm`, carrying two constraints declared at model level: `IUC71`, an
internal uniqueness constraint on the subject's role (each subject is
assigned to at most one arm), and `MC72`, a mandatory constraint on the
same role.

Expected: the imported fact type carries both constraints, or the
importer names on stderr the one it could not attach.

Observed (1.7.0): exit 0, "Confidence: high", no warning, and the fact
type carries only the mandatory constraint. The imported model allows a
subject to be assigned to two arms, which the source forbids.

## The cause, isolated

A NORMA file references each internal constraint from its fact, under
`<orm:InternalConstraints>`. The importer attaches an internal
uniqueness constraint only through that reference, although the
constraint element names its own roles; it attaches the mandatory
constraint by its role sequence either way. Add the reference and the
constraint survives:

```xml
<orm:InternalConstraints>
  <orm:UniquenessConstraint ref="_00000147-0000-4000-8000-000000000000" />
</orm:InternalConstraints>
```

Three controls, all without the per-fact reference, all lose the
uniqueness constraint: spanning both roles, on the other role, and with
the mandatory constraint removed. So it is every internal uniqueness
constraint in this shape, not this one.

The defect is the silence as much as the loss: the importer drops a
constraint it has everything needed to attach, and reports high
confidence while doing it.

## Why this reproduction is a committed file

The trial found this through C09's generated `legacy-norma.orm`, which
omits the per-fact references entirely (0 of them in 1,301 lines). That
is a fidelity gap in the trial's NORMA generator, tracked in
barwise-kt7. Fixing the generator alone would make C09's rows pass and
remove the trial's only evidence of this importer defect, so the
evidence lives here instead, independent of the generator.
