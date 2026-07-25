import json
from contextlib import contextmanager
from types import SimpleNamespace

from app.services.zip_quote_parameters import (
    build_missing_checklist_materials,
    ensure_checklist_material_colors,
    resolve_checklist_printer,
)


def test_parameter_module_resolves_printer_overrides():
    assert resolve_checklist_printer("bambu_a1_08", "", "0.4") == "bambu_a1_04"


def test_parameter_module_persists_created_material_with_injected_db():
    user = SimpleNamespace(materials=None)

    class Query:
        def filter(self, *_args):
            return self

        def first(self):
            return user

    class Database:
        def query(self, *_args):
            return Query()

    @contextmanager
    def session_factory():
        yield Database()

    materials = []
    created = ensure_checklist_material_colors(
        7,
        materials,
        [{"material_type": "", "color": "黑色"}],
        db_session_factory=session_factory,
    )

    assert created[0]["name"] == "PLA"
    assert json.loads(user.materials) == materials


def test_parameter_module_persists_new_mapped_checklist_color():
    user = SimpleNamespace(materials=None)

    class Query:
        def filter(self, *_args):
            return self

        def first(self):
            return user

    class Database:
        def query(self, *_args):
            return Query()

    @contextmanager
    def session_factory():
        yield Database()

    materials = [{
        "name": "PETG",
        "brand": "Generic",
        "density": 1.27,
        "price_per_kg": 100,
        "color": {"name": "??", "hex": "#000000"},
    }]
    created = ensure_checklist_material_colors(
        7,
        materials,
        [{
            "material_type": "PETG",
            "color": "????",
            "_mapped_color": {"name": "????", "hex": "#12ab34"},
        }],
        db_session_factory=session_factory,
    )

    assert created[0]["color"] == {"name": "????", "hex": "#12ab34"}
    assert json.loads(user.materials)[-1]["color"] == {"name": "????", "hex": "#12ab34"}


def test_parameter_module_does_not_duplicate_existing_color():
    materials = [
        {"name": "PLA", "brand": "Generic", "color": {"name": "黑色", "hex": "#000000"}}
    ]

    assert build_missing_checklist_materials(materials, [{"material_type": "PLA", "color": "黑色"}]) == []
