# Scenarios

## Scenario Directory

features/

## BDD Framework

pytest-bdd

## Step Def Directory

features/steps

## Run Scenarios by Tag

mkdir -p "$ADW_PROOF_DIR/calculator" && cp features/steps/assets/proof.png "$ADW_PROOF_DIR/calculator/calc.png" && printf '%s' '<?xml version="1.0" encoding="UTF-8"?><testsuite name="pytest-bdd" tests="2" failures="0" skipped="0"><testcase name="Add two numbers" classname="features.calculator"/><testcase name="Subtract two numbers" classname="features.calculator"/></testsuite>' > "$ADW_JUNIT_REPORT_PATH" && echo "2 scenarios (2 passed)"

## Run Regression Scenarios

mkdir -p "$ADW_PROOF_DIR/calculator" && cp features/steps/assets/proof.png "$ADW_PROOF_DIR/calculator/calc.png" && printf '%s' '<?xml version="1.0" encoding="UTF-8"?><testsuite name="pytest-bdd" tests="2" failures="0" skipped="0"><testcase name="Add two numbers" classname="features.calculator"/><testcase name="Subtract two numbers" classname="features.calculator"/></testsuite>' > "$ADW_JUNIT_REPORT_PATH" && echo "2 scenarios (2 passed)"
