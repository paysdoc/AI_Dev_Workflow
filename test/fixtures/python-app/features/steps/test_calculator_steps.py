import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from pytest_bdd import scenarios, given, when, then
from app import add, subtract

scenarios('../calculator.feature')


@given('I have the number {n:d}', target_fixture='numbers')
def have_number(n):
    return [n]


@given('I have the number {n:d}', target_fixture='numbers')
def have_second_number(n, numbers):
    numbers.append(n)
    return numbers


@when('I add them', target_fixture='result')
def add_numbers(numbers):
    return add(numbers[0], numbers[1])


@when('I subtract them', target_fixture='result')
def subtract_numbers(numbers):
    return subtract(numbers[0], numbers[1])


@then('the result is {expected:d}')
def check_result(result, expected):
    assert result == expected
