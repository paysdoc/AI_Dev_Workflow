# python-flat fixture

Flat-layout Python fixture (no `src/` directory) used by ADW behavioral tests.

This fixture proves that the unit-test phase executes against `testDirectory` and
that the skip-as-passed trap from the old `--run src` condition is gone. When
pytest is available on the host, run:

```sh
cd test/fixtures/python-flat
pytest tests
```

Expected: 2 tests collected, 2 passed.
