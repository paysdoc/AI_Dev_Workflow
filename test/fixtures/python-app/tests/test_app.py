import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import add, subtract


def test_add():
    assert add(2, 3) == 5


def test_subtract():
    assert subtract(5, 3) == 2
