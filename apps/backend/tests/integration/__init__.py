"""Package marker for real-Postgres integration tests (`sdd/sabbi-test-suite`).

Unlike `tests/*.py` (mock-only unit tests, always run), these tests require
`TEST_DATABASE_URL` to point at a real Postgres instance and are skipped via
the autouse `_rollback` fixture in `tests/conftest.py` when it is not set.
"""
