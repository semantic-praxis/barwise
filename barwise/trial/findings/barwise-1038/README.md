# barwise-1038: the Kotlin importer returns nothing for data and sealed classes

```sh
barwise import kotlin trial/findings/barwise-1038
```

Four files: three data classes and one sealed hierarchy, the way
Kotlin domain code is written.

Expected: entity types Event, Tenant, EventProperty, User,
AnonymousUser, IdentifiedUser with subtypes and fact types from the
constructor properties.

Observed (1.7.0): exit 0, "Imported 0 object types", confidence medium,
no warning naming a class. The Java importer on the equivalent JPA
entities and the TypeScript importer on the equivalent classes both
import.
