"""Suite-wide setup for the optimizer tests.

The smoke tests run the real CLI and let some calls fail by design, so the
session's exit recorder must not report those exits as hidden failures
(docs/specs/masked-exit-report.spec.md, the declared opt-out). Removing
the switch here covers every subprocess the suite starts.
"""

import os

os.environ.pop("BARWISE_EXIT_DIR", None)
