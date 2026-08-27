# Use trusted internal Plugins for replaceable behavior

The MVP will statically compose trusted, in-repository Plugins behind typed capability contracts and a common lifecycle. The Plugin Kernel, domain contracts, database migrations, security boundaries, and application composition root remain stable infrastructure; third-party installation, UI Plugins, runtime reload, and untrusted code execution are deferred so the product can gain replaceable capabilities without taking on an ecosystem ABI and sandbox in its first release.
