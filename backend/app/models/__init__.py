"""Model package.

Importing this package imports every submodule under ``app.models`` so that
all SQLModel table classes register themselves on ``SQLModel.metadata``.
This is what makes Alembic's ``target_metadata`` (see ``alembic/env.py``)
and its ``--autogenerate`` diffing complete and trustworthy - a module that
isn't imported never registers its tables, and Alembic then has no idea
they exist (see issue #130).

Discovery is automatic (via ``pkgutil.iter_modules``) specifically so this
file never needs to be touched when a new ``app/models/<name>.py`` module is
added - a hand-maintained import list is exactly how this gap happened the
first time.
"""

import importlib
import pkgutil

for _module_info in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{_module_info.name}")

del importlib, pkgutil, _module_info
