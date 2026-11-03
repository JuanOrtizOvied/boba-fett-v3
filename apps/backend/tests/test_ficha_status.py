"""Unit tests for the ficha status lifecycle derivation
(`db.ficha_patrimonial.derive_ficha_status`). Lifecycle (user-confirmed,
"por decisiones de línea"): con_error (parse/enrichment failed) / por_validar
(parsed, nothing decided) / en_proceso (some decided, not all-decided-and-
confirmed) / validada (all decided AND confirmed).
"""

from db.ficha_patrimonial import derive_ficha_status


def test_parse_failure_is_con_error_regardless_of_lines():
    assert derive_ficha_status(True, [], False) == "con_error"
    assert derive_ficha_status(True, ["approved"], True) == "con_error"


def test_no_lines_is_por_validar():
    assert derive_ficha_status(False, [], False) == "por_validar"


def test_all_pending_is_por_validar():
    assert derive_ficha_status(False, ["pending", "pending"], False) == "por_validar"


def test_some_decided_is_en_proceso():
    assert derive_ficha_status(False, ["approved", "pending"], False) == "en_proceso"
    assert derive_ficha_status(False, ["discarded", "pending"], False) == "en_proceso"


def test_all_decided_but_not_confirmed_is_en_proceso():
    assert derive_ficha_status(False, ["approved", "discarded"], False) == "en_proceso"


def test_all_decided_and_confirmed_is_validada():
    assert derive_ficha_status(False, ["approved", "discarded"], True) == "validada"
    assert derive_ficha_status(False, ["approved", "approved"], True) == "validada"


def test_confirmed_but_not_all_decided_stays_en_proceso():
    # Can't be validada while a line is still pending, even if confirmed.
    assert derive_ficha_status(False, ["approved", "pending"], True) == "en_proceso"
